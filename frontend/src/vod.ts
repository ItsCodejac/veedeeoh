import { fetchArchiveStream, fetchPlutoStream, fetchTubiStream, fetchVod, fetchVodSeries, toggleWatched } from "./api";
import { state } from "./state";
import type { Stream, VodItem, VodEpisode, VodRail } from "./types";
import { escapeHtml, $, setupHorizontalScroll, buildBrandLoader, buildRailSkeleton, showToast } from "./util";
import { getActiveProfile, getStoredProfiles } from "./profiles";
import { maturityCeiling, allowedRatingsFor, addFavorite, removeFavorite, getWatchHistory, listExclusions, listApprovedContent, filterRailsForGatedProfile, tvMaturity, listCollections, listCollectionItems, createSection, addToCollection, allowForAge, excludeFromProfile, unexcludeFromProfile } from "./db";
import { openVodPlayer } from "./vodplayer";

// The active profile's real Supabase id (null for local/unsynced placeholders).
function activeProfileUuid(): string | null {
  const id = getActiveProfile().id;
  return id && !id.startsWith("default_") && !id.startsWith("profile_") ? id : null;
}

// Shared inline icons (no emoji anywhere in the UI).
const FILM_ICON = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="2.18"></rect><line x1="7" y1="2" x2="7" y2="22"></line><line x1="17" y1="2" x2="17" y2="22"></line><line x1="2" y1="12" x2="22" y2="12"></line><line x1="2" y1="7" x2="7" y2="7"></line><line x1="2" y1="17" x2="7" y2="17"></line><line x1="17" y1="17" x2="22" y2="17"></line><line x1="17" y1="7" x2="22" y2="7"></line></svg>`;
const CHECK_ICON = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;

let cachedVodRails: VodRail[] | null = null;
let showsSearchQuery = "";
let showsActiveGenre = "";
let moviesSearchQuery = "";
let moviesActiveGenre = "";

export async function setGlobalSearchQuery(query: string): Promise<void> {
  const overlay = $("searchResultsOverlay");
  const searchBar = $("searchBar");

  if (!query) {
    overlay.hidden = true;
    searchBar.classList.remove("active");
    return;
  }

  overlay.hidden = false;
  searchBar.classList.add("active");
  overlay.innerHTML = `<div class="searchNoResults">Searching...</div>`;

  // Same ranking the results page uses, so the preview is the top of the real
  // list rather than a differently-ordered sample of it.
  const { searchCatalog } = await import("./search");
  const results = await searchCatalog(query);

  // A slow catalog load can land after the box was cleared or retyped.
  if (($("search") as HTMLInputElement | null)?.value.trim().toLowerCase() !== query.toLowerCase()) return;

  if (results.length === 0) {
    overlay.innerHTML = `<div class="searchNoResults">No results found for "${escapeHtml(query)}"</div>`;
    return;
  }

  const byId = new Map(results.map((r) => [r.id, r]));
  const movies = results.filter((i) => !i.series_id).slice(0, 5);
  const shows = results.filter((i) => !!i.series_id).slice(0, 5);

  let html = "";
  const renderGroup = (title: string, items: VodItem[]) => {
    if (items.length === 0) return;
    html += `<div class="searchGroupTitle">${title}</div>`;
    items.forEach((item) => {
      const img = item.banner || item.poster || "";
      const rating = item.rating ? ` \u00b7 ${item.rating}` : "";
      html += `
        <button class="searchResultItem vodResult" data-id="${item.id}">
          <img class="searchResultImage" src="${escapeHtml(img)}" alt="">
          <div class="searchResultMeta">
            <div class="searchResultTitle">${escapeHtml(item.title)}</div>
            <div class="searchResultDesc">${escapeHtml(item.genre || "")}${rating}</div>
          </div>
        </button>`;
    });
  };

  renderGroup("Movies", movies);
  renderGroup("TV Shows", shows);

  // The way out of the dropdown. Without it the preview IS the search, which is
  // exactly the dead end this replaces.
  html += `<button class="searchSeeAll" id="searchSeeAll">
      See all ${results.length} ${results.length === 1 ? "result" : "results"}
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>
    </button>`;

  overlay.innerHTML = html;

  overlay.querySelectorAll(".vodResult").forEach((btn) => {
    btn.addEventListener("click", () => {
      const item = byId.get((btn as HTMLElement).dataset.id!);
      if (item) {
        openVodDetails(item);
        overlay.hidden = true;
        searchBar.classList.remove("active");
      }
    });
  });

  overlay.querySelector("#searchSeeAll")?.addEventListener("click", () => {
    void import("./search").then((m) => m.openSearchResults(query));
  });
}

// Click outside to close
document.addEventListener("click", (e) => {
  const overlay = document.getElementById("searchResultsOverlay");
  const container = document.getElementById("searchContainer");
  if (overlay && container && !overlay.hidden) {
    if (!container.contains(e.target as Node)) {
      overlay.hidden = true;
      document.getElementById("searchBar")?.classList.remove("active");
    }
  }
});

// Per-profile exclusion cache. Cleared when the active profile changes so one
// profile's removals can never be applied to another.
let cachedExclusions: { profileId: string; ids: Set<string> } | null = null;
if (typeof window !== "undefined") {
  window.addEventListener("veedeeoh:profile-changed", () => { cachedExclusions = null; cachedApproved = null; });
}

// Approved set per profile tier, cached alongside exclusions.
let cachedApproved: { ceiling: number; ids: Set<string> } | null = null;

async function approvedFor(ceiling: number): Promise<Set<string>> {
  if (cachedApproved?.ceiling === ceiling) return cachedApproved.ids;
  const ids = await listApprovedContent(ceiling).catch(() => new Set<string>());
  cachedApproved = { ceiling, ids };
  return ids;
}

async function exclusionsFor(profileId: string): Promise<Set<string>> {
  if (cachedExclusions?.profileId === profileId) return cachedExclusions.ids;
  const isCloudProfile = profileId && !profileId.startsWith("default_") && !profileId.startsWith("profile_");
  const ids = isCloudProfile ? await listExclusions(profileId).catch(() => new Set<string>()) : new Set<string>();
  cachedExclusions = { profileId, ids };
  return ids;
}

/** Drop excluded titles. A parent's removal beats every collection and every
 *  automatic rule, so this is applied last and unconditionally. */
function applyExclusions<T extends { items: any[] }>(rails: T[], excluded: Set<string>): T[] {
  if (!excluded.size) return rails;
  return rails
    .map((r) => ({ ...r, items: r.items.filter((i: any) => !excluded.has(String(i.id))) }))
    .filter((r) => r.items.length > 0);
}

/** Invalidate after a parent adds or removes an exclusion. */
export function invalidateExclusions(): void { cachedExclusions = null; cachedApproved = null; }

/** Drop the whole catalog, not just the gate caches. Needed when the REGION
 *  changes: getVodRails returns cachedVodRails without re-fetching, so without
 *  this the previous region's rails are simply re-rendered and the selector
 *  looks broken. Also clears the two derived caches, since approvals and
 *  exclusions are keyed on content ids that may not exist in the new catalog. */
export function invalidateCatalogCache(): void {
  cachedVodRails = null;
  cachedExclusions = null;
  cachedApproved = null;
}

export async function getVodRails(): Promise<VodRail[]> {
  if (!cachedVodRails || cachedVodRails.length === 0) {
    const res = await fetchVod();
    if (res.rails && res.rails.length > 0) {
      cachedVodRails = res.rails;
    }
  }
  const full = cachedVodRails || [];
  // Restricted profiles only ever see content at/below their rating cap. This is
  // the single chokepoint for home/shows/movies, so no render path can surface
  // adult content to a kids profile. A kids profile is HARD-capped at TV-G (2)
  // regardless of max_rating — belt-and-suspenders so a mis-set cap can't leak.
  const p = getActiveProfile();
  // Kids profiles get the strict genre+maturity gate (not maturity alone), so a
  // low-rated non-kids title can never appear in the kid view.
  const ceiling = maturityCeiling(p.max_rating);
  // Kids profiles get the genre+maturity gate AND their own rating cap. Applying
  // only the kids gate would ignore max_rating entirely, so a profile set to
  // "Little Kids (TV-Y)" would still be shown TV-Y7 and G titles.
  const excluded = await exclusionsFor(p.id);

  // A profile with a rating cap is GATED: it sees TV-rated content within its
  // ceiling, plus whatever a human has explicitly approved. Nothing else. Only
  // the TV Parental Guidelines (1997) are trusted to gate automatically --
  // MPAA letters drifted when PG-13 was introduced in 1984, and we have no
  // release year for Pluto titles to correct for it.
  //
  // This replaces the genre gate entirely. KIDS_SIGNAL_RE tested the RAIL NAME
  // as well as the item, so its verdict was constant across a rail and Tubi's
  // "Adult Animation" rail matched /animat/. The rating does the work now.
  const allowed = allowedRatingsFor(p);
  if (allowed) {
    const approved = await approvedFor(ceiling);
    return applyExclusions(filterRailsForGatedProfile(full, allowed, approved), excluded) as VodRail[];
  }

  // Ungated (adult) profile: everything, minus anything the household removed.
  return applyExclusions(full, excluded) as VodRail[];
}

// Continue Watching is stored PER PROFILE so a kids profile never sees an adult
// profile's resume cards (and vice-versa). Keyed on the active profile id.
function resumeHistoryKey(): string {
  let id = "default";
  try { id = getActiveProfile()?.id || "default"; } catch {}
  return `tvlc_resume_history_${id}`;
}

function getResumeHistory(): any[] {
  try { return JSON.parse(localStorage.getItem(resumeHistoryKey()) || "[]"); } catch { return []; }
}

// Genres the active profile has actually engaged with, most-watched first. Drives
// personalized rail ordering and the "Because you watched" row.
function getTasteGenres(): string[] {
  const counts: Record<string, number> = {};
  for (const r of getResumeHistory()) {
    if (r?.genre) counts[r.genre] = (counts[r.genre] || 0) + 1;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([g]) => g);
}

// Where a taste genre appears in a rail's name → its rank (lower = more relevant).
function railTasteRank(name: string, taste: string[]): number {
  const n = name.toLowerCase();
  for (let i = 0; i < taste.length; i++) {
    const g = taste[i];
    // Word boundary, not containment: taste genre "War" matched
    // "Award-Winning Movies" (a-WAR-d) and promoted it to the top rail.
    if (g && new RegExp(`\\b${g.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(n)) return i;
  }
  return 999;
}

// Order rails by the profile's taste first, then editorial priority, then size.
function sortRailsByTaste<T extends { name: string; items: any[] }>(rails: T[]): T[] {
  const taste = getTasteGenres();
  return rails.sort((a, b) => {
    const ra = railTasteRank(a.name, taste), rb = railTasteRank(b.name, taste);
    if (ra !== rb) return ra - rb;
    const pa = getRailPriorityScore(a.name), pb = getRailPriorityScore(b.name);
    if (pa !== pb) return pa - pb;
    return b.items.length - a.items.length;
  });
}


export function resumeVodPlayback(resumeItem: any): void {
  const ch: any = {
    id: `vod:${resumeItem.itemId}`,
    name: resumeItem.title,
    country: null,
    categories: [],
    nsfw: false,
    logo: null,
    logos: [],
    streams: resumeItem.streams,
    source: "Resume Playback",
    vodPoster: resumeItem.poster,
    vodBanner: resumeItem.banner,
    vodItem: resumeItem.vodItem
  };
  
  openVodPlayer(ch, resumeItem.streamIdx, resumeItem.time);
}

// Legacy hand-rolled player — superseded by the Vidstack module (./vodplayer).
// Kept as dead-code fallback until the new player is verified on-device, then delete.


export function wireVodDetails(): void {
  $("vdClose").addEventListener("click", () => {
    $("vodDetailsOverlay").setAttribute("hidden", "");
  });
  $("vodDetailsOverlay").addEventListener("click", (e) => {
    if (e.target === $("vodDetailsOverlay")) {
      $("vodDetailsOverlay").setAttribute("hidden", "");
    }
  });
}

function asChannel(item: VodItem, streams: Stream[]): any {
  return {
    id: `vod:${item.id}`,
    name: item.title,
    country: null,
    categories: [],
    nsfw: false,
    logo: null,
    logos: [],
    streams,
    source: item.genre || "On Demand",
    vodPoster: item.poster,
    vodBanner: item.banner,
    vodItem: item,
  };
}

// Parent controls in the detail view: allow a title for a kids tier, or hide it
// from a specific kids profile. Hidden on kids profiles themselves, so a child
// cannot grant themselves access.
//
// Exclusions take effect immediately -- they are applied at the getVodRails
// chokepoint and beat every automatic rule. Allowances only become visible when
// the collections gate is switched on; until then they are being banked.
function setupParentControls(item: VodItem): void {
  const existing = document.getElementById("vdParentBtn");
  existing?.remove();
  document.getElementById("vdParentMenu")?.remove();

  if (getActiveProfile()?.is_kids) return;               // never offer this to a child
  const kidsProfiles = getStoredProfiles().filter((p) => p.is_kids);
  const anchor = document.getElementById("vdMyListBtn") || document.getElementById("vdPlayBtn");
  if (!anchor?.parentElement) return;

  const btn = document.createElement("button");
  btn.id = "vdParentBtn";
  btn.className = anchor.className;
  btn.style.cssText = "background:rgba(255,255,255,0.12);border:1px solid rgba(255,255,255,0.25);color:#fff;display:inline-flex;align-items:center;gap:8px;";
  btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>Kids access`;
  anchor.parentElement.insertBefore(btn, anchor.nextSibling);

  btn.onclick = async (e) => {
    e.stopPropagation();
    if (document.getElementById("vdParentMenu")) { document.getElementById("vdParentMenu")!.remove(); return; }

    const menu = document.createElement("div");
    menu.id = "vdParentMenu";
    menu.style.cssText = "position:absolute;z-index:10060;min-width:260px;background:#10141e;border:1px solid rgba(255,255,255,.16);border-radius:12px;padding:8px;box-shadow:0 18px 44px rgba(0,0,0,.7);font-family:'Space Grotesk',sans-serif;";
    const r = btn.getBoundingClientRect();
    menu.style.left = `${Math.max(12, r.left)}px`;
    menu.style.top = `${r.bottom + 8}px`;

    const row = (label: string, sub: string, onClick: () => void) => {
      const b = document.createElement("button");
      b.style.cssText = "display:block;width:100%;text-align:left;padding:9px 10px;border:none;border-radius:8px;background:none;color:#fff;cursor:pointer;font:600 13px 'Space Grotesk',sans-serif;";
      b.innerHTML = `${label}<div style="font-weight:500;font-size:11.5px;color:#9aa5b5;margin-top:2px">${sub}</div>`;
      b.onmouseenter = () => (b.style.background = "rgba(255,255,255,.08)");
      b.onmouseleave = () => (b.style.background = "none");
      b.onclick = async () => { menu.remove(); onClick(); };
      menu.appendChild(b);
    };

    row("Allow for Little Kids", "Adds it to your household's approved list", async () => {
      try { await allowForAge(0, { id: item.id, isSeries: !!item.series_id }); showToast("Allowed for Little Kids"); }
      catch (err: any) { showToast(err?.message || "Could not save"); }
    });
    row("Allow for Older Kids", "Adds it to your household's approved list", async () => {
      try { await allowForAge(1, { id: item.id, isSeries: !!item.series_id }); showToast("Allowed for Older Kids"); }
      catch (err: any) { showToast(err?.message || "Could not save"); }
    });

    if (kidsProfiles.length) {
      const sep = document.createElement("div");
      sep.style.cssText = "height:1px;background:rgba(255,255,255,.1);margin:6px 4px;";
      menu.appendChild(sep);
      for (const kp of kidsProfiles) {
        const cloud = kp.id && !kp.id.startsWith("default_") && !kp.id.startsWith("profile_");
        row(`Hide from ${escapeHtml(kp.name)}`, cloud ? "Takes effect immediately" : "Needs a cloud profile", async () => {
          if (!cloud) { showToast("That profile isn't synced yet"); return; }
          try {
            await excludeFromProfile(kp.id, item.id);
            invalidateExclusions();
            showToast(`Hidden from ${kp.name}`);
          } catch (err: any) { showToast(err?.message || "Could not hide"); }
        });
      }
    }

    document.body.appendChild(menu);
    setTimeout(() => document.addEventListener("click", function away() {
      menu.remove(); document.removeEventListener("click", away);
    }, { once: true }), 0);
  };
}

// Watch Party: host a title for other people. Account-level, so it is absent on
// kids profiles rather than merely hidden -- and the server checks again.
async function setupWatchPartyButton(item: VodItem): Promise<void> {
  document.getElementById("vdPartyBtn")?.remove();
  const party = await import("./party");
  if (!(await party.canHost())) return;

  const anchorBtn = document.getElementById("vdParentBtn")
    || document.getElementById("vdMyListBtn")
    || document.getElementById("vdPlayBtn");
  if (!anchorBtn?.parentElement) return;

  const btn = document.createElement("button");
  btn.id = "vdPartyBtn";
  btn.className = anchorBtn.className;
  btn.style.cssText = "background:rgba(255,255,255,0.12);border:1px solid rgba(255,255,255,0.25);color:#fff;display:inline-flex;align-items:center;gap:8px;";
  btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>Watch Party`;
  anchorBtn.parentElement.insertBefore(btn, anchorBtn.nextSibling);

  btn.onclick = async () => {
    btn.disabled = true;
    try { await startWatchParty(item); }
    finally { btn.disabled = false; }
  };
}

/** Create a party for a title, open it, and take the host seat.
 *
 *  Shared by the detail-view button and the picker in veedeeoh.party, so both
 *  entry points get the same stream resolution and the same prompts. */
export async function startWatchParty(item: VodItem): Promise<boolean> {
  const party = await import("./party");
  try {
    const seatsRaw = prompt("How many people can join? Leave blank for no limit.");
    if (seatsRaw === null) return false;
    const seatLimit = seatsRaw.trim() ? Math.max(1, parseInt(seatsRaw, 10) || 0) : null;
    const password = prompt("Password to join? Leave blank for none.")?.trim() || null;

    // Pluto titles carry only a path and mint a signed URL on click, so the
    // host has to resolve one here. Without this the player opened with no
    // streams at all and the party started on a black screen.
    let streams = (item as any).streams as any[] | undefined;
    if (!streams?.length) {
      const url = item.url || (item.pluto_path ? await fetchPlutoStream(item.pluto_path) : null);
      if (!url) { showToast("That title can't be hosted right now"); return false; }
      streams = [{ url, quality: null, source: item.genre || "Party" }];
    }

    const { joinCode, link } = await party.createParty({
      contentId: String(item.id),
      streamIdx: 0,
      title: item.title,
      seatLimit,
      password,
    });

    await openVodPlayer(asChannel(item, streams as any), 0);
    party.hostExisting(joinCode, seatLimit);

    try { await navigator.clipboard.writeText(link); showToast("Party link copied \u2014 share it"); }
    catch { showToast(`Party code ${joinCode}`); }
    return true;
  } catch (e: any) {
    showToast(e?.message || "Couldn't start the party");
    return false;
  }
}

// "My List" toggle in the detail view — injected next to the Play button so it
// needs no index.html change. Optimistic UI + per-profile Supabase persistence.
function setupMyListButton(item: VodItem): void {
  const playBtn = document.getElementById("vdPlayBtn");
  if (!playBtn || !playBtn.parentElement) return;

  let btn = document.getElementById("vdMyListBtn") as HTMLButtonElement | null;
  if (!btn) {
    btn = document.createElement("button");
    btn.id = "vdMyListBtn";
    btn.className = playBtn.className;
    btn.style.cssText = "background:rgba(255,255,255,0.12);border:1px solid rgba(255,255,255,0.25);color:#fff;";
    playBtn.parentElement.insertBefore(btn, playBtn.nextSibling);
  }

  const id = item.id;
  const render = () => {
    const inList = state.favorites.has(id);
    btn!.style.display = "inline-flex";
    btn!.style.alignItems = "center";
    btn!.style.gap = "8px";
    const icon = inList
      ? `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`
      : `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>`;
    btn!.innerHTML = `${icon}My List`;
  };
  render();

  btn.onclick = async () => {
    const nowIn = !state.favorites.has(id);
    if (nowIn) state.favorites.add(id); else state.favorites.delete(id);
    render();
    const pid = activeProfileUuid();
    if (!pid) return; // local/self-host: optimistic state only
    try {
      if (nowIn) await addFavorite(pid, { content_id: id, title: item.title, poster: item.poster ?? null });
      else await removeFavorite(pid, id);
    } catch { /* keep optimistic state */ }
  };
}

// Favorites tab — every catalog item the active profile has added to My List.
export async function renderFavorites(): Promise<void> {
  const container = $("homeView");
  if (!container) return;
  container.replaceChildren();

  const rails = await getVodRails();
  const seen = new Set<string>();
  const items: VodItem[] = [];
  for (const rail of rails) {
    for (const it of rail.items as VodItem[]) {
      if (state.favorites.has(it.id) && !seen.has(it.id)) { seen.add(it.id); items.push(it); }
    }
  }

  if (items.length === 0) {
    const empty = document.createElement("div");
    empty.style.cssText = "flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 38px; padding: 120px 60px 40px; margin-top: 40px;";
    empty.innerHTML = `
      <div style="display: flex; align-items: flex-end; gap: 22px; height: 226px">
        <div style="width: 132px; height: 186px; border-radius: 10px; border: 2px dashed #22262E; transform: rotate(-7deg)"></div>
        <div style="width: 148px; height: 210px; border-radius: 10px; border: 2px dashed #2B303A; position: relative; display: flex; align-items: center; justify-content: center">
          <div style="width: 13px; height: 13px; border-radius: 50%; background: #C6F53A; box-shadow: 0 0 22px #C6F53A99"></div>
        </div>
        <div style="width: 132px; height: 186px; border-radius: 10px; border: 2px dashed #22262E; transform: rotate(7deg)"></div>
      </div>
      <div style="display: flex; flex-direction: column; align-items: center; gap: 12px; max-width: 520px; text-align: center">
        <div style="font-size: 30px; font-weight: 800; letter-spacing: -0.03em; color: #fff">Nothing on your list yet</div>
        <div style="font-size: 16px; font-weight: 500; line-height: 1.55; color: #7C828C; text-wrap: pretty">Hit + on anything you want to get to later. It lands here, on every device you watch on.</div>
      </div>
    `;
    container.append(empty);
    return;
  }

  const rail = document.createElement("div");
  rail.className = "rail";
  rail.innerHTML = `<div class="railHead"><div class="railHeadTitle"><h2>My List</h2><span class="railTag">${items.length} saved</span></div></div>`;
  const scroller = document.createElement("div");
  // "railScroll" and the shared vodCard() helper, matching every other rail.
  // This built its own markup with classes that exist nowhere in style.css
  // (railScroller / vodCardArt / vodCardTitle), so the cards fell back to
  // unstyled blocks: full-width posters stacked one per row.
  scroller.className = "railScroll";
  for (const it of items) scroller.append(vodCard(it));
  rail.append(scroller);
  setupHorizontalScroll(scroller, rail);
  container.append(rail);
}

export async function openVodDetails(item: VodItem): Promise<void> {
  const overlay = $("vodDetailsOverlay");
  overlay.removeAttribute("hidden");

  // Ambient blurred background
  const ambient = $("vodDetailsAmbient");
  const bannerImg = item.banner || item.poster || "";
  ambient.style.backgroundImage = bannerImg ? `url(${bannerImg})` : "";

  // Hero banner background
  const banner = $("vdBanner");
  banner.style.backgroundImage = bannerImg ? `url(${bannerImg})` : "";

  // Show poster
  const poster = $("vdPoster");
  if (item.poster) {
    poster.innerHTML = `<img loading="lazy" alt="" src="${escapeHtml(item.poster)}">`;
  } else {
    poster.innerHTML = FILM_ICON;
  }

  // Populate metadata
  $("vdTitle").textContent = item.title;
  $("vdMeta").textContent = [item.genre, item.rating].filter(Boolean).join(" · ");
  $("vdSummary").textContent = item.summary || "No description available.";

  setupMyListButton(item);
  setupParentControls(item);
  void setupWatchPartyButton(item);

  const selectContainer = $("vdSelectorContainer");
  const select = $<HTMLSelectElement>("vdSeasonSelect");
  const grid = $("vdEpisodeGrid");
  const playBtn = $<HTMLButtonElement>("vdPlayBtn");

  selectContainer.hidden = true;
  select.replaceChildren();
  grid.replaceChildren();
  playBtn.onclick = null;

  // 1. Movie item. Pluto movies carry only `pluto_path` and mint their signed URL
  // on click; `item.url` is the legacy pre-signed field, still honoured so a
  // catalog cached by the old code keeps playing until the next warm.
  if (item.url || item.pluto_path) {
    selectContainer.hidden = true;

    const playMovie = async () => {
      playBtn.disabled = true;
      const label = playBtn.textContent;
      try {
        const url = item.url || (await fetchPlutoStream(item.pluto_path!));
        openVodPlayer(asChannel(item, [{ url, quality: null, source: item.genre || "movie" }]), 0);
      } catch (err) {
        showToast("Couldn't start this title. Try another.");
        console.error("[vod] pluto resolve failed:", err);
      } finally {
        playBtn.disabled = false;
        playBtn.textContent = label;
      }
    };

    playBtn.onclick = playMovie;
    playBtn.textContent = "▶ PLAY MOVIE";

    const durationText = item.duration ? `${Math.round(item.duration / 60)}m` : "";

    const card = document.createElement("button");
    card.className = "episodeCard";
    card.innerHTML = `
      <div class="epThumbWrap">
        ${bannerImg ? `<img loading="lazy" alt="" src="${escapeHtml(bannerImg)}">` : `<div style="padding: 40px; text-align: center;">${FILM_ICON}</div>`}
        <div class="epPlayOverlay">▶</div>
        ${durationText ? `<div class="epDuration">${durationText}</div>` : ""}
      </div>
      <div class="epMeta">
        <span class="epShowTitle">${escapeHtml(item.title.toUpperCase())}</span>
        <div class="epTitleRow">
          <span class="epTitle">Watch Movie</span>
        </div>
        <p class="epDescription">${escapeHtml(item.summary)}</p>
      </div>`;
    
    card.addEventListener("click", playMovie);
    grid.append(card);
    return;
  }

  // 1b. Tubi movie — the catalog carries no URL, so resolve the HLS stream on
  // click via the adrise content API (mirrors the Internet Archive flow).
  if (String(item.id).startsWith("tubi:") && !item.series_id) {
    selectContainer.hidden = true;
    playBtn.textContent = "▶ PLAY MOVIE";

    const playTubi = async (cardEl?: HTMLElement) => {
      if (cardEl) cardEl.classList.add("loading");
      try {
        const url = await fetchTubiStream(String(item.id).replace("tubi:", ""));
        overlay.setAttribute("hidden", "");
        openVodPlayer(asChannel(item, [{ url, quality: null, source: "Tubi" }]), 0);
      } catch (err) {
        alert(`Couldn't load this title: ${err}`);
      } finally {
        if (cardEl) cardEl.classList.remove("loading");
      }
    };

    playBtn.onclick = () => playTubi();

    const card = document.createElement("button");
    card.className = "episodeCard";
    card.innerHTML = `
      <div class="epThumbWrap">
        ${bannerImg ? `<img loading="lazy" alt="" src="${escapeHtml(bannerImg)}">` : `<div style="padding: 40px; text-align: center;">${FILM_ICON}</div>`}
        <div class="epPlayOverlay">▶</div>
      </div>
      <div class="epMeta">
        <span class="epShowTitle">${escapeHtml(item.title.toUpperCase())}</span>
        <div class="epTitleRow"><span class="epTitle">Watch Movie</span></div>
        <p class="epDescription">${escapeHtml(item.summary)}</p>
      </div>`;
    card.addEventListener("click", () => playTubi(card));
    grid.append(card);
    return;
  }

  // 2. Series or Podcast item
  if (item.series_id || item.episodes) {
    playBtn.textContent = "▶ START WATCHING";
    
    const loading = document.createElement("div");
    loading.style.color = "var(--dim)";
    loading.style.gridColumn = "1/-1";
    loading.style.textAlign = "center";
    loading.style.padding = "40px";
    
    let episodes = item.episodes || [];
    
    if (item.series_id && !episodes.length) {
      loading.textContent = "Loading episodes...";
      grid.append(loading);
      try {
        episodes = await fetchVodSeries(item.series_id);
      } catch (err) {
        grid.replaceChildren();
        loading.textContent = `Failed to load episodes: ${err}`;
        grid.append(loading);
        return;
      }
    }

    grid.replaceChildren();
    if (!episodes.length) {
      loading.textContent = "No episodes found.";
      grid.append(loading);
      return;
    }

      // Group episodes by season
      const seasons: Record<number, VodEpisode[]> = {};
      for (const ep of episodes) {
        const s = ep.season ?? 1;
        if (!seasons[s]) seasons[s] = [];
        seasons[s].push(ep);
      }

      const seasonNums = Object.keys(seasons).map(Number).sort((a, b) => a - b);
      
      const renderSeason = (sNum: number) => {
        grid.replaceChildren();
        const epList = seasons[sNum] || [];
        
        // Prepare streams context for player
        const streams: Stream[] = epList.map((ep) => ({
          url: ep.url,
          quality: null,
          source: `S${ep.season ?? "?"}E${ep.number ?? "?"} ${ep.title}`.slice(0, 48),
          id: `vod:${item.id}:s${ep.season ?? 1}e${ep.number ?? 0}`
        }));

        const channelContext = asChannel(item, streams);

        // Bind Start Watching button to play first episode of current season
        playBtn.onclick = () => {
          openVodPlayer(channelContext, 0);
        };

        epList.forEach((ep, idx) => {
          const epId = `vod:${item.id}:s${ep.season ?? 1}e${ep.number ?? 0}`;
          const isWatched = state.watched.has(epId);

          const card = document.createElement("div");
          card.className = `episodeCard${isWatched ? " watched" : ""}`;
          card.dataset.epId = epId;

          // Thumbnail thumbnail fallback
          const epThumb = ep.thumbnail || bannerImg;
          // Durations arrive normalized to seconds by the backend, for every provider.
          const durationStr = ep.duration ? `${Math.round(ep.duration / 60)}m` : "";

          card.innerHTML = `
            <div class="epThumbWrap">
              ${epThumb ? `<img loading="lazy" alt="" src="${escapeHtml(epThumb)}">` : `<div style="padding: 40px; text-align: center;">${FILM_ICON}</div>`}
              <div class="epPlayOverlay">▶</div>
              ${isWatched ? `<div class="epCardWatchedBadge">${CHECK_ICON} WATCHED</div>` : ""}
              ${durationStr ? `<div class="epDuration">${durationStr}</div>` : ""}
            </div>
            <div class="epMeta">
              <span class="epShowTitle">${escapeHtml(item.title.toUpperCase())}</span>
              <div class="epTitleRow">
                <span class="epTitle">E${ep.number ?? "?"} - ${escapeHtml(ep.title || "Episode")}</span>
                <button class="epWatchedToggle" title="${isWatched ? "Mark unwatched" : "Mark watched"}" style="display:inline-flex;align-items:center;justify-content:center;">${CHECK_ICON}</button>
              </div>
              <p class="epDescription">${escapeHtml(ep.description || "No description available.")}</p>
            </div>
          `;

          // Handle watched toggle
          const toggleBtn = card.querySelector(".epWatchedToggle") as HTMLButtonElement;
          toggleBtn.addEventListener("click", async (e) => {
            e.stopPropagation();
            const nowWatched = await toggleWatched(epId);
            card.classList.toggle("watched", nowWatched);
            
            // Toggle badge representation
            const thumbWrap = card.querySelector(".epThumbWrap")!;
            const existingBadge = thumbWrap.querySelector(".epCardWatchedBadge");
            if (nowWatched) {
              if (!existingBadge) {
                const badge = document.createElement("div");
                badge.className = "epCardWatchedBadge";
                badge.innerHTML = `${CHECK_ICON} WATCHED`;
                thumbWrap.append(badge);
              }
            } else {
              existingBadge?.remove();
            }

            toggleBtn.title = nowWatched ? "Mark unwatched" : "Mark watched";
          });

          // Handle card click
          card.addEventListener("click", () => {
            openVodPlayer(channelContext, idx);
          });

          grid.append(card);
        });
      };

      // Populate seasons selection dropdown
      if (seasonNums.length > 0) {
        selectContainer.hidden = false;
        seasonNums.forEach((sNum) => {
          const opt = new Option(`Season ${sNum}`, String(sNum));
          select.append(opt);
        });

        select.onchange = () => {
          renderSeason(Number(select.value));
        };

        // Render first season by default
        renderSeason(seasonNums[0]!);
      }
      
    return;
  }

  // 3. Internet Archive item
  if (item.identifier) {
    selectContainer.hidden = true;
    playBtn.textContent = "▶ PLAY FILM";

    const playArchive = async (cardEl?: HTMLElement) => {
      if (cardEl) cardEl.classList.add("loading");
      try {
        const url = await fetchArchiveStream(item.identifier!);
        overlay.setAttribute("hidden", "");
        openVodPlayer(asChannel(item, [{ url, quality: null, source: "Internet Archive" }]), 0);
      } catch (err) {
        alert(`Failed to load archive stream: ${err}`);
      } finally {
        if (cardEl) cardEl.classList.remove("loading");
      }
    };

    playBtn.onclick = () => playArchive();

    const card = document.createElement("button");
    card.className = "episodeCard";
    card.innerHTML = `
      <div class="epThumbWrap">
        ${bannerImg ? `<img loading="lazy" alt="" src="${escapeHtml(bannerImg)}">` : `<div style="padding: 40px; text-align: center;">${FILM_ICON}</div>`}
        <div class="epPlayOverlay">▶</div>
      </div>
      <div class="epMeta">
        <span class="epShowTitle">INTERNET ARCHIVE</span>
        <div class="epTitleRow">
          <span class="epTitle">Load film stream</span>
        </div>
        <p class="epDescription">${escapeHtml(item.summary)}</p>
      </div>`;
    
    card.addEventListener("click", () => playArchive(card));
    grid.append(card);
  }
}

async function playVod(item: VodItem): Promise<void> {
  await openVodDetails(item);
}

const HEART = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21.2l7.8-7.7 1-1.1a5.5 5.5 0 0 0 0-7.8z"></path></svg>`;
const PLUS  = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>`;

export function vodCard(item: VodItem): HTMLElement {
  const el = document.createElement("button");
  el.className = "vodCard";
  el.title = item.summary || item.title;
  el.innerHTML = `
    <span class="vodPoster">${item.poster ? `<img loading="lazy" alt="" src="${escapeHtml(item.poster)}">` : FILM_ICON}
      <span class="vodQuick">
        <span class="vodQuickBtn" data-act="fav" title="Add to My List">${HEART}</span>
        <span class="vodQuickBtn" data-act="add" title="Add to a section">${PLUS}</span>
      </span>
    </span>
    <span class="vodTitle">${escapeHtml(item.title)}</span>
    <span class="vodMeta">${escapeHtml([item.genre, item.rating].filter(Boolean).join(" · "))}</span>`;

  const fav = el.querySelector<HTMLElement>('[data-act="fav"]')!;
  const paintFav = () => fav.classList.toggle("on", state.favorites.has(item.id));
  paintFav();

  // Quick actions live inside the card button, so their clicks must not fall
  // through and open the details overlay.
  el.addEventListener("click", (e) => {
    const act = (e.target as HTMLElement)?.closest?.("[data-act]")?.getAttribute("data-act");
    if (act) {
      e.preventDefault();
      e.stopPropagation();
      if (act === "fav") { void toggleFavorite(item).then(paintFav); }
      else { openAddToMenu(item, e as MouseEvent); }
      return;
    }
    el.classList.add("loading");
    void playVod(item).finally(() => el.classList.remove("loading"));
  });
  return el;
}

/** Shared by the card heart and the detail view, so both stay in step. */
async function toggleFavorite(item: VodItem): Promise<void> {
  const nowIn = !state.favorites.has(item.id);
  if (nowIn) state.favorites.add(item.id); else state.favorites.delete(item.id);
  const pid = activeProfileUuid();
  if (!pid) return;
  try {
    if (nowIn) await addFavorite(pid, { content_id: item.id, title: item.title, poster: item.poster ?? null });
    else await removeFavorite(pid, item.id);
  } catch { /* optimistic: the list is rebuilt from state on next render */ }
}

/** "Add to" menu: the household's own sidebar sections, plus a way to make one.
 *  Sections are collections with show_as_tab set, so this is the same mechanism
 *  as kids curation at a different scope. */
async function openAddToMenu(item: VodItem, ev: MouseEvent): Promise<void> {
  document.getElementById("vodAddMenu")?.remove();
  const menu = document.createElement("div");
  menu.id = "vodAddMenu";
  menu.style.cssText = "position:fixed;z-index:10065;min-width:220px;max-height:320px;overflow:auto;background:#10141e;border:1px solid rgba(255,255,255,.16);border-radius:12px;padding:7px;box-shadow:0 18px 44px rgba(0,0,0,.7);font-family:'Space Grotesk',sans-serif;";
  menu.style.left = `${Math.min(ev.clientX, window.innerWidth - 240)}px`;
  menu.style.top = `${Math.min(ev.clientY, window.innerHeight - 300)}px`;
  menu.innerHTML = `<div style="padding:8px 10px;font-size:11px;font-weight:800;color:#7C828C;letter-spacing:.05em;">ADD TO SECTION</div><div id="vodAddRows" style="color:#9aa5b5;font-size:12.5px;padding:6px 10px;">loading…</div>`;
  document.body.appendChild(menu);
  setTimeout(() => document.addEventListener("click", function away() {
    menu.remove(); document.removeEventListener("click", away);
  }, { once: true }), 0);

  const rows = menu.querySelector("#vodAddRows") as HTMLElement;
  const mk = (label: string, onClick: () => void) => {
    const b = document.createElement("button");
    b.style.cssText = "display:block;width:100%;text-align:left;padding:8px 10px;border:none;border-radius:8px;background:none;color:#fff;cursor:pointer;font:600 13px 'Space Grotesk',sans-serif;";
    b.textContent = label;
    b.onmouseenter = () => (b.style.background = "rgba(255,255,255,.08)");
    b.onmouseleave = () => (b.style.background = "none");
    b.onclick = () => { menu.remove(); onClick(); };
    return b;
  };

  const all = await listCollections().catch(() => []);
  const sections = all.filter((c) => c.scope === "household" && c.show_as_tab);
  rows.replaceChildren();
  if (!sections.length) {
    const none = document.createElement("div");
    none.style.cssText = "padding:4px 10px 10px;color:#7C828C;font-size:12px;line-height:1.5;";
    none.textContent = "No sections yet.";
    rows.appendChild(none);
  }
  for (const c of sections) {
    rows.appendChild(mk(c.name, async () => {
      try { await addToCollection(c.id, item.id, !!item.series_id); showToast(`Added to ${c.name}`); }
      catch (e: any) { showToast(e?.message || "Could not add"); }
    }));
  }
  const sep = document.createElement("div");
  sep.style.cssText = "height:1px;background:rgba(255,255,255,.1);margin:5px 4px;";
  rows.appendChild(sep);
  rows.appendChild(mk("New section…", async () => {
    const name = prompt("Name this section");
    if (!name?.trim()) return;
    try {
      const id = await createSection(name.trim());
      await addToCollection(id, item.id, !!item.series_id);
      showToast(`Created ${name.trim()}`);
      window.dispatchEvent(new CustomEvent("veedeeoh:sections-changed"));
    } catch (e: any) { showToast(e?.message || "Could not create"); }
  }));
}

function renderFilterChips(container: HTMLElement, genres: string[], activeGenre: string, onSelect: (g: string) => void): void {
  container.replaceChildren();

  // "All" chip
  const allChip = document.createElement("button");
  allChip.className = `filterChip${!activeGenre ? " active" : ""}`;
  allChip.textContent = "All";
  allChip.onclick = () => onSelect("");
  container.append(allChip);

  genres.forEach((g) => {
    const chip = document.createElement("button");
    chip.className = `filterChip${activeGenre === g ? " active" : ""}`;
    chip.textContent = g;
    chip.onclick = () => onSelect(g);
    container.append(chip);
  });
}

export function wireSearchInputs(): void {
  const showsSearch = $("showsSearch") as HTMLInputElement;
  const moviesSearch = $("moviesSearch") as HTMLInputElement;

  if (showsSearch) {
    showsSearch.addEventListener("input", (e) => {
      showsSearchQuery = (e.target as HTMLInputElement).value.toLowerCase();
      const container = $("showsRails");
      if (container) void renderShows(container);
    });
  }

  if (moviesSearch) {
    moviesSearch.addEventListener("input", (e) => {
      moviesSearchQuery = (e.target as HTMLInputElement).value.toLowerCase();
      const container = $("moviesRails");
      if (container) void renderMovies(container);
    });
  }
}

let previousActivePanelId = "homeView";
let previousScrollPos = 0;

export function openCategoryView(titleName: string, items: VodItem[]): void {
  const scrollable = $("scrollableArea");
  if (scrollable) previousScrollPos = scrollable.scrollTop;

  const panels = ["homeView", "showsView", "moviesView"];
  for (const id of panels) {
    const p = $(id);
    if (p && !p.hasAttribute("hidden")) {
      previousActivePanelId = id;
      p.setAttribute("hidden", "");
    }
  }

  const categoryView = $("categoryView");
  const titleNameEl = $("categoryTitleName");
  const itemCountEl = $("categoryItemCount");
  const grid = $("categoryGrid");
  const backBtn = $("categoryBackBtn");

  if (!categoryView || !grid) return;

  if (titleNameEl) titleNameEl.textContent = titleName;
  if (itemCountEl) itemCountEl.textContent = `${items.length} titles`;

  grid.replaceChildren();
  items.forEach((item) => {
    grid.append(vodCard(item));
  });

  categoryView.removeAttribute("hidden");
  if (scrollable) scrollable.scrollTop = 0;

  if (backBtn) {
    backBtn.onclick = () => {
      categoryView.setAttribute("hidden", "");
      const prev = $(previousActivePanelId);
      if (prev) prev.removeAttribute("hidden");
      if (scrollable) scrollable.scrollTop = previousScrollPos;
    };
  }
}

function getRailPriorityScore(name: string): number {
  let n = name.toLowerCase();
  if (n.includes("trending") || n.includes("popular") || n.includes("hit") || n.includes("top") || n.includes("binge")) return 1;
  // Pluto names nearly every genre rail "Featured X", so matching "feature"
  // here scored Horror, Comedy, Reality and DIY identically and made the
  // genre ladder below unreachable. Strip the prefix before scoring.
  n = n.replace(/^featured\s+/, "");
  if (n.includes("blockbuster") || n.includes("hollywood")) return 2;
  if (n.includes("action") || n.includes("adventure")) return 3;
  if (n.includes("drama")) return 4;
  if (n.includes("comedy") || n.includes("standup")) return 5;
  if (n.includes("crime") || n.includes("thriller")) return 6;
  if (n.includes("sci-fi") || n.includes("cyberpunk") || n.includes("fantasy")) return 7;
  if (n.includes("horror") || n.includes("monster")) return 8;
  if (n.includes("docu") || n.includes("reality")) return 9;

  // Kids/family rails sink on a general (adult) home; a kids profile only has
  // these anyway (so they just sort among themselves), and taste ordering still
  // lifts them for anyone who actually watches them.
  if (n.includes("kids") || n.includes("family") || n.includes("preschool") || n.includes("cartoon")) return 900;

  // Ambient, sleep soundscapes, and fireplaces push to the very bottom
  if (n.includes("sleep") || n.includes("ambient") || n.includes("soundscape") || n.includes("fireplace") || n.includes("relax")) return 999;

  return 50;
}

/** Render Shows (Series) only */
export function renderShows(container: HTMLElement): void {
  container.replaceChildren();
  const loading = buildRailSkeleton();
  container.append(loading);

  const hero = $("showsHero");
  if (hero) hero.setAttribute("hidden", "");

  getVodRails().then((rails: VodRail[]) => {
    loading.remove();
    const minRail = (showsSearchQuery || showsActiveGenre) ? 1 : 3;
    let showRails = sortRailsByTaste(
      rails
        .map((rail) => ({ name: rail.name, items: rail.items.filter((item) => item.series_id) }))
        .filter((rail) => rail.items.length >= minRail)
    );

    // Extract all unique genres for filter chips!
    const genresSet = new Set<string>();
    showRails.forEach((rail) => {
      rail.items.forEach((item) => {
        if (item.genre) genresSet.add(item.genre);
      });
    });
    const genres = Array.from(genresSet).sort();

    // Render Genre Filter Chips
    const chipsContainer = $("showsGenreFilters");
    if (chipsContainer) {
      renderFilterChips(chipsContainer, genres, showsActiveGenre, (genre) => {
        showsActiveGenre = genre;
        renderShows(container);
      });
    }

    // Apply active search query & genre filters
    if (showsSearchQuery || showsActiveGenre) {
      showRails = showRails.map((rail) => {
        const items = rail.items.filter((item) => {
          const matchesSearch = !showsSearchQuery || item.title.toLowerCase().includes(showsSearchQuery) || (item.summary && item.summary.toLowerCase().includes(showsSearchQuery));
          const matchesGenre = !showsActiveGenre || item.genre === showsActiveGenre;
          return matchesSearch && matchesGenre;
        });
        return { name: rail.name, items };
      }).filter((rail) => rail.items.length > 0);
    }

    if (!showRails.length) {
      const msg = document.createElement("div");
      msg.style.color = "var(--dim)";
      msg.style.padding = "24px";
      msg.textContent = "No shows match your filters. Try clearing the search or genre.";
      container.append(msg);
      return;
    }

    // Populate Hero spotlight show
    const firstShowRail = showRails[0];
    if (hero && firstShowRail && firstShowRail.items.length > 0) {
      const featured = firstShowRail.items[0];
      if (featured) {
        const bannerImg = featured.banner || featured.poster || "";
        hero.className = "vodHeroBlock";
        hero.style.backgroundImage = bannerImg ? `url(${bannerImg})` : "";
        hero.innerHTML = `
          <div class="vodHeroOverlay"></div>
          <div class="vodHeroContent">
            <span class="vodHeroGenre">${escapeHtml(featured.genre || "TV Show")}</span>
            <h2 class="vodHeroTitle">${escapeHtml(featured.title)}</h2>
            <div class="vodHeroMeta">${escapeHtml(featured.rating || "")}</div>
            <p class="vodHeroSummary">${escapeHtml(featured.summary)}</p>
          </div>
        `;
        hero.onclick = () => {
          void openVodDetails(featured);
        };
        hero.removeAttribute("hidden");
      }
    }

    const title = document.createElement("div");
    title.className = "sectionTitle";
    title.textContent = "On Demand TV Shows";
    container.append(title);

    for (const rail of showRails) {
      const el = document.createElement("div");
      el.className = "rail";
      el.innerHTML = `
        <div class="railHead">
          <div class="railHeadTitle">
            <h2>${escapeHtml(rail.name)}</h2>
            <span class="railTag">${rail.items.length} series</span>
          </div>
          <button class="railExpandBtn" style="display:inline-flex;align-items:center;gap:6px;">See All (${rail.items.length})<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg></button>
        </div>
      `;
      const scroller = document.createElement("div");
      scroller.className = "railScroll";

      rail.items.slice(0, 30).forEach((item) => scroller.append(vodCard(item)));

      const railHead = el.querySelector(".railHead") as HTMLElement;
      if (railHead) {
        railHead.onclick = (e) => {
          e.stopPropagation();
          openCategoryView(rail.name, rail.items);
        };
      }

      el.append(scroller);
      setupHorizontalScroll(scroller, el);
      container.append(el);
    }
  }).catch((err) => {
    loading.textContent = `Failed to load Shows: ${err}`;
  });
}

/** Render Movies only */
export function renderMovies(container: HTMLElement): void {
  container.replaceChildren();
  const loading = buildRailSkeleton();
  container.append(loading);

  const hero = $("moviesHero");
  if (hero) hero.setAttribute("hidden", "");

  getVodRails().then((rails: VodRail[]) => {
    loading.remove();
    const minRail = (moviesSearchQuery || moviesActiveGenre) ? 1 : 3;
    let movieRails = sortRailsByTaste(
      rails
        .map((rail) => ({ name: rail.name, items: rail.items.filter((item) => !item.series_id) }))
        .filter((rail) => rail.items.length >= minRail)
    );

    // Extract all unique genres for filter chips!
    const genresSet = new Set<string>();
    movieRails.forEach((rail) => {
      rail.items.forEach((item) => {
        if (item.genre) genresSet.add(item.genre);
      });
    });
    const genres = Array.from(genresSet).sort();

    // Render Genre Filter Chips
    const chipsContainer = $("moviesGenreFilters");
    if (chipsContainer) {
      renderFilterChips(chipsContainer, genres, moviesActiveGenre, (genre) => {
        moviesActiveGenre = genre;
        renderMovies(container);
      });
    }

    // Apply active search query & genre filters
    if (moviesSearchQuery || moviesActiveGenre) {
      movieRails = movieRails.map((rail) => {
        const items = rail.items.filter((item) => {
          const matchesSearch = !moviesSearchQuery || item.title.toLowerCase().includes(moviesSearchQuery) || (item.summary && item.summary.toLowerCase().includes(moviesSearchQuery));
          const matchesGenre = !moviesActiveGenre || item.genre === moviesActiveGenre;
          return matchesSearch && matchesGenre;
        });
        return { name: rail.name, items };
      }).filter((rail) => rail.items.length > 0);
    }

    if (!movieRails.length) {
      const msg = document.createElement("div");
      msg.style.color = "var(--dim)";
      msg.style.padding = "24px";
      msg.textContent = "No On Demand Movies available matching filters.";
      container.append(msg);
      return;
    }

    // Populate Hero spotlight movie
    const firstMovieRail = movieRails[0];
    if (hero && firstMovieRail && firstMovieRail.items.length > 0) {
      const featured = firstMovieRail.items[0];
      if (featured) {
        const bannerImg = featured.banner || featured.poster || "";
        hero.className = "vodHeroBlock";
        hero.style.backgroundImage = bannerImg ? `url(${bannerImg})` : "";
        hero.innerHTML = `
          <div class="vodHeroOverlay"></div>
          <div class="vodHeroContent">
            <span class="vodHeroGenre">${escapeHtml(featured.genre || "Movie")}</span>
            <h2 class="vodHeroTitle">${escapeHtml(featured.title)}</h2>
            <div class="vodHeroMeta">${escapeHtml(featured.rating || "")}</div>
            <p class="vodHeroSummary">${escapeHtml(featured.summary)}</p>
          </div>
        `;
        hero.onclick = () => {
          void openVodDetails(featured);
        };
        hero.removeAttribute("hidden");
      }
    }

    const title = document.createElement("div");
    title.className = "sectionTitle";
    title.textContent = "On Demand Movies";
    container.append(title);

    for (const rail of movieRails) {
      const el = document.createElement("div");
      el.className = "rail";
      el.innerHTML = `
        <div class="railHead">
          <div class="railHeadTitle">
            <h2>${escapeHtml(rail.name)}</h2>
            <span class="railTag">${rail.items.length} movies</span>
          </div>
          <button class="railExpandBtn" style="display:inline-flex;align-items:center;gap:6px;">See All (${rail.items.length})<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg></button>
        </div>
      `;
      const scroller = document.createElement("div");
      scroller.className = "railScroll";

      rail.items.slice(0, 30).forEach((item) => scroller.append(vodCard(item)));

      const railHead = el.querySelector(".railHead") as HTMLElement;
      if (railHead) {
        railHead.onclick = (e) => {
          e.stopPropagation();
          openCategoryView(rail.name, rail.items);
        };
      }

      el.append(scroller);
      setupHorizontalScroll(scroller, el);
      container.append(el);
    }
  }).catch((err) => {
    loading.textContent = `Failed to load Movies: ${err}`;
  });
}

/** Parent-facing kid-safe browse (the veedeeoh.kids sidebar shortcut). Always
 *  applies the kids gate regardless of the active profile, so a parent can hand
 *  the device to a child straight from their own profile. */
export async function renderKids(container: HTMLElement): Promise<void> {
  container.replaceChildren();
  const loading = buildRailSkeleton();
  container.append(loading);

  try {
    if (!cachedVodRails || cachedVodRails.length === 0) {
      const res = await fetchVod();
      if (res.rails?.length) cachedVodRails = res.rails;
    }
    // The kids view must go through the SAME gate as everything else. It used to
    // filter the raw cache with the genre matcher, which skipped the TV-rating
    // ceiling, the household's approvals and its exclusions -- a gate bypassed by
    // the one route built specifically for children.
    const kp = getActiveProfile();
    const kidsCeiling = Math.min(2, kp.max_rating ? maturityCeiling(kp.max_rating) : 2);
    const kidsApproved = await approvedFor(kidsCeiling);
    const kidsExcluded = await exclusionsFor(kp.id);
    // The kids view never shows more than TV-G, whoever is browsing it.
    const KID_RATINGS = new Set(["TV-Y", "TV-Y7", "TV-Y7-FV", "TV-G"]);
    const profileAllows = allowedRatingsFor(kp);
    const kidsAllowed = profileAllows
      ? new Set([...KID_RATINGS].filter((r) => profileAllows.has(r)))
      : KID_RATINGS;
    const kidsRails = sortRailsByTaste(
      applyExclusions(filterRailsForGatedProfile(cachedVodRails || [], kidsAllowed, kidsApproved), kidsExcluded),
    );
    loading.remove();

    const title = document.createElement("div");
    title.className = "sectionTitle";
    title.textContent = "veedeeoh.kids";
    container.append(title);

    if (kidsRails.length === 0) {
      const msg = document.createElement("div");
      msg.style.cssText = "color:var(--dim);padding:24px;";
      msg.textContent = "No kid-safe titles are available right now.";
      container.append(msg);
      return;
    }

    for (const rail of kidsRails) {
      const el = document.createElement("div");
      el.className = "rail";
      el.innerHTML = `
        <div class="railHead">
          <div class="railHeadTitle">
            <h2>${escapeHtml(rail.name)}</h2>
            <span class="railTag">${rail.items.length} titles</span>
          </div>
          <button class="railExpandBtn" style="display:inline-flex;align-items:center;gap:6px;">See All (${rail.items.length})<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg></button>
        </div>
      `;
      const scroller = document.createElement("div");
      scroller.className = "railScroll";
      rail.items.slice(0, 30).forEach((item) => scroller.append(vodCard(item)));
      const railHead = el.querySelector(".railHead") as HTMLElement;
      if (railHead) {
        railHead.onclick = (e) => { e.stopPropagation(); openCategoryView(rail.name, rail.items); };
      }
      el.append(scroller);
      setupHorizontalScroll(scroller, el);
      container.append(el);
    }
  } catch (err) {
    loading.textContent = `Failed to load veedeeoh.kids: ${err}`;
  }
}

/** Render Podcasts only */
let heroCarouselInterval: number | undefined;

export async function renderHome(): Promise<void> {
  const homeContainer = $("homeView");
  if (!homeContainer) return;
  homeContainer.replaceChildren();

  // Branded loader (usually invisible — the catalog is warmed during the bump).
  const loading = buildBrandLoader();
  homeContainer.append(loading);

  try {
    const rails = await getVodRails();
    loading.remove();

    // Recreate the Hero and Rails containers that were wiped by replaceChildren
    const hero = document.createElement("div");
    hero.id = "homeHero";
    hero.className = "vodHeroBlock";
    hero.style.display = "none";
    homeContainer.append(hero);

    const railsContainer = document.createElement("div");
    railsContainer.id = "homeRails";
    homeContainer.append(railsContainer);

    // 1. Continue Watching (Recent Resumes) from localStorage, per profile.
    const resumeHistoryStr = localStorage.getItem(resumeHistoryKey()) || "[]";
    let resumeHistory: any[] = [];
    try {
      resumeHistory = JSON.parse(resumeHistoryStr);
    } catch (e) {
      resumeHistory = [];
    }

    // Cross-device sync: merge Supabase exact timecodes
    const pid = activeProfileUuid();
    if (pid) {
      try {
        const cloudHistory = await getWatchHistory(pid);
        cloudHistory.forEach(cloudRow => {
          if (cloudRow.completed) {
            resumeHistory = resumeHistory.filter((x: any) => x.itemId !== cloudRow.content_id);
            return;
          }
          const localItem = resumeHistory.find((x: any) => x.itemId === cloudRow.content_id);
          if (localItem) {
            localItem.time = cloudRow.position_secs;
            if (cloudRow.duration_secs) {
              localItem.percentage = (cloudRow.position_secs / cloudRow.duration_secs) * 100;
            }
          }
        });
      } catch (e) {
        console.warn("[vod] getWatchHistory failed", e);
      }
    }

    // Resume cards go through the same gate as the catalog. Rows carry the full
    // item under vodItem, so the TV rating is available; a row with no usable
    // rating fails closed on a gated profile rather than being shown.
    const rp = getActiveProfile();
    if (allowedRatingsFor(rp)) {
      const rCeiling = maturityCeiling(rp.max_rating);
      const rAllowed = allowedRatingsFor(rp);
      const rApproved = await approvedFor(rCeiling);
      const rExcluded = await exclusionsFor(rp.id);
      resumeHistory = resumeHistory.filter((x: any) => {
        const id = String(x.id ?? x.itemId ?? "");
        if (rExcluded.has(id)) return false;
        if (rApproved.has(id)) return true;
        const r0 = String(x.vodItem?.rating ?? x.rating ?? "").trim().toUpperCase();
        return !!r0 && (rAllowed?.has(r0) ?? false);
      });
    }

    if (resumeHistory.length > 0) {
      const continueRail = document.createElement("div");
      continueRail.className = "rail";
      continueRail.innerHTML = `
        <div class="railHead">
          <h2>Continue Watching</h2>
          <span class="railTag">Resume where you left off</span>
        </div>
      `;
      const continueScroller = document.createElement("div");
      continueScroller.className = "railScroll";

      resumeHistory.forEach((item) => {
        const card = document.createElement("button");
        card.className = "continueCard";
        const imgUrl = item.banner || item.poster || "";
        card.innerHTML = `
          <div class="continueImage">
            ${imgUrl ? `<img loading="lazy" alt="" src="${escapeHtml(imgUrl)}">` : `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"></rect><line x1="7" y1="2" x2="7" y2="22"></line><line x1="17" y1="2" x2="17" y2="22"></line><line x1="2" y1="12" x2="22" y2="12"></line><line x1="2" y1="7" x2="7" y2="7"></line><line x1="2" y1="17" x2="7" y2="17"></line><line x1="17" y1="17" x2="22" y2="17"></line><line x1="17" y1="7" x2="22" y2="7"></line></svg>`}
            <div class="continueProgressWrap">
              <div class="continueProgressBar" style="width: ${item.percentage}%;"></div>
            </div>
          </div>
          <span class="showcaseTitle">${escapeHtml(item.title)}</span>
          <span class="showcaseMeta">${escapeHtml(item.episodeTitle || "Movie")}</span>
        `;
        card.onclick = () => {
          resumeVodPlayback(item);
        };
        continueScroller.append(card);
      });
      continueRail.append(continueScroller);
      setupHorizontalScroll(continueScroller, continueRail);
      railsContainer.append(continueRail);
    }

    // Clear interval if re-rendering
    if (heroCarouselInterval) clearInterval(heroCarouselInterval);

    // Flatten all items and extract a featured pool for the rotating hero.
    const allItems = rails.flatMap(r => r.items);
    const isKidsProfile = !!getActiveProfile().is_kids;
    // On an ADULT profile, the spotlight (hero + featured) should show grown-up,
    // mainstream titles, not kids content the backend pins to the front. Demote
    // anything that reads as kids/family: a G/TV-G-or-lower rating, an
    // animation/kids genre, or a kid signal in the title (baby, nursery, etc.).
    // Note: "animat" matches "Animation" but not "Anime", so anime is not demoted.
    const KID_SIGNAL = /\bkid|famil|child|preschool|cartoon|animat|toon|nursery|lullab|\bbaby\b|toddler|sing.?along|white noise|sleep sound/i;
    const kidsish = (i: any) => {
      const m = typeof i.maturity === "number" ? i.maturity : 5;
      if (m <= 2) return true; // G / TV-G / TV-Y / TV-Y7 -> not adult-spotlight material
      return KID_SIGNAL.test(`${i.genre || ""} ${i.title || ""}`);
    };
    const featuredRank = (i: any) => (isKidsProfile ? 0 : (kidsish(i) ? 1 : 0));
    const withBanner = allItems.filter(i => i.banner && i.banner.length > 0);
    const featuredPool = [...withBanner].sort((a, b) => featuredRank(a) - featuredRank(b)).slice(0, 5);
    if (featuredPool.length === 0) {
      featuredPool.push(...allItems.filter(i => i.poster && i.poster.length > 0).slice(0, 5));
    }

    // 2. Add Spotlight VOD Hero Carousel
    if (hero && featuredPool.length > 0) {
      let heroIdx = 0;
      
      const renderHero = () => {
        const featured = featuredPool[heroIdx];
        if (!featured) return;
        const bannerImg = featured.banner || featured.poster || "";
        hero.style.backgroundImage = bannerImg ? `url(${bannerImg})` : "";
        hero.innerHTML = `
          <div class="vodHeroOverlay"></div>
          <div class="vodHeroContent" style="animation: fadeIn 0.5s;">
            <span class="vodHeroGenre">${escapeHtml(featured.genre || "Featured Showcase")}</span>
            <h2 class="vodHeroTitle">${escapeHtml(featured.title)}</h2>
            <div class="vodHeroMeta">${escapeHtml(featured.rating || "TV-MA")}</div>
            <p class="vodHeroSummary">${escapeHtml(featured.summary || "Start watching now.")}</p>
            <div style="display: flex; gap: 10px; margin-top: 14px;">
              <button class="actionBtn primary" style="display:inline-flex;align-items:center;gap:8px;padding: 9px 18px; font-size: 13px; border-radius: 8px; font-weight: 700;">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="6 4 20 12 6 20 6 4"></polygon></svg>WATCH NOW
              </button>
              <button class="actionBtn" style="padding: 9px 16px; font-size: 13px; border-radius: 8px;">
                More Info
              </button>
            </div>
          </div>
          <div class="vodHeroCarouselDots">
            ${featuredPool.map((_, i) => `<div class="vodHeroDot ${i === heroIdx ? 'active' : ''}" data-idx="${i}"></div>`).join("")}
          </div>
        `;
        
        const dots = hero.querySelectorAll(".vodHeroDot");
        dots.forEach(d => {
           d.addEventListener("click", (e) => {
             e.stopPropagation();
             heroIdx = parseInt((e.target as HTMLElement).dataset.idx || "0");
             renderHero();
             resetInterval();
           });
        });
        
        hero.onclick = () => {
          void openVodDetails(featured);
        };
      };
      
      const resetInterval = () => {
        if (heroCarouselInterval) clearInterval(heroCarouselInterval);
        heroCarouselInterval = window.setInterval(() => {
          heroIdx = (heroIdx + 1) % featuredPool.length;
          renderHero();
        }, 8000);
      };
      
      renderHero();
      resetInterval();
      hero.style.display = "flex";
    }

    // 3. Separate TV and Movies, and Group by Genre
    const moviesItems = allItems.filter(i => (i.type === "movie" || (!i.series_id && i.type !== "series")) && i.type !== "podcast");
    const tvItems = allItems.filter(i => (i.type === "series" || i.series_id));
      
      const uniqueMovies = Array.from(new Map(moviesItems.map(m => [m.title, m])).values()).filter(i => i.poster || i.banner);
      const uniqueTv = Array.from(new Map(tvItems.map(m => [m.title, m])).values()).filter(i => i.poster || i.banner);
    
    const groupIntoGenres = (items: VodItem[]) => {
      const groups: Record<string, VodItem[]> = {};
      items.forEach(item => {
        const g = (item.genre || "").trim() || "__none";
        (groups[g] = groups[g] || []).push(item);
      });
      return groups;
    };

    const movieGenres = groupIntoGenres(uniqueMovies);
    const tvGenres = groupIntoGenres(uniqueTv);
    
    const renderGenreRail = (title: string, items: VodItem[], prioritizeBanner: boolean) => {
      if (items.length === 0) return;
      const el = document.createElement("div");
      el.className = "showcaseRail";
      el.innerHTML = `
        <div class="showcaseRailHead">
          <div class="showcaseRailHeadTitle">
            <h2>${escapeHtml(title)}</h2>
          </div>
          <button class="railExpandBtn" style="display:inline-flex;align-items:center;gap:6px;">See All (${items.length})<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg></button>
        </div>
      `;
      const scroller = document.createElement("div");
      scroller.className = "showcaseScroll";

      items.slice(0, 20).forEach((item: VodItem) => {
        const card = document.createElement("button");
        const useBanner = prioritizeBanner && item.banner;
        card.className = useBanner ? "showcaseCard" : "posterCard";
        card.title = item.summary || item.title;
        
        const imgUrl = useBanner ? item.banner : (item.poster || item.banner || "");
        const imageClass = useBanner ? "showcasePoster" : "posterImage";
        
        card.innerHTML = `
          <span class="${imageClass}">${imgUrl ? `<img loading="lazy" alt="" src="${escapeHtml(imgUrl)}">` : FILM_ICON}</span>
          <span class="showcaseTitle">${escapeHtml(item.title)}</span>
          <span class="showcaseMeta">${escapeHtml([item.genre, item.rating].filter(Boolean).join(" · "))}</span>
        `;
        card.onclick = () => {
          void openVodDetails(item);
        };
        scroller.append(card);
      });

      const head = el.querySelector(".showcaseRailHead") as HTMLElement;
      if (head) {
        head.onclick = (e) => {
          e.stopPropagation();
          openCategoryView(title, items);
        };
      }

      el.append(scroller);
      setupHorizontalScroll(scroller, el);
      railsContainer.append(el);
    };

    const taste = getTasteGenres();
    const history = getResumeHistory();
    const strip = (id?: string) => (id || "").replace("vod:", "");

    // "Because you watched ..." — same genre as the most recent resume, excluding
    // what's already in progress.
    if (history[0]?.genre && history[0]?.title) {
      const g = history[0].genre;
      const inProgress = new Set(history.map((h: any) => h.itemId));
      const recs = [...uniqueMovies, ...uniqueTv]
        .filter(i => i.genre === g && !inProgress.has(strip(i.id)))
        .slice(0, 20);
      if (recs.length >= 4) renderGenreRail(`Because you watched ${history[0].title}`, recs, true);
    }

    // Popular on veedeeoh — real aggregate plays. Hidden until there's enough data.
    //
    // Split by rating. One mixed rail put a preschool cartoon next to a TV-MA
    // thriller purely because both are watched a lot, which reads as an
    // unsorted list rather than a recommendation.
    //
    // TV-G and under only, and only TV ratings. A pre-1997 G or PG says nothing
    // reliable about whether a child should watch it -- Airplane! is PG -- so
    // those stay in the general rail and remain a parental choice.
    try {
      const { getPopularContentIds, tvMaturity } = await import("./db");
      // Ask for more than one rail needs: the two lists come out of one query,
      // and 20 total could leave either side under the 4-item threshold.
      const popular = await getPopularContentIds(50);
      if (popular.length) {
        const byId = new Map<string, VodItem>();
        [...uniqueMovies, ...uniqueTv].forEach(i => byId.set(strip(i.id), i));

        // Watch progress is recorded per EPISODE ("<series>:s1e4"), but the
        // catalog only holds the series. Matching raw ids therefore dropped
        // every episode play on the floor -- seven episodes of one show read as
        // seven misses instead of the strongest signal in the table. Roll them
        // up to the series and sum the plays.
        const plays = new Map<string, number>();
        for (const p of popular) {
          const ep = /^(.+?):s\d+e\d+$/i.exec(strip(p.content_id));
          const key = ep?.[1] ?? strip(p.content_id);
          plays.set(key, (plays.get(key) || 0) + (p.plays || 1));
        }

        const items = [...plays.entries()]
          .sort((a, b) => b[1] - a[1])
          .map(([id]) => byId.get(id))
          .filter(Boolean) as VodItem[];

        const kidSafe = (i: VodItem) => {
          const m = tvMaturity(i.rating);
          return m !== null && m <= 2;                       // TV-Y, TV-Y7, TV-G
        };

        // On a kids profile the whole catalog is already gated, so splitting
        // would just produce one rail and one empty one.
        if (document.body.classList.contains("kids-mode")) {
          if (items.length >= 4) renderGenreRail("Popular on veedeeoh", items, true);
        } else {
          const kids = items.filter(kidSafe);
          const rest = items.filter((i) => !kidSafe(i));
          if (rest.length >= 4) renderGenreRail("Popular on veedeeoh", rest, true);
          if (kids.length >= 4) renderGenreRail("Popular with kids", kids, true);
          // Too few of either to stand alone: one mixed rail beats hiding
          // popularity entirely.
          if (rest.length < 4 && kids.length < 4 && items.length >= 4) {
            renderGenreRail("Popular on veedeeoh", items, true);
          }
        }
      }
    } catch {}

    // Featured banners — only as a fallback when we have nothing personalized yet.
    // Non-kids content leads on an adult profile.
    if (taste.length === 0 && history.length === 0) {
      const featured = [...uniqueMovies, ...uniqueTv]
        .filter(i => i.banner)
        .sort((a, b) => featuredRank(a) - featuredRank(b))
        .slice(0, 20);
      if (featured.length >= 4) renderGenreRail("Featured on veedeeoh", featured, true);
    }

    // Genre rails ordered by the profile's taste first, then editorial priority,
    // then size (so ambient/sleep sink and the biggest relevant rails rise).
    const orderGenres = (entries: [string, VodItem[]][]) =>
      entries.filter(([g]) => g !== "__none").sort(([a, ia], [b, ib]) => {
        const ra = taste.indexOf(a) === -1 ? 999 : taste.indexOf(a);
        const rb = taste.indexOf(b) === -1 ? 999 : taste.indexOf(b);
        if (ra !== rb) return ra - rb;
        const pa = getRailPriorityScore(a), pb = getRailPriorityScore(b);
        if (pa !== pb) return pa - pb;
        return ib.length - ia.length;
      });

    orderGenres(Object.entries(movieGenres)).forEach(([genre, items]) => {
      if (items.length >= 3) renderGenreRail(`${genre} Movies`, items, false);
    });
    orderGenres(Object.entries(tvGenres)).forEach(([genre, items]) => {
      if (items.length >= 3) renderGenreRail(`${genre} TV`, items, false);
    });

    // Catch-all so ungenred or tiny-genre titles are never silently dropped.
    const leftover = (groups: Record<string, VodItem[]>) => [
      ...(groups["__none"] || []),
      ...Object.entries(groups).filter(([g, it]) => g !== "__none" && it.length < 3).flatMap(([, it]) => it),
    ];
    const moreMovies = leftover(movieGenres);
    if (moreMovies.length >= 4) renderGenreRail("More Movies", moreMovies, false);
    const moreTv = leftover(tvGenres);
    if (moreTv.length >= 4) renderGenreRail("More Series", moreTv, false);
  } catch (err) {
    loading.textContent = `Failed to load Home dashboard: ${err}`;
  }
}

// ---------------------------------------------------------------------------
// Custom sidebar sections
//
// A section is a household collection with show_as_tab set -- the same concept
// as the kids collections, at a different scope. Adding a title via the plus
// button on a card creates one; this renders them as sidebar tabs and views.
// ---------------------------------------------------------------------------

/** Sections belonging to the signed-in household, for the sidebar. */
export async function listSections(): Promise<{ id: string; name: string }[]> {
  const all = await listCollections().catch(() => []);
  return all.filter((c) => c.scope === "household" && c.show_as_tab).map((c) => ({ id: c.id, name: c.name }));
}

/** Render one section's titles. Runs everything through the same profile gate as
 *  the catalog, so a section cannot become a way around a restricted profile. */
export async function renderSection(container: HTMLElement, collectionId: string, name: string): Promise<void> {
  container.replaceChildren();
  const loading = buildRailSkeleton();
  container.append(loading);

  try {
    const [ids, rails] = await Promise.all([listCollectionItems(collectionId), getVodRails()]);
    const wanted = new Set(ids);
    const seen = new Set<string>();
    const items: VodItem[] = [];
    for (const rail of rails) {
      for (const it of rail.items as VodItem[]) {
        if (wanted.has(String(it.id)) && !seen.has(it.id)) { seen.add(it.id); items.push(it); }
      }
    }
    loading.remove();

    const title = document.createElement("div");
    title.className = "sectionTitle";
    title.textContent = name;
    container.append(title);

    if (!items.length) {
      const empty = document.createElement("div");
      empty.style.cssText = "padding:40px 18px;color:#7C828C;font-size:14px;line-height:1.6;max-width:520px;";
      empty.textContent = ids.length
        ? "Nothing in this section is available to this profile right now."
        : "Nothing here yet. Hover any title and use the + button to add it.";
      container.append(empty);
      return;
    }

    const rail = document.createElement("div");
    rail.className = "rail";
    rail.innerHTML = `<div class="railHead"><div class="railHeadTitle"><h2>${escapeHtml(name)}</h2><span class="railTag">${items.length}</span></div></div>`;
    const scroller = document.createElement("div");
    scroller.className = "railScroll";
    for (const it of items) scroller.append(vodCard(it));
    rail.append(scroller);
    setupHorizontalScroll(scroller, rail);
    container.append(rail);
  } catch (err) {
    loading.remove();
    const e = document.createElement("div");
    e.style.cssText = "padding:40px 18px;color:#ff6b6b;font-size:14px;";
    e.textContent = "Couldn't load this section.";
    container.append(e);
    console.error("[vod] renderSection", err);
  }
}
