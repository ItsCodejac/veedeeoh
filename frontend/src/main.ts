import "./style.css";
import { fetchCatalog, fetchNowPlaying, fetchWatched } from "./api";
import { openPlayer, wirePlayer } from "./player";
import { categoryNames, countryNames, filters, state, visible } from "./state";
import { $ } from "./util";
import { applyFilters, goHome, refreshNowInfo, renderMore, renderHome, renderVibeBlocks } from "./view";
import { wireVodDetails, renderShows, renderMovies, wireSearchInputs } from "./vod";
import { closePartyPlayer } from "./party";
import { renderMusic } from "./music";

async function boot(): Promise<void> {
  const [data, watchedList] = await Promise.all([fetchCatalog(), fetchWatched()]);
  state.channels = data.channels;
  state.countries = data.countries;
  state.categories = data.categories;
  state.region = data.region;
  state.favorites = new Set(data.favorites);
  state.watched = new Set(watchedList);
  state.health = new Map(Object.entries(data.health));

  for (const c of state.countries) {
    countryNames.set(c.code, `${c.flag} ${c.name}`);
    $<HTMLSelectElement>("country").append(new Option(`${c.flag} ${c.name}`, c.code));
  }
  for (const c of state.categories) {
    categoryNames.set(c.id, c.name);
    $<HTMLSelectElement>("category").append(new Option(c.name, c.id));
  }
  renderHome();
  renderVibeBlocks();

  // Vibe blocks & Live TV polling disabled for VOD-only pivot
  wireSearchInputs();
}

function wireSidebar(): void {
  const tabs = ["tabHome", "tabShows", "tabMovies"];
  const views = ["homeView", "showsView", "moviesView"];

  function switchView(activeTabId: string) {
    closePartyPlayer();

    tabs.forEach((t) => {
      const btn = $(t);
      if (btn) {
        if (t === activeTabId) {
          btn.classList.add("active");
        } else {
          btn.classList.remove("active");
        }
      }
    });

    views.forEach((v) => {
      const el = $(v);
      if (el) el.setAttribute("hidden", "");
    });

    if (activeTabId === "tabHome") {
      $("homeView").removeAttribute("hidden");
      renderHome();
    } else if (activeTabId === "tabShows") {
      $("showsView").removeAttribute("hidden");
      if (!$("showsRails").querySelector(".rail")) {
        renderShows($("showsRails"));
      }
    } else if (activeTabId === "tabMovies") {
      $("moviesView").removeAttribute("hidden");
      if (!$("moviesRails").querySelector(".rail")) {
        renderMovies($("moviesRails"));
      }
    }
  }

  tabs.forEach((tabId) => {
    $(tabId).addEventListener("click", () => {
      switchView(tabId);
    });
  });
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
  
  $("brand").addEventListener("click", (e) => {
    e.preventDefault();
    $("tabHome").click();
  });

  $("surprise").addEventListener("click", () => {
    const pool = state.filtered.length ? state.filtered : visible();
    const ch = pool[Math.floor(Math.random() * pool.length)];
    if (ch) openPlayer(ch);
  });

  $("tabExport").addEventListener("click", () => {
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

wireSidebar();
wireHeader();
wirePlayer();
wireVodDetails();
void boot();
