"""On-demand catalogs: Pluto TV VOD (anonymous session) and Internet Archive."""

from __future__ import annotations

import re
import time
import uuid
from typing import Any

import httpx

BOOT_URL = "https://boot.pluto.tv/v4/start"
VOD_URL = "https://service-vod.clusters.pluto.tv/v4/vod"
SESSION_TTL = 3 * 3600
CATALOG_TTL = 3600

ANIME_RE = re.compile(
    r"anime|naruto|one piece|dragon ?ball|jojo|sailor moon|gundam|bleach|"
    r"yu-gi-oh|shonen|ghibli|evangelion|cowboy bebop|akira|slayer",
    re.I,
)

_session: dict[str, Any] = {}
_catalog: dict[str, Any] = {}


def pluto_headers(region_code: str | None = None) -> dict[str, str]:
    headers = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
        "Referer": "https://pluto.tv/",
        "Origin": "https://pluto.tv",
    }
    code = (region_code or "US").upper()
    spoof_ips = {
        "US": "76.81.9.69",
        "CA": "192.206.151.131",
        "GB": "178.238.11.6",
        "FR": "193.169.64.141",
    }
    headers["X-Forwarded-For"] = spoof_ips.get(code, "76.81.9.69")
    return headers


async def _boot(client: httpx.AsyncClient, region_code: str | None = None) -> dict[str, Any]:
    resp = await client.get(
        BOOT_URL,
        params={
            "appName": "web", "appVersion": "8.0.0", "deviceVersion": "120.0.0",
            "deviceModel": "web", "deviceMake": "chrome", "deviceType": "web",
            "clientID": str(uuid.uuid4()), "clientModelNumber": "1.0.0",
            "serverSideAds": "true",
        },
        headers=pluto_headers(region_code),
        timeout=30,
    )
    resp.raise_for_status()
    data = resp.json()
    return {
        "token": data["sessionToken"],
        "stitcher": data["servers"]["stitcher"],
        "params": data["stitcherParams"],
        "at": time.time(),
    }


async def get_session(client: httpx.AsyncClient, region_code: str | None = None) -> dict[str, Any]:
    global _session
    if not _session or time.time() - _session["at"] > SESSION_TTL:
        _session = await _boot(client, region_code)
    return _session


def stream_url(session: dict[str, Any], path: str) -> str:
    # Rewrite legacy /stitch/ path to /v2/stitch/ to route to the modern validated stitcher API
    v2_path = path.replace("/stitch/", "/v2/stitch/")
    return f"{session['stitcher']}{v2_path}?{session['params']}&jwt={session['token']}&masterJWTPassthrough=true"


def _normalize(session: dict[str, Any], item: dict) -> dict | None:
    covers = item.get("covers") or []
    poster = next(
        (c["url"] for c in covers if c.get("aspectRatio") == "347:500"),
        covers[0]["url"] if covers else None,
    )
    out = {
        "id": item["_id"],
        "title": item.get("name", "Untitled"),
        "type": item.get("type"),
        "poster": poster,
        "banner": item.get("featuredImage", {}).get("path") or item.get("poster16_9", {}).get("path"),
        "summary": (item.get("summary") or item.get("description") or "")[:500],
        "genre": item.get("genre"),
        "rating": item.get("rating"),
        "duration": item.get("duration"),
    }
    path = (item.get("stitched") or {}).get("path")
    if item.get("type") == "movie" and path:
        out["url"] = stream_url(session, path)
    elif item.get("type") == "series":
        out["series_id"] = item["_id"]
    else:
        return None
    return out


async def get_catalog(client: httpx.AsyncClient, region_code: str | None = None) -> list[dict]:
    """Pluto VOD rails: [{name, items: [...]}], with a synthesized Anime rail first."""
    global _catalog
    if _catalog and time.time() - _catalog["at"] < CATALOG_TTL:
        return _catalog["rails"]
    session = await get_session(client, region_code)
    resp = await client.get(
        f"{VOD_URL}/categories",
        params={"offset": 0, "page": 1, "includeItems": "true"},
        headers={
            "Authorization": f"Bearer {session['token']}",
            **pluto_headers(region_code)
        },
        timeout=60,
    )
    resp.raise_for_status()
    rails = []
    seen_anime: dict[str, dict] = {}
    for cat in resp.json().get("categories", []):
        items = [n for it in cat.get("items", []) if (n := _normalize(session, it))]
        if items:
            rails.append({"name": cat["name"], "items": items})
        for n in items:
            if ANIME_RE.search(f"{n['title']} {n.get('genre') or ''}"):
                seen_anime[n["id"]] = n
    if seen_anime:
        rails.insert(0, {"name": "⛩ Anime", "items": list(seen_anime.values())})
    _catalog = {"rails": rails, "at": time.time()}
    return rails


async def get_series(client: httpx.AsyncClient, series_id: str, region_code: str | None = None) -> list[dict]:
    """Episodes for a series, each with a ready-to-play url."""
    session = await get_session(client, region_code)
    resp = await client.get(
        f"{VOD_URL}/series/{series_id}/seasons",
        params={"offset": 0, "page": 1},
        headers={
            "Authorization": f"Bearer {session['token']}",
            **pluto_headers(region_code)
        },
        timeout=60,
    )
    resp.raise_for_status()
    episodes = []
    for season in resp.json().get("seasons", []):
        for ep in season.get("episodes", []):
            path = (ep.get("stitched") or {}).get("path")
            if path:
                covers = ep.get("covers") or []
                thumbnail = next(
                    (c["url"] for c in covers if c.get("aspectRatio") == "16:9"),
                    ep.get("poster16_9", {}).get("path") if ep.get("poster16_9") else None,
                )
                episodes.append({
                    "title": ep.get("name", "Episode"),
                    "season": ep.get("season"),
                    "number": ep.get("number"),
                    "url": stream_url(session, path),
                    "description": ep.get("description") or ep.get("summary") or "",
                    "duration": ep.get("duration"),
                    "thumbnail": thumbnail,
                })
    return episodes


# ---- Internet Archive: public-domain feature films ----

async def archive_movies(client: httpx.AsyncClient, rows: int = 30) -> list[dict]:
    resp = await client.get(
        "https://archive.org/advancedsearch.php",
        params={
            # format filter skips husk items that carry only metadata
            "q": 'collection:feature_films AND mediatype:movies AND format:("h.264" OR "MPEG4" OR "Ogg Video")',
            "fl[]": ["identifier", "title", "year", "downloads"],
            "sort[]": "downloads desc",
            "rows": rows,
            "output": "json",
        },
        timeout=30,
    )
    resp.raise_for_status()
    return [
        {
            "id": f"archive:{doc['identifier']}",
            "identifier": doc["identifier"],
            "title": doc.get("title", doc["identifier"]),
            "type": "archive",
            "poster": f"https://archive.org/services/img/{doc['identifier']}",
            "summary": f"Public domain · {doc.get('year', '')}",
        }
        for doc in resp.json()["response"]["docs"]
    ]


import xml.etree.ElementTree as ET

_podcast_catalog = {"rails": [], "at": 0}

async def apple_podcasts(client: httpx.AsyncClient) -> list[dict]:
    global _podcast_catalog
    if _podcast_catalog["rails"] and time.time() - _podcast_catalog["at"] < CATALOG_TTL:
        return _podcast_catalog["rails"]

    search_terms = ["video podcast", "comedy video podcast", "tech video podcast", "sports video podcast", "news video podcast", "gaming video podcast"]
    results = []
    
    import asyncio
    async def fetch_term(term: str):
        try:
            r = await client.get(
                "https://itunes.apple.com/search",
                params={"term": term, "media": "podcast", "limit": 20},
                timeout=10,
            )
            if r.status_code == 200:
                return r.json().get("results", [])
        except:
            pass
        return []
        
    responses = await asyncio.gather(*(fetch_term(t) for t in search_terms))
    for r in responses:
        results.extend(r)
        
    # Deduplicate results by collectionId
    seen = set()
    unique_results = []
    for p in results:
        cid = p.get("collectionId")
        if cid and cid not in seen:
            seen.add(cid)
            unique_results.append(p)
            
    items = []
    
    # Process up to 30 unique feeds to avoid taking too long
    for p in unique_results[:30]:
        feed_url = p.get("feedUrl")
        if not feed_url:
            continue
        try:
            f_resp = await client.get(feed_url, timeout=10)
            if f_resp.status_code != 200:
                continue
            
            root = ET.fromstring(f_resp.text)
            channel = root.find("channel")
            if not channel:
                continue
                
            episodes = []
            for i, item in enumerate(channel.findall("item")):
                enc = item.find("enclosure")
                if enc is not None:
                    url = enc.get("url")
                    typ = enc.get("type", "").lower()
                    if url and ("video" in typ or url.endswith(".mp4") or url.endswith(".m4v")):
                        title = item.findtext("title") or "Episode"
                        desc = item.findtext("description") or ""
                        
                        thumb = p.get("artworkUrl600")
                        itunes_img = item.find("{http://www.itunes.com/dtds/podcast-1.0.dtd}image")
                        if itunes_img is not None and itunes_img.get("href"):
                            thumb = itunes_img.get("href")
                        
                        episodes.append({
                            "title": title,
                            "url": url,
                            "description": desc[:500],
                            "thumbnail": thumb,
                            "number": len(episodes) + 1,
                        })
                        if len(episodes) >= 20: 
                            break
                            
            if episodes:
                items.append({
                    "id": f"podcast:{p['collectionId']}",
                    "title": p.get("collectionName", "Podcast"),
                    "type": "podcast",
                    "poster": p.get("artworkUrl600"),
                    "banner": p.get("artworkUrl600"),
                    "summary": p.get("artistName", ""),
                    "genre": p.get("primaryGenreName", "Video Podcast"),
                    "episodes": episodes
                })
        except Exception:
            continue
            
    _podcast_catalog = {"rails": items, "at": time.time()}
    return items



async def archive_stream(client: httpx.AsyncClient, identifier: str) -> str | None:
    """Best playable file URL for an archive.org item."""
    resp = await client.get(f"https://archive.org/metadata/{identifier}", timeout=30)
    resp.raise_for_status()
    files = resp.json().get("files", [])
    # browser-friendly formats first; mkv/avi still work via Open in VLC
    preference = {".mp4": 0, ".m4v": 0, ".webm": 1, ".ogv": 2, ".mkv": 3, ".avi": 3}
    best: tuple[int, int, str] | None = None
    for f in files:
        name = f.get("name", "")
        ext = next((e for e in preference if name.lower().endswith(e)), None)
        if ext is None:
            continue
        size = int(f.get("size", 0) or 0)
        candidate = (preference[ext], -size, name)
        if best is None or candidate < best:
            best = candidate
    if not best:
        return None
    return f"https://archive.org/download/{identifier}/{best[2]}"
