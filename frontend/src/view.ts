import Hls from "hls.js";
import { checkStream } from "./api";
import { card, setLogo, stopHoverPreview, updateCardNow } from "./cards";
import { openPlayer } from "./player";
import { categoryNames, chMeta, countryNames, filters, isDead, onNow, rank, state, visible } from "./state";
import type { Channel, VodRail, VodItem } from "./types";
import { $, escapeHtml, isGeoBlockBumper } from "./util";
import { getVodRails, resumeVodPlayback, openVodDetails } from "./vod";

const BATCH = 120;
const grid = () => $("grid");

export const VIBE_MAP: Record<string, string[]> = {
  "cartoon breakfast.": ["anime-gaming", "anime", "kids", "animation", "animated"],
  "doomscroll.": ["news", "business", "weather"],
  "the lock-in.": ["sports", "sports-outdoors"],
  "sub'd not dub'd.": ["international", "foreign", "subtitled"],
  "static.": ["classic", "western-classic-tv", "movies"],
  "graveyard.": ["paranormal", "horror", "thriller"]
};

export function renderVibeBlocks(): void {
  const row = $("vibeBlocksRow");
  if (!row) return;
  row.replaceChildren();

  const blocks = [
    { name: "cartoon breakfast.", desc: "toons, anime, cereal energy", icon: "🥞" },
    { name: "doomscroll.", desc: "rolling news, all timezones", icon: "📰" },
    { name: "the lock-in.", desc: "match day never ends", icon: "⚽" },
    { name: "sub'd not dub'd.", desc: "the world, subtitled", icon: "💬" },
    { name: "static.", desc: "b-movies, oddities, retro", icon: "📺" },
    { name: "graveyard.", desc: "for the 3am crowd", icon: "💀" }
  ];

  blocks.forEach((b) => {
    const card = document.createElement("div");
    card.className = "vibeCard";
    if (state.activeVibe === b.name) card.classList.add("active");
    card.innerHTML = `
      <div class="vibeIcon">${b.icon}</div>
      <span class="vibeName">${b.name}</span>
      <span class="vibeDesc">${b.desc}</span>
    `;
    card.addEventListener("click", () => {
      if (state.activeVibe === b.name) {
        state.activeVibe = null;
        card.classList.remove("active");
      } else {
        state.activeVibe = b.name;
        row.querySelectorAll(".vibeCard").forEach((c) => c.classList.remove("active"));
        card.classList.add("active");
      }
      applyFilters();
    });
    row.append(card);
  });
}

export function applyFilters(): void {
  const f = filters();
  destroyHero();
  stopHoverPreview();

  // Auto-switch to Live TV if a filter is set and we're not already on Live TV
  const tabLive = document.getElementById("tabLive");
  if ((f.q || f.country || f.category || f.favorites) && tabLive && !tabLive.classList.contains("active")) {
    tabLive.click();
    return;
  }

  let hiddenDead = 0;
  state.filtered = visible().filter((ch) => {
    if (f.country && ch.country !== f.country) return false;
    if (f.category && !ch.categories.includes(f.category)) return false;
    if (state.activeVibe) {
      const vibeCats = VIBE_MAP[state.activeVibe] || [];
      if (!ch.categories.some((c) => vibeCats.includes(c))) return false;
    }
    if (
      f.q &&
      !ch.name.toLowerCase().includes(f.q) &&
      !onNow(ch)?.title.toLowerCase().includes(f.q) // search what's playing too
    ) {
      return false;
    }
    if (f.favorites && !state.favorites.has(ch.id)) return false;
    if (f.hideDead && isDead(ch)) {
      hiddenDead++;
      return false;
    }
    return true;
  });

  // known-dead channels sink to the bottom, favorites float to the top
  state.filtered.sort((a, b) => rank(a) - rank(b));
  $("stats").textContent = `${state.filtered.length.toLocaleString()} channels` +
    (hiddenDead ? ` (${hiddenDead.toLocaleString()} dead hidden)` : "");
  grid().replaceChildren();
  state.rendered = 0;
  renderMore();
}

export function renderMore(): void {
  const slice = state.filtered.slice(state.rendered, state.rendered + BATCH);
  for (const ch of slice) grid().append(card(ch, state.filtered));
  state.rendered += slice.length;
}

/** Show an explicit channel list in the grid (for name-swept collections
 * that no single category filter can reproduce). */
function showCollection(title: string, channels: Channel[]): void {
  destroyHero();
  stopHoverPreview();
  
  // Switch to Live TV view when opening a collection from Home
  const tabLive = document.getElementById("tabLive");
  if (tabLive && !tabLive.classList.contains("active")) {
    tabLive.click();
  }

  state.filtered = [...channels].sort((a, b) => rank(a) - rank(b));
  state.rendered = 0;
  $("stats").textContent = `${state.filtered.length.toLocaleString()} channels · ${title}`;
  grid().replaceChildren();
  window.scrollTo(0, 0);
  renderMore();
}

export function setFilter(kind: "country" | "category", value: string): void {
  $<HTMLSelectElement>(kind).value = value;
  window.scrollTo(0, 0);
  applyFilters();
}

/** Patch guide info into already-rendered cards and wall cells, in place. */
export function refreshNowInfo(): void {
  const byId = new Map(state.channels.map((c) => [c.id, c]));
  document.querySelectorAll<HTMLElement>(".card[data-id]").forEach((el) => {
    const ch = byId.get(el.dataset.id!);
    if (ch) updateCardNow(el, ch);
  });
}

export function goHome(): void {
  $<HTMLInputElement>("search").value = "";
  $<HTMLSelectElement>("country").value = "";
  $<HTMLSelectElement>("category").value = "";
  $("favToggle").classList.remove("active");
  state.activeVibe = null;
  const vibeRow = document.getElementById("vibeBlocksRow");
  if (vibeRow) {
    vibeRow.querySelectorAll(".vibeCard").forEach((c) => c.classList.remove("active"));
  }
  window.scrollTo(0, 0);
  $("tabHome").click();
}

/** Where you effectively are for stream availability. The server's egress
 * country (what providers actually see — a VPN moves it) wins; the browser
 * locale is only a fallback when geo-IP is unavailable. */
function homeCountry(): string | null {
  const egress = state.region?.code;
  if (egress && state.countries.some((c) => c.code === egress)) return egress;
  try {
    const region = new Intl.Locale(navigator.language).maximize().region;
    return region && state.countries.some((c) => c.code === region) ? region : null;
  } catch {
    return null;
  }
}

// ---- explore home: turn the TV on, then offer rails to surf ----

// Programmed collections, not raw taxonomy: each has a personality and a
// daypart so the lineup reorders through the day like a real network.
interface Collection {
  title: string;
  tagline: string;
  categories: string[];
  /** hours (0-23) when this collection leads the lineup */
  primetime: number[];
  /** additionally sweep the whole catalog by channel name */
  match?: RegExp;
}

const COLLECTIONS: Collection[] = [
  { title: "🌙 Insomnia Theater", tagline: "for the wide awake", categories: ["classic", "series", "western-classic-tv"], primetime: [23, 0, 1, 2, 3, 4] },
  { title: "⛩ Anime Block", tagline: "subs, dubs, and mechs", categories: ["anime-gaming", "anime"], primetime: [22, 23, 0, 1], match: /anime|naruto|one piece|dragon ?ball|jojo|sailor moon|animax|crunchyroll|hidive|gundam|conan|bleach|pokemon|pokémon|retrocrush|aniplus|ani-one|hunter x|shonen|ghibli|yu-gi-oh/i },
  { title: "🧸 Saturday Mornings", tagline: "cereal not included", categories: ["kids", "animation", "animated"], primetime: [6, 7, 8, 9, 10] },
  { title: "🗞 The Situation Room", tagline: "everything, everywhere, right now", categories: ["news"], primetime: [6, 7, 8, 17, 18] },
  { title: "🏟 Stadium Row", tagline: "somewhere, a ball is in play", categories: ["sports", "sports-outdoors"], primetime: [12, 13, 14, 15, 16, 17] },
  { title: "🎬 Movie Marathon", tagline: "opening credits forever", categories: ["movies"], primetime: [19, 20, 21, 22] },
  { title: "😂 Comedy Cellar", tagline: "laugh tracks optional", categories: ["comedy", "dark-comedy"], primetime: [20, 21, 22, 23] },
  { title: "🩸 Fright Night", tagline: "sleep is overrated", categories: ["paranormal"], primetime: [21, 22, 23, 0, 1, 2], match: /horror|creep|terror|scream|fear ?factor|fright|zombie|halloween|shudder|slasher|haunt|midnight pulp|grindhouse|exorc/i },
  { title: "🎸 MTV Era", tagline: "when television played music", categories: ["music"], primetime: [15, 16, 17, 18] },
  { title: "🔬 Big Brain Hours", tagline: "accidentally learn something", categories: ["documentary", "science", "education"], primetime: [10, 11, 12, 13] },
  { title: "🧘 Screensaver Mode", tagline: "television as furniture", categories: ["relax", "ambiance", "travel", "weather"], primetime: [9, 10, 11, 14] },
];

// ---- the carousel: one live stream center stage, static previews around it ----
const CARO_SIZE = 9;
const CARO_SPREAD = 3; // cards visible on each side

const caro = {
  items: [] as Channel[],
  center: 0,
  hls: null as Hls | null,
  token: 0,
  tries: 0,
};

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
        card.className = "vodCard";
        card.style.position = "relative";
        card.innerHTML = `
          <span class="vodPoster">${item.poster ? `<img loading="lazy" alt="" src="${escapeHtml(item.poster)}">` : "🎬"}</span>
          <span class="vodTitle">${escapeHtml(item.title)}</span>
          <span class="vodMeta">${escapeHtml(item.episodeTitle || "Movie")}</span>
          <div class="resumeProgressWrapper">
            <div class="resumeProgressBar" style="width: ${item.percentage}%;"></div>
          </div>
        `;
        card.onclick = () => {
          resumeVodPlayback(item);
        };
        continueScroller.append(card);
      });
      continueRail.append(continueScroller);
      homeContainer.append(continueRail);
    }

    // 2. Add Spotlight VOD Hero if there is a featured item
    const hero = $("homeHero");
    if (hero) {
      const featured = rails[0]?.items[0];
      if (featured) {
        const bannerImg = featured.banner || featured.poster || "";
        hero.className = "vodHeroBlock";
        hero.style.backgroundImage = bannerImg ? `url(${bannerImg})` : "";
        hero.innerHTML = `
          <div class="vodHeroOverlay"></div>
          <div class="vodHeroContent">
            <span class="vodHeroGenre">${escapeHtml(featured.genre || "Featured")}</span>
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

    // 3. Render top 3-4 VOD Rails on the Home page!
    rails.slice(0, 4).forEach((rail: VodRail) => {
      const el = document.createElement("div");
      el.className = "rail";
      el.innerHTML = `
        <div class="railHead">
          <h2>${escapeHtml(rail.name)}</h2>
          <span class="railTag">${rail.items.length} items</span>
        </div>
      `;
      const scroller = document.createElement("div");
      scroller.className = "railScroll";
      rail.items.slice(0, 15).forEach((item: VodItem) => {
        const card = document.createElement("button");
        card.className = "vodCard";
        card.title = item.summary || item.title;
        card.innerHTML = `
          <span class="vodPoster">${item.poster ? `<img loading="lazy" alt="" src="${escapeHtml(item.poster)}">` : "🎬"}</span>
          <span class="vodTitle">${escapeHtml(item.title)}</span>
          <span class="vodMeta">${escapeHtml([item.genre, item.rating].filter(Boolean).join(" · "))}</span>
        `;
        card.onclick = () => {
          void openVodDetails(item);
        };
        scroller.append(card);
      });
      el.append(scroller);
      homeContainer.append(el);
    });

  } catch (err) {
    loading.textContent = `Failed to load Home dashboard: ${err}`;
  }
}

// The signature, Twitch-style: one live stream center stage with an info
// panel, static frame-capture previews fanned out beside it.
function buildCarousel(): HTMLElement {
  const el = document.createElement("section");
  el.id = "hero";
  el.innerHTML = `
    <div class="wallHead">
      <span class="wallTitle"><span class="liveDot">●</span> CHANNEL SURF</span>
      <span class="wallSub">one live · ${CARO_SIZE - 1} on deck</span>
      <button id="wallRetune">↻ Shuffle</button>
    </div>
    <div id="caro">
      <button class="caroArrow" id="caroPrev" title="Previous">‹</button>
      <div id="caroStage"></div>
      <button class="caroArrow" id="caroNext" title="Next">›</button>
    </div>`;
  el.querySelector("#caroPrev")!.addEventListener("click", () => rotate(-1));
  el.querySelector("#caroNext")!.addEventListener("click", () => rotate(1));
  el.querySelector("#wallRetune")!.addEventListener("click", () => {
    caro.items = pickCarousel();
    caro.center = 0;
    renderCaro();
  });
  return el;
}

function heroPool(): Channel[] {
  // foreign Pluto streams are usually a geo-blocked logo loop, not content
  const home = homeCountry();
  const eligible = visible().filter((ch) => {
    const url = ch.streams[0]?.url;
    if (!ch.logo || !url) return false;
    if (url.includes("jmp2.uk/plu-") && ch.country !== home) return false;
    return true;
  });
  const alive = eligible.filter((ch) => state.health.get(ch.streams[0]!.url) === true);
  if (alive.length >= CARO_SIZE * 3) return alive;
  return eligible.filter((ch) => !isDead(ch));
}

function pickCarousel(): Channel[] {
  const pool = [...heroPool()];
  const picked: Channel[] = [];
  while (picked.length < CARO_SIZE && pool.length) {
    picked.push(...pool.splice(Math.floor(Math.random() * pool.length), 1));
  }
  return picked;
}

function rotate(delta: number): void {
  const n = caro.items.length;
  if (!n) return;
  caro.center = ((caro.center + delta) % n + n) % n;
  renderCaro();
}

function renderCaro(): void {
  const stage = document.getElementById("caroStage");
  if (!stage) return;
  stage.replaceChildren();
  const n = caro.items.length;
  if (!n) return;
  for (let off = -CARO_SPREAD; off <= CARO_SPREAD; off++) {
    const ch = caro.items[((caro.center + off) % n + n) % n]!;
    stage.append(off === 0 ? centerCard(ch) : sideCard(ch, off));
  }
  void tuneCenter();
}

function sideCard(ch: Channel, off: number): HTMLElement {
  const el = document.createElement("button");
  el.className = `caroCard o${Math.abs(off)} ${off < 0 ? "left" : "right"}`;
  el.title = ch.name;
  el.innerHTML = `<div class="caroThumb"></div>`;
  const box = el.querySelector<HTMLElement>(".caroThumb")!;
  setLogo(box, ch);
  const url = ch.streams[0]?.url;
  if (url && state.health.get(url) !== false) {
    const img = document.createElement("img");
    img.className = "thumbImg";
    img.alt = "";
    img.onload = () => box.replaceChildren(img);
    img.onerror = () => img.remove();
    img.src = `/thumb?url=${encodeURIComponent(url)}`;
  }
  el.addEventListener("click", () => rotate(off));
  return el;
}

function centerCard(ch: Channel): HTMLElement {
  const el = document.createElement("div");
  el.className = "caroCard center";
  const prog = onNow(ch);
  el.innerHTML = `
    <div class="caroScreen">
      <video muted autoplay playsinline></video>
      <div class="heroStatic"><span class="tuningText">TUNING ···</span></div>
    </div>
    <div class="caroInfo">
      <div class="caroInfoHead">
        <span class="caroLogo"></span>
        <div class="caroNames">
          <div class="caroName">${escapeHtml(ch.name)}</div>
          <div class="caroMeta">${escapeHtml(chMeta(ch))}</div>
        </div>
      </div>
      ${prog ? `<div class="caroNow">▸ ${escapeHtml(prog.title)}</div>` : ""}
      <div class="caroActions">
        <button class="caroWatch">▶ Watch</button>
      </div>
    </div>`;
  setLogo(el.querySelector<HTMLElement>(".caroLogo")!, ch);
  el.querySelector(".caroScreen")!.addEventListener("click", () => openPlayer(ch, 0, caro.items));
  el.querySelector(".caroWatch")!.addEventListener("click", () => openPlayer(ch, 0, caro.items));
  return el;
}

async function tuneCenter(retry = false): Promise<void> {
  const ch = caro.items[caro.center];
  const screen = document.querySelector<HTMLElement>(".caroCard.center .caroScreen");
  if (!ch || !screen) return;
  if (!retry) caro.tries = 0;
  const token = ++caro.token;
  caro.hls?.destroy();
  caro.hls = null;

  const url = ch.streams[0]!.url;
  if (state.health.get(url) === undefined) {
    try {
      const v = await checkStream(url);
      state.health.set(url, v.ok);
    } catch {
      state.health.set(url, false);
    }
  }
  if (token !== caro.token || !screen.isConnected) return;
  if (state.health.get(url) === false || !Hls.isSupported()) {
    centerFailed(token);
    return;
  }

  const video = screen.querySelector<HTMLVideoElement>("video")!;
  caro.hls = new Hls({ maxBufferLength: 10, capLevelToPlayerSize: true });
  caro.hls.loadSource(`/proxy?url=${encodeURIComponent(url)}`);
  caro.hls.attachMedia(video);
  caro.hls.on(Hls.Events.ERROR, (_evt, data) => {
    if (data.fatal && token === caro.token) centerFailed(token);
  });
  window.setTimeout(() => {
    if (token === caro.token && !screen.classList.contains("playing")) centerFailed(token);
  }, 15000);
  video.onplaying = () => {
    if (token === caro.token) screen.classList.add("playing");
  };
  // a few seconds in, check the actual frame for a geo-block bumper
  window.setTimeout(() => {
    if (token === caro.token && isGeoBlockBumper(video)) {
      state.health.set(url, false); // alive at transport, dead as content
      centerFailed(token);
    }
  }, 5000);
}

function centerFailed(token: number): void {
  if (token !== caro.token) return;
  caro.hls?.destroy();
  caro.hls = null;
  caro.tries++;
  if (caro.tries >= 5) return;
  // swap the dud out of the lineup for a fresh channel
  const used = new Set(caro.items.map((c) => c.id));
  const pool = heroPool().filter((c) => !used.has(c.id));
  const fresh = pool[Math.floor(Math.random() * pool.length)];
  if (fresh) {
    caro.items[caro.center] = fresh;
    renderCaro();
  }
}

function destroyHero(): void {
  caro.hls?.destroy();
  caro.hls = null;
  caro.token++;
}

function rail(
  title: string,
  channels: Channel[],
  seeAll: () => void,
  opts: { tagline?: string; linkLabel?: string } = {}
): HTMLElement {
  const sorted = [...channels]
    .sort((a, b) => (b.logo ? 1 : 0) - (a.logo ? 1 : 0) || rank(a) - rank(b));
  const pool = sorted.slice(0, 25);
  const el = document.createElement("section");
  el.className = "rail";
  const head = document.createElement("div");
  head.className = "railHead";
  head.innerHTML = `<h2>${escapeHtml(title)}</h2>` +
    (opts.tagline ? `<span class="railTag">${escapeHtml(opts.tagline)}</span>` : "");
  const link = document.createElement("button");
  link.className = "railAll";
  link.textContent = opts.linkLabel ?? `All ${channels.length.toLocaleString()} →`;
  link.addEventListener("click", seeAll);
  head.append(link);
  el.append(head);
  const scroller = document.createElement("div");
  scroller.className = "railScroll";
  for (const ch of pool) scroller.append(card(ch, sorted));
  el.append(scroller);
  return el;
}
