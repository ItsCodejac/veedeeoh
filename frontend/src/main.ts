import "./style.css";
import { fetchCatalog, fetchWatched, getActiveRegion } from "./api";
import { state } from "./state";
import { $, showToast, escapeHtml, fixSvgDataUri } from "./util";
import { closeTopOverlay, registerOverlay } from "./overlay";
import { wireVodDetails, renderShows, renderMovies, wireSearchInputs, renderHome } from "./vod";
import { getSession, isCloudMode, restoreSession, signOut, getSupabase } from "./auth";
import { getActiveProfile } from "./profiles";

// Playful multicolor kids identity, used for the brand + kids theme.
// Colours live in style.css (.kwDot/.kwK/...), not here. This string and the
// one in index.html were two copies of the same lockup in two palettes.
const KIDS_WORDMARK = `veedeeoh<span class="kwDot">.</span><span class="kwK">k</span><span class="kwI">i</span><span class="kwD">d</span><span class="kwS">s</span>`;

// The wordmark carries the current context: veedeeoh.kids on a child profile,
// veedeeoh.uk when browsing another region's catalog, plain veedeeoh. at home.
// Written once, because it was previously spelled out in four places and any
// new variant had to be added to all of them or the header would disagree with
// itself between a tab switch and a profile change.
function applyWordmark(isKids: boolean): void {
  const brand = document.getElementById("brand");
  const mobileBrand = document.querySelector(".mobile-brand");

  if (isKids) {
    if (brand) brand.innerHTML = KIDS_WORDMARK;
    if (mobileBrand) mobileBrand.innerHTML = `v<span class="kwK">k</span>`;
    return;
  }

  // US is the default catalog, so it gets no suffix -- a permanent ".us" would
  // read as a badge on the normal state rather than a signal that something is
  // different.
  const code = getActiveRegion().toUpperCase();
  const region = REGION_NAMES[code];
  const sfx = code === "US" ? "" : (region?.suffix || code.toLowerCase());
  // The dot stays brand lime and only the suffix takes the region colour, so
  // the wordmark is still veedeeoh's with a region on it, not a repainted logo.
  const tint = sfx ? ` style="color:${region?.color || "var(--accent)"}"` : "";

  if (brand) brand.innerHTML = `veedeeoh<span>.</span><span${tint}>${escapeHtml(sfx)}</span>`;
  if (mobileBrand) mobileBrand.innerHTML = `v<span>.</span><span${tint}>${escapeHtml(sfx)}</span>`;
}

// Branded ident, played on profile SELECTION (a user gesture, so audio is
// allowed -- cold-boot autoplay cannot have sound).
//
// Both variants come from the design's own standalone component now. The hand
// port that used to live here matched the source numbers and still looked
// wrong, so none of it survived.
function playIdent(isKids: boolean, done: () => void): void {
  void import("./ident")
    .then((m) => m.playIdent(done, { variant: isKids ? "kids" : "main" }))
    .catch(done);
}

// Region switch splash. Non-US catalogs are built live rather than served from
// catalog_cache, so the swap takes seconds -- long enough that a silent blink
// reads as a glitch. Reuses the boot-splash language and the veedeeoh.kids /
// veedeeoh.party wordmark pattern, so the region becomes part of the brand
// rather than a dropdown that flickers.
// Each region carries ONE dominant colour, not its flag. Two prototypes proved
// the point: per-letter flag colours put an invisible black "d" on ".de", and
// full flag bands rendered into the letterforms as SVG gradients read as noise
// at the 20px the sidebar actually uses. A two-letter suffix has no room for a
// tricolour, so anything more than one colour is decoration that costs
// legibility.
//
// Same rule the .kids wordmark follows -- a legible palette that evokes, rather
// than literal reference colours. US is deliberately absent a suffix: a
// permanent ".us" would badge the default state instead of marking a changed
// one.
const REGION_NAMES: Record<string, { name: string; suffix: string; color: string }> = {
  US: { name: "United States", suffix: "us", color: "var(--accent)" },
  GB: { name: "United Kingdom", suffix: "uk", color: "#EF3340" },
  CA: { name: "Canada",         suffix: "ca", color: "#FF5A5F" },
  DE: { name: "Germany",        suffix: "de", color: "#FFCE00" },
  ES: { name: "Spain",          suffix: "es", color: "#FF8C1A" },
  MX: { name: "Mexico",         suffix: "mx", color: "#12B76A" },
  FR: { name: "France",         suffix: "fr", color: "#5A8DEF" },
};

function showRegionSplash(code: string): (subtitle?: string) => Promise<void> {
  const meta = REGION_NAMES[code.toUpperCase()]
    || { name: code, suffix: code.toLowerCase(), color: "var(--accent)" };
  const shownAt = Date.now();

  // Markup follows the "App boot" loader from the brand package
  // (Video bump ident design 2/Brand Loaders.dc.html): shimmering wordmark,
  // pulsing accent dot, sweeping track. Colours come from the CSS variables
  // rather than the spec's literals so it tracks the app, not a snapshot.
  const o = document.createElement("div");
  o.id = "regionSplash";
  o.innerHTML = `
    <div class="regionSplashInner">
      <div class="regionSplashMark">
        <span class="vdShimmerText">veedeeoh</span
        ><span class="vdDot"></span
        ><span class="sfx" style="color:${meta.color}">${escapeHtml(meta.suffix)}</span>
      </div>
      <div class="regionSplashSub" id="regionSplashSub">Loading the ${escapeHtml(meta.name)} catalog</div>
      <div class="vdTrackBar"><span></span></div>
    </div>`;
  document.body.appendChild(o);
  requestAnimationFrame(() => o.classList.add("in"));

  // Dismissal returns a promise so the caller can await the fade and keep the
  // splash up for a floor duration. Without the floor a warm cache dismisses it
  // in 80ms, which is the flicker this exists to remove.
  return async (subtitle?: string) => {
    if (subtitle) {
      const sub = document.getElementById("regionSplashSub");
      if (sub) sub.textContent = subtitle;
    }
    const held = Date.now() - shownAt;
    const floor = subtitle ? 1500 : 1100;
    if (held < floor) await new Promise((r) => setTimeout(r, floor - held));
    o.classList.remove("in");
    await new Promise((r) => setTimeout(r, 420));
    o.remove();
  };
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
  applyWordmark(isKids);

  // Kids: hide the adult browse tabs; parent: show them.
  ["tabShows", "tabMovies", "tabFavs"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.style.display = isKids ? "none" : "";
  });
  // The kids shortcut is a parent-only convenience.
  const kidsTab = document.getElementById("tabKids");
  if (kidsTab) { if (isKids) kidsTab.setAttribute("hidden", ""); else kidsTab.removeAttribute("hidden"); }
  // Hosting and joining are account-level, never a kids profile: a party link
  // handed to a child would otherwise play whatever the host is playing.
  const partyTab = document.getElementById("tabParty");
  if (partyTab) { if (isKids) partyTab.setAttribute("hidden", ""); else partyTab.removeAttribute("hidden"); }

  if (profile.name) paintProfileAvatar(document.getElementById("sidebarAvatar"), profile as any);
  const em = document.getElementById("sidebarEmail");
  if (em && profile.name) em.textContent = profile.name;
}

/** Paint a profile's avatar onto an element.
 *
 *  THE SIDEBAR NEVER SHOWED ONE. Both places that set it wrote the initial and
 *  the colour and ignored avatar_url entirely, so a chosen avatar appeared in
 *  the switcher and the editor and nowhere else -- which reads as the save
 *  having failed.
 *
 *  A remote value is treated as no avatar: an api.dicebear.com URL saved by the
 *  old picker would otherwise make the third-party request that generating
 *  locally exists to remove. Opening the profile editor regenerates it. */
function paintProfileAvatar(el: HTMLElement | null, p: { name: string; avatar_color?: string; avatar_url?: string | null }): void {
  if (!el) return;
  const url = (p.avatar_url || '').trim();
  const local = url && !/^https?:\/\//i.test(url) ? fixSvgDataUri(url) : '';
  if (local) {
    el.textContent = '';
    el.style.backgroundImage = `url("${local}")`;
    el.style.backgroundSize = 'cover';
    el.style.backgroundPosition = 'center';
  } else {
    el.style.backgroundImage = '';
    el.textContent = (p.name || '?').charAt(0).toUpperCase();
    if (p.avatar_color) el.style.background = p.avatar_color;
  }
}

// ---------------------------------------------------------------- routing ---
//
// The path is the single source of truth for which view is open. localStorage
// would restore a reload just as well, but only the URL also gives
// Back/Forward and a link someone can send -- and reload-restore without a
// working Back button is the more annoying half of the problem.
//
// PATHS, NOT A HASH. This used to read `/index.html#party`, because a real path
// would 404 on a hard load behind Vercel's filesystem handler. That was true
// and it is now fixed in vercel.json, which serves the app shell for anything
// the filesystem does not claim -- so `/party` and `/movies` survive a reload,
// a bookmark and a paste into a chat window.
//
// The hash was never only cosmetic. It is not sent to the server, so it cannot
// be redirected or rewritten; search engines do not index it; and every link
// anyone shared carried `/index.html` in front of it. Streaming apps put the
// section in the path -- /browse, /movies -- and so does this now.
//
// EVERY OLD LINK STILL WORKS. `#party`, `#host/<handle>`, `/index.html` and
// `/app` are all rewritten to their clean equivalent on arrival, once, with
// replaceState so Back does not bounce between the two spellings.

const ROUTES: Record<string, string> = {
  home: "tabHome", shows: "tabShows", movies: "tabMovies",
  favorites: "tabFavs", party: "tabParty", kids: "tabKids",
};

/** What the address bar shows for each route. `favorites` is the internal name
 *  and `list` is the one people read, which is the whole point of the change. */
const PATH_ALIAS: Record<string, string> = { favorites: "list" };
const ALIAS_BACK: Record<string, string> = { list: "favorites" };

/** The paths this app owns. Anything else on the origin is a real file or a
 *  static page, and the filesystem handler gets there first. */
function pathFor(route: string): string {
  if (!route || route === "home") return "/home";
  // A person is `/@handle` and nothing else. `u/` and `host/` both arrive here
  // from links that predate the rename, and both leave as the one spelling --
  // otherwise the same profile has three addresses and none of them is the
  // one printed on the settings page.
  const person = route.match(/^(?:u|host)\/(.+)$/);
  if (person) return "/@" + person[1];
  const [head, ...rest] = route.split("/");
  const mapped = PATH_ALIAS[head!] ?? head!;
  return "/" + [mapped, ...rest].join("/");
}

/** The inverse: read the current address and say which route it means.
 *
 *  A profile permalink is `/@handle`, which is the shape people already expect
 *  from every other place handles appear. `/u/` and the old `#host/` spelling
 *  are still accepted because links outlive renames. */
function routeFromPath(): string {
  const raw = decodeURIComponent(location.pathname).replace(/^\/+|\/+$/g, "");
  if (!raw || raw === "index.html" || raw === "app") return "home";
  if (raw.startsWith("@")) return "u/" + raw.slice(1);
  const [head, ...rest] = raw.split("/");
  const mapped = ALIAS_BACK[head!] ?? head!;
  return [mapped, ...rest].join("/");
}

/** Fold an old-style address into the new one, once, before anything routes.
 *
 *  Runs before the first applyRoute so the app never renders one spelling and
 *  then jumps to the other. replaceState rather than push: the address someone
 *  arrived with should not become a Back destination that sends them straight
 *  out again. */
export function normaliseUrl(): void {
  const hash = decodeURIComponent(location.hash.replace(/^#/, ""));
  const stale = /^\/(index\.html|app)\/?$/.test(location.pathname);
  if (!hash && !stale) return;
  const target = pathFor(hash || "home") + location.search;
  history.replaceState({}, "", target);
}

/** Set by wireSidebar so the router can drive the same code a click does. */
let switchViewRef: ((tabId: string) => void) | null = null;
/** True while the router is applying a hash, so switchView does not write one
 *  back and push a duplicate history entry. */
let applyingRoute = false;

function routeForTab(tabId: string): string {
  if (tabId.startsWith("tabSection:")) return `section/${tabId.slice("tabSection:".length)}`;
  const found = Object.entries(ROUTES).find(([, t]) => t === tabId);
  return found ? found[0] : "home";
}

/** Is this destination actually available to the profile that is signed in?
 *  A kids profile restoring #party or #movies would land on a blank panel with
 *  no active tab and no obvious way out. */
function routeAllowed(tabId: string): boolean {
  if (tabId === "tabHome") return true;
  const el = document.getElementById(tabId);
  if (!el) return false;
  if (el.hasAttribute("hidden")) return false;
  return el.style.display !== "none";
}

/** Reveal one full-page panel and hide every other. Routes that are not sidebar
 *  tabs (search, settings) need this because switchView only knows about tabs. */
function showOnly(panelId: string): void {
  for (const id of ["homeView", "showsView", "moviesView", "kidsView", "partyView",
                    "categoryView", "searchView", "settingsView", "notFoundView"]) {
    document.getElementById(id)?.setAttribute("hidden", "");
  }
  document.getElementById(panelId)?.removeAttribute("hidden");
  document.querySelectorAll("aside .navBtn").forEach((b) => b.classList.remove("active"));
}

/** Apply the current hash. Falls back to Home whenever the route is unknown or
 *  not permitted, rather than leaving the app in a half-navigated state. */
export async function applyRoute(): Promise<void> {
  const raw = routeFromPath();
  if (!raw || raw === "home") { switchViewRef?.("tabHome"); return; }

  if (raw === "settings" || raw.startsWith("settings/")) {
    const { settingsSections, renderSettings } = await import("./settingsview");
    // A kids profile has only the safe sections; if none survive the filter
    // there is nothing to show and Home is the honest destination.
    if (!settingsSections().length) { switchViewRef?.("tabHome"); return; }
    showOnly("settingsView");
    await renderSettings(raw.slice("settings/".length) || undefined);
    return;
  }

  // Someone's public profile. Inside the party panel rather than a panel of its
  // own: a permalink should land somewhere that already has the rest of the
  // party furniture around it, so "back to veedeeoh.party" is one step. Both
  // prefixes are accepted because #host/ shipped first and links outlive
  // renames.
  if (raw.startsWith("u/") || raw.startsWith("host/")) {
    const handle = raw.slice(raw.indexOf("/") + 1).trim();
    if (!handle) { switchViewRef?.("tabParty"); return; }
    const panel = document.getElementById("partyPanel");
    if (!panel) { switchViewRef?.("tabHome"); return; }
    showOnly("partyView");
    const { renderProfilePage } = await import("./partyview");
    await renderProfilePage(panel, handle);
    return;
  }

  if (raw.startsWith("search/")) {
    const q = raw.slice("search/".length).trim();
    if (!q) { switchViewRef?.("tabHome"); return; }
    const input = document.getElementById("search") as HTMLInputElement | null;
    if (input) input.value = q;
    const { openSearchResults } = await import("./search");
    await openSearchResults(q);
    return;
  }

  if (raw.startsWith("section/")) {
    const id = raw.slice("section/".length);
    // Section tabs are built asynchronously from the household's collections,
    // so on a cold load the button may not exist yet.
    const btn = document.querySelector<HTMLElement>(`[data-section-id="${CSS.escape(id)}"]`);
    if (btn) { switchViewRef?.(`tabSection:${id}`); return; }
    switchViewRef?.("tabHome");
    return;
  }

  const tabId = ROUTES[raw];
  if (!tabId) { showNotFound(raw); return; }
  // A KNOWN ROUTE THIS PROFILE MAY NOT REACH IS NOT A DEAD LINK. A kids
  // profile opening /party should land on Home, not be told the page does not
  // exist -- it does exist, it is just not theirs. Only an unrecognised route
  // gets the not-found screen.
  switchViewRef?.(routeAllowed(tabId) ? tabId : "tabHome");
}

/** The dead-link screen, inside the shell so the sidebar is still the way out. */
function showNotFound(route: string): void {
  const panel = document.getElementById("notFoundView");
  if (!panel) { switchViewRef?.("tabHome"); return; }
  showOnly("notFoundView");
  const where = document.getElementById("nfPath");
  // The address is shown as TEXT, never as markup: it came from the address
  // bar, which anyone can write anything into.
  if (where) where.textContent = "/" + route;
  panel.querySelectorAll<HTMLElement>("[data-nf]").forEach((b) => {
    b.onclick = () => switchViewRef?.(b.dataset.nf!);
  });
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
/** @param atBoot true when this selection is the first of the session, i.e. the
 *  switcher appeared because nobody was signed into a profile yet. */
async function enterAsProfile(
  profile: { name?: string; avatar_color?: string; is_kids?: boolean },
  dataReady?: Promise<unknown>,
  atBoot = false,
): Promise<void> {
  applyProfileChrome(profile);
  const vod = await import("./vod");
  // Warm the VOD catalog WHILE the branded bump plays, so Home is already built
  // by the time the bump ends — no plain "loading" screen between them.
  const railsReady = vod.getVodRails().catch(() => {});
  playIdent(!!profile.is_kids, async () => {
    // SWITCHING profiles starts at Home: the hash in the bar belongs to the
    // profile being left, and honouring it could drop a kids profile onto a
    // panel it is not supposed to reach.
    //
    // ARRIVING does not. At boot the switcher appears because nobody was
    // signed into a profile yet, and the hash came from the address the person
    // just opened -- so treating it as leftover threw away every deep link on
    // a cold load. veedeeoh.com/#kids, a bookmark, anything shared: all of
    // them landed on Home once a profile was picked.
    //
    // routeAllowed still applies either way, so an incoming route a kids
    // profile may not reach falls back to Home on its own merits rather than
    // because the hash was deleted first.
    if (!atBoot && routeFromPath() !== "home") {
      history.replaceState({}, "", "/home" + location.search);
    }
    if (atBoot && routeFromPath() !== "home") {
      applyingRoute = true;
      await applyRoute().finally(() => { applyingRoute = false; });
    } else {
      goHome();
    }
    if (dataReady) await dataReady;
    await railsReady;
    void vod.renderHome();
  });
}

// showPaywall() and enterAsPartyGuest() lived here.
//
// The guest shell hid the sidebar, the header and the catalogue and showed a
// lapsed visitor only the party they were invited to, because there was
// nothing else they were allowed to see. There is now: they get the ordinary
// app and the ordinary ?party= handler below, so when the party ends they are
// standing in the catalogue instead of in front of a wall.
//
// showWhatIsWaiting() went too -- the account's own half-finished films shown
// behind the price. It was the best thing on that screen and it is recorded in
// docs/plans, because it belongs on something that asks rather than blocks.

/** Trial countdown in the sidebar.
 *
 *  Six real trials expired with zero conversions, and the reason was not price:
 *  trialDaysLeft() was computed and rendered NOWHERE, so a trial ran out with no
 *  warning and the next visit was a full-screen paywall. Nobody was asked to
 *  convert; they were locked out.
 *
 *  Only appears in the last five days. A banner from day one is wallpaper by
 *  day six, and the point is to be noticed exactly when it matters.
 */
async function mountTrialNotice(): Promise<void> {
  const { trialDaysLeft, getAccount, startCheckout } = await import("./db");
  let days: number | null = null;
  let acct: any = null;
  try {
    [days, acct] = await Promise.all([trialDaysLeft(), getAccount()]);
  } catch { return; }

  // Paid and comped accounts have an expiry too; only a trial should be nagged.
  if (days === null || days > 5 || days < 0) return;
  if (!acct || !String(acct.tier || "").startsWith("trial")) return;
  // Kids profiles never see billing. It is not their account and the control
  // does nothing for them but take up the sidebar.
  const { getActiveProfile } = await import("./profiles");
  if (getActiveProfile()?.is_kids) return;

  const dismissedFor = localStorage.getItem("veedeeoh_trial_notice_day");
  if (dismissedFor === String(days)) return;   // dismissed today, back tomorrow

  const el = document.createElement("div");
  el.id = "trialNotice";
  el.innerHTML = `
    <div class="trialNoticeTop">
      <strong>${days === 0 ? "Trial ends today" : days === 1 ? "1 day left" : `${days} days left`}</strong>
      <button class="trialNoticeX" aria-label="Dismiss">&times;</button>
    </div>
    <p>Keep your profiles, lists and watch history. $4/mo for the household.</p>
    <button class="trialNoticeCta">Subscribe</button>`;

  document.querySelector("aside .sidebar-spacer")?.before(el);

  el.querySelector(".trialNoticeX")?.addEventListener("click", () => {
    localStorage.setItem("veedeeoh_trial_notice_day", String(days));
    el.remove();
  });
  el.querySelector(".trialNoticeCta")?.addEventListener("click", async () => {
    try { await startCheckout(); } catch { showToast("Couldn't start checkout"); }
  });
}

async function boot(): Promise<void> {
  // BEFORE ANYTHING ELSE READS THE URL. An arriving `#party` or `/index.html`
  // is folded into its clean equivalent here, so every later reader sees one
  // spelling and the app never renders one address then jumps to another.
  normaliseUrl();

  if (isCloudMode()) {
    const session = await restoreSession();
    if (!session) {
      // Carry the invite through sign-in. This dropped every parameter, so
      // someone following a watch party link with no account landed on a bare
      // landing page with no idea why, signed up, and arrived at Home with the
      // party gone.
      const q = new URLSearchParams(location.search);
      const carry = new URLSearchParams();
      for (const k of ['party', 'ref', 'invite', 'beta']) {
        const v = q.get(k);
        if (v) carry.set(k, v);
      }
      window.location.href = '/landing.html' + (carry.toString() ? `?${carry}` : '');
      return;
    }
    // A legacy local-only session can't write to the DB (no auth.uid()), which
    // silently breaks profiles/favorites/watch. Require a REAL Supabase session;
    // if it's missing (not just a network blip), force a fresh login.
    try {
      const { data, error } = await getSupabase().auth.getUser();
      if (!error && !data.user) { signOut(); return; }
    } catch { /* transient network error — proceed rather than bounce */ }

    // NO GATE AT THE DOOR. A free account gets the whole shell and the whole
    // catalogue; what it cannot do is press play, and it is told that on the
    // title it just tried to play rather than on a wall in front of everything.
    //
    // The wall was worse at the only job it had. It said "subscribe to keep
    // watching" to somebody who had never seen what they would be subscribing
    // to, and its only exit was Sign out. The block is per title now, at the
    // moment of intent, next to the thing being asked for.
    //
    // Enforcement is in openVodPlayer, not here and not on the card, so no
    // route into the player -- a card, the detail view, resume, search, a deep
    // link -- can miss it.
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

  // Resume the profile the user last chose rather than re-prompting. Showing the
  // picker on every reload was also a parental-lock bypass: a child in a kids
  // profile could reach an adult one just by refreshing, because from boot's
  // point of view that is a fresh session and no exit gate is ever consulted.
  // The picker now appears only on first run (or after sign-out), or when the
  // user explicitly asks to switch — which IS gated. It also stops the ident
  // bump replaying on every refresh, since that only runs on a real selection.
  const resumed = prof.getPersistedActiveProfile();
  if (resumed) {
    prof.setActiveProfile(resumed); // re-applies kids-mode chrome + fires the change event
    applyProfileChrome(resumed);
    hideBootSplash();
    // goHome() rather than just unhiding homeView: it also hides the other views
    // and marks the Home tab active, which is the state enterAsProfile leaves
    // behind. Unhiding by hand leaves the sidebar with no active tab.
    goHome();

    // The ident on a genuine app start.
    //
    // playIdent only ran from enterAsProfile, i.e. a real profile selection --
    // and since boot started restoring the persisted profile, that almost never
    // happens, so the splash stopped appearing at launch and only survived as
    // the in-player bump on first play. Keyed on sessionStorage: a fresh tab
    // gets it, a reload within the same session does not, which is what stops
    // it replaying on every refresh.
    try {
      if (!sessionStorage.getItem("veedeeoh_ident_at")) {
        playIdent(!!resumed.is_kids, () => {});
      }
    } catch { /* private mode: skip the ident rather than fail boot */ }

    await dataReady;
    // Skip building Home when a saved route is about to replace it -- every
    // switchView branch renders its own surface, including the Home fallback.
    // A party invite is a destination. Without this the route resolves to Home
    // first, Home renders, and joining happens behind it -- so a link that is
    // slow, or that fails, leaves someone looking at the catalogue with no
    // sign they were ever invited anywhere.
    const joining = !!new URLSearchParams(location.search).get("party")
      || /^join\//.test(routeFromPath());
    const restoring = joining || routeFromPath() !== "home";
    if (!restoring) renderHome();
    // Applied only now that the profile's chrome is on, so routeAllowed can see
    // which tabs this profile actually has.
    applyingRoute = true;
    if (joining) {
      // Park on veedeeoh.party rather than Home: it is the surface that makes
      // sense both while the invite is resolving and if it turns out to be
      // dead, and it is where the rejoin card lives.
      switchViewRef?.("tabParty");
      applyingRoute = false;
    } else {
      await applyRoute().finally(() => { applyingRoute = false; });
    }
  } else {
    // Boot, with no active profile: picking one IS the screen, so there is
    // nothing behind it to go back to and no close control to offer.
    prof.openProfileSwitcher((sel) => { void enterAsProfile(sel, dataReady, true); }, { dismissible: false });
    hideBootSplash();
  }

  void mountTrialNotice();

  // Decides whether cards show the watch party action. Re-run on profile change
  // because a kids profile may not host, and the answer is per profile as much
  // as per account.
  void import("./vod").then((v) => v.refreshHostingAffordance());
  window.addEventListener("veedeeoh:profile-changed", () => {
    void import("./vod").then((v) => v.refreshHostingAffordance());
  });

  // A referral link lands here: ?ref=CODE. Stashed rather than redeemed on the
  // spot, because a brand new visitor has no session yet and sign-up leaves the
  // page. redeemPendingReferral runs on every boot and no-ops once attributed.
  {
    const ref = new URLSearchParams(location.search).get("ref");
    if (ref) {
      const { rememberReferral } = await import("./db");
      rememberReferral(ref);
      history.replaceState({}, "", location.pathname);
    }
    void import("./db").then((db) => db.redeemPendingReferral());
  }

  // A party link lands here: ?party=CODE. Handled after the profile is resolved,
  // so the joining profile's rating limits are known before anything plays.
  // Both spellings: the readable `/join/ABC234` that partyLink now produces,
  // and `?party=ABC234`, which is on every invite anyone has already sent.
  const joinPath = routeFromPath().match(/^join\/([A-Za-z0-9]{4,8})$/);
  const partyCode = joinPath?.[1] || new URLSearchParams(location.search).get("party");
  if (partyCode) {
    const { joinParty } = await import("./party");
    // The code is stripped from the URL only AFTER the attempt starts, so a
    // reload during a slow join still carries the invite.
    void joinParty(partyCode.toUpperCase()).finally(() => {
      history.replaceState({}, "", "/party");
    });
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

/** Put a menu beside the control that opened it.
 *
 *  Below the anchor when there is room, above it when there is not -- the
 *  account chip lives at the bottom of the sidebar, so in practice it opens
 *  upward. Clamped to the viewport on both axes so a menu never hangs off the
 *  edge.
 *
 *  Skipped entirely under 768px, where the stylesheet makes this a bottom
 *  sheet: on a phone the anchor is inside a sheet that is itself pinned to the
 *  bottom, and a dropdown hanging off it would open into the dock.
 */
function anchorMenu(menu: HTMLElement, anchorEl: HTMLElement): void {
  if (window.matchMedia("(max-width: 768px)").matches) return;

  const a = anchorEl.getBoundingClientRect();
  const m = menu.getBoundingClientRect();
  const GAP = 8, EDGE = 12;

  const below = a.bottom + GAP;
  const top = below + m.height + EDGE <= window.innerHeight
    ? below
    : Math.max(EDGE, a.top - GAP - m.height);

  const left = Math.min(
    Math.max(EDGE, a.left),
    Math.max(EDGE, window.innerWidth - m.width - EDGE),
  );

  menu.style.position = "fixed";
  menu.style.top = `${Math.round(top)}px`;
  menu.style.left = `${Math.round(left)}px`;
}

function wireSidebar(): void {
  const tabs = ["tabHome", "tabShows", "tabMovies", "tabFavs", "tabParty", "tabKids"];

  // Section tabs are created at runtime, so their active state is managed
  // alongside the fixed ones rather than inside the tabs array.
  const clearSectionActive = () =>
    document.querySelectorAll<HTMLElement>("[data-section-id]").forEach((b) => b.classList.remove("active"));
  const views = ["homeView", "showsView", "moviesView", "partyView", "kidsView"];

  function switchView(activeTabId: string) {
    // Record the destination so a reload, a Back press or a shared link all
    // land here again. replaceState when the route is unchanged, so repeatedly
    // clicking the same tab does not stack identical history entries.
    if (!applyingRoute) {
      const next = pathFor(routeForTab(activeTabId));
      if (location.pathname !== next) history.pushState({}, "", next + location.search);
    }


    // Auto-minimize the player to PiP mode when navigating away
    const playerSuite = document.getElementById("playerSuite");
    if (playerSuite && !playerSuite.hasAttribute("hidden") && !playerSuite.classList.contains("docked")) {
      playerSuite.classList.add("docked");
      const pMin = document.getElementById("pMin");
      if (pMin) pMin.textContent = "Expand";
    }

    // The results page sits on top of the panel stack; leaving it hidden here
    // would make every sidebar tab look dead while search is open.
    document.getElementById("searchView")?.setAttribute("hidden", "");
    document.getElementById("settingsView")?.setAttribute("hidden", "");
    document.getElementById("categoryView")?.setAttribute("hidden", "");

    clearSectionActive();
    if (activeTabId.startsWith("tabSection:")) {
      const id = activeTabId.slice("tabSection:".length);
      document.querySelector<HTMLElement>(`[data-section-id="${CSS.escape(id)}"]`)?.classList.add("active");
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

    // Dynamic Logo & Theme Shift.
    // In a kids profile the whole app wears the kids identity, on every tab.
    applyWordmark(activeTabId === "tabKids" || document.body.classList.contains("kids-mode"));
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
    } else if (activeTabId === "tabParty") {
      $("partyView").removeAttribute("hidden");
      import("./partyview").then((pv) => pv.renderParty($("partyPanel")));
    } else if (activeTabId === "tabKids") {
      $("kidsView").removeAttribute("hidden");
      import("./vod").then(vod => vod.renderKids($("kidsRails")));
    } else if (activeTabId.startsWith("tabSection:")) {
      // Custom sections reuse homeView as their surface rather than each one
      // owning a container, so adding a section costs no markup.
      const el = $("homeView");
      el.removeAttribute("hidden");
      const id = activeTabId.slice("tabSection:".length);
      const btn = document.querySelector<HTMLElement>(`[data-section-id="${CSS.escape(id)}"]`);
      import("./vod").then((vod) => vod.renderSection(el, id, btn?.dataset.sectionName || "Section"));
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

  switchViewRef = switchView;
  window.addEventListener("popstate", () => {
    // Back closes what is on top before it navigates. Without this, Back on a
    // full-screen overlay left the app -- which on a phone, where Back is the
    // edge swipe, is the most common way anyone tries to retreat.
    if (closeTopOverlay()) return;
    applyingRoute = true;
    void applyRoute().finally(() => { applyingRoute = false; });
  });

  // Build the household's custom section tabs beneath the fixed nav, and rebuild
  // them whenever one is created from a card's + button.
  const mountSections = async () => {
    const anchor = document.getElementById("tabKids") || document.getElementById("tabFavs");
    if (!anchor?.parentElement) return;
    document.querySelectorAll("[data-section-id]").forEach((n) => n.remove());
    // A kids profile does not get household sections: they are curated by an
    // adult for an adult sidebar, and the content gate would filter them anyway.
    if (document.body.classList.contains("kids-mode")) return;
    const vod = await import("./vod");
    const sections = await vod.listSections().catch(() => []);
    for (const sec of sections) {
      const b = document.createElement("button");
      b.className = "navBtn";
      b.dataset.sectionId = sec.id;
      b.dataset.sectionName = sec.name;
      b.title = sec.name;
      b.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h6l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"></path></svg><span>${escapeHtml(sec.name)}</span>`;
      b.addEventListener("click", () => switchView(`tabSection:${sec.id}`));
      anchor.parentElement.insertBefore(b, anchor.nextSibling);
    }
  };
  // Section tabs are built from the household's collections, so on a cold load
  // they do not exist yet when applyRoute first runs. Re-apply a #section route
  // once they are there, or restoring a reload into a custom section silently
  // falls back to Home.
  void mountSections().then(() => {
    if (!routeFromPath().startsWith("section/")) return;
    applyingRoute = true;
    void applyRoute().finally(() => { applyingRoute = false; });
  });
  window.addEventListener("veedeeoh:sections-changed", () => void mountSections());
  window.addEventListener("veedeeoh:profile-changed", () => void mountSections());

  // ---- Mobile overflow sheet -------------------------------------------
  // On phones the sidebar becomes a bottom bar where every .navBtn is flex:1,
  // so each addition -- kids shortcut, custom sections, feedback, install --
  // squeezes the rest. Four destinations stay in the bar; everything else opens
  // from here. Entries forward to the real controls rather than duplicating
  // their behaviour, so there is still one source of truth for each action.
  const buildMobileSheet = () => {
    document.getElementById("mobileSheet")?.remove();

    const sheet = document.createElement("div");
    sheet.id = "mobileSheet";
    sheet.innerHTML = `<div id="mobileSheetPanel"><div class="grabber"></div></div>`;
    const panel = sheet.querySelector("#mobileSheetPanel") as HTMLElement;
    const close = () => sheet.classList.remove("open");
    sheet.addEventListener("click", (e) => { if (e.target === sheet) close(); });

    const head = (text: string) => {
      const d = document.createElement("div");
      d.className = "sheetHead";
      d.textContent = text;
      panel.appendChild(d);
    };
    const item = (label: string, icon: string, onClick: () => void, danger = false) => {
      const b = document.createElement("button");
      b.className = "sheetItem" + (danger ? " danger" : "");
      b.innerHTML = `${icon}<span>${escapeHtml(label)}</span>`;
      b.addEventListener("click", () => { close(); onClick(); });
      panel.appendChild(b);
    };
    // Forward to the real sidebar control, so behaviour cannot drift.
    const forward = (sel: string) => () => document.querySelector<HTMLElement>(sel)?.click();

    const ICON = {
      kids: `<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>`,
      party: `<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
      folder: `<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h6l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"/></svg>`,
      user: `<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`,
      chat: `<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`,
      down: `<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`,
      out: `<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>`,
      gear: `<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`,
    };

    const sections = Array.from(document.querySelectorAll<HTMLElement>("aside [data-section-id]"));
    if (sections.length) {
      head("Your sections");
      for (const sec of sections) {
        item(sec.dataset.sectionName || "Section", ICON.folder, () => sec.click());
      }
    }

    head("Browse");
    const party = document.getElementById("tabParty");
    if (party && !party.hasAttribute("hidden")) item("veedeeoh.party", ICON.party, () => party.click());
    const kids = document.getElementById("tabKids");
    if (kids && !kids.hasAttribute("hidden")) item("veedeeoh.kids", ICON.kids, () => kids.click());

    head("Account");
    // SETTINGS, BY NAME. It was reachable only as a side effect of "Switch
    // profile" -- that opens the account menu, which has a Settings button in
    // it -- so on a phone the way to Settings was three taps behind a label
    // that does not mention it. Nobody finds that.
    item("Settings", ICON.gear, () => {
      sheet.classList.remove("open");
      void import("./settingsview").then((m) => m.openSettings());
    });
    item("Account and profiles", ICON.user, forward("#sidebarUser"));
    if (document.getElementById("fbEntry")) item("Report something", ICON.chat, forward("#fbEntry"));
    if (document.getElementById("pwaInstallEntry")) item("Install app", ICON.down, forward("#pwaInstallEntry .sidebar-install-main"));
    item("Sign out", ICON.out, forward("#logoutBtn"), true);

    document.body.appendChild(sheet);
    return sheet;
  };

  // The "More" button lives in the bar itself, styled by the mobile query.
  const moreBtn = document.createElement("button");
  moreBtn.id = "mobileMore";
  moreBtn.className = "navBtn";
  moreBtn.title = "More";
  moreBtn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg><span>More</span>`;
  moreBtn.addEventListener("click", () => {
    const sheet = buildMobileSheet();          // rebuilt each open, so new sections appear
    requestAnimationFrame(() => sheet.classList.add("open"));
  });
  document.querySelector("aside")?.appendChild(moreBtn);

  const session = getSession();
  const sidebarUser = document.getElementById("sidebarUser");
  const sidebarEmail = document.getElementById("sidebarEmail");
  const sidebarAvatar = document.getElementById("sidebarAvatar");
  const logoutBtn = document.getElementById("logoutBtn");

  const updateSidebarProfileDisplay = () => {
    import("./profiles").then(p => {
      const activeP = p.getActiveProfile();
      if (sidebarEmail) sidebarEmail.textContent = activeP.name;
      paintProfileAvatar(sidebarAvatar, activeP);
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
      regionSelector.addEventListener("change", async (e) => {
        const sel = e.target as HTMLSelectElement;
        const val = sel.value;
        api.setActiveRegion(val);

        // Drop the cached catalog FIRST. getVodRails hands back the rails it
        // already has without re-fetching, so re-rendering alone just redraws
        // the previous region and the control looks dead.
        const vod = await import("./vod");
        vod.invalidateCatalogCache();

        // Only US is written to catalog_cache by the cron; other regions build
        // live and take a few seconds. Cover the swap rather than blinking.
        sel.disabled = true;
        applyWordmark(document.body.classList.contains("kids-mode"));
        const dismiss = showRegionSplash(val);

        $("showsRails")?.replaceChildren();
        $("moviesRails")?.replaceChildren();
        try {
          const rails = await vod.getVodRails();
          const titles = new Set(rails.flatMap((r) => r.items.map((i: any) => String(i.id)))).size;
          // Render BEHIND the splash, so it lifts on a finished screen instead
          // of on a half-built one.
          await renderHome();
          await dismiss(`${titles.toLocaleString()} titles`);
        } catch {
          await dismiss("Couldn't load that catalog");
        } finally {
          sel.disabled = false;
        }
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

        // AN ANCHORED MENU, NOT A MODAL. Four shortcuts used to blur the whole
        // app and open in the centre of the screen, so the control you clicked
        // sat in the bottom-left corner and its own menu appeared six hundred
        // pixels away. It read as a page transition for what is a dropdown.
        // The scrim is transparent now and exists only to catch the click that
        // dismisses.
        const modal = document.createElement("div");
        modal.id = "userAccountMenuModal";
        modal.className = "acctScrim";
        // Identity and navigation only. It used to carry its own Subtitles and
        // Quality controls, which duplicated Settings > Playback AND disagreed
        // with it -- this menu wrote "true"/"false" and "1080p" while Settings
        // wrote "1"/"0" and "1080", so the two could never agree on what was
        // set. Preferences live in one place now.
        modal.innerHTML = `
          <div class="acctMenu" role="menu">
            <div style="width:60px;height:60px;border-radius:14px;background:${p.profileFace(activeP).background};display:flex;align-items:center;justify-content:center;font-size:24px;font-weight:800;color:#06070a;margin:0 auto 12px;">
              ${escapeHtml(p.profileFace(activeP).letter)}
            </div>
            <h3 style="margin:0 0 4px;font-size:18px;font-weight:800;">${escapeHtml(activeP.name)}</h3>
            <p style="margin:0 0 20px;font-size:12px;color:#9aa5b5;">${
              activeP.is_kids ? 'Kids profile' : activeP.role === 'owner' ? 'Account owner' : 'Household member'
            }</p>

            <div class="acctItems">
              <button id="menuSwitchProfileBtn" class="acctItem">
                ${activeP.is_kids
                  ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg><span>Exit kids mode</span>'
                  : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle></svg><span>Who&rsquo;s watching</span>'}
              </button>

              ${activeP.is_kids ? '' : `
              <button id="menuEditProfileBtn" class="acctItem">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z"/></svg>
                <span>Edit this profile</span>
              </button>
              <button id="menuOpenSettingsBtn" class="acctItem">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
                <span>Settings</span>
              </button>
              <button id="menuSignOutBtn" class="acctItem danger">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
                <span>Sign out</span>
              </button>
              `}
            </div>

            <button id="menuCloseBtn" class="acctClose">Close</button>
          </div>
        `;

        document.body.appendChild(modal);
        const ov = registerOverlay(modal, { dismissOn: modal });
        modal.querySelector("#menuCloseBtn")?.addEventListener("click", () => ov.close());
        anchorMenu(modal.querySelector(".acctMenu") as HTMLElement, sidebarUser);

        const switchBtn = modal.querySelector("#menuSwitchProfileBtn");
        if (switchBtn) {
          switchBtn.addEventListener("click", () => {
            ov.close();
            // Switching runs the SAME branded entry cycle as boot (chrome + bump
            // + fresh Home). The catalog is already loaded, so no dataReady needed.
            p.openProfileSwitcher((newP) => { void enterAsProfile(newP); });
          });
        }

        // EDITING A PROFILE WAS FOUR CLICKS AND NEVER CALLED EDIT: You >
        // Switch profile > Manage Profiles > tap an avatar. Nothing in that
        // chain said what it led to, and "Manage Profiles" renames itself to
        // "Done" the moment you are in it. Two clicks now, by its own name.
        modal.querySelector("#menuEditProfileBtn")?.addEventListener("click", () => {
          ov.close();
          p.openProfileEditor(p.getActiveProfile());
        });

        const setBtn = modal.querySelector("#menuOpenSettingsBtn");
        if (setBtn) {
          setBtn.addEventListener("click", () => {
            ov.close();
            import("./settingsview").then((s) => s.openSettings());
          });
        }

        modal.querySelector("#menuSignOutBtn")?.addEventListener("click", () => {
          ov.close();
          void signOut();
        });
      });
    });
  }

  if (searchInput) {
    // Raw value, not lowercased: ranking normalises for itself, and the results
    // page echoes the query back to the user the way they typed it.
    searchInput.addEventListener("input", (e) => {
      clearTimeout(searchTimer);
      searchTimer = window.setTimeout(() => {
        const query = (e.target as HTMLInputElement).value.trim();
        import("./vod").then((vod) => vod.setGlobalSearchQuery(query));
      }, 150);
    });

    // Enter goes to the full results page. Every other search box on the web
    // behaves this way, and the dropdown alone was a dead end.
    searchInput.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      const query = searchInput.value.trim();
      if (!query) return;
      e.preventDefault();
      searchInput.blur();
      void import("./search").then((m) => m.openSearchResults(query));
    });
  }

  document.getElementById("searchViewBackBtn")?.addEventListener("click", () => {
    void import("./search").then((m) => m.closeSearchResults());
  });
}

import { initPWA } from "./pwa";
import { installConsoleCapture, mountFeedbackEntry } from "./feedback";

// Every build emits freshly hashed chunks and emptyOutDir removes the previous
// ones, so a page that was loaded before a deploy will request a chunk that no
// longer exists. Vercel answers with 404.html, the browser rejects it on MIME
// type ("text/html"), and the dynamic import throws -- which is what killed
// playback: the Vidstack layout chunk is loaded lazily by VidstackPlayer.create.
// Reloading picks up the new index.html and its current hashes. Guarded so a
// genuinely missing asset cannot put the page in a reload loop.
window.addEventListener("vite:preloadError", (e) => {
  const KEY = "veedeeoh_chunk_reload_at";
  const last = Number(sessionStorage.getItem(KEY) || 0);
  if (Date.now() - last < 30_000) return; // already tried; let the error surface
  sessionStorage.setItem(KEY, String(Date.now()));
  e.preventDefault();
  location.reload();
});

wireSidebar();
wireHeader();
wireVodDetails();
initPWA();
// Capture console errors from here on, so a report carries whatever went wrong.
installConsoleCapture();
mountFeedbackEntry();
void boot();
// Safety net: never let the splash trap the user if boot stalls or throws.
setTimeout(hideBootSplash, 8000);
