export interface Stream {
  url: string;
  quality: string | null;
  source: string;
}

export interface Channel {
  id: string;
  name: string;
  country: string | null;
  categories: string[];
  nsfw: boolean;
  logo: string | null;
  logos: string[];
  streams: Stream[];
  source: string;
}

export interface Country {
  code: string;
  name: string;
  flag: string;
}

export interface Category {
  id: string;
  name: string;
}

export interface Catalog {
  channels: Channel[];
  countries: Country[];
  categories: Category[];
  favorites: string[];
  health: Record<string, boolean>;
}

export interface CheckResult {
  url: string;
  ok: boolean;
  cached: boolean;
}

export interface EpgProgram {
  title: string;
  start: number;
  stop: number;
}

export interface NowNext {
  now?: EpgProgram;
  next?: EpgProgram;
}

export interface Filters {
  q: string;
  country: string;
  category: string;
  favorites: boolean;
  hideDead: boolean;
}
