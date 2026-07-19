import Hls from "hls.js";
import { checkStream } from "./api";
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

const hero: {
  hls: Hls | null;
  ch: Channel | null;
  tries: number;
  token: number;
  watchdog: number | undefined;
  glow: number | undefined;
} = { hls: null, ch: null, tries: 0, token: 0, watchdog: undefined, glow: undefined };

function renderExplore(): void {
  const all = visible();
  state.filtered = [];
  state.rendered = 0;
  grid().classList.add("explore");
  grid().replaceChildren();
  $("stats").textContent = "";

  grid().append(buildHero());
  void tuneHero();
  fillHeroSide();

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

// The signature: a live channel playing on the landing page, OSD chrome and all,
// with an "on now" sidebar of channels to hop between (Twitch-style).
function buildHero(): HTMLElement {
  const el = document.createElement("section");
  el.id = "hero";
  el.innerHTML = `
    <div id="heroWrap">
      <div id="heroScreen">
        <video id="heroVideo" muted autoplay playsinline></video>
        <div class="heroLogoFallback" hidden></div>
        <div class="heroStatic">
          <span class="tuningText">TUNING ···</span>
        </div>
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
      </div>
      <aside id="heroSide">
        <div class="sideTitle">ON NOW</div>
        <div id="heroSideList"></div>
      </aside>
    </div>`;
  el.querySelector("#heroWatch")!.addEventListener("click", () => {
    if (hero.ch) openPlayer(hero.ch);
  });
  el.querySelector("#heroSurf")!.addEventListener("click", () => void tuneHero());
  return el;
}

function heroPool(): Channel[] {
  const alive = visible().filter(
    (ch) => ch.logo && ch.streams[0] && state.health.get(ch.streams[0].url) === true
  );
  if (alive.length >= 12) return alive;
  return visible().filter((ch) => ch.logo && !isDead(ch));
}

function fillHeroSide(): void {
  const list = document.getElementById("heroSideList");
  if (!list) return;
  list.replaceChildren();
  const pool = heroPool().filter((ch) => ch !== hero.ch);
  for (let i = 0; i < 6 && pool.length; i++) {
    const ch = pool.splice(Math.floor(Math.random() * pool.length), 1)[0]!;
    const item = document.createElement("button");
    item.className = "sideItem";
    item.innerHTML = `
      <span class="sideLogo"></span>
      <span class="sideInfo">
        <span class="sideName">${escapeHtml(ch.name)}</span>
        <span class="sideMeta">${escapeHtml(chMeta(ch))}</span>
      </span>`;
    setLogo(item.querySelector<HTMLElement>(".sideLogo")!, ch);
    item.addEventListener("click", () => void tuneHero(ch));
    list.append(item);
  }
}

async function tuneHero(target?: Channel, retry = false): Promise<void> {
  const screen = document.getElementById("heroScreen");
  if (!screen) return;
  if (!retry) hero.tries = 0;
  const token = ++hero.token;
  clearTimeout(hero.watchdog);
  clearInterval(hero.glow);

  const pool = heroPool();
  const ch = target ?? pool[Math.floor(Math.random() * pool.length)];
  if (!ch) return;
  hero.ch = ch;
  screen.classList.remove("playing");
  screen.querySelector(".chNum")!.textContent =
    `CH ${String(state.channels.indexOf(ch) + 1).padStart(4, "0")}`;
  screen.querySelector(".osdName")!.textContent = ch.name;
  screen.querySelector(".osdMeta")!.textContent = chMeta(ch);
  screen.querySelector<HTMLElement>(".heroLogoFallback")!.hidden = true;
  hero.hls?.destroy();
  hero.hls = null;

  const url = ch.streams[0]!.url;
  // verify before tuning in: a black hero is worse than a short static burst
  if (state.health.get(url) === undefined) {
    try {
      const v = await checkStream(url);
      state.health.set(url, v.ok);
    } catch {
      state.health.set(url, false);
    }
  }
  if (token !== hero.token) return; // user surfed away while we probed
  if (state.health.get(url) === false) {
    retune(ch);
    return;
  }

  const video = screen.querySelector<HTMLVideoElement>("#heroVideo")!;
  if (!Hls.isSupported()) {
    showHeroFallback(ch);
    return;
  }
  hero.hls = new Hls({ maxBufferLength: 10, capLevelToPlayerSize: true });
  hero.hls.loadSource(`/proxy?url=${encodeURIComponent(url)}`);
  hero.hls.attachMedia(video);
  hero.hls.on(Hls.Events.ERROR, (_evt, data) => {
    if (data.fatal && token === hero.token) retune(ch);
  });
  // watchdog: if no frames render within 12s, surf on
  hero.watchdog = window.setTimeout(() => {
    if (token === hero.token && !screen.classList.contains("playing")) retune(ch);
  }, 12000);
  video.onplaying = () => {
    if (token !== hero.token) return;
    screen.classList.add("playing");
    clearTimeout(hero.watchdog);
    startGlow(video, screen);
  };
}

function retune(failed: Channel): void {
  hero.hls?.destroy();
  hero.hls = null;
  hero.tries++;
  if (hero.tries < 7) void tuneHero(undefined, true);
  else showHeroFallback(failed);
}

// Ambilight: sample the playing frame and glow the screen's shadow with it.
const glowCanvas = document.createElement("canvas");
glowCanvas.width = glowCanvas.height = 8;

function startGlow(video: HTMLVideoElement, screen: HTMLElement): void {
  clearInterval(hero.glow);
  const ctx = glowCanvas.getContext("2d", { willReadFrequently: true });
  if (!ctx || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const sample = () => {
    try {
      ctx.drawImage(video, 0, 0, 8, 8);
      const px = ctx.getImageData(0, 0, 8, 8).data;
      let r = 0, g = 0, b = 0;
      for (let i = 0; i < px.length; i += 4) {
        r += px[i]!; g += px[i + 1]!; b += px[i + 2]!;
      }
      const n = px.length / 4;
      screen.style.boxShadow =
        `0 0 120px rgba(${Math.round(r / n)}, ${Math.round(g / n)}, ${Math.round(b / n)}, .35),` +
        ` 0 20px 50px rgba(0, 0, 0, .5)`;
    } catch {
      /* canvas tainted or video gone — keep the default glow */
    }
  };
  sample();
  hero.glow = window.setInterval(sample, 4000);
}

function showHeroFallback(ch: Channel): void {
  const screen = document.getElementById("heroScreen");
  const fallback = screen?.querySelector<HTMLElement>(".heroLogoFallback");
  if (!screen || !fallback) return;
  screen.classList.add("playing"); // hide the static overlay
  fallback.hidden = false;
  fallback.innerHTML = "";
  setLogo(fallback, ch);
}

function destroyHero(): void {
  hero.hls?.destroy();
  hero.hls = null;
  hero.ch = null;
  hero.token++;
  clearTimeout(hero.watchdog);
  clearInterval(hero.glow);
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
