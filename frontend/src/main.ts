import "./style.css";
import { fetchCatalog, fetchWatched } from "./api";
import { state } from "./state";
import { $, showToast } from "./util";
import { wireVodDetails, renderShows, renderMovies, wireSearchInputs, renderHome } from "./vod";
import { getSession, isCloudMode, restoreSession, signOut, getSupabase } from "./auth";
import { getActiveProfile } from "./profiles";

// Playful multicolor kids identity, used for the brand + kids theme.
const KIDS_WORDMARK = `veedeeoh<span style="color:#7ed957;">.</span><span style="color:#ff9f1c;">k</span><span style="color:#4dabf7;">i</span><span style="color:#ff6b6b;">d</span><span style="color:#a9e34b;">s</span>`;

// Branded ident, played on profile SELECTION (a user gesture, so audio is
// allowed — cold-boot autoplay can't have sound). Normal or kids variant,
// tap-to-skip, self-healing. Calls done() when it finishes so the already-loaded
// home reveals immediately after.
function playIdent(isKids: boolean, done: () => void): void {
  const o = document.createElement("div");
  o.id = "bootIdent";
  o.style.cssText = "position:fixed;inset:0;z-index:99999;background:#06070a;display:flex;align-items:center;justify-content:center;transition:opacity .5s ease;";
  const v = document.createElement("video");
  v.src = isKids ? "/kids-bump.mp4" : "/bump.mp4";
  v.autoplay = true; v.setAttribute("playsinline", "");
  v.style.cssText = "width:100%;height:100%;object-fit:contain;";
  let finished = false;
  const finish = () => { if (finished) return; finished = true; o.style.opacity = "0"; setTimeout(() => o.remove(), 500); done(); };
  v.onended = finish; v.onerror = finish; o.onclick = finish;
  o.appendChild(v);
  document.body.appendChild(o);
  setTimeout(finish, 6000); // never trap the user behind a stalled video
  v.play().catch(() => { v.muted = true; v.play().catch(finish); }); // sound; fall back muted
}

// Paywall shown when a signed-in user has no active trial/subscription. Blocks
// the app until they subscribe (Stripe Checkout) — the trial-expiry gate.
// Fade out and remove the boot splash once the first real screen (Who's Watching,
// paywall, or home) is ready to take over.
function hideBootSplash(): void {
  const s = document.getElementById("bootSplash");
  if (!s) return;
  s.style.opacity = "0";
  setTimeout(() => s.remove(), 400);
}

// Apply per-profile chrome: kids theme, sidebar contents, and avatar. A kids
// profile gets a stripped-down sidebar (Home only) and the bright kids theme;
// a parent profile gets the full nav plus the veedeeoh.kids shortcut.
function applyProfileChrome(profile: { name?: string; avatar_color?: string; is_kids?: boolean }): void {
  const isKids = !!profile?.is_kids;
  document.body.classList.toggle("kids-mode", isKids);

  // Brand identity follows the profile.
  const brand = document.getElementById("brand");
  const mobileBrand = document.querySelector(".mobile-brand");
  if (isKids) {
    if (brand) brand.innerHTML = KIDS_WORDMARK;
    if (mobileBrand) mobileBrand.innerHTML = `v<span style="color:#ff9f1c;">k</span>`;
  } else {
    if (brand) brand.innerHTML = `veedeeoh<span>.</span>`;
    if (mobileBrand) mobileBrand.innerHTML = `v<span>.</span>`;
  }

  // Kids: hide the adult browse tabs; parent: show them.
  ["tabShows", "tabMovies", "tabFavs"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.style.display = isKids ? "none" : "";
  });
  // The kids shortcut is a parent-only convenience.
  const kidsTab = document.getElementById("tabKids");
  if (kidsTab) { if (isKids) kidsTab.setAttribute("hidden", ""); else kidsTab.removeAttribute("hidden"); }

  const av = document.getElementById("sidebarAvatar");
  if (av && profile.name) { av.textContent = profile.name.charAt(0).toUpperCase(); if (profile.avatar_color) (av as HTMLElement).style.background = profile.avatar_color; }
  const em = document.getElementById("sidebarEmail");
  if (em && profile.name) em.textContent = profile.name;
}

// Land on Home: hide other panels, reveal home, mark the Home tab active.
function goHome(): void {
  ["showsView", "moviesView", "kidsView"].forEach((id) => document.getElementById(id)?.setAttribute("hidden", ""));
  document.getElementById("homeView")?.removeAttribute("hidden");
  document.querySelectorAll("aside .navBtn").forEach((b) => b.classList.remove("active"));
  document.getElementById("tabHome")?.classList.add("active");
}

// The full profile-entry cycle used at boot AND on every later switch: apply the
// profile's chrome, play the branded bump, then reveal a freshly rendered Home.
async function enterAsProfile(profile: { name?: string; avatar_color?: string; is_kids?: boolean }, dataReady?: Promise<unknown>): Promise<void> {
  applyProfileChrome(profile);
  const vod = await import("./vod");
  // Warm the VOD catalog WHILE the branded bump plays, so Home is already built
  // by the time the bump ends — no plain "loading" screen between them.
  const railsReady = vod.getVodRails().catch(() => {});
  playIdent(!!profile.is_kids, async () => {
    goHome();
    if (dataReady) await dataReady;
    await railsReady;
    void vod.renderHome();
  });
}

async function showPaywall(): Promise<void> {
  hideBootSplash();
  const { startCheckout } = await import("./db");
  const o = document.createElement("div");
  o.id = "paywall";
  o.style.cssText = "position:fixed;inset:0;z-index:99998;background:#06070a;color:#fff;display:flex;align-items:center;justify-content:center;padding:24px;font-family:'Space Grotesk',sans-serif;text-align:center;";
  o.innerHTML = `
    <div style="max-width:440px;">
      <div style="font-family:'Bricolage Grotesque',sans-serif;font-size:40px;font-weight:800;margin-bottom:10px;">veedeeoh<span style="color:#c5f04e;">.</span></div>
      <h1 style="font-size:26px;font-weight:800;margin:0 0 10px;">Your free trial has ended</h1>
      <p style="color:#9aa5b5;font-size:16px;line-height:1.6;margin:0 0 28px;">Subscribe to keep watching — every free service in one ad-free app, across your whole household.</p>
      <button id="pwSub" style="width:100%;padding:15px;border-radius:12px;background:#c5f04e;color:#06070a;border:none;font-weight:800;font-size:16px;cursor:pointer;">Subscribe — $4/mo · 3 profiles</button>
      <button id="pwOut" style="margin-top:16px;background:none;border:none;color:#9aa5b5;font-size:13px;cursor:pointer;">Sign out</button>
    </div>`;
  document.body.appendChild(o);
  const sub = o.querySelector("#pwSub") as HTMLButtonElement;
  sub.onclick = async () => {
    sub.disabled = true; sub.textContent = "Opening checkout…";
    try { await startCheckout(); }
    catch (e: any) { alert("Couldn't start checkout: " + (e?.message || e)); sub.disabled = false; sub.textContent = "Subscribe — $4/mo · 3 profiles"; }
  };
  (o.querySelector("#pwOut") as HTMLButtonElement).onclick = () => signOut();
}

async function boot(): Promise<void> {
  if (isCloudMode()) {
    const session = await restoreSession();
    if (!session) {
      window.location.href = '/landing.html';
      return;
    }
    // A legacy local-only session can't write to the DB (no auth.uid()), which
    // silently breaks profiles/favorites/watch. Require a REAL Supabase session;
    // if it's missing (not just a network blip), force a fresh login.
    try {
      const { data, error } = await getSupabase().auth.getUser();
      if (!error && !data.user) { signOut(); return; }
    } catch { /* transient network error — proceed rather than bounce */ }

    // Access gate: no active trial/subscription → paywall, not the app.
    try {
      const { hasActiveAccess } = await import("./db");
      if (!(await hasActiveAccess())) { void showPaywall(); return; }
    } catch { /* if the check errors, fail open rather than lock out a paying user */ }
  }

  // Hydrate profiles first so the active profile + gate list are real.
  await import("./profiles").then(p => p.hydrateProfilesFromCloud()).catch(() => {});

  // Kick off catalog + watched in the BACKGROUND — the profile gate + bump mask
  // this latency, so the home is fully loaded by the time the user lands on it.
  const dataReady = Promise.all([fetchCatalog(), fetchWatched()]).then(([data, watchedList]) => {
    state.region = data.region;
    state.favorites = new Set(data.favorites);
    state.watched = new Set(watchedList);
    state.health = new Map(Object.entries(data.health));
  }).catch(() => {});

  const homeView = $("homeView");
  wireSearchInputs();

  // Reveal home only once a profile is chosen and the catalog is in — the splash
  // and "Who's Watching" gate mask the load so home never appears half-built.
  // "Who's Watching?" gate → branded bump (with sound, on the tap) → loaded home.
  // The switcher is the first thing the user sees, so hand the splash off to it.
  // The SAME enterAsProfile cycle runs here and on every later profile switch.
  const prof = await import("./profiles");
  if (isCloudMode()) {
    prof.openProfileSwitcher((sel) => { void enterAsProfile(sel, dataReady); });
    hideBootSplash();
  } else {
    const active = prof.getActiveProfile();
    applyProfileChrome(active);
    hideBootSplash();
    if (homeView) homeView.removeAttribute("hidden");
    await dataReady;
    renderHome();
  }

  // Stripe Checkout return
  const billingStatus = new URLSearchParams(window.location.search).get("billing");
  if (billingStatus === "success") {
    showToast("🎉 Subscription active — welcome to veedeeoh Cloud!", 6000);
    window.history.replaceState({}, document.title, window.location.pathname);
  } else if (billingStatus === "cancel") {
    showToast("Checkout canceled — no charge was made.", 4000);
    window.history.replaceState({}, document.title, window.location.pathname);
  }

  // Check for non-geolocked family invite link activation
  const urlParams = new URLSearchParams(window.location.search);
  const inviteCode = urlParams.get("invite");
  const accName = urlParams.get("acc");
  const pendingInviteRaw = localStorage.getItem("veedeeoh_pending_household_invite");

  if (inviteCode || pendingInviteRaw) {
    let householdName = "Family Household";
    if (accName) householdName = decodeURIComponent(accName);
    else if (pendingInviteRaw) {
      try {
        const parsed = JSON.parse(pendingInviteRaw);
        if (parsed.householdName) householdName = parsed.householdName;
      } catch {}
    }

    // Real Supabase token (not the local 'inv_' fallback) + signed in → join the
    // household for real. Enforces the seat cap; surfaces "household full" if over.
    if (inviteCode && !inviteCode.startsWith("inv_") && getSession()?.access_token) {
      try {
        await (await import("./db")).acceptInvite(inviteCode);
        await import("./profiles").then(p => p.hydrateProfilesFromCloud());
        showToast(`🎉 You've joined ${householdName}!`, 5000);
      } catch (e: any) {
        showToast(`Couldn't join: ${e?.message || "invalid or full invite"}`, 6000);
      }
      localStorage.removeItem("veedeeoh_pending_household_invite");
      window.history.replaceState({}, document.title, window.location.pathname);
      renderHome();
    } else {
      localStorage.removeItem("veedeeoh_pending_household_invite");
      showToast(`🎉 Welcome to ${householdName}! Create your profile to get started.`, 5000);
      window.history.replaceState({}, document.title, window.location.pathname);
      import("./profiles").then(p => p.openProfileEditor());
    }
  }
}

function wireSidebar(): void {
  const tabs = ["tabHome", "tabShows", "tabMovies", "tabFavs", "tabKids"];
  const views = ["homeView", "showsView", "moviesView", "kidsView"];

  function switchView(activeTabId: string) {

    // Auto-minimize the player to PiP mode when navigating away
    const playerSuite = document.getElementById("playerSuite");
    if (playerSuite && !playerSuite.hasAttribute("hidden") && !playerSuite.classList.contains("docked")) {
      playerSuite.classList.add("docked");
      const pMin = document.getElementById("pMin");
      if (pMin) pMin.textContent = "Expand";
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

    // In a kids profile the whole app wears the kids identity, on every tab.
    if (activeTabId === "tabKids" || document.body.classList.contains("kids-mode")) {
      if (brand) brand.innerHTML = KIDS_WORDMARK;
      if (mobileBrand) mobileBrand.innerHTML = `v<span style="color:#ff9f1c;">k</span>`;
    } else {
      if (brand) brand.innerHTML = `veedeeoh<span>.</span>`;
      if (mobileBrand) mobileBrand.innerHTML = `v<span>.</span>`;
    }
    document.body.classList.remove("zzz-mode-active");

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
      import("./vod").then(vod => vod.renderFavorites());
    } else if (activeTabId === "tabKids") {
      $("kidsView").removeAttribute("hidden");
      import("./vod").then(vod => vod.renderKids($("kidsRails")));
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
        sidebarAvatar.textContent = activeP.name.charAt(0).toUpperCase();
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



  const sidebarUser = $("sidebarUser");
  if (sidebarUser) {
    sidebarUser.addEventListener("click", () => {
      import("./profiles").then(p => {
        const activeP = p.getActiveProfile();
        const existing = document.getElementById("userAccountMenuModal");
        if (existing) existing.remove();

        const modal = document.createElement("div");
        modal.id = "userAccountMenuModal";
        modal.style.cssText = "position:fixed;inset:0;background:rgba(6,7,10,0.85);backdrop-filter:blur(14px);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;color:#fff;font-family:'Space Grotesk',sans-serif;";
        modal.innerHTML = `
          <div style="background:#10141e;border:1px solid rgba(255,255,255,0.15);border-radius:20px;max-width:340px;width:100%;padding:24px;box-shadow:0 20px 50px rgba(0,0,0,0.9);text-align:center;">
            <div style="width:60px;height:60px;border-radius:14px;background:${activeP.avatar_color};display:flex;align-items:center;justify-content:center;font-size:24px;font-weight:800;color:#06070a;margin:0 auto 12px;">
              ${activeP.name.charAt(0).toUpperCase()}
            </div>
            <h3 style="margin:0 0 4px;font-size:18px;font-weight:800;">${activeP.name}</h3>
            <p style="margin:0 0 20px;font-size:12px;color:#9aa5b5;">Standard Profile</p>

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
            // Switching runs the SAME branded entry cycle as boot (chrome + bump
            // + fresh Home). The catalog is already loaded, so no dataReady needed.
            p.openProfileSwitcher((newP) => { void enterAsProfile(newP); });
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

import { initPWA } from "./pwa";

wireSidebar();
wireHeader();
wireVodDetails();
initPWA();
void boot();
// Safety net: never let the splash trap the user if boot stalls or throws.
setTimeout(hideBootSplash, 8000);
