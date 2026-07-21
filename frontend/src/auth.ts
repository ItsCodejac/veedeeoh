/// <reference types="vite/client" />

export interface AuthSession {
  email: string;
  authenticatedAt: string;
  access_token?: string;
}

const AUTH_KEY = 'veedeeoh_cloud_session';

export function isCloudMode(): boolean {
  return typeof window !== 'undefined' && window.location.hostname.includes('vercel.app');
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

export function setSession(email: string): void {
  const session: AuthSession = {
    email: email.toLowerCase(),
    authenticatedAt: new Date().toISOString(),
    access_token: 'auth_' + btoa(email.toLowerCase())
  };
  localStorage.setItem(AUTH_KEY, JSON.stringify(session));
}

export function signOut(): void {
  localStorage.removeItem(AUTH_KEY);
  window.location.href = '/landing.html';
}

export async function signIn(email: string): Promise<boolean> {
  const normalized = email.trim().toLowerCase();
  
  const res = await fetch('/api/auth/authorize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: normalized })
  });

  const data = await res.json();
  if (!res.ok || !data.authorized) {
    throw new Error(data.error || 'Access is reserved for invited waitlist members.');
  }

  setSession(normalized);
  return true;
}
