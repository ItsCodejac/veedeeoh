import type { Catalog, Channel, CheckResult } from "./types";
import { state } from "./state";

export async function fetchCatalog(): Promise<Catalog> {
  const res = await fetch("/api/catalog");
  if (!res.ok) throw new Error(`catalog fetch failed: ${res.status}`);
  return res.json();
}

export function checkStream(url: string): Promise<CheckResult> {
  return fetch("/api/check", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  }).then((r) => r.json());
}

export function openInVlc(url: string): Promise<Response> {
  return fetch("/api/vlc", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
}

/** Flip a channel's favorite state locally and persist it; returns the new state. */
export async function toggleFavorite(ch: Channel): Promise<boolean> {
  if (state.favorites.has(ch.id)) {
    state.favorites.delete(ch.id);
    await fetch(`/api/favorites/${encodeURIComponent(ch.id)}`, { method: "DELETE" });
    return false;
  }
  state.favorites.add(ch.id);
  await fetch("/api/favorites", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: ch.id }),
  });
  return true;
}
