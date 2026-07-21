import type { Catalog, VodEpisode, VodRail } from "./types";
import { state } from "./state";
import { getSession } from "./auth";

async function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const session = await getSession();
  const headers = new Headers(init?.headers);
  if (session?.access_token) {
    headers.set('Authorization', `Bearer ${session.access_token}`);
  }
  return fetch(input, { ...init, headers });
}

export async function fetchCatalog(): Promise<Catalog> {
  const res = await apiFetch("/api/catalog");
  if (!res.ok) throw new Error(`catalog fetch failed: ${res.status}`);
  return res.json();
}

export function getActiveRegion(): string {
  return localStorage.getItem("tvlc_region") || "US";
}

export function setActiveRegion(region: string): void {
  localStorage.setItem("tvlc_region", region);
}

export async function fetchVod(region?: string): Promise<VodRail[]> {
  try {
    const reg = region || getActiveRegion();
    const res = await apiFetch(`/api/vod?region=${encodeURIComponent(reg)}`);
    if (!res.ok) return [];
    return (await res.json()).rails ?? [];
  } catch {
    return [];
  }
}

export async function fetchVodSeries(seriesId: string, region?: string): Promise<VodEpisode[]> {
  const reg = region || getActiveRegion();
  const res = await apiFetch(`/api/vod/series/${encodeURIComponent(seriesId)}?region=${encodeURIComponent(reg)}`);
  if (!res.ok) throw new Error(`series fetch failed: ${res.status}`);
  return (await res.json()).episodes ?? [];
}

export async function fetchArchiveStream(identifier: string): Promise<string> {
  const res = await apiFetch(`/api/vod/archive/${encodeURIComponent(identifier)}`);
  if (!res.ok) throw new Error(`archive fetch failed: ${res.status}`);
  return (await res.json()).url;
}

export async function fetchWatched(): Promise<string[]> {
  try {
    const res = await apiFetch("/api/watched");
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}

export async function toggleWatched(episodeId: string, force?: boolean): Promise<boolean> {
  const current = state.watched.has(episodeId);
  const target = force !== undefined ? force : !current;
  
  if (target === current) return current;

  if (target) {
    state.watched.add(episodeId);
    await apiFetch("/api/watched", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: episodeId }),
    });
    return true;
  } else {
    state.watched.delete(episodeId);
    await apiFetch(`/api/watched/${encodeURIComponent(episodeId)}`, { method: "DELETE" });
    return false;
  }
}
