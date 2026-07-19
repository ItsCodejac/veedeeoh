"""Live closed captions: ffmpeg pulls stream audio, Whisper transcribes it.

The model (faster-whisper, CTranslate2) runs locally on CPU. Whisper natively
supports two tasks: "transcribe" (original language) and "translate" (to
English), so the same model powers both CC modes.
"""

from __future__ import annotations

import asyncio
import os
import shutil
from typing import AsyncIterator

SAMPLE_RATE = 16000
CHUNK_SECONDS = 6
CHUNK_BYTES = SAMPLE_RATE * 2 * CHUNK_SECONDS  # s16le mono

_model = None
_model_lock = asyncio.Lock()


def ffmpeg_available() -> bool:
    return shutil.which("ffmpeg") is not None


async def get_model():
    """Load the Whisper model once, lazily (first CC request downloads it)."""
    global _model
    async with _model_lock:
        if _model is None:
            from faster_whisper import WhisperModel

            name = os.environ.get("TVLC_WHISPER_MODEL", "small")
            _model = await asyncio.to_thread(
                WhisperModel, name, device="cpu", compute_type="int8"
            )
    return _model


async def _spawn_ffmpeg(url: str) -> asyncio.subprocess.Process:
    return await asyncio.create_subprocess_exec(
        "ffmpeg", "-nostdin", "-loglevel", "error",
        "-user_agent", "Mozilla/5.0",
        "-i", url,
        "-vn", "-ac", "1", "-ar", str(SAMPLE_RATE), "-f", "s16le", "-",
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.DEVNULL,
    )


async def caption_stream(url: str, translate: bool) -> AsyncIterator[dict]:
    """Yield {"text", "language"} caption segments for a live stream url."""
    import numpy as np

    model = await get_model()
    proc = await _spawn_ffmpeg(url)
    task = "translate" if translate else "transcribe"
    try:
        while True:
            data = await proc.stdout.readexactly(CHUNK_BYTES)  # type: ignore[union-attr]
            audio = np.frombuffer(data, dtype=np.int16).astype(np.float32) / 32768.0

            def run(chunk=audio):
                segments, info = model.transcribe(
                    chunk, task=task, vad_filter=True, beam_size=1
                )
                return " ".join(s.text.strip() for s in segments).strip(), info.language

            text, language = await asyncio.to_thread(run)
            if text:
                yield {"text": text, "language": language}
    except (asyncio.IncompleteReadError, asyncio.CancelledError):
        return
    finally:
        if proc.returncode is None:
            proc.kill()
            await proc.wait()
