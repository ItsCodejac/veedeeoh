import { getSession, restoreSession, signIn, signUp, signInWithGoogle } from './src/auth';

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
        <div style="display: inline-flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 800; color: #c5f04e; letter-spacing: 1.5px; text-transform: uppercase; margin-bottom: 4px;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>HOUSEHOLD INVITATION</div>
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
        statsText.textContent = `OVER ${totalFormatted}+ FREE MOVIES & SHOWS (${moviesFormatted} MOVIES · ${showsFormatted} SHOWS), UPDATED LIVE`;
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

// Inject "Continue with Google" above the email/password form (no HTML edit).
(function addGoogleAuth() {
  const box = authModal?.querySelector('.modal-box');
  if (!box || box.querySelector('#googleAuthBtn')) return;
  const btn = document.createElement('button');
  btn.id = 'googleAuthBtn';
  btn.type = 'button';
  btn.innerHTML = `<svg width="18" height="18" viewBox="0 0 48 48" style="flex:none"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.9 2.4 30.3 0 24 0 14.6 0 6.4 5.4 2.4 13.2l7.9 6.1C12.2 13.2 17.6 9.5 24 9.5z"/><path fill="#4285F4" d="M46.1 24.6c0-1.6-.1-3.1-.4-4.6H24v9.1h12.4c-.5 2.9-2.1 5.3-4.6 7l7.1 5.5c4.2-3.9 6.6-9.6 6.6-16z"/><path fill="#FBBC05" d="M10.3 28.3c-.5-1.4-.8-2.8-.8-4.3s.3-3 .8-4.3l-7.9-6.1C.9 16.5 0 20.1 0 24s.9 7.5 2.4 10.6l7.9-6.3z"/><path fill="#34A853" d="M24 48c6.3 0 11.6-2.1 15.5-5.7l-7.1-5.5c-2 1.3-4.5 2.1-8.4 2.1-6.4 0-11.8-3.7-13.7-8.9l-7.9 6.3C6.4 42.6 14.6 48 24 48z"/></svg> Continue with Google`;
  btn.style.cssText = "width:100%;display:flex;align-items:center;justify-content:center;gap:10px;padding:12px;border-radius:10px;background:#fff;color:#1a1a1a;border:none;font-weight:700;font-size:15px;cursor:pointer;margin-bottom:16px;";
  btn.addEventListener('click', async () => {
    btn.disabled = true; btn.textContent = 'Redirecting…';
    try { await signInWithGoogle(); }
    catch (e: any) {
      if (authMessage) { authMessage.textContent = e?.message || 'Google sign-in failed'; authMessage.style.color = '#ff8a8a'; }
      btn.disabled = false; btn.innerHTML = 'Continue with Google';
    }
  });
  const divider = document.createElement('div');
  divider.textContent = 'or';
  divider.style.cssText = "text-align:center;color:#7a8598;font-size:12px;margin:0 0 16px;";
  const anchor = authForm && authForm.parentElement === box ? authForm : box.querySelector('h2')?.nextElementSibling || null;
  box.insertBefore(btn, anchor);
  box.insertBefore(divider, anchor);
})();

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

// Open the modal already switched to account creation (the "Start free trial" path).
function openAuthSignup() {
  isSignUpMode = true;
  openAuth();
}

function closeAuth() {
  if (authModal) {
    authModal.style.display = 'none';
    authMessage.style.display = 'none';
    authForm.reset();
  }
}

if (navAuthBtn) navAuthBtn.addEventListener('click', openAuth);
if (closeAuthBtn) closeAuthBtn.addEventListener('click', closeAuth);

// Hero + pricing CTAs. "Start free trial" opens the modal in account-creation
// mode; "Sign in" opens it in the default sign-in mode.
document.getElementById('heroTrialBtn')?.addEventListener('click', openAuthSignup);
document.getElementById('pricingTrialBtn')?.addEventListener('click', openAuthSignup);
document.getElementById('heroSignInBtn')?.addEventListener('click', openAuth);

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
        authMessage.textContent = 'Account created. Redirecting to setup...';
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

import CURATED_POSTERS from './src/landing_posters.json';

interface PosterItem { id: string; title: string; category: string; poster: string; }
const POSTERS: PosterItem[] = Array.isArray(CURATED_POSTERS) ? (CURATED_POSTERS as PosterItem[]) : [];

// Display names + eyebrow tags per category slug used in landing_posters.json.
const CATEGORY_META: Record<string, { name: string; tag: string }> = {
  a24_award:         { name: "A24 & Award Winners",  tag: "Critically Acclaimed" },
  action_franchise:  { name: "Action & Blockbusters", tag: "Non-Stop Action" },
  anime:             { name: "Anime",                 tag: "Animation" },
  black_cinema:      { name: "Black Cinema",          tag: "Iconic Voices" },
  comedy_standup:    { name: "Comedy & Standup",      tag: "Laugh Out Loud" },
  horror_thriller:   { name: "Horror & Thrillers",    tag: "Edge of Your Seat" },
  classic_tv:        { name: "Classic TV",            tag: "Binge-Worthy Series" },
  martial_arts_cult: { name: "Martial Arts & Cult",   tag: "Cult Classics" },
};
const catName = (c: string) => CATEGORY_META[c]?.name || c.replace(/_/g, " ");
const catTag = (c: string) => CATEGORY_META[c]?.tag || "Free to Stream";

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (ch) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch] as string));

// Round-robin across categories so every row/strip shows visual variety
// instead of five A24 posters in a clump.
function interleaveByCategory(items: PosterItem[]): PosterItem[] {
  const groups = new Map<string, PosterItem[]>();
  for (const p of items) {
    if (!groups.has(p.category)) groups.set(p.category, []);
    groups.get(p.category)!.push(p);
  }
  const lists = [...groups.values()];
  const out: PosterItem[] = [];
  for (let i = 0, added = true; added; i++) {
    added = false;
    for (const list of lists) if (i < list.length) { out.push(list[i]); added = true; }
  }
  return out;
}

const VARIED = interleaveByCategory(POSTERS);

// One representative poster per category, in first-seen order (for the hub grid).
function categoriesInOrder(): { cat: string; sample: PosterItem }[] {
  const seen = new Set<string>();
  const out: { cat: string; sample: PosterItem }[] = [];
  for (const p of POSTERS) if (!seen.has(p.category)) { seen.add(p.category); out.push({ cat: p.category, sample: p }); }
  return out;
}

// Hero marquee: 4 rows, each track's content duplicated so the -50% keyframe loops without a jump.
function buildMarquee() {
  const tracks = [1, 2, 3, 4]
    .map((n) => document.getElementById(`marqueeTrack${n}`))
    .filter(Boolean) as HTMLElement[];
  if (!tracks.length || !VARIED.length) return;
  const per = Math.ceil(VARIED.length / tracks.length);
  tracks.forEach((track, i) => {
    const slice = VARIED.slice(i * per, i * per + per);
    const row = slice.length ? slice : VARIED;
    const html = row.map((p) => `
      <div class="marquee-card">
        <img src="${esc(p.poster)}" alt="${esc(p.title)}" loading="lazy" />
        <div class="marquee-card-overlay"></div>
        <div class="marquee-card-title">${esc(p.title)}</div>
      </div>`).join("");
    track.innerHTML = html + html;
  });
}

// Category hub grid: one card per category.
function buildHubGrid() {
  const grid = document.getElementById("hubGrid");
  if (!grid) return;
  grid.innerHTML = categoriesInOrder().map(({ cat, sample }) => `
    <div class="hub-card">
      <img src="${esc(sample.poster)}" alt="${esc(catName(cat))}" loading="lazy" />
      <div class="hub-card-overlay"></div>
      <div class="hub-info">
        <div class="hub-tag">${esc(catTag(cat))}</div>
        <div class="hub-title">${esc(catName(cat))}</div>
      </div>
    </div>`).join("");
  grid.querySelectorAll(".hub-card").forEach((el) => el.addEventListener("click", openAuth));
}

// Top 10 ranked row.
function buildTop10() {
  const row = document.getElementById("top10Row");
  if (!row) return;
  row.innerHTML = VARIED.slice(0, 10).map((p, i) => `
    <div class="top10-card">
      <div class="top10-num">${i + 1}</div>
      <div class="top10-poster">
        <img src="${esc(p.poster)}" alt="${esc(p.title)}" loading="lazy" />
        <div class="top10-poster-overlay"></div>
        <div class="top10-poster-title">${esc(p.title)}</div>
      </div>
    </div>`).join("");
  row.querySelectorAll(".top10-card").forEach((el) => el.addEventListener("click", openAuth));
}

// Genre filmstrip: content duplicated so the -50% loop repeats without a jump.
function buildGenreStrip() {
  const track = document.getElementById("genreTrack");
  if (!track) return;
  const cards = VARIED.map((p) => `
    <div class="genre-card">
      <img src="${esc(p.poster)}" alt="${esc(p.title)}" loading="lazy" />
      <div class="genre-card-overlay"></div>
      <div class="genre-card-info">
        <div class="genre-tag">${esc(catTag(p.category))}</div>
        <div class="genre-title">${esc(p.title)}</div>
      </div>
    </div>`).join("");
  track.innerHTML = cards + cards;
  track.querySelectorAll(".genre-card").forEach((el) => el.addEventListener("click", openAuth));
}

buildMarquee();
buildHubGrid();
buildTop10();
buildGenreStrip();
void checkAuth();
