"""Fetch, cache, and join the iptv-org API into a flat channel catalog."""

from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any

import httpx
from platformdirs import user_cache_dir

API_BASE = "https://iptv-org.github.io/api"
DATASETS = ("channels", "streams", "logos", "countries", "categories")
CACHE_DIR = Path(user_cache_dir("tvlc"))
CACHE_TTL = 24 * 3600


async def fetch_dataset(name: str, client: httpx.AsyncClient) -> list[dict]:
    """Return a dataset, from the local cache when fresh, else from the API."""
    cache_file = CACHE_DIR / f"{name}.json"
    if cache_file.exists() and time.time() - cache_file.stat().st_mtime < CACHE_TTL:
        return json.loads(cache_file.read_text())
    resp = await client.get(f"{API_BASE}/{name}.json", timeout=60)
    resp.raise_for_status()
    data = resp.json()
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cache_file.write_text(json.dumps(data))
    return data


async def load_raw() -> dict[str, list[dict]]:
    async with httpx.AsyncClient(follow_redirects=True) as client:
        return {name: await fetch_dataset(name, client) for name in DATASETS}


def build_catalog(raw: dict[str, list[dict]]) -> dict[str, Any]:
    """Join channels + streams + logos into a flat list of playable channels."""
    streams_by_channel: dict[str, list[dict]] = {}
    for s in raw["streams"]:
        cid = s.get("channel")
        if cid:
            streams_by_channel.setdefault(cid, []).append(
                {"url": s["url"], "quality": s.get("quality")}
            )

    logo_by_channel: dict[str, str] = {}
    for logo in raw["logos"]:
        cid = logo.get("channel")
        if cid and cid not in logo_by_channel:
            logo_by_channel[cid] = logo["url"]

    channels = []
    for ch in raw["channels"]:
        if ch.get("closed"):
            continue
        streams = streams_by_channel.get(ch["id"])
        if not streams:
            continue
        channels.append(
            {
                "id": ch["id"],
                "name": ch["name"],
                "country": ch.get("country"),
                "categories": ch.get("categories") or [],
                "nsfw": bool(ch.get("is_nsfw")),
                "logo": logo_by_channel.get(ch["id"]),
                "streams": streams,
            }
        )
    channels.sort(key=lambda c: c["name"].lower())

    used_countries = {c["country"] for c in channels}
    used_categories = {cat for c in channels for cat in c["categories"]}
    return {
        "channels": channels,
        "countries": [
            {"code": c["code"], "name": c["name"], "flag": c.get("flag", "")}
            for c in sorted(raw["countries"], key=lambda c: c["name"])
            if c["code"] in used_countries
        ],
        "categories": [
            {"id": c["id"], "name": c["name"]}
            for c in sorted(raw["categories"], key=lambda c: c["name"])
            if c["id"] in used_categories
        ],
    }


def filter_channels(
    channels: list[dict],
    *,
    country: str | None = None,
    category: str | None = None,
    q: str | None = None,
    include_nsfw: bool = False,
    ids: set[str] | None = None,
) -> list[dict]:
    """Filter the flat channel list. All criteria are ANDed."""
    needle = q.lower() if q else None
    out = []
    for ch in channels:
        if not include_nsfw and ch["nsfw"]:
            continue
        if country and ch["country"] != country:
            continue
        if category and category not in ch["categories"]:
            continue
        if needle and needle not in ch["name"].lower():
            continue
        if ids is not None and ch["id"] not in ids:
            continue
        out.append(ch)
    return out
