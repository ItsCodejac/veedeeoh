import Hls from "hls.js";
import { openInVlc, toggleFavorite, toggleWatched } from "./api";
import { chMeta, state } from "./state";
import type { Channel } from "./types";
import { $, fmtTime, isGeoBlockBumper } from "./util";

let hls: Hls | null = null;
let currentStreamIdx = 0;

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
  currentStreamIdx = streamIdx;
  updateZapButtons(ch);

  // Switch to Live TV tab when playing a channel
  const tabLive = document.getElementById("tabLive");
  if (tabLive && !tabLive.classList.contains("active")) {
    tabLive.click();
  }

  // Show inline player suite
  $("playerSuite").removeAttribute("hidden");
  
  // Scroll to player suite
  $("playerSuite").scrollIntoView({ behavior: "smooth", block: "start" });

  const isVod = ch.id.startsWith("vod:");
  
  // Set Left Column Info
  $("activeShowName").textContent = ch.name;
  $("activeShowMeta").textContent = chMeta(ch);

  const entry = state.epg.get(ch.id);
  if (entry?.now) {
    $("activeProgTitle").textContent = entry.now.title;
    $("activeProgTime").textContent = `until ${fmtTime(entry.now.stop)}` + (entry.next ? ` · then ${entry.next.title} at ${fmtTime(entry.next.start)}` : "");
    const total = entry.now.stop - entry.now.start;
    const elapsed = Date.now() / 1000 - entry.now.start;
    const pct = total > 0 ? Math.max(0, Math.min(100, (elapsed / total) * 100)) : 0;
    $("activeProgProgressBar").style.width = `${pct}%`;
  } else {
    $("activeProgTitle").textContent = "Live Stream";
    $("activeProgTime").textContent = "No schedule information available";
    $("activeProgProgressBar").style.width = "0%";
  }

  // Populate Right Column Queue (On Deck)
  const deckList = $("deckList");
  deckList.replaceChildren();
  const pool = zapContext.length > 1 ? zapContext.slice(0, 10) : [];
  for (const item of pool) {
    if (item.id === ch.id) continue;
    const btn = document.createElement("button");
    btn.className = "deckCard";
    const nowProg = state.epg.get(item.id)?.now?.title || "Live Stream";
    btn.innerHTML = `
      <div class="deckCardMiniThumb">${item.name.substring(0, 2).toUpperCase()}</div>
      <div class="deckCardMeta">
        <span class="deckCardTitle"></span>
        <span class="deckCardProg"></span>
      </div>
    `;
    btn.querySelector(".deckCardTitle")!.textContent = item.name;
    btn.querySelector(".deckCardProg")!.textContent = nowProg;
    btn.addEventListener("click", () => openPlayer(item, 0, zapContext));
    deckList.append(btn);
  }

  const favBtn = $("pFav");
  favBtn.hidden = isVod;
  if (!isVod) {
    favBtn.classList.toggle("on", state.favorites.has(ch.id));
  }

  const nextEpBtn = $("pNextEp");
  if (isVod && streamIdx < ch.streams.length - 1) {
    nextEpBtn.hidden = false;
    const nextEp = ch.streams[streamIdx + 1];
    nextEpBtn.title = `Play next: ${nextEp?.source || "Next Episode"}`;
  } else {
    nextEpBtn.hidden = true;
  }

  const sel = $<HTMLSelectElement>("pStreams");
  sel.hidden = isVod || ch.streams.length < 2;
  if (!isVod && ch.streams.length > 1) {
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
  
  // Show tuning screen overlay while loading
  const tuningScreen = document.querySelector<HTMLElement>(".simulatedScreen");
  if (tuningScreen) {
    tuningScreen.removeAttribute("hidden");
    tuningScreen.querySelector("span")!.textContent = "TUNING STREAM...";
  }

  const src = `/proxy?url=${encodeURIComponent(url)}`;
  // direct files (VOD mp4/webm/ogv) play natively; HLS goes through hls.js
  if (/\.(mp4|m4v|webm|ogv)(\?|$)/i.test(url)) {
    video.src = src;
    video.onloadeddata = () => {
      status.textContent = "";
      if (tuningScreen) tuningScreen.setAttribute("hidden", "");
    };
    video.onerror = () => {
      status.textContent = "⚠ Playback failed — try Open in VLC.";
      if (tuningScreen) tuningScreen.setAttribute("hidden", "");
    };
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
    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      status.textContent = "";
    });
    hls.on(Hls.Events.FRAG_CHANGED, (_evt, data) => {
      const fragUrl = data.frag.url;
      const originalUrl = decodeHexUrl(fragUrl);
      const isAd = isAdUrl(originalUrl);
      const adOverlay = document.getElementById("pAdOverlay");
      if (isAd) {
        if (!video.muted) {
          video.muted = true;
          video.dataset.adMuted = "1";
        }
        adOverlay?.removeAttribute("hidden");
      } else {
        if (video.dataset.adMuted === "1") {
          video.muted = false;
          delete video.dataset.adMuted;
        }
        adOverlay?.setAttribute("hidden", "");
      }
    });
    video.addEventListener("playing", () => {
      if (tuningScreen) tuningScreen.setAttribute("hidden", "");
      window.setTimeout(() => {
        if (state.current?.streams.some((s) => s.url === url) && isGeoBlockBumper(video)) {
          state.health.set(url, false);
          status.textContent = "⚠ This stream is geo-blocked in your region (Pluto “not available”).";
        }
      }, 5000);
    }, { once: true });
    hls.on(Hls.Events.ERROR, (_evt, data) => {
      if (data.fatal) {
        status.textContent = "⚠ Preview failed (codec or geo-block?) — try Open in VLC.";
        hls?.destroy();
        hls = null;
        if (tuningScreen) tuningScreen.setAttribute("hidden", "");
      }
    });
  } else {
    video.src = src;
    video.onerror = () => {
      status.textContent = "⚠ Preview failed — try Open in VLC.";
      if (tuningScreen) tuningScreen.setAttribute("hidden", "");
    };
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
  const tuningScreen = document.querySelector<HTMLElement>(".simulatedScreen");
  if (tuningScreen) tuningScreen.setAttribute("hidden", "");
}

export function closePlayer(): void {
  stopPlayback();
  const suite = $("playerSuite");
  suite.setAttribute("hidden", "");
  suite.classList.remove("docked");
  state.current = null;
}

export function wirePlayer(): void {
  $("pClose").addEventListener("click", closePlayer);
  
  const suite = $("playerSuite");
  const pMin = $("pMin");
  pMin.addEventListener("click", () => {
    const isDocked = suite.classList.toggle("docked");
    pMin.textContent = isDocked ? "🗗 Expand" : "🗗 Minimize";
  });
  
  suite.addEventListener("click", (e) => {
    if (suite.classList.contains("docked")) {
      suite.classList.remove("docked");
      pMin.textContent = "🗗 Minimize";
      e.preventDefault();
      e.stopPropagation();
    }
  }, true);

  const scrollArea = $("scrollableArea");
  scrollArea.addEventListener("scroll", () => {
    if (suite.hasAttribute("hidden")) return;
    if (scrollArea.scrollTop > 500) {
      if (!suite.classList.contains("docked")) {
        suite.classList.add("docked");
        pMin.textContent = "🗗 Expand";
      }
    } else {
      if (suite.classList.contains("docked")) {
        suite.classList.remove("docked");
        pMin.textContent = "🗗 Minimize";
      }
    }
  });
  
  // Left Panel Toggle
  const infoCol = $("infoCol");
  const leftTrigger = $("leftTrigger");
  leftTrigger.addEventListener("click", () => {
    const collapsed = infoCol.classList.toggle("collapsed");
    leftTrigger.textContent = collapsed ? "▶" : "◀";
  });

  // Right Panel Toggle
  const deckCol = $("deckCol");
  const rightTrigger = $("rightTrigger");
  rightTrigger.addEventListener("click", () => {
    const collapsed = deckCol.classList.toggle("collapsed");
    rightTrigger.textContent = collapsed ? "◀" : "▶";
  });

  // Watch Live / Restart button
  $("btnWatchLive").addEventListener("click", () => {
    if (state.current) {
      play(state.current.streams[currentStreamIdx]!.url);
    }
  });

  $("btnWatchVlc").addEventListener("click", () => {
    $("pVlc").click();
  });

  document.addEventListener("keydown", (e) => {
    if ($("playerSuite").hasAttribute("hidden")) return;
    if (e.key === "Escape") closePlayer();
    else if (e.key === "ArrowLeft") zap(-1);
    else if (e.key === "ArrowRight") zap(1);
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

  $("pNextEp").addEventListener("click", () => {
    if (state.current) {
      const nextIdx = currentStreamIdx + 1;
      if (nextIdx < state.current.streams.length) {
        openPlayer(state.current, nextIdx);
      }
    }
  });

  const video = $<HTMLVideoElement>("video");
  const handleProgress = () => {
    const ch = state.current;
    if (ch && ch.id.startsWith("vod:") && video.duration > 0) {
      const epId = ch.streams[currentStreamIdx]?.id;
      if (epId && (video.currentTime / video.duration > 0.9 || video.ended)) {
        if (!state.watched.has(epId)) {
          state.watched.add(epId);
          document.querySelector(`.episodeCard[data-ep-id="${CSS.escape(epId)}"]`)?.classList.add("watched");
          void toggleWatched(epId, true);
        }
      }
    }
  };

  video.addEventListener("timeupdate", handleProgress);
  video.addEventListener("ended", handleProgress);
}

function decodeHexUrl(proxiedUrl: string): string {
  try {
    const urlObj = new URL(proxiedUrl, window.location.href);
    const hex = urlObj.searchParams.get("url");
    const obf = urlObj.searchParams.get("obf");
    if (hex && obf === "1") {
      let str = "";
      for (let i = 0; i < hex.length; i += 2) {
        str += String.fromCharCode(parseInt(hex.substring(i, i + 2), 16));
      }
      return str;
    }
    return hex || "";
  } catch {
    return "";
  }
}

function isAdUrl(url: string): boolean {
  const normalized = url.toLowerCase();
  return ["dai.google.com", "doubleclick", "pubads", "/ads/", "/creative/", "boltdns", "unicornmedia"].some((x) =>
    normalized.includes(x)
  );
}
