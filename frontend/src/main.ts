import "./style.css";
import { fetchCatalog, fetchWatched } from "./api";
import { state } from "./state";
import { $ } from "./util";
import { wireVodDetails, renderShows, renderMovies, wireSearchInputs, renderHome } from "./vod";
import { getSession, isCloudMode, signOut } from "./auth";

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
    } else if (activeTabId === "tabFavs") {
      $("homeView").removeAttribute("hidden");
      renderHome();
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

  const session = getSession();
  const sidebarUser = document.getElementById("sidebarUser");
  const sidebarEmail = document.getElementById("sidebarEmail");
  const sidebarAvatar = document.getElementById("sidebarAvatar");
  const headerEmail = document.getElementById("headerEmail");
  const headerAvatar = document.getElementById("headerAvatar");
  const headerUserBadge = document.getElementById("headerUserBadge");
  const logoutBtn = document.getElementById("logoutBtn");

  if (session) {
    const email = session.email || "";
    if (sidebarEmail) sidebarEmail.textContent = email;
    if (sidebarAvatar) sidebarAvatar.textContent = email.charAt(0).toUpperCase();
    if (headerEmail) headerEmail.textContent = email;
    if (headerAvatar) headerAvatar.textContent = email.charAt(0).toUpperCase();

    if (logoutBtn) {
      logoutBtn.addEventListener("click", () => {
        signOut();
      });
    }
  } else if (!session) {
    if (sidebarUser) sidebarUser.style.display = "none";
    if (headerUserBadge) headerUserBadge.style.display = "none";
    if (logoutBtn) logoutBtn.style.display = "none";
  }
}

function wireHeader(): void {
  let searchTimer: number | undefined;
  const searchInput = $("search") as HTMLInputElement;
  const searchContainer = $("searchContainer");
  const searchToggleBtn = $("searchToggleBtn");
  const searchCloseBtn = $("searchCloseBtn");

  if (searchToggleBtn && searchContainer) {
    searchToggleBtn.addEventListener("click", () => {
      const isOpen = searchContainer.classList.toggle("mobile-open");
      if (isOpen && searchInput) {
        searchInput.focus();
      }
    });
  }

  if (searchCloseBtn && searchContainer) {
    searchCloseBtn.addEventListener("click", () => {
      searchContainer.classList.remove("mobile-open");
    });
  }

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && searchContainer) {
      searchContainer.classList.remove("mobile-open");
    }
  });

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

import { initPWA } from "./pwa";

wireSidebar();
wireHeader();
wireVodDetails();
initPWA();
void boot();
