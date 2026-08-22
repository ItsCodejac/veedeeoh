// Full search: ranking, and the results page behind the header dropdown.
//
// The dropdown was the entire search surface -- ten results, no filters, no way
// to see the rest. It is now the preview, and this is the destination.
//
// Ranking matters more than it looks. A plain substring filter over the catalog
// put "City Hunter: .357 Magnum" above "Hunter x Hunter" for the query "hunter",
// because it returned catalog order and called it a result set. Whole-word and
// prefix matches on the TITLE have to outrank an incidental hit in a summary.

import type { VodItem } from "./types";
import { getVodRails, vodCard } from "./vod";
import { escapeHtml } from "./util";

const $ = (id: string) => document.getElementById(id) as HTMLElement;

export interface SearchFilters {
  type: "" | "movie" | "show";
  genre: string;
  rating: string;
  source: string;
  sort: "relevance" | "az" | "za";
}

export const EMPTY_FILTERS: SearchFilters = {
  type: "", genre: "", rating: "", source: "", sort: "relevance",
};

// --------------------------------------------------------------- ranking ---

// The multiplication sign has to become a plain "x" BEFORE the non-ascii strip,
// or "Hunter \u00d7 Hunter" normalises to "hunter hunter" while the query
// "hunter x hunter" keeps its x -- and the exact series the user typed loses to
// a spin-off film that happens to use the ascii letter.
const norm = (s: string) =>
  s.toLowerCase().replace(/\u00d7/g, "x").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

/** Higher is better; 0 means no match. Tiers are spaced widely so a strong
 *  title signal can never be outweighed by an accumulation of weak ones. */
function score(item: VodItem, q: string, terms: string[]): number {
  const title = norm(item.title || "");
  const summary = (item.summary || "").toLowerCase();
  if (!title && !summary) return 0;

  const words = title.split(" ");
  let n = 0;

  if (title === q) n += 1000;                              // exact title
  else if (title.startsWith(q + " ")) n += 600;            // leading phrase
  else if (title.includes(q)) n += 400;                    // phrase anywhere

  for (const t of terms) {
    if (words.includes(t)) n += 120;                       // whole word in title
    else if (words.some((w) => w.startsWith(t))) n += 70;  // word prefix
    else if (title.includes(t)) n += 30;                   // mid-word
    else if (summary.includes(t)) n += 8;                  // summary only
    else return 0;                                         // every term must hit
  }

  // A repeated term is a deliberate signal ("hunter hunter"), and a title that
  // actually repeats it should win. Cheap to compute, and it is the difference
  // between Hunter x Hunter and City Hunter.
  for (const t of new Set(terms)) {
    const hits = words.filter((w) => w === t).length;
    if (hits > 1) n += 90 * (hits - 1);
  }

  // Shorter titles are more likely to BE the thing searched for rather than to
  // merely contain it. Small nudge, never enough to jump a tier.
  n += Math.max(0, 20 - words.length);
  return n;
}

export function rank(items: VodItem[], query: string): VodItem[] {
  const q = norm(query);
  if (!q) return [];
  const terms = q.split(" ").filter(Boolean);

  const scored: Array<{ item: VodItem; n: number }> = [];
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.id)) continue;
    const n = score(item, q, terms);
    if (n > 0) { seen.add(item.id); scored.push({ item, n }); }
  }
  scored.sort((a, b) => b.n - a.n || a.item.title.localeCompare(b.item.title));
  return scored.map((s) => s.item);
}

/** Ranked matches across everything the ACTIVE PROFILE may see. getVodRails
 *  already applies the rating gate and per-profile exclusions, so search cannot
 *  become a way around them. */
export async function searchCatalog(query: string): Promise<VodItem[]> {
  const rails = await getVodRails();
  return rank(rails.flatMap((r) => r.items), query);
}

// --------------------------------------------------------------- filters ---

export function sourceOf(item: VodItem): string {
  const id = String(item.id || "");
  if (item.pluto_path || id.startsWith("pluto:")) return "Pluto TV";
  if (id.startsWith("tubi:")) return "Tubi";
  if (id.startsWith("archive:")) return "Internet Archive";
  return item.provider || "Other";
}

const isShow = (i: VodItem) => !!i.series_id || (i.episodes?.length ?? 0) > 0;

export function applyFilters(items: VodItem[], f: SearchFilters): VodItem[] {
  let out = items;
  if (f.type === "movie") out = out.filter((i) => !isShow(i));
  if (f.type === "show") out = out.filter((i) => isShow(i));
  if (f.genre) out = out.filter((i) => (i.genre || "") === f.genre);
  if (f.rating) out = out.filter((i) => (i.rating || "") === f.rating);
  if (f.source) out = out.filter((i) => sourceOf(i) === f.source);

  // Relevance is the incoming order, so only an explicit sort copies the array.
  if (f.sort === "az") out = [...out].sort((a, b) => a.title.localeCompare(b.title));
  if (f.sort === "za") out = [...out].sort((a, b) => b.title.localeCompare(a.title));
  return out;
}

/** Facet values present in THIS result set, with counts. Offering a filter that
 *  matches nothing is worse than offering none. */
function facet(items: VodItem[], pick: (i: VodItem) => string): Array<[string, number]> {
  const counts = new Map<string, number>();
  for (const i of items) {
    const v = pick(i);
    if (v) counts.set(v, (counts.get(v) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

// ------------------------------------------------------------ results page ---

let current = { query: "", all: [] as VodItem[], filters: { ...EMPTY_FILTERS } };
let returnPanelId = "homeView";

// Panel the search page covered -> the route that reopens it. categoryView is
// deliberately mapped to home: a category is opened with an item list held in
// memory, so there is no route that could restore it.
const PANEL_ROUTES: Record<string, string> = {
  homeView: "home", showsView: "shows", moviesView: "movies",
  kidsView: "kids", partyView: "party", categoryView: "home",
};

export async function openSearchResults(query: string): Promise<void> {
  const view = $("searchView");
  if (!view) return;

  // Remember what to come back to, but never record the search page itself --
  // searching twice in a row would otherwise trap Back on the results.
  const panels = ["homeView", "showsView", "moviesView", "kidsView", "partyView", "categoryView"];
  for (const id of panels) {
    const p = document.getElementById(id);
    if (p && !p.hasAttribute("hidden")) { returnPanelId = id; p.setAttribute("hidden", ""); }
  }
  view.removeAttribute("hidden");

  // Put the query in the URL so a reload, Back, or a shared link reopens these
  // results. Guarded: applyRoute() calls this while restoring a hash, and
  // pushing the same one back would stack a duplicate history entry.
  const hash = `#search/${encodeURIComponent(query)}`;
  if (location.hash !== hash) history.pushState({}, "", hash);

  // Close the preview dropdown; the page supersedes it.
  const overlay = document.getElementById("searchResultsOverlay");
  if (overlay) overlay.hidden = true;
  document.getElementById("searchBar")?.classList.remove("active");

  current = { query, all: [], filters: { ...EMPTY_FILTERS } };
  $("searchViewQuery").textContent = `"${query}"`;
  $("searchViewCount").textContent = "searching...";
  $("searchViewGrid").replaceChildren();

  current.all = await searchCatalog(query);
  renderResults();

  const scrollable = document.getElementById("scrollableArea");
  if (scrollable) scrollable.scrollTop = 0;
}

export function closeSearchResults(): void {
  const view = $("searchView");
  if (!view || view.hasAttribute("hidden")) return;
  view.setAttribute("hidden", "");
  document.getElementById(returnPanelId)?.removeAttribute("hidden");

  // Drop the search route, or a reload reopens the results just dismissed.
  // replaceState rather than history.back(): someone who opened a shared search
  // link directly has no previous entry on this site, and Back would take them
  // off it entirely.
  if (location.hash.startsWith("#search/")) {
    const route = PANEL_ROUTES[returnPanelId] || "home";
    history.replaceState({}, "", route === "home" ? location.pathname : `#${route}`);
  }
}

function renderResults(): void {
  const shown = applyFilters(current.all, current.filters);
  const total = current.all.length;

  $("searchViewCount").textContent = shown.length === total
    ? `${total} ${total === 1 ? "title" : "titles"}`
    : `${shown.length} of ${total} titles`;

  renderFilterBar();

  const grid = $("searchViewGrid");
  grid.replaceChildren();
  if (!shown.length) {
    const empty = document.createElement("div");
    empty.className = "searchViewEmpty";
    empty.textContent = total
      ? "No titles match those filters."
      : `Nothing found for "${current.query}".`;
    grid.append(empty);
    return;
  }
  // Cap the DOM. Ten thousand cards is not a feature, and the filters above are
  // the intended way to narrow a broad query.
  for (const item of shown.slice(0, 300)) grid.append(vodCard(item));
  if (shown.length > 300) {
    const more = document.createElement("div");
    more.className = "searchViewEmpty";
    more.textContent = `Showing the first 300 of ${shown.length}. Narrow it with the filters above.`;
    grid.append(more);
  }
}

function renderFilterBar(): void {
  const bar = $("searchViewFilters");
  const f = current.filters;

  // Facets are computed from the results left after the OTHER filters, so a
  // dropdown never shows a value that would yield nothing once selected.
  const without = (key: keyof SearchFilters) =>
    applyFilters(current.all, { ...f, [key]: "" } as SearchFilters);

  const select = (
    key: keyof SearchFilters, label: string, opts: Array<[string, number]>
  ): string => {
    if (opts.length < 2 && !f[key]) return "";
    return `<label class="searchFilter">
      <span>${escapeHtml(label)}</span>
      <select data-filter="${key}">
        <option value="">All</option>
        ${opts.map(([v, n]) =>
          `<option value="${escapeHtml(v)}"${f[key] === v ? " selected" : ""}>${escapeHtml(v)} (${n})</option>`
        ).join("")}
      </select>
    </label>`;
  };

  const typeCounts = facet(without("type"), (i) => (isShow(i) ? "show" : "movie"));
  const typeOpts = typeCounts.map(([v, n]) => [v === "show" ? "TV shows" : "Movies", n] as [string, number]);
  const typeSel = typeOpts.length < 2 && !f.type ? "" : `<label class="searchFilter">
      <span>Type</span>
      <select data-filter="type">
        <option value="">All</option>
        <option value="movie"${f.type === "movie" ? " selected" : ""}>Movies (${typeCounts.find(([v]) => v === "movie")?.[1] ?? 0})</option>
        <option value="show"${f.type === "show" ? " selected" : ""}>TV shows (${typeCounts.find(([v]) => v === "show")?.[1] ?? 0})</option>
      </select>
    </label>`;

  const active = f.type || f.genre || f.rating || f.source || f.sort !== "relevance";

  bar.innerHTML = `
    ${typeSel}
    ${select("genre",  "Genre",  facet(without("genre"),  (i) => i.genre || ""))}
    ${select("rating", "Rating", facet(without("rating"), (i) => i.rating || ""))}
    ${select("source", "Source", facet(without("source"), (i) => sourceOf(i)))}
    <label class="searchFilter">
      <span>Sort</span>
      <select data-filter="sort">
        <option value="relevance"${f.sort === "relevance" ? " selected" : ""}>Best match</option>
        <option value="az"${f.sort === "az" ? " selected" : ""}>A to Z</option>
        <option value="za"${f.sort === "za" ? " selected" : ""}>Z to A</option>
      </select>
    </label>
    ${active ? `<button id="searchClearFilters" class="searchFilterClear">Clear filters</button>` : ""}`;

  bar.querySelectorAll<HTMLSelectElement>("select[data-filter]").forEach((sel) => {
    sel.addEventListener("change", () => {
      (current.filters as any)[sel.dataset.filter!] = sel.value;
      renderResults();
    });
  });
  bar.querySelector("#searchClearFilters")?.addEventListener("click", () => {
    current.filters = { ...EMPTY_FILTERS };
    renderResults();
  });
}
