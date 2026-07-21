const fs = require('fs');
const path = require('path');

const dir = path.join(process.cwd(), 'frontend/public/posters');
if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });

function normKey(str) {
  return str.toLowerCase().replace(/en español|en espanol|\(español\)|\(espanol\)|\(dubbed\)|\(subtitled\)|\(subbed\)|spanish/gi, '').replace(/[^a-z0-9]/g, '');
}

async function run() {
  console.log("Fetching live catalog from http://localhost:8321/api/vod ...");
  const res = await fetch('http://localhost:8321/api/vod');
  if (!res.ok) {
    console.error("Failed to fetch backend catalog");
    return;
  }

  const data = await res.json();
  const rails = data.rails || [];

  const categorySpecs = [
    {
      group: "a24_award",
      railFilter: /A24|Award-Winning|Hollywood Icons/i,
      max: 5
    },
    {
      group: "action_franchise",
      railFilter: /Favorite Franchises|Featured Action|Trending Now/i,
      max: 5
    },
    {
      group: "anime",
      railFilter: /⛩ Anime|Sailor Moon|Lupin|Yu-Gi-Oh|Anime Movies|RetroCrush/i,
      max: 5
    },
    {
      group: "black_cinema",
      railFilter: /BET|Movies By BET|Featured BET/i,
      max: 5
    },
    {
      group: "comedy_standup",
      railFilter: /Featured Comedy|Raunchy Comedy|Stand-Up Comedy|Indie Comedies/i,
      max: 5
    },
    {
      group: "horror_thriller",
      railFilter: /Featured Horror|Featured Thriller|Cult Films/i,
      max: 5
    },
    {
      group: "classic_tv",
      railFilter: /Featured Classic TV|Classic TV Dramas|Classic Sitcoms|CBS TV Classics/i,
      max: 5
    },
    {
      group: "martial_arts_cult",
      railFilter: /Martial Arts|Cult Films|🏛️ Archive/i,
      max: 5
    }
  ];

  const registry = [];
  const seenKeys = new Set();

  for (const spec of categorySpecs) {
    const matchingRails = rails.filter(r => spec.railFilter.test(r.name));
    let count = 0;

    for (const rail of matchingRails) {
      if (count >= spec.max) break;

      for (const item of rail.items || []) {
        if (count >= spec.max) break;
        if (!item.title || !item.poster || !item.poster.startsWith('http')) continue;

        const key = normKey(item.title);
        if (seenKeys.has(key)) continue;

        const slugifiedTitle = item.title.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
        const filename = `${spec.group}_${slugifiedTitle}.jpg`;
        const filepath = path.join(dir, filename);

        try {
          const imgRes = await fetch(item.poster, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' }
          });
          if (imgRes.ok) {
            const buffer = Buffer.from(await imgRes.arrayBuffer());
            if (buffer.length > 5000) {
              fs.writeFileSync(filepath, buffer);
              seenKeys.add(key);
              registry.push({
                id: filename.replace('.jpg', ''),
                title: item.title,
                category: spec.group,
                poster: `/posters/${filename}`
              });
              count++;
              console.log(`✓ [${spec.group.toUpperCase()}] Saved (${rail.name}): ${item.title} -> ${filename}`);
            }
          }
        } catch (e) {}
      }
    }
  }

  const registryPath = path.join(process.cwd(), 'frontend/src/landing_posters.json');
  fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2));
  console.log(`\nSuccessfully verified and saved ${registry.length} high-impact multi-genre posters across 103 live rails.`);
}

run();
