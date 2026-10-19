import * as fs from 'fs';
import * as path from 'path';

function getUserDataDir(appName: string): string {
  if (process.env.VEEDEEOH_DATA_DIR) return path.resolve(process.env.VEEDEEOH_DATA_DIR);
  if (process.env.VERCEL) {
    return '/tmp';
  }
  const home = process.env.HOME || process.env.USERPROFILE || '';
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), appName);
  } else if (process.platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', appName);
  } else {
    return path.join(process.env.XDG_DATA_HOME || path.join(home, '.local', 'share'), appName);
  }
}

export const DATA_DIR = getUserDataDir("tvlc");

export class JsonStore<T> {
  path: string;
  defaultData: T;

  constructor(filePath: string, defaultData: T) {
    this.path = filePath;
    this.defaultData = defaultData;
  }

  load(): T {
    try {
      const data = fs.readFileSync(this.path, 'utf8');
      return JSON.parse(data);
    } catch (error: any) {
      // The hosted waitlist uses an ephemeral, best-effort cache as before.
      if (process.env.VERCEL) return structuredClone(this.defaultData);
      if (error.code === 'ENOENT' && !fs.existsSync(this.path + '.bak')) return structuredClone(this.defaultData);
      // Keep the damaged file for diagnosis and recover the last good snapshot.
      try {
        const recovered = JSON.parse(fs.readFileSync(this.path + '.bak', 'utf8'));
        console.warn(`[store] Recovered ${this.path} from its backup; keep both files until repaired.`);
        return recovered;
      } catch {
        throw new Error(`Could not read local data: ${this.path}`, { cause: error });
      }
    }
  }

  save(data: T): void {
    fs.mkdirSync(path.dirname(this.path), { recursive: true });
    const temp = `${this.path}.${process.pid}.tmp`;
    try {
      fs.writeFileSync(temp, JSON.stringify(data), { mode: 0o600 });
      const fd = fs.openSync(temp, 'r');
      try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      if (fs.existsSync(this.path)) {
        // Never replace a good backup with a corrupt primary file.
        const previous = fs.readFileSync(this.path, 'utf8');
        try { JSON.parse(previous); fs.copyFileSync(this.path, this.path + '.bak'); }
        catch (error) { if (!(error instanceof SyntaxError)) throw error; }
      }
      fs.renameSync(temp, this.path);
    } catch (error) {
      if (!process.env.VERCEL) throw error;
    } finally {
      if (fs.existsSync(temp)) fs.unlinkSync(temp);
    }
  }
}

export class Favorites {
  store: JsonStore<string[]>;
  ids: Set<string>;

  constructor(filePath?: string) {
    this.store = new JsonStore<string[]>(filePath || path.join(DATA_DIR, 'favorites.json'), []);
    this.ids = new Set(this.store.load());
  }

  add(channelId: string): void {
    this.ids.add(channelId);
    this.store.save(Array.from(this.ids).sort());
  }

  remove(channelId: string): void {
    this.ids.delete(channelId);
    this.store.save(Array.from(this.ids).sort());
  }
}

export class Watched {
  store: JsonStore<string[]>;
  ids: Set<string>;

  constructor(filePath?: string) {
    this.store = new JsonStore<string[]>(filePath || path.join(DATA_DIR, 'watched.json'), []);
    this.ids = new Set(this.store.load());
  }

  add(episodeId: string): void {
    this.ids.add(episodeId);
    this.store.save(Array.from(this.ids).sort());
  }

  remove(episodeId: string): void {
    this.ids.delete(episodeId);
    this.store.save(Array.from(this.ids).sort());
  }
}

type HealthData = Record<string, { ok: boolean; checked_at: number }>;

export class HealthCache {
  store: JsonStore<HealthData>;
  ttl: number;
  data: HealthData;

  constructor(filePath?: string, ttl: number = 24 * 3600) {
    this.store = new JsonStore<HealthData>(filePath || path.join(DATA_DIR, 'health.json'), {});
    this.ttl = ttl;
    this.data = this.store.load();
  }

  get(url: string): boolean | null {
    const entry = this.data[url];
    if (!entry || (Date.now() / 1000) - entry.checked_at > this.ttl) {
      return null;
    }
    return entry.ok;
  }

  set(url: string, ok: boolean): void {
    this.data[url] = { ok, checked_at: Date.now() / 1000 };
    this.store.save(this.data);
  }
}

export interface WaitlistEntry {
  email: string;
  created_at: string;
}

export class Waitlist {
  store: JsonStore<WaitlistEntry[]>;
  entries: WaitlistEntry[];

  constructor(filePath?: string) {
    this.store = new JsonStore<WaitlistEntry[]>(filePath || path.join(DATA_DIR, 'waitlist.json'), []);
    this.entries = this.store.load();
  }

  add(email: string): WaitlistEntry {
    const normalized = email.trim().toLowerCase();
    const existing = this.entries.find(e => e.email.toLowerCase() === normalized);
    if (existing) return existing;
    const entry: WaitlistEntry = { email: normalized, created_at: new Date().toISOString() };
    this.entries.push(entry);
    this.store.save(this.entries);
    return entry;
  }
}
