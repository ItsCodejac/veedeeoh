import { getSession, restoreSession, signIn, signUp } from './frontend/src/auth';

async function checkAuth() {
  const session = await restoreSession();
  if (session) {
    window.location.href = '/index.html';
  }
}

let isSignUpMode = false;

// Handle incoming family invite links on Landing Page
function checkInviteLink() {
  const params = new URLSearchParams(window.location.search);
  const inviteCode = params.get('invite');
  const accName = params.get('acc');

  if (inviteCode) {
    const householdName = accName ? decodeURIComponent(accName) : "Family Household";
    isSignUpMode = true;

    // Save invite state for post-auth registration
    localStorage.setItem('veedeeoh_pending_household_invite', JSON.stringify({
      code: inviteCode,
      householdName
    }));

    // Display high-end Invite Hero Banner
    const heroSection = document.querySelector('.hero') || document.body;
    const inviteBanner = document.createElement('div');
    inviteBanner.style.cssText = `
      background: linear-gradient(135deg, rgba(197,240,78,0.15) 0%, rgba(6,214,160,0.15) 100%);
      border: 1px solid rgba(197,240,78,0.3); border-radius: 16px;
      padding: 20px 28px; margin: 90px auto 20px; max-width: 800px;
      display: flex; align-items: center; justify-content: space-between; gap: 20px;
      backdrop-filter: blur(16px); box-shadow: 0 12px 40px rgba(0,0,0,0.6);
      font-family: 'Space Grotesk', sans-serif; color: #fff;
    `;
    inviteBanner.innerHTML = `
      <div>
        <div style="font-size: 12px; font-weight: 800; color: #c5f04e; letter-spacing: 1.5px; text-transform: uppercase; margin-bottom: 4px;">🤝 HOUSEHOLD INVITATION</div>
        <h3 style="margin: 0; font-size: 20px; font-weight: 800;">You've been invited to join ${householdName}!</h3>
        <p style="margin: 4px 0 0; font-size: 13px; color: #9aa5b5;">Zero IP locks. Create your free account below to activate streaming access.</p>
      </div>
      <button id="inviteAcceptBtn" style="background: #c5f04e; color: #06070a; border: none; padding: 12px 22px; border-radius: 10px; font-weight: 800; font-size: 14px; cursor: pointer; white-space: nowrap;">
        Create Account
      </button>
    `;
    heroSection.prepend(inviteBanner);

    const acceptBtn = inviteBanner.querySelector('#inviteAcceptBtn');
    if (acceptBtn) acceptBtn.addEventListener('click', openAuth);

    // Auto-open Auth Modal in Sign Up mode
    setTimeout(openAuth, 1000);
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
checkInviteLink();

const navAuthBtn = document.getElementById('navAuthBtn') as HTMLButtonElement;
const authModal = document.getElementById('authModal') as HTMLDivElement;
const closeAuthBtn = document.getElementById('closeAuthBtn') as HTMLButtonElement;
const authForm = document.getElementById('authForm') as HTMLFormElement;
const emailInput = document.getElementById('emailInput') as HTMLInputElement;
const passwordInput = document.getElementById('passwordInput') as HTMLInputElement;
const submitBtn = document.getElementById('submitBtn') as HTMLButtonElement;
const authMessage = document.getElementById('authMessage') as HTMLDivElement;

function renderAuthModalUI() {
  const modalBox = authModal?.querySelector('.modal-box');
  if (!modalBox) return;

  const h2 = modalBox.querySelector('h2');
  const p = modalBox.querySelector('p');

  if (isSignUpMode) {
    if (h2) h2.textContent = 'Create Account & Join Household';
    if (p) p.textContent = 'Enter your email and create a password to set up your account.';
    if (passwordInput) passwordInput.placeholder = 'Create Password (min 6 chars)';
    if (submitBtn) submitBtn.textContent = 'Create Account & Join Household →';
  } else {
    if (h2) h2.textContent = 'Sign In';
    if (p) p.textContent = 'Enter your email and password to access your library.';
    if (passwordInput) passwordInput.placeholder = 'Password';
    if (submitBtn) submitBtn.textContent = 'Sign In →';
  }

  // Add Mode Toggle Link if not present
  let toggleBtn = modalBox.querySelector('#authModeToggleBtn') as HTMLElement;
  if (!toggleBtn) {
    toggleBtn = document.createElement('div');
    toggleBtn.id = 'authModeToggleBtn';
    toggleBtn.style.cssText = 'margin-top: 14px; text-align: center; font-size: 13px; color: #9aa5b5; cursor: pointer; font-family: sans-serif;';
    modalBox.appendChild(toggleBtn);

    toggleBtn.addEventListener('click', () => {
      isSignUpMode = !isSignUpMode;
      renderAuthModalUI();
    });
  }

  toggleBtn.innerHTML = isSignUpMode 
    ? `Already have an account? <span style="color: #c5f04e; text-decoration: underline;">Sign In</span>` 
    : `New user invited by family? <span style="color: #c5f04e; text-decoration: underline;">Create Account</span>`;
}

function openAuth() {
  if (authModal) {
    renderAuthModalUI();
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
    const email = emailInput.value.trim();
    const password = passwordInput?.value || '';

    if (!email || !password) {
      authMessage.style.display = 'block';
      authMessage.style.color = '#ff3b30';
      authMessage.textContent = 'Please provide both email and password.';
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = isSignUpMode ? 'Creating Account...' : 'Verifying...';
    
    try {
      if (isSignUpMode) {
        await signUp(email, password);
        authMessage.style.display = 'block';
        authMessage.style.color = '#c5f04e';
        authMessage.textContent = '✅ Account created! Redirecting to setup...';
        setTimeout(() => {
          window.location.href = '/index.html';
        }, 500);
      } else {
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
      }
    } catch (err: any) {
      authMessage.style.display = 'block';
      authMessage.style.color = '#ff3b30';
      authMessage.textContent = err.message || (isSignUpMode ? 'Account creation failed.' : 'Invalid email or password.');
      submitBtn.disabled = false;
      submitBtn.textContent = isSignUpMode ? 'Create Account & Join Household →' : 'Sign In →';
    }
  });
}

import CURATED_POSTERS from './frontend/src/landing_posters.json';

const DEFAULT_ITEMS = CURATED_POSTERS;

const GENRES = [
  { name: "Action & Blockbusters", categoryKey: "action_franchise", fallback: "/posters/action_franchise_terminator_2_judgment_day.jpg" },
  { name: "Comedy & Standup", categoryKey: "comedy", fallback: "/posters/comedy_ferris_buellers_day_off.jpg" },
  { name: "Sci-Fi & Cyberpunk", categoryKey: "sci_fi", fallback: "/posters/sci_fi_ghost_in_the_shell.jpg" },
  { name: "Thrillers & Suspense", categoryKey: "thriller", fallback: "/posters/thriller_se7en.jpg" },
  { name: "Cult Horror & Monsters", categoryKey: "horror", fallback: "/posters/horror_the_thing.jpg" },
  { name: "Binge-Worthy TV Series", categoryKey: "tv_series", fallback: "/posters/tv_series_peaky_blinders.jpg" }
];

function buildShowcase() {
  const container = document.getElementById('landingShowcase');
  if (!container) return;

  const catalog: any[] = Array.isArray(DEFAULT_ITEMS) ? DEFAULT_ITEMS : [];
  container.innerHTML = '';

  GENRES.forEach((genre) => {
    let items = catalog.filter((item: any) => {
      if (!item.categoryKey) return false;
      return item.categoryKey.toLowerCase() === genre.categoryKey.toLowerCase();
    });

    if (items.length === 0) {
      items = catalog.slice(0, 10);
    }

    const row = document.createElement('div');
    row.className = 'showcase-row';

    const header = document.createElement('div');
    header.className = 'showcase-header';
    header.innerHTML = `
      <h3>${genre.name}</h3>
      <span class="count">${items.length} Titles Available Free</span>
    `;

    const grid = document.createElement('div');
    grid.className = 'showcase-grid';

    items.slice(0, 12).forEach((item: any) => {
      const card = document.createElement('div');
      card.className = 'poster-card';
      const imgUrl = item.poster || item.banner || genre.fallback;

      card.innerHTML = `
        <img src="${imgUrl}" alt="${item.title || 'Movie'}" loading="lazy" />
        <div class="poster-overlay">
          <div class="play-btn">▶</div>
          <div class="poster-title">${item.title}</div>
          <div class="poster-meta">${[item.genre, item.rating].filter(Boolean).join(' · ')}</div>
        </div>
      `;

      card.addEventListener('click', openAuth);
      grid.appendChild(card);
    });

    row.appendChild(header);
    row.appendChild(grid);
    container.appendChild(row);
  });
}

buildShowcase();
void checkAuth();
