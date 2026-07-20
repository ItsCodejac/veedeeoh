import Hls from "hls.js";
import { checkStream } from "./api";
import { card, setLogo, stopHoverPreview, updateCardNow } from "./cards";
import { openPlayer } from "./player";
import { categoryNames, chMeta, countryNames, filters, isDead, onNow, rank, state, visible } from "./state";
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
  grid().classList.remove("explore");
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

function renderExplore(): void {
  const all = visible();
  state.filtered = [];
  state.rendered = 0;
  grid().classList.add("explore");
  grid().replaceChildren();
  $("stats").textContent = "";

  grid().append(buildCarousel());
  caro.items = pickCarousel();
  caro.center = 0;
  renderCaro();

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
      .concat(col.match ? all.filter((ch) => col.match!.test(ch.name)) : [])
      .filter((ch) => !seen.has(ch.id) && seen.add(ch.id));
    if (chans.length >= 8) {
      const seeAll = col.match
        ? () => showCollection(col.title, chans)
        : () => setFilter("category", col.categories[0]!);
      collectionRails.push(rail(col.title, chans, seeAll, {
        tagline: col.primetime.includes(hour) ? `${col.tagline} · on now` : col.tagline,
      }));
    }
  }
  // programs starting within the next 25 minutes — catch them from the top
  const soonWindow = Date.now() / 1000 + 25 * 60;
  const soon = all
    .filter((ch) => {
      const next = state.epg.get(ch.id)?.next;
      return next && next.start < soonWindow;
    })
    .sort((a, b) => state.epg.get(a.id)!.next!.start - state.epg.get(b.id)!.next!.start);
  if (soon.length >= 6) {
    grid().append(rail("⏰ Starting soon", soon, () => {}, {
      tagline: "catch it from the top",
      linkLabel: `${soon.length} programs`,
    }));
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
