"""Render a channel list as an extended M3U playlist."""

from __future__ import annotations


def render(channels: list[dict], group_by: str = "country", country_names: dict[str, str] | None = None) -> str:
    """Render channels to #EXTM3U text. group_by is "country" or "category"."""
    country_names = country_names or {}
    lines = ["#EXTM3U"]
    for ch in channels:
        if group_by == "category":
            group = (ch["categories"][0].title() if ch["categories"] else "Uncategorized")
        else:
            group = country_names.get(ch["country"], ch["country"] or "Unknown")
        attrs = [f'tvg-id="{ch["id"]}"']
        if ch.get("logo"):
            attrs.append(f'tvg-logo="{ch["logo"]}"')
        attrs.append(f'group-title="{group}"')
        lines.append(f"#EXTINF:-1 {' '.join(attrs)},{ch['name']}")
        lines.append(ch["streams"][0]["url"])
    return "\n".join(lines) + "\n"
