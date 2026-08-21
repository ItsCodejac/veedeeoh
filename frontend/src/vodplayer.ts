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

// Pluto's CDN answers with `access-control-allow-origin: http://pluto.tv`, so a
// browser can never read its manifests cross-origin no matter how fresh the token
// is. hls.js fetches manifests over XHR, so every Pluto title fails the CORS check
// on a direct load. Route Pluto through /proxy up front rather than waiting for an
// error to trigger a fallback. Tubi (allow-origin: *) and Archive (progressive mp4)
// are unaffected and stay on the direct CDN path.
const playable = (u: string) => (/(^|\.)pluto\.tv\//.test(u) ? proxied(u) : u);

// Continue Watching is stored PER PROFILE so a kids profile never sees an adult
// profile's resume cards. This key must match the one vod.ts reads to render the rail.
function resumeHistoryKey(): string {
  let id = "default";
  try { id = getActiveProfile()?.id || "default"; } catch {}
  return `tvlc_resume_history_${id}`;
}

// Mirror progress to BOTH stores. The localStorage write is what makes a title
// appear in Continue Watching at all; the Supabase row only refines the timecode
// of an entry that already exists locally. Dropping the local write empties the rail.
function saveResume(ch: any, idx: number, time: number, duration: number, pct: number): void {
  if (Date.now() - lastSave < 5000) return; // limit to every 5s
  lastSave = Date.now();
  const itemId = String(ch.id || "").replace("vod:", "");
  const stream = ch.streams?.[idx];
  if (!stream) return;

  const key = resumeHistoryKey();
  let history: any[] = [];
  try { history = JSON.parse(localStorage.getItem(key) || "[]"); } catch { history = []; }
  history = history.filter((x: any) => x.itemId !== itemId);
  if (pct < 95) {
    history.unshift({
      id: stream.id || `vod:${itemId}:${idx}`,
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
      streamIdx: idx,
      streams: ch.streams,
      vodItem: ch.vodItem,
    });
  }
  if (history.length > 15) history = history.slice(0, 15);
  try { localStorage.setItem(key, JSON.stringify(history)); } catch {}

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

  // Teardown previous player instance
  if (player) {
    try { player.destroy(); } catch {}
    player = null;
  }

  // First open: hide the legacy hand-rolled chrome and mount Vidstack full-bleed.
  let mount = document.getElementById("vodPlayerMount");
  if (!mount && overlay) {
    Array.from(overlay.children).forEach((c) => { (c as HTMLElement).style.display = "none"; });
    mount = document.createElement("div");
    mount.id = "vodPlayerMount";
    mount.style.cssText = "position:absolute;inset:0;width:100%;height:100%;background:#000;";
    overlay.appendChild(mount);

    // Minimize button
    const backBtn = document.createElement("button");
    backBtn.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>`;
    backBtn.setAttribute("aria-label", "Minimize player");
    backBtn.style.cssText = "position:absolute;top:20px;left:20px;z-index:60;display:flex;align-items:center;justify-content:center;width:40px;height:40px;border-radius:50%;border:none;background:rgba(0,0,0,0.55);color:#fff;cursor:pointer;";
    backBtn.onclick = (e) => {
      e.stopPropagation();
      overlay?.classList.add("mini-player");
    };
    overlay.appendChild(backBtn);

    // Close button (for PiP mode)
    const closeBtn = document.createElement("button");
    closeBtn.id = "vodPiPCloseBtn";
    closeBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;
    closeBtn.setAttribute("aria-label", "Close player");
    closeBtn.style.cssText = "position:absolute;top:8px;right:8px;z-index:70;display:none;align-items:center;justify-content:center;width:32px;height:32px;border-radius:50%;border:none;background:#222;color:#fff;cursor:pointer;box-shadow:0 2px 10px rgba(0,0,0,0.5);";
    closeBtn.onclick = (e) => {
      e.stopPropagation();
      closeVodPlayer();
    };
    overlay.appendChild(closeBtn);

    // Dynamic styling for PiP close button
    const style = document.createElement("style");
    style.innerHTML = `
      #vodPlayerOverlay.mini-player #vodPiPCloseBtn { display: flex !important; }
      #vodPlayerOverlay.mini-player:hover { cursor: pointer; transform: scale(1.02); transition: transform 0.2s; }
    `;
    overlay.appendChild(style);

    // Restore from PiP when clicking the mini-player
    overlay.addEventListener("click", () => {
      if (overlay.classList.contains("mini-player")) {
        overlay.classList.remove("mini-player");
      }
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && overlay && !overlay.hasAttribute("hidden") && !document.fullscreenElement) closeVodPlayer();
    });
  }
  
  if (mount) mount.innerHTML = "";

  let idx = streamIdx;
  const first = ch.streams?.[idx];
  // No playable stream
  if (!first || !first.url) {
    if (mount) {
      mount.innerHTML = `<div style="color:#fff;font:600 15px/1.6 'Space Grotesk',sans-serif;padding:40px;max-width:420px;margin:auto;text-align:center;">This title isn't available to stream right now.<br><span style="color:#9aa5b5;font-weight:500;">Try another title — most of the catalog plays instantly.</span></div>`;
    }
    return;
  }

  // Create Brand Loader (Bouncing Ball)
  const loader = document.createElement("div");
  loader.style.cssText = "position:absolute;inset:0;display:flex;align-items:center;justify-content:center;z-index:40;background:#000;";
  loader.innerHTML = `
    <div style="display: flex; align-items: flex-end; gap: 10px; height: 40px">
      <div style="width: 14px; height: 14px; border-radius: 50%; background: #C6F53A; animation: vdBounce 0.72s ease-in-out infinite"></div>
      <div style="width: 14px; height: 14px; border-radius: 50%; background: #7E8792; animation: vdBounce 0.72s ease-in-out infinite; animation-delay: 0.1s"></div>
      <div style="width: 14px; height: 14px; border-radius: 50%; background: #4A5058; animation: vdBounce 0.72s ease-in-out infinite; animation-delay: 0.2s"></div>
    </div>
    <style>@keyframes vdBounce { 0%, 100% { transform: translateY(0) scale(1.14, 0.86); } 45% { transform: translateY(-22px) scale(0.92, 1.08); } }</style>
  `;
  mount!.appendChild(loader);

  // Player Container
  const playerContainer = document.createElement("div");
  playerContainer.style.cssText = "width:100%;height:100%;opacity:1;transition:opacity 0.3s ease;";
  mount!.appendChild(playerContainer);

  const load = (i: number) => {
    idx = i;
    const s = ch.streams?.[i];
    if (!s) { closeVodPlayer(); return; }
    if (player) {
      player.title = s.source ? `${ch.name} · ${s.source}` : ch.name;
      player.src = playable(s.url);
    }
  };

  try {
    player = await VidstackPlayer.create({
      target: playerContainer,
      title: first.source ? `${ch.name} · ${first.source}` : ch.name,
      src: playable(first.url),
      autoplay: true,
      currentTime: startTime,
      layout: new VidstackPlayerLayout(),
    });
    
    // Hide Vidstack's default loading spinner to use our custom one
    const style = document.createElement("style");
    style.innerHTML = `media-spinner { display: none !important; }`;
    playerContainer.appendChild(style);

  } catch (e: any) {
    console.error("[vodplayer] VidstackPlayer.create failed:", e);
    const msg = (e && (e.message || String(e))) || "Unknown error";
    mount!.innerHTML = `<div style="color:#fff;font:600 15px/1.5 sans-serif;padding:32px;max-width:520px">Player failed to load.<br><span style="color:#ff8a8a">${msg}</span></div>`;
    return;
  }
  
  try {
    const el = player as HTMLElement;
    el.style.width = "100%"; el.style.height = "100%";
    el.style.setProperty("--media-brand", BRAND);
    (player as any).fullscreenOrientation = "landscape";
    setTimeout(() => el.focus(), 100);
  } catch {}

  // hls.js is fetched asynchronously, so `p.instance` is still null when
  // provider-change fires — guarding on it silently skipped the /proxy fallback
  // entirely. onInstance fires immediately if the instance already exists and
  // waits for it otherwise, so it is correct regardless of load timing.
  player.addEventListener("provider-change", (e: any) => {
    const p = e.detail;
    if (p?.type !== "hls") return;
    p.onInstance((hls: any) => {
      hls.on("hlsError", (_ev: any, data: any) => {
        if (data?.fatal && data?.type === "networkError") {
          const cur = ch.streams?.[idx]?.url;
          if (cur && !(hls.url || "").includes("/proxy")) { hls.loadSource(proxied(cur)); hls.startLoad(); }
        }
      });
    });
  });

  // Hide the loader only once media can actually play. provider-change fires
  // before a single byte is fetched, so hiding there made every load failure
  // look like a working player in front of a black screen.
  const hideLoader = () => { loader.style.display = "none"; };
  player.addEventListener("can-play", hideLoader);
  player.addEventListener("playing", hideLoader);

  // Never fail silently. Without this a 401 or a CORS rejection is invisible.
  player.addEventListener("error", (e: any) => {
    console.error("[vodplayer] media error:", e?.detail ?? e);
    hideLoader();
    const err = document.createElement("div");
    err.style.cssText = "position:absolute;inset:0;z-index:45;display:flex;align-items:center;justify-content:center;background:#000;color:#fff;font:600 15px/1.6 'Space Grotesk',sans-serif;text-align:center;padding:40px;";
    err.innerHTML = `<div>This title didn't load.<br><span style="color:#9aa5b5;font-weight:500;">Try another title, or come back in a bit.</span></div>`;
    mount!.appendChild(err);
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
