import Hls from "hls.js";
import { openInVlc, toggleFavorite } from "./api";
import { chMeta, state } from "./state";
import type { Channel } from "./types";
import { $ } from "./util";

let hls: Hls | null = null;

export function openPlayer(ch: Channel, streamIdx = 0): void {
  state.current = ch;
  $("playerOverlay").hidden = false;
  $("pName").textContent = ch.name;
  $("pMeta").textContent = chMeta(ch);
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
  status.textContent = "Loading stream…";
  const src = `/proxy?url=${encodeURIComponent(url)}`;
  if (Hls.isSupported()) {
    hls = new Hls({ maxBufferLength: 15 });
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
    if (e.key === "Escape" && !$("playerOverlay").hidden) closePlayer();
  });

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
