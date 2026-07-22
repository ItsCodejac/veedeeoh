const TUBI_BASE = "https://tubitv.com";
const CATALOG_TTL = 10 * 60 * 1000; // 10 minutes cache

let _tubiCache: { rails: any[]; at: number } | null = null;

const CATEGORY_MAP: Record<string, string> = {
  "anime": "⛩ Anime",
  "action": "Action",
  "comedy": "Comedy",
  "horror": "Horror",
  "drama": "Drama",
  "sci_fi_and_fantasy": "Sci-fi & Fantasy",
  "black_cinema": "Black Storytelling",
  "thrillers": "Thrillers",
  "documentaries": "Documentaries",
  "docuseries": "Docuseries",
  "adult_animation": "Adult Animation",
  "family_movies": "Family Movies",
  "kids_and_family": "Kids & Family",
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
          genre: v.tags?.[0] || "Tubi",
          rating: v.ratings?.[0]?.value || "TV-14",
          duration: v.duration || 0,
          provider: "Tubi",
        };

        if (item.type === "movie" && streamUrl) {
          item.url = streamUrl;
        } else if (item.type === "series") {
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
