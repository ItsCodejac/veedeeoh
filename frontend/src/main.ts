import "./style.css";
import { fetchCatalog, fetchWatched } from "./api";
import { state } from "./state";
import { $, escapeHtml } from "./util";
import { wireVodDetails, renderShows, renderMovies, wireSearchInputs, renderHome } from "./vod";
import { getSession, isCloudMode, restoreSession, signOut } from "./auth";

async function boot(): Promise<void> {
  if (isCloudMode()) {
    const session = await restoreSession();
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

  // Ensure homeView is unhidden on boot
  const homeView = $("homeView");
  if (homeView) homeView.removeAttribute("hidden");

  renderHome();
  wireSearchInputs();
}

function wireSidebar(): void {
  const tabs = ["tabHome", "tabShows", "tabMovies", "tabFavs", "tabZzz", "tabOcean"];
  const views = ["homeView", "showsView", "moviesView", "zzzView", "oceanView"];

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

    // Dynamic Logo & Theme Shift
    const brand = document.getElementById("brand");
    const mobileBrand = document.querySelector(".mobile-brand");

    if (activeTabId === "tabZzz") {
      if (brand) brand.innerHTML = `veedeeoh<span style="color:#a78bfa;">.zzz</span>`;
      if (mobileBrand) mobileBrand.innerHTML = `v<span style="color:#a78bfa;">.zzz</span>`;
      document.body.classList.add("zzz-mode-active");

      // Screen Wake Lock API
      if ("wakeLock" in navigator) {
        navigator.wakeLock.request("screen").catch(() => {});
      }
    } else {
      if (brand) brand.innerHTML = `veedeeoh<span>.</span>`;
      if (mobileBrand) mobileBrand.innerHTML = `v<span>.</span>`;
      document.body.classList.remove("zzz-mode-active");
    }

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
    } else if (activeTabId === "tabZzz") {
      $("zzzView").removeAttribute("hidden");
      import("./zzz").then(zzz => zzz.renderZzzSanctuary($("zzzRails")));
    } else if (activeTabId === "tabOcean") {
      $("oceanView").removeAttribute("hidden");
      renderOceanView($("oceanRails"));
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
  const logoutBtn = document.getElementById("logoutBtn");

  const updateSidebarProfileDisplay = () => {
    import("./profiles").then(p => {
      const activeP = p.getActiveProfile();
      if (sidebarEmail) sidebarEmail.textContent = activeP.name;
      if (sidebarAvatar) {
        sidebarAvatar.textContent = activeP.is_kids ? 'K' : activeP.name.charAt(0).toUpperCase();
        sidebarAvatar.style.background = activeP.avatar_color;
      }
    });
  };

  updateSidebarProfileDisplay();

  if (session) {
    if (logoutBtn) {
      logoutBtn.addEventListener("click", () => {
        signOut();
      });
    }
  } else if (!session) {
    if (sidebarUser) sidebarUser.style.display = "flex";
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

  const regionSelector = $<HTMLSelectElement>("regionSelector");
  if (regionSelector) {
    import("./api").then(api => {
      regionSelector.value = api.getActiveRegion();
      regionSelector.addEventListener("change", (e) => {
        const val = (e.target as HTMLSelectElement).value;
        api.setActiveRegion(val);
        renderHome();
        const showsRails = $("showsRails");
        if (showsRails) showsRails.replaceChildren();
        const moviesRails = $("moviesRails");
        if (moviesRails) moviesRails.replaceChildren();
      });
    });
  }

  // Wire Household Profiles, Sleep Mode & Settings
  const zzzBtn = document.getElementById("zzzBtn");
  if (zzzBtn) {
    zzzBtn.addEventListener("click", () => {
      import("./zzz").then(zzz => zzz.openSleepTimerModal());
    });
  }

  const sidebarUser = $("sidebarUser");
  if (sidebarUser) {
    sidebarUser.addEventListener("click", () => {
      const existing = document.getElementById("userAccountMenuModal");
      if (existing) {
        existing.remove();
        return;
      }

      import("./profiles").then(p => {
        const activeP = p.getActiveProfile();

        const modal = document.createElement("div");
        modal.id = "userAccountMenuModal";
        modal.style.cssText = "position:fixed;inset:0;background:rgba(6,7,10,0.85);backdrop-filter:blur(14px);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;color:#fff;font-family:'Space Grotesk',sans-serif;";
        modal.innerHTML = `
          <div style="background:#10141e;border:1px solid rgba(255,255,255,0.15);border-radius:20px;max-width:340px;width:100%;padding:24px;box-shadow:0 20px 50px rgba(0,0,0,0.9);text-align:center;">
            <div style="width:60px;height:60px;border-radius:14px;background:${activeP.avatar_color};display:flex;align-items:center;justify-content:center;font-size:24px;font-weight:800;color:#06070a;margin:0 auto 12px;">
              ${activeP.is_kids ? '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#06070a" stroke-width="2"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path></svg>' : activeP.name.charAt(0).toUpperCase()}
            </div>
            <h3 style="margin:0 0 4px;font-size:18px;font-weight:800;">${activeP.name}</h3>
            <p style="margin:0 0 20px;font-size:12px;color:#9aa5b5;">${activeP.is_kids ? 'veedeeoh.kidz' : 'Standard Profile'}</p>

            <div style="display:flex;flex-direction:column;gap:10px;margin-bottom:16px;">
              <button id="menuSwitchProfileBtn" style="padding:12px;border-radius:10px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.12);color:#fff;font-weight:700;font-size:14px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle></svg>
                <span>Switch Profile</span>
              </button>

              <button id="menuOpenSettingsBtn" style="padding:12px;border-radius:10px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.12);color:#fff;font-weight:700;font-size:14px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
                <span>Household Settings</span>
              </button>
            </div>

            <button id="menuCloseBtn" style="background:none;border:none;color:#9aa5b5;font-size:13px;cursor:pointer;">Cancel</button>
          </div>
        `;

        modal.onclick = (e) => {
          if (e.target === modal || (e.target as HTMLElement).id === "menuCloseBtn") {
            modal.remove();
          }
        };

        document.body.appendChild(modal);

        const switchBtn = modal.querySelector("#menuSwitchProfileBtn");
        if (switchBtn) {
          switchBtn.addEventListener("click", () => {
            modal.remove();
            p.openProfileSwitcher((newP) => {
              const sidebarEmail = document.getElementById("sidebarEmail");
              const sidebarAvatar = document.getElementById("sidebarAvatar");
              if (sidebarEmail) sidebarEmail.textContent = newP.name;
              if (sidebarAvatar) {
                sidebarAvatar.textContent = newP.is_kids ? 'K' : newP.name.charAt(0).toUpperCase();
                sidebarAvatar.style.background = newP.avatar_color;
              }
              import("./vod").then(vod => vod.renderHome());
            });
          });
        }

        const setBtn = modal.querySelector("#menuOpenSettingsBtn");
        if (setBtn) {
          setBtn.addEventListener("click", () => {
            modal.remove();
            import("./settings").then(s => s.openSettingsModal());
          });
        }
      });
    });
  }

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

const OCEANIC_STREAMS = [
  {
    id: "ocean-coral-reef",
    title: "Coral Reef Haven 4K",
    summary: "Vibrant tropical reef soundscape with clownfish, sea turtles & gentle wave rhythms.",
    badge: "CORAL REEF",
    poster: "https://images.unsplash.com/photo-1544551763-46a013bb70d5?auto=format&fit=crop&w=800&q=80",
    url: "https://vjs.zencdn.net/v/oceans.mp4"
  },
  {
    id: "ocean-pacific-coast",
    title: "Pacific Coast Wave Drift",
    summary: "Crashing Pacific ocean swells against rugged coastal cliffs with 3D spatial wave audio.",
    badge: "COASTAL SWELLS",
    poster: "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=800&q=80",
    url: "https://vjs.zencdn.net/v/oceans.mp4"
  },
  {
    id: "ocean-deep-jellyfish",
    title: "Deep Sea Jellyfish Sanctuary",
    summary: "Bioluminescent moon jellyfish gliding through pitch-black abyssal ocean waters.",
    badge: "DEEP SEA",
    poster: "https://images.unsplash.com/photo-1544551763-77ef2d0cfc6c?auto=format&fit=crop&w=800&q=80",
    url: "https://vjs.zencdn.net/v/oceans.mp4"
  },
  {
    id: "ocean-kelp-forest",
    title: "Monterey Kelp Forest",
    summary: "Sunbeams streaming through giant kelp forests with sea otters & leopard sharks.",
    badge: "KELP FOREST",
    poster: "https://images.unsplash.com/photo-1518709268805-4e9042af9f23?auto=format&fit=crop&w=800&q=80",
    url: "https://vjs.zencdn.net/v/oceans.mp4"
  },
  {
    id: "ocean-hawaiian-sunset",
    title: "Hawaiian Sunset Shore",
    summary: "Golden hour sunset waves gently lapping white sand beaches at dusk.",
    badge: "SUNSET SHORE",
    poster: "https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=800&q=80",
    url: "https://vjs.zencdn.net/v/oceans.mp4"
  },
  {
    id: "ocean-dolphin-lagoon",
    title: "Maldives Azure Lagoon",
    summary: "Crystal clear turquoise lagoon waters gently rippling under tropical palm trees.",
    badge: "TROPICAL LAGOON",
    poster: "https://images.unsplash.com/photo-1512100356356-de1b84283e18?auto=format&fit=crop&w=800&q=80",
    url: "https://vjs.zencdn.net/v/oceans.mp4"
  }
];

function renderOceanView(container: HTMLElement | null): void {
  if (!container) return;
  container.replaceChildren();

  const section = document.createElement('div');
  section.className = 'showcaseRail';

  const grid = document.createElement('div');
  grid.style.cssText = 'display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 24px;';

  OCEANIC_STREAMS.forEach((item) => {
    const card = document.createElement('div');
    card.style.cssText = 'background: #10141e; border: 1px solid rgba(56,189,248,0.25); border-radius: 16px; overflow: hidden; cursor: pointer; transition: transform 0.2s ease, border-color 0.2s ease; position: relative;';
    card.onmouseover = () => { card.style.transform = 'translateY(-4px)'; card.style.borderColor = '#38bdf8'; };
    card.onmouseout = () => { card.style.transform = 'none'; card.style.borderColor = 'rgba(56,189,248,0.25)'; };

    card.innerHTML = `
      <div style="height: 160px; position: relative; overflow: hidden;">
        <img src="${item.poster}" alt="${escapeHtml(item.title)}" style="width: 100%; height: 100%; object-fit: cover;" />
        <div style="position: absolute; inset: 0; background: linear-gradient(180deg, transparent 40%, rgba(6,7,10,0.9) 100%);"></div>
        <div style="position: absolute; bottom: 12px; left: 12px; right: 12px; display: flex; align-items: center; justify-content: space-between;">
          <span style="background: rgba(56,189,248,0.3); backdrop-filter: blur(8px); border: 1px solid rgba(56,189,248,0.5); color: #fff; padding: 2px 8px; border-radius: 6px; font-size: 11px; font-weight: 700;">${item.badge}</span>
          <div style="width: 32px; height: 32px; border-radius: 50%; background: #38bdf8; color: #06070a; display: flex; align-items: center; justify-content: center; font-weight: bold;">▶</div>
        </div>
      </div>
      <div style="padding: 16px;">
        <h4 style="margin: 0 0 6px; font-size: 16px; font-weight: 700; color: #fff;">${escapeHtml(item.title)}</h4>
        <p style="margin: 0; font-size: 12px; color: #9aa5b5; line-height: 1.4; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;">${escapeHtml(item.summary)}</p>
      </div>
    `;

    card.onclick = () => {
      import('./zzz').then(zzz => zzz.playZzzAmbientItem({
        id: item.id,
        title: item.title,
        type: 'ocean',
        poster: item.poster,
        banner: item.poster,
        summary: item.summary,
        genre: 'Oceanic Soundscapes',
        url: item.url,
      }));
    };

    grid.appendChild(card);
  });

  section.appendChild(grid);
  container.appendChild(section);
}

import { initPWA } from "./pwa";

wireSidebar();
wireHeader();
wireVodDetails();
initPWA();
void boot();
