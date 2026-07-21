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

  // Removed Live TV header population
  renderHome();
  renderVibeBlocks();

  // Vibe blocks & Live TV polling disabled for VOD-only pivot
  wireSearchInputs();
}

function wireSidebar(): void {
  const tabs = ["tabHome", "tabShows", "tabMovies", "tabPodcasts"];
  const views = ["homeView", "showsView", "moviesView", "podcastsView"];

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
        import("./vod").then(vod => vod.renderMovies($("moviesRails")));
      }
    } else if (activeTabId === "tabPodcasts") {
      $("podcastsView").removeAttribute("hidden");
      if (!$("podcastsRails").querySelector(".rail")) {
        import("./vod").then(vod => vod.renderPodcasts($("podcastsRails")));
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
  const searchInput = $("search") as HTMLInputElement;
  if (searchInput) {
    searchInput.addEventListener("input", (e) => {
      clearTimeout(searchTimer);
      searchTimer = window.setTimeout(() => {
        const query = (e.target as HTMLInputElement).value.toLowerCase();
        import("./vod").then((vod) => {
          vod.setGlobalSearchQuery(query);
        });
      }, 150);
    });
  }

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
