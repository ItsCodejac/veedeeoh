const fs = require('fs');

let authTs = fs.readFileSync('frontend/src/auth.ts', 'utf8');

const newMethods = `
/** Sign in using WebAuthn Passkeys */
export async function signInWithPasskey(): Promise<void> {
  const { data, error } = await getSupabase().auth.signInWithPasskey();
  if (error) throw error;
  if (data?.session) {
    setSession(data.session.user.email || 'user', data.session.access_token);
  }
}
`;

if (!authTs.includes('signInWithPasskey')) {
  authTs += newMethods;
  fs.writeFileSync('frontend/src/auth.ts', authTs);
}

// Update landing.html for Passkey button
let html = fs.readFileSync('frontend/landing.html', 'utf8');

// The place where we put magic link, we put Passkey button instead.
const passkeyContainerHTML = `<div id="passkeyContainer">
                <div class="auth-divider"><span>or passwordless</span></div>
                <button type="button" class="oauth-btn magic-link-btn" id="passkeyBtn">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path><path d="M12 8v4"></path><path d="M12 16h.01"></path></svg>
                  Sign In with Passkey
                </button>
              </div>`;

html = html.replace('<!-- Step 2: Password or Magic Link -->', '<!-- Step 2: Password or Passkey -->');
html = html.replace(/<div id="magicLinkContainer">.*?<\/div>/s, '');
// Since we removed it, let's insert the passkeyContainerHTML after submitBtn
html = html.replace(/<button type="submit" class="btn btn-accent auth-submit-btn" id="submitBtn">Sign In<\/button>/g, `<button type="submit" class="btn btn-accent auth-submit-btn" id="submitBtn">Sign In</button>\n              ${passkeyContainerHTML}`);
fs.writeFileSync('frontend/landing.html', html);


let ts = fs.readFileSync('frontend/landing.ts', 'utf8');
const oldMagicLinkBtn = "const magicLinkBtn = document.getElementById('magicLinkBtn') as HTMLButtonElement;";
ts = ts.replace(oldMagicLinkBtn, "const passkeyBtn = document.getElementById('passkeyBtn') as HTMLButtonElement;");
ts = ts.replace("const magicLinkContainer = document.getElementById('magicLinkContainer') as HTMLDivElement;", "const passkeyContainer = document.getElementById('passkeyContainer') as HTMLDivElement;");

ts = ts.replace(/if \(magicLinkContainer\) magicLinkContainer.style.display = 'none';/g, "if (passkeyContainer) passkeyContainer.style.display = 'none';");
ts = ts.replace(/if \(magicLinkContainer\) magicLinkContainer.style.display = 'block';/g, "if (passkeyContainer) passkeyContainer.style.display = 'block';");

const passkeyLogic = `
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
`;

// Insert after google auth btn logic
ts = ts.replace(/(if \(googleAuthBtn\) \{[\s\S]*?\}\n)/, `$1${passkeyLogic}`);
fs.writeFileSync('frontend/landing.ts', ts);

console.log("Patched for Passkeys");
