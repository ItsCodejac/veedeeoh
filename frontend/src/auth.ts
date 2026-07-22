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

export function signOut(): void {
  localStorage.removeItem(AUTH_KEY);
  eraseCookie(AUTH_KEY);
  try {
    getSupabase().auth.signOut();
  } catch {}
  if (isCloudMode()) {
    window.location.href = '/landing.html';
  } else {
    window.location.href = '/';
  }
}

export async function signIn(email: string, password: string): Promise<{ mustChangePassword: boolean }> {
  const { data, error } = await getSupabase().auth.signInWithPassword({
    email: email.trim().toLowerCase(),
    password
  });

  if (error || !data.session) {
    throw new Error(error?.message || 'Invalid email or password.');
  }

  setSession(data.user.email!, data.session.access_token);

  const mustChangePassword = !!data.user.user_metadata?.must_change_password;
  return { mustChangePassword };
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
  } else {
    setSession(cleanEmail);
  }
}
