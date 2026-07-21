import { getSession, restoreSession, signIn } from './src/auth';

async function checkAuth() {
  const session = await restoreSession();
  if (session) {
    window.location.href = '/index.html';
  }
}

async function loadLiveStats() {
  const statsText = document.getElementById('heroStatsText');
  if (!statsText) return;
  try {
    const res = await fetch('/api/stats');
    if (res.ok) {
      const data = await res.json();
      if (data.totalTitles > 0) {
        const moviesFormatted = Number(data.moviesCount || 0).toLocaleString();
        const showsFormatted = Number(data.showsCount || 0).toLocaleString();
        const totalFormatted = Number(data.totalTitles || 0).toLocaleString();
        statsText.textContent = `⚡ OVER ${totalFormatted}+ FREE MOVIES & SHOWS (${moviesFormatted} MOVIES · ${showsFormatted} SHOWS) · UPDATED LIVE`;
      }
    }
  } catch (e) {
    console.warn("Failed to fetch live stats:", e);
  }
}

void loadLiveStats();

const navAuthBtn = document.getElementById('navAuthBtn') as HTMLButtonElement;
const authModal = document.getElementById('authModal') as HTMLDivElement;
const closeAuthBtn = document.getElementById('closeAuthBtn') as HTMLButtonElement;
const authForm = document.getElementById('authForm') as HTMLFormElement;
const emailInput = document.getElementById('emailInput') as HTMLInputElement;
const submitBtn = document.getElementById('submitBtn') as HTMLButtonElement;
const authMessage = document.getElementById('authMessage') as HTMLDivElement;

function openAuth() {
  if (authModal) {
    authModal.style.display = 'flex';
    if (emailInput) emailInput.focus();
  }
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
    const password = (document.getElementById('passwordInput') as HTMLInputElement)?.value || '';
    const email = emailInput.value;
    submitBtn.disabled = true;
    submitBtn.textContent = 'Verifying...';
    
    try {
      const { mustChangePassword } = await signIn(email, password);
      authMessage.style.display = 'block';
      authMessage.style.color = '#c5f04e';
      if (mustChangePassword) {
        authMessage.textContent = 'Access granted! You must set a new password first...';
        setTimeout(() => {
          window.location.href = '/change-password.html';
        }, 600);
      } else {
        authMessage.textContent = 'Access granted! Redirecting to streaming app...';
        setTimeout(() => {
          window.location.href = '/index.html';
        }, 400);
      }
    } catch (err: any) {
      authMessage.style.display = 'block';
      authMessage.style.color = '#ff3b30';
      authMessage.textContent = err.message || 'Invalid email or password.';
      submitBtn.disabled = false;
      submitBtn.textContent = 'Sign In';
    }
  });
}

const LOCAL_POSTERS = [
  { title: "Ghost In The Shell", poster: "/posters/ghost_in_the_shell.jpg", genre: "Anime & Sci-Fi" },
  { title: "Space Adventure Cobra", poster: "/posters/space_adventure_cobra.jpg", genre: "Anime & Action" },
  { title: "Naruto", poster: "/posters/naruto.jpg", genre: "Anime & Adventure" },
  { title: "Yu-Gi-Oh!", poster: "/posters/yugioh_espanol.jpg", genre: "Anime & Fantasy" },
  { title: "Death Note", poster: "/posters/death_note.jpg", genre: "Anime & Mystery" },
  { title: "Zom 100: Bucket List of the Dead", poster: "/posters/zom_100.jpg", genre: "Anime & Comedy" },
  { title: "Hunter x Hunter", poster: "/posters/hunter_x_hunter.jpg", genre: "Anime & Action" },
  { title: "JoJo's Bizarre Adventure", poster: "/posters/jojo_bizarre_adventure.jpg", genre: "Anime & Action" },
  { title: "Inuyasha", poster: "/posters/inuyasha.jpg", genre: "Anime & Fantasy" },
  { title: "Captain Tsubasa", poster: "/posters/captain_tsubasa.jpg", genre: "Anime & Sports" },
  { title: "Pop Team Epic", poster: "/posters/pop_team_epic.jpg", genre: "Anime & Comedy" },
  { title: "Saint Seiya", poster: "/posters/saint_seiya.jpg", genre: "Anime & Action" },
  { title: "Digimon Adventure", poster: "/posters/digimon.jpg", genre: "Anime & Fantasy" },
  { title: "Love Hina", poster: "/posters/love_hina.jpg", genre: "Anime & Romance" },
  { title: "Interlude", poster: "/posters/interlude.jpg", genre: "Anime & Sci-Fi" },
  { title: "Inuyasha: The Final Act", poster: "/posters/inuyasha_final_act.jpg", genre: "Anime & Fantasy" },
  { title: "Yashahime", poster: "/posters/yashahime.jpg", genre: "Anime & Fantasy" },
  { title: "Mr. Osomatsu", poster: "/posters/mr_osomatsu.jpg", genre: "Anime & Comedy" },
  { title: "Gaiking", poster: "/posters/gaiking.jpg", genre: "Anime & Mecha" },
  { title: "Tiger Mask W", poster: "/posters/tiger_mask.jpg", genre: "Anime & Sports" }
];

const DEFAULT_ITEMS = LOCAL_POSTERS;

const GENRES = [
  { name: "Action & Adventure", keyword: "action", fallback: "https://images.unsplash.com/photo-1509198397868-475647b2a1e5?w=800&auto=format&fit=crop&q=80" },
  { name: "Comedy & Stand-up", keyword: "comedy", fallback: "https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=800&auto=format&fit=crop&q=80" },
  { name: "Sci-Fi & Fantasy", keyword: "sci", fallback: "https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=800&auto=format&fit=crop&q=80" },
  { name: "Horror & Suspense", keyword: "horror", fallback: "https://images.unsplash.com/photo-1574375927938-d5a98e8ffe85?w=800&auto=format&fit=crop&q=80" },
  { name: "Crime & Thriller", keyword: "crime", fallback: "https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=800&auto=format&fit=crop&q=80" },
  { name: "Drama & Romance", keyword: "drama", fallback: "https://images.unsplash.com/photo-1440404653325-ab127d49abc1?w=800&auto=format&fit=crop&q=80" },
  { name: "Documentaries", keyword: "doc", fallback: "https://images.unsplash.com/photo-1485846234645-a62644f84728?w=800&auto=format&fit=crop&q=80" },
  { name: "Cult & Archive Cinema", keyword: "archive", fallback: "https://images.unsplash.com/photo-1526374965328-7f61d4dc18c5?w=800&auto=format&fit=crop&q=80" },
  { name: "Anime & Animation", keyword: "anime", fallback: "https://images.unsplash.com/photo-1578632767115-351597cf2477?w=800&auto=format&fit=crop&q=80" },
  { name: "Family & Kids", keyword: "family", fallback: "https://images.unsplash.com/photo-1536440136628-849c177e76a1?w=800&auto=format&fit=crop&q=80" },
];

/** Hydrate Landing Page with REAL VOD Catalog Data + Instant Hero Marquee */
function renderCatalogUI(items: any[], rails: any[]) {
  const activeItems = items.length > 0 ? items : DEFAULT_ITEMS;
  const hubGrid = document.getElementById('hubGrid');
  const top10Row = document.getElementById('top10Row');
  const genreTrack = document.getElementById('genreTrack');
  const marqueeTrack1 = document.getElementById('marqueeTrack1');
  const marqueeTrack2 = document.getElementById('marqueeTrack2');
  const marqueeTrack3 = document.getElementById('marqueeTrack3');
  const marqueeTrack4 = document.getElementById('marqueeTrack4');

  // 1. Populate Top Hero Marquee Tracks (Smooth 60FPS Vivid Wall)
  if (marqueeTrack1 && marqueeTrack2 && marqueeTrack3 && marqueeTrack4) {
    marqueeTrack1.innerHTML = '';
    marqueeTrack2.innerHTML = '';
    marqueeTrack3.innerHTML = '';
    marqueeTrack4.innerHTML = '';

    // Shuffle active items for alternating variety
    const shuffled = [...activeItems].sort(() => 0.5 - Math.random());
    const chunkSize = Math.max(4, Math.floor(shuffled.length / 4));

    const row1Items = shuffled.slice(0, chunkSize);
    const row2Items = shuffled.slice(chunkSize, chunkSize * 2);
    const row3Items = shuffled.slice(chunkSize * 2, chunkSize * 3);
    const row4Items = shuffled.slice(chunkSize * 3);

    const renderTrack = (trackElement: HTMLElement, trackItems: any[]) => {
      const loopItems = trackItems.length > 0 ? [...trackItems, ...trackItems, ...trackItems] : DEFAULT_ITEMS;
      loopItems.forEach((item, idx) => {
        const card = document.createElement('div');
        card.className = 'marquee-card';

        const fallback = DEFAULT_ITEMS[idx % DEFAULT_ITEMS.length].poster;
        const img = document.createElement('img');
        img.src = item.poster || fallback;
        img.alt = item.title || 'Movie';
        img.referrerPolicy = 'no-referrer';
        img.loading = 'lazy';
        img.onerror = function() {
          (this as HTMLImageElement).onerror = null;
          (this as HTMLImageElement).src = fallback;
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

    renderTrack(marqueeTrack1, row1Items);
    renderTrack(marqueeTrack2, row2Items);
    renderTrack(marqueeTrack3, row3Items);
    renderTrack(marqueeTrack4, row4Items);
  }

  // 2. Populate Category Hub Grid
  if (hubGrid) {
    hubGrid.innerHTML = '';
    const categories = rails.length > 0 ? rails.slice(0, 4) : [
      { name: "🚀 Trending Blockbusters & Hit Movies", items: activeItems.slice(0, 3) },
      { name: "📺 Popular Drama & Thriller Series", items: activeItems.slice(3, 6) },
      { name: "🏛️ Archive Classics & Cult Cinema", items: activeItems.slice(6, 9) },
      { name: "⚡ Action, Sci-Fi & Marvel Classics", items: activeItems.slice(1, 4) }
    ];

    categories.forEach((rail, index) => {
      const firstItem = (rail.items && rail.items[0]) || activeItems[index % activeItems.length];
      const card = document.createElement('div');
      card.className = 'hub-card';
      card.addEventListener('click', openAuth);

      const img = document.createElement('img');
      img.src = firstItem.poster || DEFAULT_ITEMS[index].poster;
      img.alt = rail.name;
      img.referrerPolicy = 'no-referrer';
      img.onerror = () => { img.src = DEFAULT_ITEMS[index].poster; };
      card.appendChild(img);

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

  // 3. Populate Top Watched Catalog Row
  if (top10Row) {
    top10Row.innerHTML = '';
    const topList = activeItems.slice(0, 5);
    topList.forEach((item, index) => {
      const card = document.createElement('div');
      card.className = 'top10-card';
      card.addEventListener('click', openAuth);

      card.innerHTML = `
        <div class="top10-num">${index + 1}</div>
        <div class="top10-poster">
          <img src="${item.poster}" alt="${item.title}" referrerpolicy="no-referrer" onerror="this.src='${DEFAULT_ITEMS[index % DEFAULT_ITEMS.length].poster}'" />
          <div class="top10-poster-overlay"></div>
          <div class="top10-poster-title">${item.title}</div>
        </div>
      `;
      top10Row.appendChild(card);
    });
  }

  // 4. Populate Film Strip Genre Marquee
  if (genreTrack) {
    genreTrack.innerHTML = '';
    const filmStripList = [...GENRES, ...GENRES];
    filmStripList.forEach((g) => {
      const match = activeItems.find(i => 
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
}

async function loadLiveCatalog() {
  // Render authentic movie posters to ALL sections immediately
  renderCatalogUI([], []);

  try {
    const res = await fetch('/api/vod');
    if (!res.ok) return;
    const data = await res.json();
    const rails: Array<{ name: string; items: any[] }> = data.rails || [];

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

    if (allItems.length > 0) {
      renderCatalogUI(allItems, rails);
    }
  } catch (err) {
    console.warn('Live catalog fetch error:', err);
  }
}

// Check if already authenticated
void checkAuth();
void loadLiveCatalog();
