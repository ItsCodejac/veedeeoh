import { HouseholdProfile } from './types';
import * as db from './db';
import { getSession, signOut } from './auth';

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

const cloudEnabled = () => !!getSession()?.access_token;

/** Pull the real household_profiles from Supabase into the local cache. Best
 *  effort — on failure (self-host / offline) the local cache is left intact. */
// --- Parental PIN (optional, per non-kids profile) -------------------------
// Stored only as a salted SHA-256 hash, never plaintext. A 4-digit PIN is a
// "keep honest kids out" gate for switching into an adult profile, not
// cryptographic protection.
export async function hashPin(pin: string): Promise<string> {
  const data = new TextEncoder().encode(`veedeeoh-pin:${pin}`);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Prompt for a profile's PIN; resolves true only if it matches the stored hash. */
export function promptForPin(profile: HouseholdProfile): Promise<boolean> {
  return new Promise((resolve) => {
    const modal = document.createElement("div");
    modal.style.cssText = "position:fixed;inset:0;z-index:10001;background:rgba(6,7,10,0.94);backdrop-filter:blur(20px);display:flex;align-items:center;justify-content:center;padding:20px;color:#fff;font-family:'Space Grotesk',sans-serif;";
    modal.innerHTML = `
      <div style="background:#10141e;border:1px solid rgba(255,255,255,0.15);border-radius:20px;max-width:340px;width:100%;padding:28px;text-align:center;box-shadow:0 24px 60px rgba(0,0,0,0.9);">
        <div style="width:56px;height:56px;border-radius:14px;background:${profile.avatar_color};display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:800;color:#06070a;margin:0 auto 14px;">${escapeHtml(profile.name.charAt(0).toUpperCase())}</div>
        <h3 style="margin:0 0 6px;font-size:18px;font-weight:800;">Enter PIN for ${escapeHtml(profile.name)}</h3>
        <p style="margin:0 0 18px;font-size:13px;color:#9aa5b5;">This profile is protected.</p>
        <input id="pinEntry" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="4" autocomplete="off" style="width:170px;text-align:center;letter-spacing:14px;font-size:26px;padding:12px;border-radius:12px;border:1px solid rgba(255,255,255,0.2);background:#080a10;color:#fff;outline:none;" />
        <div id="pinError" style="height:16px;margin-top:8px;font-size:12px;color:#ff6b6b;"></div>
        <div style="display:flex;gap:10px;margin-top:14px;">
          <button id="pinCancel" style="flex:1;padding:11px;border-radius:10px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.12);color:#fff;font-weight:700;cursor:pointer;">Cancel</button>
          <button id="pinOk" style="flex:1;padding:11px;border-radius:10px;background:#c5f04e;border:none;color:#06070a;font-weight:800;cursor:pointer;">Unlock</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
    const input = modal.querySelector("#pinEntry") as HTMLInputElement;
    const errEl = modal.querySelector("#pinError") as HTMLElement;
    setTimeout(() => input.focus(), 50);
    const done = (ok: boolean) => { modal.remove(); resolve(ok); };
    const submit = async () => {
      const val = input.value.trim();
      if (!/^\d{4}$/.test(val)) { errEl.textContent = "Enter your 4-digit PIN."; return; }
      const h = await hashPin(val);
      if (h === profile.pin) done(true);
      else { errEl.textContent = "Incorrect PIN."; input.value = ""; input.focus(); }
    };
    (modal.querySelector("#pinOk") as HTMLElement).onclick = submit;
    (modal.querySelector("#pinCancel") as HTMLElement).onclick = () => done(false);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") void submit(); });
  });
}

export async function hydrateProfilesFromCloud(): Promise<void> {
  if (!cloudEnabled()) return;
  try {
    let rows = await db.listProfiles();
    // Netflix-style: a signed-in user always has at least one profile. Create a
    // default on first login so My List / Continue Watching have a home.
    if (!rows.length) {
      const sess = getSession();
      const name = sess?.email ? sess.email.split("@")[0]! : "Me";
      try {
        await db.createProfile({ name, avatar_color: "#c5f04e" });
        rows = await db.listProfiles();
      } catch { /* offline / RLS — fall back to local default */ }
    }
    if (!rows.length) return;
    const mapped: HouseholdProfile[] = rows.map((r) => ({
      id: r.id,
      name: r.name,
      avatar_color: r.avatar_color,
      is_kids: r.is_kids,
      max_rating: r.max_rating,
      pin: r.pin,
    }));
    saveProfiles(mapped);
    // If the active profile is a local placeholder (or no longer exists), point
    // it at a real cloud profile — otherwise favorites/watch sync stays dead.
    const active = getActiveProfile();
    if (!active.id || active.id.startsWith("default_") || active.id.startsWith("profile_")
        || !mapped.some((p) => p.id === active.id)) {
      setActiveProfile(mapped[0]!);
    }
  } catch {
    /* keep local cache */
  }
}

/** Create a profile in Supabase (when signed in) + local cache. */
export async function createProfileEverywhere(fields: {
  name: string; avatar_color: string; is_kids?: boolean; max_rating?: string | null; pin?: string | null;
}): Promise<void> {
  const local = getStoredProfiles().filter((p) => p.id !== 'default_main');
  if (cloudEnabled()) {
    try {
      const row = await db.createProfile({
        name: fields.name,
        avatar_color: fields.avatar_color,
        is_kids: fields.is_kids,
        max_rating: fields.max_rating ?? undefined,
        pin: fields.pin ?? null,
      });
      local.push({ id: row.id, name: row.name, avatar_color: row.avatar_color,
        is_kids: row.is_kids, max_rating: row.max_rating, pin: row.pin });
      saveProfiles(local);
      return;
    } catch { /* fall through to local-only */ }
  }
  local.push({ id: 'profile_' + Date.now(), ...fields });
  saveProfiles(local);
}

/** Update a profile in Supabase (when signed in) + local cache. */
export async function updateProfileEverywhere(id: string, fields: {
  name: string; avatar_color: string; is_kids?: boolean; max_rating?: string | null; pin?: string | null;
}): Promise<void> {
  const list = getStoredProfiles().map((p) => (p.id === id ? { ...p, ...fields } : p));
  saveProfiles(list);
  if (cloudEnabled() && !id.startsWith('profile_') && id !== 'default_main') {
    try {
      const patch: any = { name: fields.name, avatar_color: fields.avatar_color,
        is_kids: fields.is_kids, max_rating: fields.max_rating };
      if (fields.pin !== undefined) patch.pin = fields.pin; // only touch pin when set/cleared
      await db.updateProfile(id, patch);
    } catch { /* cache already updated */ }
  }
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
  applyKidsMode(profile);
  window.dispatchEvent(new CustomEvent('veedeeoh:profile-changed', { detail: profile }));
}

/** Toggle the dedicated kids experience (styling hook + hides adult chrome).
 *  Content is already hard-capped for kids in vod.getVodRails. */
export function applyKidsMode(profile: HouseholdProfile): void {
  document.body.classList.toggle('kids-mode', !!profile?.is_kids);
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

      <div style="display: flex; gap: 12px; justify-content: center; flex-wrap: wrap;">
        <button id="manageProfilesBtn" style="
          display: inline-flex; align-items: center; gap: 8px; background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.15); color: #fff; padding: 12px 28px; border-radius: 10px; font-size: 14px; font-weight: 700; cursor: pointer; transition: background 0.2s;
        "><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"></path><circle cx="12" cy="12" r="3"></circle></svg>Manage Profiles</button>
        <button id="signOutBtn" style="
          display: inline-flex; align-items: center; gap: 8px; background: none; border: 1px solid rgba(255,255,255,0.15); color: #9aa5b5; padding: 12px 28px; border-radius: 10px; font-size: 14px; font-weight: 700; cursor: pointer; transition: color 0.2s, border-color 0.2s;
        "><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>Sign out</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  const btns = modal.querySelectorAll('.profileAvatarBtn');
  btns.forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = (btn as HTMLElement).dataset.id;
      const target = profiles.find(p => p.id === id);
      if (!target) return;

      // Optional parental lock: a PIN-protected profile requires the PIN to enter.
      if (target.pin) {
        const ok = await promptForPin(target);
        if (!ok) return; // stay on "Who's Watching"
      }

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

  const signOutBtn = modal.querySelector('#signOutBtn');
  if (signOutBtn) {
    signOutBtn.addEventListener('click', () => {
      modal.remove();
      signOut();
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
  const pKids = !!editingProfile?.is_kids;
  const pRating = editingProfile?.max_rating || '';

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

      <div style="margin-bottom: 24px; background:#080a10; border:1px solid rgba(255,255,255,0.1); border-radius:12px; padding:16px;">
        <label style="display:flex; align-items:center; gap:10px; font-size:14px; font-weight:700; cursor:pointer;">
          <input type="checkbox" id="editKids" ${pKids ? 'checked' : ''} style="width:18px; height:18px; accent-color:#c5f04e;" />
          Kids profile — restrict to age-appropriate content
        </label>
        <div style="margin-top:14px;">
          <label style="display:block; font-size:13px; color:#9aa5b5; margin-bottom:8px; font-weight:700;">MATURITY CAP</label>
          <select id="editRating" style="width:100%; padding:12px 16px; background:#10141e; border:1px solid rgba(255,255,255,0.15); border-radius:10px; color:#fff; font-size:15px;">
            <option value="">No limit (adult)</option>
            <option value="TV-Y">Little kids (TV-Y)</option>
            <option value="TV-Y7">Kids 7+ (TV-Y7)</option>
            <option value="TV-G">Family (TV-G / G)</option>
            <option value="PG">Older kids (PG / TV-PG)</option>
            <option value="TV-14">Teen (TV-14 / PG-13)</option>
          </select>
          <div style="font-size:11px; color:#9aa5b5; margin-top:6px;">Only titles at or below this rating will appear for this profile.</div>
        </div>
      </div>

      <div id="pinFieldWrap" style="margin-bottom: 24px; background:#080a10; border:1px solid rgba(255,255,255,0.1); border-radius:12px; padding:16px; ${pKids ? 'display:none;' : ''}">
        <label style="display:block; font-size:13px; color:#9aa5b5; margin-bottom:8px; font-weight:700;">PARENTAL PIN (OPTIONAL)</label>
        <input type="password" id="editPin" inputmode="numeric" pattern="[0-9]*" maxlength="4" value="" placeholder="${editingProfile?.pin ? 'Set — leave blank to keep' : '4 digits to lock this profile'}" style="width:100%; padding:12px 16px; background:#10141e; border:1px solid rgba(255,255,255,0.15); border-radius:10px; color:#fff; font-size:15px; letter-spacing:4px; outline:none;" />
        <div style="font-size:11px; color:#9aa5b5; margin-top:6px;">Anyone switching into this profile must enter the PIN.${editingProfile?.pin ? ' <button type="button" id="clearPinBtn" style="background:none;border:none;color:#ff6b6b;cursor:pointer;padding:0;font-size:11px;text-decoration:underline;">Remove PIN</button>' : ''}</div>
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

  const ratingSel = modal.querySelector('#editRating') as HTMLSelectElement | null;
  if (ratingSel) ratingSel.value = pRating;
  const kidsBox = modal.querySelector('#editKids') as HTMLInputElement | null;
  const pinWrap = modal.querySelector('#pinFieldWrap') as HTMLElement | null;
  // Checking "Kids profile" with no cap chosen defaults to a family-safe cap.
  // Kids profiles never carry a PIN (the PIN protects adult profiles), so hide it.
  if (kidsBox && ratingSel) {
    kidsBox.addEventListener('change', () => {
      if (kidsBox.checked && !ratingSel.value) ratingSel.value = 'TV-G';
      if (pinWrap) pinWrap.style.display = kidsBox.checked ? 'none' : '';
    });
  }

  let clearPinRequested = false;
  const clearPinBtn = modal.querySelector('#clearPinBtn');
  if (clearPinBtn) {
    clearPinBtn.addEventListener('click', () => {
      clearPinRequested = true;
      const pinInput = modal.querySelector('#editPin') as HTMLInputElement | null;
      if (pinInput) { pinInput.value = ''; pinInput.placeholder = 'PIN will be removed on save'; }
    });
  }

  const saveBtn = modal.querySelector('#saveProfileBtn');
  const cancelBtn = modal.querySelector('#cancelEditBtn');

  if (cancelBtn) cancelBtn.addEventListener('click', () => modal.remove());

  if (saveBtn) {
    saveBtn.addEventListener('click', async () => {
      const nameInput = (modal.querySelector('#editName') as HTMLInputElement).value.trim();

      if (!nameInput) {
        alert('Please enter a profile name.');
        return;
      }

      const isKids = !!kidsBox?.checked;
      let maxRating: string | null = (ratingSel?.value || '') || null;
      if (isKids && !maxRating) maxRating = 'TV-G';

      // Resolve the PIN: undefined = leave as-is, null = clear, string = new hash.
      const rawPin = ((modal.querySelector('#editPin') as HTMLInputElement | null)?.value || '').trim();
      let pin: string | null | undefined = undefined;
      if (isKids || clearPinRequested) {
        pin = null; // kids profiles never carry a PIN; or the parent removed it
      } else if (rawPin) {
        if (!/^\d{4}$/.test(rawPin)) { alert('PIN must be exactly 4 digits.'); (saveBtn as HTMLButtonElement).disabled = false; return; }
        pin = await hashPin(rawPin);
      }

      const fields: { name: string; avatar_color: string; is_kids: boolean; max_rating: string | null; pin?: string | null } =
        { name: nameInput, avatar_color: selectedColor, is_kids: isKids, max_rating: maxRating };
      if (pin !== undefined) fields.pin = pin;

      (saveBtn as HTMLButtonElement).disabled = true;
      try {
        if (isEdit && editingProfile) {
          await updateProfileEverywhere(editingProfile.id, fields);
        } else {
          await createProfileEverywhere(fields);
        }
      } catch (e) {
        console.warn('[profiles] save failed', e);
      }

      modal.remove();
      openProfileSwitcher();
    });
  }
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
