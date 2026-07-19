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
  if (!f.q && !f.country && !f.category && !f.favorites) {
    renderExplore();
    return;
  }
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

// ---- explore home: show what exists before making anyone type ----
function renderExplore() {
  const all = visible();
  state.filtered = [];
  state.rendered = 0;
  grid.replaceChildren();
  $("stats").textContent =
    `${all.length.toLocaleString()} channels — pick a category or country, or just search`;

  const favs = all.filter((ch) => state.favorites.has(ch.id));
  if (favs.length) {
    grid.append(sectionHead(`★ Your favorites (${favs.length})`));
    for (const ch of favs) grid.append(card(ch));
  }

  const catCounts = new Map();
  const countryCounts = new Map();
  for (const ch of all) {
    for (const c of ch.categories) catCounts.set(c, (catCounts.get(c) || 0) + 1);
    if (ch.country) countryCounts.set(ch.country, (countryCounts.get(ch.country) || 0) + 1);
  }

  grid.append(sectionHead("Browse by category"));
  for (const cat of state.categories) {
    const n = catCounts.get(cat.id);
    if (n) grid.append(tile(cat.name, n, () => setFilter("category", cat.id)));
  }

  grid.append(sectionHead("Browse by country"));
  const byCount = [...state.countries].sort(
    (a, b) => (countryCounts.get(b.code) || 0) - (countryCounts.get(a.code) || 0)
  );
  for (const c of byCount) {
    const n = countryCounts.get(c.code);
    if (n) grid.append(tile(`${c.flag} ${c.name}`, n, () => setFilter("country", c.code)));
  }
}

function sectionHead(text) {
  const el = document.createElement("div");
  el.className = "sectionHead";
  el.textContent = text;
  return el;
}

function tile(label, count, onClick) {
  const el = document.createElement("button");
  el.className = "tile";
  el.innerHTML = `<span class="tlabel">${escapeHtml(label)}</span><span class="tcount">${count.toLocaleString()}</span>`;
  el.addEventListener("click", onClick);
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
