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

const BRAND = "#c5f04e";

const FULL_CSS = "position:fixed;inset:0;z-index:9998;display:block;background:#000;";
const MINI_CSS =
  "position:fixed;inset:auto 24px 24px auto;width:22rem;max-width:44vw;aspect-ratio:16/9;" +
  "z-index:9998;display:block;background:#000;border-radius:14px;overflow:hidden;cursor:pointer;" +
  "box-shadow:0 18px 50px rgba(0,0,0,0.6);border:1px solid rgba(197,240,78,0.5);";

const proxied = (u: string) => `/proxy?url=${encodeURIComponent(u)}`;

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
      this.showPanel("This title isn't available to stream right now.", "Try another title — most of the catalog plays instantly.");
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
    this.style();
    this.wire();
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
    const shield = q("shield");
    if (shield) shield.style.display = mini ? "block" : "none";
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

    // In mini mode a transparent shield sits over the video and swallows the
    // click. Without it the restore click also reached Vidstack, which toggled
    // pause -- so restoring the player paused it and you had to click again.
    const shield = document.createElement("div");
    shield.dataset.role = "shield";
    shield.style.cssText = "position:absolute;inset:0;z-index:55;display:none;cursor:pointer;";
    shield.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();
      this.setMode("full");
    }, { signal: this.ac.signal });
    root.appendChild(shield);

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
    } catch {}
  }

  private hideLoader = (): void => {
    if (this.loader) this.loader.style.display = "none";
    if (this.pipBtn && this.player?.state?.canPictureInPicture) {
      this.pipBtn.dataset.ready = "1";
      if (this.mode === "full") this.pipBtn.style.display = "flex";
    }
  };

  private showPanel(title: string, detail: string): void {
    if (this.loader) this.loader.style.display = "none";
    const p = document.createElement("div");
    p.style.cssText = "position:absolute;inset:0;z-index:45;display:flex;align-items:center;justify-content:center;background:#000;color:#fff;font:600 15px/1.6 'Space Grotesk',sans-serif;text-align:center;padding:40px;";
    p.innerHTML = `<div>${title}<br><span style="color:#9aa5b5;font-weight:500;">${detail}</span></div>`;
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
    on("playing", this.hideLoader);

    on("error", (e: any) => {
      console.error("[vodplayer] media error:", e?.detail ?? e);
      this.showPanel("This title didn't load.", "Try another title, or come back in a bit.");
    });

    on("time-update", () => {
      const t = this.player?.currentTime ?? 0;
      const d = this.player?.duration ?? 0;
      if (d > 0) {
        this.saveResume(t, d, (t / d) * 100);
        if (t / d > 0.9) markWatched(this.ch.streams?.[this.idx]?.id);
      }
    });

    on("ended", () => {
      markWatched(this.ch.streams?.[this.idx]?.id);
      if (this.idx + 1 < (this.ch.streams?.length || 0)) this.load(this.idx + 1);
      else closeVodPlayer();
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
        streamIdx: this.idx,
        streams: ch.streams,
        vodItem: ch.vodItem,
      });
    }
    if (history.length > 15) history = history.slice(0, 15);
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

export async function openVodPlayer(ch: any, streamIdx: number, startTime = 0): Promise<void> {
  const overlay = document.getElementById("vodPlayerOverlay");
  if (!overlay) return;

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
