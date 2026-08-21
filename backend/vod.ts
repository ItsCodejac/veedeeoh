import { XMLParser } from 'fast-xml-parser';

const BOOT_URL = "https://boot.pluto.tv/v4/start";
const VOD_URL = "https://service-vod.clusters.pluto.tv/v4/vod";
const SESSION_TTL = 5 * 60 * 1000;
const CATALOG_TTL = 5 * 60 * 1000;

const ANIME_RE = /anime|naruto|one piece|dragon ?ball|jojo|sailor moon|gundam|bleach|yu-gi-oh|shonen|ghibli|evangelion|cowboy bebop|akira|slayer/i;
// Two tiers, because the signal genuinely lives in TITLES ("Relaxing White
// Noise: Ocean Sounds") while the false positives did too ("Sleepy Hollow",
// "Sleeping Beauty", "I'll Sleep When I'm Dead", and /stingray/ catching the
// 1985 action series). Testing titles with a bare /sleep|stingray/ was the bug;
// not testing titles at all emptied the rail entirely.
//
// STRONG: phrases that are essentially never a narrative film title, so they are
// safe to match against the title itself.
const AMBIENT_STRONG_RE = /white noise|rain sounds|ocean sounds|sleep sounds|sounds for sleep|nature sounds|binaural/i;
// CONTEXT: broader terms, matched only against genre and rail name where a
// narrative title cannot trip them. "ocean waves" lives here because it is also
// a Studio Ghibli film.
const AMBIENT_CONTEXT_RE = /ambient|relaxation|naturescape|zenlife|meditation|lullaby|fireplace|soundscape|ocean waves/i;
const isAmbient = (title: string, genre: string, railName: string) =>
  AMBIENT_STRONG_RE.test(title) || AMBIENT_CONTEXT_RE.test(`${genre} ${railName}`);

// Deterministic maturity ladder from the provider-supplied rating. This is the
// single source of truth for kids-safety — unknown/unrated maps to ADULT so
// nothing can leak into a restricted profile by default.
//   0 TV-Y  1 TV-Y7  2 G/TV-G  3 PG/TV-PG  4 PG-13/TV-14  5 R/TV-MA/NC-17/unrated
export const MATURITY_ADULT = 5;
const MATURITY: Record<string, number> = {
  "TV-Y": 0,
  "TV-Y7": 1, "TV-Y7-FV": 1,
  "G": 2, "TV-G": 2,
  "PG": 3, "TV-PG": 3,
  "PG-13": 4, "TV-14": 4,
  "R": 5, "TV-MA": 5, "NC-17": 5,
};
export function maturityLevel(rating?: string | null): number {
  if (!rating) return MATURITY_ADULT;
  const key = rating.trim().toUpperCase();
  return MATURITY[key] ?? MATURITY_ADULT; // "Not Rated", unknowns -> adult (default-deny)
}

// A kids item must clear BOTH gates: a genuinely kid-safe maturity level AND a
// kids/family genre or category signal. The maturity gate is what guarantees no
// adult content can leak in; the genre gate keeps the rail relevant (a G-rated
// adult drama won't qualify). Adult-animation is excluded automatically since it
// carries TV-14/TV-MA.
const KIDS_MAX_MATURITY = 2; // TV-Y, TV-Y7, G, TV-G
const KIDS_SIGNAL_RE = /child|famil|preschool|\bkid|cartoon|animat/i;
export function isKidsSafe(item: any, categoryName = ""): boolean {
  const level = typeof item.maturity === "number" ? item.maturity : maturityLevel(item.rating);
  if (level > KIDS_MAX_MATURITY) return false;
  return KIDS_SIGNAL_RE.test(`${item.genre || ""} ${categoryName}`);
}

// Collapse the messy per-provider genre vocabularies (Pluto "Action & Adventure",
// Tubi "Action"/"Adventure", etc.) into one canonical set so genre chips and
// grouping read consistently across sources.
const GENRE_CANON: Array<[RegExp, string]> = [
  [/anime/i, "Anime"],
  // Kids must be tested BEFORE action: "LooLoo Kids" is tagged
  // ["Adventure","Animation","Kids & Family"] and was landing in Action.
  [/child|famil|preschool|\bkid/i, "Kids & Family"],
  // Animation AFTER kids, so kids cartoons stay in Kids and adult animation
  // gets its own bucket instead of falling through unmapped.
  [/animation|cartoon|toon/i, "Animation"],
  [/sci-?fi|science fiction|fantasy/i, "Sci-Fi & Fantasy"],
  [/action|adventure/i, "Action & Adventure"],
  [/thriller|suspense/i, "Thriller"],
  [/horror|paranormal/i, "Horror"],
  [/romance|telenovela/i, "Romance"],
  [/comedy|sitcom/i, "Comedy"],
  [/crime/i, "Crime"],
  [/document|docuseries/i, "Documentary"],
  [/reality/i, "Reality"],
  [/western/i, "Western"],
  [/music|musical/i, "Music"],
  [/news/i, "News"],
  [/sport/i, "Sports"],
  [/food|cook/i, "Food"],
  [/education|instruction/i, "Education"],
  [/lifestyle|home|hobb|diy/i, "Lifestyle"],
  [/faith|spiritual|religio/i, "Faith"],
  [/game show|variety|talk show/i, "Entertainment"],
  [/drama/i, "Drama"],
];
/** Highest-priority canon label matched by ANY of a provider's tags. Tubi's tag
 *  order is arbitrary, so reading tags[0] alone filed "LooLoo Kids" (tags:
 *  Adventure, Animation, Kids & Family) under Action & Adventure. */
export function normalizeGenreFromTags(tags?: (string | null | undefined)[]): string | null {
  const list = (tags || []).filter(Boolean) as string[];
  if (!list.length) return null;
  for (const [re, label] of GENRE_CANON) if (list.some((t) => re.test(t))) return label;
  return null;
}

export function normalizeGenre(raw?: string | null): string | null {
  if (!raw) return raw ?? null;
  for (const [re, label] of GENRE_CANON) if (re.test(raw)) return label;
  // Returning the raw provider string minted a rail per unmapped vocabulary
  // ("Animation Movies", "LGBT", "Foreign/International"). null instead sends
  // the item to the existing "More Movies" bucket.
  return null;
}

let _sessions: Record<string, any> = {};
let _catalogs: Record<string, any> = {};

function plutoHeaders(regionCode?: string): Record<string, string> {
  const headers: Record<string, string> = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    "Referer": "https://pluto.tv/",
    "Origin": "https://pluto.tv",
  };
  const code = (regionCode || "US").toUpperCase();
  const spoofIps: Record<string, string> = {
    "US": "76.81.9.69",
    "GB": "178.238.11.6",
    "CA": "192.206.151.131",
    "DE": "138.201.55.10",
    "ES": "185.183.104.1",
    "MX": "200.68.128.1",
    "FR": "193.169.64.141",
  };
  headers["X-Forwarded-For"] = spoofIps[code] || "76.81.9.69";
  return headers;
}

async function boot(regionCode?: string): Promise<any> {
  const params = new URLSearchParams({
    appName: "web", appVersion: "8.0.0", deviceVersion: "120.0.0",
    deviceModel: "web", deviceMake: "chrome", deviceType: "web",
    clientID: "d8e3b2e5-4f3b-4b2b-9e3b-5f3b4b2b9e3b", clientModelNumber: "1.0.0",
    serverSideAds: "true",
  });
  const res = await fetch(`${BOOT_URL}?${params.toString()}`, {
    headers: plutoHeaders(regionCode)
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return {
    token: data.sessionToken,
    stitcher: data.servers.stitcher,
    params: data.stitcherParams,
    at: Date.now(),
  };
}

async function getSession(regionCode?: string): Promise<any> {
  const code = (regionCode || "US").toUpperCase();
  if (!_sessions[code] || Date.now() - _sessions[code].at > SESSION_TTL) {
    _sessions[code] = await boot(code);
  }
  return _sessions[code];
}

function streamUrl(session: any, path: string): string {
  const v2Path = path.replace("/stitch/", "/v2/stitch/");
  return `${session.stitcher}${v2Path}?${session.params}&jwt=${session.token}&masterJWTPassthrough=true`;
}

function normalize(session: any, item: any): any | null {
  const covers = item.covers || [];
  const poster = covers.find((c: any) => c.aspectRatio === "347:500")?.url || (covers[0] ? covers[0].url : null);
  
  const out: any = {
    id: item._id,
    title: item.name || "Untitled",
    type: item.type,
    poster: poster,
    banner: item.featuredImage?.path || item.poster16_9?.path,
    summary: (item.summary || item.description || "").substring(0, 500),
    genre: normalizeGenre(item.genre),
    rating: item.rating,
    maturity: maturityLevel(item.rating),
    // Pluto reports duration in milliseconds; Tubi reports seconds. Normalize to
    // SECONDS here so every consumer can assume one unit (see tubi.ts).
    duration: typeof item.duration === "number" ? Math.round(item.duration / 1000) : null,
  };
  
  const path = item.stitched?.path;
  if (item.type === "movie" && path) {
    // Store the SHORT UNSIGNED path, not a signed URL. A signed stitcher URL is
    // ~3700 chars and carries a 24h JWT: baking 4300 of them into the cached
    // payload made it 21MB (74% just these URLs), which blew the Postgres
    // statement timeout so the cache write silently failed and the catalog went
    // stale for 10 days — and the tokens expired inside it anyway. Resolve on
    // click instead, exactly like Tubi and Internet Archive already do.
    out.pluto_path = path;
  } else if (item.type === "series") {
    out.series_id = item._id;
  } else {
    return null;
  }
  return out;
}

import { fetchTubiCatalog, tubiSeries, tubiStream as resolveTubiStream } from './tubi';

/** Sign a Pluto stitcher path with a FRESH session token. Called per play click,
 *  so the 24h JWT is always minutes old rather than however stale the cache is. */
export async function plutoStream(path: string, regionCode?: string): Promise<string> {
  if (!path.startsWith("/stitch/")) throw new Error("Invalid Pluto path");
  const session = await getSession(regionCode);
  return streamUrl(session, path);
}

/** Resolve a Tubi movie's playable HLS URL (adrise content API). */
export async function tubiStream(contentId: string): Promise<string> {
  return resolveTubiStream(contentId);
}

const SPANISH_RE = /en español|en espanol|\(español\)|\(espanol\)|spanish/i;

function normalizeTitleKey(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export async function getCatalog(regionCode?: string): Promise<{ rails: any[]; stats: any }> {
  const code = (regionCode || "US").toUpperCase();
  if (_catalogs[code] && Date.now() - _catalogs[code].at < CATALOG_TTL) {
    return _catalogs[code].output;
  }

  const [plutoResult, tubiRails, archiveKidsResult] = await Promise.allSettled([
    (async () => {
      const session = await getSession(code);
      const params = new URLSearchParams({ offset: "0", page: "1", includeItems: "true" });
      const res = await fetch(`${VOD_URL}/categories?${params.toString()}`, {
        headers: {
          "Authorization": `Bearer ${session.token}`,
          ...plutoHeaders(code)
        }
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return { session, data: await res.json() };
    })(),
    fetchTubiCatalog(),
    archiveKids()
  ]);

  const plutoData = plutoResult.status === "fulfilled" ? plutoResult.value.data : null;
  const plutoSession = plutoResult.status === "fulfilled" ? plutoResult.value.session : null;
  const tRails = tubiRails.status === "fulfilled" ? tubiRails.value : [];
  const archKids = archiveKidsResult.status === "fulfilled" ? archiveKidsResult.value : [];

  const rawRails: any[] = [];
  const seenAnime: Record<string, any> = {};
  const seenSleep: Record<string, any> = {};
  const seenKids: Record<string, any> = {};

  if (plutoData && plutoSession) {
    for (const cat of plutoData.categories || []) {
      const items = [];
      for (const it of cat.items || []) {
        const n = normalize(plutoSession, it);
        if (n) {
          n.provider = "Pluto TV";
          items.push(n);
        }
      }
      if (items.length > 0) {
        rawRails.push({ name: cat.name, items });
      }
      for (const n of items) {
        if (ANIME_RE.test(`${n.title} ${n.genre || ""}`)) {
          seenAnime[n.id] = n;
        }
        if (isAmbient(n.title || "", n.genre || "", cat.name || "")) {
          seenSleep[n.id] = n;
        }
        if (isKidsSafe(n, cat.name)) {
          seenKids[n.id] = n;
        }
      }
    }
  }

  // Include Tubi rails
  for (const tr of tRails) {
    rawRails.push(tr);
    for (const item of tr.items) {
      if (ANIME_RE.test(`${item.title} ${item.genre || ""}`)) {
        seenAnime[item.id] = item;
      }
      if (isAmbient(item.title || "", item.genre || "", tr.name || "")) {
        seenSleep[item.id] = item;
      }
      if (isKidsSafe(item, tr.name)) {
        seenKids[item.id] = item;
      }
    }
  }

  // Public-domain cartoons. Note isKidsSafe() cannot vouch for these: archiveKids()
  // stamps genre/rating/maturity itself, so the gate would only be re-reading our
  // own values. The real gate is the human-vetted allowlist inside archiveKids().
  for (const item of archKids) {
    seenKids[item.id] = item;
  }

  const allAnime = Object.values(seenAnime);
  const englishAnime = allAnime.filter(n => !SPANISH_RE.test(`${n.title} ${n.summary || ""}`));
  const spanishAnime = allAnime.filter(n => SPANISH_RE.test(`${n.title} ${n.summary || ""}`));

  if (spanishAnime.length > 0) {
    rawRails.unshift({ name: "Anime en Español", items: spanishAnime });
  }
  if (englishAnime.length > 0) {
    rawRails.unshift({ name: "Anime", items: englishAnime });
  }

  const allSleep = Object.values(seenSleep);
  if (allSleep.length > 0) {
    rawRails.unshift({ name: "Sleep & Ambient Soundscapes", items: allSleep });
  }

  // Kids rail — every item already passed the maturity + genre gates in
  // isKidsSafe(), so this rail is safe to surface to restricted profiles.
  const allKids = Object.values(seenKids);
  if (allKids.length > 0) {
    rawRails.unshift({ name: "Kids & Family", items: allKids });
  }

  // Merge & Deduplicate rails by category name & title
  const mergedMap: Record<string, Map<string, any>> = {};
  for (const rail of rawRails) {
    let catName = rail.name;
    // Canonicalise onto the exact names used by the constructed rails below, so
    // mergedMap (keyed on name) folds provider rails into them instead of
    // leaving "Anime en español" beside "Anime en Español".
    if (/anime/i.test(catName)) catName = /español|espanol/i.test(catName) ? "Anime en Español" : "Anime";
    if (/sci-?fi/i.test(catName)) catName = "Sci-Fi & Fantasy";

    if (!mergedMap[catName]) mergedMap[catName] = new Map();

    for (const item of rail.items) {
      const key = normalizeTitleKey(item.title);
      if (!mergedMap[catName].has(key)) {
        mergedMap[catName].set(key, item);
      } else {
        // Deduplicate: merge alternative source streams into existing item
        const existing = mergedMap[catName].get(key);
        if (!existing.streams) {
          existing.streams = [];
          if (existing.url) existing.streams.push({ url: existing.url, source: existing.provider || "Stream 1" });
        }
        if (item.url) {
          existing.streams.push({ url: item.url, source: item.provider || "Stream 2" });
        }
      }
    }
  }

  const rails: any[] = [];
  for (const [name, map] of Object.entries(mergedMap)) {
    const items = Array.from(map.values());
    if (items.length > 0) {
      rails.push({ name, items });
    }
  }

  const uniqueMovies = new Map<string, any>();
  const uniqueShows = new Map<string, any>();

  for (const rail of rails) {
    for (const item of rail.items) {
      const key = normalizeTitleKey(item.title);
      if (item.type === "movie" || item.pluto_path) {
        uniqueMovies.set(key, item);
      } else {
        uniqueShows.set(key, item);
      }
    }
  }

  const stats = {
    totalTitles: uniqueMovies.size + uniqueShows.size,
    moviesCount: uniqueMovies.size,
    showsCount: uniqueShows.size,
  };

  const output = { rails, stats };
  _catalogs[code] = { output, at: Date.now() };
  return output;
}

export async function getSeries(seriesId: string, regionCode?: string): Promise<any[]> {
  // Tubi series resolve through the adrise content API, not Pluto.
  if (seriesId.startsWith("tubi:")) {
    return tubiSeries(seriesId.slice(5));
  }

  const session = await getSession(regionCode);
  const params = new URLSearchParams({ offset: "0", page: "1" });
  
  const res = await fetch(`${VOD_URL}/series/${seriesId}/seasons?${params.toString()}`, {
    headers: {
      "Authorization": `Bearer ${session.token}`,
      ...plutoHeaders(regionCode)
    }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  
  const episodes: any[] = [];
  for (const season of data.seasons || []) {
    for (const ep of season.episodes || []) {
      const path = ep.stitched?.path;
      if (path) {
        const covers = ep.covers || [];
        const thumbnail = covers.find((c: any) => c.aspectRatio === "16:9")?.url || ep.poster16_9?.path;
        episodes.push({
          title: ep.name || "Episode",
          season: ep.season,
          number: ep.number,
          url: streamUrl(session, path),
          description: ep.description || ep.summary || "",
          duration: typeof ep.duration === "number" ? Math.round(ep.duration / 1000) : null,
          thumbnail: thumbnail,
        });
      }
    }
  }
  return episodes;
}

export async function archiveMovies(rows = 30): Promise<any[]> {
  const params = new URLSearchParams({
    "q": 'collection:feature_films AND mediatype:movies AND format:("h.264" OR "MPEG4" OR "Ogg Video")',
    "fl[]": "identifier,title,year,downloads", // Simplified for URLSearchParams, actually needs multiple fl[]
    "sort[]": "downloads desc",
    "rows": rows.toString(),
    "output": "json"
  });
  // Fix array params manually
  let qs = params.toString().replace(/fl%5B%5D=[^&]+/g, '') + '&fl[]=identifier&fl[]=title&fl[]=year&fl[]=downloads';
  
  const res = await fetch(`https://archive.org/advancedsearch.php?${qs}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  
  return (data.response?.docs || []).map((doc: any) => ({
    id: `archive:${doc.identifier}`,
    identifier: doc.identifier,
    title: doc.title || doc.identifier,
    type: "archive",
    poster: `https://archive.org/services/img/${doc.identifier}`,
    summary: `Public domain · ${doc.year || ''}`,
    maturity: MATURITY_ADULT, // general public-domain films — unrated, keep out of kids
  }));
}

// Public-domain animation from the `animationandcartoons` collection.
//
// SAFETY: this collection is download-ranked and NOT vetted. It contains wartime
// propaganda and racist caricature shorts. A title-substring denylist was tried
// here and does not work — 1940s cartoon titles do not contain words like "nazi"
// or "minstrel", so the denylist dropped 0 of the top 60 results while certifying
// "Bugs Bunny - All This and Rabbit Stew" (1941), Bosko shorts, and "Jerky Turkey"
// (1945) as TV-Y7. Deny-by-keyword cannot be made safe over an uncurated archive.
//
// So this path now fails CLOSED: only identifiers explicitly vetted by a human and
// listed below are trusted for the Kids rail. Empty means nothing is served, which
// is the correct default. Add identifiers here after watching them.
const KIDS_ARCHIVE_ALLOW = new Set<string>([
  // e.g. "ElephantsDream" — only after a human has reviewed the actual film.
]);

export async function archiveKids(rows = 60): Promise<any[]> {
  const params = new URLSearchParams({
    "q": 'collection:animationandcartoons AND mediatype:movies',
    "sort[]": "downloads desc",
    "rows": rows.toString(),
    "output": "json",
  });
  const qs = params.toString() + '&fl[]=identifier&fl[]=title&fl[]=year&fl[]=downloads';

  const res = await fetch(`https://archive.org/advancedsearch.php?${qs}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();

  return (data.response?.docs || [])
    .filter((doc: any) => KIDS_ARCHIVE_ALLOW.has(doc.identifier))
    .map((doc: any) => ({
      id: `archive:${doc.identifier}`,
      identifier: doc.identifier,
      title: doc.title || doc.identifier,
      type: "archive",
      poster: `https://archive.org/services/img/${doc.identifier}`,
      summary: `Classic cartoon · ${doc.year || ''}`,
      genre: "Kids & Family",
      rating: "TV-Y7",
      maturity: 1,
      provider: "Internet Archive",
    }));
}

let _podcastCatalog: any = { rails: [], at: 0 };

export async function applePodcasts(): Promise<any[]> {
  if (_podcastCatalog.rails.length > 0 && Date.now() - _podcastCatalog.at < CATALOG_TTL) {
    return _podcastCatalog.rails;
  }
  
  const searchTerms = ["video podcast", "comedy video podcast", "tech video podcast", "sports video podcast", "news video podcast", "gaming video podcast"];
  const results: any[] = [];
  
  const fetchTerm = async (term: string) => {
    try {
      const params = new URLSearchParams({ term, media: "podcast", limit: "20" });
      const r = await fetch(`https://itunes.apple.com/search?${params.toString()}`);
      if (r.ok) {
        const d = await r.json();
        return d.results || [];
      }
    } catch { }
    return [];
  };
  
  const responses = await Promise.all(searchTerms.map(t => fetchTerm(t)));
  for (const r of responses) results.push(...r);
  
  const seen = new Set();
  const uniqueResults = [];
  for (const p of results) {
    if (p.collectionId && !seen.has(p.collectionId)) {
      seen.add(p.collectionId);
      uniqueResults.push(p);
    }
  }
  
  const items: any[] = [];
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_"
  });
  
  for (const p of uniqueResults.slice(0, 30)) {
    const feedUrl = p.feedUrl;
    if (!feedUrl) continue;
    try {
      const fResp = await fetch(feedUrl);
      if (!fResp.ok) continue;
      const text = await fResp.text();
      const obj = parser.parse(text);
      
      const channel = obj?.rss?.channel;
      if (!channel) continue;
      
      const episodes: any[] = [];
      const itemArr = Array.isArray(channel.item) ? channel.item : (channel.item ? [channel.item] : []);
      
      for (const item of itemArr) {
        const enc = item.enclosure;
        if (enc && enc["@_url"]) {
          const url = enc["@_url"];
          const typ = (enc["@_type"] || "").toLowerCase();
          
          if (typ.includes("video") || url.endsWith(".mp4") || url.endsWith(".m4v")) {
            let thumb = p.artworkUrl600;
            const itunesImage = item["itunes:image"];
            if (itunesImage && itunesImage["@_href"]) {
              thumb = itunesImage["@_href"];
            }
            
            episodes.push({
              title: item.title || "Episode",
              url: url,
              description: (item.description || "").substring(0, 500),
              thumbnail: thumb,
              number: episodes.length + 1,
            });
            if (episodes.length >= 20) break;
          }
        }
      }
      
      if (episodes.length > 0) {
        items.push({
          id: `podcast:${p.collectionId}`,
          title: p.collectionName || "Podcast",
          type: "podcast",
          poster: p.artworkUrl600,
          banner: p.artworkUrl600,
          summary: p.artistName || "",
          genre: p.primaryGenreName || "Video Podcast",
          episodes: episodes
        });
      }
    } catch {
      continue;
    }
  }
  
  _podcastCatalog = { rails: items, at: Date.now() };
  return items;
}

export async function archiveStream(identifier: string): Promise<string | null> {
  const res = await fetch(`https://archive.org/metadata/${identifier}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  
  const files = data.files || [];
  const preference: Record<string, number> = { ".mp4": 0, ".m4v": 0, ".webm": 1, ".ogv": 2, ".mkv": 3, ".avi": 3 };
  let best: [number, number, string] | null = null;
  
  for (const f of files) {
    const name = f.name || "";
    const ext = Object.keys(preference).find(e => name.toLowerCase().endsWith(e));
    if (!ext) continue;
    const size = parseInt(f.size || "0");
    const candidate: [number, number, string] = [preference[ext], -size, name];
    
    if (!best || (candidate[0] < best[0] || (candidate[0] === best[0] && candidate[1] < best[1]))) {
      best = candidate;
    }
  }
  
  if (!best) return null;
  return `https://archive.org/download/${identifier}/${best[2]}`;
}
