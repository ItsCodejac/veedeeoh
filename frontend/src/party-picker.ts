// Choosing what a party watches.
//
// This was a bare text field. In an app that is otherwise entirely rails you
// scan, one surface demanded that you already know the title, spell it, and
// accept the first eight matches -- recall where everything else asks for
// recognition. It also threw away everything the app already knows: what you
// were part-way through, what is on your list, what people are watching. And
// picking a series started it at S1E1, so "let's carry on with that show"
// meant starting it again from the beginning.
//
// So the empty state is now the useful state, and search is what you reach for
// when browsing is not enough -- the same order of preference as the rest of
// the app.
//
// Used by two callers: the veedeeoh.party page, to start a party, and the host
// mid-party, to move the room on to something else. Identical either way, which
// is the point of it living here.

import { getActiveProfile } from "./profiles";
import { allowedRatingsFor, listFavorites, getPopularContentIds } from "./db";
import { escapeHtml } from "./util";

export interface PartyPick {
  item: any;
  /** Index into the ORDERED episode list for a series, 0 for a film. Must match
   *  the ordering the host and every viewer build independently, so both sort
   *  by season then number -- see orderEpisodes. */
  streamIdx: number;
  /** What was chosen, for the button that confirms it. */
  label: string;
}

/** Season then episode. The one ordering everybody has to agree on: streamIdx
 *  travels between host and viewers as a bare number, and each side builds its
 *  own array, so a different sort anywhere means the room watches two things. */
export function orderEpisodes(eps: any[]): any[] {
  return [...eps].sort((a, b) =>
    (a.season ?? 1) - (b.season ?? 1) || (a.number ?? 0) - (b.number ?? 0));
}

// ---------------------------------------------------------------------------

/** Render the picker into `host`. `onPick` is called with the choice; the
 *  picker does not resolve streams or start anything itself. */
export function mountPicker(
  host: HTMLElement,
  onPick: (pick: PartyPick) => void | Promise<void>,
): void {
  host.innerHTML = `
    <div class="pkSearch">
      <svg class="pkSearchIcon" width="16" height="16" viewBox="0 0 24 24" fill="none"
           stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
        <circle cx="11" cy="11" r="7"/><line x1="20" y1="20" x2="16.65" y2="16.65"/>
      </svg>
      <input class="partyInput pkInput" autocomplete="off" spellcheck="false"
             placeholder="Search, or pick from below"
             aria-label="Search for something to watch together" />
    </div>
    <div class="pkBody" aria-live="polite"></div>`;

  const input = host.querySelector<HTMLInputElement>(".pkInput")!;
  const body = host.querySelector<HTMLElement>(".pkBody")!;

  let timer = 0;
  let token = 0;

  const showDefault = async () => {
    const mine = ++token;
    body.innerHTML = `<p class="partyHint">Loading…</p>`;
    const groups = await defaultGroups();
    if (mine !== token) return;
    if (!groups.length) {
      body.innerHTML = `<p class="partyHint">Search for a title to get started.</p>`;
      return;
    }
    body.replaceChildren();
    for (const g of groups) body.append(groupEl(g.name, g.picks, choose));
  };

  const runSearch = async (q: string) => {
    const mine = ++token;
    const { searchCatalog } = await import("./search");
    const results = (await searchCatalog(q)).slice(0, 12);
    if (mine !== token) return;
    if (!results.length) {
      body.innerHTML = `<p class="partyHint">Nothing found for "${escapeHtml(q)}".</p>`;
      return;
    }
    body.replaceChildren();
    body.append(groupEl("", results.map((i) => ({ item: i, streamIdx: 0, label: i.title })), choose));
  };

  /** A film is chosen outright. A series without a known episode opens its
   *  episode list first: starting every show at S1E1 is wrong far more often
   *  than it is right. */
  const choose = async (pick: PartyPick, viaResume: boolean) => {
    if (!pick.item?.series_id || viaResume) { await onPick(pick); return; }
    await showEpisodes(pick.item);
  };

  const showEpisodes = async (item: any) => {
    const mine = ++token;
    body.innerHTML = `<p class="partyHint">Loading episodes…</p>`;
    const { fetchVodSeries } = await import("./api");
    const eps = orderEpisodes(await fetchVodSeries(item.series_id).catch(() => []));
    if (mine !== token) return;
    if (!eps.length) {
      body.innerHTML = `<p class="partyHint">Couldn't load episodes for that show.</p>`;
      return;
    }

    body.replaceChildren();
    const back = document.createElement("button");
    back.className = "pkBack";
    back.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <polyline points="15 18 9 12 15 6"/></svg> ${escapeHtml(item.title)}`;
    back.addEventListener("click", () => { input.value ? void runSearch(input.value.trim()) : void showDefault(); });
    body.append(back);

    // Where this profile left off in this show, so the obvious choice is one
    // click rather than a hunt through five seasons.
    const resumeIdx = resumeEpisodeIndex(String(item.id));

    let season: number | null = null;
    const list = document.createElement("div");
    list.className = "pkList";
    eps.forEach((ep, i) => {
      if ((ep.season ?? 1) !== season) {
        season = ep.season ?? 1;
        const h = document.createElement("p");
        h.className = "pkSeason";
        h.textContent = `Season ${season}`;
        list.append(h);
      }
      const label = `S${ep.season ?? "?"}E${ep.number ?? "?"} ${ep.title || ""}`.trim();
      const b = document.createElement("button");
      b.className = "pkEp" + (i === resumeIdx ? " resume" : "");
      b.innerHTML = `<span>${escapeHtml(label)}</span>${i === resumeIdx ? `<em>Where you left off</em>` : ""}`;
      b.addEventListener("click", () => void onPick({ item, streamIdx: i, label: `${item.title} — ${label}` }));
      list.append(b);
    });
    body.append(list);
  };

  input.addEventListener("input", () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (!q) { void showDefault(); return; }
    timer = window.setTimeout(() => void runSearch(q), 150);
  });

  void showDefault();
}

// ---------------------------------------------------------------------------
// The default state
// ---------------------------------------------------------------------------

interface Group { name: string; picks: PartyPick[] }

async function defaultGroups(): Promise<Group[]> {
  const [catalog, resume, favs, popular] = await Promise.all([
    catalogById(),
    resumePicks(),
    favouritePicks(),
    popularIds(),
  ]);

  const profile = getActiveProfile();
  const allowed = allowedRatingsFor(profile);
  const permitted = (it: any) =>
    !allowed || allowed.has(String(it?.rating || "").toUpperCase());

  const seen = new Set<string>();
  const take = (picks: PartyPick[], max: number) => {
    const out: PartyPick[] = [];
    for (const p of picks) {
      const id = String(p.item?.id ?? "");
      if (!id || seen.has(id) || !permitted(p.item)) continue;
      seen.add(id);
      out.push(p);
      if (out.length >= max) break;
    }
    return out;
  };

  const groups: Group[] = [];
  const carry = take(resume, 6);
  if (carry.length) groups.push({ name: "Carry on with", picks: carry });
  const mine = take(favs.map((i) => pickOf(i)), 6);
  if (mine.length) groups.push({ name: "Your list", picks: mine });
  const pop = take(popular.map((id) => catalog.get(id)).filter(Boolean).map((i) => pickOf(i)), 8);
  if (pop.length) groups.push({ name: "Popular right now", picks: pop });
  return groups;
}

const pickOf = (item: any): PartyPick => ({ item, streamIdx: 0, label: item.title });

/** Titles this profile is part-way through, each pointing at the exact episode
 *  they stopped on rather than at the show. */
async function resumePicks(): Promise<PartyPick[]> {
  const [{ getResumeHistory }, catalog] = await Promise.all([import("./vod"), catalogById()]);
  const out: PartyPick[] = [];
  for (const row of getResumeHistory()) {
    const item = catalog.get(String(row.itemId));
    if (!item) continue;
    const idx = Number(row.streamIdx) || 0;
    out.push({
      item,
      streamIdx: idx,
      label: row.episodeTitle ? `${item.title} — ${row.episodeTitle}` : item.title,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as PartyPick);
  }
  return out;
}

/** Which episode index the resume row for a series points at, or -1. */
function resumeEpisodeIndex(itemId: string): number {
  try {
    const key = `tvlc_resume_history_${getActiveProfile()?.id || "default"}`;
    const rows = JSON.parse(localStorage.getItem(key) || "[]");
    const row = rows.find((r: any) => String(r.itemId) === itemId);
    return row ? Number(row.streamIdx) || 0 : -1;
  } catch { return -1; }
}

async function favouritePicks(): Promise<any[]> {
  try {
    const profile = getActiveProfile();
    if (!profile?.id) return [];
    const favs = await listFavorites(profile.id);
    const catalog = await catalogById();
    return favs.map((f) => catalog.get(String(f.content_id))).filter(Boolean);
  } catch { return []; }
}

async function popularIds(): Promise<string[]> {
  try {
    return (await getPopularContentIds(20)).map((p) => String(p.content_id));
  } catch { return []; }
}

let catalogIndex: Map<string, any> | null = null;
async function catalogById(): Promise<Map<string, any>> {
  if (catalogIndex) return catalogIndex;
  const { getVodRails } = await import("./vod");
  const map = new Map<string, any>();
  for (const rail of await getVodRails()) {
    for (const it of rail.items as any[]) map.set(String(it.id), it);
  }
  catalogIndex = map;
  return map;
}

/** The catalogue is re-fetched on a region change, so the index built from it
 *  has to go with it or the picker keeps offering titles from the old region. */
export function invalidatePickerCatalog(): void { catalogIndex = null; }

// ---------------------------------------------------------------------------

function groupEl(name: string, picks: PartyPick[], choose: (p: PartyPick, viaResume: boolean) => void): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "pkGroup";
  if (name) {
    const h = document.createElement("p");
    h.className = "pkGroupName";
    h.textContent = name;
    wrap.append(h);
  }
  const list = document.createElement("div");
  list.className = "pkList";
  const viaResume = name === "Carry on with";
  for (const p of picks) list.append(rowEl(p, () => choose(p, viaResume)));
  wrap.append(list);
  return wrap;
}

function rowEl(pick: PartyPick, onClick: () => void): HTMLElement {
  const item = pick.item;
  const b = document.createElement("button");
  b.className = "partyPick";
  const img = item.banner || item.poster || "";
  const meta = [item.genre, item.rating, item.series_id ? "Series" : null].filter(Boolean).join(" · ");
  b.innerHTML = `
    <img src="${escapeHtml(img)}" alt="" loading="lazy">
    <span>
      <span class="partyPickTitle">${escapeHtml(pick.label)}</span><br>
      <span class="partyPickMeta">${escapeHtml(meta)}</span>
    </span>`;
  b.addEventListener("click", onClick);
  return b;
}
