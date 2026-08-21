const fs = require('fs');
let ts = fs.readFileSync('frontend/landing.ts', 'utf8');

// The auth block starts here:
// const navAuthBtn = document.getElementById('navAuthBtn') as HTMLButtonElement;
// And ends at the end of the file.

const oldAuthBlock = ts.substring(ts.indexOf('const navAuthBtn = document.getElementById(\'navAuthBtn\')'));

const newAuthBlock = `const navAuthBtn = document.getElementById('navAuthBtn') as HTMLButtonElement;
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
const magicLinkBtn = document.getElementById('magicLinkBtn') as HTMLButtonElement;
const googleAuthBtn = document.getElementById('googleAuthBtn') as HTMLButtonElement;
const editEmailBtn = document.getElementById('editEmailBtn') as HTMLButtonElement;
const backToSignInBtn = document.getElementById('backToSignInBtn') as HTMLButtonElement;
const authModeToggleBtn = document.getElementById('authModeToggleBtn') as HTMLDivElement;
const magicLinkContainer = document.getElementById('magicLinkContainer') as HTMLDivElement;

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
    authModeToggleBtn.innerHTML = \`Already have an account? <span>Sign In</span>\`;
    if (magicLinkContainer) magicLinkContainer.style.display = 'none';
  } else {
    authTitle.textContent = 'Welcome Back';
    authSubtitle.textContent = 'Enter your email to access your library.';
    passwordInput.placeholder = 'Password';
    submitBtn.textContent = 'Sign In';
    authModeToggleBtn.innerHTML = \`New user invited by family? <span>Create Account</span>\`;
    if (magicLinkContainer) magicLinkContainer.style.display = 'block';
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

if (magicLinkBtn) {
  magicLinkBtn.addEventListener('click', async () => {
    const email = emailInput.value.trim();
    if (!email) return;
    
    magicLinkBtn.disabled = true;
    const originalText = magicLinkBtn.innerHTML;
    magicLinkBtn.innerHTML = 'Sending link...';
    
    try {
      await signInWithMagicLink(email);
      showStep('success');
      successTitle.textContent = 'Check your inbox';
      successMessage.textContent = \`We've sent a magic link to \${email}. Click it to log in securely.\`;
    } catch (e: any) {
      authMessage.textContent = e?.message || 'Failed to send magic link';
      authMessage.style.display = 'block';
    } finally {
      magicLinkBtn.disabled = false;
      magicLinkBtn.innerHTML = originalText;
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
}`;

ts = ts.replace(oldAuthBlock, newAuthBlock);
fs.writeFileSync('frontend/landing.ts', ts);
console.log('Patched landing.ts successfully');
