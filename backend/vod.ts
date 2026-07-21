import { XMLParser } from 'fast-xml-parser';

const BOOT_URL = "https://boot.pluto.tv/v4/start";
const VOD_URL = "https://service-vod.clusters.pluto.tv/v4/vod";
const SESSION_TTL = 5 * 60 * 1000;
const CATALOG_TTL = 5 * 60 * 1000;

const ANIME_RE = /anime|animation|manga|japanese|naruto|one piece|dragon ?ball|jojo|sailor moon|gundam|bleach|yu-gi-oh|shonen|shounen|seinen|ghibli|evangelion|bebop|akira|slayer|hunter|hero|titan|subbed|dubbed|crunchyroll|funimation|inuyasha|death note|sword art|fairy tail|demon|jujutsu|chainsaw|tokyo|boruto|yuyu|rurouni|berserk|monster|code geass|fullmetal|mob psycho|overlord|konosuba|re:zero|log horizon|vinland|steins|haikyuu|slam dunk|pokemon|digimon|beyblade|bakugan|cardcaptor|sailor|lupin/i;

let _session: any = null;
let _catalog: any = null;

function plutoHeaders(clientIp?: string): Record<string, string> {
  const headers: Record<string, string> = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    "Referer": "https://pluto.tv/",
    "Origin": "https://pluto.tv",
  };
  if (clientIp && clientIp !== "127.0.0.1" && clientIp !== "::1") {
    headers["X-Forwarded-For"] = clientIp.split(',')[0].trim();
  }
  return headers;
}

async function boot(clientIp?: string): Promise<any> {
  const params = new URLSearchParams({
    appName: "web", appVersion: "8.0.0", deviceVersion: "120.0.0",
    deviceModel: "web", deviceMake: "chrome", deviceType: "web",
    clientID: "d8e3b2e5-4f3b-4b2b-9e3b-5f3b4b2b9e3b", clientModelNumber: "1.0.0",
    serverSideAds: "true",
  });
  const res = await fetch(`${BOOT_URL}?${params.toString()}`, {
    headers: plutoHeaders(clientIp)
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

async function getSession(clientIp?: string, forceRefresh = false): Promise<any> {
  if (forceRefresh || !_session || Date.now() - _session.at > SESSION_TTL) {
    _session = await boot(clientIp);
  }
  return _session;
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
    genre: item.genre,
    rating: item.rating,
    duration: item.duration,
  };
  
  const path = item.stitched?.path;
  if (item.type === "movie" && path) {
    out.url = streamUrl(session, path);
  } else if (item.type === "series") {
    out.series_id = item._id;
  } else {
    return null;
  }
  return out;
}

export async function getCatalog(regionCode?: string): Promise<any[]> {
  if (_catalog && Date.now() - _catalog.at < CATALOG_TTL) {
    return _catalog.rails;
  }
  const session = await getSession(regionCode);
  const params = new URLSearchParams({ offset: "0", page: "1", includeItems: "true" });
  
  const res = await fetch(`${VOD_URL}/categories?${params.toString()}`, {
    headers: {
      "Authorization": `Bearer ${session.token}`,
      ...plutoHeaders(regionCode)
    }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  
  const rails: any[] = [];
  const seenAnime: Record<string, any> = {};
  
  for (const cat of data.categories || []) {
    const items = [];
    const isAnimeCategory = /anime|manga/i.test(cat.name || "");
    for (const it of cat.items || []) {
      const n = normalize(session, it);
      if (n) {
        items.push(n);
        if (isAnimeCategory || ANIME_RE.test(`${n.title} ${n.genre || ""} ${cat.name || ""}`)) {
          if (!n.genre) n.genre = "Anime";
          seenAnime[n.id] = n;
        }
      }
    }
    if (items.length > 0) {
      rails.push({ name: cat.name, items });
    }
  }
  
  if (Object.keys(seenAnime).length > 0) {
    rails.unshift({ name: "⛩ Anime", items: Object.values(seenAnime) });
  }
  
  _catalog = { rails, at: Date.now() };
  return rails;
}

export async function getSeries(seriesId: string, regionCode?: string): Promise<any[]> {
  const session = await getSession(regionCode, true);
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
          duration: ep.duration,
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
