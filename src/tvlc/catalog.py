"""Fetch, cache, and join the iptv-org API into a flat channel catalog."""

from __future__ import annotations

import json
import re
import time
from pathlib import Path
from typing import Any

import httpx
from platformdirs import user_cache_dir

from . import sources

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


async def fetch_text(name: str, url: str, client: httpx.AsyncClient) -> str:
    """Fetch a text file with the same cache policy as the API datasets."""
    cache_file = CACHE_DIR / name
    if cache_file.exists() and time.time() - cache_file.stat().st_mtime < CACHE_TTL:
        return cache_file.read_text()
    resp = await client.get(url, timeout=60)
    resp.raise_for_status()
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cache_file.write_text(resp.text)
    return resp.text


async def load_raw() -> dict[str, Any]:
    async with httpx.AsyncClient(follow_redirects=True) as client:
        raw: dict[str, Any] = {name: await fetch_dataset(name, client) for name in DATASETS}
        extras = []
        for source in sources.SOURCES:
            try:
                text = await fetch_text(f"source_{source['key']}.m3u", source["url"], client)
                extras.append((source, sources.parse_m3u(text)))
            except (httpx.HTTPError, OSError):
                continue  # a broken extra source shouldn't take the app down
        raw["extras"] = extras
        return raw


def build_catalog(raw: dict[str, list[dict]]) -> dict[str, Any]:
    """Join channels + streams + logos into a flat list of playable channels."""
    streams_by_channel: dict[str, list[dict]] = {}
    for s in raw["streams"]:
        cid = s.get("channel")
        if cid:
            streams_by_channel.setdefault(cid, []).append(
                {"url": s["url"], "quality": s.get("quality"), "source": "iptv-org"}
            )

    logos_by_channel: dict[str, list[str]] = {}
    for logo in raw["logos"]:
        cid = logo.get("channel")
        if cid and logo["url"] not in logos_by_channel.get(cid, ()):
            logos_by_channel.setdefault(cid, []).append(logo["url"])
    for urls in logos_by_channel.values():
        urls.sort(key=lambda u: not u.startswith("https://"))  # https first

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
                "logo": (logos_by_channel.get(ch["id"]) or [None])[0],
                "logos": logos_by_channel.get(ch["id"], []),
                "streams": streams,
                "source": "iptv-org",
            }
        )

    extra_category_names: dict[str, str] = {}
    seen_urls = {s["url"] for c in channels for s in c["streams"]}
    by_name: dict[str, list[dict]] = {}
    for c in channels:
        by_name.setdefault(sources.normalize_name(c["name"]), []).append(c)

    country_codes = {c["name"].lower(): c["code"] for c in raw["countries"]}
    country_codes.update({c["code"].lower(): c["code"] for c in raw["countries"]})
    for source, entries in raw.get("extras", []):
        if not source.get("group_is_country"):
            extra_category_names.update(sources.category_names(entries))
        for ch in sources.to_channels(source, entries, country_codes):
            url = ch["streams"][0]["url"]
            if url in seen_urls:
                continue
            seen_urls.add(url)
            target = _merge_target(by_name.get(sources.normalize_name(ch["name"]), []), ch)
            if target:
                # same channel on another provider: expose it as an extra stream
                target["streams"].extend(ch["streams"])
                target["logo"] = target["logo"] or ch["logo"]
                target["logos"] += [u for u in ch["logos"] if u not in target["logos"]]
                target["categories"] = sorted({*target["categories"], *ch["categories"]})
            else:
                by_name.setdefault(sources.normalize_name(ch["name"]), []).append(ch)
                channels.append(ch)

    for ch in channels:
        ch["streams"].sort(key=lambda s: -_quality_rank(s.get("quality")))
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
        "categories": sorted(
            (
                [
                    {"id": c["id"], "name": c["name"]}
                    for c in raw["categories"]
                    if c["id"] in used_categories
                ]
                + [
                    {"id": slug, "name": name}
                    for slug, name in extra_category_names.items()
                    if slug in used_categories
                    and slug not in {c["id"] for c in raw["categories"]}
                ]
            ),
            key=lambda c: c["name"],
        ),
    }


def _quality_rank(quality: str | None) -> int:
    """"1080p" -> 1080; unlabeled streams rank below any labeled one."""
    if not quality:
        return 0
    m = re.search(r"(\d{3,4})", quality)
    return int(m.group(1)) if m else 0


def _merge_target(candidates: list[dict], ch: dict) -> dict | None:
    """Pick the existing channel an extra-source channel is a duplicate of.

    Same normalized name and same country is a confident match; a unique
    name match with an unknown country is accepted too. Ambiguous names
    (several same-named channels in different countries) stay separate.
    """
    same_country = [c for c in candidates if c["country"] == ch["country"]]
    if len(same_country) == 1:
        return same_country[0]
    if not same_country and len(candidates) == 1 and candidates[0]["country"] is None:
        return candidates[0]
    return None


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
