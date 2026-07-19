const state = {
  channels: [],
  countries: [],
  categories: [],
  favorites: new Set(),
  health: new Map(), // stream url -> bool
  filtered: [],
  rendered: 0,
  current: null,
  hls: null,
};

const BATCH = 120;
const $ = (id) => document.getElementById(id);
const grid = $("grid");
const countryNames = new Map();
const categoryNames = new Map();

function chMeta(ch) {
  return [
    countryNames.get(ch.country) || ch.country,
    ...ch.categories.map((c) => categoryNames.get(c) || c),
    ch.source !== "iptv-org" ? ch.source : null,
  ].filter(Boolean).join(" · ");
}

async function boot() {
  const res = await fetch("/api/catalog");
  const data = await res.json();
  state.channels = data.channels;
  state.countries = data.countries;
  state.categories = data.categories;
  state.favorites = new Set(data.favorites);
  state.health = new Map(Object.entries(data.health));

  for (const c of state.countries) {
    countryNames.set(c.code, `${c.flag} ${c.name}`);
    $("country").append(new Option(`${c.flag} ${c.name}`, c.code));
  }
  for (const c of state.categories) {
    categoryNames.set(c.id, c.name);
    $("category").append(new Option(c.name, c.id));
  }
  applyFilters();
}

function filters() {
  return {
    q: $("search").value.trim().toLowerCase(),
    country: $("country").value,
    category: $("category").value,
    favorites: $("favToggle").classList.contains("active"),
    hideDead: $("hideDead").classList.contains("active"),
  };
}

function visible() {
  return state.channels.filter((ch) => !ch.nsfw);
}

function isDead(ch) {
  // dead only when every stream we've checked failed (and we checked at least one)
  const verdicts = ch.streams.map((s) => state.health.get(s.url)).filter((v) => v !== undefined);
  return verdicts.length > 0 && verdicts.every((v) => v === false);
}

function applyFilters() {
  const f = filters();
  destroyHero();
  if (!f.q && !f.country && !f.category && !f.favorites) {
    renderExplore();
    return;
  }
  grid.classList.remove("explore");
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
  grid.replaceChildren();
  state.rendered = 0;
  renderMore();
}

// ---- explore home: turn the TV on, then offer rails to surf ----
const RAIL_CATEGORIES = [
  "news", "sports", "movies", "music", "kids", "animation",
  "anime-gaming", "documentary", "comedy", "culture", "science",
];

const hero = { hls: null, ch: null, tries: 0 };

function renderExplore() {
  const all = visible();
  state.filtered = [];
  state.rendered = 0;
  grid.classList.add("explore");
  grid.replaceChildren();
  $("stats").textContent = "";

  grid.append(buildHero());
  tuneHero();

  const favs = all.filter((ch) => state.favorites.has(ch.id));
  if (favs.length) grid.append(rail("★ Favorites", favs, () => {
    $("favToggle").classList.add("active");
    applyFilters();
  }));

  const byCat = new Map();
  const countryCounts = new Map();
  for (const ch of all) {
    for (const c of ch.categories) {
      if (!byCat.has(c)) byCat.set(c, []);
      byCat.get(c).push(ch);
    }
    if (ch.country) countryCounts.set(ch.country, (countryCounts.get(ch.country) || 0) + 1);
  }
  for (const id of RAIL_CATEGORIES) {
    const chans = byCat.get(id);
    if (chans && chans.length >= 8) {
      grid.append(rail(categoryNames.get(id) || id, chans, () => setFilter("category", id)));
    }
  }

  const strip = document.createElement("div");
  strip.className = "countryStrip";
  strip.append(sectionHead("Around the world"));
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
  grid.append(strip);
}

// The signature: a live channel playing on the landing page, OSD chrome and all.
function buildHero() {
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
  el.querySelector("#heroWatch").addEventListener("click", () => hero.ch && openPlayer(hero.ch));
  el.querySelector("#heroSurf").addEventListener("click", () => tuneHero());
  return el;
}

function heroCandidates() {
  return visible().filter((ch) => ch.logo && !isDead(ch));
}

function tuneHero(retry = false) {
  const screen = document.getElementById("heroScreen");
  if (!screen) return;
  if (!retry) hero.tries = 0;
  const pool = heroCandidates();
  if (!pool.length) return;
  const ch = pool[Math.floor(Math.random() * pool.length)];
  hero.ch = ch;
  screen.querySelector(".chNum").textContent =
    `CH ${String(state.channels.indexOf(ch) + 1).padStart(4, "0")}`;
  screen.querySelector(".osdName").textContent = ch.name;
  screen.querySelector(".osdMeta").textContent = chMeta(ch);
  const fallback = screen.querySelector(".heroLogoFallback");
  fallback.hidden = true;

  if (hero.hls) hero.hls.destroy();
  const video = screen.querySelector("#heroVideo");
  if (!Hls.isSupported()) {
    showHeroFallback(ch);
    return;
  }
  hero.hls = new Hls({ maxBufferLength: 10, capLevelToPlayerSize: true });
  hero.hls.loadSource(`/proxy?url=${encodeURIComponent(ch.streams[0].url)}`);
  hero.hls.attachMedia(video);
  hero.hls.on(Hls.Events.ERROR, (_, data) => {
    if (!data.fatal) return;
    hero.hls.destroy();
    hero.hls = null;
    hero.tries++;
    if (hero.tries < 4) tuneHero(true);
    else showHeroFallback(ch);
  });
}

function showHeroFallback(ch) {
  const screen = document.getElementById("heroScreen");
  if (!screen) return;
  const fallback = screen.querySelector(".heroLogoFallback");
  fallback.hidden = false;
  fallback.innerHTML = "";
  setLogo(fallback, ch);
}

function destroyHero() {
  if (hero.hls) {
    hero.hls.destroy();
    hero.hls = null;
  }
  hero.ch = null;
}

function rail(title, channels, seeAll) {
  const pool = [...channels].sort(
    (a, b) => (b.logo ? 1 : 0) - (a.logo ? 1 : 0) || rank(a) - rank(b)
  ).slice(0, 25);
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

function sectionHead(text) {
  const el = document.createElement("div");
  el.className = "sectionHead";
  el.textContent = text;
  return el;
}

function setFilter(kind, value) {
  $(kind).value = value;
  window.scrollTo(0, 0);
  applyFilters();
}

function goHome() {
  $("search").value = "";
  $("country").value = "";
  $("category").value = "";
  $("favToggle").classList.remove("active");
  window.scrollTo(0, 0);
  applyFilters();
}

function rank(ch) {
  let r = 0;
  if (state.favorites.has(ch.id)) r -= 2;
  if (isDead(ch)) r += 4;
  return r;
}

function renderMore() {
  const slice = state.filtered.slice(state.rendered, state.rendered + BATCH);
  for (const ch of slice) grid.append(card(ch));
  state.rendered += slice.length;
}

function card(ch) {
  const el = document.createElement("div");
  el.className = "card";
  el.dataset.id = ch.id;
  const health = state.health.get(ch.streams[0].url);
  if (isDead(ch)) el.classList.add("dead");

  el.innerHTML = `
    <div class="dot ${health === true ? "alive" : health === false ? "dead" : ""}"></div>
    <button class="star ${state.favorites.has(ch.id) ? "on" : ""}" title="Favorite">★</button>
    <div class="logoBox"></div>
    <div class="cname">${escapeHtml(ch.name)}</div>
    <div class="cmeta">${escapeHtml(chMeta(ch))}</div>`;
  setLogo(el.querySelector(".logoBox"), ch);

  el.querySelector(".star").addEventListener("click", (e) => {
    e.stopPropagation();
    toggleFavorite(ch, e.target);
  });
  el.addEventListener("click", () => openPlayer(ch));
  healthObserver.observe(el);
  return el;
}

// Try each logo url directly, then through the /logo proxy (dodges
// hotlink blocking), before giving up on the 📺 placeholder.
function setLogo(box, ch) {
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
    if (i < candidates.length) img.src = candidates[i];
    else box.innerHTML = '<div class="noLogo">📺</div>';
  };
  img.src = candidates[0];
  box.append(img);
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

async function toggleFavorite(ch, starEl) {
  if (state.favorites.has(ch.id)) {
    state.favorites.delete(ch.id);
    starEl.classList.remove("on");
    await fetch(`/api/favorites/${encodeURIComponent(ch.id)}`, { method: "DELETE" });
  } else {
    state.favorites.add(ch.id);
    starEl.classList.add("on");
    await fetch("/api/favorites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: ch.id }),
    });
  }
}

// ---- lazy health checks: probe streams as their cards scroll into view ----
const checkQueue = [];
let checking = 0;

const healthObserver = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    healthObserver.unobserve(e.target);
    const ch = state.filtered.find((c) => c.id === e.target.dataset.id) ||
      state.channels.find((c) => c.id === e.target.dataset.id);
    if (ch && !state.health.has(ch.streams[0].url)) {
      checkQueue.push([ch.streams[0].url, e.target]);
      pumpChecks();
    }
  }
});

async function pumpChecks() {
  while (checking < 3 && checkQueue.length) {
    const [url, el] = checkQueue.shift();
    checking++;
    fetch("/api/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    })
      .then((r) => r.json())
      .then((v) => {
        state.health.set(url, v.ok);
        const dot = el.querySelector(".dot");
        if (dot) dot.classList.add(v.ok ? "alive" : "dead");
        if (!v.ok) el.classList.add("dead");
      })
      .catch(() => {})
      .finally(() => {
        checking--;
        pumpChecks();
      });
  }
}

// ---- infinite scroll ----
new IntersectionObserver((e) => {
  if (e[0].isIntersecting) renderMore();
}).observe($("sentinel"));

// ---- player ----
function openPlayer(ch, streamIdx = 0) {
  state.current = ch;
  $("playerOverlay").hidden = false;
  $("pName").textContent = ch.name;
  $("pMeta").textContent = chMeta(ch);
  $("pLogo").src = ch.logo || "";
  $("pLogo").hidden = !ch.logo;
  $("pLogo").onerror = () => ($("pLogo").hidden = true);
  $("pFav").classList.toggle("on", state.favorites.has(ch.id));

  const sel = $("pStreams");
  sel.hidden = ch.streams.length < 2;
  if (ch.streams.length > 1) {
    sel.replaceChildren(...ch.streams.map((s, i) => {
      const label = [s.source || "stream", s.quality].filter(Boolean).join(" · ");
      return new Option(`${i + 1}. ${label}`, i);
    }));
    sel.value = streamIdx;
  }
  play(ch.streams[streamIdx].url);
}

function play(url) {
  const video = $("video");
  const status = $("pStatus");
  stopPlayback();
  status.textContent = "Loading stream…";
  const src = `/proxy?url=${encodeURIComponent(url)}`;
  if (Hls.isSupported()) {
    state.hls = new Hls({ maxBufferLength: 15 });
    state.hls.loadSource(src);
    state.hls.attachMedia(video);
    state.hls.on(Hls.Events.MANIFEST_PARSED, () => (status.textContent = ""));
    state.hls.on(Hls.Events.ERROR, (_, data) => {
      if (data.fatal) {
        status.textContent = "⚠ Preview failed (codec or geo-block?) — try Open in VLC.";
        state.hls.destroy();
        state.hls = null;
      }
    });
  } else {
    video.src = src;
    video.onerror = () => (status.textContent = "⚠ Preview failed — try Open in VLC.");
  }
}

function stopPlayback() {
  const video = $("video");
  if (state.hls) {
    state.hls.destroy();
    state.hls = null;
  }
  video.pause();
  video.removeAttribute("src");
  video.load();
}

function closePlayer() {
  stopPlayback();
  $("playerOverlay").hidden = true;
  state.current = null;
}

$("pClose").addEventListener("click", closePlayer);
$("playerOverlay").addEventListener("click", (e) => {
  if (e.target === $("playerOverlay")) closePlayer();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !$("playerOverlay").hidden) closePlayer();
});

$("pStreams").addEventListener("change", (e) => {
  if (state.current) play(state.current.streams[+e.target.value].url);
});

$("pVlc").addEventListener("click", () => {
  if (!state.current) return;
  const idx = $("pStreams").hidden ? 0 : +$("pStreams").value;
  fetch("/api/vlc", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: state.current.streams[idx].url }),
  });
  $("pStatus").textContent = "Sent to VLC 📡";
});

$("pFav").addEventListener("click", (e) => {
  if (!state.current) return;
  toggleFavorite(state.current, e.target);
  const cardStar = grid.querySelector(`.card[data-id="${CSS.escape(state.current.id)}"] .star`);
  if (cardStar) cardStar.classList.toggle("on", state.favorites.has(state.current.id));
});

// ---- header controls ----
let searchTimer;
$("search").addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(applyFilters, 150);
});
$("country").addEventListener("change", applyFilters);
$("category").addEventListener("change", applyFilters);
$("favToggle").addEventListener("click", (e) => {
  e.target.classList.toggle("active");
  applyFilters();
});
$("hideDead").addEventListener("click", (e) => {
  const on = e.target.classList.toggle("active");
  localStorage.setItem("tvlc.hideDead", on ? "1" : "");
  applyFilters();
});
if (localStorage.getItem("tvlc.hideDead")) $("hideDead").classList.add("active");
$("home").addEventListener("click", goHome);

$("surprise").addEventListener("click", () => {
  const pool = state.filtered.length ? state.filtered : visible();
  if (!pool.length) return;
  openPlayer(pool[Math.floor(Math.random() * pool.length)]);
});

$("export").addEventListener("click", () => {
  const f = filters();
  const params = new URLSearchParams();
  if (f.country) params.set("country", f.country);
  if (f.category) params.set("category", f.category);
  if (f.q) params.set("q", f.q);
  if (f.favorites) params.set("favorites", "true");
  params.set("alive", "true");
  window.location = `/playlist.m3u?${params}`;
});

boot();
