"""FastAPI app: catalog API, stream proxy, VLC launcher, playlist export."""

from __future__ import annotations

import asyncio
import platform
import subprocess
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
from fastapi import FastAPI, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.responses import PlainTextResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import captions, catalog, epg, health, m3u, proxy, thumbs, vod
from .store import Favorites, HealthCache

STATIC_DIR = Path(__file__).parent / "static"


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.catalog = catalog.build_catalog(await catalog.load_raw())
    app.state.favorites = Favorites()
    app.state.health = HealthCache()
    app.state.client = httpx.AsyncClient(follow_redirects=True)
    app.state.check_sem = asyncio.Semaphore(6)
    app.state.epg_keys = {
        ch["id"]: key
        for ch in app.state.catalog["channels"]
        if (key := epg.epg_key(ch))
    }
    app.state.epg_task = asyncio.create_task(epg.refresh(app.state.client))
    yield
    app.state.epg_task.cancel()
    await app.state.client.aclose()


app = FastAPI(title="TVLC", lifespan=lifespan)


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


@app.get("/api/vod")
async def vod_catalog() -> dict:
    """On-demand rails: Pluto VOD (with a synthesized anime rail) + Archive films."""
    rails = []
    try:
        rails = await vod.get_catalog(app.state.client)
    except (httpx.HTTPError, KeyError) as exc:
        return {"rails": [], "error": f"Pluto VOD unavailable: {exc}"}
    try:
        archive = await vod.archive_movies(app.state.client)
        if archive:
            rails.append({"name": "🎞 Archive Classics", "items": archive})
    except (httpx.HTTPError, KeyError):
        pass  # archive is a bonus rail
    return {"rails": rails}


@app.get("/api/vod/series/{series_id}")
async def vod_series(series_id: str) -> dict:
    try:
        return {"episodes": await vod.get_series(app.state.client, series_id)}
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
async def proxy_stream(url: str = Query(...)):
    if not url.startswith(("http://", "https://")):
        raise HTTPException(400, "bad url")
    client: httpx.AsyncClient = app.state.client
    req = client.build_request("GET", url, headers={"User-Agent": health.UA}, timeout=20)
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


app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")
