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
_sem = asyncio.Semaphore(6)


def _path(url: str) -> Path:
    return THUMB_DIR / f"{hashlib.sha1(url.encode()).hexdigest()}.jpg"


def is_pluto_url(url: str) -> bool:
    return "jmp2.uk/plu-" in url or "pluto.tv" in url


def looks_like_pluto_bumper(jpeg: bytes) -> bool:
    """Detect Pluto's geo-block loop: a mostly black frame with the yellow logo."""
    import io

    from PIL import Image

    try:
        img = Image.open(io.BytesIO(jpeg)).convert("RGB").resize((64, 36))
    except OSError:
        return False
    pixels = list(img.getdata())
    black = sum(1 for r, g, b in pixels if max(r, g, b) < 45)
    yellow = sum(1 for r, g, b in pixels if r > 190 and g > 170 and b < 120)
    n = len(pixels)
    return black / n > 0.55 and 0.004 < yellow / n < 0.35


async def grab(url: str) -> tuple[bytes | None, bool]:
    """Return (JPEG frame or None, is_geo_block_bumper) for the stream."""
    frame = await _grab_frame(url)
    if frame and is_pluto_url(url) and looks_like_pluto_bumper(frame):
        _negative[url] = time.time()
        return None, True
    return frame, False


async def _grab_frame(url: str) -> bytes | None:
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
