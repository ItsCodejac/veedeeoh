import Hls from "hls.js";
import { card, setLogo } from "./cards";
import { openPlayer } from "./player";
import { categoryNames, chMeta, filters, isDead, rank, state, visible } from "./state";
import type { Channel } from "./types";
import { $, escapeHtml } from "./util";

const BATCH = 120;
const grid = () => $("grid");

export function applyFilters(): void {
  const f = filters();
  destroyHero();
  if (!f.q && !f.country && !f.category && !f.favorites) {
    renderExplore();
    return;
  }
  grid().classList.remove("explore");
  let hiddenDead = 0;
  state.filtered = visible().filter((ch) => {
    if (f.country && ch.country !== f.country) return false;
    if (f.category && !ch.categories.includes(f.category)) return false;
    if (f.q && !ch.name.toLowerCase().includes(f.q)) return false;
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
  for (const ch of slice) grid().append(card(ch));
  state.rendered += slice.length;
}

export function setFilter(kind: "country" | "category", value: string): void {
  $<HTMLSelectElement>(kind).value = value;
  window.scrollTo(0, 0);
  applyFilters();
}

export function goHome(): void {
  $<HTMLInputElement>("search").value = "";
  $<HTMLSelectElement>("country").value = "";
  $<HTMLSelectElement>("category").value = "";
  $("favToggle").classList.remove("active");
  window.scrollTo(0, 0);
  applyFilters();
}

// ---- explore home: turn the TV on, then offer rails to surf ----
const RAIL_CATEGORIES = [
  "news", "sports", "movies", "music", "kids", "animation",
  "anime-gaming", "documentary", "comedy", "culture", "science",
];

const hero: { hls: Hls | null; ch: Channel | null; tries: number } = {
  hls: null,
  ch: null,
  tries: 0,
};

function renderExplore(): void {
  const all = visible();
  state.filtered = [];
  state.rendered = 0;
  grid().classList.add("explore");
  grid().replaceChildren();
  $("stats").textContent = "";

  grid().append(buildHero());
  tuneHero();

  const favs = all.filter((ch) => state.favorites.has(ch.id));
  if (favs.length) {
    grid().append(rail("★ Favorites", favs, () => {
      $("favToggle").classList.add("active");
      applyFilters();
    }));
  }

  const byCat = new Map<string, Channel[]>();
  const countryCounts = new Map<string, number>();
  for (const ch of all) {
    for (const c of ch.categories) {
      if (!byCat.has(c)) byCat.set(c, []);
      byCat.get(c)!.push(ch);
    }
    if (ch.country) countryCounts.set(ch.country, (countryCounts.get(ch.country) || 0) + 1);
  }
  for (const id of RAIL_CATEGORIES) {
    const chans = byCat.get(id);
    if (chans && chans.length >= 8) {
      grid().append(rail(categoryNames.get(id) || id, chans, () => setFilter("category", id)));
    }
  }

  const strip = document.createElement("div");
  strip.className = "countryStrip";
  const head = document.createElement("div");
  head.className = "sectionHead";
  head.textContent = "Around the world";
  strip.append(head);
  const chipRow = document.createElement("div");
  chipRow.className = "chipRow";
  const top = [...state.countries]
    .sort((a, b) => (countryCounts.get(b.code) || 0) - (countryCounts.get(a.code) || 0))
    .slice(0, 21);
  for (const c of top) {
    const chip = document.createElement("button");
    chip.className = "countryChip";
    chip.innerHTML = `${c.flag} <span>${escapeHtml(c.name)}</span> <em>${(countryCounts.get(c.code) || 0).toLocaleString()}</em>`;
    chip.addEventListener("click", () => setFilter("country", c.code));
    chipRow.append(chip);
  }
  const more = document.createElement("button");
  more.className = "countryChip more";
  more.textContent = `all ${state.countries.length} countries…`;
  more.addEventListener("click", () => $("country").focus());
  chipRow.append(more);
  strip.append(chipRow);
  grid().append(strip);
}

// The signature: a live channel playing on the landing page, OSD chrome and all.
function buildHero(): HTMLElement {
  const el = document.createElement("section");
  el.id = "hero";
  el.innerHTML = `
    <div id="heroScreen">
      <video id="heroVideo" muted autoplay playsinline></video>
      <div class="heroLogoFallback" hidden></div>
      <div class="scanlines"></div>
      <div class="osd osdTop">
        <span class="liveDot">●</span> LIVE
        <span class="chNum"></span>
      </div>
      <div class="osd osdBottom">
        <div class="osdInfo">
          <div class="osdName"></div>
          <div class="osdMeta"></div>
        </div>
        <div class="osdActions">
          <button id="heroWatch">Watch</button>
          <button id="heroSurf" title="Another random channel">⏭ Surf</button>
        </div>
      </div>
    </div>`;
  el.querySelector("#heroWatch")!.addEventListener("click", () => {
    if (hero.ch) openPlayer(hero.ch);
  });
  el.querySelector("#heroSurf")!.addEventListener("click", () => tuneHero());
  return el;
}

function tuneHero(retry = false): void {
  const screen = document.getElementById("heroScreen");
  if (!screen) return;
  if (!retry) hero.tries = 0;
  const pool = visible().filter((ch) => ch.logo && !isDead(ch));
  if (!pool.length) return;
  const ch = pool[Math.floor(Math.random() * pool.length)]!;
  hero.ch = ch;
  screen.querySelector(".chNum")!.textContent =
    `CH ${String(state.channels.indexOf(ch) + 1).padStart(4, "0")}`;
  screen.querySelector(".osdName")!.textContent = ch.name;
  screen.querySelector(".osdMeta")!.textContent = chMeta(ch);
  screen.querySelector<HTMLElement>(".heroLogoFallback")!.hidden = true;

  hero.hls?.destroy();
  const video = screen.querySelector<HTMLVideoElement>("#heroVideo")!;
  if (!Hls.isSupported()) {
    showHeroFallback(ch);
    return;
  }
  hero.hls = new Hls({ maxBufferLength: 10, capLevelToPlayerSize: true });
  hero.hls.loadSource(`/proxy?url=${encodeURIComponent(ch.streams[0]!.url)}`);
  hero.hls.attachMedia(video);
  hero.hls.on(Hls.Events.ERROR, (_evt, data) => {
    if (!data.fatal) return;
    hero.hls?.destroy();
    hero.hls = null;
    hero.tries++;
    if (hero.tries < 4) tuneHero(true);
    else showHeroFallback(ch);
  });
}

function showHeroFallback(ch: Channel): void {
  const fallback = document.querySelector<HTMLElement>("#heroScreen .heroLogoFallback");
  if (!fallback) return;
  fallback.hidden = false;
  fallback.innerHTML = "";
  setLogo(fallback, ch);
}

function destroyHero(): void {
  hero.hls?.destroy();
  hero.hls = null;
  hero.ch = null;
}

function rail(title: string, channels: Channel[], seeAll: () => void): HTMLElement {
  const pool = [...channels]
    .sort((a, b) => (b.logo ? 1 : 0) - (a.logo ? 1 : 0) || rank(a) - rank(b))
    .slice(0, 25);
  const el = document.createElement("section");
  el.className = "rail";
  const head = document.createElement("div");
  head.className = "railHead";
  head.innerHTML = `<h2>${escapeHtml(title)}</h2>`;
  const link = document.createElement("button");
  link.className = "railAll";
  link.textContent = `All ${channels.length.toLocaleString()} →`;
  link.addEventListener("click", seeAll);
  head.append(link);
  el.append(head);
  const scroller = document.createElement("div");
  scroller.className = "railScroll";
  for (const ch of pool) scroller.append(card(ch));
  el.append(scroller);
  return el;
}
