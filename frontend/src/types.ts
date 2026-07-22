export interface Stream {
  url: string;
  quality: string | null;
  source: string;
  id?: string;
}

export interface Region {
  code: string | null;
  name?: string;
  city?: string;
  source: string;
}

export interface Catalog {
  region: Region;
  favorites: string[];
  health: Record<string, boolean>;
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
  episodes?: VodEpisode[];
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

export type UserTier = 'founder_vip' | 'giveaway' | 'cloud_paid' | 'trial_7day' | 'trial_dollar_month';

export interface HouseholdProfile {
  id: string;
  name: string;
  avatar_color: string;
  is_kids: boolean;
  max_rating: 'G' | 'PG' | 'PG-13' | 'R' | 'TV-MA';
  pin?: string | null;
}

export interface SleepTimerConfig {
  durationMinutes: number;
  remainingSeconds: number;
  fadeAudio: boolean;
  active: boolean;
}
