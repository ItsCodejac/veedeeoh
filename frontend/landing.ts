import { getSession, restoreSession, signIn, signUp, signInWithGoogle, signInWithPasskey, getSupabase } from './src/auth';

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

// Beta invite: ?beta=CODE grants a tier on signup. Stashed rather than redeemed
// immediately because there is no session until the account exists.
function checkBetaLink() {
  const code = new URLSearchParams(window.location.search).get('beta');
  if (code) {
    localStorage.setItem('veedeeoh_pending_beta', code);
    isSignUpMode = true;
  }
}

void loadLiveStats();
checkInviteLink();
checkBetaLink();

const navAuthBtn = document.getElementById('navAuthBtn') as HTMLButtonElement;
const authModal = document.getElementById('authModal') as HTMLDivElement;
const closeAuthBtn = document.getElementById('closeAuthBtn') as HTMLButtonElement;
const authForm = document.getElementById('authForm') as HTMLFormElement;
const emailInput = document.getElementById('emailInput') as HTMLInputElement;
const passwordInput = document.getElementById('passwordInput') as HTMLInputElement;

const authStepEmail = document.getElementById('authStepEmail') as HTMLDivElement;
const authStepPassword = document.getElementById('authStepPassword') as HTMLDivElement;
const authStepSuccess = document.getElementById('authStepSuccess') as HTMLDivElement;
const displayEmail = document.getElementById('displayEmail') as HTMLSpanElement;

const continueBtn = document.getElementById('continueBtn') as HTMLButtonElement;
const submitBtn = document.getElementById('submitBtn') as HTMLButtonElement;
const passkeyBtn = document.getElementById('passkeyBtn') as HTMLButtonElement;
const googleAuthBtn = document.getElementById('googleAuthBtn') as HTMLButtonElement;
const editEmailBtn = document.getElementById('editEmailBtn') as HTMLButtonElement;
const backToSignInBtn = document.getElementById('backToSignInBtn') as HTMLButtonElement;
const authModeToggleBtn = document.getElementById('authModeToggleBtn') as HTMLDivElement;
const passkeyContainer = document.getElementById('passkeyContainer') as HTMLDivElement;

const authTitle = document.getElementById('authTitle') as HTMLHeadingElement;
const authSubtitle = document.getElementById('authSubtitle') as HTMLParagraphElement;
const authMessage = document.getElementById('authMessage') as HTMLDivElement;
const successTitle = document.getElementById('successTitle') as HTMLHeadingElement;
const successMessage = document.getElementById('successMessage') as HTMLParagraphElement;

function renderAuthModalUI() {
  if (isSignUpMode) {
    authTitle.textContent = 'Create Account';
    authSubtitle.textContent = 'Enter your email to join the household.';
    passwordInput.placeholder = 'Create Password (min 6 chars)';
    submitBtn.textContent = 'Create Account';
    authModeToggleBtn.innerHTML = `Already have an account? <span>Sign In</span>`;
    
  } else {
    authTitle.textContent = 'Welcome Back';
    authSubtitle.textContent = 'Enter your email to access your library.';
    passwordInput.placeholder = 'Password';
    submitBtn.textContent = 'Sign In';
    authModeToggleBtn.innerHTML = `New user invited by family? <span>Create Account</span>`;
    
  }
}

function showStep(step: 'email' | 'password' | 'success') {
  authStepEmail.classList.remove('active');
  authStepPassword.classList.remove('active');
  authStepSuccess.classList.remove('active');
  
  if (step === 'email') {
    authStepEmail.classList.add('active');
    setTimeout(() => emailInput.focus(), 50);
  } else if (step === 'password') {
    authStepPassword.classList.add('active');
    setTimeout(() => passwordInput.focus(), 50);
  } else if (step === 'success') {
    authStepSuccess.classList.add('active');
  }
}

function openAuth() {
  if (!authModal) return;
  renderAuthModalUI();
  authModal.style.display = 'flex';
  showStep('email');
  
  // Trigger animation
  setTimeout(() => {
    authModal.classList.add('show');
    emailInput.focus();
  }, 10);
}

function openAuthSignup() {
  isSignUpMode = true;
  openAuth();
}

function closeAuth() {
  if (!authModal) return;
  authModal.classList.remove('show');
  setTimeout(() => {
    authModal.style.display = 'none';
    authMessage.style.display = 'none';
    authForm.reset();
  }, 300); // Wait for transition
}

if (navAuthBtn) navAuthBtn.addEventListener('click', openAuth);
if (closeAuthBtn) closeAuthBtn.addEventListener('click', closeAuth);
document.getElementById('heroTrialBtn')?.addEventListener('click', openAuthSignup);
document.getElementById('pricingTrialBtn')?.addEventListener('click', openAuthSignup);
document.getElementById('heroSignInBtn')?.addEventListener('click', openAuth);

if (authModal) {
  authModal.addEventListener('click', (e) => {
    if (e.target === authModal) closeAuth();
  });
}

if (authModeToggleBtn) {
  authModeToggleBtn.addEventListener('click', () => {
    isSignUpMode = !isSignUpMode;
    renderAuthModalUI();
  });
}

if (editEmailBtn) {
  editEmailBtn.addEventListener('click', () => {
    authMessage.style.display = 'none';
    showStep('email');
  });
}

if (backToSignInBtn) {
  backToSignInBtn.addEventListener('click', () => {
    authMessage.style.display = 'none';
    isSignUpMode = false;
    renderAuthModalUI();
    showStep('email');
  });
}

if (continueBtn) {
  continueBtn.addEventListener('click', (e) => {
    e.preventDefault();
    const email = emailInput.value.trim();
    if (!email) {
      emailInput.reportValidity();
      return;
    }
    displayEmail.textContent = email;
    authMessage.style.display = 'none';
    showStep('password');
  });
}

if (googleAuthBtn) {
  googleAuthBtn.addEventListener('click', async () => {
    const originalText = googleAuthBtn.innerHTML;
    googleAuthBtn.disabled = true; 
    googleAuthBtn.innerHTML = 'Redirecting...';
    try { 
      await signInWithGoogle(); 
    } catch (e: any) {
      authMessage.textContent = e?.message || 'Google sign-in failed'; 
      authMessage.style.display = 'block';
      googleAuthBtn.disabled = false; 
      googleAuthBtn.innerHTML = originalText;
    }
  });
}

if (passkeyBtn) {
  passkeyBtn.addEventListener('click', async () => {
    passkeyBtn.disabled = true;
    const originalText = passkeyBtn.innerHTML;
    passkeyBtn.innerHTML = 'Prompting...';
    try {
      await signInWithPasskey();
      showStep('success');
      successTitle.textContent = 'Welcome Back';
      successMessage.textContent = 'Passkey verified successfully. Redirecting...';
      setTimeout(() => {
        window.location.href = '/index.html';
      }, 1000);
    } catch (e: any) {
      authMessage.textContent = e?.message || 'Passkey sign-in failed. You may need to enroll a passkey first in your account settings.';
      authMessage.style.display = 'block';
    } finally {
      passkeyBtn.disabled = false;
      passkeyBtn.innerHTML = originalText;
    }
  });
}



if (authForm) {
  authForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = emailInput.value.trim();
    const password = passwordInput?.value || '';

    if (!email || !password) {
      authMessage.style.display = 'block';
      authMessage.textContent = 'Please provide both email and password.';
      return;
    }

    submitBtn.disabled = true;
    const originalText = submitBtn.textContent;
    submitBtn.textContent = isSignUpMode ? 'Creating Account...' : 'Verifying...';
    
    try {
      if (isSignUpMode) {
        await signUp(email, password);
        // Redeem a beta invite now that a session exists. Best effort: a failed
        // redemption must never block an account that was created successfully.
        const betaCode = localStorage.getItem('veedeeoh_pending_beta');
        if (betaCode) {
          try {
            await getSupabase().rpc('redeem_beta_invite', { invite_code: betaCode });
            localStorage.removeItem('veedeeoh_pending_beta');
          } catch (err) { console.warn('[beta] redeem failed', err); }
        }
        showStep('success');
        successTitle.textContent = 'Account Created';
        successMessage.textContent = 'Account created successfully. Redirecting to your dashboard...';
        setTimeout(() => {
          window.location.href = '/index.html';
        }, 1500);
      } else {
        const { mustChangePassword } = await signIn(email, password);
        showStep('success');
        successTitle.textContent = 'Welcome Back';
        if (mustChangePassword) {
          successMessage.textContent = 'Access granted! Redirecting to set a new password...';
          setTimeout(() => {
            window.location.href = '/change-password.html';
          }, 1000);
        } else {
          successMessage.textContent = 'Access granted! Redirecting...';
          setTimeout(() => {
            window.location.href = '/index.html';
          }, 1000);
        }
      }
    } catch (e: any) {
      authMessage.style.display = 'block';
      authMessage.textContent = e?.message || 'Authentication failed.';
      submitBtn.disabled = false;
      submitBtn.textContent = originalText;
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
    for (const list of lists) {
      const item = list[i];
      if (item) { out.push(item); added = true; }
    }
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