import { getSession, signIn } from './src/auth';

const authModal = document.getElementById('authModal') as HTMLDivElement;
const navAuthBtn = document.getElementById('navAuthBtn') as HTMLButtonElement;
const heroAuthBtn = document.getElementById('heroAuthBtn') as HTMLButtonElement;
const closeAuthBtn = document.getElementById('closeAuthBtn') as HTMLButtonElement;
const authForm = document.getElementById('authForm') as HTMLFormElement;
const authMessage = document.getElementById('authMessage') as HTMLDivElement;
const submitBtn = document.getElementById('submitBtn') as HTMLButtonElement;
const emailInput = document.getElementById('email') as HTMLInputElement;

async function checkAuth() {
  const session = await getSession();
  if (session) {
    window.location.href = '/';
  }
}

function openAuth() {
  if (authModal) authModal.style.display = 'flex';
}

function closeAuth() {
  if (authModal) {
    authModal.style.display = 'none';
    authMessage.style.display = 'none';
    authForm.reset();
  }
}

if (navAuthBtn) navAuthBtn.addEventListener('click', openAuth);
if (heroAuthBtn) heroAuthBtn.addEventListener('click', openAuth);
if (closeAuthBtn) closeAuthBtn.addEventListener('click', closeAuth);

if (authModal) {
  authModal.addEventListener('click', (e) => {
    if (e.target === authModal) closeAuth();
  });
}

if (authForm) {
  authForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = emailInput.value;
    submitBtn.disabled = true;
    submitBtn.textContent = 'Sending...';
    
    try {
      await signIn(email);
      authForm.style.display = 'none';
      authMessage.style.display = 'block';
      authMessage.textContent = 'Check your email for the magic link!';
    } catch (err: any) {
      authMessage.style.display = 'block';
      authMessage.style.color = '#ff3b30';
      authMessage.textContent = err.message || 'An error occurred. Please try again.';
      submitBtn.disabled = false;
      submitBtn.textContent = 'Send Magic Link';
    }
  });
}

/** Hydrate Landing Page with REAL VOD Catalog Data */
async function loadLiveCatalog() {
  const heroWall = document.getElementById('heroWall');
  const hubGrid = document.getElementById('hubGrid');
  const top10Row = document.getElementById('top10Row');

  try {
    // Correct endpoint is /api/vod
    const res = await fetch('/api/vod');
    if (!res.ok) {
      console.warn('API /api/vod failed:', res.status);
      return;
    }
    const data = await res.json();
    const rails: Array<{ name: string; items: any[] }> = data.rails || [];

    // Collect all valid items with valid poster images from live catalog
    const allItems: any[] = [];
    rails.forEach((rail) => {
      if (rail.items) {
        rail.items.forEach((item) => {
          if (item.poster && item.title && item.poster.startsWith('http')) {
            allItems.push(item);
          }
        });
      }
    });

    if (allItems.length === 0) return;

    // 1. Populate Hero Marquee Tracks with real posters
    const marqueeTrack1 = document.getElementById('marqueeTrack1');
    const marqueeTrack2 = document.getElementById('marqueeTrack2');

    if (marqueeTrack1 && marqueeTrack2 && allItems.length > 0) {
      marqueeTrack1.innerHTML = '';
      marqueeTrack2.innerHTML = '';

      const row1Items = allItems.slice(0, 16);
      const row2Items = allItems.slice(16, 32);

      const renderTrack = (trackElement: HTMLElement, items: any[]) => {
        const loopItems = [...items, ...items];
        loopItems.forEach((item) => {
          const card = document.createElement('div');
          card.className = 'marquee-card';

          const img = document.createElement('img');
          img.src = item.poster;
          img.alt = item.title || 'Stream';
          img.onerror = () => { card.style.display = 'none'; };

          const overlay = document.createElement('div');
          overlay.className = 'marquee-card-overlay';

          const title = document.createElement('div');
          title.className = 'marquee-card-title';
          title.textContent = item.title || 'Movie & TV Show';

          card.appendChild(img);
          card.appendChild(overlay);
          card.appendChild(title);
          trackElement.appendChild(card);
        });
      };

      renderTrack(marqueeTrack1, row1Items.length > 0 ? row1Items : allItems);
      renderTrack(marqueeTrack2, row2Items.length > 0 ? row2Items : allItems);
    }

    // 2. Populate Category Hub Grid from real rails
    if (hubGrid) {
      hubGrid.innerHTML = '';
      const activeRails = rails.filter(r => r.items && r.items.length > 0).slice(0, 4);
      activeRails.forEach((rail, index) => {
        const firstItem = rail.items.find(i => i.poster && i.poster.startsWith('http')) || rail.items[0];
        const card = document.createElement('div');
        card.className = 'hub-card';
        card.addEventListener('click', openAuth);

        if (firstItem && firstItem.poster) {
          const img = document.createElement('img');
          img.src = firstItem.poster;
          img.alt = rail.name;
          card.appendChild(img);
        }

        const overlay = document.createElement('div');
        overlay.className = 'hub-card-overlay';
        card.appendChild(overlay);

        const info = document.createElement('div');
        info.className = 'hub-info';
        info.innerHTML = `
          <div class="hub-tag">FEATURED CATEGORY ${index + 1}</div>
          <div class="hub-title">${rail.name}</div>
        `;
        card.appendChild(info);
        hubGrid.appendChild(card);
      });
    }

    // 3. Populate Top Watched Row accurately from Pluto Popular/Trending rails or top VOD items
    if (top10Row) {
      top10Row.innerHTML = '';
      
      const popularRail = rails.find(r => /popular|trending|featured|top/i.test(r.name));
      let topCandidates: any[] = [];
      
      if (popularRail && popularRail.items) {
        topCandidates = popularRail.items.filter(i => i.poster && i.poster.startsWith('http'));
      }
      
      if (topCandidates.length < 5) {
        rails.forEach(rail => {
          if (!rail.name.includes("Anime") && rail.items) {
            rail.items.forEach(item => {
              if (item.poster && item.poster.startsWith('http') && !topCandidates.some(c => c.id === item.id)) {
                topCandidates.push(item);
              }
            });
          }
        });
      }

      const topItems = topCandidates.slice(0, 5);
      topItems.forEach((item, index) => {
        const card = document.createElement('div');
        card.className = 'top10-card';
        card.addEventListener('click', openAuth);

        card.innerHTML = `
          <div class="top10-num">${index + 1}</div>
          <div class="top10-poster">
            <img src="${item.poster}" alt="${item.title}" />
            <div class="top10-poster-overlay"></div>
            <div class="top10-poster-title">${item.title}</div>
          </div>
        `;
        top10Row.appendChild(card);
      });
    }
  } catch (err) {
    console.warn('Live catalog hydration error:', err);
  }
}

// Check if already authenticated
void checkAuth();
void loadLiveCatalog();
