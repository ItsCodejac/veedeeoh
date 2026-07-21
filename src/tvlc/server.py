"""FastAPI app: catalog API, stream proxy, VLC launcher, playlist export."""

from __future__ import annotations

import asyncio
import os
import platform
import subprocess
from contextlib import asynccontextmanager
from pathlib import Path
import re

import httpx
from fastapi import FastAPI, HTTPException, Query, WebSocket, Request, WebSocketDisconnect
from fastapi.responses import PlainTextResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import captions, catalog, epg, health, m3u, proxy, thumbs, vod, music_scanner
from .store import Favorites, HealthCache, Watched

STATIC_DIR = Path(__file__).parent / "static"


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.catalog = catalog.build_catalog(await catalog.load_raw())
    app.state.favorites = Favorites()
    app.state.watched = Watched()
    app.state.health = HealthCache()
    app.state.client = httpx.AsyncClient(follow_redirects=True)
    app.state.check_sem = asyncio.Semaphore(6)
    app.state.epg_keys = {
        ch["id"]: key
        for ch in app.state.catalog["channels"]
        if (key := epg.epg_key(ch))
    }
    app.state.epg_task = asyncio.create_task(epg.refresh(app.state.client))
    app.state.region = await _detect_region(app.state.client)
    yield
    app.state.epg_task.cancel()
    await app.state.client.aclose()


app = FastAPI(title="TVLC", lifespan=lifespan)


async def _detect_region(client: httpx.AsyncClient) -> dict:
    """The server's egress country — what stream providers actually see.

    This is the real availability signal (a VPN moves it), unlike the browser
    locale. TVLC_REGION overrides it (ISO country code).
    """
    override = os.environ.get("TVLC_REGION")
    if override:
        return {"code": override.upper(), "source": "override"}
    try:
        resp = await client.get(
            "http://ip-api.com/json/?fields=countryCode,country,city", timeout=10
        )
        data = resp.json()
        if data.get("countryCode"):
            return {"code": data["countryCode"], "name": data.get("country"),
                    "city": data.get("city"), "source": "geoip"}
    except (httpx.HTTPError, ValueError):
        pass
    return {"code": None, "source": "unknown"}


class UrlBody(BaseModel):
    url: str


class ChannelBody(BaseModel):
    id: str


def _filtered(
    country: str | None,
    category: str | None,
    q: str | None,
    favorites: bool,
    nsfw: bool,
) -> list[dict]:
    return catalog.filter_channels(
        app.state.catalog["channels"],
        country=country or None,
        category=category or None,
        q=q or None,
        include_nsfw=nsfw,
        ids=app.state.favorites.ids if favorites else None,
    )


@app.get("/api/catalog")
async def get_catalog() -> dict:
    cat = app.state.catalog
    return {
        **cat,
        "region": app.state.region,
        "favorites": sorted(app.state.favorites.ids),
        "health": {
            url: entry["ok"]
            for url, entry in app.state.health.data.items()
            if app.state.health.get(url) is not None
        },
    }


@app.get("/api/now")
async def now_playing() -> dict:
    """Now/next program per channel id, for every channel with guide data."""
    import time as _time

    if (
        epg.loaded_at
        and _time.time() - epg.loaded_at > epg.EPG_TTL
        and app.state.epg_task.done()
    ):
        app.state.epg_task = asyncio.create_task(epg.refresh(app.state.client))
    out = {}
    for ch_id, key in app.state.epg_keys.items():
        entry = epg.now_next(key)
        if entry:
            out[ch_id] = entry
    return out


@app.get("/api/party")
async def party_playlist(mood: str = Query("chillout")) -> dict:
    """Continuous Party Mode playlist provider, filtered by mood."""
    region = app.state.region
    code = region.get("code") if region.get("source") == "override" else "US"
    
    live_channels = app.state.catalog.get("channels", [])
    vod_items = []
    try:
        rails_data = await vod.get_catalog(app.state.client, region_code=code)
        for r in rails_data:
            vod_items.extend(r.get("items", []))
    except Exception:
        pass
        
    try:
        archive = await vod.archive_movies(app.state.client, rows=60)
        vod_items.extend(archive)
    except Exception:
        pass
        
    pool = []
    
    music_live = [ch for ch in live_channels if "music" in ch.get("categories", [])]
    for ch in music_live:
        url = ch["streams"][0]["url"] if ch.get("streams") else None
        if url:
            pool.append({
                "id": ch["id"],
                "title": ch["name"],
                "url": url,
                "type": "live",
                "poster": ch.get("logo"),
                "genre": "Live Music TV",
                "summary": "24/7 Music Video stream"
            })
            
    for item in vod_items:
        genre = (item.get("genre") or "").lower()
        title = (item.get("title") or "").lower()
        summary = (item.get("summary") or "").lower()
        
        is_music = "music" in genre or "musical" in genre or "variety" in genre or "music" in title or "concert" in title
        
        if is_music:
            url = item.get("url")
            if not url and item.get("id", "").startswith("archive:"):
                ident = item.get("identifier")
                url = f"https://archive.org/download/{ident}/{ident}.mp4"
                
            if url:
                pool.append({
                    "id": item["id"],
                    "title": item["title"],
                    "url": url,
                    "type": "vod",
                    "poster": item.get("poster") or item.get("banner"),
                    "genre": item.get("genre") or "Music Video",
                    "summary": item.get("summary") or "Concert & Performance Video"
                })
                
    mood_str = mood.lower()
    filtered_pool = []
    
    for track in pool:
        text = f"{track['title']} {track['genre']} {track['summary']}".lower()
        if mood_str == "chillout":
            if any(w in text for w in ["chill", "acoustic", "ambient", "jazz", "soul", "relax", "soft", "classical", "lounge", "weather"]):
                filtered_pool.append(track)
        elif mood_str == "high-energy":
            if any(w in text for w in ["pop", "rock", "dance", "party", "electronic", "metal", "hip", "rap", "live", "vevo", "concert", "energetic"]):
                filtered_pool.append(track)
        elif mood_str == "retro":
            if any(w in text for w in ["classic", "retro", "70s", "80s", "90s", "archive", "vintage", "oldies", "sullivan", "variety"]):
                filtered_pool.append(track)
        else:
            filtered_pool.append(track)
            
    if not filtered_pool:
        filtered_pool = pool
        
    import random
    random.shuffle(filtered_pool)
    return {"tracks": filtered_pool[:30]}


@app.get("/api/vod")
async def vod_catalog() -> dict:
    """On-demand rails: Pluto VOD (with a synthesized anime rail) + Archive films."""
    rails = []
    region = app.state.region
    code = region.get("code") if region.get("source") == "override" else "US"
    try:
        rails = await vod.get_catalog(app.state.client, region_code=code)
    except (httpx.HTTPError, KeyError) as exc:
        return {"rails": [], "error": f"Pluto VOD unavailable: {exc}"}
    try:
        archive = await vod.archive_movies(app.state.client)
        if archive:
            rails.append({"name": "🎞 Archive Classics", "items": archive})
    except (httpx.HTTPError, KeyError):
        pass  # archive is a bonus rail
        
    try:
        podcasts = await vod.apple_podcasts(app.state.client)
        if podcasts:
            rails.append({"name": "🎙 Featured Video Podcasts", "items": podcasts})
    except (httpx.HTTPError, KeyError):
        pass  # podcasts is a bonus rail
        
    return {"rails": rails}


@app.get("/api/vod/series/{series_id}")
async def vod_series(series_id: str) -> dict:
    region = app.state.region
    code = region.get("code") if region.get("source") == "override" else "US"
    try:
        return {"episodes": await vod.get_series(app.state.client, series_id, region_code=code)}
    except (httpx.HTTPError, KeyError) as exc:
        raise HTTPException(502, f"series fetch failed: {exc}") from exc


@app.get("/api/vod/archive/{identifier}")
async def vod_archive(identifier: str) -> dict:
    try:
        url = await vod.archive_stream(app.state.client, identifier)
    except (httpx.HTTPError, KeyError) as exc:
        raise HTTPException(502, f"archive fetch failed: {exc}") from exc
    if not url:
        raise HTTPException(404, "no playable file")
    return {"url": url}


@app.get("/api/favorites")
async def list_favorites() -> list[str]:
    return sorted(app.state.favorites.ids)


@app.post("/api/favorites")
async def add_favorite(body: ChannelBody) -> dict:
    app.state.favorites.add(body.id)
    return {"ok": True}


@app.delete("/api/favorites/{channel_id}")
async def remove_favorite(channel_id: str) -> dict:
    app.state.favorites.remove(channel_id)
    return {"ok": True}


@app.get("/api/watched")
async def list_watched() -> list[str]:
    return sorted(app.state.watched.ids)


@app.post("/api/watched")
async def add_watched(body: ChannelBody) -> dict:
    app.state.watched.add(body.id)
    return {"ok": True}


@app.delete("/api/watched/{episode_id:path}")
async def remove_watched(episode_id: str) -> dict:
    app.state.watched.remove(episode_id)
    return {"ok": True}


@app.post("/api/check")
async def check_stream(body: UrlBody) -> dict:
    cached = app.state.health.get(body.url)
    if cached is not None:
        return {"url": body.url, "ok": cached, "cached": True}
    async with app.state.check_sem:
        ok = await health.probe(body.url, app.state.client)
    app.state.health.set(body.url, ok)
    return {"url": body.url, "ok": ok, "cached": False}


@app.post("/api/vlc")
async def open_in_vlc(body: UrlBody) -> dict:
    url = body.url
    if not url.startswith(("http://", "https://")):
        raise HTTPException(400, "not a stream url")
    system = platform.system()
    try:
        if system == "Darwin":
            subprocess.Popen(["open", "-a", "VLC", url])
        elif system == "Windows":
            subprocess.Popen(["cmd", "/c", "start", "vlc", url])
        else:
            subprocess.Popen(["vlc", url])
    except OSError as exc:
        raise HTTPException(500, f"could not launch VLC: {exc}") from exc
    return {"ok": True}


@app.websocket("/ws/captions")
async def captions_ws(ws: WebSocket, url: str, translate: bool = False) -> None:
    """Stream live Whisper captions for a stream url as JSON messages."""
    await ws.accept()
    if not url.startswith(("http://", "https://")):
        await ws.close(code=4000, reason="bad url")
        return
    if not captions.ffmpeg_available():
        await ws.send_json({"error": "ffmpeg not found — install it (brew install ffmpeg)"})
        await ws.close()
        return
    try:
        await ws.send_json({"status": "loading model"})
        async for seg in captions.caption_stream(url, translate):
            await ws.send_json(seg)
        await ws.send_json({"error": "stream audio ended"})
        await ws.close()
    except WebSocketDisconnect:
        pass
    except Exception as exc:  # noqa: BLE001 - report all failures to the client
        try:
            await ws.send_json({"error": f"captions failed: {exc}"})
            await ws.close()
        except RuntimeError:
            pass


@app.get("/thumb")
async def thumb(url: str = Query(...)) -> Response:
    """A real captured frame from the stream — what's on this channel right now."""
    if not url.startswith(("http://", "https://")):
        raise HTTPException(400, "bad url")
    if not captions.ffmpeg_available():
        raise HTTPException(404, "ffmpeg not available")
    data, bumper = await thumbs.grab(url)
    if bumper:
        # geo-blocked Pluto loop: alive at the transport level, dead as content
        app.state.health.set(url, False)
        raise HTTPException(404, "geo-block bumper")
    if not data:
        raise HTTPException(404, "no frame")
    return Response(
        data,
        media_type="image/jpeg",
        headers={"Cache-Control": "public, max-age=300"},
    )


@app.get("/logo")
async def logo(url: str = Query(...)) -> Response:
    """Fetch a channel logo server-side to dodge hotlink/referrer blocking."""
    if not url.startswith(("http://", "https://")):
        raise HTTPException(400, "bad url")
    client: httpx.AsyncClient = app.state.client
    try:
        resp = await client.get(url, headers={"User-Agent": health.UA}, timeout=15)
    except httpx.HTTPError as exc:
        raise HTTPException(502, f"upstream error: {exc}") from exc
    content_type = resp.headers.get("content-type", "")
    if resp.status_code >= 400 or not content_type.startswith("image/"):
        raise HTTPException(404, "no image there")
    return Response(
        resp.content,
        media_type=content_type,
        headers={"Cache-Control": "public, max-age=604800"},
    )


@app.get("/proxy")
async def proxy_stream(url: str = Query(...), obf: str | None = None):
    if obf == "1":
        try:
            url = bytes.fromhex(url).decode("utf-8")
        except ValueError:
            raise HTTPException(400, "bad obfuscated url")
    if not url.startswith(("http://", "https://")):
        raise HTTPException(400, "bad url")
    client: httpx.AsyncClient = app.state.client
    headers = {"User-Agent": health.UA}
    if "pluto.tv" in url or "jmp2.uk/plu-" in url:
        region = app.state.region
        code = region.get("code") if region.get("source") == "override" else "US"
        spoof_ips = {
            "US": "76.81.9.69",
            "CA": "192.206.151.131",
            "GB": "178.238.11.6",
            "FR": "193.169.64.141",
        }
        headers["X-Forwarded-For"] = spoof_ips.get((code or "US").upper(), "76.81.9.69")
        headers["Referer"] = "https://pluto.tv/"
        headers["Origin"] = "https://pluto.tv"
    req = client.build_request("GET", url, headers=headers, timeout=20)
    try:
        resp = await client.send(req, stream=True)
    except httpx.HTTPError as exc:
        raise HTTPException(502, f"upstream error: {exc}") from exc

    content_type = resp.headers.get("content-type")
    if proxy.is_playlist(url, content_type):
        body = (await resp.aread()).decode("utf-8", errors="replace")
        await resp.aclose()
        return Response(
            proxy.rewrite_m3u8(body, str(resp.url)),
            media_type="application/vnd.apple.mpegurl",
            headers={"Access-Control-Allow-Origin": "*"},
        )

    async def iterate():
        try:
            async for chunk in resp.aiter_bytes():
                yield chunk
        finally:
            await resp.aclose()

    return StreamingResponse(
        iterate(),
        status_code=resp.status_code,
        media_type=content_type or "application/octet-stream",
        headers={"Access-Control-Allow-Origin": "*"},
    )


@app.get("/playlist.m3u", response_class=PlainTextResponse)
async def playlist(
    country: str = "",
    category: str = "",
    q: str = "",
    favorites: bool = False,
    nsfw: bool = False,
    alive: bool = False,
    group_by: str = "country",
) -> Response:
    channels = _filtered(country, category, q, favorites, nsfw)
    if alive:
        channels = [
            ch for ch in channels if app.state.health.get(ch["streams"][0]["url"]) is not False
        ]
    names = {c["code"]: c["name"] for c in app.state.catalog["countries"]}
    return Response(
        m3u.render(channels, group_by=group_by, country_names=names),
        media_type="audio/x-mpegurl",
        headers={"Content-Disposition": 'attachment; filename="tvlc.m3u"'},
    )


@app.middleware("http")
async def add_no_cache_headers(request: Request, call_next):
    response = await call_next(request)
    if request.url.path in ("/", "/index.html"):
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    return response


class CORSStaticFiles(StaticFiles):
    async def simple_response(self, *args, **kwargs):
        response = await super().simple_response(*args, **kwargs)
        response.headers["Access-Control-Allow-Origin"] = "*"
        return response


import xml.etree.ElementTree as ET

@app.get("/api/music/npr")
async def npr_tiny_desk() -> dict:
    """Fetch and parse NPR Tiny Desk Concert RSS feed."""
    url = "https://www.npr.org/rss/podcast.php?id=510306"
    try:
        async with httpx.AsyncClient(follow_redirects=True) as client:
            resp = await client.get(url, timeout=15)
            resp.raise_for_status()
            root = ET.fromstring(resp.content)
            channel = root.find("channel")
            items = channel.findall("item") if channel else []
            
            tracks = []
            for item in items[:50]:
                title = item.find("title").text if item.find("title") is not None else "Unknown Concert"
                
                enclosure = item.find("enclosure")
                enc_url = enclosure.attrib.get("url") if enclosure is not None else None
                if not enc_url:
                    continue
                    
                itunes_ns = "{http://www.itunes.com/dtds/podcast-1.0.dtd}"
                img_node = item.find(f"{itunes_ns}image")
                img_url = img_node.attrib.get("href") if img_node is not None else None
                
                desc = item.find("description")
                summary = desc.text if desc is not None else ""
                summary = re.sub('<[^<]+?>', '', summary)[:150]
                
                tracks.append({
                    "id": f"npr:{enc_url.split('/')[-2] if '/' in enc_url else title}",
                    "title": title,
                    "url": enc_url,
                    "type": "vod",
                    "poster": img_url,
                    "genre": "Acoustic Session",
                    "summary": f"NPR Tiny Desk: {summary}"
                })
            return {"tracks": tracks}
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Failed to fetch NPR feed: {exc}")


@app.get("/api/music/archive")
async def archive_live_concerts(rows: int = 30) -> dict:
    """Fetch top-downloaded concerts from the Internet Archive Live Music Archive."""
    url = "https://archive.org/advancedsearch.php"
    params = {
        "q": "collection:etree AND format:(MP3 OR \"VBR MP3\") AND downloads:[5000 TO 999999]",
        "fl[]": ["identifier", "title", "creator", "year", "downloads"],
        "sort[]": "downloads desc",
        "rows": rows,
        "output": "json"
    }
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(url, params=params, timeout=15)
            resp.raise_for_status()
            docs = resp.json().get("response", {}).get("docs", [])
            
            concerts = []
            for doc in docs:
                ident = doc["identifier"]
                creator = doc.get("creator", "Unknown Artist")
                title = doc.get("title", ident)
                downloads = doc.get("downloads", 0)
                year = doc.get("year", "N/A")
                
                concerts.append({
                    "id": f"archive_concert:{ident}",
                    "identifier": ident,
                    "title": title,
                    "creator": creator,
                    "downloads": downloads,
                    "year": year,
                    "poster": f"https://archive.org/services/img/{ident}",
                    "genre": "Live Concert",
                    "summary": f"Artist: {creator} · Downloads: {downloads:,} · Year: {year}"
                })
            return {"concerts": concerts}
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Failed to fetch Archive concerts: {exc}")


@app.get("/api/music/archive/{identifier}/tracks")
async def archive_concert_tracks(identifier: str) -> dict:
    """Fetch tracklist files inside an Internet Archive concert item."""
    url = f"https://archive.org/metadata/{identifier}"
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(url, timeout=15)
            resp.raise_for_status()
            files_data = resp.json().get("files", [])
            
            tracks = []
            for file in files_data:
                if file.get("format") in ("VBR MP3", "MP3"):
                    name = file["name"]
                    title = file.get("title", name.replace(".mp3", ""))
                    length = file.get("length", "0.0")
                    try:
                        duration = float(length)
                    except ValueError:
                        duration = 0.0
                        
                    tracks.append({
                        "id": f"archive_track:{identifier}:{name}",
                        "title": title,
                        "url": f"https://archive.org/download/{identifier}/{name}",
                        "type": "vod",
                        "poster": f"https://archive.org/services/img/{identifier}",
                        "genre": "Live Track",
                        "summary": f"Duration: {int(duration // 60)}m {int(duration % 60)}s"
                    })
            return {"tracks": tracks}
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Failed to fetch concert tracks: {exc}")


@app.get("/api/local/music")
async def local_music_catalog() -> dict:
    """JSON manifest of the scanned local music folder."""
    return music_scanner.scan_library()


@app.get("/api/local/music/art/{track_id:path}")
async def local_music_art(track_id: str):
    """Extract and serve embedded artwork for a track."""
    music_dir = music_scanner.get_music_dir()
    track_path = (music_dir / track_id).resolve()
    
    if not track_path.exists() or not track_path.is_file() or not track_path.is_relative_to(music_dir):
        raise HTTPException(status_code=404, detail="Track not found")
        
    art_data = music_scanner.extract_album_art(track_path)
    if not art_data:
        raise HTTPException(status_code=404, detail="No artwork found")
        
    data, mime = art_data
    return Response(content=data, media_type=mime)


app.mount("/api/local/music/file", CORSStaticFiles(directory=str(music_scanner.get_music_dir())), name="local_music_files")
app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")
