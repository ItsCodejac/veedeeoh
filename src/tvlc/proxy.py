"""HLS-aware stream proxying: rewrite playlists so every URI routes back through us."""

from __future__ import annotations

import re
from urllib.parse import quote, urljoin

URI_ATTR = re.compile(r'URI="([^"]+)"')


def proxied(url: str) -> str:
    """Hex-encode the URL to prevent client-side ad blockers from blocking it."""
    encoded = url.encode("utf-8").hex()
    return f"/proxy?url={encoded}&obf=1"


def is_playlist(url: str, content_type: str | None) -> bool:
    if content_type and ("mpegurl" in content_type or "m3u" in content_type):
        return True
    return url.split("?")[0].lower().endswith((".m3u8", ".m3u"))


def rewrite_m3u8(text: str, base_url: str) -> str:
    """Rewrite segment/variant URIs in an HLS playlist to go through /proxy."""
    out = []
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped:
            out.append(line)
        elif stripped.startswith("#"):
            out.append(URI_ATTR.sub(lambda m: f'URI="{proxied(urljoin(base_url, m.group(1)))}"', line))
        else:
            out.append(proxied(urljoin(base_url, stripped)))
    return "\n".join(out) + "\n"
