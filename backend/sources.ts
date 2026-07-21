import * as https from 'https';

export const _BASE = "https://raw.githubusercontent.com/BuddyChewChew/app-m3u-generator/main/playlists";
export const _TUBI = "https://raw.githubusercontent.com/BuddyChewChew/tubi-scraper/refs/heads/main/tubi_playlist.m3u";
export const _XUMO = "https://raw.githubusercontent.com/BuddyChewChew/xumo-playlist-generator/main/playlists/xumo_playlist.m3u";

export const SOURCES = [
  { key: "samsung", label: "Samsung TV Plus", url: `${_BASE}/samsungtvplus_all.m3u`, group_is_country: true },
  { key: "plex", label: "Plex", url: `${_BASE}/plex_all.m3u`, group_is_country: true },
  { key: "roku", label: "Roku", url: `${_BASE}/roku_all.m3u`, country: "US" },
  { key: "tubi", label: "Tubi", url: _TUBI, country: "US" },
  { key: "xumo", label: "Xumo", url: _XUMO, country: "US" },
];

const _ATTR = /([\w-]+)="([^"]*)"/g;

export function parseM3u(text: string): any[] {
  const entries: any[] = [];
  let pending: any = null;

  for (let line of text.split("\n")) {
    line = line.trim();
    if (line.startsWith("#EXTINF")) {
      const attrs: Record<string, string> = {};
      const _ATTR = /([\w-]+)="([^"]*)"/g;
      let match;
      while ((match = _ATTR.exec(line)) !== null) {
        attrs[match[1]] = match[2];
      }
      
      const lastComma = line.lastIndexOf(",");
      let name = "";
      if (lastComma !== -1) {
        name = line.substring(lastComma + 1).trim();
      } else {
        name = attrs["tvg-name"] || "";
      }

      pending = {
        name: name || attrs["tvg-name"] || "Unknown",
        tvg_id: attrs["tvg-id"] || attrs["channel-id"],
        logo: attrs["tvg-logo"],
        group: attrs["group-title"],
      };
    } else if (line && !line.startsWith("#") && pending) {
      pending.url = line;
      entries.push(pending);
      pending = null;
    }
  }
  return entries;
}

export function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

export function toChannels(source: any, entries: any[], countryCodes: Record<string, string> = {}): any[] {
  const groupIsCountry = source.group_is_country || false;
  const channels: any[] = [];

  for (const e of entries) {
    const cid = e.tvg_id || slugify(e.name);
    const group = e.group;
    let country: string | undefined;
    let categories: string[] = [];

    if (groupIsCountry) {
      country = group ? countryCodes[group.toLowerCase()] : undefined;
    } else {
      country = source.country;
      if (group) categories.push(slugify(group));
    }

    channels.push({
      id: `${source.key}:${cid}`,
      name: e.name,
      country,
      categories,
      nsfw: false,
      logo: e.logo,
      logos: e.logo ? [e.logo] : [],
      streams: [{ url: e.url, quality: null, source: source.label }],
      source: source.label,
    });
  }
  return channels;
}

export function categoryNames(entries: any[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const e of entries) {
    if (e.group) {
      result[slugify(e.group)] = e.group;
    }
  }
  return result;
}
