import * as path from 'node:path';
import { DATA_DIR, JsonStore } from './store';

export interface LocalFavorite { content_id: string; title: string | null; poster: string | null }
export interface LocalProgress {
  content_id: string; title: string | null; position_secs: number;
  duration_secs: number | null; completed: boolean; updated_at: string;
  stream_idx?: number; episode_title?: string | null;
}
interface ProfileLibrary { favorites: LocalFavorite[]; progress: LocalProgress[] }
interface LibraryData { version: 1; profiles: Record<string, ProfileLibrary> }

/** Browser-local profile IDs identify shelves, not accounts or access permissions. */
export function localProfile(raw?: string): string {
  const id = raw || 'default_main';
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(id)) throw new Error('Invalid local profile');
  return '$' + id;
}

export class LocalLibrary {
  private store: JsonStore<LibraryData>;
  private data: LibraryData;
  constructor(dir = DATA_DIR) {
    this.store = new JsonStore(path.join(dir, 'library.json'), { version: 1, profiles: {} });
    this.data = this.store.load();
    if (this.data.version !== 1 || !this.data.profiles || typeof this.data.profiles !== 'object' || Array.isArray(this.data.profiles) ||
        Object.values(this.data.profiles).some(value => !value || !Array.isArray(value.favorites) || !Array.isArray(value.progress))) {
      throw new Error('Unsupported local library format; restore a compatible backup.');
    }
    if (!Object.hasOwn(this.data.profiles, '$default_main')) {
      // Preserve the older instance-wide sets without changing their source files.
      const favorites = new JsonStore<string[]>(path.join(dir, 'favorites.json'), []).load();
      const watched = new JsonStore<string[]>(path.join(dir, 'watched.json'), []).load();
      if (!Array.isArray(favorites) || !Array.isArray(watched) || [...favorites, ...watched].some(id => typeof id !== 'string')) {
        throw new Error('Invalid legacy library data; restore a compatible backup.');
      }
      this.data.profiles.$default_main = {
        favorites: favorites.map(content_id => ({ content_id, title: null, poster: null })),
        progress: watched.map(content_id => ({ content_id, title: null, position_secs: 0,
          duration_secs: null, completed: true, updated_at: new Date(0).toISOString() })),
      };
    }
  }
  read(profile?: string): ProfileLibrary {
    const value = this.data.profiles[localProfile(profile)] || { favorites: [], progress: [] };
    return structuredClone(value);
  }
  private update(profile: string | undefined, change: (data: ProfileLibrary) => void): void {
    const key = localProfile(profile), value = this.read(profile);
    change(value);
    const next: LibraryData = { version: 1, profiles: { ...this.data.profiles, [key]: value } };
    this.store.save(next); // Publish to memory only after the disk write succeeds.
    this.data = next;
  }
  favorite(profile: string | undefined, row: LocalFavorite): void {
    this.update(profile, data => { data.favorites = data.favorites.filter(x => x.content_id !== row.content_id); data.favorites.push(row); });
  }
  removeFavorite(profile: string | undefined, id: string): void {
    this.update(profile, data => { data.favorites = data.favorites.filter(x => x.content_id !== id); });
  }
  progress(profile: string | undefined, row: LocalProgress): void {
    this.update(profile, data => {
      data.progress = [row, ...data.progress.filter(x => x.content_id !== row.content_id)].slice(0, 500);
    });
  }
  watched(profile: string | undefined, id: string, completed: boolean): void {
    const old = this.read(profile).progress.find(x => x.content_id === id);
    this.progress(profile, { content_id: id, title: null, position_secs: 0, duration_secs: null,
      ...old, completed, updated_at: new Date().toISOString() });
  }
}
