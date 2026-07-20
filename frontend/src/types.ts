export interface Stream {
  url: string;
  quality: string | null;
  source: string;
  id?: string;
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
  vodPoster?: string | null;
  vodBanner?: string | null;
  vodItem?: any;
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

export interface Region {
  code: string | null;
  name?: string;
  city?: string;
  source: string;
}

export interface Catalog {
  channels: Channel[];
  countries: Country[];
  categories: Category[];
  region: Region;
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

export interface VodItem {
  id: string;
  title: string;
  type: string;
  poster: string | null;
  banner?: string | null;
  summary: string;
  genre?: string | null;
  rating?: string | null;
  duration?: number | null;
  url?: string;
  series_id?: string;
  identifier?: string;
}

export interface VodRail {
  name: string;
  items: VodItem[];
}

export interface VodEpisode {
  title: string;
  season: number | null;
  number: number | null;
  url: string;
  description?: string;
  duration?: number | null;
  thumbnail?: string | null;
}

export interface Filters {
  q: string;
  country: string;
  category: string;
  favorites: boolean;
  hideDead: boolean;
}
