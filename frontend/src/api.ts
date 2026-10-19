import type { Catalog, VodEpisode, VodRail } from "./types";
import { state } from "./state";
import { getSession, isCloudMode } from "./auth";
import { getActiveProfile } from "./profiles";

// The active profile's real Supabase id, or null for local/unsynced placeholders
// ('default_main' and 'profile_<ts>' are not valid household_profiles rows).
function activeProfileId(): string | null {
  const id = getActiveProfile().id;
  if (!isCloudMode()) return id || "default_main";
  return id && !id.startsWith("default_") && !id.startsWith("profile_") ? id : null;
}

async function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const session = await getSession();
  const headers = new Headers(init?.headers);
  if (session?.access_token) {
    headers.set('Authorization', `Bearer ${session.access_token}`);
  }
  return fetch(input, { ...init, headers });
}

export async function fetchCatalog(): Promise<Catalog> {
  const pid = activeProfileId();
  const res = await apiFetch(`/api/catalog${pid ? `?profileId=${encodeURIComponent(pid)}` : ""}`);
  if (!res.ok) throw new Error(`catalog fetch failed: ${res.status}`);
  return res.json();
}

export function getActiveRegion(): string {
  return localStorage.getItem("tvlc_region") || "US";
}

export function setActiveRegion(region: string): void {
  localStorage.setItem("tvlc_region", region);
}

export interface CatalogStats {
  totalTitles: number;
  moviesCount: number;
  showsCount: number;
}

export interface VodResponse {
  rails: VodRail[];
  stats: CatalogStats;
}

export async function fetchVod(region?: string): Promise<VodResponse> {
  try {
    const reg = region || getActiveRegion();
    const res = await apiFetch(`/api/vod?region=${encodeURIComponent(reg)}`);
    if (!res.ok) return { rails: [], stats: { totalTitles: 0, moviesCount: 0, showsCount: 0 } };
    const data = await res.json();
    return {
      rails: data.rails ?? [],
      stats: data.stats ?? { totalTitles: 0, moviesCount: 0, showsCount: 0 }
    };
  } catch {
    return { rails: [], stats: { totalTitles: 0, moviesCount: 0, showsCount: 0 } };
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

/** Resolve a Pluto movie's signed HLS URL on demand. The catalog stores only the
 *  short unsigned path, so the 24h JWT is minted fresh at play time. */
export async function fetchPlutoStream(path: string): Promise<string> {
  const res = await apiFetch(`/api/vod/pluto?path=${encodeURIComponent(path)}&region=${encodeURIComponent(getActiveRegion())}`);
  if (!res.ok) throw new Error(`pluto fetch failed: ${res.status}`);
  return (await res.json()).url;
}

/** Resolve a Tubi movie's HLS stream on demand (movies carry no URL in the catalog). */
export async function fetchTubiStream(tubiId: string): Promise<string> {
  const res = await apiFetch(`/api/vod/tubi/${encodeURIComponent(tubiId)}`);
  if (!res.ok) throw new Error(`tubi fetch failed: ${res.status}`);
  return (await res.json()).url;
}

// Returns the content ids the active profile has completed (for the ✓ marks).
export async function fetchWatched(): Promise<string[]> {
  const pid = activeProfileId();
  if (!pid) return [];
  try {
    const res = await apiFetch(`/api/watched?profileId=${encodeURIComponent(pid)}`);
    if (!res.ok) return [];
    const rows = (await res.json())?.watched ?? [];
    return rows.filter((r: any) => r.completed).map((r: any) => r.content_id as string);
  } catch {
    return [];
  }
}

export async function toggleWatched(episodeId: string, force?: boolean): Promise<boolean> {
  const current = state.watched.has(episodeId);
  const target = force !== undefined ? force : !current;
  if (target === current) return current;
  const pid = activeProfileId();
  if (target) state.watched.add(episodeId); else state.watched.delete(episodeId);
  try {
    if (pid) {
      const response = target
        ? await apiFetch(`/api/watched?profileId=${encodeURIComponent(pid)}`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ profileId: pid, contentId: episodeId, completed: true }),
        })
        : await apiFetch(`/api/watched/${encodeURIComponent(episodeId)}?profileId=${encodeURIComponent(pid)}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Could not save watched history.");
    }
    return target;
  } catch (error) {
    if (current) state.watched.add(episodeId); else state.watched.delete(episodeId);
    throw error;
  }
}

/** Refresh one local shelf without letting an older profile request overwrite a newer selection. */
export async function refreshLocalLibrary(): Promise<void> {
  if (isCloudMode()) return;
  const id = activeProfileId();
  const [catalog, watched] = await Promise.all([fetchCatalog(), fetchWatched()]);
  if (id !== activeProfileId()) return;
  state.favorites = new Set(catalog.favorites);
  state.watched = new Set(watched);
}
