import "./style.css";
import { fetchCatalog, fetchWatched } from "./api";
import { state } from "./state";
import { $ } from "./util";
import { wireVodDetails, renderShows, renderMovies, wireSearchInputs, renderHome } from "./vod";
import { getSession, isCloudMode } from "./auth";

async function boot(): Promise<void> {
  if (isCloudMode()) {
    const session = getSession();
    if (!session) {
      window.location.href = '/landing.html';
      return;
    }
  }

  const [data, watchedList] = await Promise.all([fetchCatalog(), fetchWatched()]);

  state.region = data.region;
  state.favorites = new Set(data.favorites);
  state.watched = new Set(watchedList);
  state.health = new Map(Object.entries(data.health));

  // Removed Live TV header population
  renderHome();
  wireSearchInputs();
}

function wireSidebar(): void {
  const tabs = ["tabHome", "tabShows", "tabMovies", "tabFavs"];
  const views = ["homeView", "showsView", "moviesView"];

  function switchView(activeTabId: string) {

    // Auto-minimize the player to PiP mode when navigating away
    const playerSuite = document.getElementById("playerSuite");
    if (playerSuite && !playerSuite.hasAttribute("hidden") && !playerSuite.classList.contains("docked")) {
      playerSuite.classList.add("docked");
      const pMin = document.getElementById("pMin");
      if (pMin) pMin.textContent = "🗗 Expand";
    }

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
    }
  }

  tabs.forEach((tabId) => {
    const el = $(tabId);
    if (el) {
      el.addEventListener("click", () => {
        switchView(tabId);
      });
    }
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
}

wireSidebar();
wireHeader();
wireVodDetails();
void boot();
