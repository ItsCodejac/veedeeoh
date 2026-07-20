import Hls from "hls.js";
import { $ } from "./util";
import { AudioVisualizer } from "./visualizer";

interface PartyTrack {
  id: string;
  title: string;
  url: string;
  type: "live" | "vod";
  poster: string | null;
  genre: string;
  summary: string;
}

let tracks: PartyTrack[] = [];
let currentIndex = -1;
let currentMood = "chillout";
let isPlaying = false;

// Double buffer elements
let hlsA: Hls | null = null;
let hlsB: Hls | null = null;
let videoA: HTMLVideoElement | null = null;
let videoB: HTMLVideoElement | null = null;
let activePlayer: "A" | "B" = "A";
let nextPreloaded = false;

// Web Audio API
let audioCtx: AudioContext | null = null;
let analyser: AnalyserNode | null = null;
let visualizer: AudioVisualizer | null = null;

export function openPartyPlayer(initialTracks: PartyTrack[], startIdx: number = 0, initialMood?: string): void {
  const overlay = $("partyPlayerOverlay");
  overlay.removeAttribute("hidden");

  videoA = $<HTMLVideoElement>("partyVideoA");
  videoB = $<HTMLVideoElement>("partyVideoB");

  // Reset states
  videoA.src = "";
  videoB.src = "";
  videoA.className = "";
  videoB.className = "";
  videoA.volume = 1.0;
  videoB.volume = 1.0;

  tracks = initialTracks;
  currentIndex = startIdx;
  nextPreloaded = false;
  activePlayer = "A";

  if (initialMood) {
    currentMood = initialMood;
    // Highlight the active mood chip
    document.querySelectorAll(".moodChip").forEach((c) => {
      const btn = c as HTMLButtonElement;
      btn.classList.toggle("active", btn.dataset.mood === initialMood);
    });
  }

  // Wire controls
  wirePartyControls();

  renderQueue();
  if (tracks.length > 0) {
    loadTrack(currentIndex, "A");
    const track = tracks[currentIndex];
    if (track) {
      updateTrackInfo(track);
    }
  }

  // Initialize Web Audio and start visualizer
  startPlayback();
}

export function closePartyPlayer(): void {
  const overlay = $("partyPlayerOverlay");
  overlay.setAttribute("hidden", "");
  destroyPartyMode();
}

export function destroyPartyMode(): void {
  isPlaying = false;
  
  // Destroy HLS instances
  if (hlsA) {
    hlsA.destroy();
    hlsA = null;
  }
  if (hlsB) {
    hlsB.destroy();
    hlsB = null;
  }

  // Clear sources
  if (videoA) {
    videoA.pause();
    videoA.src = "";
    videoA.load();
    videoA.ontimeupdate = null;
    videoA.onended = null;
  }
  if (videoB) {
    videoB.pause();
    videoB.src = "";
    videoB.load();
    videoB.ontimeupdate = null;
    videoB.onended = null;
  }

  // Stop Web Audio visualizer
  if (visualizer) {
    visualizer.stop();
    visualizer = null;
  }

  if (audioCtx) {
    void audioCtx.close();
    audioCtx = null;
    analyser = null;
  }

  const playBtn = $("partyPlayBtn");
  if (playBtn) playBtn.textContent = "▶ PLAY";
}


function wirePartyControls(): void {
  // Back/Close overlay button
  $("partyPlayerClose").onclick = () => {
    closePartyPlayer();
  };

  // Play/Pause button
  const playBtn = $("partyPlayBtn");
  playBtn.onclick = () => {
    if (!isPlaying) {
      startPlayback();
    } else {
      pausePlayback();
    }
  };

  // Next Track button
  const nextBtn = $("partyNextBtn");
  nextBtn.onclick = () => {
    playNext();
  };

  // Mood chips
  document.querySelectorAll(".moodChip").forEach((chip) => {
    chip.addEventListener("click", (e) => {
      document.querySelectorAll(".moodChip").forEach((c) => c.classList.remove("active"));
      const btn = e.currentTarget as HTMLButtonElement;
      btn.classList.add("active");
      const mood = btn.dataset.mood || "chillout";
      void changeMood(mood);
    });
  });

  // Visualizer style buttons
  const barsBtn = $("visStyleBars");
  const waveBtn = $("visStyleWave");
  
  barsBtn.onclick = () => {
    barsBtn.classList.add("active");
    waveBtn.classList.remove("active");
    if (visualizer) visualizer.setMode("frequency-bars");
  };
  
  waveBtn.onclick = () => {
    waveBtn.classList.add("active");
    barsBtn.classList.remove("active");
    if (visualizer) visualizer.setMode("circular-wave");
  };
}

async function changeMood(mood: string): Promise<void> {
  currentMood = mood;
  destroyPartyMode(); // Clear active streams
  
  const tracksList = $("partyQueueList");
  tracksList.innerHTML = `<div style="color: var(--dim); padding: 12px; font-size: 13px;">Loading playlist...</div>`;

  try {
    const resp = await fetch(`/api/party?mood=${mood}`);
    const data = await resp.json();
    tracks = data.tracks || [];
    currentIndex = 0;
    nextPreloaded = false;
    activePlayer = "A";

    renderQueue();
    if (tracks.length > 0) {
      loadTrack(0, "A");
      const track0 = tracks[0];
      if (track0) {
        updateTrackInfo(track0);
      }
    }
  } catch (err) {
    tracksList.innerHTML = `<div style="color: #ff5252; padding: 12px; font-size: 13px;">Failed to load mood: ${err}</div>`;
  }
}

function renderQueue(): void {
  const list = $("partyQueueList");
  list.replaceChildren();

  tracks.forEach((t, i) => {
    const card = document.createElement("button");
    card.className = `partyQueueCard${i === currentIndex ? " active" : ""}`;
    card.innerHTML = `
      <div class="partyQueueThumb" style="background-image: ${t.poster ? `url(${t.poster})` : "none"}; background-size: cover; background-position: center;">
        ${!t.poster ? "🎵" : ""}
      </div>
      <div class="partyQueueMeta">
        <span class="partyQueueTitle">${t.title}</span>
        <span class="partyQueueSubtitle">${t.genre} · ${t.type.toUpperCase()}</span>
      </div>
    `;
    card.addEventListener("click", () => {
      playTrackIndex(i);
    });
    list.append(card);
  });
}

function updateTrackInfo(track: PartyTrack): void {
  $("partyTrackTitle").textContent = track.title;
  $("partyTrackGenre").textContent = track.genre;
  $("partyTrackSummary").textContent = track.summary || "No description available.";
  
  // Update active queue item class
  const cards = document.querySelectorAll(".partyQueueCard");
  cards.forEach((c, i) => {
    c.classList.toggle("active", i === currentIndex);
  });
}

function initAudioContext(): void {
  if (audioCtx) return;
  try {
    const Win = window as any;
    const AudioContextClass = Win.AudioContext || Win.webkitAudioContext;
    const ctx = new AudioContextClass();
    audioCtx = ctx;
    const node = ctx.createAnalyser();
    analyser = node;
    node.fftSize = 256;

    if (videoA && videoB) {
      const srcA = ctx.createMediaElementSource(videoA);
      const srcB = ctx.createMediaElementSource(videoB);
      srcA.connect(node);
      srcB.connect(node);
      node.connect(ctx.destination);
    }
  } catch (e) {
    console.error("Web Audio API not supported", e);
  }
}

function loadTrack(idx: number, target: "A" | "B"): void {
  const track = tracks[idx];
  if (!track) return;

  const video = target === "A" ? videoA! : videoB!;
  const proxiedUrl = `/proxy?url=${encodeURIComponent(track.url)}`;

  // Cleanup old HLS if any
  if (target === "A" && hlsA) {
    hlsA.destroy();
    hlsA = null;
  } else if (target === "B" && hlsB) {
    hlsB.destroy();
    hlsB = null;
  }

  video.src = "";
  video.load();

  if (/\.(mp4|m4v|webm|ogv)(\?|$)/i.test(track.url)) {
    video.src = proxiedUrl;
  } else if (Hls.isSupported()) {
    const hls = new Hls({
      maxBufferLength: 15,
      manifestLoadingTimeOut: 30000,
      levelLoadingTimeOut: 30000,
      fragLoadingTimeOut: 30000,
    });
    hls.loadSource(proxiedUrl);
    hls.attachMedia(video);
    if (target === "A") hlsA = hls;
    else hlsB = hls;
  } else {
    video.src = proxiedUrl;
  }

  // Wire buffer transitions
  video.ontimeupdate = () => {
    if (activePlayer !== target || nextPreloaded) return;
    
    // Grab next track when current hits 90% or when under 15s remain
    if (video.duration > 0 && (video.currentTime / video.duration > 0.88 || video.duration - video.currentTime < 15)) {
      preloadNextTrack();
    }
  };

  video.onended = () => {
    if (activePlayer === target) {
      playNext();
    }
  };
}

function preloadNextTrack(): void {
  if (nextPreloaded || tracks.length <= 1) return;
  nextPreloaded = true;

  const nextIdx = (currentIndex + 1) % tracks.length;
  const standbyTarget = activePlayer === "A" ? "B" : "A";
  const standbyVideo = standbyTarget === "A" ? videoA! : videoB!;
  
  // Set initial standby volume and class
  standbyVideo.volume = 0;
  standbyVideo.className = ""; // Unassigned opacity

  loadTrack(nextIdx, standbyTarget);
  // Auto-play loading in background
  if (isPlaying) {
    standbyVideo.play().catch(() => {});
  }
}

function startPlayback(): void {
  isPlaying = true;
  $("partyPlayBtn").textContent = "⏸ PAUSE";

  // Resume Web Audio Context if suspended
  if (audioCtx && audioCtx.state === "suspended") {
    void audioCtx.resume();
  } else {
    initAudioContext();
  }

  const activeVideo = activePlayer === "A" ? videoA! : videoB!;
  activeVideo.className = "active";
  activeVideo.volume = 1.0;
  activeVideo.play().catch(() => {});
}

function pausePlayback(): void {
  isPlaying = false;
  $("partyPlayBtn").textContent = "▶ PLAY";

  if (videoA) videoA.pause();
  if (videoB) videoB.pause();
}

function playTrackIndex(idx: number): void {
  const track = tracks[idx];
  if (!track) return;
  currentIndex = idx;
  nextPreloaded = false;
  activePlayer = "A";
  
  if (videoA) {
    videoA.className = "active";
    videoA.volume = 1.0;
  }
  if (videoB) {
    videoB.className = "";
    videoB.volume = 0;
  }

  loadTrack(idx, "A");
  updateTrackInfo(track);

  if (isPlaying) {
    videoA?.play().catch(() => {});
  } else {
    startPlayback();
  }
}

function playNext(): void {
  if (tracks.length === 0) return;

  const nextIdx = (currentIndex + 1) % tracks.length;
  const oldPlayer = activePlayer;
  const newPlayer = oldPlayer === "A" ? "B" : "A";

  const oldVideo = oldPlayer === "A" ? videoA! : videoB!;
  const newVideo = newPlayer === "A" ? videoA! : videoB!;

  // Crossfade Transition!
  // 1. Swap active visual classes
  oldVideo.className = "";
  newVideo.className = "active";

  // 2. Automate Audio Fade
  newVideo.volume = 0;
  if (isPlaying) {
    newVideo.play().catch(() => {});
  }

  // Crossfade loop over 3 seconds
  let start: number | null = null;
  const fadeDuration = 3000;

  const crossfade = (timestamp: number) => {
    if (!start) start = timestamp;
    const progress = timestamp - start;
    const ratio = Math.min(progress / fadeDuration, 1.0);

    oldVideo.volume = 1.0 - ratio;
    newVideo.volume = ratio;

    if (progress < fadeDuration && isPlaying) {
      requestAnimationFrame(crossfade);
    } else {
      // Transition complete! Cleanup old stream.
      oldVideo.pause();
      oldVideo.src = "";
      oldVideo.load();
      if (oldPlayer === "A" && hlsA) {
        hlsA.destroy();
        hlsA = null;
      } else if (oldPlayer === "B" && hlsB) {
        hlsB.destroy();
        hlsB = null;
      }
    }
  };

  requestAnimationFrame(crossfade);

  // Update states
  currentIndex = nextIdx;
  activePlayer = newPlayer;
  nextPreloaded = false;

  const currentTrack = tracks[currentIndex];
  if (currentTrack) {
    updateTrackInfo(currentTrack);
  }
}

function initVisualizer(): void {
  const canvas = $<HTMLCanvasElement>("partyVisualizer");
  if (!analyser) return;

  if (visualizer) {
    visualizer.stop();
  }

  visualizer = new AudioVisualizer(canvas, analyser);
  visualizer.start();

  // Sync active UI buttons
  const activeStyle = $("visStyleBars").classList.contains("active") ? "frequency-bars" : "circular-wave";
  visualizer.setMode(activeStyle);
}
