// Vidstack-based VOD player. Replaces the hand-rolled controller — brings mobile
// gestures (tap-to-toggle, double-tap seek), auto-hiding controls, proper
// fullscreen + landscape orientation, captions, keyboard, and PiP for free.
//
// Self-contained on purpose: imports only from state/api/db/profiles (never
// vod.ts) so there's no circular dependency. Preserves the app behaviors:
// direct-CDN-first streaming with /proxy fallback, resume, per-profile progress
// + "Continue Watching" localStorage, watched-marking, and next-episode advance.

import { VidstackPlayer, VidstackPlayerLayout } from "vidstack/global/player";
import "vidstack/player/styles/default/theme.css";
import "vidstack/player/styles/default/layouts/video.css";
import { state } from "./state";
import { toggleWatched } from "./api";
import { saveProgress } from "./db";
import { getActiveProfile } from "./profiles";

const BRAND = "#c5f04e";
let player: any = null;
let lastSave = 0;

function activeProfileUuid(): string | null {
  const id = getActiveProfile().id;
  return id && !id.startsWith("default_") && !id.startsWith("profile_") ? id : null;
}

const proxied = (u: string) => `/proxy?url=${encodeURIComponent(u)}`;

// Mirror the resume-history shape the home "Continue Watching" rail reads, and
// mirror per-profile progress to Supabase for cross-device resume.
function saveResume(ch: any, idx: number, time: number, duration: number, pct: number): void {
  if (Date.now() - lastSave < 3000) return;
  lastSave = Date.now();
  const itemId = String(ch.id || "").replace("vod:", "");
  const stream = ch.streams?.[idx];
  if (!stream) return;

  let history: any[] = [];
  try { history = JSON.parse(localStorage.getItem("tvlc_resume_history") || "[]"); } catch {}
  history = history.filter((x: any) => x.itemId !== itemId);
  if (pct < 95) {
    history.unshift({
      id: stream.id || `vod:${itemId}:${idx}`, itemId, title: ch.name,
      episodeTitle: stream.source, poster: ch.vodPoster, banner: ch.vodBanner,
      time, duration, percentage: pct, streamIdx: idx, streams: ch.streams, vodItem: ch.vodItem,
    });
  }
  if (history.length > 15) history = history.slice(0, 15);
  localStorage.setItem("tvlc_resume_history", JSON.stringify(history));

  const pid = activeProfileUuid();
  if (pid) {
    void saveProgress(pid, { content_id: itemId, title: ch.name, position_secs: time, duration_secs: duration }).catch(() => {});
  }
}

function markWatched(epId?: string): void {
  if (epId && !state.watched.has(epId)) {
    state.watched.add(epId);
    document.querySelector(`.episodeCard[data-ep-id="${CSS.escape(epId)}"]`)?.classList.add("watched");
    void toggleWatched(epId, true);
  }
}

export function closeVodPlayer(): void {
  const overlay = document.getElementById("vodPlayerOverlay");
  if (player) { try { player.pause(); } catch {} }
  if (overlay) { overlay.setAttribute("hidden", ""); overlay.classList.remove("mini-player"); }
}

export async function openVodPlayer(ch: any, streamIdx: number, startTime = 0): Promise<void> {
  const overlay = document.getElementById("vodPlayerOverlay");
  if (overlay) {
    overlay.removeAttribute("hidden");
    overlay.classList.remove("mini-player");
    // Force a visible full-screen container regardless of legacy overlay CSS so
    // the mounted <media-player> can never collapse to zero size.
    overlay.style.cssText = "position:fixed;inset:0;z-index:9998;display:block;background:#000;";
  }

  // First open: hide the legacy hand-rolled chrome and mount Vidstack full-bleed.
  let mount = document.getElementById("vodPlayerMount");
  if (!mount && overlay) {
    Array.from(overlay.children).forEach((c) => { (c as HTMLElement).style.display = "none"; });
    mount = document.createElement("div");
    mount.id = "vodPlayerMount";
    mount.style.cssText = "position:absolute;inset:0;width:100%;height:100%;background:#000;";
    overlay.appendChild(mount);

    const close = document.createElement("button");
    close.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;
    close.setAttribute("aria-label", "Close player");
    close.style.cssText = "position:absolute;top:14px;left:14px;z-index:60;display:flex;align-items:center;justify-content:center;width:40px;height:40px;border-radius:50%;border:none;background:rgba(0,0,0,0.55);color:#fff;cursor:pointer;";
    close.onclick = () => closeVodPlayer();
    overlay.appendChild(close);

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && overlay && !overlay.hasAttribute("hidden") && !document.fullscreenElement) closeVodPlayer();
    });
  }
  if (!mount) return;

  let idx = streamIdx;
  const first = ch.streams?.[idx];
  // No playable stream → show a clear message instead of handing Vidstack an
  // undefined src (which surfaced as "Player failed to load undefined").
  if (!first || !first.url) {
    if (mount) {
      mount.innerHTML = `<div style="color:#fff;font:600 15px/1.6 'Space Grotesk',sans-serif;padding:40px;max-width:420px;margin:auto;text-align:center;">This title isn't available to stream right now.<br><span style="color:#9aa5b5;font-weight:500;">Try another title — most of the catalog plays instantly.</span></div>`;
    }
    return;
  }

  const load = (i: number) => {
    idx = i;
    const s = ch.streams?.[i];
    if (!s) { closeVodPlayer(); return; }
    player.title = s.source ? `${ch.name} · ${s.source}` : ch.name;
    player.src = s.url; // direct CDN first; hls error handler falls back to /proxy
  };

  if (!player) {
    try {
      // NOTE: do NOT pass `poster` here. Vidstack lazy-imports its poster element
      // chunk only when a poster is set, and Vite's re-bundle of that chunk can
      // make the expected export undefined → create() throws "undefined has no
      // properties" (only for titles that HAVE a poster — the intermittent bug).
      // The poster is cosmetic; the hero/card art already covers it.
      player = await VidstackPlayer.create({
        target: mount,
        title: ch.name,
        src: first.url,
        layout: new VidstackPlayerLayout(),
      });
    } catch (e: any) {
      console.error("[vodplayer] VidstackPlayer.create failed:", e);
      const msg = (e && (e.message || String(e))) || "Unknown error";
      mount.innerHTML = `<div style="color:#fff;font:600 15px/1.5 sans-serif;padding:32px;max-width:520px">Player failed to load.<br><span style="color:#ff8a8a">${msg}</span></div>`;
      return;
    }
    try {
      const el = player as HTMLElement;
      el.style.width = "100%"; el.style.height = "100%";
      el.style.setProperty("--media-brand", BRAND);
      (player as any).fullscreenOrientation = "landscape";
    } catch {}

    // Direct-CDN → /proxy fallback on a fatal network error (keeps streaming
    // client-side / zero-Vercel-bandwidth whenever the CDN allows CORS).
    player.addEventListener("provider-setup", (e: any) => {
      const p = e.detail;
      if (p?.type === "hls" && p.instance) {
        const hls = p.instance;
        hls.on("hlsError", (_ev: any, data: any) => {
          if (data?.fatal && data?.type === "networkError") {
            const cur = ch.streams?.[idx]?.url;
            if (cur && !(hls.url || "").includes("/proxy")) { hls.loadSource(proxied(cur)); hls.startLoad(); }
          }
        });
      }
    });

    player.addEventListener("time-update", () => {
      const t = player.currentTime, d = player.duration;
      if (d > 0) {
        saveResume(ch, idx, t, d, (t / d) * 100);
        if (t / d > 0.9) markWatched(ch.streams?.[idx]?.id);
      }
    });

    player.addEventListener("ended", () => {
      markWatched(ch.streams?.[idx]?.id);
      if (idx + 1 < (ch.streams?.length || 0)) load(idx + 1);
      else closeVodPlayer();
    });
  }

  load(idx);

  if (startTime > 0) {
    const seek = () => { try { player.currentTime = startTime; } catch {} };
    player.addEventListener("can-play", seek, { once: true });
  }
  try { await player.play(); } catch {}
}
