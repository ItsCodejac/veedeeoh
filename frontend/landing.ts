import { getSession, signIn } from './src/auth';

async function checkAuth() {
  const session = getSession();
  if (session && window.location.pathname.endsWith('landing.html')) {
    window.location.href = '/index.html';
  }
}

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
    const email = emailInput.value;
    submitBtn.disabled = true;
    submitBtn.textContent = 'Verifying...';
    
    try {
      await signIn(email);
      authMessage.style.display = 'block';
      authMessage.style.color = '#c5f04e';
      authMessage.textContent = 'Access granted! Redirecting to streaming app...';
      setTimeout(() => {
        window.location.href = '/index.html';
      }, 400);
    } catch (err: any) {
      authMessage.style.display = 'block';
      authMessage.style.color = '#ff3b30';
      authMessage.textContent = err.message || 'Access is reserved for invited waitlist members.';
      submitBtn.disabled = false;
      submitBtn.textContent = 'Sign In';
    }
  });
}

// Iconic real TMDB movie & series posters
const DEFAULT_ITEMS = [
  { title: "Dune: Part Two", poster: "https://image.tmdb.org/t/p/w500/1pdfLPoLStVJ2L8WQPWVFCDBWph.jpg", genre: "Sci-Fi & Fantasy" },
  { title: "Oppenheimer", poster: "https://image.tmdb.org/t/p/w500/8Gxv8gSFCU0XGDykEGv7zR1n2ua.jpg", genre: "Drama & History" },
  { title: "The Dark Knight", poster: "https://image.tmdb.org/t/p/w500/q6y0Go1tsGEsmtFryDOJo3dEmqu.jpg", genre: "Action & Adventure" },
  { title: "Interstellar", poster: "https://image.tmdb.org/t/p/w500/gEU2QniE6E77NI6lCU6MxlNBvIx.jpg", genre: "Sci-Fi & Fantasy" },
  { title: "Pulp Fiction", poster: "https://image.tmdb.org/t/p/w500/39wmItE2AB53vScwUqE9iTZSuYd.jpg", genre: "Crime & Thriller" },
  { title: "Inception", poster: "https://image.tmdb.org/t/p/w500/d5iIlFn5s0ImszYzBPb8JPIfbXD.jpg", genre: "Sci-Fi & Fantasy" },
  { title: "The Matrix", poster: "https://image.tmdb.org/t/p/w500/62HCnUTziyWcpDaBO2i1DX17rE.jpg", genre: "Sci-Fi & Fantasy" },
  { title: "Fight Club", poster: "https://image.tmdb.org/t/p/w500/pB8BM7PDSp6B6Ih7QZ4DrQ3PmJK.jpg", genre: "Cult & Archive Cinema" },
  { title: "Avengers: Endgame", poster: "https://image.tmdb.org/t/p/w500/or06FN3Dka5tukK1e9vtnq2pAY2.jpg", genre: "Action & Adventure" },
  { title: "Blade Runner 2049", poster: "https://image.tmdb.org/t/p/w500/gajva2L0rPYkEWjzgFlBXCAVBE5.jpg", genre: "Sci-Fi & Fantasy" }
];

const GENRES = [
  { name: "Action & Adventure", keyword: "action", fallback: "https://image.tmdb.org/t/p/w500/q6y0Go1tsGEsmtFryDOJo3dEmqu.jpg" },
  { name: "Comedy & Stand-up", keyword: "comedy", fallback: "https://image.tmdb.org/t/p/w500/39wmItE2AB53vScwUqE9iTZSuYd.jpg" },
  { name: "Sci-Fi & Fantasy", keyword: "sci", fallback: "https://image.tmdb.org/t/p/w500/1pdfLPoLStVJ2L8WQPWVFCDBWph.jpg" },
  { name: "Horror & Suspense", keyword: "horror", fallback: "https://image.tmdb.org/t/p/w500/pB8BM7PDSp6B6Ih7QZ4DrQ3PmJK.jpg" },
  { name: "Crime & Thriller", keyword: "crime", fallback: "https://image.tmdb.org/t/p/w500/d5iIlFn5s0ImszYzBPb8JPIfbXD.jpg" },
  { name: "Drama & Romance", keyword: "drama", fallback: "https://image.tmdb.org/t/p/w500/8Gxv8gSFCU0XGDykEGv7zR1n2ua.jpg" },
  { name: "Documentaries", keyword: "doc", fallback: "https://image.tmdb.org/t/p/w500/gEU2QniE6E77NI6lCU6MxlNBvIx.jpg" },
  { name: "Cult & Archive Cinema", keyword: "archive", fallback: "https://image.tmdb.org/t/p/w500/62HCnUTziyWcpDaBO2i1DX17rE.jpg" },
  { name: "Anime & Animation", keyword: "anime", fallback: "https://image.tmdb.org/t/p/w500/or06FN3Dka5tukK1e9vtnq2pAY2.jpg" },
  { name: "Family & Kids", keyword: "family", fallback: "https://image.tmdb.org/t/p/w500/gajva2L0rPYkEWjzgFlBXCAVBE5.jpg" },
];

/** Hydrate Landing Page with REAL VOD Catalog Data + Instant Hero Marquee */
function renderCatalogUI(items: any[], rails: any[]) {
  const hubGrid = document.getElementById('hubGrid');
  const top10Row = document.getElementById('top10Row');
  const genreTrack = document.getElementById('genreTrack');
  const marqueeTrack1 = document.getElementById('marqueeTrack1');
  const marqueeTrack2 = document.getElementById('marqueeTrack2');

  const activeItems = items.length > 0 ? items : DEFAULT_ITEMS;

  // 1. Populate Top Hero Marquee Tracks (#marqueeTrack1 and #marqueeTrack2)
  if (marqueeTrack1 && marqueeTrack2) {
    marqueeTrack1.innerHTML = '';
    marqueeTrack2.innerHTML = '';

    const row1Items = activeItems.slice(0, 5);
    const row2Items = activeItems.slice(5, 10);

    const renderTrack = (trackElement: HTMLElement, trackItems: any[]) => {
      const loopItems = [...trackItems, ...trackItems, ...trackItems, ...trackItems];
      loopItems.forEach((item, idx) => {
        const card = document.createElement('div');
        card.className = 'marquee-card';

        const fallback = DEFAULT_ITEMS[idx % DEFAULT_ITEMS.length].poster;
        const img = document.createElement('img');
        img.src = item.poster || fallback;
        img.alt = item.title || 'Movie';
        img.referrerPolicy = 'no-referrer';
        img.onerror = () => { img.src = fallback; };

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
