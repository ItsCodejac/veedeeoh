import { HouseholdProfile } from './types';
import * as db from './db';
import { getSession, signOut } from './auth';
import { RATING_GROUPS, allowedRatingsFor } from './db';

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
    const mapped: HouseholdProfile[] = rows.map((r, i) => ({
      id: r.id,
      name: r.name,
      avatar_color: r.avatar_color,
      is_kids: r.is_kids,
      max_rating: r.max_rating,
      pin: r.pin,
      role: i === 0 ? 'owner' : undefined
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
  name: string; avatar_color: string; is_kids?: boolean; max_rating?: string | null;
  allowed_ratings?: string[] | null; pin?: string | null;
}): Promise<void> {
  const local = getStoredProfiles().filter((p) => p.id !== 'default_main');
  if (cloudEnabled()) {
    try {
      const row = await db.createProfile({
        name: fields.name,
        avatar_color: fields.avatar_color,
        is_kids: fields.is_kids,
        max_rating: fields.max_rating ?? undefined,
        allowed_ratings: fields.allowed_ratings ?? null,
        pin: fields.pin ?? null,
      });
      local.push({ id: row.id, name: row.name, avatar_color: row.avatar_color,
        is_kids: row.is_kids, max_rating: row.max_rating,
        allowed_ratings: row.allowed_ratings ?? null, pin: row.pin });
      saveProfiles(local);
      return;
    } catch { /* fall through to local-only */ }
  }
  local.push({ id: 'profile_' + Date.now(), ...fields });
  saveProfiles(local);
}

/** Update a profile in Supabase (when signed in) + local cache. */
/** Ask the parent to set a 4-digit PIN on an adult profile. Returns the raw PIN,
 *  or null if they decline. Distinct from promptForPin(), which VERIFIES one. */
const TV_CODES = new Set(['TV-Y', 'TV-Y7', 'TV-Y7-FV', 'TV-G', 'TV-PG', 'TV-14', 'TV-MA']);
function r_isTv(code: string): boolean { return TV_CODES.has(code.toUpperCase()); }

/** Shown once when an MPAA letter is added to an otherwise kid-rated profile.
 *  Resolves true if the parent accepts. "Don't show again" is remembered. */
function mpaaWarning(code: string): Promise<boolean> {
  return new Promise((resolve) => {
    const m = document.createElement('div');
    m.style.cssText = "position:fixed;inset:0;z-index:10070;background:rgba(6,7,10,.94);backdrop-filter:blur(18px);display:flex;align-items:center;justify-content:center;padding:20px;color:#fff;font-family:'Space Grotesk',sans-serif;";
    m.innerHTML = `
      <div style="background:#10141e;border:1px solid rgba(255,193,7,.35);border-radius:18px;max-width:440px;width:100%;padding:26px;">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fbbf24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>
          <h3 style="margin:0;font-size:18px;font-weight:800;">About the ${escapeHtml(code)} rating</h3>
        </div>
        <p style="margin:0 0 12px;font-size:13.5px;line-height:1.6;color:#c9d1d9;">
          Film ratings have not meant the same thing over time. <strong>PG-13 did not exist until 1984</strong>,
          so films released before then were rated PG even when they contain material that would be
          PG-13 or higher today.
        </p>
        <p style="margin:0 0 12px;font-size:13.5px;line-height:1.6;color:#c9d1d9;">
          <em>Airplane!</em> (1980) is rated PG and contains nudity. Older G-rated films drifted the
          same way. We cannot correct for this automatically, because most of the catalogue does not
          tell us a release year.
        </p>
        <p style="margin:0 0 18px;font-size:13.5px;line-height:1.6;color:#c9d1d9;">
          TV ratings are not affected &mdash; they were introduced in 1997. If this profile is for a
          child, consider leaving film ratings unticked and allowing individual films instead, using
          <strong>Kids access</strong> on any title.
        </p>
        <label style="display:flex;align-items:center;gap:9px;font-size:12.5px;color:#9aa5b5;cursor:pointer;margin-bottom:16px;">
          <input type="checkbox" id="mpaaAck" style="accent-color:#c5f04e;width:15px;height:15px;cursor:pointer;" />
          Don't show this again
        </label>
        <div style="display:flex;gap:10px;">
          <button id="mpaaCancel" style="flex:1;padding:11px;border-radius:10px;background:rgba(255,255,255,.08);border:none;color:#9aa5b5;font-weight:700;cursor:pointer;">Cancel</button>
          <button id="mpaaOk" style="flex:1;padding:11px;border-radius:10px;background:#c5f04e;border:none;color:#06070a;font-weight:800;cursor:pointer;">Allow ${escapeHtml(code)}</button>
        </div>
      </div>`;
    document.body.appendChild(m);
    const done = (v: boolean) => {
      if (v && (m.querySelector('#mpaaAck') as HTMLInputElement)?.checked) {
        localStorage.setItem('veedeeoh_mpaa_warning_ack', '1');
      }
      m.remove();
      resolve(v);
    };
    (m.querySelector('#mpaaCancel') as HTMLElement).onclick = () => done(false);
    (m.querySelector('#mpaaOk') as HTMLElement).onclick = () => done(true);
  });
}

export function promptToSetPin(profile: HouseholdProfile): Promise<string | null> {
  return new Promise((resolve) => {
    const modal = document.createElement("div");
    modal.style.cssText = "position:fixed;inset:0;z-index:10002;background:rgba(6,7,10,0.94);backdrop-filter:blur(20px);display:flex;align-items:center;justify-content:center;padding:20px;color:#fff;font-family:'Space Grotesk',sans-serif;";
    modal.innerHTML = `
      <div style="background:#10141e;border:1px solid rgba(255,255,255,0.15);border-radius:20px;max-width:380px;width:100%;padding:28px;text-align:center;box-shadow:0 24px 60px rgba(0,0,0,0.9);">
        <div style="width:52px;height:52px;border-radius:14px;background:rgba(197,240,78,0.14);display:flex;align-items:center;justify-content:center;margin:0 auto 14px;">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#c5f04e" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
        </div>
        <h3 style="margin:0 0 8px;font-size:19px;font-weight:800;">Protect kids mode</h3>
        <p style="margin:0 0 18px;font-size:13px;line-height:1.6;color:#9aa5b5;">
          Set a 4-digit PIN on <strong style="color:#fff;">${escapeHtml(profile.name)}</strong>.
          Without one, anyone can leave a restricted profile and reach the full library.
        </p>
        <input id="setPin1" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="4" autocomplete="off" placeholder="PIN"
          style="width:170px;text-align:center;letter-spacing:14px;font-size:24px;padding:11px;border-radius:12px;border:1px solid rgba(255,255,255,0.2);background:#080a10;color:#fff;outline:none;" />
        <input id="setPin2" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="4" autocomplete="off" placeholder="Confirm"
          style="width:170px;text-align:center;letter-spacing:14px;font-size:24px;padding:11px;border-radius:12px;border:1px solid rgba(255,255,255,0.2);background:#080a10;color:#fff;outline:none;margin-top:10px;" />
        <div id="setPinError" style="height:16px;margin-top:8px;font-size:12px;color:#ff6b6b;"></div>
        <div style="display:flex;gap:10px;margin-top:14px;">
          <button id="setPinSkip" style="flex:1;padding:11px;border-radius:10px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.12);color:#9aa5b5;font-weight:700;cursor:pointer;">Not now</button>
          <button id="setPinSave" style="flex:1;padding:11px;border-radius:10px;background:#c5f04e;border:none;color:#06070a;font-weight:800;cursor:pointer;">Set PIN</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
    const a = modal.querySelector('#setPin1') as HTMLInputElement;
    const b = modal.querySelector('#setPin2') as HTMLInputElement;
    const err = modal.querySelector('#setPinError') as HTMLElement;
    const done = (v: string | null) => { modal.remove(); resolve(v); };
    (modal.querySelector('#setPinSkip') as HTMLElement).addEventListener('click', () => done(null));
    (modal.querySelector('#setPinSave') as HTMLElement).addEventListener('click', () => {
      if (!/^\d{4}$/.test(a.value)) { err.textContent = 'PIN must be exactly 4 digits.'; return; }
      if (a.value !== b.value) { err.textContent = 'Those PINs do not match.'; return; }
      done(a.value);
    });
    setTimeout(() => a.focus(), 50);
  });
}

/** A restricted profile only restricts anything if some adult profile has a PIN —
 *  the exit gate in openProfileSwitcher falls open otherwise. Call this whenever a
 *  profile is saved as age-restricted. `excludeId` is the profile being saved, so
 *  a profile turning INTO a kids profile is not counted as an available adult. */
export async function ensureAdultPinExists(excludeId?: string): Promise<void> {
  const adults = getStoredProfiles().filter((p) => !p.is_kids && p.id !== excludeId);
  if (adults.some((p) => p.pin)) return; // already protected
  if (adults.length === 0) {
    alert('This household has no adult profile, so kids mode cannot be locked. Create an adult profile and set a PIN on it.');
    return;
  }
  const target = adults.find((p) => (p as any).role === 'owner') || adults[0]!;
  const raw = await promptToSetPin(target);
  if (!raw) return; // declined — leave it open rather than block saving
  try {
    await updateProfileEverywhere(target.id, {
      name: target.name,
      avatar_color: target.avatar_color,
      avatar_url: (target as any).avatar_url ?? undefined,
      is_kids: target.is_kids,
      max_rating: target.max_rating ?? null,
      pin: await hashPin(raw),
    });
  } catch (e) {
    console.warn('[profiles] could not set adult PIN', e);
  }
}

export async function updateProfileEverywhere(id: string, fields: {
  name: string; avatar_color: string; avatar_url?: string | null; is_kids?: boolean;
  max_rating?: string | null; allowed_ratings?: string[] | null; pin?: string | null;
}): Promise<void> {
  const list = getStoredProfiles().map((p) => (p.id === id ? { ...p, ...fields } : p));
  saveProfiles(list);
  if (cloudEnabled() && !id.startsWith('profile_') && id !== 'default_main') {
    try {
      const patch: any = { name: fields.name, avatar_color: fields.avatar_color,
        is_kids: fields.is_kids, max_rating: fields.max_rating };
      // avatar_url was reaching localStorage but never the DB, so a chosen avatar
      // vanished on the next hydrate from cloud.
      if (fields.avatar_url !== undefined) patch.avatar_url = fields.avatar_url;
      if (fields.allowed_ratings !== undefined) patch.allowed_ratings = fields.allowed_ratings;
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

/** The profile the user last explicitly chose on this device, or null if they
 *  haven't chosen one yet. Unlike getActiveProfile() this does NOT fall back to
 *  a default — boot has to tell "resume this session" apart from "show the
 *  picker", and defaulting would silently drop a kids profile into an adult one.
 *  Returns null if the stored profile no longer exists (deleted elsewhere). */
export function getPersistedActiveProfile(): HouseholdProfile | null {
  try {
    const raw = localStorage.getItem(ACTIVE_PROFILE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.id) return null;
    const list = getStoredProfiles();
    // A profile deleted on another device must not resurrect a session here.
    if (list.length > 0 && !list.some((p) => p.id === parsed.id)) return null;
    return parsed as HouseholdProfile;
  } catch {
    return null;
  }
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

  // A restricted profile with no adult PIN anywhere is an unlocked lock: the exit
  // gate in the click handler below falls open. Setting a PIN is the parent's
  // choice, so this is a reminder rather than a block — but it has to stay easy
  // to find after declining the prompt at profile creation.
  const kidsProfileExists = profiles.some((p) => p.is_kids);
  const adultPinIsSet = profiles.some((p) => !p.is_kids && p.pin);
  const showLockWarning = kidsProfileExists && !adultPinIsSet;

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
      
      <div id="avatarsContainer" style="display: flex; gap: 24px; justify-content: center; flex-wrap: wrap; margin-bottom: 40px;">
        ${profiles.map(p => `
          <button class="profileAvatarBtn" data-id="${p.id}" style="
            background: none; border: none; cursor: pointer; display: flex; flex-direction: column; align-items: center; gap: 14px; transition: transform 0.2s ease, opacity 0.2s; outline: none; position: relative;
          ">
            <div style="
              width: 100px; height: 100px; border-radius: 20px; background: ${p.avatar_url ? `url('${p.avatar_url}') center/cover` : p.avatar_color}; display: flex; align-items: center; justify-content: center; font-size: 40px; font-weight: 800; color: #06070a; box-shadow: ${p.id === active.id ? '0 0 0 4px #c5f04e, 0 12px 30px rgba(197,240,78,0.4)' : '0 8px 24px rgba(0,0,0,0.5)'}; position: relative;
            ">
              ${p.avatar_url ? '' : p.name.charAt(0).toUpperCase()}
              <div class="editOverlay" style="display: none; position: absolute; inset: 0; background: rgba(0,0,0,0.6); border-radius: 20px; align-items: center; justify-content: center;">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
              </div>
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

      ${showLockWarning ? `
      <div style="display:flex;align-items:center;gap:14px;text-align:left;max-width:520px;margin:0 auto 22px;padding:14px 18px;border-radius:14px;background:rgba(197,240,78,0.07);border:1px solid rgba(197,240,78,0.28);">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#c5f04e" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex:none;"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 9.9-1"></path></svg>
        <div style="flex:1;">
          <div style="font-size:14px;font-weight:800;margin-bottom:2px;">Kids mode isn't locked</div>
          <div style="font-size:12.5px;line-height:1.5;color:#9aa5b5;">Without a PIN on an adult profile, anyone can switch out of a restricted profile.</div>
        </div>
        <button id="setAdultPinBtn" style="flex:none;background:#c5f04e;border:none;color:#06070a;padding:9px 16px;border-radius:9px;font-size:13px;font-weight:800;cursor:pointer;">Set PIN</button>
      </div>` : ''}

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

  let isEditing = false;

  const btns = modal.querySelectorAll('.profileAvatarBtn');
  btns.forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = (btn as HTMLElement).dataset.id;
      const target = profiles.find(p => p.id === id);
      if (!target) return;

      if (isEditing) {
        modal.remove();
        openProfileEditor(target);
        return;
      }

      // Parental lock, correctly oriented. Entering a kids profile is NEVER
      // gated — a child has to be able to reach their own profile. What needs a
      // PIN is LEAVING one. The previous check was `if (target.pin)`, which
      // locked a child out of their own profile and let them walk out to any
      // adult profile that happened to have no PIN of its own.
      const leavingKids = !!active.is_kids && target.id !== active.id;
      if (leavingKids) {
        // Prefer the destination's own PIN when it has one (proves adult AND
        // targets correctly); otherwise fall back to any adult PIN set up in
        // the household. Only one prompt either way.
        const ok = (!target.is_kids && target.pin)
          ? await promptForPin(target)
          : await requireAdultAuth();
        if (!ok) return; // stay on "Who's Watching"
      } else if (!target.is_kids && target.pin && target.id !== active.id) {
        // Adult -> a different, PIN-protected adult profile.
        const ok = await promptForPin(target);
        if (!ok) return;
      }

      setActiveProfile(target);
      modal.remove();
      if (onSelectProfile) onSelectProfile(target);
    });
  });

  const setPinBtn = modal.querySelector('#setAdultPinBtn');
  if (setPinBtn) {
    setPinBtn.addEventListener('click', async () => {
      await ensureAdultPinExists();
      // Re-open so the banner reflects the new state (and clears on success).
      modal.remove();
      openProfileSwitcher(onSelectProfile);
    });
  }

  const requireAdultAuth = async (): Promise<boolean> => {
    if (!active.is_kids) return true;
    const adultProfs = profiles.filter(p => !p.is_kids && p.pin);
    if (adultProfs.length === 0) return true;
    return await promptForPin(adultProfs[0]!);
  };

  const addBtn = modal.querySelector('#addProfileBtn');
  if (addBtn) {
    addBtn.addEventListener('click', async () => {
      if (!(await requireAdultAuth())) return;
      
      const acct = await db.getAccount();
      const maxSeats = acct?.seats || 3;
      if (profiles.length >= maxSeats) {
        modal.innerHTML = `
          <div style="flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 38px; padding: 0 60px 40px; width: 100%; height: 100%; background: #0A0B0E;">
            <div style="display: flex; align-items: center; gap: 18px">
              ${profiles.map(p => `<div style="width: 84px; height: 84px; border-radius: 50%; background: ${p.avatar_color || '#C6F53A'}; color: #0A0B0E; font-size: 30px; font-weight: 800; display: flex; align-items: center; justify-content: center">${p.name.charAt(0).toUpperCase()}</div>`).join('')}
              <div style="width: 84px; height: 84px; border-radius: 50%; border: 2px dashed #2B303A; display: flex; align-items: center; justify-content: center">
                <svg viewBox="0 0 24 24" fill="none" stroke="#C6F53A" stroke-width="2" stroke-linecap="round" style="width: 30px; height: 30px"><path d="M12 6v12M6 12h12"></path></svg>
              </div>
            </div>
            <div style="display: flex; flex-direction: column; align-items: center; gap: 12px; max-width: 540px; text-align: center">
              <div style="font-size: 30px; font-weight: 800; letter-spacing: -0.03em; color: #fff">Your household is full</div>
              <div style="font-size: 16px; font-weight: 500; line-height: 1.55; color: #7C828C; text-wrap: pretty">All ${profiles.length} seats are in use. Add an extra seat for $1.50 a month, or free one up from settings.</div>
            </div>
            <div style="display: flex; gap: 14px">
              <button id="closeFullBtn" style="padding: 15px 26px; border-radius: 10px; background: #C6F53A; color: #0A0B0E; font-size: 15px; font-weight: 800; cursor: pointer; border: none;">Go back</button>
              <button onclick="window.location.reload()" style="padding: 15px 26px; border-radius: 10px; border: 1px solid #23272F; color: #D6DAE0; font-size: 15px; font-weight: 700; background: transparent; cursor: pointer;">Manage seats</button>
            </div>
          </div>
        `;
        const closeBtn = modal.querySelector('#closeFullBtn');
        if (closeBtn) closeBtn.addEventListener('click', () => { modal.remove(); openProfileSwitcher(); });
        return;
      }

      modal.remove();
      openProfileEditor();
    });
  }

  const manageBtn = modal.querySelector('#manageProfilesBtn');
  if (manageBtn) {
    manageBtn.addEventListener('click', async () => {
      if (!isEditing && !(await requireAdultAuth())) return;
      isEditing = !isEditing;
      manageBtn.innerHTML = isEditing ? 'Done' : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"></path><circle cx="12" cy="12" r="3"></circle></svg>Manage Profiles';
      (manageBtn as HTMLElement).style.background = isEditing ? '#fff' : 'rgba(255,255,255,0.08)';
      (manageBtn as HTMLElement).style.color = isEditing ? '#06070a' : '#fff';

      btns.forEach(btn => {
        const overlay = btn.querySelector('.editOverlay') as HTMLElement;
        if (overlay) overlay.style.display = isEditing ? 'flex' : 'none';
        (btn as HTMLElement).style.opacity = isEditing ? '0.8' : '1';
      });
      
      const addB = modal.querySelector('#addProfileBtn') as HTMLElement;
      if (addB) addB.style.opacity = isEditing ? '0.3' : '1';
      if (addB) addB.style.pointerEvents = isEditing ? 'none' : 'auto';
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

export function openProfileEditor(editingProfile?: HouseholdProfile, onClose?: () => void): void {
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
  const pAvatarUrl = editingProfile?.avatar_url || '';
  const pKids = !!editingProfile?.is_kids;
  const pRating = editingProfile?.max_rating || '';

  const PRESET_AVATARS = [
    '', // None (use initial)
    'https://api.dicebear.com/9.x/bottts/svg?seed=Felix',
    'https://api.dicebear.com/9.x/bottts/svg?seed=Aneka',
    'https://api.dicebear.com/9.x/bottts/svg?seed=Liam',
    'https://api.dicebear.com/9.x/bottts/svg?seed=Jude',
    'https://api.dicebear.com/9.x/bottts/svg?seed=Sarah'
  ];

  modal.innerHTML = `
    <div style="background: #10141e; border: 1px solid rgba(255,255,255,0.15); border-radius: 24px; max-width: 460px; width: 100%; padding: 32px; box-shadow: 0 24px 60px rgba(0,0,0,0.9);">
      <h2 style="margin: 0 0 20px; font-size: 24px; font-weight: 800;">${isEdit ? 'Edit Profile' : 'Create New Profile'}</h2>
      
      <div style="margin-bottom: 20px;">
        <label style="display: block; font-size: 13px; color: #9aa5b5; margin-bottom: 8px; font-weight: 700;">PROFILE NAME</label>
        <input type="text" id="editName" value="${escapeHtml(pName)}" placeholder="e.g. Living Room, Sarah" style="width: 100%; padding: 12px 16px; background: #080a10; border: 1px solid rgba(255,255,255,0.15); border-radius: 10px; color: #fff; font-size: 15px; outline: none;" />
      </div>

      <div style="margin-bottom: 24px;">
        <label style="display: block; font-size: 13px; color: #9aa5b5; margin-bottom: 8px; font-weight: 700;">AVATAR COLOR</label>
        <div style="display: flex; gap: 12px; margin-bottom: 16px;" id="colorPickerRow">
          ${['#c5f04e', '#ff5e7e', '#06d6a0', '#118ab2', '#ffd166', '#a78bfa'].map(c => `
            <button class="colorChoiceBtn ${c === pColor ? 'selected' : ''}" data-color="${c}" style="
              width: 38px; height: 38px; border-radius: 10px; background: ${c}; border: ${c === pColor ? '3px solid #fff' : 'none'}; cursor: pointer;
            "></button>
          `).join('')}
        </div>
        <label style="display: block; font-size: 13px; color: #9aa5b5; margin-bottom: 8px; font-weight: 700;">AVATAR IMAGE</label>
        <div style="display: flex; gap: 12px; flex-wrap: wrap;" id="avatarPickerRow">
          ${PRESET_AVATARS.map(url => `
            <button class="avatarChoiceBtn" data-url="${url}" style="
              width: 48px; height: 48px; border-radius: 12px; background: ${url ? `url('${url}') center/cover` : '#080a10'}; border: ${url === pAvatarUrl ? '3px solid #fff' : '1px solid rgba(255,255,255,0.1)'}; cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 18px; color: #9aa5b5; transition: border 0.2s;
            ">${url ? '' : 'A'}</button>
          `).join('')}
        </div>
      </div>

      <div style="margin-bottom: 24px; background:#080a10; border:1px solid rgba(255,255,255,0.1); border-radius:12px; padding:16px;">
        <label style="display:block; font-size:13px; color:#9aa5b5; margin-bottom:4px; font-weight:700;">ALLOWED RATINGS</label>
        <div style="font-size:11.5px; color:#7C828C; line-height:1.5; margin-bottom:12px;">
          Pick exactly what this profile may watch. Leave everything unticked for no restriction.
        </div>
        <div id="ratingGroups"></div>
        <div id="ratingSummary" style="font-size:12px; color:#c5f04e; margin-top:12px; font-weight:700;"></div>
      </div>

      <div id="pinFieldWrap" style="margin-bottom: 24px; background:#080a10; border:1px solid rgba(255,255,255,0.1); border-radius:12px; padding:16px; ${pKids ? 'display:none;' : ''}">
        <label style="display:block; font-size:13px; color:#9aa5b5; margin-bottom:8px; font-weight:700;">PARENTAL PIN (OPTIONAL)</label>
        <input type="password" id="editPin" inputmode="numeric" pattern="[0-9]*" maxlength="4" value="" placeholder="${editingProfile?.pin ? 'Set — leave blank to keep' : '4 digits to lock this profile'}" style="width:100%; padding:12px 16px; background:#10141e; border:1px solid rgba(255,255,255,0.15); border-radius:10px; color:#fff; font-size:15px; letter-spacing:4px; outline:none;" />
        <div style="font-size:11px; color:#9aa5b5; margin-top:6px;">Anyone switching into this profile must enter the PIN.${editingProfile?.pin ? ' <button type="button" id="clearPinBtn" style="background:none;border:none;color:#ff6b6b;cursor:pointer;padding:0;font-size:11px;text-decoration:underline;">Remove PIN</button>' : ''}</div>
      </div>

      <div style="display: flex; gap: 12px; margin-bottom: ${isEdit && editingProfile?.id !== 'default_main' ? '12px' : '0'};">
        <button id="cancelEditBtn" style="flex: 1; padding: 12px; border-radius: 10px; background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.1); color: #fff; font-weight: 700; cursor: pointer;">Cancel</button>
        <button id="saveProfileBtn" style="flex: 1; padding: 12px; border-radius: 10px; background: #c5f04e; border: none; color: #06070a; font-weight: 700; cursor: pointer;">Save Profile</button>
      </div>
      ${isEdit && editingProfile?.id !== 'default_main' ? `<button id="deleteProfileBtn" style="width: 100%; padding: 12px; border-radius: 10px; background: rgba(255,94,126,0.1); border: 1px solid rgba(255,94,126,0.3); color: #ff5e7e; font-weight: 700; cursor: pointer; transition: all 0.2s;">Delete Profile</button>` : ''}
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

  let selectedAvatarUrl = pAvatarUrl;
  const avatarBtns = modal.querySelectorAll('.avatarChoiceBtn');
  avatarBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      avatarBtns.forEach(b => (b as HTMLElement).style.border = '1px solid rgba(255,255,255,0.1)');
      (btn as HTMLElement).style.border = '3px solid #fff';
      selectedAvatarUrl = (btn as HTMLElement).dataset.url || '';
    });
  });

  const ratingGroups = modal.querySelector('#ratingGroups') as HTMLElement | null;
  const ratingSummary = modal.querySelector('#ratingSummary') as HTMLElement | null;
  const pinWrap = modal.querySelector('#pinFieldWrap') as HTMLElement | null;


  // Selected ratings, seeded from the profile's explicit set or, for a profile
  // saved before the change, by expanding its old ceiling.
  const selected = new Set<string>(allowedRatingsFor(editingProfile ?? { max_rating: pRating }) ?? []);
  if (!editingProfile && pKids && !selected.size) selected.add('TV-Y');

  const KID_ONLY = new Set(['TV-Y', 'TV-Y7', 'TV-Y7-FV', 'TV-G', 'TV-PG']);

  if (ratingGroups && ratingSummary) {
    ratingGroups.innerHTML = RATING_GROUPS.map((g) => `
      <div style="margin-bottom:14px;">
        <div style="font-size:11px;font-weight:800;color:#9aa5b5;letter-spacing:.06em;text-transform:uppercase;">${escapeHtml(g.system)}</div>
        <div style="font-size:11px;color:#7C828C;margin:2px 0 8px;line-height:1.45;">${escapeHtml(g.note)}</div>
        ${g.ratings.map((r) => `
          <label style="display:flex;align-items:center;gap:9px;padding:6px 4px;cursor:pointer;font-size:12.5px;">
            <input type="checkbox" data-rating="${r.code}" style="accent-color:#c5f04e;width:15px;height:15px;cursor:pointer;" />
            <span>${escapeHtml(r.label)}</span>
          </label>`).join('')}
      </div>`).join('');

    const boxes = Array.from(ratingGroups.querySelectorAll<HTMLInputElement>('input[data-rating]'));
    const paint = () => {
      for (const b of boxes) b.checked = selected.has(b.dataset.rating!);
      const n = selected.size;
      ratingSummary.textContent = n === 0
        ? 'No restriction — this profile can watch everything.'
        : `${n} rating${n === 1 ? '' : 's'} allowed`;
      ratingSummary.style.color = n === 0 ? '#ff6b6b' : '#c5f04e';
      if (pinWrap) pinWrap.style.display = n === 0 ? '' : 'none';
    };

    for (const b of boxes) {
      b.addEventListener('change', async () => {
        const code = b.dataset.rating!;
        if (!b.checked) { selected.delete(code); paint(); return; }

        // Warn once when an MPAA letter is added to an otherwise kid-rated
        // profile. The letters are not interchangeable with the TV ones: PG-13
        // did not exist until 1984, so pre-1984 PG absorbed what would now be
        // PG-13, and we hold no release year for most of the catalog.
        const kidProfile = [...selected].every((r) => KID_ONLY.has(r)) && selected.size > 0;
        const isMpaa = !r_isTv(code);
        if (isMpaa && kidProfile && !localStorage.getItem('veedeeoh_mpaa_warning_ack')) {
          b.checked = false;
          const ok = await mpaaWarning(code);
          if (!ok) { paint(); return; }
          b.checked = true;
        }
        selected.add(code);
        paint();
      });
    }
    paint();
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

  const delBtn = modal.querySelector('#deleteProfileBtn');
  if (delBtn) {
    delBtn.addEventListener('click', async () => {
      if (!confirm('Are you sure you want to delete this profile?')) return;
      if (editingProfile) {
        const list = getStoredProfiles().filter(p => p.id !== editingProfile.id);
        saveProfiles(list);
        if (cloudEnabled() && !editingProfile.id.startsWith('profile_')) {
          try { await db.deleteProfile(editingProfile.id); } catch {}
        }
        if (getActiveProfile().id === editingProfile.id) setActiveProfile(list[0]!);
      }
      modal.remove();
      if (onClose) onClose();
      else openProfileSwitcher();
    });
  }

  const saveBtn = modal.querySelector('#saveProfileBtn');
  const cancelBtn = modal.querySelector('#cancelEditBtn');

  if (cancelBtn) cancelBtn.addEventListener('click', () => {
    modal.remove();
    if (onClose) onClose();
    else openProfileSwitcher();
  });

  if (saveBtn) {
    saveBtn.addEventListener('click', async () => {
      const nameInput = (modal.querySelector('#editName') as HTMLInputElement).value.trim();

      if (!nameInput) {
        alert('Please enter a profile name.');
        return;
      }

      // is_kids drives the kids CHROME (bright theme, stripped sidebar), not the
      // content gate -- allowed_ratings does that. A profile limited to the two
      // youngest TV ratings gets the kids skin; anything broader does not.
      const allowedList = [...selected];
      const isKids = allowedList.length > 0 && allowedList.every((r) => r === 'TV-Y' || r === 'TV-Y7' || r === 'TV-Y7-FV');
      // max_rating is kept in sync as a coarse legacy value for anything still
      // reading it; allowed_ratings is the source of truth.
      const maxRating = allowedList.length ? (allowedList.includes('TV-14') ? 'TV-14' : allowedList.includes('TV-G') || allowedList.includes('TV-PG') ? 'TV-G' : 'TV-Y') : null;

      const rawPin = ((modal.querySelector('#editPin') as HTMLInputElement | null)?.value || '').trim();
      let pin: string | null | undefined = undefined;
      
      // If the user tries to clear the PIN or set a new one, verify the old PIN first if it exists
      if ((clearPinRequested || rawPin) && editingProfile?.pin) {
        const oldPin = prompt('Please enter the current 4-digit PIN to authorize this change:');
        if (!oldPin) return; // User cancelled
        const h = await hashPin(oldPin);
        if (h !== editingProfile.pin) {
          alert('Incorrect PIN.');
          return;
        }
      }

      if (isKids || clearPinRequested) {
        pin = null; 
      } else if (rawPin) {
        if (!/^\d{4}$/.test(rawPin)) { alert('PIN must be exactly 4 digits.'); (saveBtn as HTMLButtonElement).disabled = false; return; }
        pin = await hashPin(rawPin);
      }

      const fields: { name: string; avatar_color: string; avatar_url: string | null; is_kids: boolean; max_rating: string | null; allowed_ratings: string[] | null; pin?: string | null } =
        { name: nameInput, avatar_color: selectedColor, avatar_url: selectedAvatarUrl || null, is_kids: isKids, max_rating: maxRating, allowed_ratings: allowedList.length ? allowedList : null };
      if (pin !== undefined) fields.pin = pin;

      (saveBtn as HTMLButtonElement).disabled = true;
      try {
        if (isEdit && editingProfile) {
          await updateProfileEverywhere(editingProfile.id, fields);
        } else {
          await createProfileEverywhere(fields);
        }
        // A restricted profile is only a restriction if an adult PIN exists to
        // gate the way out. Prompt for one now rather than leaving the lock
        // silently open. Runs after the save so declining still keeps the profile.
        if (isKids) await ensureAdultPinExists(isEdit ? editingProfile?.id : undefined);
      } catch (e) {
        console.warn('[profiles] save failed', e);
      }

      modal.remove();
      if (onClose) onClose();
      else openProfileSwitcher();
    });
  }
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
