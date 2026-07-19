"""Lazy stream liveness probing."""

from __future__ import annotations

import httpx

PROBE_TIMEOUT = 8.0
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36"


async def probe(url: str, client: httpx.AsyncClient) -> bool:
    """True if the stream responds and yields some bytes quickly."""
    try:
        async with client.stream(
            "GET", url, timeout=PROBE_TIMEOUT, follow_redirects=True, headers={"User-Agent": UA}
        ) as resp:
            if resp.status_code >= 400:
                return False
            async for chunk in resp.aiter_bytes():
                if chunk:
                    return True
            return False
    except (httpx.HTTPError, OSError, ValueError):
        return False
