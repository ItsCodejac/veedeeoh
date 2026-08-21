const fs = require('fs');

// 1. Patch landing.html
let html = fs.readFileSync('frontend/landing.html', 'utf8');

const oldCSS = `      /* Auth Modal */
      #authModal {
        display: none;
        position: fixed;
        inset: 0;
        z-index: 1000;
        background: rgba(4, 5, 8, 0.88);
        backdrop-filter: blur(14px);
        align-items: center;
        justify-content: center;
        padding: 16px;
      }

      .modal-box {
        background: var(--card-bg);
        border: 1px solid var(--border);
        border-radius: 16px;
        padding: 32px 28px;
        width: 100%;
        max-width: 420px;
        position: relative;
        box-sizing: border-box;
      }

      .close-btn {
        position: absolute;
        top: 20px;
        right: 20px;
        background: none;
        border: none;
        color: var(--dim);
        font-size: 24px;
        cursor: pointer;
      }

      .modal-box h2 {
        font-family: var(--display);
        font-size: 1.8rem;
        margin: 0 0 8px;
      }

      .modal-box p {
        color: var(--dim);
        font-size: 14px;
        margin: 0 0 24px;
      }`;

const newCSS = `      /* Premium Auth Modal */
      #authModal {
        display: none;
        position: fixed;
        inset: 0;
        z-index: 1000;
        background: rgba(4, 5, 8, 0.95);
        backdrop-filter: blur(24px);
        -webkit-backdrop-filter: blur(24px);
        align-items: center;
        justify-content: center;
        padding: 16px;
        opacity: 0;
        transition: opacity 0.3s ease;
      }
      #authModal.show {
        opacity: 1;
      }

      .auth-container {
        width: 100%;
        max-width: 440px;
        position: relative;
        z-index: 10;
        transform: translateY(20px);
        transition: transform 0.4s cubic-bezier(0.16, 1, 0.3, 1);
      }
      #authModal.show .auth-container {
        transform: translateY(0);
      }

      .auth-glass-box {
        background: linear-gradient(180deg, rgba(20,22,28,0.7) 0%, rgba(10,12,16,0.8) 100%);
        border: 1px solid rgba(255,255,255,0.08);
        border-radius: 24px;
        padding: 48px 40px;
        box-shadow: 0 24px 64px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.05);
        box-sizing: border-box;
        overflow: hidden;
        position: relative;
      }

      .auth-glow {
        position: absolute;
        top: -100px;
        left: 50%;
        transform: translateX(-50%);
        width: 200px;
        height: 100px;
        background: var(--accent);
        filter: blur(80px);
        opacity: 0.15;
        border-radius: 50%;
        pointer-events: none;
      }

      .close-btn {
        position: absolute;
        top: 24px;
        right: 24px;
        background: rgba(255,255,255,0.05);
        border: 1px solid rgba(255,255,255,0.1);
        border-radius: 50%;
        width: 32px;
        height: 32px;
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--dim);
        font-size: 20px;
        cursor: pointer;
        transition: all 0.2s;
        z-index: 20;
      }
      .close-btn:hover {
        background: rgba(255,255,255,0.1);
        color: #fff;
        transform: scale(1.05);
      }

      .auth-header {
        text-align: center;
        margin-bottom: 32px;
      }
      
      .auth-logo {
        font-family: var(--display);
        font-size: 28px;
        font-weight: 800;
        letter-spacing: -0.04em;
        margin-bottom: 24px;
        display: inline-block;
      }
      .auth-logo span {
        color: var(--accent);
      }

      .auth-header h2 {
        font-family: var(--display);
        font-size: 2rem;
        font-weight: 700;
        margin: 0 0 8px;
        letter-spacing: -0.02em;
      }

      .auth-header p {
        color: var(--dim);
        font-size: 15px;
        margin: 0;
        line-height: 1.5;
      }

      .auth-step {
        display: none;
        animation: fadeInStep 0.3s ease forwards;
      }
      .auth-step.active {
        display: block;
      }

      @keyframes fadeInStep {
        from { opacity: 0; transform: translateY(10px); }
        to { opacity: 1; transform: translateY(0); }
      }

      .auth-input {
        width: 100%;
        padding: 16px;
        font-size: 16px;
        border-radius: 12px;
        border: 1px solid rgba(255,255,255,0.1);
        background: rgba(0,0,0,0.3);
        color: #fff;
        outline: none;
        box-sizing: border-box;
        transition: all 0.2s;
        font-family: 'Instrument Sans', sans-serif;
        margin-bottom: 16px;
      }
      .auth-input:focus {
        border-color: var(--accent);
        background: rgba(0,0,0,0.5);
        box-shadow: 0 0 0 4px rgba(197, 240, 78, 0.1);
      }

      .auth-email-badge {
        display: flex;
        align-items: center;
        justify-content: space-between;
        background: rgba(255,255,255,0.05);
        border: 1px solid rgba(255,255,255,0.1);
        padding: 12px 16px;
        border-radius: 12px;
        margin-bottom: 20px;
        font-size: 15px;
      }
      .auth-email-badge span {
        color: #fff;
        font-weight: 500;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .auth-edit-btn {
        background: none;
        border: none;
        color: var(--accent);
        font-size: 14px;
        font-weight: 600;
        cursor: pointer;
        padding: 0;
      }
      .auth-edit-btn:hover {
        text-decoration: underline;
      }

      .auth-submit-btn {
        width: 100%;
        padding: 16px;
        font-size: 16px;
        font-weight: 600;
        border-radius: 12px;
        margin-top: 8px;
        display: flex;
        justify-content: center;
        align-items: center;
        gap: 8px;
        cursor: pointer;
      }

      .auth-divider {
        display: flex;
        align-items: center;
        text-align: center;
        margin: 24px 0;
        color: rgba(255,255,255,0.3);
        font-size: 13px;
        text-transform: uppercase;
        letter-spacing: 0.1em;
      }
      .auth-divider::before, .auth-divider::after {
        content: '';
        flex: 1;
        border-bottom: 1px solid rgba(255,255,255,0.1);
      }
      .auth-divider span {
        padding: 0 16px;
      }

      .oauth-btn {
        width: 100%;
        padding: 14px;
        font-size: 15px;
        font-weight: 600;
        border-radius: 12px;
        background: rgba(255,255,255,0.03);
        border: 1px solid rgba(255,255,255,0.1);
        color: #fff;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 12px;
        cursor: pointer;
        transition: all 0.2s;
        font-family: 'Instrument Sans', sans-serif;
      }
      .oauth-btn:hover {
        background: rgba(255,255,255,0.08);
        border-color: rgba(255,255,255,0.2);
      }
      .oauth-btn svg {
        width: 20px;
        height: 20px;
      }

      .magic-link-btn {
        background: rgba(197, 240, 78, 0.05);
        color: var(--accent);
        border-color: rgba(197, 240, 78, 0.2);
      }
      .magic-link-btn:hover {
        background: rgba(197, 240, 78, 0.1);
        border-color: rgba(197, 240, 78, 0.4);
      }

      .success-icon {
        width: 64px;
        height: 64px;
        border-radius: 50%;
        background: rgba(197, 240, 78, 0.1);
        display: flex;
        align-items: center;
        justify-content: center;
        margin: 0 auto 24px;
      }
      
      .auth-mode-toggle {
        margin-top: 24px;
        text-align: center;
        font-size: 14px;
        color: var(--dim);
        cursor: pointer;
      }
      .auth-mode-toggle span {
        color: var(--accent);
      }
      .auth-mode-toggle span:hover {
        text-decoration: underline;
      }`;

html = html.replace(oldCSS, newCSS);

const oldHTML = `    <!-- Auth Modal -->
    <div id="authModal">
      <div class="modal-box">
        <button class="close-btn" id="closeAuthBtn">&times;</button>
        <h2>Sign In</h2>
        <p>Enter your email and password to access your library.</p>
        <form id="authForm">
          <div style="margin-bottom: 14px;">
            <input type="email" id="emailInput" placeholder="Email address" required style="width: 100%; padding: 14px; font-size: 16px; border-radius: 8px; border: 1px solid var(--border); background: var(--bg); color: #fff; outline: none; box-sizing: border-box;" />
          </div>
          <div style="margin-bottom: 20px;">
            <input type="password" id="passwordInput" placeholder="Password" required style="width: 100%; padding: 14px; font-size: 16px; border-radius: 8px; border: 1px solid var(--border); background: var(--bg); color: #fff; outline: none; box-sizing: border-box;" />
          </div>
          <button type="submit" class="btn btn-accent" id="submitBtn" style="width: 100%; padding: 14px;">Sign In &gt;</button>
        </form>
        <div id="authMessage" style="margin-top: 16px; font-size: 14px; text-align: center; color: var(--accent); display: none;"></div>
      </div>
    </div>`;

const newHTML = `    <!-- Premium Auth Modal -->
    <div id="authModal">
      <div class="auth-container">
        <div class="auth-glass-box">
          <div class="auth-glow"></div>
          <button class="close-btn" id="closeAuthBtn">&times;</button>
          
          <div class="auth-header">
            <div class="auth-logo">veedeeoh<span>.</span></div>
            <h2 id="authTitle">Sign In</h2>
            <p id="authSubtitle">Enter your email to access your library.</p>
          </div>

          <form id="authForm">
            <!-- Step 1: Email -->
            <div id="authStepEmail" class="auth-step active">
              <input type="email" class="auth-input" id="emailInput" placeholder="Email address" required />
              <button type="button" class="btn btn-accent auth-submit-btn" id="continueBtn">Continue</button>
              
              <div id="oauthContainer">
                <div class="auth-divider"><span>or continue with</span></div>
                <button type="button" class="oauth-btn" id="googleAuthBtn">
                  <svg width="20" height="20" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
                  Google
                </button>
              </div>
              
              <div class="auth-mode-toggle" id="authModeToggleBtn">
                New user invited by family? <span>Create Account</span>
              </div>
            </div>

            <!-- Step 2: Password or Magic Link -->
            <div id="authStepPassword" class="auth-step">
              <div class="auth-email-badge">
                <span id="displayEmail">user@example.com</span>
                <button type="button" class="auth-edit-btn" id="editEmailBtn">Edit</button>
              </div>
              
              <input type="password" class="auth-input" id="passwordInput" placeholder="Password" />
              
              <button type="submit" class="btn btn-accent auth-submit-btn" id="submitBtn">Sign In</button>
              
              <div id="magicLinkContainer">
                <div class="auth-divider"><span>or passwordless</span></div>
                <button type="button" class="oauth-btn magic-link-btn" id="magicLinkBtn">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.2 8.4c.5.5.5 1.4 0 1.9l-7 7c-.5.5-1.4.5-1.9 0l-5-5c-.5-.5-.5-1.4 0-1.9l7-7c.5-.5 1.4-.5 1.9 0l5 5z"></path><path d="M6 18h.01"></path><path d="M10 14h.01"></path><path d="M15 9h.01"></path><path d="M18 6h.01"></path></svg>
                  Email me a Magic Link
                </button>
              </div>
            </div>

            <!-- Step 3: Success / Check Email -->
            <div id="authStepSuccess" class="auth-step" style="text-align: center;">
              <div class="success-icon">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
              </div>
              <h3 id="successTitle" style="font-family: var(--display); font-size: 24px; margin: 0 0 12px;">Check your inbox</h3>
              <p id="successMessage" style="color: var(--dim); margin: 0 0 32px; line-height: 1.5;">We've sent a magic link to your email. Click it to log in securely.</p>
              <button type="button" class="oauth-btn" id="backToSignInBtn">Return to Sign In</button>
            </div>
            
            <div id="authMessage" style="margin-top: 16px; font-size: 14px; text-align: center; color: #ff8a8a; display: none;"></div>
          </form>
        </div>
      </div>
    </div>`;

html = html.replace(oldHTML, newHTML);
fs.writeFileSync('frontend/landing.html', html);
console.log('Patched landing.html successfully');
