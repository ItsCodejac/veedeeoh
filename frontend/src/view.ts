import Hls from "hls.js";
import { checkStream } from "./api";
import { card, stopHoverPreview } from "./cards";
import { openPlayer } from "./player";
import { categoryNames, chMeta, countryNames, filters, isDead, rank, state, visible } from "./state";
import type { Channel } from "./types";
import { $, escapeHtml } from "./util";

const BATCH = 120;
const grid = () => $("grid");

export function applyFilters(): void {
  const f = filters();
  destroyHero();
  stopHoverPreview();
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
  for (const ch of slice) grid().append(card(ch, state.filtered));
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

/** Country inferred from the browser locale (e.g. "en-US" -> "US"). Private:
 * no geolocation permission, no external lookups. */
function homeCountry(): string | null {
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
}

const COLLECTIONS: Collection[] = [
  { title: "🌙 Insomnia Theater", tagline: "for the wide awake", categories: ["classic", "series", "western-classic-tv"], primetime: [23, 0, 1, 2, 3, 4] },
  { title: "⛩ Anime Block", tagline: "subs, dubs, and mechs", categories: ["anime-gaming", "anime"], primetime: [22, 23, 0, 1] },
  { title: "🧸 Saturday Mornings", tagline: "cereal not included", categories: ["kids", "animation", "animated"], primetime: [6, 7, 8, 9, 10] },
  { title: "🗞 The Situation Room", tagline: "everything, everywhere, right now", categories: ["news"], primetime: [6, 7, 8, 17, 18] },
  { title: "🏟 Stadium Row", tagline: "somewhere, a ball is in play", categories: ["sports", "sports-outdoors"], primetime: [12, 13, 14, 15, 16, 17] },
  { title: "🎬 Movie Marathon", tagline: "opening credits forever", categories: ["movies"], primetime: [19, 20, 21, 22] },
  { title: "😂 Comedy Cellar", tagline: "laugh tracks optional", categories: ["comedy", "dark-comedy"], primetime: [20, 21, 22, 23] },
  { title: "🎸 MTV Era", tagline: "when television played music", categories: ["music"], primetime: [15, 16, 17, 18] },
  { title: "🔬 Big Brain Hours", tagline: "accidentally learn something", categories: ["documentary", "science", "education"], primetime: [10, 11, 12, 13] },
  { title: "🧘 Screensaver Mode", tagline: "television as furniture", categories: ["relax", "ambiance", "travel", "weather"], primetime: [9, 10, 11, 14] },
];

// ---- the video wall: a 3x3 bank of live muted feeds ----
const WALL_SIZE = 9;

interface WallCell {
  hls: Hls | null;
  ch: Channel | null;
  token: number;
  tries: number;
  el: HTMLElement | null;
}

const wall: WallCell[] = Array.from({ length: WALL_SIZE }, () => ({
  hls: null, ch: null, token: 0, tries: 0, el: null,
}));

function renderExplore(): void {
  const all = visible();
  state.filtered = [];
  state.rendered = 0;
  grid().classList.add("explore");
  grid().replaceChildren();
  $("stats").textContent = "";

  grid().append(buildWall());
  retuneAll();

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

  // "Near you": inferred from the browser locale — no geolocation, no lookups
  const home = homeCountry();
  if (home) {
    const local = all.filter((ch) => ch.country === home);
    if (local.length >= 8) {
      const name = countryNames.get(home) || home;
      grid().append(rail(`📍 ${name}`, local, () => setFilter("country", home)));
    }
  }

  // collections whose primetime includes the current hour lead the lineup
  const hour = new Date().getHours();
  const lineup = [...COLLECTIONS].sort(
    (a, b) => Number(b.primetime.includes(hour)) - Number(a.primetime.includes(hour))
  );
  const collectionRails: HTMLElement[] = [];
  for (const col of lineup) {
    const seen = new Set<string>();
    const chans = col.categories
      .flatMap((id) => byCat.get(id) || [])
      .filter((ch) => !seen.has(ch.id) && seen.add(ch.id));
    if (chans.length >= 8) {
      collectionRails.push(rail(col.title, chans, () => setFilter("category", col.categories[0]!), {
        tagline: col.primetime.includes(hour) ? `${col.tagline} · on now` : col.tagline,
      }));
    }
  }
  // keep the landing tight: on-now collections up front, the rest one click away
  for (const railEl of collectionRails.slice(0, 4)) grid().append(railEl);
  const rest = collectionRails.slice(4);
  if (rest.length) {
    const more = document.createElement("button");
    more.id = "moreRails";
    more.textContent = `▾ ${rest.length} more collections`;
    more.addEventListener("click", () => {
      more.replaceWith(...rest);
    });
    grid().append(more);
  }

  // Passport: a different country spotlight every visit
  const eligible = state.countries.filter((c) => (countryCounts.get(c.code) || 0) >= 8);
  const dest = eligible[Math.floor(Math.random() * eligible.length)];
  if (dest) {
    grid().append(rail(
      `🌍 Passport: ${dest.flag} ${dest.name}`,
      all.filter((ch) => ch.country === dest.code),
      () => setFilter("country", dest.code),
      { tagline: "tonight we're broadcasting from" }
    ));
  }

  // Lucky Dip: pure chaos, reshuffled every visit
  const dip = [...all].filter((ch) => ch.logo);
  for (let i = dip.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [dip[i], dip[j]] = [dip[j]!, dip[i]!];
  }
  grid().append(rail("🎰 Lucky Dip", dip.slice(0, 25), () => applyFilters(), {
    tagline: "25 channels, zero logic",
    linkLabel: "Reshuffle ↻",
  }));

  const strip = document.createElement("div");
  strip.className = "countryStrip";
  const head = document.createElement("div");
  head.className = "sectionHead";
  head.textContent = "Around the world";
  strip.append(head);
  const chipRow = document.createElement("div");
  chipRow.className = "chipRow";
  const top = [...state.countries]
    .sort(
      (a, b) =>
        Number(b.code === home) - Number(a.code === home) ||
        (countryCounts.get(b.code) || 0) - (countryCounts.get(a.code) || 0)
    )
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

// The signature: nine live feeds at once — the wall of TVs at the store.
function buildWall(): HTMLElement {
  const el = document.createElement("section");
  el.id = "hero";
  el.innerHTML = `
    <div class="wallHead">
      <span class="wallTitle"><span class="liveDot">●</span> THE WALL</span>
      <span class="wallSub">${WALL_SIZE} live feeds</span>
      <button id="wallRetune">↻ Retune all</button>
    </div>
    <div id="wall"></div>`;
  const wallEl = el.querySelector<HTMLElement>("#wall")!;
  for (let i = 0; i < WALL_SIZE; i++) {
    const cell = document.createElement("div");
    cell.className = "wallCell";
    cell.innerHTML = `
      <video muted autoplay playsinline></video>
      <div class="heroStatic"><span class="tuningText">TUNING</span></div>
      <div class="cellLabel"><span class="cellName"></span><span class="cellMeta"></span></div>`;
    cell.addEventListener("click", () => {
      const ch = wall[i]!.ch;
      if (ch) openPlayer(ch);
    });
    wall[i]!.el = cell;
    wallEl.append(cell);
  }
  el.querySelector("#wallRetune")!.addEventListener("click", retuneAll);
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
  if (alive.length >= WALL_SIZE * 3) return alive;
  return eligible.filter((ch) => !isDead(ch));
}

function wallUsed(): Set<string> {
  return new Set(wall.map((c) => c.ch?.id).filter((id): id is string => !!id));
}

function retuneAll(): void {
  for (let i = 0; i < WALL_SIZE; i++) void tuneCell(i);
}

async function tuneCell(i: number, retry = false): Promise<void> {
  const cell = wall[i]!;
  const el = cell.el;
  if (!el || !el.isConnected) return;
  if (!retry) cell.tries = 0;
  const token = ++cell.token;

  const used = wallUsed();
  const pool = heroPool().filter((ch) => !used.has(ch.id));
  const ch = pool[Math.floor(Math.random() * pool.length)];
  if (!ch) return;
  cell.ch = ch;
  el.classList.remove("playing");
  el.querySelector(".cellName")!.textContent = ch.name;
  el.querySelector(".cellMeta")!.textContent = chMeta(ch);
  cell.hls?.destroy();
  cell.hls = null;

  const url = ch.streams[0]!.url;
  // verify before tuning in: static is a state, black is a bug
  if (state.health.get(url) === undefined) {
    try {
      const v = await checkStream(url);
      state.health.set(url, v.ok);
    } catch {
      state.health.set(url, false);
    }
  }
  if (token !== cell.token || !el.isConnected) return;
  if (state.health.get(url) === false || !Hls.isSupported()) {
    retuneFailed(i, token);
    return;
  }

  const video = el.querySelector<HTMLVideoElement>("video")!;
  cell.hls = new Hls({ maxBufferLength: 8, capLevelToPlayerSize: true });
  cell.hls.loadSource(`/proxy?url=${encodeURIComponent(url)}`);
  cell.hls.attachMedia(video);
  cell.hls.on(Hls.Events.ERROR, (_evt, data) => {
    if (data.fatal && token === cell.token) retuneFailed(i, token);
  });
  window.setTimeout(() => {
    if (token === cell.token && !el.classList.contains("playing")) retuneFailed(i, token);
  }, 15000);
  video.onplaying = () => {
    if (token === cell.token) el.classList.add("playing");
  };
}

function retuneFailed(i: number, token: number): void {
  const cell = wall[i]!;
  if (token !== cell.token) return;
  cell.hls?.destroy();
  cell.hls = null;
  cell.tries++;
  if (cell.tries < 5) void tuneCell(i, true);
}

function destroyHero(): void {
  for (const cell of wall) {
    cell.hls?.destroy();
    cell.hls = null;
    cell.ch = null;
    cell.el = null;
    cell.token++;
  }
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
