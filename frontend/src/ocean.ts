import { VodItem } from './types';
import { getVodRails, openVodDetails } from './vod';
import { escapeHtml } from './util';

export async function renderOceanSanctuary(): Promise<void> {
  const container = document.getElementById('oceanRails');
  if (!container) return;

  container.innerHTML = `
    <div style="padding: 40px; text-align: center; color: rgba(255,255,255,0.5); font-weight: 600;">
      Loading Ocean TV streams...
    </div>
  `;

  try {
    const rails = await getVodRails();

    // Filter for rails containing ocean, marine, nature, or wildlife content
    const oceanRails = rails.filter(r => 
      /ocean|marine|underwater|sea|shark|whale|tide|aquatic|nature|wildlife|planet/i.test(r.name) ||
      r.items.some((it: VodItem) => /shark|ocean|sea|whale|underwater|marine|tide pool/i.test(it.title || ''))
    );

    container.innerHTML = '';

    if (oceanRails.length === 0) {
      // If no dedicated ocean rail is found, pull matching individual ocean/marine items from all rails
      const oceanItemsMap = new Map<string, VodItem>();
      rails.forEach(rail => {
        rail.items.forEach((it: VodItem) => {
          if (/shark|ocean|sea|whale|underwater|marine|tide pool|dolphin|jellyfish|deep blue|oyster|aquatic/i.test(`${it.title} ${it.summary || ''}`)) {
            if (!oceanItemsMap.has(it.id)) {
              oceanItemsMap.set(it.id, it);
            }
          }
        });
      });

      const items = Array.from(oceanItemsMap.values());
      if (items.length > 0) {
        renderOceanGrid(container, "🌊 Ocean Animals TV", items);
      } else {
        container.innerHTML = `
          <div style="padding: 40px; text-align: center; color: rgba(255,255,255,0.5);">
            No Ocean TV streams currently available.
          </div>
        `;
      }
      return;
    }

    oceanRails.forEach(rail => {
      // Filter out non-ocean items if it's a broad category
      const items = rail.items.filter((it: VodItem) => 
        !/anime|naruto|dragon ball|sailor moon|bleach|one piece/i.test(`${it.title} ${it.summary || ''}`)
      );
      if (items.length > 0) {
        renderOceanGrid(container, `🌊 ${rail.name}`, items);
      }
    });
  } catch (err) {
    console.error("Error loading Ocean TV streams:", err);
    container.innerHTML = `
      <div style="padding: 40px; text-align: center; color: #ff5e7e;">
        Failed to load Ocean TV streams. Please refresh to try again.
      </div>
    `;
  }
}

function renderOceanGrid(container: HTMLElement, title: string, items: VodItem[]): void {
  const section = document.createElement('div');
  section.className = 'showcaseRail';
  section.style.marginBottom = '36px';

  const header = document.createElement('h3');
  header.style.cssText = 'font-size: 20px; font-weight: 800; color: #38bdf8; margin: 0 0 18px; display: flex; align-items: center; gap: 8px;';
  header.innerHTML = `<span>${escapeHtml(title)}</span>`;
  section.appendChild(header);

  const row = document.createElement('div');
  row.style.cssText = 'display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 20px;';

  items.forEach(item => {
    const card = document.createElement('div');
    card.style.cssText = 'background: #10141e; border: 1px solid rgba(56,189,248,0.2); border-radius: 16px; overflow: hidden; cursor: pointer; transition: transform 0.2s ease, border-color 0.2s ease; position: relative;';
    card.onmouseover = () => { card.style.transform = 'translateY(-4px)'; card.style.borderColor = '#38bdf8'; };
    card.onmouseout = () => { card.style.transform = 'none'; card.style.borderColor = 'rgba(56,189,248,0.2)'; };

    const posterSrc = item.poster || item.banner || '';

    card.innerHTML = `
      <div style="height: 150px; position: relative; overflow: hidden;">
        ${posterSrc ? `<img src="${escapeHtml(posterSrc)}" alt="${escapeHtml(item.title)}" style="width: 100%; height: 100%; object-fit: cover;" />` : `<div style="width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; background: #161c2b; font-size: 32px;">🌊</div>`}
        <div style="position: absolute; inset: 0; background: linear-gradient(180deg, transparent 40%, rgba(6,7,10,0.9) 100%);"></div>
        <div style="position: absolute; bottom: 12px; left: 12px; right: 12px; display: flex; align-items: center; justify-content: space-between;">
          <span style="background: rgba(56,189,248,0.3); backdrop-filter: blur(8px); border: 1px solid rgba(56,189,248,0.5); color: #fff; padding: 2px 8px; border-radius: 6px; font-size: 11px; font-weight: 700;">LIVE STREAM</span>
          <div style="width: 32px; height: 32px; border-radius: 50%; background: #38bdf8; color: #06070a; display: flex; align-items: center; justify-content: center; font-weight: bold;">▶</div>
        </div>
      </div>
      <div style="padding: 16px;">
        <h4 style="margin: 0 0 6px; font-size: 15px; font-weight: 700; color: #fff;">${escapeHtml(item.title)}</h4>
        <p style="margin: 0; font-size: 12px; color: #9aa5b5; line-height: 1.4; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;">${escapeHtml(item.summary || item.genre || '')}</p>
      </div>
    `;

    card.onclick = () => {
      openVodDetails(item);
    };

    row.appendChild(card);
  });

  section.appendChild(row);
  container.appendChild(section);
}
