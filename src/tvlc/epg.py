"""Electronic program guide: XMLTV from i.mjh.nz mapped onto the catalog.

Samsung/Plex/Roku guide ids match those catalogs' channel ids directly;
Pluto guide ids are the 24-hex ids embedded in jmp2.uk/plu-<id> stream urls.
"""

from __future__ import annotations

import gzip
import re
import time
import xml.etree.ElementTree as ET
from datetime import datetime

import httpx

from .catalog import CACHE_DIR

EPG_SOURCES = [
    "https://i.mjh.nz/SamsungTVPlus/us.xml.gz",
    "https://i.mjh.nz/Plex/us.xml.gz",
    "https://i.mjh.nz/Roku/all.xml.gz",
    "https://i.mjh.nz/PlutoTV/us.xml.gz",
]
EPG_TTL = 6 * 3600
WINDOW_AHEAD = 12 * 3600  # keep programs up to 12h out

PLUTO_URL_ID = re.compile(r"jmp2\.uk/plu-([0-9a-f]{24})")

# epg channel id -> [(start_epoch, stop_epoch, title), ...] sorted by start
guide: dict[str, list[tuple[float, float, str]]] = {}
loaded_at: float = 0.0


def _parse_ts(raw: str) -> float:
    return datetime.strptime(raw, "%Y%m%d%H%M%S %z").timestamp()


def parse_xmltv(data: bytes, now: float | None = None) -> dict[str, list[tuple[float, float, str]]]:
    """Parse XMLTV bytes into the guide mapping, keeping a window around now."""
    now = now or time.time()
    out: dict[str, list[tuple[float, float, str]]] = {}
    root = ET.fromstring(data)
    for prog in root.iter("programme"):
        channel = prog.get("channel")
        start_raw, stop_raw = prog.get("start"), prog.get("stop")
        if not channel or not start_raw or not stop_raw:
            continue
        try:
            start, stop = _parse_ts(start_raw), _parse_ts(stop_raw)
        except ValueError:
            continue
        if stop < now or start > now + WINDOW_AHEAD:
            continue
        title = (prog.findtext("title") or "").strip()
        if title:
            out.setdefault(channel, []).append((start, stop, title))
    for programs in out.values():
        programs.sort()
    return out


async def refresh(client: httpx.AsyncClient) -> None:
    """Download (with cache) and parse all EPG sources into the module guide."""
    global guide, loaded_at
    merged: dict[str, list[tuple[float, float, str]]] = {}
    for url in EPG_SOURCES:
        name = url.split("i.mjh.nz/")[-1].replace("/", "_")
        cache_file = CACHE_DIR / f"epg_{name}"
        try:
            if cache_file.exists() and time.time() - cache_file.stat().st_mtime < EPG_TTL:
                raw = cache_file.read_bytes()
            else:
                resp = await client.get(url, timeout=120)
                resp.raise_for_status()
                raw = resp.content
                CACHE_DIR.mkdir(parents=True, exist_ok=True)
                cache_file.write_bytes(raw)
            merged.update(parse_xmltv(gzip.decompress(raw)))
        except (httpx.HTTPError, OSError, ET.ParseError, gzip.BadGzipFile):
            continue  # a missing guide shouldn't take the app down
    guide = merged
    loaded_at = time.time()


def epg_key(channel: dict) -> str | None:
    """Map a catalog channel to its guide id, if any."""
    if channel.get("source") in ("Samsung TV Plus", "Plex", "Roku"):
        return channel["id"].split(":", 1)[-1]
    for stream in channel["streams"]:
        m = PLUTO_URL_ID.search(stream["url"])
        if m:
            return m.group(1)
    return None


def now_next(key: str, now: float | None = None) -> dict | None:
    """Current and upcoming program for a guide id."""
    programs = guide.get(key)
    if not programs:
        return None
    now = now or time.time()
    entry: dict = {}
    for start, stop, title in programs:
        if start <= now < stop and "now" not in entry:
            entry["now"] = {"title": title, "start": start, "stop": stop}
        elif start > now:
            entry["next"] = {"title": title, "start": start, "stop": stop}
            break
    return entry or None
