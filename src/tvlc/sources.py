"""Extra M3U playlist sources merged into the iptv-org catalog."""

from __future__ import annotations

import re

_BASE = "https://raw.githubusercontent.com/BuddyChewChew/app-m3u-generator/main/playlists"

# Regenerated daily by the app-m3u-generator GitHub Action. Pluto TV is omitted:
# iptv-org already indexes ~1700 Pluto streams and it would only duplicate.
# In the *_all playlists, group-title is the country name, not a category.
SOURCES = [
    {"key": "samsung", "label": "Samsung TV Plus", "url": f"{_BASE}/samsungtvplus_all.m3u", "group_is_country": True},
    {"key": "plex", "label": "Plex", "url": f"{_BASE}/plex_all.m3u", "group_is_country": True},
    {"key": "roku", "label": "Roku", "url": f"{_BASE}/roku_all.m3u", "country": "US"},
]

_ATTR = re.compile(r'([\w-]+)="([^"]*)"')


def parse_m3u(text: str) -> list[dict]:
    """Parse #EXTINF entries into {name, tvg_id, logo, group, url} dicts."""
    entries = []
    pending: dict | None = None
    for line in text.splitlines():
        line = line.strip()
        if line.startswith("#EXTINF"):
            attrs = dict(_ATTR.findall(line))
            name = line.rsplit(",", 1)[-1].strip() if "," in line else attrs.get("tvg-name", "")
            pending = {
                "name": name or attrs.get("tvg-name", "Unknown"),
                "tvg_id": attrs.get("tvg-id") or attrs.get("channel-id"),
                "logo": attrs.get("tvg-logo"),
                "group": attrs.get("group-title"),
            }
        elif line and not line.startswith("#") and pending:
            pending["url"] = line
            entries.append(pending)
            pending = None
    return entries


def slugify(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


def normalize_name(name: str) -> str:
    """Collapse a channel name for cross-source duplicate matching."""
    return re.sub(r"[^a-z0-9]+", "", name.lower())


def to_channels(
    source: dict, entries: list[dict], country_codes: dict[str, str] | None = None
) -> list[dict]:
    """Convert parsed playlist entries to catalog channel dicts."""
    country_codes = country_codes or {}
    group_is_country = source.get("group_is_country", False)
    channels = []
    for e in entries:
        cid = e["tvg_id"] or slugify(e["name"])
        group = e.get("group")
        if group_is_country:
            country = country_codes.get(group.lower()) if group else None
            categories: list[str] = []
        else:
            country = source.get("country")
            categories = [slugify(group)] if group else []
        channels.append(
            {
                "id": f"{source['key']}:{cid}",
                "name": e["name"],
                "country": country,
                "categories": categories,
                "nsfw": False,
                "logo": e.get("logo"),
                "logos": [e["logo"]] if e.get("logo") else [],
                "streams": [{"url": e["url"], "quality": None, "source": source["label"]}],
                "source": source["label"],
            }
        )
    return channels


def category_names(entries: list[dict]) -> dict[str, str]:
    """Map slugified group ids back to their display names."""
    return {slugify(e["group"]): e["group"] for e in entries if e.get("group")}
