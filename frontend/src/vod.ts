import Hls from "hls.js";
import { fetchArchiveStream, fetchPlutoStream, fetchTubiStream, fetchVod, fetchVodSeries, toggleWatched } from "./api";
import { state } from "./state";
import type { Stream, VodItem, VodEpisode, VodRail } from "./types";
import { escapeHtml, $, setupHorizontalScroll, buildBrandLoader, buildRailSkeleton, showToast } from "./util";
import { getActiveProfile } from "./profiles";
import { maturityCeiling, filterRailsByMaturity, filterRailsForKids, isKidsSafeItem, addFavorite, removeFavorite, saveProgress, getWatchHistory } from "./db";
import { openVodPlayer } from "./vodplayer";

// The active profile's real Supabase id (null for local/unsynced placeholders).
function activeProfileUuid(): string | null {
  const id = getActiveProfile().id;
  return id && !id.startsWith("default_") && !id.startsWith("profile_") ? id : null;
}

// Shared inline icons (no emoji anywhere in the UI).
const FILM_ICON = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="2.18"></rect><line x1="7" y1="2" x2="7" y2="22"></line><line x1="17" y1="2" x2="17" y2="22"></line><line x1="2" y1="12" x2="22" y2="12"></line><line x1="2" y1="7" x2="7" y2="7"></line><line x1="2" y1="17" x2="7" y2="17"></line><line x1="17" y1="17" x2="22" y2="17"></line><line x1="17" y1="7" x2="22" y2="7"></line></svg>`;
const CHECK_ICON = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;

let vodHls: Hls | null = null;
let cachedVodRails: VodRail[] | null = null;
let showsSearchQuery = "";
let showsActiveGenre = "";
let moviesSearchQuery = "";
let moviesActiveGenre = "";
let lastSaveTime = 0;

export async function setGlobalSearchQuery(query: string): Promise<void> {
  const overlay = $("searchResultsOverlay");
  const searchBar = $("searchBar");
  
  if (!query) {
    overlay.hidden = true;
    searchBar.classList.remove("active");
    return;
  }
  
  overlay.hidden = false;
  searchBar.classList.add("active");
  
  overlay.innerHTML = `<div class="searchNoResults">Searching...</div>`;
  
  const rails = await getVodRails();
  const allItems = rails.flatMap(r => r.items);
  
  const q = query.toLowerCase();
  const matched = allItems.filter(item => 
    item.title.toLowerCase().includes(q) || 
    (item.summary && item.summary.toLowerCase().includes(q))
  );
  
  const unique = new Map<string, VodItem>();
  for (const item of matched) {
    if (!unique.has(item.id)) unique.set(item.id, item);
  }
  const results = Array.from(unique.values());

  if (results.length === 0) {
    overlay.innerHTML = `<div class="searchNoResults">No results found for "${escapeHtml(query)}"</div>`;
    return;
  }
  
  const movies = results.filter(i => !i.series_id).slice(0, 5);
  const shows = results.filter(i => !!i.series_id).slice(0, 5);
  
  let html = "";

  const renderGroup = (title: string, items: VodItem[]) => {
    if (items.length === 0) return;
    html += `<div class="searchGroupTitle">${title}</div>`;
    items.forEach(item => {
      const img = item.banner || item.poster || "";
      const rating = item.rating ? ` · ${item.rating}` : "";
      html += `
        <button class="searchResultItem vodResult" data-id="${item.id}">
          <img class="searchResultImage" src="${escapeHtml(img)}" alt="">
          <div class="searchResultMeta">
            <div class="searchResultTitle">${escapeHtml(item.title)}</div>
            <div class="searchResultDesc">${escapeHtml(item.genre || "")}${rating}</div>
          </div>
        </button>
      `;
    });
  };
  
  renderGroup("Movies", movies);
  renderGroup("TV Shows", shows);
  
  overlay.innerHTML = html;
  
  // Bind clicks
  overlay.querySelectorAll(".vodResult").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = (btn as HTMLElement).dataset.id;
      const item = unique.get(id!);
      if (item) {
        openVodDetails(item);
        overlay.hidden = true;
        searchBar.classList.remove("active");
      }
    });
  });
}

// Click outside to close
document.addEventListener("click", (e) => {
  const overlay = document.getElementById("searchResultsOverlay");
  const container = document.getElementById("searchContainer");
  if (overlay && container && !overlay.hidden) {
    if (!container.contains(e.target as Node)) {
      overlay.hidden = true;
      document.getElementById("searchBar")?.classList.remove("active");
    }
  }
});

export async function getVodRails(): Promise<VodRail[]> {
  if (!cachedVodRails || cachedVodRails.length === 0) {
    const res = await fetchVod();
    if (res.rails && res.rails.length > 0) {
      cachedVodRails = res.rails;
    }
  }
  const full = cachedVodRails || [];
  // Restricted profiles only ever see content at/below their rating cap. This is
  // the single chokepoint for home/shows/movies, so no render path can surface
  // adult content to a kids profile. A kids profile is HARD-capped at TV-G (2)
  // regardless of max_rating — belt-and-suspenders so a mis-set cap can't leak.
  const p = getActiveProfile();
  // Kids profiles get the strict genre+maturity gate (not maturity alone), so a
  // low-rated non-kids title can never appear in the kid view.
  const ceiling = maturityCeiling(p.max_rating);
  // Kids profiles get the genre+maturity gate AND their own rating cap. Applying
  // only the kids gate would ignore max_rating entirely, so a profile set to
  // "Little Kids (TV-Y)" would still be shown TV-Y7 and G titles.
  if (p.is_kids) return filterRailsByMaturity(filterRailsForKids(full), Math.min(2, ceiling)) as VodRail[];
  return filterRailsByMaturity(full, ceiling) as VodRail[];
}

// Continue Watching is stored PER PROFILE so a kids profile never sees an adult
// profile's resume cards (and vice-versa). Keyed on the active profile id.
function resumeHistoryKey(): string {
  let id = "default";
  try { id = getActiveProfile()?.id || "default"; } catch {}
  return `tvlc_resume_history_${id}`;
}

function getResumeHistory(): any[] {
  try { return JSON.parse(localStorage.getItem(resumeHistoryKey()) || "[]"); } catch { return []; }
}

// Genres the active profile has actually engaged with, most-watched first. Drives
// personalized rail ordering and the "Because you watched" row.
function getTasteGenres(): string[] {
  const counts: Record<string, number> = {};
  for (const r of getResumeHistory()) {
    if (r?.genre) counts[r.genre] = (counts[r.genre] || 0) + 1;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([g]) => g);
}

// Where a taste genre appears in a rail's name → its rank (lower = more relevant).
function railTasteRank(name: string, taste: string[]): number {
  const n = name.toLowerCase();
  for (let i = 0; i < taste.length; i++) {
    const g = taste[i];
    if (g && n.includes(g.toLowerCase())) return i;
  }
  return 999;
}

// Order rails by the profile's taste first, then editorial priority, then size.
function sortRailsByTaste<T extends { name: string; items: any[] }>(rails: T[]): T[] {
  const taste = getTasteGenres();
  return rails.sort((a, b) => {
    const ra = railTasteRank(a.name, taste), rb = railTasteRank(b.name, taste);
    if (ra !== rb) return ra - rb;
    const pa = getRailPriorityScore(a.name), pb = getRailPriorityScore(b.name);
    if (pa !== pb) return pa - pb;
    return b.items.length - a.items.length;
  });
}

function saveResumeProgress(ch: any, streamIdx: number, time: number, duration: number, percentage: number): void {
  if (Date.now() - lastSaveTime < 3000) return;
  lastSaveTime = Date.now();

  const itemId = ch.id.replace("vod:", "");
  const stream = ch.streams[streamIdx];
  if (!stream) return;

  const key = resumeHistoryKey();
  const historyStr = localStorage.getItem(key) || "[]";
  let history: any[] = [];
  try {
    history = JSON.parse(historyStr);
  } catch (e) {
    history = [];
  }

  history = history.filter((x: any) => x.itemId !== itemId);

  if (percentage < 95) {
    history.unshift({
      id: stream.id || `vod:${itemId}:${streamIdx}`,
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
      percentage,
      streamIdx,
      streams: ch.streams,
      vodItem: ch.vodItem
    });
  }

  if (history.length > 15) {
    history = history.slice(0, 15);
  }

  localStorage.setItem(key, JSON.stringify(history));
  localStorage.removeItem("tvlc_resume_history"); // retire the old cross-profile key

  // Cross-device Continue Watching: mirror to Supabase per-profile (best effort).
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

export function resumeVodPlayback(resumeItem: any): void {
  const ch: any = {
    id: `vod:${resumeItem.itemId}`,
    name: resumeItem.title,
    country: null,
    categories: [],
    nsfw: false,
    logo: null,
    logos: [],
    streams: resumeItem.streams,
    source: "Resume Playback",
    vodPoster: resumeItem.poster,
    vodBanner: resumeItem.banner,
    vodItem: resumeItem.vodItem
  };
  
  openVodPlayer(ch, resumeItem.streamIdx, resumeItem.time);
}

// Legacy hand-rolled player — superseded by the Vidstack module (./vodplayer).
// Kept as dead-code fallback until the new player is verified on-device, then delete.
function openVodPlayerLegacy(ch: any, streamIdx: number, startTime: number = 0): void {
  const overlay = $("vodPlayerOverlay");
  const video = $<HTMLVideoElement>("vodVideo");
  const title = $("vodPlayerTitle");
  
  const playBtn = $("vodPlayBtn");
  const bigPlayBtn = document.getElementById("vodBigPlayBtn");
  const timeline = $("vodTimelineContainer");
  const progress = $("vodTimelineProgress");
  const handle = $("vodTimelineHandle");
  const currentTxt = $("vodTimeCurrent");
  const totalTxt = $("vodTimeTotal");
  const volumeSlider = $("vodVolumeSlider") as HTMLInputElement;
  const muteBtn = $("vodMuteBtn");
  const ccBtn = $("vodCcBtn");
  const pipBtn = $("vodPipBtn");
  const fullscreenBtn = $("vodFullscreenBtn");
  const nextEpBtn = $("vodNextEpBtn");
  const rewindBtn = $("vodRewindBtn");
  const forwardBtn = $("vodForwardBtn");
  
  const skipIntroBtn = $("vodSkipIntroBtn");
  const nextEpPromptBtn = $("vodNextEpPromptBtn");

  overlay.removeAttribute("hidden");
  overlay.classList.remove("paused");
  
  let activityTimer = 0;
  const onMouseMove = () => {
    overlay.classList.add("user-active");
    clearTimeout(activityTimer);
    activityTimer = window.setTimeout(() => {
      overlay.classList.remove("user-active");
    }, 3000);
  };
  overlay.onmousemove = onMouseMove;

  const centerFeedback = $("vodCenterFeedback");
  let rippleTimer = 0;
  const triggerCenterFeedback = (iconText: string) => {
    if (!centerFeedback) return;
    centerFeedback.textContent = iconText;
    centerFeedback.classList.remove("yt-ripple");
    void centerFeedback.offsetWidth;
    centerFeedback.classList.add("yt-ripple");
    clearTimeout(rippleTimer);
    rippleTimer = window.setTimeout(() => {
      centerFeedback.classList.remove("yt-ripple");
    }, 600);
  };

  const togglePlay = () => {
    if (video.paused) {
      triggerCenterFeedback("▶");
      void video.play();
    } else {
      triggerCenterFeedback("❚❚");
      video.pause();
    }
  };
  playBtn.onclick = togglePlay;
  video.onclick = togglePlay;
  if (centerFeedback) centerFeedback.onclick = togglePlay;

  rewindBtn.onclick = () => {
    video.currentTime = Math.max(0, video.currentTime - 10);
    triggerCenterFeedback("↺ 10s");
    onMouseMove();
  };
  forwardBtn.onclick = () => {
    video.currentTime = Math.min(video.duration, video.currentTime + 10);
    triggerCenterFeedback("↻ 10s");
    onMouseMove();
  };

  video.onplay = () => {
    playBtn.textContent = "❚❚";
    overlay.classList.remove("paused");
  };
  video.onpause = () => {
    playBtn.textContent = "▶";
    overlay.classList.add("paused");
  };

  const formatTime = (secs: number) => {
    if (isNaN(secs) || secs < 0) return "00:00";
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = Math.floor(secs % 60);
    const pad = (n: number) => n.toString().padStart(2, "0");
    if (h > 0) return `${h}:${pad(m)}:${pad(s)}`;
    return `${pad(m)}:${pad(s)}`;
  };

  // Sync initial volume state
  const savedVol = localStorage.getItem("tvlc_vod_volume");
  if (savedVol !== null) {
    video.volume = parseFloat(savedVol);
    volumeSlider.value = savedVol;
  } else {
    video.volume = 1.0;
    volumeSlider.value = "1.0";
  }
  video.muted = video.volume === 0;
  muteBtn.textContent = video.muted ? "🔇" : "🔊";
  
  volumeSlider.oninput = () => {
    video.volume = parseFloat(volumeSlider.value);
    video.muted = video.volume === 0;
    muteBtn.textContent = video.muted ? "🔇" : "🔊";
    localStorage.setItem("tvlc_vod_volume", volumeSlider.value);
  };

  muteBtn.onclick = () => {
    video.muted = !video.muted;
    muteBtn.textContent = video.muted ? "🔇" : "🔊";
    volumeSlider.value = video.muted ? "0" : video.volume.toString();
  };

  timeline.onclick = (e: MouseEvent) => {
    const rect = timeline.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    video.currentTime = pct * video.duration;
  };

  ccBtn.onclick = () => {
    const track = video.textTracks[0];
    if (track) {
      track.mode = track.mode === "showing" ? "hidden" : "showing";
      ccBtn.style.color = track.mode === "showing" ? "var(--accent)" : "#fff";
    } else {
      alert("No captions found for this video.");
    }
  };

  pipBtn.onclick = () => {
    if (document.pictureInPictureElement) {
      void document.exitPictureInPicture();
    } else {
      void video.requestPictureInPicture();
    }
  };

  fullscreenBtn.onclick = () => {
    if (!document.fullscreenElement) {
      void overlay.requestFullscreen().catch(() => {});
    } else {
      void document.exitFullscreen();
    }
  };

  const showToast = (msg: string) => {
    const existing = document.getElementById("vodToast");
    if (existing) existing.remove();
    const t = document.createElement("div");
    t.id = "vodToast";
    t.style.cssText = "position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:rgba(16,20,30,0.95);border:1px solid rgba(197,240,78,0.4);color:#c5f04e;padding:10px 22px;border-radius:20px;font-size:13px;font-weight:700;z-index:10001;box-shadow:0 10px 30px rgba(0,0,0,0.8);pointer-events:none;";
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2500);
  };

  const toggleSubtitles = () => {
    if (video.textTracks && video.textTracks.length > 0) {
      let enabled = false;
      for (let i = 0; i < video.textTracks.length; i++) {
        const track = video.textTracks[i];
        if (track) {
          if (track.mode === "showing") {
            track.mode = "disabled";
          } else {
            track.mode = "showing";
            enabled = true;
          }
        }
      }
      showToast(enabled ? "Subtitles Enabled (CC)" : "Subtitles Disabled");
    } else if (vodHls && vodHls.subtitleTracks.length > 0) {
      if (vodHls.subtitleTrack === -1) {
        vodHls.subtitleTrack = 0;
        showToast("Subtitles Enabled (CC)");
      } else {
        vodHls.subtitleTrack = -1;
        showToast("Subtitles Disabled");
      }
    } else {
      showToast("No Closed Captions / Subtitles available for this stream");
    }
  };

  const showHotkeysModal = () => {
    const existing = document.getElementById("hotkeysModal");
    if (existing) {
      existing.remove();
      return;
    }
    const modal = document.createElement("div");
    modal.id = "hotkeysModal";
    modal.style.cssText = "position:fixed;inset:0;background:rgba(6,7,10,0.85);backdrop-filter:blur(12px);z-index:10000;display:flex;align-items:center;justify-content:center;padding:20px;";
    modal.innerHTML = `
      <div style="background:#10141e;border:1px solid rgba(255,255,255,0.15);border-radius:18px;max-width:440px;width:100%;padding:28px;color:#fff;font-family:sans-serif;box-shadow:0 20px 50px rgba(0,0,0,0.8);">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
          <h3 style="margin:0;font-size:20px;font-weight:700;">⌨️ Keyboard Shortcuts</h3>
          <button id="closeHotkeysBtn" style="display:inline-flex;align-items:center;justify-content:center;background:none;border:none;color:#aaa;cursor:pointer;"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></button>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;font-size:14px;color:#c4d0e0;">
          <div><code>Space</code> / <code>K</code></div><div>Play / Pause</div>
          <div><code>F</code></div><div>Fullscreen Toggle</div>
          <div><code>M</code></div><div>Mute / Unmute</div>
          <div><code>C</code></div><div>Subtitles / CC Toggle</div>
          <div><code>←</code> / <code>→</code></div><div>Skip 10s Back / Forward</div>
          <div><code>?</code></div><div>Show / Hide Hotkeys</div>
          <div><code>Esc</code></div><div>Close Player / Modal</div>
        </div>
      </div>
    `;
    modal.onclick = (e) => {
      if (e.target === modal || (e.target as HTMLElement).id === "closeHotkeysBtn") {
        modal.remove();
      }
    };
    document.body.appendChild(modal);
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (overlay.hasAttribute("hidden")) return;

    // Ignore hotkeys when typing in search inputs or text fields
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
      return;
    }

    if (["Space", " ", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) {
      e.preventDefault();
    }

    if (e.key === "Escape") {
      closePlayer();
    } else if (e.key === " " || e.key === "k") {
      togglePlay();
      onMouseMove();
    } else if (e.key === "f") {
      fullscreenBtn.click();
    } else if (e.key === "m") {
      muteBtn.click();
    } else if (e.key === "ArrowRight" || e.key === "l") {
      video.currentTime = Math.min(video.duration, video.currentTime + 10);
      onMouseMove();
    } else if (e.key === "ArrowLeft" || e.key === "j") {
      video.currentTime = Math.max(0, video.currentTime - 10);
      onMouseMove();
    } else if (e.key === "c" || e.key === "C") {
      toggleSubtitles();
    } else if (e.key === "?" || e.key === "/") {
      showHotkeysModal();
    }
  };

  document.addEventListener("keydown", handleKeyDown);

  const playStream = (idx: number) => {
    if (vodHls) {
      vodHls.destroy();
      vodHls = null;
    }
    video.src = "";
    video.load();
    
    const stream = ch.streams[idx];
    if (!stream) {
      closePlayer();
      return;
    }
    
    const streamTitle = stream.source ? ` · ${stream.source}` : "";
    title.textContent = `${ch.name}${streamTitle}`;
    
    const url = stream.url;
    const proxiedUrl = `/proxy?url=${encodeURIComponent(url)}`;

    if (idx + 1 < ch.streams.length) {
      nextEpBtn.style.display = "block";
      nextEpBtn.onclick = () => {
        playStream(idx + 1);
      };
    } else {
      nextEpBtn.style.display = "none";
      nextEpBtn.onclick = null;
    }

    skipIntroBtn.onclick = () => {
      video.currentTime = Math.min(video.duration, video.currentTime + 90);
      skipIntroBtn.style.display = "none";
    };

    nextEpPromptBtn.onclick = () => {
      playStream(idx + 1);
      nextEpPromptBtn.style.display = "none";
    };
    
    video.onended = () => {
      const epId = stream.id;
      if (epId && !state.watched.has(epId)) {
        state.watched.add(epId);
        document.querySelector(`.episodeCard[data-ep-id="${CSS.escape(epId)}"]`)?.classList.add("watched");
        void toggleWatched(epId, true);
      }
      
      if (idx + 1 < ch.streams.length) {
        playStream(idx + 1);
      } else {
        closePlayer();
      }
    };

    video.onloadedmetadata = () => {
      totalTxt.textContent = formatTime(video.duration);
    };
    
    const handleProgress = () => {
      const epId = stream.id;
      if (video.duration > 0) {
        const currentTime = video.currentTime;
        const duration = video.duration;
        const percentage = (currentTime / duration) * 100;

        // Save progress to resume history
        saveResumeProgress(ch, idx, currentTime, duration, percentage);

        // Update HUD timeline progress in real-time
        progress.style.width = `${percentage}%`;
        handle.style.left = `${percentage}%`;
        currentTxt.textContent = formatTime(currentTime);

        // 1. Skip Intro prompt: Show if within first 4 minutes of a TV show episode
        if (ch.streams.length > 1 && currentTime > 5 && currentTime < 240) {
          skipIntroBtn.style.display = "block";
        } else {
          skipIntroBtn.style.display = "none";
        }

        // 2. Next Episode prompt: Show if in last 120s of the episode and a next episode exists
        if (idx + 1 < ch.streams.length && duration - currentTime < 120) {
          nextEpPromptBtn.style.display = "block";
        } else {
          nextEpPromptBtn.style.display = "none";
        }

        if (epId && percentage > 90) {
          if (!state.watched.has(epId)) {
            state.watched.add(epId);
            document.querySelector(`.episodeCard[data-ep-id="${CSS.escape(epId)}"]`)?.classList.add("watched");
            void toggleWatched(epId, true);
          }
        }
      }
    };
    video.ontimeupdate = handleProgress;
    
    const isDirectMp4 = /\.(mp4|m4v|webm|ogv)(\?|$)/i.test(url);
    const targetUrl = url; // Client-side direct CDN streaming (0 Vercel bandwidth!)

    if (isDirectMp4) {
      video.src = targetUrl;
      void video.play().catch(() => {});
    } else if (Hls.isSupported()) {
      vodHls = new Hls({
        maxBufferLength: 30,
        manifestLoadingTimeOut: 30000,
        levelLoadingTimeOut: 30000,
        fragLoadingTimeOut: 30000,
        startPosition: idx === streamIdx ? startTime : -1,
      });
      vodHls.loadSource(targetUrl);
      vodHls.attachMedia(video);
      vodHls.on(Hls.Events.MANIFEST_PARSED, () => {
        void video.play().catch(() => {});
      });
      vodHls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) {
          console.warn("HLS fatal error:", data.type, data.details);
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
            if (vodHls) {
              console.log("Direct CDN stream blocked, falling back to proxy stream...");
              vodHls.loadSource(proxiedUrl);
              vodHls.startLoad();
            }
          } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
            vodHls?.recoverMediaError();
          }
        }
      });
    } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = targetUrl;
      video.addEventListener("loadedmetadata", () => {
        void video.play().catch(() => {});
      }, { once: true });
      video.onerror = () => {
        video.src = proxiedUrl;
        void video.play().catch(() => {});
      };
    } else {
      video.src = targetUrl;
      void video.play().catch(() => {});
    }

    if (idx === streamIdx && startTime > 0) {
      if (!Hls.isSupported() || /\.(mp4|m4v|webm|ogv)(\?|$)/i.test(url)) {
        video.addEventListener("loadedmetadata", () => {
          video.currentTime = startTime;
        }, { once: true });
      }
    }
  };
  
  const closePlayer = () => {
    if (vodHls) {
      vodHls.destroy();
      vodHls = null;
    }
    video.src = "";
    video.load();
    video.onended = null;
    video.ontimeupdate = null;
    video.onplay = null;
    video.onpause = null;
    video.onclick = null;
    video.onloadedmetadata = null;
    document.removeEventListener("keydown", handleKeyDown);
    skipIntroBtn.style.display = "none";
    nextEpPromptBtn.style.display = "none";
    skipIntroBtn.onclick = null;
    nextEpPromptBtn.onclick = null;
    rewindBtn.onclick = null;
    forwardBtn.onclick = null;
    overlay.classList.remove("mini-player");
    overlay.setAttribute("hidden", "");
  };
  
  const expandBtn = $("vodPlayerExpand");
  const stopBtn = $("vodPlayerStop");

  const minimizePlayer = () => {
    overlay.classList.add("mini-player");
    expandBtn.style.display = "inline-flex";
    stopBtn.style.display = "inline-flex";
  };

  const expandPlayer = () => {
    overlay.classList.remove("mini-player");
    expandBtn.style.display = "none";
    stopBtn.style.display = "none";
  };

  $("vodPlayerClose").onclick = () => {
    if (!video.paused || video.currentTime > 0) {
      minimizePlayer();
    } else {
      closePlayer();
    }
  };

  expandBtn.onclick = expandPlayer;
  stopBtn.onclick = closePlayer;
  
  playStream(streamIdx);
}


export function wireVodDetails(): void {
  $("vdClose").addEventListener("click", () => {
    $("vodDetailsOverlay").setAttribute("hidden", "");
  });
  $("vodDetailsOverlay").addEventListener("click", (e) => {
    if (e.target === $("vodDetailsOverlay")) {
      $("vodDetailsOverlay").setAttribute("hidden", "");
    }
  });
}

function asChannel(item: VodItem, streams: Stream[]): any {
  return {
    id: `vod:${item.id}`,
    name: item.title,
    country: null,
    categories: [],
    nsfw: false,
    logo: null,
    logos: [],
    streams,
    source: item.genre || "On Demand",
    vodPoster: item.poster,
    vodBanner: item.banner,
    vodItem: item,
  };
}

// "My List" toggle in the detail view — injected next to the Play button so it
// needs no index.html change. Optimistic UI + per-profile Supabase persistence.
function setupMyListButton(item: VodItem): void {
  const playBtn = document.getElementById("vdPlayBtn");
  if (!playBtn || !playBtn.parentElement) return;

  let btn = document.getElementById("vdMyListBtn") as HTMLButtonElement | null;
  if (!btn) {
    btn = document.createElement("button");
    btn.id = "vdMyListBtn";
    btn.className = playBtn.className;
    btn.style.cssText = "background:rgba(255,255,255,0.12);border:1px solid rgba(255,255,255,0.25);color:#fff;";
    playBtn.parentElement.insertBefore(btn, playBtn.nextSibling);
  }

  const id = item.id;
  const render = () => {
    const inList = state.favorites.has(id);
    btn!.style.display = "inline-flex";
    btn!.style.alignItems = "center";
    btn!.style.gap = "8px";
    const icon = inList
      ? `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`
      : `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>`;
    btn!.innerHTML = `${icon}My List`;
  };
  render();

  btn.onclick = async () => {
    const nowIn = !state.favorites.has(id);
    if (nowIn) state.favorites.add(id); else state.favorites.delete(id);
    render();
    const pid = activeProfileUuid();
    if (!pid) return; // local/self-host: optimistic state only
    try {
      if (nowIn) await addFavorite(pid, { content_id: id, title: item.title, poster: item.poster ?? null });
      else await removeFavorite(pid, id);
    } catch { /* keep optimistic state */ }
  };
}

// Favorites tab — every catalog item the active profile has added to My List.
export async function renderFavorites(): Promise<void> {
  const container = $("homeView");
  if (!container) return;
  container.replaceChildren();

  const rails = await getVodRails();
  const seen = new Set<string>();
  const items: VodItem[] = [];
  for (const rail of rails) {
    for (const it of rail.items as VodItem[]) {
      if (state.favorites.has(it.id) && !seen.has(it.id)) { seen.add(it.id); items.push(it); }
    }
  }

  if (items.length === 0) {
    const empty = document.createElement("div");
    empty.style.cssText = "flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 38px; padding: 120px 60px 40px; margin-top: 40px;";
    empty.innerHTML = `
      <div style="display: flex; align-items: flex-end; gap: 22px; height: 226px">
        <div style="width: 132px; height: 186px; border-radius: 10px; border: 2px dashed #22262E; transform: rotate(-7deg)"></div>
        <div style="width: 148px; height: 210px; border-radius: 10px; border: 2px dashed #2B303A; position: relative; display: flex; align-items: center; justify-content: center">
          <div style="width: 13px; height: 13px; border-radius: 50%; background: #C6F53A; box-shadow: 0 0 22px #C6F53A99"></div>
        </div>
        <div style="width: 132px; height: 186px; border-radius: 10px; border: 2px dashed #22262E; transform: rotate(7deg)"></div>
      </div>
      <div style="display: flex; flex-direction: column; align-items: center; gap: 12px; max-width: 520px; text-align: center">
        <div style="font-size: 30px; font-weight: 800; letter-spacing: -0.03em; color: #fff">Nothing on your list yet</div>
        <div style="font-size: 16px; font-weight: 500; line-height: 1.55; color: #7C828C; text-wrap: pretty">Hit + on anything you want to get to later. It lands here, on every device you watch on.</div>
      </div>
    `;
    container.append(empty);
    return;
  }

  const rail = document.createElement("div");
  rail.className = "rail";
  rail.innerHTML = `<div class="railHead"><h2>My List</h2><span class="railTag">${items.length} saved</span></div>`;
  const scroller = document.createElement("div");
  scroller.className = "railScroller";
  for (const it of items) {
    const card = document.createElement("div");
    card.className = "vodCard";
    card.innerHTML = `<div class="vodCardArt">${it.poster ? `<img loading="lazy" alt="" src="${escapeHtml(it.poster)}">` : FILM_ICON}</div><div class="vodCardTitle">${escapeHtml(it.title)}</div>`;
    card.addEventListener("click", () => void openVodDetails(it));
    scroller.append(card);
  }
  rail.append(scroller);
  container.append(rail);
}

export async function openVodDetails(item: VodItem): Promise<void> {
  const overlay = $("vodDetailsOverlay");
  overlay.removeAttribute("hidden");

  // Ambient blurred background
  const ambient = $("vodDetailsAmbient");
  const bannerImg = item.banner || item.poster || "";
  ambient.style.backgroundImage = bannerImg ? `url(${bannerImg})` : "";

  // Hero banner background
  const banner = $("vdBanner");
  banner.style.backgroundImage = bannerImg ? `url(${bannerImg})` : "";

  // Show poster
  const poster = $("vdPoster");
  if (item.poster) {
    poster.innerHTML = `<img loading="lazy" alt="" src="${escapeHtml(item.poster)}">`;
  } else {
    poster.innerHTML = FILM_ICON;
  }

  // Populate metadata
  $("vdTitle").textContent = item.title;
  $("vdMeta").textContent = [item.genre, item.rating].filter(Boolean).join(" · ");
  $("vdSummary").textContent = item.summary || "No description available.";

  setupMyListButton(item);

  const selectContainer = $("vdSelectorContainer");
  const select = $<HTMLSelectElement>("vdSeasonSelect");
  const grid = $("vdEpisodeGrid");
  const playBtn = $<HTMLButtonElement>("vdPlayBtn");

  selectContainer.hidden = true;
  select.replaceChildren();
  grid.replaceChildren();
  playBtn.onclick = null;

  // 1. Movie item. Pluto movies carry only `pluto_path` and mint their signed URL
  // on click; `item.url` is the legacy pre-signed field, still honoured so a
  // catalog cached by the old code keeps playing until the next warm.
  if (item.url || item.pluto_path) {
    selectContainer.hidden = true;

    const playMovie = async () => {
      playBtn.disabled = true;
      const label = playBtn.textContent;
      try {
        const url = item.url || (await fetchPlutoStream(item.pluto_path!));
        openVodPlayer(asChannel(item, [{ url, quality: null, source: item.genre || "movie" }]), 0);
      } catch (err) {
        showToast("Couldn't start this title. Try another.");
        console.error("[vod] pluto resolve failed:", err);
      } finally {
        playBtn.disabled = false;
        playBtn.textContent = label;
      }
    };

    playBtn.onclick = playMovie;
    playBtn.textContent = "▶ PLAY MOVIE";

    const durationText = item.duration ? `${Math.round(item.duration / 60)}m` : "";

    const card = document.createElement("button");
    card.className = "episodeCard";
    card.innerHTML = `
      <div class="epThumbWrap">
        ${bannerImg ? `<img loading="lazy" alt="" src="${escapeHtml(bannerImg)}">` : `<div style="padding: 40px; text-align: center;">${FILM_ICON}</div>`}
        <div class="epPlayOverlay">▶</div>
        ${durationText ? `<div class="epDuration">${durationText}</div>` : ""}
      </div>
      <div class="epMeta">
        <span class="epShowTitle">${escapeHtml(item.title.toUpperCase())}</span>
        <div class="epTitleRow">
          <span class="epTitle">Watch Movie</span>
        </div>
        <p class="epDescription">${escapeHtml(item.summary)}</p>
      </div>`;
    
    card.addEventListener("click", playMovie);
    grid.append(card);
    return;
  }

  // 1b. Tubi movie — the catalog carries no URL, so resolve the HLS stream on
  // click via the adrise content API (mirrors the Internet Archive flow).
  if (String(item.id).startsWith("tubi:") && !item.series_id) {
    selectContainer.hidden = true;
    playBtn.textContent = "▶ PLAY MOVIE";

    const playTubi = async (cardEl?: HTMLElement) => {
      if (cardEl) cardEl.classList.add("loading");
      try {
        const url = await fetchTubiStream(String(item.id).replace("tubi:", ""));
        overlay.setAttribute("hidden", "");
        openVodPlayer(asChannel(item, [{ url, quality: null, source: "Tubi" }]), 0);
      } catch (err) {
        alert(`Couldn't load this title: ${err}`);
      } finally {
        if (cardEl) cardEl.classList.remove("loading");
      }
    };

    playBtn.onclick = () => playTubi();

    const card = document.createElement("button");
    card.className = "episodeCard";
    card.innerHTML = `
      <div class="epThumbWrap">
        ${bannerImg ? `<img loading="lazy" alt="" src="${escapeHtml(bannerImg)}">` : `<div style="padding: 40px; text-align: center;">${FILM_ICON}</div>`}
        <div class="epPlayOverlay">▶</div>
      </div>
      <div class="epMeta">
        <span class="epShowTitle">${escapeHtml(item.title.toUpperCase())}</span>
        <div class="epTitleRow"><span class="epTitle">Watch Movie</span></div>
        <p class="epDescription">${escapeHtml(item.summary)}</p>
      </div>`;
    card.addEventListener("click", () => playTubi(card));
    grid.append(card);
    return;
  }

  // 2. Series or Podcast item
  if (item.series_id || item.episodes) {
    playBtn.textContent = "▶ START WATCHING";
    
    const loading = document.createElement("div");
    loading.style.color = "var(--dim)";
    loading.style.gridColumn = "1/-1";
    loading.style.textAlign = "center";
    loading.style.padding = "40px";
    
    let episodes = item.episodes || [];
    
    if (item.series_id && !episodes.length) {
      loading.textContent = "Loading episodes...";
      grid.append(loading);
      try {
        episodes = await fetchVodSeries(item.series_id);
      } catch (err) {
        grid.replaceChildren();
        loading.textContent = `Failed to load episodes: ${err}`;
        grid.append(loading);
        return;
      }
    }

    grid.replaceChildren();
    if (!episodes.length) {
      loading.textContent = "No episodes found.";
      grid.append(loading);
      return;
    }

      // Group episodes by season
      const seasons: Record<number, VodEpisode[]> = {};
      for (const ep of episodes) {
        const s = ep.season ?? 1;
        if (!seasons[s]) seasons[s] = [];
        seasons[s].push(ep);
      }

      const seasonNums = Object.keys(seasons).map(Number).sort((a, b) => a - b);
      
      const renderSeason = (sNum: number) => {
        grid.replaceChildren();
        const epList = seasons[sNum] || [];
        
        // Prepare streams context for player
        const streams: Stream[] = epList.map((ep) => ({
          url: ep.url,
          quality: null,
          source: `S${ep.season ?? "?"}E${ep.number ?? "?"} ${ep.title}`.slice(0, 48),
          id: `vod:${item.id}:s${ep.season ?? 1}e${ep.number ?? 0}`
        }));

        const channelContext = asChannel(item, streams);

        // Bind Start Watching button to play first episode of current season
        playBtn.onclick = () => {
          openVodPlayer(channelContext, 0);
        };

        epList.forEach((ep, idx) => {
          const epId = `vod:${item.id}:s${ep.season ?? 1}e${ep.number ?? 0}`;
          const isWatched = state.watched.has(epId);

          const card = document.createElement("div");
          card.className = `episodeCard${isWatched ? " watched" : ""}`;
          card.dataset.epId = epId;

          // Thumbnail thumbnail fallback
          const epThumb = ep.thumbnail || bannerImg;
          // Durations arrive normalized to seconds by the backend, for every provider.
          const durationStr = ep.duration ? `${Math.round(ep.duration / 60)}m` : "";

          card.innerHTML = `
            <div class="epThumbWrap">
              ${epThumb ? `<img loading="lazy" alt="" src="${escapeHtml(epThumb)}">` : `<div style="padding: 40px; text-align: center;">${FILM_ICON}</div>`}
              <div class="epPlayOverlay">▶</div>
              ${isWatched ? `<div class="epCardWatchedBadge">${CHECK_ICON} WATCHED</div>` : ""}
              ${durationStr ? `<div class="epDuration">${durationStr}</div>` : ""}
            </div>
            <div class="epMeta">
              <span class="epShowTitle">${escapeHtml(item.title.toUpperCase())}</span>
              <div class="epTitleRow">
                <span class="epTitle">E${ep.number ?? "?"} - ${escapeHtml(ep.title || "Episode")}</span>
                <button class="epWatchedToggle" title="${isWatched ? "Mark unwatched" : "Mark watched"}" style="display:inline-flex;align-items:center;justify-content:center;">${CHECK_ICON}</button>
              </div>
              <p class="epDescription">${escapeHtml(ep.description || "No description available.")}</p>
            </div>
          `;

          // Handle watched toggle
          const toggleBtn = card.querySelector(".epWatchedToggle") as HTMLButtonElement;
          toggleBtn.addEventListener("click", async (e) => {
            e.stopPropagation();
            const nowWatched = await toggleWatched(epId);
            card.classList.toggle("watched", nowWatched);
            
            // Toggle badge representation
            const thumbWrap = card.querySelector(".epThumbWrap")!;
            const existingBadge = thumbWrap.querySelector(".epCardWatchedBadge");
            if (nowWatched) {
              if (!existingBadge) {
                const badge = document.createElement("div");
                badge.className = "epCardWatchedBadge";
                badge.innerHTML = `${CHECK_ICON} WATCHED`;
                thumbWrap.append(badge);
              }
            } else {
              existingBadge?.remove();
            }

            toggleBtn.title = nowWatched ? "Mark unwatched" : "Mark watched";
          });

          // Handle card click
          card.addEventListener("click", () => {
            openVodPlayer(channelContext, idx);
          });

          grid.append(card);
        });
      };

      // Populate seasons selection dropdown
      if (seasonNums.length > 0) {
        selectContainer.hidden = false;
        seasonNums.forEach((sNum) => {
          const opt = new Option(`Season ${sNum}`, String(sNum));
          select.append(opt);
        });

        select.onchange = () => {
          renderSeason(Number(select.value));
        };

        // Render first season by default
        renderSeason(seasonNums[0]!);
      }
      
    return;
  }

  // 3. Internet Archive item
  if (item.identifier) {
    selectContainer.hidden = true;
    playBtn.textContent = "▶ PLAY FILM";

    const playArchive = async (cardEl?: HTMLElement) => {
      if (cardEl) cardEl.classList.add("loading");
      try {
        const url = await fetchArchiveStream(item.identifier!);
        overlay.setAttribute("hidden", "");
        openVodPlayer(asChannel(item, [{ url, quality: null, source: "Internet Archive" }]), 0);
      } catch (err) {
        alert(`Failed to load archive stream: ${err}`);
      } finally {
        if (cardEl) cardEl.classList.remove("loading");
      }
    };

    playBtn.onclick = () => playArchive();

    const card = document.createElement("button");
    card.className = "episodeCard";
    card.innerHTML = `
      <div class="epThumbWrap">
        ${bannerImg ? `<img loading="lazy" alt="" src="${escapeHtml(bannerImg)}">` : `<div style="padding: 40px; text-align: center;">${FILM_ICON}</div>`}
        <div class="epPlayOverlay">▶</div>
      </div>
      <div class="epMeta">
        <span class="epShowTitle">INTERNET ARCHIVE</span>
        <div class="epTitleRow">
          <span class="epTitle">Load film stream</span>
        </div>
        <p class="epDescription">${escapeHtml(item.summary)}</p>
      </div>`;
    
    card.addEventListener("click", () => playArchive(card));
    grid.append(card);
  }
}

async function playVod(item: VodItem): Promise<void> {
  await openVodDetails(item);
}

function vodCard(item: VodItem): HTMLElement {
  const el = document.createElement("button");
  el.className = "vodCard";
  el.title = item.summary || item.title;
  el.innerHTML = `
    <span class="vodPoster">${item.poster ? `<img loading="lazy" alt="" src="${escapeHtml(item.poster)}">` : FILM_ICON}</span>
    <span class="vodTitle">${escapeHtml(item.title)}</span>
    <span class="vodMeta">${escapeHtml([item.genre, item.rating].filter(Boolean).join(" · "))}</span>`;
  el.addEventListener("click", () => {
    el.classList.add("loading");
    void playVod(item).finally(() => el.classList.remove("loading"));
  });
  return el;
}

function renderFilterChips(container: HTMLElement, genres: string[], activeGenre: string, onSelect: (g: string) => void): void {
  container.replaceChildren();

  // "All" chip
  const allChip = document.createElement("button");
  allChip.className = `filterChip${!activeGenre ? " active" : ""}`;
  allChip.textContent = "All";
  allChip.onclick = () => onSelect("");
  container.append(allChip);

  genres.forEach((g) => {
    const chip = document.createElement("button");
    chip.className = `filterChip${activeGenre === g ? " active" : ""}`;
    chip.textContent = g;
    chip.onclick = () => onSelect(g);
    container.append(chip);
  });
}

export function wireSearchInputs(): void {
  const showsSearch = $("showsSearch") as HTMLInputElement;
  const moviesSearch = $("moviesSearch") as HTMLInputElement;

  if (showsSearch) {
    showsSearch.addEventListener("input", (e) => {
      showsSearchQuery = (e.target as HTMLInputElement).value.toLowerCase();
      const container = $("showsRails");
      if (container) void renderShows(container);
    });
  }

  if (moviesSearch) {
    moviesSearch.addEventListener("input", (e) => {
      moviesSearchQuery = (e.target as HTMLInputElement).value.toLowerCase();
      const container = $("moviesRails");
      if (container) void renderMovies(container);
    });
  }
}

let previousActivePanelId = "homeView";
let previousScrollPos = 0;

export function openCategoryView(titleName: string, items: VodItem[]): void {
  const scrollable = $("scrollableArea");
  if (scrollable) previousScrollPos = scrollable.scrollTop;

  const panels = ["homeView", "showsView", "moviesView"];
  for (const id of panels) {
    const p = $(id);
    if (p && !p.hasAttribute("hidden")) {
      previousActivePanelId = id;
      p.setAttribute("hidden", "");
    }
  }

  const categoryView = $("categoryView");
  const titleNameEl = $("categoryTitleName");
  const itemCountEl = $("categoryItemCount");
  const grid = $("categoryGrid");
  const backBtn = $("categoryBackBtn");

  if (!categoryView || !grid) return;

  if (titleNameEl) titleNameEl.textContent = titleName;
  if (itemCountEl) itemCountEl.textContent = `${items.length} titles`;

  grid.replaceChildren();
  items.forEach((item) => {
    grid.append(vodCard(item));
  });

  categoryView.removeAttribute("hidden");
  if (scrollable) scrollable.scrollTop = 0;

  if (backBtn) {
    backBtn.onclick = () => {
      categoryView.setAttribute("hidden", "");
      const prev = $(previousActivePanelId);
      if (prev) prev.removeAttribute("hidden");
      if (scrollable) scrollable.scrollTop = previousScrollPos;
    };
  }
}

function getRailPriorityScore(name: string): number {
  const n = name.toLowerCase();
  if (n.includes("trending") || n.includes("popular") || n.includes("hit") || n.includes("top") || n.includes("binge")) return 1;
  if (n.includes("blockbuster") || n.includes("hollywood") || n.includes("feature")) return 2;
  if (n.includes("action") || n.includes("adventure")) return 3;
  if (n.includes("drama")) return 4;
  if (n.includes("comedy") || n.includes("standup")) return 5;
  if (n.includes("crime") || n.includes("thriller")) return 6;
  if (n.includes("sci-fi") || n.includes("cyberpunk") || n.includes("fantasy")) return 7;
  if (n.includes("horror") || n.includes("monster")) return 8;
  if (n.includes("docu") || n.includes("reality")) return 9;

  // Kids/family rails sink on a general (adult) home; a kids profile only has
  // these anyway (so they just sort among themselves), and taste ordering still
  // lifts them for anyone who actually watches them.
  if (n.includes("kids") || n.includes("family") || n.includes("preschool") || n.includes("cartoon")) return 900;

  // Ambient, sleep soundscapes, and fireplaces push to the very bottom
  if (n.includes("sleep") || n.includes("ambient") || n.includes("soundscape") || n.includes("fireplace") || n.includes("relax")) return 999;

  return 50;
}

/** Render Shows (Series) only */
export function renderShows(container: HTMLElement): void {
  container.replaceChildren();
  const loading = buildRailSkeleton();
  container.append(loading);

  const hero = $("showsHero");
  if (hero) hero.setAttribute("hidden", "");

  getVodRails().then((rails: VodRail[]) => {
    loading.remove();
    const minRail = (showsSearchQuery || showsActiveGenre) ? 1 : 3;
    let showRails = sortRailsByTaste(
      rails
        .map((rail) => ({ name: rail.name, items: rail.items.filter((item) => item.series_id) }))
        .filter((rail) => rail.items.length >= minRail)
    );

    // Extract all unique genres for filter chips!
    const genresSet = new Set<string>();
    showRails.forEach((rail) => {
      rail.items.forEach((item) => {
        if (item.genre) genresSet.add(item.genre);
      });
    });
    const genres = Array.from(genresSet).sort();

    // Render Genre Filter Chips
    const chipsContainer = $("showsGenreFilters");
    if (chipsContainer) {
      renderFilterChips(chipsContainer, genres, showsActiveGenre, (genre) => {
        showsActiveGenre = genre;
        renderShows(container);
      });
    }

    // Apply active search query & genre filters
    if (showsSearchQuery || showsActiveGenre) {
      showRails = showRails.map((rail) => {
        const items = rail.items.filter((item) => {
          const matchesSearch = !showsSearchQuery || item.title.toLowerCase().includes(showsSearchQuery) || (item.summary && item.summary.toLowerCase().includes(showsSearchQuery));
          const matchesGenre = !showsActiveGenre || item.genre === showsActiveGenre;
          return matchesSearch && matchesGenre;
        });
        return { name: rail.name, items };
      }).filter((rail) => rail.items.length > 0);
    }

    if (!showRails.length) {
      const msg = document.createElement("div");
      msg.style.color = "var(--dim)";
      msg.style.padding = "24px";
      msg.textContent = "No shows match your filters. Try clearing the search or genre.";
      container.append(msg);
      return;
    }

    // Populate Hero spotlight show
    const firstShowRail = showRails[0];
    if (hero && firstShowRail && firstShowRail.items.length > 0) {
      const featured = firstShowRail.items[0];
      if (featured) {
        const bannerImg = featured.banner || featured.poster || "";
        hero.className = "vodHeroBlock";
        hero.style.backgroundImage = bannerImg ? `url(${bannerImg})` : "";
        hero.innerHTML = `
          <div class="vodHeroOverlay"></div>
          <div class="vodHeroContent">
            <span class="vodHeroGenre">${escapeHtml(featured.genre || "TV Show")}</span>
            <h2 class="vodHeroTitle">${escapeHtml(featured.title)}</h2>
            <div class="vodHeroMeta">${escapeHtml(featured.rating || "")}</div>
            <p class="vodHeroSummary">${escapeHtml(featured.summary)}</p>
          </div>
        `;
        hero.onclick = () => {
          void openVodDetails(featured);
        };
        hero.removeAttribute("hidden");
      }
    }

    const title = document.createElement("div");
    title.className = "sectionTitle";
    title.textContent = "On Demand TV Shows";
    container.append(title);

    for (const rail of showRails) {
      const el = document.createElement("div");
      el.className = "rail";
      el.innerHTML = `
        <div class="railHead">
          <div class="railHeadTitle">
            <h2>${escapeHtml(rail.name)}</h2>
            <span class="railTag">${rail.items.length} series</span>
          </div>
          <button class="railExpandBtn" style="display:inline-flex;align-items:center;gap:6px;">See All (${rail.items.length})<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg></button>
        </div>
      `;
      const scroller = document.createElement("div");
      scroller.className = "railScroll";

      rail.items.slice(0, 30).forEach((item) => scroller.append(vodCard(item)));

      const railHead = el.querySelector(".railHead") as HTMLElement;
      if (railHead) {
        railHead.onclick = (e) => {
          e.stopPropagation();
          openCategoryView(rail.name, rail.items);
        };
      }

      el.append(scroller);
      setupHorizontalScroll(scroller, el);
      container.append(el);
    }
  }).catch((err) => {
    loading.textContent = `Failed to load Shows: ${err}`;
  });
}

/** Render Movies only */
export function renderMovies(container: HTMLElement): void {
  container.replaceChildren();
  const loading = buildRailSkeleton();
  container.append(loading);

  const hero = $("moviesHero");
  if (hero) hero.setAttribute("hidden", "");

  getVodRails().then((rails: VodRail[]) => {
    loading.remove();
    const minRail = (moviesSearchQuery || moviesActiveGenre) ? 1 : 3;
    let movieRails = sortRailsByTaste(
      rails
        .map((rail) => ({ name: rail.name, items: rail.items.filter((item) => !item.series_id) }))
        .filter((rail) => rail.items.length >= minRail)
    );

    // Extract all unique genres for filter chips!
    const genresSet = new Set<string>();
    movieRails.forEach((rail) => {
      rail.items.forEach((item) => {
        if (item.genre) genresSet.add(item.genre);
      });
    });
    const genres = Array.from(genresSet).sort();

    // Render Genre Filter Chips
    const chipsContainer = $("moviesGenreFilters");
    if (chipsContainer) {
      renderFilterChips(chipsContainer, genres, moviesActiveGenre, (genre) => {
        moviesActiveGenre = genre;
        renderMovies(container);
      });
    }

    // Apply active search query & genre filters
    if (moviesSearchQuery || moviesActiveGenre) {
      movieRails = movieRails.map((rail) => {
        const items = rail.items.filter((item) => {
          const matchesSearch = !moviesSearchQuery || item.title.toLowerCase().includes(moviesSearchQuery) || (item.summary && item.summary.toLowerCase().includes(moviesSearchQuery));
          const matchesGenre = !moviesActiveGenre || item.genre === moviesActiveGenre;
          return matchesSearch && matchesGenre;
        });
        return { name: rail.name, items };
      }).filter((rail) => rail.items.length > 0);
    }

    if (!movieRails.length) {
      const msg = document.createElement("div");
      msg.style.color = "var(--dim)";
      msg.style.padding = "24px";
      msg.textContent = "No On Demand Movies available matching filters.";
      container.append(msg);
      return;
    }

    // Populate Hero spotlight movie
    const firstMovieRail = movieRails[0];
    if (hero && firstMovieRail && firstMovieRail.items.length > 0) {
      const featured = firstMovieRail.items[0];
      if (featured) {
        const bannerImg = featured.banner || featured.poster || "";
        hero.className = "vodHeroBlock";
        hero.style.backgroundImage = bannerImg ? `url(${bannerImg})` : "";
        hero.innerHTML = `
          <div class="vodHeroOverlay"></div>
          <div class="vodHeroContent">
            <span class="vodHeroGenre">${escapeHtml(featured.genre || "Movie")}</span>
            <h2 class="vodHeroTitle">${escapeHtml(featured.title)}</h2>
            <div class="vodHeroMeta">${escapeHtml(featured.rating || "")}</div>
            <p class="vodHeroSummary">${escapeHtml(featured.summary)}</p>
          </div>
        `;
        hero.onclick = () => {
          void openVodDetails(featured);
        };
        hero.removeAttribute("hidden");
      }
    }

    const title = document.createElement("div");
    title.className = "sectionTitle";
    title.textContent = "On Demand Movies";
    container.append(title);

    for (const rail of movieRails) {
      const el = document.createElement("div");
      el.className = "rail";
      el.innerHTML = `
        <div class="railHead">
          <div class="railHeadTitle">
            <h2>${escapeHtml(rail.name)}</h2>
            <span class="railTag">${rail.items.length} movies</span>
          </div>
          <button class="railExpandBtn" style="display:inline-flex;align-items:center;gap:6px;">See All (${rail.items.length})<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg></button>
        </div>
      `;
      const scroller = document.createElement("div");
      scroller.className = "railScroll";

      rail.items.slice(0, 30).forEach((item) => scroller.append(vodCard(item)));

      const railHead = el.querySelector(".railHead") as HTMLElement;
      if (railHead) {
        railHead.onclick = (e) => {
          e.stopPropagation();
          openCategoryView(rail.name, rail.items);
        };
      }

      el.append(scroller);
      setupHorizontalScroll(scroller, el);
      container.append(el);
    }
  }).catch((err) => {
    loading.textContent = `Failed to load Movies: ${err}`;
  });
}

/** Parent-facing kid-safe browse (the veedeeoh.kids sidebar shortcut). Always
 *  applies the kids gate regardless of the active profile, so a parent can hand
 *  the device to a child straight from their own profile. */
export async function renderKids(container: HTMLElement): Promise<void> {
  container.replaceChildren();
  const loading = buildRailSkeleton();
  container.append(loading);

  try {
    if (!cachedVodRails || cachedVodRails.length === 0) {
      const res = await fetchVod();
      if (res.rails?.length) cachedVodRails = res.rails;
    }
    const kidsRails = sortRailsByTaste(filterRailsForKids(cachedVodRails || []));
    loading.remove();

    const title = document.createElement("div");
    title.className = "sectionTitle";
    title.textContent = "veedeeoh.kids";
    container.append(title);

    if (kidsRails.length === 0) {
      const msg = document.createElement("div");
      msg.style.cssText = "color:var(--dim);padding:24px;";
      msg.textContent = "No kid-safe titles are available right now.";
      container.append(msg);
      return;
    }

    for (const rail of kidsRails) {
      const el = document.createElement("div");
      el.className = "rail";
      el.innerHTML = `
        <div class="railHead">
          <div class="railHeadTitle">
            <h2>${escapeHtml(rail.name)}</h2>
            <span class="railTag">${rail.items.length} titles</span>
          </div>
          <button class="railExpandBtn" style="display:inline-flex;align-items:center;gap:6px;">See All (${rail.items.length})<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg></button>
        </div>
      `;
      const scroller = document.createElement("div");
      scroller.className = "railScroll";
      rail.items.slice(0, 30).forEach((item) => scroller.append(vodCard(item)));
      const railHead = el.querySelector(".railHead") as HTMLElement;
      if (railHead) {
        railHead.onclick = (e) => { e.stopPropagation(); openCategoryView(rail.name, rail.items); };
      }
      el.append(scroller);
      setupHorizontalScroll(scroller, el);
      container.append(el);
    }
  } catch (err) {
    loading.textContent = `Failed to load veedeeoh.kids: ${err}`;
  }
}

/** Render Podcasts only */
let heroCarouselInterval: number | undefined;

export async function renderHome(): Promise<void> {
  const homeContainer = $("homeView");
  if (!homeContainer) return;
  homeContainer.replaceChildren();

  // Branded loader (usually invisible — the catalog is warmed during the bump).
  const loading = buildBrandLoader();
  homeContainer.append(loading);

  try {
    const rails = await getVodRails();
    loading.remove();

    // Recreate the Hero and Rails containers that were wiped by replaceChildren
    const hero = document.createElement("div");
    hero.id = "homeHero";
    hero.className = "vodHeroBlock";
    hero.style.display = "none";
    homeContainer.append(hero);

    const railsContainer = document.createElement("div");
    railsContainer.id = "homeRails";
    homeContainer.append(railsContainer);

    // 1. Continue Watching (Recent Resumes) from localStorage, per profile.
    const resumeHistoryStr = localStorage.getItem(resumeHistoryKey()) || "[]";
    let resumeHistory: any[] = [];
    try {
      resumeHistory = JSON.parse(resumeHistoryStr);
    } catch (e) {
      resumeHistory = [];
    }

    // Cross-device sync: merge Supabase exact timecodes
    const pid = activeProfileUuid();
    if (pid) {
      try {
        const cloudHistory = await getWatchHistory(pid);
        cloudHistory.forEach(cloudRow => {
          if (cloudRow.completed) {
            resumeHistory = resumeHistory.filter((x: any) => x.itemId !== cloudRow.content_id);
            return;
          }
          const localItem = resumeHistory.find((x: any) => x.itemId === cloudRow.content_id);
          if (localItem) {
            localItem.time = cloudRow.position_secs;
            if (cloudRow.duration_secs) {
              localItem.percentage = (cloudRow.position_secs / cloudRow.duration_secs) * 100;
            }
          }
        });
      } catch (e) {
        console.warn("[vod] getWatchHistory failed", e);
      }
    }

    // Belt-and-suspenders: a kids profile only ever sees kid-safe resume cards.
    if (getActiveProfile().is_kids) {
      resumeHistory = resumeHistory.filter((x: any) => isKidsSafeItem(x));
    }

    if (resumeHistory.length > 0) {
      const continueRail = document.createElement("div");
      continueRail.className = "rail";
      continueRail.innerHTML = `
        <div class="railHead">
          <h2>Continue Watching</h2>
          <span class="railTag">Resume where you left off</span>
        </div>
      `;
      const continueScroller = document.createElement("div");
      continueScroller.className = "railScroll";

      resumeHistory.forEach((item) => {
        const card = document.createElement("button");
        card.className = "continueCard";
        const imgUrl = item.banner || item.poster || "";
        card.innerHTML = `
          <div class="continueImage">
            ${imgUrl ? `<img loading="lazy" alt="" src="${escapeHtml(imgUrl)}">` : `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"></rect><line x1="7" y1="2" x2="7" y2="22"></line><line x1="17" y1="2" x2="17" y2="22"></line><line x1="2" y1="12" x2="22" y2="12"></line><line x1="2" y1="7" x2="7" y2="7"></line><line x1="2" y1="17" x2="7" y2="17"></line><line x1="17" y1="17" x2="22" y2="17"></line><line x1="17" y1="7" x2="22" y2="7"></line></svg>`}
            <div class="continueProgressWrap">
              <div class="continueProgressBar" style="width: ${item.percentage}%;"></div>
            </div>
          </div>
          <span class="showcaseTitle">${escapeHtml(item.title)}</span>
          <span class="showcaseMeta">${escapeHtml(item.episodeTitle || "Movie")}</span>
        `;
        card.onclick = () => {
          resumeVodPlayback(item);
        };
        continueScroller.append(card);
      });
      continueRail.append(continueScroller);
      setupHorizontalScroll(continueScroller, continueRail);
      railsContainer.append(continueRail);
    }

    // Clear interval if re-rendering
    if (heroCarouselInterval) clearInterval(heroCarouselInterval);

    // Flatten all items and extract a featured pool for the rotating hero.
    const allItems = rails.flatMap(r => r.items);
    const isKidsProfile = !!getActiveProfile().is_kids;
    // On an ADULT profile, the spotlight (hero + featured) should show grown-up,
    // mainstream titles, not kids content the backend pins to the front. Demote
    // anything that reads as kids/family: a G/TV-G-or-lower rating, an
    // animation/kids genre, or a kid signal in the title (baby, nursery, etc.).
    // Note: "animat" matches "Animation" but not "Anime", so anime is not demoted.
    const KID_SIGNAL = /\bkid|famil|child|preschool|cartoon|animat|toon|nursery|lullab|\bbaby\b|toddler|sing.?along|white noise|sleep sound/i;
    const kidsish = (i: any) => {
      const m = typeof i.maturity === "number" ? i.maturity : 5;
      if (m <= 2) return true; // G / TV-G / TV-Y / TV-Y7 -> not adult-spotlight material
      return KID_SIGNAL.test(`${i.genre || ""} ${i.title || ""}`);
    };
    const featuredRank = (i: any) => (isKidsProfile ? 0 : (kidsish(i) ? 1 : 0));
    const withBanner = allItems.filter(i => i.banner && i.banner.length > 0);
    const featuredPool = [...withBanner].sort((a, b) => featuredRank(a) - featuredRank(b)).slice(0, 5);
    if (featuredPool.length === 0) {
      featuredPool.push(...allItems.filter(i => i.poster && i.poster.length > 0).slice(0, 5));
    }

    // 2. Add Spotlight VOD Hero Carousel
    if (hero && featuredPool.length > 0) {
      let heroIdx = 0;
      
      const renderHero = () => {
        const featured = featuredPool[heroIdx];
        if (!featured) return;
        const bannerImg = featured.banner || featured.poster || "";
        hero.style.backgroundImage = bannerImg ? `url(${bannerImg})` : "";
        hero.innerHTML = `
          <div class="vodHeroOverlay"></div>
          <div class="vodHeroContent" style="animation: fadeIn 0.5s;">
            <span class="vodHeroGenre">${escapeHtml(featured.genre || "Featured Showcase")}</span>
            <h2 class="vodHeroTitle">${escapeHtml(featured.title)}</h2>
            <div class="vodHeroMeta">${escapeHtml(featured.rating || "TV-MA")}</div>
            <p class="vodHeroSummary">${escapeHtml(featured.summary || "Start watching now.")}</p>
            <div style="display: flex; gap: 10px; margin-top: 14px;">
              <button class="actionBtn primary" style="display:inline-flex;align-items:center;gap:8px;padding: 9px 18px; font-size: 13px; border-radius: 8px; font-weight: 700;">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="6 4 20 12 6 20 6 4"></polygon></svg>WATCH NOW
              </button>
              <button class="actionBtn" style="padding: 9px 16px; font-size: 13px; border-radius: 8px;">
                More Info
              </button>
            </div>
          </div>
          <div class="vodHeroCarouselDots">
            ${featuredPool.map((_, i) => `<div class="vodHeroDot ${i === heroIdx ? 'active' : ''}" data-idx="${i}"></div>`).join("")}
          </div>
        `;
        
        const dots = hero.querySelectorAll(".vodHeroDot");
        dots.forEach(d => {
           d.addEventListener("click", (e) => {
             e.stopPropagation();
             heroIdx = parseInt((e.target as HTMLElement).dataset.idx || "0");
             renderHero();
             resetInterval();
           });
        });
        
        hero.onclick = () => {
          void openVodDetails(featured);
        };
      };
      
      const resetInterval = () => {
        if (heroCarouselInterval) clearInterval(heroCarouselInterval);
        heroCarouselInterval = window.setInterval(() => {
          heroIdx = (heroIdx + 1) % featuredPool.length;
          renderHero();
        }, 8000);
      };
      
      renderHero();
      resetInterval();
      hero.style.display = "flex";
    }

    // 3. Separate TV and Movies, and Group by Genre
    const moviesItems = allItems.filter(i => (i.type === "movie" || (!i.series_id && i.type !== "series")) && i.type !== "podcast");
    const tvItems = allItems.filter(i => (i.type === "series" || i.series_id));
      
      const uniqueMovies = Array.from(new Map(moviesItems.map(m => [m.title, m])).values()).filter(i => i.poster || i.banner);
      const uniqueTv = Array.from(new Map(tvItems.map(m => [m.title, m])).values()).filter(i => i.poster || i.banner);
    
    const groupIntoGenres = (items: VodItem[]) => {
      const groups: Record<string, VodItem[]> = {};
      items.forEach(item => {
        const g = (item.genre || "").trim() || "__none";
        (groups[g] = groups[g] || []).push(item);
      });
      return groups;
    };

    const movieGenres = groupIntoGenres(uniqueMovies);
    const tvGenres = groupIntoGenres(uniqueTv);
    
    const renderGenreRail = (title: string, items: VodItem[], prioritizeBanner: boolean) => {
      if (items.length === 0) return;
      const el = document.createElement("div");
      el.className = "showcaseRail";
      el.innerHTML = `
        <div class="showcaseRailHead">
          <div class="showcaseRailHeadTitle">
            <h2>${escapeHtml(title)}</h2>
          </div>
          <button class="railExpandBtn" style="display:inline-flex;align-items:center;gap:6px;">See All (${items.length})<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg></button>
        </div>
      `;
      const scroller = document.createElement("div");
      scroller.className = "showcaseScroll";

      items.slice(0, 20).forEach((item: VodItem) => {
        const card = document.createElement("button");
        const useBanner = prioritizeBanner && item.banner;
        card.className = useBanner ? "showcaseCard" : "posterCard";
        card.title = item.summary || item.title;
        
        const imgUrl = useBanner ? item.banner : (item.poster || item.banner || "");
        const imageClass = useBanner ? "showcasePoster" : "posterImage";
        
        card.innerHTML = `
          <span class="${imageClass}">${imgUrl ? `<img loading="lazy" alt="" src="${escapeHtml(imgUrl)}">` : FILM_ICON}</span>
          <span class="showcaseTitle">${escapeHtml(item.title)}</span>
          <span class="showcaseMeta">${escapeHtml([item.genre, item.rating].filter(Boolean).join(" · "))}</span>
        `;
        card.onclick = () => {
          void openVodDetails(item);
        };
        scroller.append(card);
      });

      const head = el.querySelector(".showcaseRailHead") as HTMLElement;
      if (head) {
        head.onclick = (e) => {
          e.stopPropagation();
          openCategoryView(title, items);
        };
      }

      el.append(scroller);
      setupHorizontalScroll(scroller, el);
      railsContainer.append(el);
    };

    const taste = getTasteGenres();
    const history = getResumeHistory();
    const strip = (id?: string) => (id || "").replace("vod:", "");

    // "Because you watched ..." — same genre as the most recent resume, excluding
    // what's already in progress.
    if (history[0]?.genre && history[0]?.title) {
      const g = history[0].genre;
      const inProgress = new Set(history.map((h: any) => h.itemId));
      const recs = [...uniqueMovies, ...uniqueTv]
        .filter(i => i.genre === g && !inProgress.has(strip(i.id)))
        .slice(0, 20);
      if (recs.length >= 4) renderGenreRail(`Because you watched ${history[0].title}`, recs, true);
    }

    // Popular on veedeeoh — real aggregate plays. Hidden until there's enough data.
    try {
      const { getPopularContentIds } = await import("./db");
      const popular = await getPopularContentIds(20);
      if (popular.length) {
        const byId = new Map<string, VodItem>();
        [...uniqueMovies, ...uniqueTv].forEach(i => byId.set(strip(i.id), i));
        const items = popular.map(p => byId.get(p.content_id)).filter(Boolean) as VodItem[];
        if (items.length >= 4) renderGenreRail("Popular on veedeeoh", items, true);
      }
    } catch {}

    // Featured banners — only as a fallback when we have nothing personalized yet.
    // Non-kids content leads on an adult profile.
    if (taste.length === 0 && history.length === 0) {
      const featured = [...uniqueMovies, ...uniqueTv]
        .filter(i => i.banner)
        .sort((a, b) => featuredRank(a) - featuredRank(b))
        .slice(0, 20);
      if (featured.length >= 4) renderGenreRail("Featured on veedeeoh", featured, true);
    }

    // Genre rails ordered by the profile's taste first, then editorial priority,
    // then size (so ambient/sleep sink and the biggest relevant rails rise).
    const orderGenres = (entries: [string, VodItem[]][]) =>
      entries.filter(([g]) => g !== "__none").sort(([a, ia], [b, ib]) => {
        const ra = taste.indexOf(a) === -1 ? 999 : taste.indexOf(a);
        const rb = taste.indexOf(b) === -1 ? 999 : taste.indexOf(b);
        if (ra !== rb) return ra - rb;
        const pa = getRailPriorityScore(a), pb = getRailPriorityScore(b);
        if (pa !== pb) return pa - pb;
        return ib.length - ia.length;
      });

    orderGenres(Object.entries(movieGenres)).forEach(([genre, items]) => {
      if (items.length >= 3) renderGenreRail(`${genre} Movies`, items, false);
    });
    orderGenres(Object.entries(tvGenres)).forEach(([genre, items]) => {
      if (items.length >= 3) renderGenreRail(`${genre} TV`, items, false);
    });

    // Catch-all so ungenred or tiny-genre titles are never silently dropped.
    const leftover = (groups: Record<string, VodItem[]>) => [
      ...(groups["__none"] || []),
      ...Object.entries(groups).filter(([g, it]) => g !== "__none" && it.length < 3).flatMap(([, it]) => it),
    ];
    const moreMovies = leftover(movieGenres);
    if (moreMovies.length >= 4) renderGenreRail("More Movies", moreMovies, false);
    const moreTv = leftover(tvGenres);
    if (moreTv.length >= 4) renderGenreRail("More Series", moreTv, false);
  } catch (err) {
    loading.textContent = `Failed to load Home dashboard: ${err}`;
  }
}
