const fs = require('fs');

// Patch HTML
let html = fs.readFileSync('frontend/landing.html', 'utf8');
const oldMagicLinkHTML = `<div id="magicLinkContainer">
                <div class="auth-divider"><span>or passwordless</span></div>
                <button type="button" class="oauth-btn magic-link-btn" id="magicLinkBtn">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.2 8.4c.5.5.5 1.4 0 1.9l-7 7c-.5.5-1.4.5-1.9 0l-5-5c-.5-.5-.5-1.4 0-1.9l7-7c.5-.5 1.4-.5 1.9 0l5 5z"></path><path d="M6 18h.01"></path><path d="M10 14h.01"></path><path d="M15 9h.01"></path><path d="M18 6h.01"></path></svg>
                  Email me a Magic Link
                </button>
              </div>`;
html = html.replace(oldMagicLinkHTML, '');

const oldSuccessHTML = `            <!-- Step 3: Success / Check Email -->
            <div id="authStepSuccess" class="auth-step" style="text-align: center;">
              <div class="success-icon">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
              </div>
              <h3 id="successTitle" style="font-family: var(--display); font-size: 24px; margin: 0 0 12px;">Check your inbox</h3>
              <p id="successMessage" style="color: var(--dim); margin: 0 0 32px; line-height: 1.5;">We've sent a magic link to your email. Click it to log in securely.</p>
              <button type="button" class="oauth-btn" id="backToSignInBtn">Return to Sign In</button>
            </div>`;

// Keep Step 3 for Sign Up Success and Password Reset (if we add it later)
// Wait, I will keep Step 3 but just modify the JS.

fs.writeFileSync('frontend/landing.html', html);

// Patch TS
let ts = fs.readFileSync('frontend/landing.ts', 'utf8');
const oldMagicLinkLogic = `if (magicLinkBtn) {
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
}`;
ts = ts.replace(oldMagicLinkLogic, '');
ts = ts.replace("if (magicLinkContainer) magicLinkContainer.style.display = 'none';", "");
ts = ts.replace("if (magicLinkContainer) magicLinkContainer.style.display = 'block';", "");

fs.writeFileSync('frontend/landing.ts', ts);

console.log('Removed Magic Links');
