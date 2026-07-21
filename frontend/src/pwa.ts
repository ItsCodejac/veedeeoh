let deferredPrompt: any = null;

export function initPWA(): void {
  const isStandalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as any).standalone === true;

  if (isStandalone) {
    return;
  }

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    showPWABanner();
  });

  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;
  const dismissed = localStorage.getItem('veedeeoh_pwa_dismissed');

  if (!dismissed) {
    setTimeout(() => {
      if (isIOS || deferredPrompt) {
        showPWABanner();
      }
    }, 2000);
  }

  injectIOSModal();
}

export function showPWABanner(): void {
  if (document.getElementById('pwaInstallBanner')) return;

  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;

  const banner = document.createElement('div');
  banner.id = 'pwaInstallBanner';
  banner.className = 'pwa-install-banner';
  banner.innerHTML = `
    <div class="pwa-banner-icon">
      <img src="/icon-192.png" alt="veedeeoh.">
    </div>
    <div class="pwa-banner-text">
      <strong>Install veedeeoh.</strong>
      <span>Add to Home Screen for fast, full-screen playback</span>
    </div>
    <div class="pwa-banner-actions">
      <button id="pwaInstallBtn" class="pwa-install-btn">${isIOS ? 'Add to Home' : 'Install'}</button>
      <button id="pwaDismissBtn" class="pwa-dismiss-btn" title="Close">✕</button>
    </div>
  `;

  document.body.appendChild(banner);

  const installBtn = document.getElementById('pwaInstallBtn');
  const dismissBtn = document.getElementById('pwaDismissBtn');

  if (installBtn) {
    installBtn.addEventListener('click', () => {
      if (deferredPrompt) {
        deferredPrompt.prompt();
        deferredPrompt.userChoice.then((choice: any) => {
          if (choice.outcome === 'accepted') {
            banner.remove();
          }
          deferredPrompt = null;
        });
      } else if (isIOS) {
        openIOSModal();
      } else {
        openIOSModal();
      }
    });
  }

  if (dismissBtn) {
    dismissBtn.addEventListener('click', () => {
      localStorage.setItem('veedeeoh_pwa_dismissed', '1');
      banner.remove();
    });
  }
}

function injectIOSModal(): void {
  if (document.getElementById('iosInstallModal')) return;

  const modal = document.createElement('div');
  modal.id = 'iosInstallModal';
  modal.className = 'ios-install-modal';
  modal.hidden = true;
  modal.innerHTML = `
    <div class="ios-modal-backdrop" id="iosModalBackdrop"></div>
    <div class="ios-modal-card">
      <button class="ios-modal-close" id="iosModalClose">✕</button>
      <div class="ios-modal-header">
        <img src="/icon-192.png" alt="veedeeoh.">
        <div>
          <h3>Install veedeeoh.</h3>
          <p>Add to your home screen</p>
        </div>
      </div>
      <ol class="ios-steps">
        <li>
          <span class="step-num">1</span>
          <div class="step-text">
            <span>Tap the <strong>Share</strong> icon in Safari's bottom toolbar:</span>
          </div>
          <div class="step-icon">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>
          </div>
        </li>
        <li>
          <span class="step-num">2</span>
          <div class="step-text">
            <span>Scroll down the sheet and select <strong>Add to Home Screen</strong>:</span>
          </div>
          <div class="step-icon">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="4"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>
          </div>
        </li>
        <li>
          <span class="step-num">3</span>
          <div class="step-text">
            <span>Tap <strong>Add</strong> in top right. Launch anytime from your home screen!</span>
          </div>
        </li>
      </ol>
      <button class="ios-modal-done" id="iosModalDone">Got It</button>
    </div>
  `;

  document.body.appendChild(modal);

  const backdrop = document.getElementById('iosModalBackdrop');
  const closeBtn = document.getElementById('iosModalClose');
  const doneBtn = document.getElementById('iosModalDone');

  const close = () => { modal.hidden = true; };

  if (backdrop) backdrop.addEventListener('click', close);
  if (closeBtn) closeBtn.addEventListener('click', close);
  if (doneBtn) doneBtn.addEventListener('click', close);
}

export function openIOSModal(): void {
  const modal = document.getElementById('iosInstallModal');
  if (modal) {
    modal.hidden = false;
  }
}
