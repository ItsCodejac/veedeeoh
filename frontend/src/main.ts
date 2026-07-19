import "./style.css";
import { fetchCatalog } from "./api";
import { openPlayer, wirePlayer } from "./player";
import { categoryNames, countryNames, filters, state, visible } from "./state";
import { $ } from "./util";
import { applyFilters, goHome, renderMore } from "./view";

async function boot(): Promise<void> {
  const data = await fetchCatalog();
  state.channels = data.channels;
  state.countries = data.countries;
  state.categories = data.categories;
  state.favorites = new Set(data.favorites);
  state.health = new Map(Object.entries(data.health));

  for (const c of state.countries) {
    countryNames.set(c.code, `${c.flag} ${c.name}`);
    $<HTMLSelectElement>("country").append(new Option(`${c.flag} ${c.name}`, c.code));
  }
  for (const c of state.categories) {
    categoryNames.set(c.id, c.name);
    $<HTMLSelectElement>("category").append(new Option(c.name, c.id));
  }
  applyFilters();
}

function wireHeader(): void {
  let searchTimer: number | undefined;
  $("search").addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = window.setTimeout(applyFilters, 150);
  });
  $("country").addEventListener("change", applyFilters);
  $("category").addEventListener("change", applyFilters);
  $("favToggle").addEventListener("click", (e) => {
    (e.target as HTMLElement).classList.toggle("active");
    applyFilters();
  });
  $("hideDead").addEventListener("click", (e) => {
    const on = (e.target as HTMLElement).classList.toggle("active");
    localStorage.setItem("tvlc.hideDead", on ? "1" : "");
    applyFilters();
  });
  if (localStorage.getItem("tvlc.hideDead")) $("hideDead").classList.add("active");
  $("home").addEventListener("click", goHome);

  $("surprise").addEventListener("click", () => {
    const pool = state.filtered.length ? state.filtered : visible();
    const ch = pool[Math.floor(Math.random() * pool.length)];
    if (ch) openPlayer(ch);
  });

  $("export").addEventListener("click", () => {
    const f = filters();
    const params = new URLSearchParams();
    if (f.country) params.set("country", f.country);
    if (f.category) params.set("category", f.category);
    if (f.q) params.set("q", f.q);
    if (f.favorites) params.set("favorites", "true");
    params.set("alive", "true");
    window.location.href = `/playlist.m3u?${params}`;
  });
}

new IntersectionObserver((entries) => {
  if (entries[0]?.isIntersecting) renderMore();
}).observe($("sentinel"));

wireHeader();
wirePlayer();
void boot();
