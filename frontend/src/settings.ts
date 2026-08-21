import { getStoredProfiles, openProfileEditor, getActiveProfile } from './profiles';
import { getSession } from './auth';
import { startCheckout, openBillingPortal, createInvite } from './db';

export function openSettingsModal(): void {
  renderSettingsModalInternal();
}

function renderSettingsModalInternal(): void {
  const existing = document.getElementById('settingsModal');
  if (existing) existing.remove();

  const session = getSession();
  const profiles = getStoredProfiles();
  const activeProfile = getActiveProfile();

  const defaultAccName = (session && session.email) ? session.email.split('@')[0]! : 'My Household';
  const accName = localStorage.getItem('veedeeoh_account_name') || defaultAccName;

  // Pending invites
  let pendingInvites: any[] = [];
  try {
    const raw = localStorage.getItem('veedeeoh_pending_invites') || '[]';
    pendingInvites = JSON.parse(raw);
  } catch {
    pendingInvites = [];
  }

  const modal = document.createElement('div');
  modal.id = 'settingsModal';
  modal.style.cssText = `
    position: fixed; inset: 0; background: rgba(6,7,10,0.92);
    backdrop-filter: blur(20px); z-index: 9999;
    display: flex; align-items: center; justify-content: center; padding: 20px;
    color: #fff; font-family: 'Space Grotesk', sans-serif;
  `;

  modal.innerHTML = `
    <div style="background: #10141e; border: 1px solid rgba(255,255,255,0.15); border-radius: 24px; max-width: 620px; width: 100%; padding: 32px; box-shadow: 0 24px 60px rgba(0,0,0,0.9); max-height: 90vh; overflow-y: auto;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 16px;">
        <h2 style="margin: 0; font-size: 24px; font-weight: 800; display: inline-flex; align-items: center; gap: 10px;">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
          <span>Household Settings</span>
        </h2>
        <button id="closeSettingsBtn" style="background: none; border: none; color: #9aa5b5; font-size: 24px; cursor: pointer;">✕</button>
      </div>

      <!-- Account Info & Name -->
      <!-- Account Info & Name -->
      <div style="background: #080a10; border: 1px solid rgba(255,255,255,0.1); border-radius: 16px; padding: 20px; margin-bottom: 24px;">
        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px;">
          <div>
            <div style="font-size: 12px; color: #9aa5b5; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 4px;">CURRENT ACCOUNT</div>
            <div style="font-size: 18px; font-weight: 700; color: #fff;">${session ? escapeHtml(session.email) : 'Local / Self-Hosted Guest'}</div>
            <div style="font-size: 12px; color: #06d6a0; font-weight: 700; margin-top: 4px;">Role: ${activeProfile.role === 'owner' ? 'Account Owner (Admin)' : 'Household Member'}</div>
          </div>
        </div>
        <div>
          <label style="display: block; font-size: 12px; color: #9aa5b5; margin-bottom: 6px; font-weight: 700;">HOUSEHOLD / ACCOUNT DISPLAY NAME</label>
          <input type="text" id="accountDisplayName" value="${escapeHtml(accName)}" placeholder="e.g. Cojac's Household" style="width: 100%; padding: 10px 14px; background: #10141e; border: 1px solid rgba(255,255,255,0.15); border-radius: 8px; color: #fff; font-size: 14px; outline: none;" />
        </div>
      </div>

      <!-- Subscription & Billing -->
      <div style="margin-bottom: 24px;">
        <h3 style="margin: 0 0 14px; font-size: 18px; font-weight: 700;">Subscription & Billing</h3>
        
        <!-- Premium Active Plan Card -->
        <div style="background: linear-gradient(145deg, rgba(197,240,78,0.1) 0%, rgba(6,7,10,0) 100%), #080a10; border: 1px solid rgba(197,240,78,0.3); border-radius: 16px; padding: 24px; position: relative; overflow: hidden; margin-bottom: 16px;">
          <div style="position: absolute; top: -50px; right: -50px; width: 150px; height: 150px; background: rgba(197,240,78,0.15); filter: blur(50px); border-radius: 50%;"></div>
          
          <div style="display: flex; justify-content: space-between; align-items: flex-start; position: relative; z-index: 1;">
            <div>
              <div style="display: inline-flex; align-items: center; gap: 6px; background: rgba(197,240,78,0.2); border: 1px solid rgba(197,240,78,0.4); padding: 4px 12px; border-radius: 20px; color: #c5f04e; font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 12px;">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"></path></svg>
                Pro Cloud Tier
              </div>
              <div style="font-size: 28px; font-weight: 800; color: #fff; margin-bottom: 4px;">$4.00<span style="font-size: 14px; color: #9aa5b5; font-weight: 600;"> / month</span></div>
              <div style="font-size: 13px; color: #9aa5b5;">Renews on August 28, 2026</div>
            </div>
          </div>

          <div style="margin-top: 20px; padding-top: 20px; border-top: 1px solid rgba(255,255,255,0.1); position: relative; z-index: 1;">
            <ul style="margin: 0 0 20px; padding: 0; list-style: none; display: grid; grid-template-columns: 1fr 1fr; gap: 10px; font-size: 13px; color: #d1d5db;">
              <li style="display: flex; align-items: center; gap: 8px;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#06d6a0" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg> 4K HDR Streaming</li>
              <li style="display: flex; align-items: center; gap: 8px;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#06d6a0" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg> 3 Household Profiles</li>
              <li style="display: flex; align-items: center; gap: 8px;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#06d6a0" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg> Watch Party Included</li>
              <li style="display: flex; align-items: center; gap: 8px;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#06d6a0" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg> 4 Concurrent Streams</li>
            </ul>

            <div style="display: flex; gap: 12px;">
              <button id="btnManageBilling" style="flex: 2; padding: 12px; border-radius: 10px; background: #c5f04e; color: #06070a; border: none; font-weight: 800; font-size: 14px; cursor: pointer; transition: opacity 0.2s;">Change Plan</button>
              <button id="btnCancelBilling" style="flex: 1; padding: 12px; border-radius: 10px; background: rgba(255,255,255,0.05); color: #9aa5b5; border: 1px solid rgba(255,255,255,0.1); font-weight: 700; font-size: 14px; cursor: pointer; transition: background 0.2s;">Cancel</button>
            </div>
          </div>
        </div>

        <!-- Available Add-ons -->
        <h4 style="margin: 0 0 12px; font-size: 14px; color: #9aa5b5; font-weight: 700; text-transform: uppercase; letter-spacing: 1px;">Available Add-ons</h4>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
          <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; padding: 16px; display: flex; flex-direction: column; justify-content: space-between;">
            <div>
              <div style="font-weight: 700; font-size: 14px; color: #fff; margin-bottom: 4px;">+1 Additional Profile</div>
              <div style="font-size: 12px; color: #9aa5b5; margin-bottom: 12px;">Expand your household beyond the included 3 profiles.</div>
            </div>
            <button class="addonBtn" style="width: 100%; padding: 8px; border-radius: 8px; background: rgba(255,255,255,0.1); border: none; color: #fff; font-weight: 700; font-size: 13px; cursor: pointer;">Add — $1.50/mo</button>
          </div>
          <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; padding: 16px; display: flex; flex-direction: column; justify-content: space-between;">
            <div>
              <div style="font-weight: 700; font-size: 14px; color: #fff; margin-bottom: 4px;">+10GB Watch Party Storage</div>
              <div style="font-size: 12px; color: #9aa5b5; margin-bottom: 12px;">Extra Cloudflare storage for hosting seamless Watch Parties without egress fees.</div>
            </div>
            <button class="addonBtn" style="width: 100%; padding: 8px; border-radius: 8px; background: rgba(255,255,255,0.1); border: none; color: #fff; font-weight: 700; font-size: 13px; cursor: pointer;">Add — $TBD/mo</button>
          </div>
        </div>
      </div>

      <!-- Household Profiles -->
      <div style="margin-bottom: 24px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px;">
          <h3 style="margin: 0; font-size: 18px; font-weight: 700;">Household Profiles</h3>
          <button id="settingsAddProfileBtn" style="background: #c5f04e; color: #06070a; border: none; padding: 6px 14px; border-radius: 8px; font-weight: 700; font-size: 13px; cursor: pointer;">+ Add Profile</button>
        </div>
        <div style="display: flex; flex-direction: column; gap: 10px;">
          ${profiles.map(p => `
            <div style="display: flex; align-items: center; justify-content: space-between; background: #080a10; border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; padding: 12px 16px;">
              <div style="display: flex; align-items: center; gap: 12px;">
                <div style="width: 36px; height: 36px; border-radius: 8px; background: ${p.avatar_color}; display: flex; align-items: center; justify-content: center; font-weight: 800; color: #06070a;">
                  ${p.name.charAt(0).toUpperCase()}
                </div>
                <div>
                  <div style="font-weight: 700; font-size: 15px;">${escapeHtml(p.name)} ${p.id === activeProfile.id ? '<span style="color: #c5f04e; font-size: 12px;">(Active)</span>' : ''}</div>
                  <div style="font-size: 12px; color: #9aa5b5;">Standard Profile</div>
                </div>
              </div>
              <button class="settingsEditProfileBtn" data-id="${p.id}" style="background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.15); color: #fff; padding: 6px 12px; border-radius: 8px; font-size: 13px; cursor: pointer;">Edit</button>
            </div>
          `).join('')}
        </div>
      </div>

      <!-- Anti-Netflix Direct Link Member Sharing -->
      <div style="margin-bottom: 24px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
          <div>
            <h3 style="margin: 0; font-size: 18px; font-weight: 700;">🤝 Non-Geolocked Direct Invites</h3>
            <div style="font-size: 12px; color: #06d6a0; font-weight: 700;">Zero IP locks. Generate & text/email direct links to family anywhere.</div>
          </div>
        </div>
        <div style="background: #080a10; border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; padding: 16px;">
          <p style="margin: 0 0 12px; font-size: 13px; color: #9aa5b5;">Generate a direct non-geolocked invitation link for family members or roommates:</p>
          <div style="display: flex; gap: 10px; margin-bottom: ${pendingInvites.length > 0 ? '16px' : '0'};">
            <input type="text" id="inviteMemberEmail" placeholder="Member name or email (e.g. Sarah)" style="flex: 1; padding: 10px 14px; background: #10141e; border: 1px solid rgba(255,255,255,0.15); border-radius: 8px; color: #fff; font-size: 14px; outline: none;" />
            <button id="sendInviteBtn" style="background: #06d6a0; color: #06070a; border: none; padding: 10px 18px; border-radius: 8px; font-weight: 700; font-size: 13px; cursor: pointer;">Generate Link</button>
          </div>

          ${pendingInvites.length > 0 ? `
            <div style="border-top: 1px solid rgba(255,255,255,0.08); padding-top: 14px;">
              <div style="font-size: 12px; font-weight: 700; color: #9aa5b5; text-transform: uppercase; margin-bottom: 10px;">ACTIVE HOUSEHOLD INVITE LINKS</div>
              <div style="display: flex; flex-direction: column; gap: 8px;">
                ${pendingInvites.map((inv: any) => `
                  <div style="display: flex; align-items: center; justify-content: space-between; background: #10141e; padding: 10px 14px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.08);">
                    <div>
                      <div style="font-size: 14px; font-weight: 700; color: #fff;">${escapeHtml(inv.email)}</div>
                      <div style="font-size: 11px; color: #9aa5b5;">Created ${escapeHtml(inv.invitedAt || 'Recently')}</div>
                    </div>
                    <div style="display: flex; gap: 8px;">
                      <button class="copyInviteLinkBtn" data-url="${escapeHtml(inv.inviteUrl)}" style="background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.15); color: #c5f04e; padding: 4px 10px; border-radius: 6px; font-size: 12px; cursor: pointer;">Copy Link</button>
                      <button class="revokeInviteBtn" data-email="${escapeHtml(inv.email)}" data-id="${inv.id || ''}" style="background: rgba(255,94,126,0.15); border: 1px solid rgba(255,94,126,0.3); color: #ff5e7e; padding: 4px 10px; border-radius: 6px; font-size: 12px; cursor: pointer;">Revoke</button>
                    </div>
                  </div>
                `).join('')}
              </div>
            </div>
          ` : ''}
        </div>
      </div>

      </div>
    </div>
  `;

  document.body.appendChild(modal);

  const closeBtn = modal.querySelector('#closeSettingsBtn');
  if (closeBtn) closeBtn.addEventListener('click', () => modal.remove());

  const manageBtn = modal.querySelector('#btnManageBilling') as HTMLButtonElement | null;
  if (manageBtn) manageBtn.addEventListener('click', async () => {
    manageBtn.disabled = true; manageBtn.textContent = 'Loading Portal...';
    try { await openBillingPortal(); }
    catch (e: any) { alert(`No active subscription to manage yet.`); manageBtn.disabled = false; manageBtn.textContent = 'Change Plan'; }
  });

  const cancelBtn = modal.querySelector('#btnCancelBilling') as HTMLButtonElement | null;
  if (cancelBtn) cancelBtn.addEventListener('click', async () => {
    if (!confirm('Are you sure you want to cancel your subscription?')) return;
    cancelBtn.disabled = true; cancelBtn.textContent = 'Loading...';
    try { await openBillingPortal(); } // In a real app this might hit a cancel endpoint, but portal works
    catch (e: any) { alert(`Failed to load billing portal.`); cancelBtn.disabled = false; cancelBtn.textContent = 'Cancel'; }
  });

  const addonBtns = modal.querySelectorAll('.addonBtn');
  addonBtns.forEach(btn => {
    btn.addEventListener('click', async () => {
      const b = btn as HTMLButtonElement;
      b.disabled = true; b.textContent = 'Redirecting...';
      try { await startCheckout(); }
      catch (e: any) { alert(`Checkout failed: ${e.message}`); b.disabled = false; b.textContent = 'Add'; }
    });
  });

  const addProfileBtn = modal.querySelector('#settingsAddProfileBtn');
  if (addProfileBtn) {
    addProfileBtn.addEventListener('click', () => {
      modal.remove();
      openProfileEditor(undefined, () => openSettingsModal());
    });
  }

  const nameInput = modal.querySelector('#accountDisplayName') as HTMLInputElement | null;
  if (nameInput) {
    nameInput.addEventListener('change', () => {
      const val = nameInput.value.trim();
      if (val) {
        localStorage.setItem('veedeeoh_account_name', val);
      }
    });
  }

  const editBtns = modal.querySelectorAll('.settingsEditProfileBtn');
  editBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const id = (btn as HTMLElement).dataset.id;
      const target = profiles.find(p => p.id === id);
      if (target) {
        modal.remove();
        openProfileEditor(target, () => openSettingsModal());
      }
    });
  });

  // Direct Link Generator Handler
  const sendInviteBtn = modal.querySelector('#sendInviteBtn') as HTMLButtonElement | null;
  const inviteEmailInput = modal.querySelector('#inviteMemberEmail') as HTMLInputElement | null;

  if (sendInviteBtn && inviteEmailInput) {
    sendInviteBtn.addEventListener('click', async () => {
      const name = inviteEmailInput.value.trim();
      if (!name) {
        alert('Please enter a member name or email.');
        return;
      }

      sendInviteBtn.disabled = true;
      sendInviteBtn.textContent = 'Generating...';

      try {
        // Real Supabase-backed invite (token) when signed in; local fallback otherwise.
        let inviteCode: string;
        let inviteId: string | null = null;
        if (getSession()?.access_token) {
          const inv = await createInvite(name);
          inviteCode = inv.token;
          inviteId = inv.id;
        } else {
          inviteCode = 'inv_' + Math.random().toString(36).substring(2, 10);
        }
        const inviteUrl = `${window.location.origin}/landing.html?invite=${inviteCode}&acc=${encodeURIComponent(accName)}`;

        // Add to active household invite links (for display)
        const rawPending = localStorage.getItem('veedeeoh_pending_invites') || '[]';
        let pending: any[] = [];
        try { pending = JSON.parse(rawPending); } catch {}

        pending = pending.filter((x: any) => x.email !== name);
        pending.unshift({
          email: name,
          invitedAt: new Date().toLocaleDateString(),
          inviteUrl,
          code: inviteCode,
          id: inviteId
        });
        localStorage.setItem('veedeeoh_pending_invites', JSON.stringify(pending));

        // Copy direct link to clipboard instantly
        if (navigator.clipboard) {
          await navigator.clipboard.writeText(inviteUrl).catch(() => {});
        }

        inviteEmailInput.value = '';
        alert(`✅ Non-Geolocked Invite link created for "${name}"!\n\nLink copied to your clipboard:\n${inviteUrl}`);
        
        modal.remove();
        openSettingsModal();
      } catch (err) {
        alert(`Failed to generate invite link: ${err}`);
      } finally {
        if (sendInviteBtn) {
          sendInviteBtn.disabled = false;
          sendInviteBtn.textContent = 'Generate Link';
        }
      }
    });
  }

  // Copy Link Button Handlers
  const copyBtns = modal.querySelectorAll('.copyInviteLinkBtn');
  copyBtns.forEach(btn => {
    btn.addEventListener('click', async () => {
      const url = (btn as HTMLElement).dataset.url;
      if (url && navigator.clipboard) {
        await navigator.clipboard.writeText(url);
        (btn as HTMLElement).textContent = 'Copied!';
        setTimeout(() => {
          (btn as HTMLElement).textContent = 'Copy Link';
        }, 2000);
      }
    });
  });

  // Revoke Button Handlers
  const revokeBtns = modal.querySelectorAll('.revokeInviteBtn');
  revokeBtns.forEach(btn => {
    btn.addEventListener('click', async () => {
      const email = (btn as HTMLElement).dataset.email;
      const id = (btn as HTMLElement).dataset.id;
      if (!email) return;

      if (id) {
        import('./db').then(db => db.revokeInvite(id).catch(console.warn));
      }

      const rawPending = localStorage.getItem('veedeeoh_pending_invites') || '[]';
      let pending: any[] = [];
      try { pending = JSON.parse(rawPending); } catch {}

      pending = pending.filter((x: any) => x.email !== email);
      localStorage.setItem('veedeeoh_pending_invites', JSON.stringify(pending));

      modal.remove();
      openSettingsModal();
    });
  });
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
