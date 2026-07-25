import { maturityLevel, normalizeGenre } from "./vod";

const TUBI_BASE = "https://tubitv.com";
const CATALOG_TTL = 10 * 60 * 1000; // 10 minutes cache

let _tubiCache: { rails: any[]; at: number } | null = null;

const CATEGORY_MAP: Record<string, string> = {
  "anime": "Anime",
  "action": "Action",
  "comedy": "Comedy",
  "horror": "Horror",
  "drama": "Drama",
  "sci_fi_and_fantasy": "Sci-Fi & Fantasy",
  "black_cinema": "Black Storytelling",
  "thrillers": "Thrillers",
  "documentaries": "Documentaries",
  "docuseries": "Docuseries",
  "adult_animation": "Adult Animation",
  "family_movies": "Family Movies",
  // NOTE: "kids_and_family" is a dead 404 slug on Tubi — removed. The working
  // kids slugs are "preschool" and "family_movies".
  "preschool": "Preschool",
  "westerns": "Westerns",
  "lgbt": "LGBTQ+ Storytelling",
  "music": "Music",
  "sports_movies_and_tv": "Sports Stories",
  "reality_tv": "Reality TV",
  "true_crime": "True Crime",
  "creators": "Creatorverse",
  "podcast": "Podcasts",
};

export async function fetchTubiCatalog(): Promise<any[]> {
  if (_tubiCache && Date.now() - _tubiCache.at < CATALOG_TTL) {
    return _tubiCache.rails;
  }

  const slugs = Object.keys(CATEGORY_MAP);
  const railsMap: Record<string, any[]> = {};

  const fetchSlug = async (slug: string) => {
    try {
      const res = await fetch(`${TUBI_BASE}/category/${slug}`, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        }
      });
      if (!res.ok) return;
      const html = await res.text();
      const match = html.match(/window\.__data\s*=\s*(\{.*?\}\});/s);
      if (!match) return;

      const cleanJson = match[1].replace(/:\s*undefined/g, ':null');
      const data = JSON.parse(cleanJson);
      const videos = Object.values(data.video?.byId || {}) as any[];

      const catName = CATEGORY_MAP[slug] || slug;
      if (!railsMap[catName]) railsMap[catName] = [];

      for (const v of videos) {
        if (!v.id || !v.title) continue;

        const poster = v.images?.posterarts?.[0] || v.images?.hero_16x9?.[0] || "";
        const banner = v.images?.hero_16x9?.[0] || v.images?.posterarts?.[0] || "";
        const streamUrl = v.video_resources?.[0]?.manifest?.url || "";

        const item: any = {
          id: `tubi:${v.id}`,
          title: v.title,
          type: v.type === "s" ? "series" : "movie",
          poster: poster,
          banner: banner,
          summary: v.description || "",
          genre: normalizeGenre(v.tags?.[0]) || "Tubi",
          rating: v.ratings?.[0]?.value || "TV-14",
          maturity: maturityLevel(v.ratings?.[0]?.value),
          duration: v.duration || 0,
          provider: "Tubi",
        };

        // Tubi's listing no longer embeds full-movie manifests (video_resources is
        // empty), so movies resolve their stream on click via tubiStream(); series
        // resolve their episodes via tubiSeries(). Both hit the adrise content API.
        if (item.type === "movie") {
          if (streamUrl) item.url = streamUrl; // rare: listing already had it
          // else: no url → frontend resolves via /vod/tubi/:id on click
        } else {
          item.series_id = `tubi:${v.id}`;
        }

        railsMap[catName].push(item);
      }
    } catch (e) {
      console.error(`Error fetching Tubi category ${slug}:`, e);
    }
  };

  await Promise.all(slugs.map(fetchSlug));

  const rails: any[] = [];
  for (const [name, items] of Object.entries(railsMap)) {
    if (items.length > 0) {
      rails.push({ name, items });
    }
  }

  _tubiCache = { rails, at: Date.now() };
  return rails;
}

// ---------------------------------------------------------------------------
// Stream resolution. Tubi's public listing no longer carries full manifests, but
// the adrise content API returns them, unauthenticated, given a random device id.
// This is exactly what Tubi's own web player calls.
// ---------------------------------------------------------------------------

const ADRISE_CONTENT = "https://uapi.adrise.tv/cms/content";
const TUBI_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

async function tubiContent(contentId: string): Promise<any> {
  const dev = (globalThis.crypto as any)?.randomUUID?.() || `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
  const url = `${ADRISE_CONTENT}?content_id=${encodeURIComponent(contentId)}&device_id=${dev}` +
    `&platform=web&video_resources=hlsv6&video_resources=hlsv3&app_id=tubitv`;
  const res = await fetch(url, { headers: { "User-Agent": TUBI_UA, "Accept": "application/json" } });
  if (!res.ok) throw new Error(`Tubi content HTTP ${res.status}`);
  return res.json();
}

const pickManifest = (node: any): string | undefined =>
  node?.video_resources?.find((r: any) => r?.manifest?.url)?.manifest?.url || node?.url;

/** Resolve a Tubi movie's playable HLS URL from its numeric content id. */
export async function tubiStream(contentId: string): Promise<string> {
  const data = await tubiContent(contentId);
  const u = pickManifest(data);
  if (!u) throw new Error("No Tubi stream available");
  return u;
}

/** Resolve a Tubi series into flattened episodes (each with a playable URL). */
export async function tubiSeries(seriesId: string): Promise<any[]> {
  const data = await tubiContent(seriesId);
  const episodes: any[] = [];
  for (const season of data.children || []) {
    const sNum = parseInt(String(season.title || "").replace(/\D/g, ""), 10);
    for (const ep of season.children || []) {
      const u = pickManifest(ep);
      if (!u) continue;
      episodes.push({
        title: ep.title || `Episode ${ep.episode_number || ""}`.trim(),
        season: Number.isFinite(sNum) ? sNum : 1,
        number: parseInt(ep.episode_number, 10) || 0,
        url: u,
        description: ep.description || "",
        duration: ep.video_resources?.[0]?.manifest?.duration,
        thumbnail: ep.posterarts?.[0] || ep.thumbnails?.[0] || ep.hero_images?.[0],
      });
    }
  }
  return episodes;
}
