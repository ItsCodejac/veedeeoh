import type { Channel, Category, Country, Filters, NowNext, Region } from "./types";
import { $ } from "./util";

export const state = {
  channels: [] as Channel[],
  countries: [] as Country[],
  categories: [] as Category[],
  region: { code: null, source: "unknown" } as Region,
  favorites: new Set<string>(),
  watched: new Set<string>(),
  health: new Map<string, boolean>(),
  epg: new Map<string, NowNext>(),
  filtered: [] as Channel[],
  rendered: 0,
  current: null as Channel | null,
  activeVibe: null as string | null,
};

export function onNow(ch: Channel) {
  return state.epg.get(ch.id)?.now;
}

export const countryNames = new Map<string, string>();
export const categoryNames = new Map<string, string>();

export function chMeta(ch: Channel): string {
  return [
    (ch.country && countryNames.get(ch.country)) || ch.country,
    ...ch.categories.map((c) => categoryNames.get(c) || c),
    ch.source !== "iptv-org" ? ch.source : null,
  ].filter(Boolean).join(" · ");
}

export function visible(): Channel[] {
  return state.channels.filter((ch) => !ch.nsfw);
}

export function isDead(ch: Channel): boolean {
  // dead only when every stream we've checked failed (and we checked at least one)
  const verdicts = ch.streams
    .map((s) => state.health.get(s.url))
    .filter((v): v is boolean => v !== undefined);
  return verdicts.length > 0 && verdicts.every((v) => !v);
}

export function rank(ch: Channel): number {
  let r = 0;
  if (state.favorites.has(ch.id)) r -= 2;
  if (ch.streams[0] && state.health.get(ch.streams[0].url) === true) r -= 1;
  if (isDead(ch)) r += 4;
  return r;
}

export function filters(): Filters {
  return {
    q: $<HTMLInputElement>("search").value.trim().toLowerCase(),
    country: $<HTMLSelectElement>("country").value,
    category: $<HTMLSelectElement>("category").value,
    favorites: $("favToggle").classList.contains("active"),
    hideDead: $("hideDead").classList.contains("active"),
  };
}
