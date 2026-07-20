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
    """Rewrite segment/variant URIs in an HLS playlist to go through /proxy, stripping ads for VOD."""
    is_vod = "#EXT-X-PLAYLIST-TYPE:VOD" in text or "#EXT-X-ENDLIST" in text
    
    out = []
    lines = text.splitlines()
    i = 0
    n = len(lines)
    
    while i < n:
        line = lines[i]
        stripped = line.strip()
        
        if not stripped:
            out.append(line)
            i += 1
            continue
            
        if is_vod:
            if not stripped.startswith("#"):
                # Detect ad segments from known ad domains/keywords
                if any(x in stripped for x in ["dai.google.com", "doubleclick", "pubads", "/ads/", "/creative/", "boltdns", "unicornmedia"]):
                    # Strip the ad segment. Pop its preceding #EXTINF and #EXT-X-DISCONTINUITY if they were added.
                    if out and out[-1].strip().startswith("#EXTINF"):
                        out.pop()
                    if out and out[-1].strip().startswith("#EXT-X-DISCONTINUITY"):
                        out.pop()
                    i += 1
                    continue
            elif stripped.startswith(("#EXT-X-CUE-OUT", "#EXT-X-CUE-IN", "#EXT-X-CUE-OUT-CONT", "#EXT-X-DATERANGE")):
                i += 1
                continue
                
        if stripped.startswith("#"):
            out.append(URI_ATTR.sub(lambda m: f'URI="{proxied(urljoin(base_url, m.group(1)))}"', line))
        else:
            out.append(proxied(urljoin(base_url, stripped)))
        i += 1
        
    return "\n".join(out) + "\n"
