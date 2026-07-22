import { getStoredProfiles, openProfileEditor, getActiveProfile, promptPinVerification } from './profiles';
import { getSession } from './auth';

export function openSettingsModal(): void {
  const activeProfile = getActiveProfile();
  const profiles = getStoredProfiles();
  
  // Find master PIN if set on any household profile
  const masterPin = profiles.find(p => p.pin)?.pin || activeProfile.pin;

  // Gating: If currently in Kids Mode or profile has a PIN, require Parent PIN verification
  if ((activeProfile.is_kids || activeProfile.pin || masterPin) && masterPin) {
    promptPinVerification(masterPin, () => renderSettingsModalInternal());
  } else {
    renderSettingsModalInternal();
  }
}

function renderSettingsModalInternal(): void {
  const existing = document.getElementById('settingsModal');
  if (existing) existing.remove();

  const session = getSession();
  const profiles = getStoredProfiles();
  const activeProfile = getActiveProfile();

  const defaultAccName = (session && session.email) ? session.email.split('@')[0]! : 'My Household';
  const accName = localStorage.getItem('veedeeoh_account_name') || defaultAccName;
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
      <div style="background: #080a10; border: 1px solid rgba(255,255,255,0.1); border-radius: 16px; padding: 20px; margin-bottom: 24px;">
        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px;">
          <div>
            <div style="font-size: 12px; color: #9aa5b5; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 4px;">CURRENT ACCOUNT</div>
            <div style="font-size: 18px; font-weight: 700; color: #fff;">${session ? escapeHtml(session.email) : 'Local / Self-Hosted Guest'}</div>
            <div style="font-size: 12px; color: #06d6a0; font-weight: 700; margin-top: 4px;">Role: ${activeProfile.role === 'owner' ? 'Account Owner (Admin)' : 'Household Member'}</div>
          </div>
          <div style="display: inline-flex; align-items: center; gap: 8px; background: rgba(197,240,78,0.15); border: 1px solid rgba(197,240,78,0.3); padding: 4px 14px; border-radius: 20px; color: #c5f04e; font-size: 12px; font-weight: 700;">
            <span>Founder VIP</span>
          </div>
        </div>
        <div>
          <label style="display: block; font-size: 12px; color: #9aa5b5; margin-bottom: 6px; font-weight: 700;">HOUSEHOLD / ACCOUNT DISPLAY NAME</label>
          <input type="text" id="accountDisplayName" value="${escapeHtml(accName)}" placeholder="e.g. Cojac's Household" style="width: 100%; padding: 10px 14px; background: #10141e; border: 1px solid rgba(255,255,255,0.15); border-radius: 8px; color: #fff; font-size: 14px; outline: none;" />
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
                  ${p.is_kids ? '🎈' : p.name.charAt(0).toUpperCase()}
                </div>
                <div>
                  <div style="font-weight: 700; font-size: 15px;">${escapeHtml(p.name)} ${p.id === activeProfile.id ? '<span style="color: #c5f04e; font-size: 12px;">(Active)</span>' : ''}</div>
                  <div style="font-size: 12px; color: #9aa5b5;">${p.is_kids ? 'veedeeoh.kidz' : 'Standard'} · Rating Max: ${p.max_rating} ${p.pin ? '· 🔒 PIN Set' : ''}</div>
                </div>
              </div>
              <button class="settingsEditProfileBtn" data-id="${p.id}" style="background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.15); color: #fff; padding: 6px 12px; border-radius: 8px; font-size: 13px; cursor: pointer;">Edit</button>
            </div>
          `).join('')}
        </div>
      </div>

      <!-- Anti-Netflix Member Sharing -->
      <div style="margin-bottom: 24px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
          <div>
            <h3 style="margin: 0; font-size: 18px; font-weight: 700;">🤝 Non-Geolocked Family Invites</h3>
            <div style="font-size: 12px; color: #06d6a0; font-weight: 700;">Anti-Netflix Model: Zero IP locks. Members log in with their OWN email.</div>
          </div>
        </div>
        <div style="background: #080a10; border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; padding: 16px;">
          <p style="margin: 0 0 12px; font-size: 13px; color: #9aa5b5;">Invite family, roommates, or college kids to use your household plan anywhere in the world without sharing passwords:</p>
          <div style="display: flex; gap: 10px;">
            <input type="email" id="inviteMemberEmail" placeholder="family.member@gmail.com" style="flex: 1; padding: 10px 14px; background: #10141e; border: 1px solid rgba(255,255,255,0.15); border-radius: 8px; color: #fff; font-size: 14px; outline: none;" />
            <button id="sendInviteBtn" style="background: #06d6a0; color: #06070a; border: none; padding: 10px 18px; border-radius: 8px; font-weight: 700; font-size: 13px; cursor: pointer;">Send Invite</button>
          </div>
        </div>
      </div>

      <!-- Playback Preferences -->
      <div>
        <h3 style="margin: 0 0 14px; font-size: 18px; font-weight: 700;">Playback & Bandwidth</h3>
        <div style="background: #080a10; border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; padding: 16px; display: flex; flex-direction: column; gap: 14px;">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <div>
              <div style="font-weight: 700; font-size: 14px;">Default Subtitle CC</div>
              <div style="font-size: 12px; color: #9aa5b5;">Always enable closed captions when available</div>
            </div>
            <input type="checkbox" checked style="width: 18px; height: 18px; accent-color: #c5f04e;" />
          </div>
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <div>
              <div style="font-weight: 700; font-size: 14px;">Stream Quality Cap</div>
              <div style="font-size: 12px; color: #9aa5b5;">Client-side direct streaming bandwidth limit</div>
            </div>
            <select style="background: #10141e; border: 1px solid rgba(255,255,255,0.2); color: #fff; padding: 6px 12px; border-radius: 8px; font-size: 13px;">
              <option value="auto">Auto (Highest Available)</option>
              <option value="1080p">1080p Full HD</option>
              <option value="720p">720p Data Saver</option>
            </select>
          </div>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  const closeBtn = modal.querySelector('#closeSettingsBtn');
  if (closeBtn) closeBtn.addEventListener('click', () => modal.remove());

  const addProfileBtn = modal.querySelector('#settingsAddProfileBtn');
  if (addProfileBtn) {
    addProfileBtn.addEventListener('click', () => {
      modal.remove();
      openProfileEditor();
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
        openProfileEditor(target);
      }
    });
  });
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
