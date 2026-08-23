// Vidstack-based VOD player.
//
// One instance per open, owning every piece of state it touches. The previous
// version kept a module-level `player` that was assigned only AFTER an await,
// mutated by closures from earlier opens, and torn down by clearing innerHTML.
// That combination produced the "open a second title and the first one starts
// over" bug: VidstackPlayer.create() always sets `keep-alive`, and
// disconnectedCallback explicitly skips auto-destroy when that attribute is
// present, so removing the element from the DOM detaches it without stopping
// it. The orphan kept playing and its listeners kept writing to the shared
// singleton, retargeting the visible player's src.
//
// Rules that keep it fixed:
//   1. All state lives on the instance. No module-level mutable player.
//   2. destroy() is the ONLY teardown: explicit player.destroy(), then abort
//      the listener signal, then remove the DOM. Never the reverse.
//   3. Every open takes a token. Anything resolving after its token is stale
//      destroys itself instead of assigning.
//   4. Geometry is set inline by the instance, so the legacy `.mini-player`
//      stylesheet (written for a player that no longer exists, and full of
//      !important) can never apply.
//
// Self-contained on purpose: imports only from state/api/db/profiles (never
// vod.ts) so there is no circular dependency.

import { VidstackPlayer, VidstackPlayerLayout } from "vidstack/global/player";
import "vidstack/player/styles/default/theme.css";
import "vidstack/player/styles/default/layouts/video.css";
import { state } from "./state";
import { toggleWatched } from "./api";
import { saveProgress } from "./db";
import { getActiveProfile } from "./profiles";
import { reportPlaybackFailure } from "./feedback";
import { showToast } from "./util";

const BRAND = "#c5f04e";


/** Can this browser make an arbitrary ELEMENT fullscreen?
 *
 *  iPhone Safari cannot. It has no Element.requestFullscreen at all; the only
 *  fullscreen it offers is HTMLVideoElement.webkitEnterFullscreen, which hands
 *  the video to the operating system's own player. That player is not a DOM
 *  node and nothing of ours can be drawn on it -- no reactions, no knock, no
 *  removal card. iPad and Android both support element fullscreen and are fine.
 *
 *  Checked by capability rather than by sniffing the user agent, so an iPhone
 *  that gains the API stops taking the fallback on its own. */
function canElementFullscreen(): boolean {
  const d = document as any;
  const enabled = d.fullscreenEnabled ?? d.webkitFullscreenEnabled ?? false;
  const method = (Element.prototype as any).requestFullscreen
              || (Element.prototype as any).webkitRequestFullscreen;
  return !!enabled && typeof method === "function";
}

const FULL_CSS = "position:fixed;inset:0;z-index:9998;display:block;background:#000;";
const MINI_CSS =
  "position:fixed;inset:auto 24px 24px auto;width:22rem;max-width:44vw;aspect-ratio:16/9;" +
  "z-index:9998;display:block;background:#000;border-radius:14px;overflow:hidden;cursor:pointer;" +
  "box-shadow:0 18px 50px rgba(0,0,0,0.6);border:1px solid rgba(197,240,78,0.5);";

// The manifest relay lives on Cloudflare, not Vercel. Relaying through a Vercel
// function is billed as Fast Origin Transfer -- roughly 1 GB per film against a
// 10 GB allowance, which is what put this project at 75% of its free tier.
// Cloudflare never bills data transfer.
//
// Only MANIFESTS go through it. Pluto's segment CDN reflects the requesting
// origin in Access-Control-Allow-Origin, so the worker rewrites segment URLs to
// the CDN directly and the player fetches them itself -- no video byte touches
// our infrastructure at all.
const PROXY_BASE = (import.meta.env.VITE_PROXY_URL as string) || "";
const proxied = (u: string) =>
  `${PROXY_BASE}/proxy?url=${encodeURIComponent(u)}`;

// Pluto's CDN answers with `access-control-allow-origin: http://pluto.tv`, so a
// browser can never read its manifests cross-origin however fresh the token is.
// Tubi (allow-origin: *) and Archive (progressive mp4) stay on the direct path.
const playable = (u: string) => (/(^|\.)pluto\.tv\//.test(u) ? proxied(u) : u);

// Vidstack picks its provider by sniffing the extension
// (HLS_VIDEO_EXTENSIONS = /\.(m3u8)($|\?)/i). Wrapping a URL in /proxy?url=...
// percent-encodes ".m3u8?" to ".m3u8%3F", the sniff misses, and playback fails
// with code 4 (MEDIA_ERR_SRC_NOT_SUPPORTED). Declaring the type skips the sniff.
function toSource(rawUrl: string): string | { src: string; type: "application/x-mpegurl" } {
  const src = playable(rawUrl);
  return /\.m3u8($|\?)/i.test(rawUrl) ? { src, type: "application/x-mpegurl" as const } : src;
}

function activeProfileUuid(): string | null {
  const id = getActiveProfile().id;
  return id && !id.startsWith("default_") && !id.startsWith("profile_") ? id : null;
}

// Continue Watching is stored PER PROFILE. This key must match the one vod.ts
// reads to render the rail.
function resumeHistoryKey(): string {
  let id = "default";
  try { id = getActiveProfile()?.id || "default"; } catch {}
  return `tvlc_resume_history_${id}`;
}

function markWatched(epId?: string): void {
  if (epId && !state.watched.has(epId)) {
    state.watched.add(epId);
    document.querySelector(`.episodeCard[data-ep-id="${CSS.escape(epId)}"]`)?.classList.add("watched");
    void toggleWatched(epId, true);
  }
}

class VodPlayer {
  private player: any = null;
  private root: HTMLElement | null = null;
  private stage: HTMLElement | null = null;
  private loader: HTMLElement | null = null;
  private pipBtn: HTMLElement | null = null;
  private readonly ac = new AbortController();
  private mode: "full" | "mini" = "full";
  private lastSave = 0;
  /** Set once the resume seek has been applied, so a later can-play (after a
   *  scrub or a quality switch) cannot yank the viewer back. */
  private resumed = false;
  private destroyed = false;

  constructor(
    private readonly overlay: HTMLElement,
    private readonly ch: any,
    private idx: number,
    private readonly startTime: number,
    readonly token: number,
  ) {}

  async mount(): Promise<void> {
    this.buildChrome();
    if (this.destroyed) return;

    const first = this.ch.streams?.[this.idx];
    if (!first?.url) {
      this.showPanel("This title isn't available to stream right now.", "Try another title — most of the catalog plays instantly.", true);
      return;
    }

    let created: any;
    try {
      created = await VidstackPlayer.create({
        target: this.stage!,
        title: this.titleFor(first),
        src: toSource(first.url),
        autoplay: true,
        currentTime: this.startTime,
        layout: new VidstackPlayerLayout(),
      });
    } catch (e: any) {
      console.error("[vodplayer] VidstackPlayer.create failed:", e);
      if (!this.destroyed) this.showPanel("Player failed to load.", e?.message || "Unknown error");
      return;
    }

    // A newer open may have destroyed us while create() was in flight. Because
    // create() sets keep-alive, an orphan left here would keep playing audio
    // forever, so it has to destroy itself rather than be abandoned.
    if (this.destroyed) {
      try { created.destroy(); } catch {}
      return;
    }

    this.player = created;
    this.guardAutoplay(created);
    this.fixQualityLabels();
    this.mountBufferSpinner(created);
    this.applyPrefs(created);
    this.style();
    this.wire();
    this.showBump();
  }

  /** Recover when the browser refuses to autoplay.
   *
   *  `autoplay: true` is a request, not a guarantee. Safari only honours it
   *  within a short window after a real user gesture, and the player is built
   *  AFTER an async stream resolve -- so by the time it exists the activation
   *  has often expired and play() is rejected. Chrome is lenient and plays
   *  anyway, which is why this looks like a Safari-only "nothing plays".
   *
   *  Nothing caught that rejection, so the viewer got a black player with no
   *  explanation. Now they get something to press, which is the only thing that
   *  can lift the block. */
  private guardAutoplay(p: any): void {
    // Listen for the player's OWN failure rather than calling play() here.
    //
    // The first version raced: Vidstack is constructed with autoplay:true and
    // calls play() itself, so a second concurrent play() makes one of the two
    // reject with an abort -- even though playback is starting fine. That
    // rejection then put "Couldn't start playback" over a film whose audio was
    // already running.
    const onFail = () => {
      if (this.destroyed || !p.paused) return;

      if (this.root?.querySelector(".vdTapPlay")) return;
      const el = document.createElement("button");
      el.className = "vdTapPlay";
      el.innerHTML = `
        <span class="vdTapIcon"><svg viewBox="0 0 24 24" fill="currentColor"><polygon points="6 3 20 12 6 21 6 3"></polygon></svg></span>
        <span>Tap to play</span>`;
      el.addEventListener("click", () => {
        el.remove();
        // No panel on failure here either: the player is alive and the film may
        // well be playing. Tearing the view down over a rejected promise is how
        // the last version turned a non-problem into a dead end.
        void p.play()?.catch?.(() => showToast("Couldn't start playback"));
      });
      this.root?.appendChild(el);
      p.addEventListener("playing", () => el.remove(), { once: true, signal: this.ac.signal });
    };

    p.addEventListener("autoplay-error", onFail, { signal: this.ac.signal });
  }

  /** Relabel quality options that have no resolution to report.
   *
   *  Pluto's HLS manifests carry BANDWIDTH but no RESOLUTION, so every level
   *  reports height 0. Vidstack guards its hint text -- `height ? \`${height}p\`
   *  : "Auto"` -- but builds the radio labels unguarded as `quality.height +
   *  "p"`, so the menu lists "0p" five times.
   *
   *  Relabelled by RANK, not by an invented resolution. Guessing 1080p from
   *  3.3 Mbps would be fabricating information the source never provided; the
   *  ordering is real, and the exact bitrate is already shown beside each row.
   *
   *  Done in the DOM because the label is computed inside the library's own
   *  options(), with no prop to override it. Scoped to this player's root and
   *  to the exact string "0p", so it cannot touch anything else. */
  private fixQualityLabels(): void {
    const rank = (i: number, n: number): string => {
      if (n <= 1) return "Standard";
      const ladder = ["Highest", "High", "Medium", "Low", "Lowest"];
      return ladder[Math.round((i * (ladder.length - 1)) / (n - 1))]!;
    };

    let patching = false;

    const relabel = () => {
      if (patching) return;   // our own writes retrigger the observer

      // Vidstack's default video layout builds the settings menu with
      // `portal: true`, which its own docs describe as "portals menu items into
      // the document body". The radio group is therefore NOT inside the player
      // element, and it is removed from the DOM entirely whenever the menu
      // closes. Two earlier attempts observed the player root and so never saw
      // it appear -- they looked right and did nothing.
      const labels = document.querySelectorAll<HTMLElement>(".vds-radio-label");
      if (!labels.length) return;   // menu closed: nothing mounted

      patching = true;
      try {
        const zeroed = Array.from(labels).filter((el) => el.textContent?.trim() === "0p");
        zeroed.forEach((el, i) => { el.textContent = rank(i, zeroed.length); });

        // Second unguarded template in the library: the menu hint renders
        // `quality().height + "p"`, giving "Auto (0p)". That one lives on the
        // button inside the player, not in the portal.
        for (const el of document.querySelectorAll<HTMLElement>(".vds-menu-hint, [data-part='hint']")) {
          const t = (el.textContent || "").trim();
          if (t.endsWith("(0p)")) el.textContent = t.slice(0, -4).replace(/\s*\($/, "").trim();
        }
      } finally {
        patching = false;
      }
    };

    // Observing document.body, because that is where the menu is portaled to.
    // The callback early-outs on a single querySelectorAll when the menu is
    // closed, which is almost always, so this stays cheap during playback.
    let queued = false;
    const obs = new MutationObserver(() => {
      if (queued) return;
      queued = true;
      queueMicrotask(() => { queued = false; relabel(); });
    });
    obs.observe(document.body, { childList: true, subtree: true, characterData: true });
    this.ac.signal.addEventListener("abort", () => obs.disconnect());
  }

  /** Brand spinner for mid-stream stalls.
   *
   *  The ident bump covers the FIRST play only; a rebuffer twenty minutes in
   *  showed nothing at all, which reads as the player having died. Uses loader 3
   *  ("buffering") from the brand package rather than a generic spinner, so a
   *  stall still looks like veedeeoh.
   *
   *  Delayed by 400ms: most rebuffers resolve faster than that, and a spinner
   *  that flashes on every seek is worse than no spinner. */
  private mountBufferSpinner(p: any): void {
    const el = document.createElement("div");
    el.className = "vdBuffer";
    el.innerHTML = `
      <svg viewBox="0 0 40 40" aria-hidden="true">
        <circle cx="20" cy="20" r="16" fill="none" stroke="#20232A" stroke-width="4"></circle>
        <circle cx="20" cy="20" r="16" fill="none" stroke="var(--accent, #c5f04e)" stroke-width="4"
                stroke-linecap="round" stroke-dasharray="34 100"></circle>
      </svg>`;
    this.overlay.appendChild(el);

    let t: number | null = null;
    const show = () => {
      if (t !== null) return;
      t = window.setTimeout(() => el.classList.add("on"), 400);
    };
    const hide = () => {
      if (t !== null) { clearTimeout(t); t = null; }
      el.classList.remove("on");
    };
    p.addEventListener("waiting", show, { signal: this.ac.signal });
    p.addEventListener("playing", hide, { signal: this.ac.signal });
    p.addEventListener("seeked", hide, { signal: this.ac.signal });
    p.addEventListener("error", hide, { signal: this.ac.signal });
  }

  /** Apply the viewer's saved playback preferences.
   *
   *  These existed as two UI controls writing localStorage that NOTHING read --
   *  a switch that does not switch anything is worse than no switch, because
   *  the user stops trusting the ones that do work. Applied here, at the one
   *  place a player is constructed.
   *
   *  Quality is a CEILING, not an exact pick: a stream may not publish 1080p,
   *  and forcing an absent level would leave the player with nothing to play.
   */
  private applyPrefs(p: any): void {
    try {
      if (localStorage.getItem("veedeeoh_pref_cc") === "1") {
        // Tracks arrive with the manifest, so this cannot run inline.
        p.textTracks?.addEventListener?.("add", () => {
          const track = p.textTracks?.getByKind?.("subtitles")?.[0]
            || p.textTracks?.getByKind?.("captions")?.[0];
          if (track && !p.textTracks.selected) track.mode = "showing";
        });
      }

      const want = parseInt(localStorage.getItem("veedeeoh_pref_quality") || "", 10);
      if (want) {
        p.qualities?.addEventListener?.("change", () => {
          if (!p.qualities || p.qualities.length === 0) return;

          // Pluto's manifests carry BANDWIDTH but no RESOLUTION, so every level
          // reports height 0 -- which is also why the player's own menu shows
          // "0p". Comparing heights there matched the FIRST entry, the lowest
          // bitrate, so asking for 1080p pinned the viewer to 0.64 Mbps. With
          // no resolution data there is nothing honest to choose on, so leave
          // adaptive selection alone.
          const levels = Array.from(p.qualities) as any[];
          if (!levels.some((q) => (q.height ?? 0) > 0)) return;

          let best: any = null;
          for (const q of levels) {
            if (q.height > 0 && q.height <= want && (!best || q.height > best.height)) best = q;
          }
          // No level at or below the cap: leave auto alone rather than pinning
          // the viewer to a quality they did not ask for.
          if (best) best.selected = true;
        }, { once: true });
      }
    } catch (e) {
      console.warn("[vodplayer] could not apply playback prefs", e);
    }
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.ac.abort();                                   // drops every listener at once
    if (this.player) {
      // Explicit destroy FIRST. Removing the DOM does not stop a keep-alive player.
      try { this.player.destroy(); } catch {}
      this.player = null;
    }
    this.root?.remove();
    this.root = this.stage = this.loader = this.pipBtn = null;
  }

  pause(): void { try { this.player?.pause(); } catch {} }

  /** Escape hatch for the party sync layer only. */
  raw(): any { return this.player; }

  /** The player's own wrapper, for state classes that must not leak to the
   *  whole document when two players briefly overlap. */
  rootEl(): HTMLElement | null { return this.root; }

  /** Which stream (episode) is playing, for the party sync payload. */
  streamIndex(): number { return this.idx; }

  /** Follow the host to another episode, landing at their position.
   *
   *  startTime is readonly and only consulted at construction, so the seek is
   *  applied on can-play here instead -- the same reason resume needed it: an
   *  HLS source has no seekable range until it has loaded. */
  switchTo(i: number, atSecs: number): void {
    if (i === this.idx || !this.ch.streams?.[i]) return;
    this.load(i);
    const p = this.player;
    if (!p) return;
    const seek = () => {
      if (atSecs > 1 && Math.abs((p.currentTime ?? 0) - atSecs) > 2) p.currentTime = atSecs;
    };
    p.addEventListener("can-play", seek, { once: true, signal: this.ac.signal });
  }

  private emitParty = (): void => {
    if (!partyEmit || applyingRemote || !this.player) return;
    partyEmit({
      positionSecs: this.player.currentTime ?? 0,
      paused: !!this.player.paused,
      streamIdx: this.idx,
    });
  };

  setMode(mode: "full" | "mini"): void {
    this.mode = mode;
    this.overlay.style.cssText = mode === "mini" ? MINI_CSS : FULL_CSS;
    if (this.root) this.root.dataset.mode = mode;
    if (this.pipBtn) this.pipBtn.style.display = mode === "mini" ? "none" : this.pipBtn.dataset.ready ? "flex" : "none";

    const q = (role: string) => this.root?.querySelector<HTMLElement>(`[data-role=${role}]`);
    const mini = mode === "mini";

    // Close sits clear of Vidstack's own top chrome at full size, and tucks into
    // the corner when the box is small.
    const close = q("close");
    if (close) {
      close.style.top = mini ? "8px" : "20px";
      close.style.right = mini ? "8px" : "68px";
      close.style.width = close.style.height = mini ? "32px" : "40px";
      close.style.background = mini ? "#222" : "rgba(0,0,0,0.55)";
      close.style.display = "flex";
    }
    const expand = q("expand");
    if (expand) expand.style.display = mini ? "flex" : "none";
    const minimize = q("minimize");
    if (minimize) minimize.style.display = mini ? "none" : "flex";
  }

  private titleFor(stream: any): string {
    return stream?.source ? `${this.ch.name} · ${stream.source}` : this.ch.name;
  }

  private buildChrome(): void {
    const root = document.createElement("div");
    root.className = "vodStage";
    root.dataset.mode = "full";
    root.style.cssText = "position:absolute;inset:0;width:100%;height:100%;background:#000;";

    const stage = document.createElement("div");
    stage.style.cssText = "width:100%;height:100%;";
    root.appendChild(stage);

    const loader = document.createElement("div");
    loader.style.cssText = "position:absolute;inset:0;display:flex;align-items:center;justify-content:center;z-index:40;background:#000;";
    loader.innerHTML = `
      <div style="display:flex;align-items:flex-end;gap:10px;height:40px">
        <div style="width:14px;height:14px;border-radius:50%;background:#C6F53A;animation:vdBounce .72s ease-in-out infinite"></div>
        <div style="width:14px;height:14px;border-radius:50%;background:#7E8792;animation:vdBounce .72s ease-in-out infinite;animation-delay:.1s"></div>
        <div style="width:14px;height:14px;border-radius:50%;background:#4A5058;animation:vdBounce .72s ease-in-out infinite;animation-delay:.2s"></div>
      </div>
      <style>
        @keyframes vdBounce { 0%,100% { transform: translateY(0) scale(1.14,.86); } 45% { transform: translateY(-22px) scale(.92,1.08); } }
        .vodStage media-spinner { display: none !important; }
      </style>`;
    root.appendChild(loader);

    root.appendChild(this.iconBtn("minimize", "Minimize player",
      "position:absolute;top:20px;left:20px;z-index:60;",
      `<polyline points="15 18 9 12 15 6"></polyline>`,
      () => this.setMode("mini")));

    this.pipBtn = this.iconBtn("pip", "Pop out (Picture-in-Picture)",
      "position:absolute;top:20px;right:20px;z-index:60;display:none;",
      `<rect x="2" y="4" width="20" height="16" rx="2"></rect><rect x="12" y="12" width="8" height="6" rx="1" fill="currentColor" stroke="none"></rect>`,
      () => void this.togglePip());
    root.appendChild(this.pipBtn);

    // Close is available in BOTH modes. Previously it only appeared in mini, so
    // the only way out of full screen was to minimise first and then close.
    root.appendChild(this.iconBtn("close", "Close player",
      "position:absolute;z-index:70;",
      `<line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line>`,
      () => closeVodPlayer()));

    // Explicit restore control, so returning to full size does not depend on
    // knowing that the box is clickable.
    root.appendChild(this.iconBtn("expand", "Back to full screen",
      "position:absolute;top:8px;left:8px;z-index:70;display:none;width:32px;height:32px;background:#222;",
      `<polyline points="15 3 21 3 21 9"></polyline><polyline points="9 21 3 21 3 15"></polyline><line x1="21" y1="3" x2="14" y2="10"></line><line x1="3" y1="21" x2="10" y2="14"></line>`,
      () => this.setMode("full")));

    // In mini mode, clicking bare video restores to full size, but Vidstack's own
    // controls must keep working. A blanket shield over the box blocked the play
    // button too; letting the click through instead meant Vidstack's tap-to-pause
    // gesture fired and restoring always paused playback.
    //
    // So: intercept in the CAPTURE phase, before the gesture handler runs, and
    // bail out if the click landed on a control. composedPath() is used rather
    // than closest() because Vidstack renders controls inside shadow roots,
    // which retargets event.target to the host element.
    const isControl = (e: Event) =>
      (e.composedPath() as HTMLElement[]).some((el) => {
        const tag = el?.tagName?.toLowerCase?.() || "";
        return (
          tag === "button" ||
          tag === "input" ||
          tag === "media-controls" ||
          tag.endsWith("-button") ||
          tag.endsWith("-slider") ||
          tag.endsWith("-menu") ||
          el?.getAttribute?.("role") === "button"
        );
      });

    root.addEventListener("click", (e) => {
      if (this.mode !== "mini" || isControl(e)) return;
      e.stopPropagation();
      e.preventDefault();
      this.setMode("full");
    }, { capture: true, signal: this.ac.signal });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !this.overlay.hasAttribute("hidden") && !document.fullscreenElement) closeVodPlayer();
    }, { signal: this.ac.signal });

    this.overlay.appendChild(root);
    this.root = root;
    this.stage = stage;
    this.loader = loader;
    this.setMode("full");
  }

  private iconBtn(role: string, label: string, extra: string, path: string, onClick: () => void): HTMLElement {
    const b = document.createElement("button");
    b.dataset.role = role;
    b.setAttribute("aria-label", label);
    b.title = label;
    b.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
    b.style.cssText =
      "align-items:center;justify-content:center;width:40px;height:40px;border-radius:50%;border:none;" +
      "background:rgba(0,0,0,0.55);color:#fff;cursor:pointer;display:flex;" + extra;
    b.addEventListener("click", (e) => { e.stopPropagation(); onClick(); }, { signal: this.ac.signal });
    return b;
  }

  private async togglePip(): Promise<void> {
    try {
      if (this.player?.state?.pictureInPicture) await this.player.exitPictureInPicture();
      else await this.player?.enterPictureInPicture();
    } catch (err) {
      console.warn("[vodplayer] picture-in-picture request failed:", err);
    }
  }

  private style(): void {
    try {
      const el = this.player as HTMLElement;
      el.style.width = "100%";
      el.style.height = "100%";
      el.style.setProperty("--media-brand", BRAND);
      (this.player as any).fullscreenOrientation = "landscape";
      setTimeout(() => { if (!this.destroyed) el.focus(); }, 100);
      this.guardFullscreen();
    } catch {}
  }

  /** On a device that cannot make an element fullscreen, do not go fullscreen.
   *
   *  THE OVERLAY IS ALREADY THE WHOLE VIEWPORT -- FULL_CSS is position:fixed,
   *  inset:0. So on an iPhone the native handoff buys one thing, hiding the
   *  address bar, and costs every overlay a watch party is made of: reactions,
   *  the knock telling a host somebody is waiting, the card telling a viewer
   *  they were removed. None of them can be painted over the system player.
   *  Staying inline keeps all of them and loses a strip of browser chrome.
   *
   *  Swallowed in the CAPTURE phase on an ancestor, so it never reaches
   *  vidstack's own handler. Cancelling the request event is not enough:
   *  enterFullscreen() enqueues the request for bookkeeping and then calls the
   *  adapter regardless of whether anyone prevented it. */
  private guardFullscreen(): void {
    if (canElementFullscreen()) return;
    document.body.classList.add("no-element-fullscreen");
    this.overlay.addEventListener("media-enter-fullscreen-request", (e: Event) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      // Already covering the viewport; nothing to expand.
    }, true);
  }

  /** Plays the brand bump over the player while the stream buffers.
   *
   *  The first play of a session is the slow one: Vidstack lazy-loads hls.js
   *  from a CDN before it can even fetch the manifest. Filling that with the
   *  bump makes the wait feel like part of the product rather than a stall, and
   *  the stream buffers behind it the whole time.
   *
   *  Skipped if the profile-entry ident played in the last 60s, so opening a
   *  title straight after choosing a profile does not show it twice; and after
   *  the first play of a session, when the pipeline is warm and it would only
   *  add delay. Never blocks: it removes itself on end, error, click, or a 6s
   *  timeout, exactly like playIdent. */
  private showBump(): void {
    try {
      const last = Number(sessionStorage.getItem("veedeeoh_ident_at") || 0);
      if (Date.now() - last < 60_000) return;                 // just saw it
      if (sessionStorage.getItem("veedeeoh_bump_played")) return; // first play only
      sessionStorage.setItem("veedeeoh_bump_played", "1");
    } catch { return; }

    const isKids = !!getActiveProfile()?.is_kids;
    const wrap = document.createElement("div");
    wrap.dataset.role = "bump";
    wrap.style.cssText = "position:absolute;inset:0;z-index:50;background:#06070a;display:flex;align-items:center;justify-content:center;transition:opacity .45s ease;";
    const v = document.createElement("video");
    v.src = isKids ? "/kids-bump.mp4" : "/bump.mp4";
    v.autoplay = true;
    v.setAttribute("playsinline", "");
    v.style.cssText = "width:100%;height:100%;object-fit:contain;";
    wrap.appendChild(v);
    this.root?.appendChild(wrap);

    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      wrap.style.opacity = "0";
      setTimeout(() => wrap.remove(), 450);
    };
    v.onended = finish;
    v.onerror = finish;
    wrap.addEventListener("click", (e) => { e.stopPropagation(); finish(); }, { signal: this.ac.signal });
    setTimeout(finish, 6000);                                  // never trap the viewer
    // Sound where the browser allows it; this follows a click, so it usually does.
    v.play().catch(() => { v.muted = true; v.play().catch(finish); });
  }

  private hideLoader = (): void => {
    if (this.loader) this.loader.style.display = "none";
    if (this.pipBtn && this.player?.state?.canPictureInPicture) {
      this.pipBtn.dataset.ready = "1";
      if (this.mode === "full") this.pipBtn.style.display = "flex";
    }
  };

  private showPanel(title: string, detail: string, reportable = false): void {
    if (this.loader) this.loader.style.display = "none";
    const p = document.createElement("div");
    p.style.cssText = "position:absolute;inset:0;z-index:45;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;background:#000;color:#fff;font:600 15px/1.6 'Space Grotesk',sans-serif;text-align:center;padding:40px;";
    p.innerHTML = `<div>${title}<br><span style="color:#9aa5b5;font-weight:500;">${detail}</span></div>`;

    // One tap to tell us. A playback failure is the case where a written
    // description adds least and the console tail matters most, so the report
    // needs no typing at all.
    if (reportable) {
      const b = document.createElement("button");
      b.textContent = "This didn't play — tell us";
      b.style.cssText = "background:#c5f04e;border:none;color:#06070a;padding:10px 18px;border-radius:9px;font:800 13px 'Space Grotesk',sans-serif;cursor:pointer;";
      b.onclick = async () => {
        b.disabled = true;
        b.textContent = "Sending…";
        try {
          await reportPlaybackFailure({
            title: this.ch?.name,
            contentId: String(this.ch?.id || ""),
            provider: this.ch?.streams?.[this.idx]?.source,
            detail,
          });
          b.textContent = "Sent — thank you";
        } catch {
          b.disabled = false;
          b.textContent = "Couldn't send — retry";
        }
      };
      p.appendChild(b);
    }
    this.root?.appendChild(p);
  }

  private load(i: number): void {
    const s = this.ch.streams?.[i];
    if (!s?.url) { closeVodPlayer(); return; }
    this.idx = i;
    if (this.player) {
      this.player.title = this.titleFor(s);
      this.player.src = toSource(s.url);
    }
  }

  private wire(): void {
    const on = (type: string, fn: (e: any) => void) =>
      this.player.addEventListener(type, fn, { signal: this.ac.signal });

    // hls.js loads asynchronously, so e.detail.instance is still null at
    // provider-change. onInstance fires immediately if it already exists and
    // waits otherwise, so it is correct either way.
    on("provider-change", (e: any) => {
      const p = e.detail;
      if (p?.type !== "hls") return;
      p.onInstance((hls: any) => {
        hls.on("hlsError", (_ev: any, data: any) => {
          if (data?.fatal && data?.type === "networkError") {
            const cur = this.ch.streams?.[this.idx]?.url;
            if (cur && !(hls.url || "").includes("/proxy")) { hls.loadSource(proxied(cur)); hls.startLoad(); }
          }
        });
      });
    });

    // Hide the loader only once media can genuinely play. provider-change fires
    // before a byte is fetched, which made every failure look like a black screen.
    on("can-play", this.hideLoader);

    // Resume position, applied HERE and not at create().
    //
    // `currentTime` was passed to VidstackPlayer.create(), but an HLS source
    // loads asynchronously: at construction there is no seekable range yet, so
    // the value was discarded and every resume started the title from zero.
    // Continue Watching stored the right timecode all along and simply never
    // reached the media element.
    if (this.startTime > 1) {
      const seek = () => {
        const p = this.player;
        if (!p) return;
        // Guard against re-seeking a viewer who has already scrubbed: can-play
        // fires again after a seek and on some quality switches.
        if (this.resumed) return;
        this.resumed = true;
        if (Math.abs((p.currentTime ?? 0) - this.startTime) > 2) {
          p.currentTime = this.startTime;
        }
      };
      on("can-play", seek);
      on("loaded-metadata", seek);
    }
    on("playing", this.hideLoader);

    on("error", (e: any) => {
      console.error("[vodplayer] media error:", e?.detail ?? e);
      this.showPanel("This title didn't load.", "Try another title, or come back in a bit.", true);
    });

    on("time-update", () => {
      const t = this.player?.currentTime ?? 0;
      const d = this.player?.duration ?? 0;
      if (d > 0) {
        this.saveResume(t, d, (t / d) * 100);
        if (t / d > 0.9) markWatched(this.ch.streams?.[this.idx]?.id);
      }
    });

    // Host broadcasts on the events that actually change what others should see,
    // plus a heartbeat so drift self-corrects and a late joiner is never more
    // than five seconds stale.
    on("play", this.emitParty);
    on("pause", this.emitParty);
    on("seeked", this.emitParty);
    // Playback is actually running. A viewer prompted to tap because autoplay
    // was refused has no other signal that the refusal is over -- and without
    // one the prompt sat over a film that was already playing.
    on("playing", () => window.dispatchEvent(new CustomEvent("veedeeoh:party-playing")));
    const beat = setInterval(this.emitParty, 5000);
    this.ac.signal.addEventListener("abort", () => clearInterval(beat));

    on("ended", () => {
      markWatched(this.ch.streams?.[this.idx]?.id);
      if (this.idx + 1 < (this.ch.streams?.length || 0)) { this.load(this.idx + 1); return; }

      // In a party, closing the player drops everyone back on the catalogue
      // separately -- which for a viewer is indistinguishable from the party
      // ending, so people left rather than waited. Hold the player open and let
      // the party decide what to offer instead.
      if (partyEmit || document.body.classList.contains("party-viewer")) {
        window.dispatchEvent(new CustomEvent("veedeeoh:party-title-ended"));
        return;
      }
      closeVodPlayer();
    });
  }

  // Mirrors progress to BOTH stores. The localStorage write is what makes a
  // title appear in Continue Watching at all; the Supabase row only refines the
  // timecode of an entry that already exists locally.
  private saveResume(time: number, duration: number, pct: number): void {
    if (Date.now() - this.lastSave < 5000) return;
    this.lastSave = Date.now();

    const ch = this.ch;
    const itemId = String(ch.id || "").replace("vod:", "");
    const stream = ch.streams?.[this.idx];
    if (!stream) return;

    const key = resumeHistoryKey();
    let history: any[] = [];
    try { history = JSON.parse(localStorage.getItem(key) || "[]"); } catch { history = []; }
    history = history.filter((x: any) => x.itemId !== itemId);
    if (pct < 95) {
      history.unshift({
        id: stream.id || `vod:${itemId}:${this.idx}`,
        itemId,
        title: ch.name,
        episodeTitle: stream.source,
        poster: ch.vodPoster,
        banner: ch.vodBanner,
        // Kept so the kids gate can be re-applied when rendering the resume rail.
        maturity: ch.maturity ?? ch.vodItem?.maturity,
        genre: ch.genre ?? ch.vodItem?.genre,
        time,
        duration,
        percentage: pct,
        // Needed so the rail can order local and cloud entries against each
        // other. Without it a locally-watched title sorts as epoch zero and
        // sinks below everything synced from another device.
        updatedAt: new Date().toISOString(),
        streamIdx: this.idx,
        streams: ch.streams,
        vodItem: ch.vodItem,
      });
    }
    // Matches RESUME_RAIL_MAX in vod.ts. The local cache holding fewer than the
    // rail displays meant a title could drop off this device while still
    // showing on another.
    if (history.length > 20) history = history.slice(0, 20);
    try { localStorage.setItem(key, JSON.stringify(history)); } catch {}

    const pid = activeProfileUuid();
    if (pid) {
      void saveProgress(pid, {
        content_id: itemId,
        title: ch.name,
        position_secs: time,
        duration_secs: duration,
      }).catch(() => {});
    }
  }
}

// ---- Watch Party hooks ----------------------------------------------------
// Kept as a narrow surface so party.ts never reaches into the player: the host
// emits its position, a viewer applies one. Nothing else crosses the boundary.
export interface PartyPlaybackState {
  positionSecs: number;
  paused: boolean;
  /** Which entry in the channel's stream list -- the EPISODE, for a series.
   *  Absent from the payload originally, so a host binge-watching moved through
   *  a season on their own while every viewer stayed on the episode the party
   *  opened with, still receiving that episode's positions. */
  streamIdx?: number;
}
let partyEmit: ((s: PartyPlaybackState) => void) | null = null;
let applyingRemote = false;

/** Host side: called on play, pause, seek and every 5s while playing. */
export function setPartyEmitter(fn: ((s: PartyPlaybackState) => void) | null): void {
  partyEmit = fn;
}

/** Viewer side: reconcile against the host. Tolerates 2s of drift so ordinary
 *  buffering does not cause a seek storm, and suppresses the echo so applying a
 *  remote state never emits it straight back. */
// How far a viewer may drift before anything is done about it, and how far
// before a hard seek is the only option. Between the two, the correction is a
// playback-rate nudge.
const DRIFT_NUDGE_S = 0.6;
const DRIFT_SEEK_S = 6;

// Past this the host has not actually told us anything recently, so the
// extrapolated position is a guess rather than a fact and stops being used to
// justify a seek. Set above two viewer poll intervals on purpose: ordinary
// network jitter should be absorbed by a poll succeeding, not announced to the
// viewer as lost sync. Does not apply while the host is paused, since a paused
// host is silent deliberately and their position is not moving.
const STALE_MS = 22000;

/** Apply the host's playback state to a viewer.
 *
 *  The first version hard-assigned currentTime whenever drift exceeded two
 *  seconds. After any seek the media buffers, currentTime lags, and five
 *  seconds later the next heartbeat measured that lag as fresh drift and seeked
 *  again -- a correction loop that presents as stuttering and then freezing.
 *  It also swallowed a rejected play(), so a viewer whose browser blocked
 *  autoplay sat paused forever with nothing on screen explaining it and no way
 *  to recover.
 *
 *  Now: ignore drift while the player is already seeking; nudge small drift by
 *  varying playback rate, which is inaudible and self-correcting; hard-seek
 *  only when genuinely far out. A rejected play() surfaces to the UI instead of
 *  being discarded.
 */
// The host's last known state and when THIS device received it. Position is
// extrapolated from these rather than used verbatim.
let lastState: PartyPlaybackState | null = null;
let lastStateAt = 0;
let syncTicker: number | null = null;

/** Where the host is RIGHT NOW, not where they were when they last spoke.
 *
 *  The host emits every five seconds. Applying positionSecs verbatim aims at a
 *  moment that has already passed, so a viewer corrected mid-interval lands
 *  behind and stays there -- worst after a hard seek, where the gap that opens
 *  while the new position buffers survives until the next heartbeat.
 *
 *  Measured against the LOCAL receipt time, not the message's own timestamp:
 *  the worker's clock and the viewer's may differ by seconds, and only the
 *  elapsed interval matters, which the local clock gives exactly. */
function expectedPosition(): number | null {
  if (!lastState) return null;
  if (lastState.paused) return lastState.positionSecs;
  return lastState.positionSecs + (Date.now() - lastStateAt) / 1000;
}

/** @param ageMs how long ago the HOST reported this, per the server's clock.
 *  Non-zero for a state read out of storage -- on joining, on admission, or in
 *  answer to a poll. Treating a stored state as current is how a viewer who
 *  joined while the host was quiet started life behind and stayed there. */
export function applyPartyState(s: PartyPlaybackState, ageMs = 0): void {
  lastState = s;
  lastStateAt = Date.now() - Math.max(0, Math.min(ageMs, 6 * 60 * 60 * 1000));
  setStale(Date.now() - lastStateAt > STALE_MS && !s.paused);
  startSyncTicker();

  const p = current?.raw();
  if (!p) return;
  applyingRemote = true;
  try {
    // Episode first. Switching source resets currentTime, so reconciling
    // position against the OLD episode and then changing source would throw
    // that correction away -- and a position from a different episode is
    // meaningless anyway.
    if (typeof s.streamIdx === "number" && s.streamIdx !== current!.streamIndex()) {
      current!.switchTo(s.streamIdx, s.positionSecs);
      applyingRemote = false;
      return;
    }

    // A seek in flight has not landed yet, so its position means nothing.
    // Measuring against it is what produced the loop.
    if (!p.seeking) {
      const drift = (expectedPosition() ?? s.positionSecs) - (p.currentTime ?? 0);
      const mag = Math.abs(drift);

      if (mag > DRIFT_SEEK_S) {
        p.currentTime = expectedPosition() ?? s.positionSecs;
        p.playbackRate = 1;
      } else if (mag > DRIFT_NUDGE_S) {
        // +/-5% closes a couple of seconds over the next heartbeat without a
        // jump, and without the audible artefacts of a bigger rate change.
        p.playbackRate = 1 + Math.max(-0.05, Math.min(0.05, drift / 20));
      } else if (p.playbackRate !== 1) {
        p.playbackRate = 1;
      }
    }

    if (s.paused && !p.paused) {
      p.pause();
    } else if (!s.paused && p.paused) {
      const r = p.play();
      // Autoplay policy blocks playback that no gesture asked for. Silently
      // ignoring the rejection is what left a viewer stuck and confused.
      if (r?.catch) {
        r.catch(() => {
          window.dispatchEvent(new CustomEvent("veedeeoh:party-blocked"));
        });
      }
    }
  } catch { /* player torn down mid-apply */ }
  applyingRemote = false;
}

/** Correct between heartbeats instead of only when one arrives.
 *
 *  A viewer that only reconciles on receipt keeps whatever gap it had for the
 *  full five seconds, which is exactly the window a seek opens. Once a second
 *  is frequent enough to close a gap quickly and far too cheap to matter -- it
 *  is local arithmetic and a playback-rate tweak, no network at all. */
function startSyncTicker(): void {
  if (syncTicker !== null) return;
  syncTicker = window.setInterval(() => {
    const p = current?.raw();
    const want = expectedPosition();
    if (!p || want === null || lastState?.paused) { setStale(false); return; }

    // Nothing from the host in a while. Keep playing -- stopping the film
    // because a message is late is worse than being a few seconds out -- but
    // stop correcting against a position nobody has confirmed. Seeking to a
    // guess is how a viewer ends up somewhere the host never was.
    if (Date.now() - lastStateAt > STALE_MS) {
      setStale(true);
      if (p.playbackRate !== 1) p.playbackRate = 1;
      return;
    }
    setStale(false);
    if (p.paused || p.seeking) return;

    const drift = want - (p.currentTime ?? 0);
    const mag = Math.abs(drift);
    if (mag > DRIFT_SEEK_S) { p.currentTime = want; p.playbackRate = 1; }
    else if (mag > DRIFT_NUDGE_S) p.playbackRate = 1 + Math.max(-0.05, Math.min(0.05, drift / 20));
    else if (p.playbackRate !== 1) p.playbackRate = 1;
  }, 1000);
}

export function stopPartySync(): void {
  if (syncTicker !== null) { clearInterval(syncTicker); syncTicker = null; }
  setStale(false);
  lastState = null;
  lastStateAt = 0;
}

/** Announced rather than acted on here: the player knows the sync has gone
 *  quiet, but what to show a viewer about it belongs to the party UI. Edge
 *  triggered, so it is not shouting once a second. */
let staleNow = false;
function setStale(on: boolean): void {
  if (on === staleNow) return;
  staleNow = on;
  window.dispatchEvent(new CustomEvent("veedeeoh:party-stale", { detail: { stale: on } }));
}

/** How long since the host last actually reported, in seconds. Null when there
 *  is no party state at all. */
export function hostStateAgeSecs(): number | null {
  return lastStateAt ? (Date.now() - lastStateAt) / 1000 : null;
}

/** Resume playback that a backgrounded browser paused.
 *
 *  Called when a host's tab becomes visible again. Without it the host returns
 *  paused and their next heartbeat stops the whole room -- the same problem the
 *  away signal exists to prevent, just one beat later. Does nothing if the host
 *  paused on purpose before leaving, because then they are already paused and
 *  playing for them would be the surprise. */
export function resumeIfBackgroundPaused(): void {
  const p = current?.raw();
  if (p?.paused) void p.play?.()?.catch?.(() => {});
}

/** Put the player into viewer mode: the host drives, so transport controls
 *  would only let a viewer desync themselves with no way back. Volume,
 *  captions and fullscreen stay -- those are personal, not shared. */
export function setPartyViewerMode(on: boolean): void {
  const root = current?.rootEl();
  if (root) root.classList.toggle("party-viewer", on);
  document.body.classList.toggle("party-viewer", on);
}

/** Jump straight to the host's position and resume. The escape hatch for a
 *  viewer who has drifted or been blocked, which previously did not exist. */
export function resyncToHost(s: PartyPlaybackState): void {
  const p = current?.raw();
  if (!p) return;
  try {
    p.currentTime = s.positionSecs;
    p.playbackRate = 1;
    if (!s.paused) void p.play()?.catch?.(() => {});
  } catch { /* torn down */ }
}

let current: VodPlayer | null = null;
let openToken = 0;

export function closeVodPlayer(): void {
  current?.destroy();
  current = null;
  const overlay = document.getElementById("vodPlayerOverlay");
  if (overlay) {
    overlay.setAttribute("hidden", "");
    overlay.style.cssText = FULL_CSS;
  }
}

/** Set by the party code while a viewer is following someone else's playback.
 *
 *  A free account may watch inside a party -- that is the whole of what the
 *  free tier is -- so the entitlement check below has to know the difference
 *  between pressing play and being shown something. Party paths open the same
 *  player, so without this flag joining a party would be refused by the gate
 *  that exists to sell the party. */
let partyPlayback = false;
export function setPartyPlayback(on: boolean): void { partyPlayback = on; }

export async function openVodPlayer(ch: any, streamIdx: number, startTime = 0): Promise<void> {
  const overlay = document.getElementById("vodPlayerOverlay");
  if (!overlay) return;

  // THE ONE ENFORCEMENT POINT. Fifteen call sites reach this function -- cards,
  // the detail view, resume, search, episode lists, deep links -- and checking
  // at any of them would mean checking at all of them, forever, including the
  // ones added next year. The card overlay explains the block; this is the
  // block.
  if (!partyPlayback) {
    try {
      const { hasActiveAccess } = await import("./db");
      if (!(await hasActiveAccess())) {
        const { showPlaybackLocked } = await import("./party-setup");
        showPlaybackLocked(ch?.title || ch?.name || "");
        return;
      }
    } catch { /* the check itself failing must not stop a paying customer */ }
  }

  const token = ++openToken;

  // Tear the previous instance down completely before building the next one.
  current?.destroy();
  current = null;

  overlay.removeAttribute("hidden");
  overlay.style.cssText = FULL_CSS;

  const inst = new VodPlayer(overlay, ch, streamIdx, startTime, token);
  // Published BEFORE the await so an open that starts during mount can destroy
  // this one; mount() re-checks and a late create() destroys itself.
  current = inst;
  await inst.mount();

  if (token !== openToken) {
    inst.destroy();
    if (current === inst) current = null;
  }
}
