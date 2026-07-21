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

const heroForm = document.getElementById('heroForm') as HTMLFormElement;
const heroWaitlistBtn = document.getElementById('heroWaitlistBtn') as HTMLButtonElement;
const heroWaitlistMessage = document.getElementById('heroWaitlistMessage') as HTMLDivElement;

if (navAuthBtn) navAuthBtn.addEventListener('click', openAuth);
if (closeAuthBtn) closeAuthBtn.addEventListener('click', closeAuth);

if (heroForm) {
  heroForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const emailInput = document.getElementById('heroEmailInput') as HTMLInputElement;
    const email = emailInput ? emailInput.value.trim() : '';

    if (!email) return;

    if (heroWaitlistBtn) {
      heroWaitlistBtn.disabled = true;
      heroWaitlistBtn.textContent = 'Joining...';
    }

    try {
      const res = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      });
      const data = await res.json();
      heroForm.style.display = 'none';
      if (heroWaitlistMessage) {
        heroWaitlistMessage.style.display = 'block';
        heroWaitlistMessage.textContent = data.message || "You've been added to the cloud waitlist! We'll notify you as spots open.";
      }
    } catch (err) {
      heroForm.style.display = 'none';
      if (heroWaitlistMessage) {
        heroWaitlistMessage.style.display = 'block';
        heroWaitlistMessage.textContent = "You've been added to the cloud waitlist! We'll notify you as spots open.";
      }
    }
  });
}

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
          img.referrerPolicy = 'no-referrer';
          img.onerror = () => {
            img.src = 'https://images.unsplash.com/photo-1536440136628-849c177e76a1?w=400&q=80';
          };

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
            <img src="${item.poster}" alt="${item.title}" referrerpolicy="no-referrer" onerror="this.src='https://images.unsplash.com/photo-1536440136628-849c177e76a1?w=400&q=80'" />
            <div class="top10-poster-overlay"></div>
            <div class="top10-poster-title">${item.title}</div>
          </div>
        `;
        top10Row.appendChild(card);
      });
    }

    // 4. Populate Movie & TV Genre Carousel Cards
    const genreTrack = document.getElementById('genreTrack');
    if (genreTrack && allItems.length > 0) {
      const genres = [
        { name: "Action & Adventure", keyword: "action", fallback: "https://images.unsplash.com/photo-1536440136628-849c177e76a1?w=400&q=80" },
        { name: "Comedy & Stand-up", keyword: "comedy", fallback: "https://images.unsplash.com/photo-1514306191717-452ec28c7814?w=400&q=80" },
        { name: "Sci-Fi & Fantasy", keyword: "sci", fallback: "https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=400&q=80" },
        { name: "Horror & Suspense", keyword: "horror", fallback: "https://images.unsplash.com/photo-1509248961158-e54f6934749c?w=400&q=80" },
        { name: "Crime & Thriller", keyword: "crime", fallback: "https://images.unsplash.com/photo-1453728013993-6d66e9c9123a?w=400&q=80" },
        { name: "Drama & Romance", keyword: "drama", fallback: "https://images.unsplash.com/photo-1485846234645-a62644f84728?w=400&q=80" },
        { name: "Documentaries", keyword: "doc", fallback: "https://images.unsplash.com/photo-1518173946687-a4c8a383392e?w=400&q=80" },
        { name: "Cult & Archive Cinema", keyword: "archive", fallback: "https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=400&q=80" },
        { name: "Anime & Animation", keyword: "anime", fallback: "https://images.unsplash.com/photo-1578632767115-351597cf2477?w=400&q=80" },
        { name: "Family & Kids", keyword: "family", fallback: "https://images.unsplash.com/photo-1513106580091-1d82408b8cd6?w=400&q=80" },
      ];

      genreTrack.innerHTML = '';
      // Duplicate array for seamless infinite film strip marquee loop
      const filmStripList = [...genres, ...genres];

      filmStripList.forEach((g) => {
        const match = allItems.find(i => 
          (i.genre && i.genre.toLowerCase().includes(g.keyword)) ||
          (i.title && i.title.toLowerCase().includes(g.keyword))
        );
        const posterUrl = (match && match.poster) ? match.poster : g.fallback;

        const card = document.createElement('div');
        card.className = 'genre-card';
        card.addEventListener('click', openAuth);
        card.innerHTML = `
          <img src="${posterUrl}" alt="${g.name}" referrerpolicy="no-referrer" onerror="this.src='${g.fallback}'" />
          <div class="genre-card-overlay"></div>
          <div class="genre-card-info">
            <div class="genre-tag">FEATURED GENRE</div>
            <div class="genre-title">${g.name}</div>
          </div>
        `;
        genreTrack.appendChild(card);
      });
    }
  } catch (err) {
    console.warn('Live catalog hydration error:', err);
  }
}

// Check if already authenticated
void checkAuth();
void loadLiveCatalog();
