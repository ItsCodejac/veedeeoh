const fs = require('fs');
const path = require('path');

const dir = path.join(process.cwd(), 'frontend/public/posters');
if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });

function normKey(str) {
  return str.toLowerCase().replace(/en español|en espanol|\(español\)|\(espanol\)|\(dubbed\)|spanish/gi, '').replace(/[^a-z0-9]/g, '');
}

async function run() {
  const targetCategories = {
    action: ['action'],
    anime: ['anime'],
    comedy: ['comedy'],
    horror: ['horror'],
    drama: ['drama'],
    scifi: ['sci_fi_and_fantasy'],
    black: ['black_cinema'],
    archive: ['documentaries', 'classics']
  };

  const registry = [];
  const seenTitles = new Set();

  for (const [catGroup, slugs] of Object.entries(targetCategories)) {
    let groupCount = 0;
    for (const slug of slugs) {
      if (groupCount >= 5) break;
      try {
        const res = await fetch('https://tubitv.com/category/' + slug, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36' }
        });
        if (!res.ok) continue;
        const html = await res.text();
        const m = html.match(/window\.__data\s*=\s*(\{.*?\}\});/s);
        if (!m) continue;

        const data = JSON.parse(m[1].replace(/:\s*undefined/g, ':null'));
        const videos = Object.values(data.video?.byId || {});

        for (const v of videos) {
          if (groupCount >= 5) break;
          if (!v.title || !v.images) continue;

          const key = normKey(v.title);
          if (seenTitles.has(key)) continue;

          const rawPoster = v.images.posterarts?.[0] || v.images.hero_16x9?.[0];
          if (!rawPoster) continue;

          const posterUrl = rawPoster.startsWith('//') ? 'https:' + rawPoster : rawPoster;
          const slugifiedTitle = v.title.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
          const filename = `${catGroup}_${slugifiedTitle}.jpg`;
          const filepath = path.join(dir, filename);

          try {
            const imgRes = await fetch(posterUrl, {
              headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' }
            });
            if (imgRes.ok) {
              const buffer = Buffer.from(await imgRes.arrayBuffer());
              if (buffer.length > 5000) {
                fs.writeFileSync(filepath, buffer);
                seenTitles.add(key);
                registry.push({
                  id: filename.replace('.jpg', ''),
                  title: v.title,
                  category: catGroup,
                  poster: `/posters/${filename}`
                });
                groupCount++;
                console.log(`[${catGroup.toUpperCase()}] Saved: ${v.title} -> ${filename}`);
              }
            }
          } catch (e) {}
        }
      } catch (e) {}
    }
  }

  const registryPath = path.join(process.cwd(), 'frontend/src/landing_posters.json');
  fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2));
  console.log('\nTotal curated posters saved:', registry.length);
}

run();
