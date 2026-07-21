const fs = require('fs');
const path = require('path');

const dir = path.join(process.cwd(), 'frontend/public/posters');
if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });

function normKey(str) {
  return str.toLowerCase().replace(/en español|en espanol|\(español\)|\(espanol\)|\(dubbed\)|spanish/gi, '').replace(/[^a-z0-9]/g, '');
}

// Curated high-impact search targets that EXIST on Tubi / Pluto
const TARGET_TITLES = [
  // Anime
  { title: "One Punch Man", category: "anime", keyword: "one punch" },
  { title: "Hunter x Hunter", category: "anime", keyword: "hunter" },
  { title: "JoJo's Bizarre Adventure", category: "anime", keyword: "jojo" },
  { title: "Death Note", category: "anime", keyword: "death note" },
  { title: "Ghost in the Shell", category: "anime", keyword: "ghost in the shell" },
  { title: "Naruto", category: "anime", keyword: "naruto" },
  { title: "Yu-Gi-Oh!", category: "anime", keyword: "yu-gi-oh" },
  { title: "Redline", category: "anime", keyword: "redline" },

  // Action & Blockbusters
  { title: "The Hunt for Red October", category: "action", keyword: "hunt for red october" },
  { title: "Clear and Present Danger", category: "action", keyword: "clear and present" },
  { title: "American Psycho", category: "horror", keyword: "american psycho" },
  { title: "Star Trek: The Motion Picture", category: "scifi", keyword: "star trek" },
  { title: "Timeline", category: "action", keyword: "timeline" },
  { title: "National Security", category: "comedy", keyword: "national security" },

  // Comedy & Pop Culture
  { title: "Rango", category: "comedy", keyword: "rango" },
  { title: "Cloudy with a Chance of Meatballs", category: "comedy", keyword: "cloudy with a chance" },
  { title: "Soul Plane", category: "comedy", keyword: "soul plane" },
  { title: "Fun with Dick and Jane", category: "comedy", keyword: "dick and jane" },

  // Black Storytelling & Drama
  { title: "The Wood", category: "black", keyword: "the wood" },
  { title: "Set It Off", category: "black", keyword: "set it off" },
  { title: "Beauty Shop", category: "black", keyword: "beauty shop" },
  { title: "Full Metal Jacket", category: "drama", keyword: "full metal jacket" },

  // Horror & Suspense
  { title: "Jeepers Creepers", category: "horror", keyword: "jeepers creepers" },
  { title: "Pet", category: "horror", keyword: "pet" },
  { title: "Fist of Fury", category: "archive", keyword: "fist of fury" }
];

async function run() {
  const registry = [];
  const seenKeys = new Set();

  console.log("Fetching live Tubi catalog data to verify high-profile streamable titles...");

  const slugs = ['anime', 'action', 'comedy', 'horror', 'drama', 'sci_fi_and_fantasy', 'black_cinema', 'documentaries'];
  const allVideos = [];

  for (const slug of slugs) {
    try {
      const res = await fetch(`https://tubitv.com/category/${slug}`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36' }
      });
      if (!res.ok) continue;
      const html = await res.text();
      const m = html.match(/window\.__data\s*=\s*(\{.*?\}\});/s);
      if (!m) continue;

      const data = JSON.parse(m[1].replace(/:\s*undefined/g, ':null'));
      const videos = Object.values(data.video?.byId || {});
      allVideos.push(...videos);
    } catch (e) {}
  }

  console.log(`Loaded ${allVideos.length} live video metadata objects.`);

  for (const target of TARGET_TITLES) {
    const match = allVideos.find(v => v.title && v.title.toLowerCase().includes(target.keyword.toLowerCase()));
    if (!match) {
      console.warn(`Target not found in live scrape: ${target.title}`);
      continue;
    }

    const key = normKey(match.title);
    if (seenKeys.has(key)) continue;

    const rawPoster = match.images?.posterarts?.[0] || match.images?.hero_16x9?.[0];
    if (!rawPoster) continue;

    const posterUrl = rawPoster.startsWith('//') ? 'https:' + rawPoster : rawPoster;
    const safeName = target.category + '_' + target.title.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') + '.jpg';
    const filepath = path.join(dir, safeName);

    try {
      const imgRes = await fetch(posterUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' }
      });
      if (imgRes.ok) {
        const buffer = Buffer.from(await imgRes.arrayBuffer());
        if (buffer.length > 5000) {
          fs.writeFileSync(filepath, buffer);
          seenKeys.add(key);
          registry.push({
            id: safeName.replace('.jpg', ''),
            title: match.title,
            category: target.category,
            poster: `/posters/${safeName}`
          });
          console.log(`✓ VERIFIED STREAMABLE [${target.category.toUpperCase()}]: ${match.title} -> ${safeName}`);
        }
      }
    } catch (e) {
      console.error(`Failed downloading poster for ${match.title}:`, e);
    }
  }

  const registryPath = path.join(process.cwd(), 'frontend/src/landing_posters.json');
  fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2));
  console.log(`\nSuccessfully verified and saved ${registry.length} high-profile streamable titles.`);
}

run();
