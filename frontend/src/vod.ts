import Hls from "hls.js";
import { fetchArchiveStream, fetchVod, fetchVodSeries, toggleWatched } from "./api";
import { state } from "./state";
import type { Stream, VodItem, VodEpisode, VodRail } from "./types";
import { escapeHtml, $, setupHorizontalScroll } from "./util";

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
  if (cachedVodRails) return cachedVodRails;
  cachedVodRails = await fetchVod();
  return cachedVodRails;
}

function saveResumeProgress(ch: any, streamIdx: number, time: number, duration: number, percentage: number): void {
  if (Date.now() - lastSaveTime < 3000) return;
  lastSaveTime = Date.now();

  const itemId = ch.id.replace("vod:", "");
  const stream = ch.streams[streamIdx];
  if (!stream) return;

  const historyStr = localStorage.getItem("tvlc_resume_history") || "[]";
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

  localStorage.setItem("tvlc_resume_history", JSON.stringify(history));
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

export function openVodPlayer(ch: any, streamIdx: number, startTime: number = 0): void {
  const overlay = $("vodPlayerOverlay");
  const video = $<HTMLVideoElement>("vodVideo");
  const title = $("vodPlayerTitle");
  
  const playBtn = $("vodPlayBtn");
  const bigPlayBtn = $("vodBigPlayBtn");
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

  const togglePlay = () => {
    if (video.paused) {
      void video.play();
    } else {
      video.pause();
    }
  };
  playBtn.onclick = togglePlay;
  bigPlayBtn.onclick = togglePlay;
  video.onclick = togglePlay;

  rewindBtn.onclick = () => {
    video.currentTime = Math.max(0, video.currentTime - 10);
    onMouseMove();
  };
  forwardBtn.onclick = () => {
    video.currentTime = Math.min(video.duration, video.currentTime + 10);
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

  const handleKeyDown = (e: KeyboardEvent) => {
    if (overlay.hasAttribute("hidden")) return;

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
    
    const streamSourceUrl = url.startsWith("http") ? url : proxiedUrl;

    if (/\.(mp4|m4v|webm|ogv)(\?|$)/i.test(url)) {
      video.src = streamSourceUrl;
      void video.play().catch(() => {});
    } else if (Hls.isSupported()) {
      vodHls = new Hls({
        maxBufferLength: 15,
        manifestLoadingTimeOut: 30000,
        levelLoadingTimeOut: 30000,
        fragLoadingTimeOut: 30000,
        startPosition: idx === streamIdx ? startTime : -1,
      });
      vodHls.loadSource(streamSourceUrl);
      vodHls.attachMedia(video);
      vodHls.on(Hls.Events.MANIFEST_PARSED, () => {
        void video.play().catch(() => {});
      });
      vodHls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) {
          console.warn("HLS fatal error, trying proxy fallback:", data.type);
          if (vodHls) {
            vodHls.destroy();
            vodHls = null;
          }
          if (video.src !== proxiedUrl) {
            video.src = proxiedUrl;
            void video.play().catch(() => {});
          }
        }
      });
    } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = streamSourceUrl;
      video.addEventListener("loadedmetadata", () => {
        void video.play().catch(() => {});
      }, { once: true });
    } else {
      video.src = streamSourceUrl;
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
    poster.textContent = "🎬";
  }

  // Populate metadata
  $("vdTitle").textContent = item.title;
  $("vdMeta").textContent = [item.genre, item.rating].filter(Boolean).join(" · ");
  $("vdSummary").textContent = item.summary || "No description available.";

  const selectContainer = $("vdSelectorContainer");
  const select = $<HTMLSelectElement>("vdSeasonSelect");
  const grid = $("vdEpisodeGrid");
  const playBtn = $<HTMLButtonElement>("vdPlayBtn");

  selectContainer.hidden = true;
  select.replaceChildren();
  grid.replaceChildren();
  playBtn.onclick = null;

  // 1. Movie item
  if (item.url) {
    selectContainer.hidden = true;
    
    const playMovie = () => {
      openVodPlayer(asChannel(item, [{ url: item.url!, quality: null, source: item.genre || "movie" }]), 0);
    };

    playBtn.onclick = playMovie;
    playBtn.textContent = "▶ PLAY MOVIE";

    const durationText = item.duration ? `${Math.round(item.duration / 60)}m` : "";

    const card = document.createElement("button");
    card.className = "episodeCard";
    card.innerHTML = `
      <div class="epThumbWrap">
        ${bannerImg ? `<img loading="lazy" alt="" src="${escapeHtml(bannerImg)}">` : `<div style="padding: 40px; text-align: center;">🎬</div>`}
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
          // Duration format (ms to minutes)
          const durationStr = ep.duration ? `${Math.round(ep.duration / 60000)}m` : "";

          card.innerHTML = `
            <div class="epThumbWrap">
              ${epThumb ? `<img loading="lazy" alt="" src="${escapeHtml(epThumb)}">` : `<div style="padding: 40px; text-align: center;">🎬</div>`}
              <div class="epPlayOverlay">▶</div>
              ${isWatched ? `<div class="epCardWatchedBadge">✓ WATCHED</div>` : ""}
              ${durationStr ? `<div class="epDuration">${durationStr}</div>` : ""}
            </div>
            <div class="epMeta">
              <span class="epShowTitle">${escapeHtml(item.title.toUpperCase())}</span>
              <div class="epTitleRow">
                <span class="epTitle">E${ep.number ?? "?"} - ${escapeHtml(ep.title || "Episode")}</span>
                <button class="epWatchedToggle" title="${isWatched ? "Mark unwatched" : "Mark watched"}">✓</button>
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
                badge.textContent = "✓ WATCHED";
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
        ${bannerImg ? `<img loading="lazy" alt="" src="${escapeHtml(bannerImg)}">` : `<div style="padding: 40px; text-align: center;">🎬</div>`}
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
    <span class="vodPoster">${item.poster ? `<img loading="lazy" alt="" src="${escapeHtml(item.poster)}">` : "🎬"}</span>
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

/** Render Shows (Series) only */
export function renderShows(container: HTMLElement): void {
  container.replaceChildren();
  const loading = document.createElement("div");
  loading.style.color = "var(--dim)";
  loading.style.padding = "24px";
  loading.textContent = "Loading Shows...";
  container.append(loading);

  const hero = $("showsHero");
  if (hero) hero.setAttribute("hidden", "");

  getVodRails().then((rails: VodRail[]) => {
    loading.remove();
    let showRails = rails
      .map((rail) => {
        const items = rail.items.filter((item) => item.series_id);
        return { name: rail.name, items };
      })
      .filter((rail) => rail.items.length > 0);

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
      const debugInfo = `DEBUG: rails.length=${rails.length}, rails[0].items.length=${rails[0]?.items?.length}, type=${rails[0]?.items?.[0]?.type}, series_id=${rails[0]?.items?.[0]?.series_id}`;
      msg.textContent = `No On Demand Shows available matching filters. (${debugInfo})`;
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
          <h2>${escapeHtml(rail.name)}</h2>
          <span class="railTag">${rail.items.length} series</span>
        </div>
      `;
      const scroller = document.createElement("div");
      scroller.className = "railScroll";
      for (const item of rail.items.slice(0, 30)) {
        scroller.append(vodCard(item));
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
  const loading = document.createElement("div");
  loading.style.color = "var(--dim)";
  loading.style.padding = "24px";
  loading.textContent = "Loading Movies...";
  container.append(loading);

  const hero = $("moviesHero");
  if (hero) hero.setAttribute("hidden", "");

  getVodRails().then((rails: VodRail[]) => {
    loading.remove();
    let movieRails = rails
      .map((rail) => {
        const items = rail.items.filter((item) => !item.series_id);
        return { name: rail.name, items };
      })
      .filter((rail) => rail.items.length > 0);

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
          <h2>${escapeHtml(rail.name)}</h2>
          <span class="railTag">${rail.items.length} movies</span>
        </div>
      `;
      const scroller = document.createElement("div");
      scroller.className = "railScroll";
      for (const item of rail.items.slice(0, 30)) {
        scroller.append(vodCard(item));
      }
      el.append(scroller);
      setupHorizontalScroll(scroller, el);
      container.append(el);
    }
  }).catch((err) => {
    loading.textContent = `Failed to load Movies: ${err}`;
  });
}

/** Render Podcasts only */
let heroCarouselInterval: number | undefined;

export async function renderHome(): Promise<void> {
  const homeContainer = $("homeView");
  if (!homeContainer) return;
  homeContainer.replaceChildren();

  // Create loading indicator
  const loading = document.createElement("div");
  loading.style.color = "var(--dim)";
  loading.style.padding = "24px";
  loading.textContent = "Loading Home Screen...";
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

    // 1. Continue Watching (Recent Resumes) from localStorage
    const resumeHistoryStr = localStorage.getItem("tvlc_resume_history") || "[]";
    let resumeHistory: any[] = [];
    try {
      resumeHistory = JSON.parse(resumeHistoryStr);
    } catch (e) {
      resumeHistory = [];
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
            ${imgUrl ? `<img loading="lazy" alt="" src="${escapeHtml(imgUrl)}">` : "🎬"}
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

    // Flatten all items and extract a featured pool for the rotating hero
    const allItems = rails.flatMap(r => r.items);
    const featuredPool = allItems.filter(i => i.banner && i.banner.length > 0).slice(0, 5);
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
            <div style="display: flex; gap: 16px; margin-top: 16px;">
              <button class="actionBtn primary" style="padding: 12px 32px; font-size: 16px; border-radius: 8px; font-weight: 700;">
                ▶ WATCH NOW
              </button>
              <button class="actionBtn" style="padding: 12px 24px; font-size: 16px; border-radius: 8px;">
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
    const tvItems = allItems.filter(i => i.type === "series" || i.series_id);
    
    const uniqueMovies = Array.from(new Map(moviesItems.map(m => [m.title, m])).values()).filter(i => i.poster || i.banner);
    const uniqueTv = Array.from(new Map(tvItems.map(m => [m.title, m])).values()).filter(i => i.poster || i.banner);
    
    const groupIntoGenres = (items: VodItem[], fallbackGenre: string) => {
      const groups: Record<string, VodItem[]> = {};
      items.forEach(item => {
        const g = item.genre || fallbackGenre;
        if (!groups[g]) groups[g] = [];
        groups[g].push(item);
      });
      return groups;
    };

    const movieGenres = groupIntoGenres(uniqueMovies, "Hit Films");
    const tvGenres = groupIntoGenres(uniqueTv, "Binge-Worthy Series");
    
    const renderGenreRail = (title: string, items: VodItem[], prioritizeBanner: boolean) => {
      if (items.length === 0) return;
      const el = document.createElement("div");
      el.className = "showcaseRail";
      el.innerHTML = `
        <div class="showcaseRailHead">
          <h2>${escapeHtml(title)}</h2>
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
          <span class="${imageClass}">${imgUrl ? `<img loading="lazy" alt="" src="${escapeHtml(imgUrl)}">` : "🎬"}</span>
          <span class="showcaseTitle">${escapeHtml(item.title)}</span>
          <span class="showcaseMeta">${escapeHtml([item.genre, item.rating].filter(Boolean).join(" · "))}</span>
        `;
        card.onclick = () => {
          void openVodDetails(item);
        };
        scroller.append(card);
      });
      el.append(scroller);
      setupHorizontalScroll(scroller, el);
      railsContainer.append(el);
    };

    // Render Featured / Top Level (Banners)
    renderGenreRail("Trending Movies", uniqueMovies.filter(m => m.banner), true);
    renderGenreRail("Popular Series", uniqueTv.filter(t => t.banner), true);

    // Render Genre Rails (Posters)
    Object.entries(movieGenres).forEach(([genre, items]) => {
      if (items.length >= 3 && genre !== "Hit Films") {
        renderGenreRail(`${genre} Movies`, items, false);
      }
    });
    
    Object.entries(tvGenres).forEach(([genre, items]) => {
      if (items.length >= 3 && genre !== "Binge-Worthy Series") {
        renderGenreRail(`${genre} TV`, items, false);
      }
    });
  } catch (err) {
    loading.textContent = `Failed to load Home dashboard: ${err}`;
  }
}
