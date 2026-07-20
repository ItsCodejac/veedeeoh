import Hls from "hls.js";
import { openInVlc, toggleFavorite } from "./api";
import { chMeta, state } from "./state";
import type { Channel } from "./types";
import { $, fmtTime } from "./util";

let hls: Hls | null = null;

// ---- live captions: off -> original language -> translate to English ----
type CcMode = "off" | "cc" | "en";
let ccMode: CcMode = "off";
let ccSocket: WebSocket | null = null;
let ccUrl: string | null = null;

function ccLabel(): string {
  return ccMode === "off" ? "CC" : ccMode === "cc" ? "CC ●" : "CC→EN ●";
}

function cycleCc(): void {
  ccMode = ccMode === "off" ? "cc" : ccMode === "cc" ? "en" : "off";
  $("pCc").textContent = ccLabel();
  $("pCc").classList.toggle("on", ccMode !== "off");
  startCaptions();
}

function stopCaptions(): void {
  ccSocket?.close();
  ccSocket = null;
  const box = $("pCaptions");
  box.hidden = true;
  box.textContent = "";
}

function startCaptions(): void {
  stopCaptions();
  if (ccMode === "off" || !ccUrl) return;
  const box = $("pCaptions");
  box.hidden = false;
  box.textContent = "· · ·";
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(
    `${proto}://${location.host}/ws/captions?url=${encodeURIComponent(ccUrl)}` +
      (ccMode === "en" ? "&translate=true" : "")
  );
  ccSocket = ws;
  const lines: string[] = [];
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data) as { text?: string; error?: string; status?: string };
    if (msg.status) {
      box.textContent = "· · · (loading speech model)";
    } else if (msg.error) {
      box.textContent = `⚠ ${msg.error}`;
    } else if (msg.text) {
      lines.push(msg.text);
      while (lines.length > 2) lines.shift();
      box.textContent = lines.join(" ");
    }
  };
  ws.onerror = () => {
    if (ccSocket === ws) box.textContent = "⚠ caption connection failed";
  };
}

// The list we zap through with prev/next — whatever context the channel was
// opened from (a rail's collection, search results, a filtered grid).
let zapContext: Channel[] = [];

function neighbors(ch: Channel): { prev: Channel | null; next: Channel | null } {
  const pool = zapContext.length > 1 ? zapContext : [];
  const idx = pool.findIndex((c) => c.id === ch.id);
  if (idx === -1) return { prev: null, next: null };
  return {
    prev: pool[(idx - 1 + pool.length) % pool.length] ?? null,
    next: pool[(idx + 1) % pool.length] ?? null,
  };
}

function updateZapButtons(ch: Channel): void {
  const { prev, next } = neighbors(ch);
  const prevBtn = $<HTMLButtonElement>("pPrev");
  const nextBtn = $<HTMLButtonElement>("pNext");
  prevBtn.hidden = !prev;
  nextBtn.hidden = !next;
  if (prev) prevBtn.querySelector(".zapName")!.textContent = prev.name;
  if (next) nextBtn.querySelector(".zapName")!.textContent = next.name;
}

function zap(dir: -1 | 1): void {
  if (!state.current) return;
  const { prev, next } = neighbors(state.current);
  const target = dir === -1 ? prev : next;
  if (target) openPlayer(target, 0, zapContext);
}

export function openPlayer(ch: Channel, streamIdx = 0, context?: Channel[]): void {
  if (context) zapContext = context;
  else if (!zapContext.some((c) => c.id === ch.id)) zapContext = [];
  state.current = ch;
  updateZapButtons(ch);
  $("playerOverlay").hidden = false;
  $("pName").textContent = ch.name;
  const entry = state.epg.get(ch.id);
  const guide = [
    entry?.now && `▸ ${entry.now.title} · until ${fmtTime(entry.now.stop)}`,
    entry?.next && `then ${entry.next.title} at ${fmtTime(entry.next.start)}`,
  ].filter(Boolean).join("  ·  ");
  $("pMeta").textContent = guide ? `${chMeta(ch)}  —  ${guide}` : chMeta(ch);
  const logo = $<HTMLImageElement>("pLogo");
  logo.src = ch.logo || "";
  logo.hidden = !ch.logo;
  logo.onerror = () => (logo.hidden = true);
  $("pFav").classList.toggle("on", state.favorites.has(ch.id));

  const sel = $<HTMLSelectElement>("pStreams");
  sel.hidden = ch.streams.length < 2;
  if (ch.streams.length > 1) {
    sel.replaceChildren(...ch.streams.map((s, i) => {
      const label = [s.source || "stream", s.quality].filter(Boolean).join(" · ");
      return new Option(`${i + 1}. ${label}`, String(i));
    }));
    sel.value = String(streamIdx);
  }
  play(ch.streams[streamIdx]!.url);
}

function play(url: string): void {
  const video = $<HTMLVideoElement>("video");
  const status = $("pStatus");
  stopPlayback();
  ccUrl = url;
  startCaptions();
  status.textContent = "Loading stream…";
  const src = `/proxy?url=${encodeURIComponent(url)}`;
  // direct files (VOD mp4/webm/ogv) play natively; HLS goes through hls.js
  if (/\.(mp4|m4v|webm|ogv)(\?|$)/i.test(url)) {
    video.src = src;
    video.onloadeddata = () => (status.textContent = "");
    video.onerror = () => (status.textContent = "⚠ Playback failed — try Open in VLC.");
  } else if (Hls.isSupported()) {
    // generous timeouts: ad-stitched FAST streams can take 20s+ to start
    hls = new Hls({
      maxBufferLength: 15,
      manifestLoadingTimeOut: 30000,
      levelLoadingTimeOut: 30000,
      fragLoadingTimeOut: 30000,
    });
    hls.loadSource(src);
    hls.attachMedia(video);
    hls.on(Hls.Events.MANIFEST_PARSED, () => (status.textContent = ""));
    hls.on(Hls.Events.ERROR, (_evt, data) => {
      if (data.fatal) {
        status.textContent = "⚠ Preview failed (codec or geo-block?) — try Open in VLC.";
        hls?.destroy();
        hls = null;
      }
    });
  } else {
    video.src = src;
    video.onerror = () => (status.textContent = "⚠ Preview failed — try Open in VLC.");
  }
}

function stopPlayback(): void {
  const video = $<HTMLVideoElement>("video");
  hls?.destroy();
  hls = null;
  stopCaptions();
  ccUrl = null;
  video.pause();
  video.removeAttribute("src");
  video.load();
}

export function closePlayer(): void {
  stopPlayback();
  $("playerOverlay").hidden = true;
  state.current = null;
}

export function wirePlayer(): void {
  $("pClose").addEventListener("click", closePlayer);
  $("playerOverlay").addEventListener("click", (e) => {
    if (e.target === $("playerOverlay")) closePlayer();
  });
  document.addEventListener("keydown", (e) => {
    if ($("playerOverlay").hidden) return;
    if (e.key === "Escape") closePlayer();
    else if (e.key === "ArrowLeft") zap(-1);
    else if (e.key === "ArrowRight") zap(1);
  });

  $("pPrev").addEventListener("click", () => zap(-1));
  $("pNext").addEventListener("click", () => zap(1));

  $<HTMLSelectElement>("pStreams").addEventListener("change", (e) => {
    const idx = Number((e.target as HTMLSelectElement).value);
    if (state.current) play(state.current.streams[idx]!.url);
  });

  $("pVlc").addEventListener("click", () => {
    const ch = state.current;
    if (!ch) return;
    const sel = $<HTMLSelectElement>("pStreams");
    const idx = sel.hidden ? 0 : Number(sel.value);
    void openInVlc(ch.streams[idx]!.url);
    $("pStatus").textContent = "Sent to VLC 📡";
  });

  $("pCc").addEventListener("click", cycleCc);

  $("pFav").addEventListener("click", async (e) => {
    const ch = state.current;
    if (!ch) return;
    const on = await toggleFavorite(ch);
    (e.target as HTMLElement).classList.toggle("on", on);
    document
      .querySelector(`.card[data-id="${CSS.escape(ch.id)}"] .star`)
      ?.classList.toggle("on", on);
  });
}
