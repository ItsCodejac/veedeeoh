/// <reference types="vite/client" />
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

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
  supabase.auth.signOut();
  window.location.href = '/landing.html';
}

/**
 * Sign in with email + password.
 * Returns { mustChangePassword: true } if the user has a temp password that must be changed.
 */
export async function signIn(email: string, password: string): Promise<{ mustChangePassword: boolean }> {
  const { data, error } = await supabase.auth.signInWithPassword({
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
