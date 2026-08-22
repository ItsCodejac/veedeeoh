/// <reference types="vite/client" />
import { createClient, SupabaseClient } from '@supabase/supabase-js';

let _supabase: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!_supabase) {
    const url = (import.meta.env.VITE_SUPABASE_URL as string) || "https://fwlbmksxmfzgkazrulgt.supabase.co";
    const key = (import.meta.env.VITE_SUPABASE_ANON_KEY as string) || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ3bGJta3N4bWZ6Z2thenJ1bGd0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ2NTk5MTQsImV4cCI6MjEwMDIzNTkxNH0.oql8BpFvpCc2tS-e4ETFLonnDZWMU5PlTosp9FMTyAI";
    _supabase = createClient(url, key, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storageKey: 'veedeeoh_supabase_auth_session'
      }
    });

    _supabase.auth.onAuthStateChange((event, session) => {
      if (session && session.user && session.user.email) {
        setSession(session.user.email!, session.access_token);
      } else if (event === 'SIGNED_OUT') {
        localStorage.removeItem(AUTH_KEY);
      }
    });
  }
  return _supabase;
}

export interface AuthSession {
  email: string;
  authenticatedAt: string;
  access_token?: string;
}

const AUTH_KEY = 'veedeeoh_cloud_session';

export function isCloudMode(): boolean {
  return typeof window !== 'undefined' && (
    window.location.hostname.includes('vercel.app') ||
    window.location.hostname.includes('veedeeoh')
  );
}

function setCookie(name: string, value: string, days = 365): void {
  try {
    const expires = new Date(Date.now() + days * 864e5).toUTCString();
    document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/; SameSite=Lax; Secure`;
  } catch {}
}

function getCookie(name: string): string | null {
  try {
    const match = document.cookie.split('; ').find(row => row.startsWith(`${name}=`));
    if (!match) return null;
    const parts = match.split('=');
    return parts[1] ? decodeURIComponent(parts[1]) : null;
  } catch {
    return null;
  }
}

function eraseCookie(name: string): void {
  try {
    document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; SameSite=Lax; Secure`;
  } catch {}
}

export function getSession(): AuthSession | null {
  try {
    const raw = localStorage.getItem(AUTH_KEY) || getCookie(AUTH_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw);
    if (!localStorage.getItem(AUTH_KEY)) {
      localStorage.setItem(AUTH_KEY, raw);
    }
    return session;
  } catch {
    return null;
  }
}

export async function restoreSession(): Promise<AuthSession | null> {
  let session = getSession();
  if (session) return session;

  try {
    const client = getSupabase();
    const { data } = await client.auth.getSession();
    if (data?.session?.user?.email) {
      setSession(data.session.user.email!, data.session.access_token);
      return getSession();
    }
  } catch (err) {
    console.warn('[Auth] Supabase session recovery warning:', err);
  }

  return null;
}

export function setSession(email: string, access_token?: string): void {
  const session: AuthSession = {
    email: email.toLowerCase(),
    authenticatedAt: new Date().toISOString(),
    access_token
  };
  const json = JSON.stringify(session);
  localStorage.setItem(AUTH_KEY, json);
  setCookie(AUTH_KEY, json, 365);
}

export async function signOut(): Promise<void> {
  // The account cache is keyed to nothing but time, so a second person signing
  // in on this device within the TTL would inherit the previous account's tier.
  void import("./db").then((db) => db.invalidateAccount()).catch(() => {});
  // Await Supabase clearing its own stored session BEFORE navigating. Otherwise
  // the landing page's auth check races the still-present session, bounces back
  // into the app, and boot's access gate fires against a half-torn-down session
  // (which reads as "no account" and wrongly shows the trial-ended paywall).
  try {
    await getSupabase().auth.signOut();
  } catch {}
  localStorage.removeItem(AUTH_KEY);
  // Profile state is per ACCOUNT, so it must not survive a sign-out. Boot now
  // restores the persisted profile rather than always showing the picker, so
  // leaving these behind drops the next person to sign in straight into the
  // previous account's profile -- including a kids one, applying its rating
  // limits to somebody else's library.
  localStorage.removeItem('veedeeoh_active_profile');
  localStorage.removeItem('veedeeoh_household_profiles');
  eraseCookie(AUTH_KEY);
  if (isCloudMode()) {
    window.location.href = '/landing.html';
  } else {
    window.location.href = '/';
  }
}

export async function signIn(email: string, password: string): Promise<{ mustChangePassword: boolean }> {
  try {
    const { data, error } = await getSupabase().auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password
    });

    if (error || !data?.session) {
      // Cloud (SaaS) must have a real Supabase session — no local bypass.
      if (isCloudMode()) throw new Error(error?.message || "Invalid email or password.");
      setSession(email.trim().toLowerCase()); // self-host only (no Supabase)
      return { mustChangePassword: false };
    }

    setSession(data.user.email!, data.session.access_token);
    const mustChangePassword = !!data.user.user_metadata?.must_change_password;
    return { mustChangePassword };
  } catch (e) {
    if (isCloudMode()) throw e; // don't grant access on failure in the cloud
    setSession(email.trim().toLowerCase());
    return { mustChangePassword: false };
  }
}

/** Magic-link (passwordless email). Sends a one-time login link — no provider
 *  console setup required. Clicking it returns to the app with a live session. */
export async function signInWithMagicLink(email: string): Promise<void> {
  const { error } = await getSupabase().auth.signInWithOtp({
    email: email.trim().toLowerCase(),
    options: { emailRedirectTo: `${window.location.origin}/index.html` },
  });
  if (error) throw error;
}

/** Google OAuth. Redirects to Google, then back to the app; getSupabase()'s
 *  detectSessionInUrl establishes the session on return. Requires the Google
 *  provider to be enabled in Supabase with a Google Cloud OAuth client. */
export async function signInWithGoogle(): Promise<void> {
  const { error } = await getSupabase().auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: `${window.location.origin}/index.html` },
  });
  if (error) throw error;
}

export async function signUp(email: string, password: string): Promise<void> {
  const cleanEmail = email.trim().toLowerCase();
  const supabase = getSupabase();
  const { data, error } = await supabase.auth.signUp({
    email: cleanEmail,
    password
  });

  if (error) {
    throw new Error(error.message || 'Account registration failed.');
  }

  if (data.session) {
    setSession(cleanEmail, data.session.access_token);
  } else if (!isCloudMode()) {
    setSession(cleanEmail); // self-host only
  } else {
    // Cloud: no session yet means email confirmation is required — don't grant
    // a local session (that would bypass the gate).
    throw new Error("Account created. Check your email to confirm, then sign in.");
  }
}

/** Sign in using WebAuthn Passkeys */
export async function signInWithPasskey(): Promise<void> {
  const { data, error } = await getSupabase().auth.signInWithPasskey();
  if (error) throw error;
  if (data?.session) {
    setSession(data.session.user.email || 'user', data.session.access_token);
  }
}
