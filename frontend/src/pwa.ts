let deferredPrompt: any = null;

export function initPWA(): void {
  const isStandalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as any).standalone === true;

  if (isStandalone) {
    return;
  }

  // Chrome fires beforeinstallprompt; Firefox desktop never will, since it does
  // not implement PWA install at all. iOS Safari does not either, hence the
  // manual how-to modal below.
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    showInstallEntry();
  });

  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;
  if (isIOS) showInstallEntry();

  injectIOSModal();
}

/** A quiet, persistent entry in the sidebar directly above the profile, rather
 *  than a banner that covers content. It was interrupting on every load; an
 *  install prompt is not urgent enough to earn that. Dismissing hides it for
 *  good, and it never appears once the app is already installed. */
export function showInstallEntry(): void {
  if (document.getElementById('pwaInstallEntry')) return;
  if (localStorage.getItem('veedeeoh_pwa_dismissed')) return;

  const sidebarUser = document.getElementById('sidebarUser');
  if (!sidebarUser || !sidebarUser.parentElement) return;

  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;

  const entry = document.createElement('div');
  entry.id = 'pwaInstallEntry';
  entry.className = 'sidebar-install';
  entry.innerHTML = `
    <button class="sidebar-install-main" id="pwaInstallBtn" title="Install veedeeoh. as an app">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
      <span>${isIOS ? 'Add to Home Screen' : 'Install app'}</span>
    </button>
    <button class="sidebar-install-dismiss" id="pwaDismissBtn" title="Don't show again" aria-label="Dismiss">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
    </button>`;

  sidebarUser.parentElement.insertBefore(entry, sidebarUser);

  document.getElementById('pwaInstallBtn')?.addEventListener('click', () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      deferredPrompt.userChoice.then((choice: any) => {
        if (choice.outcome === 'accepted') entry.remove();
        deferredPrompt = null;
      });
    } else {
      openIOSModal();
    }
  });

  document.getElementById('pwaDismissBtn')?.addEventListener('click', () => {
    localStorage.setItem('veedeeoh_pwa_dismissed', '1');
    entry.remove();
  });
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
