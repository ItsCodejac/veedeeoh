import Hls from "hls.js";
import { toggleFavorite } from "./api";
import { watchCard } from "./health";
import { openPlayer } from "./player";
import { chMeta, isDead, onNow, state } from "./state";
import type { Channel } from "./types";
import { escapeHtml, fmtTime } from "./util";

export function card(ch: Channel, context?: Channel[]): HTMLElement {
  const el = document.createElement("div");
  el.className = "card";
  el.dataset.id = ch.id;
  const health = ch.streams[0] ? state.health.get(ch.streams[0].url) : undefined;
  if (isDead(ch)) el.classList.add("dead");

  el.innerHTML = `
    <div class="dot ${health === true ? "alive" : health === false ? "dead" : ""}"></div>
    <button class="star ${state.favorites.has(ch.id) ? "on" : ""}" title="Favorite">★</button>
    <div class="logoBox"></div>
    <div class="cname">${escapeHtml(ch.name)}</div>
    <div class="cnow" hidden><span class="cnowTitle"></span><span class="cprog"><i></i></span></div>
    <div class="cmeta">${escapeHtml(chMeta(ch))}</div>`;
  setArt(el.querySelector<HTMLElement>(".logoBox")!, ch);
  updateCardNow(el, ch);

  el.querySelector(".star")!.addEventListener("click", async (e) => {
    e.stopPropagation();
    const on = await toggleFavorite(ch);
    (e.target as HTMLElement).classList.toggle("on", on);
  });
  el.addEventListener("click", () => {
    stopHoverPreview();
    openPlayer(ch, 0, context);
  });
  wireHoverPreview(el, ch);
  watchCard(el);
  return el;
}

/** Fill the "on now" line from guide data; safe to call again as it updates. */
export function updateCardNow(el: HTMLElement, ch: Channel): void {
  const prog = onNow(ch);
  const line = el.querySelector<HTMLElement>(".cnow");
  if (!line) return;
  if (!prog) {
    line.hidden = true;
    return;
  }
  line.hidden = false;
  line.querySelector(".cnowTitle")!.textContent = `▸ ${prog.title}`;
  line.title = `${prog.title} · until ${fmtTime(prog.stop)}`;
  const pct = Math.min(100, Math.max(0, ((Date.now() / 1000 - prog.start) / (prog.stop - prog.start)) * 100));
  line.querySelector<HTMLElement>(".cprog i")!.style.width = `${pct}%`;
}

/** Card art: a live captured frame from the stream (logo as corner badge),
 * falling back to the logo treatment when no frame can be grabbed. */
function setArt(box: HTMLElement, ch: Channel): void {
  const stream = ch.streams[0];
  if (!stream || state.health.get(stream.url) === false) {
    setLogo(box, ch);
    return;
  }
  const img = document.createElement("img");
  img.className = "thumbImg";
  img.loading = "lazy";
  img.alt = "";
  img.onload = () => {
    box.classList.add("hasThumb");
    if (ch.logo) {
      const badge = document.createElement("img");
      badge.className = "logoBadge";
      badge.alt = "";
      badge.src = ch.logo;
      badge.onerror = () => badge.remove();
      box.append(badge);
    }
  };
  img.onerror = () => {
    img.remove();
    setLogo(box, ch);
  };
  img.src = `/thumb?url=${encodeURIComponent(stream.url)}`;
  box.append(img);
}

// Try each logo url directly, then through the /logo proxy (dodges
// hotlink blocking), before giving up on the 📺 placeholder.
export function setLogo(box: HTMLElement, ch: Channel): void {
  const candidates = (ch.logos || []).flatMap((u) => [u, `/logo?url=${encodeURIComponent(u)}`]);
  if (!candidates.length) {
    box.innerHTML = '<div class="noLogo">📺</div>';
    return;
  }
  const img = document.createElement("img");
  img.loading = "lazy";
  img.alt = "";
  let i = 0;
  img.onerror = () => {
    i++;
    const next = candidates[i];
    if (next) img.src = next;
    else box.innerHTML = '<div class="noLogo">📺</div>';
  };
  img.src = candidates[0]!;
  box.append(img);
}

// ---- hover live preview: one muted stream at a time, Netflix-style ----
const canHover = matchMedia("(hover: hover)").matches;
let hoverTimer: number | undefined;
let hoverHls: Hls | null = null;
let hoverVideo: HTMLVideoElement | null = null;

function wireHoverPreview(el: HTMLElement, ch: Channel): void {
  if (!canHover) return;
  el.addEventListener("mouseenter", () => {
    clearTimeout(hoverTimer);
    hoverTimer = window.setTimeout(() => startHoverPreview(el, ch), 650);
  });
  el.addEventListener("mouseleave", () => {
    clearTimeout(hoverTimer);
    stopHoverPreview();
  });
}

function startHoverPreview(el: HTMLElement, ch: Channel): void {
  stopHoverPreview();
  const stream = ch.streams[0];
  if (!stream || isDead(ch) || !Hls.isSupported()) return;
  const box = el.querySelector<HTMLElement>(".logoBox");
  if (!box) return;
  const video = document.createElement("video");
  video.className = "hoverPreview";
  video.muted = true;
  video.autoplay = true;
  video.playsInline = true;
  hoverVideo = video;
  hoverHls = new Hls({ maxBufferLength: 6, capLevelToPlayerSize: true });
  hoverHls.loadSource(`/proxy?url=${encodeURIComponent(stream.url)}`);
  hoverHls.attachMedia(video);
  video.addEventListener("playing", () => video.classList.add("on"));
  hoverHls.on(Hls.Events.ERROR, (_evt, data) => {
    if (data.fatal) stopHoverPreview();
  });
  box.append(video);
}

export function stopHoverPreview(): void {
  hoverHls?.destroy();
  hoverHls = null;
  hoverVideo?.remove();
  hoverVideo = null;
}
