import { HouseholdProfile } from './types';

const ACTIVE_PROFILE_KEY = 'veedeeoh_active_profile';

const DEFAULT_PROFILES: HouseholdProfile[] = [
  { id: 'default_main', name: 'Main Profile', avatar_color: '#c5f04e', role: 'owner' }
];

export function getStoredProfiles(): HouseholdProfile[] {
  try {
    const raw = localStorage.getItem('veedeeoh_household_profiles');
    if (!raw) return DEFAULT_PROFILES;
    const parsed = JSON.parse(raw);
    return parsed.length > 0 ? parsed : DEFAULT_PROFILES;
  } catch {
    return DEFAULT_PROFILES;
  }
}

export function saveProfiles(profiles: HouseholdProfile[]): void {
  localStorage.setItem('veedeeoh_household_profiles', JSON.stringify(profiles));
}

export function getActiveProfile(): HouseholdProfile {
  try {
    const raw = localStorage.getItem(ACTIVE_PROFILE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.id) return parsed as HouseholdProfile;
    }
  } catch {}
  const list = getStoredProfiles();
  return (list[0] || DEFAULT_PROFILES[0]) as HouseholdProfile;
}

export function setActiveProfile(profile: HouseholdProfile): void {
  localStorage.setItem(ACTIVE_PROFILE_KEY, JSON.stringify(profile));
  window.dispatchEvent(new CustomEvent('veedeeoh:profile-changed', { detail: profile }));
}

export function openProfileSwitcher(onSelectProfile?: (p: HouseholdProfile) => void): void {
  const existing = document.getElementById('profileSwitcherModal');
  if (existing) existing.remove();

  const profiles = getStoredProfiles();
  const active = getActiveProfile();

  const modal = document.createElement('div');
  modal.id = 'profileSwitcherModal';
  modal.style.cssText = `
    position: fixed; inset: 0; background: rgba(6,7,10,0.92);
    backdrop-filter: blur(20px); z-index: 9999;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    padding: 30px; color: #fff; font-family: 'Space Grotesk', sans-serif;
  `;

  modal.innerHTML = `
    <div style="text-align: center; max-width: 700px; width: 100%;">
      <h1 style="font-size: clamp(2rem, 4vw, 3rem); font-weight: 800; margin: 0 0 12px; letter-spacing: -1px;">Who's Watching?</h1>
      <p style="color: #9aa5b5; font-size: 16px; margin: 0 0 40px;">Select your profile to load custom favorites and watch progress</p>
      
      <div style="display: flex; gap: 24px; justify-content: center; flex-wrap: wrap; margin-bottom: 40px;">
        ${profiles.map(p => `
          <button class="profileAvatarBtn" data-id="${p.id}" style="
            background: none; border: none; cursor: pointer; display: flex; flex-direction: column; align-items: center; gap: 14px; transition: transform 0.2s ease; outline: none;
          ">
            <div style="
              width: 100px; height: 100px; border-radius: 20px; background: ${p.avatar_color}; display: flex; align-items: center; justify-content: center; font-size: 40px; font-weight: 800; color: #06070a; box-shadow: ${p.id === active.id ? '0 0 0 4px #c5f04e, 0 12px 30px rgba(197,240,78,0.4)' : '0 8px 24px rgba(0,0,0,0.5)'}; position: relative;
            ">
              ${p.name.charAt(0).toUpperCase()}
            </div>
            <span style="font-size: 16px; font-weight: 700; color: #fff;">${escapeHtml(p.name)}</span>
          </button>
        `).join('')}

        <button id="addProfileBtn" style="
          background: none; border: none; cursor: pointer; display: flex; flex-direction: column; align-items: center; gap: 14px; outline: none;
        ">
          <div style="
            width: 100px; height: 100px; border-radius: 20px; background: rgba(255,255,255,0.08); border: 2px dashed rgba(255,255,255,0.3); display: flex; align-items: center; justify-content: center; font-size: 36px; color: #9aa5b5; transition: all 0.2s;
          ">
            +
          </div>
          <span style="font-size: 16px; font-weight: 600; color: #9aa5b5;">Add Profile</span>
        </button>
      </div>

      <button id="manageProfilesBtn" style="
        background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.15); color: #fff; padding: 12px 28px; border-radius: 10px; font-size: 14px; font-weight: 700; cursor: pointer; transition: background 0.2s;
      ">Manage Household Profiles</button>
    </div>
  `;

  document.body.appendChild(modal);

  const btns = modal.querySelectorAll('.profileAvatarBtn');
  btns.forEach(btn => {
    btn.addEventListener('click', () => {
      const id = (btn as HTMLElement).dataset.id;
      const target = profiles.find(p => p.id === id);
      if (!target) return;

      setActiveProfile(target);
      modal.remove();
      if (onSelectProfile) onSelectProfile(target);
    });
  });

  const addBtn = modal.querySelector('#addProfileBtn');
  if (addBtn) {
    addBtn.addEventListener('click', () => {
      modal.remove();
      openProfileEditor();
    });
  }

  const manageBtn = modal.querySelector('#manageProfilesBtn');
  if (manageBtn) {
    manageBtn.addEventListener('click', () => {
      modal.remove();
      openProfileEditor();
    });
  }
}

export function openProfileEditor(editingProfile?: HouseholdProfile): void {
  const existing = document.getElementById('profileEditorModal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'profileEditorModal';
  modal.style.cssText = `
    position: fixed; inset: 0; background: rgba(6,7,10,0.92);
    backdrop-filter: blur(20px); z-index: 10000;
    display: flex; align-items: center; justify-content: center; padding: 20px;
    color: #fff; font-family: 'Space Grotesk', sans-serif;
  `;

  const isEdit = !!editingProfile;
  const pName = editingProfile ? editingProfile.name : '';
  const pColor = editingProfile ? editingProfile.avatar_color : '#c5f04e';

  modal.innerHTML = `
    <div style="background: #10141e; border: 1px solid rgba(255,255,255,0.15); border-radius: 24px; max-width: 460px; width: 100%; padding: 32px; box-shadow: 0 24px 60px rgba(0,0,0,0.9);">
      <h2 style="margin: 0 0 20px; font-size: 24px; font-weight: 800;">${isEdit ? 'Edit Profile' : 'Create New Profile'}</h2>
      
      <div style="margin-bottom: 20px;">
        <label style="display: block; font-size: 13px; color: #9aa5b5; margin-bottom: 8px; font-weight: 700;">PROFILE NAME</label>
        <input type="text" id="editName" value="${escapeHtml(pName)}" placeholder="e.g. Living Room, Sarah" style="width: 100%; padding: 12px 16px; background: #080a10; border: 1px solid rgba(255,255,255,0.15); border-radius: 10px; color: #fff; font-size: 15px; outline: none;" />
      </div>

      <div style="margin-bottom: 24px;">
        <label style="display: block; font-size: 13px; color: #9aa5b5; margin-bottom: 8px; font-weight: 700;">AVATAR COLOR</label>
        <div style="display: flex; gap: 12px;" id="colorPickerRow">
          ${['#c5f04e', '#ff5e7e', '#06d6a0', '#118ab2', '#ffd166', '#a78bfa'].map(c => `
            <button class="colorChoiceBtn ${c === pColor ? 'selected' : ''}" data-color="${c}" style="
              width: 38px; height: 38px; border-radius: 10px; background: ${c}; border: ${c === pColor ? '3px solid #fff' : 'none'}; cursor: pointer;
            "></button>
          `).join('')}
        </div>
      </div>

      <div style="display: flex; gap: 12px;">
        <button id="cancelEditBtn" style="flex: 1; padding: 12px; border-radius: 10px; background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.1); color: #fff; font-weight: 700; cursor: pointer;">Cancel</button>
        <button id="saveProfileBtn" style="flex: 1; padding: 12px; border-radius: 10px; background: #c5f04e; border: none; color: #06070a; font-weight: 700; cursor: pointer;">Save Profile</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  let selectedColor = pColor;
  const colorBtns = modal.querySelectorAll('.colorChoiceBtn');
  colorBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      colorBtns.forEach(b => (b as HTMLElement).style.border = 'none');
      (btn as HTMLElement).style.border = '3px solid #fff';
      selectedColor = (btn as HTMLElement).dataset.color || '#c5f04e';
    });
  });

  const saveBtn = modal.querySelector('#saveProfileBtn');
  const cancelBtn = modal.querySelector('#cancelEditBtn');

  if (cancelBtn) cancelBtn.addEventListener('click', () => modal.remove());

  if (saveBtn) {
    saveBtn.addEventListener('click', () => {
      const nameInput = (modal.querySelector('#editName') as HTMLInputElement).value.trim();

      if (!nameInput) {
        alert('Please enter a profile name.');
        return;
      }

      const profiles = getStoredProfiles();
      if (isEdit && editingProfile) {
        const idx = profiles.findIndex(p => p.id === editingProfile.id);
        if (idx !== -1) {
          profiles[idx] = {
            id: editingProfile.id,
            name: nameInput,
            avatar_color: selectedColor
          };
        }
      } else {
        const newP: HouseholdProfile = {
          id: 'profile_' + Date.now(),
          name: nameInput,
          avatar_color: selectedColor
        };
        profiles.push(newP);
      }

      saveProfiles(profiles);
      modal.remove();
      openProfileSwitcher();
    });
  }
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
