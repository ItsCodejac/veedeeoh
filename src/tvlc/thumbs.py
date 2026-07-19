"""Live thumbnails: ffmpeg grabs a real frame from a stream, cached on disk."""

from __future__ import annotations

import asyncio
import hashlib
import time
from pathlib import Path

from .catalog import CACHE_DIR
from .health import UA

THUMB_DIR = CACHE_DIR / "thumbs"
TTL = 10 * 60  # a frame stays representative for ~10 minutes
NEG_TTL = 10 * 60  # don't re-hammer streams that failed to yield a frame
GRAB_TIMEOUT = 25.0  # ad-stitched FAST streams (Samsung/Pluto) can be slow to start

_negative: dict[str, float] = {}
_sem = asyncio.Semaphore(4)


def _path(url: str) -> Path:
    return THUMB_DIR / f"{hashlib.sha1(url.encode()).hexdigest()}.jpg"


async def grab(url: str) -> bytes | None:
    """Return a JPEG frame for the stream, from cache when fresh."""
    path = _path(url)
    stale: bytes | None = None
    if path.exists():
        if time.time() - path.stat().st_mtime < TTL:
            return path.read_bytes()
        stale = path.read_bytes()
    if time.time() - _negative.get(url, 0) < NEG_TTL:
        return stale

    async with _sem:
        if path.exists() and time.time() - path.stat().st_mtime < TTL:
            return path.read_bytes()
        proc = await asyncio.create_subprocess_exec(
            "ffmpeg", "-nostdin", "-loglevel", "error",
            "-user_agent", UA,
            "-i", url,
            "-frames:v", "1", "-vf", "scale=480:-2", "-q:v", "5",
            "-f", "mjpeg", "pipe:1",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
        )
        try:
            out, _ = await asyncio.wait_for(proc.communicate(), GRAB_TIMEOUT)
        except TimeoutError:
            proc.kill()
            await proc.wait()
            _negative[url] = time.time()
            return stale
        if proc.returncode == 0 and out:
            THUMB_DIR.mkdir(parents=True, exist_ok=True)
            path.write_bytes(out)
            return out
        _negative[url] = time.time()
        return stale
