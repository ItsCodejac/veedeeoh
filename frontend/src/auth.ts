/// <reference types="vite/client" />
import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Lazy Supabase client — only created when sign-in is attempted.
// This prevents a module-level crash from killing the entire landing page.
let _supabase: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!_supabase) {
    const url = import.meta.env.VITE_SUPABASE_URL as string;
    const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
    _supabase = createClient(url, key);
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

export function getSession(): AuthSession | null {
  try {
    const raw = localStorage.getItem(AUTH_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function setSession(email: string, access_token?: string): void {
  const session: AuthSession = {
    email: email.toLowerCase(),
    authenticatedAt: new Date().toISOString(),
    access_token
  };
  localStorage.setItem(AUTH_KEY, JSON.stringify(session));
}

export function signOut(): void {
  localStorage.removeItem(AUTH_KEY);
  getSupabase().auth.signOut();
  window.location.href = '/landing.html';
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
