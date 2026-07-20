"""Smart channel tagging via a local LLM (Ollama).

`tvlc categorize` runs every channel's evidence (name, country, provider,
source categories, and what the EPG says it's airing) through a local model
and caches multi-label tags to smart_tags.json. Fully offline, resumable.
"""

from __future__ import annotations

import asyncio
import json
import os

import httpx

from . import epg
from .catalog import TAG_NAMES, build_catalog, load_raw
from .store import DATA_DIR

OLLAMA = os.environ.get("TVLC_OLLAMA_URL", "http://localhost:11434")
MODEL = os.environ.get("TVLC_LLM_MODEL", "gemma4:e2b")
BATCH = 20
TAGS_PATH = DATA_DIR / "smart_tags.json"

SYSTEM = f"""You tag live TV channels with genres. For each channel you receive its \
name, country, provider, existing category hints, and sample program titles it is \
currently airing. Assign 1-3 tags per channel from this exact list:
{", ".join(TAG_NAMES)}

Rules: prefer specific tags (a channel airing Naruto is "anime", not just \
"animation"; a channel named FrightFlix is "horror" and "movies", not just \
"movies"). The channel name's genre words are strong evidence, as are program \
titles. Use "general" only when nothing else fits. Answer for every channel \
you are given, in the same order."""

SCHEMA = {
    "type": "object",
    "properties": {
        "channels": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "id": {"type": "string"},
                    "tags": {
                        "type": "array",
                        "items": {"type": "string", "enum": list(TAG_NAMES)},
                    },
                },
                "required": ["id", "tags"],
            },
        }
    },
    "required": ["channels"],
}


def _evidence(ch: dict, programs: list[str]) -> str:
    parts = [f"id={ch['id']}", f"name={ch['name']}"]
    if ch.get("country"):
        parts.append(f"country={ch['country']}")
    if ch.get("source") and ch["source"] != "iptv-org":
        parts.append(f"provider={ch['source']}")
    if ch.get("categories"):
        parts.append(f"hints={','.join(ch['categories'][:4])}")
    if programs:
        parts.append(f"airing={' | '.join(programs[:3])}")
    return " ; ".join(parts)


def channel_programs(ch: dict) -> list[str]:
    key = epg.epg_key(ch)
    if not key:
        return []
    return [title for _start, _stop, title in epg.guide.get(key, [])[:3]]


async def tag_batch(client: httpx.AsyncClient, batch: list[dict]) -> dict[str, list[str]]:
    lines = "\n".join(_evidence(ch, channel_programs(ch)) for ch in batch)
    resp = await client.post(
        f"{OLLAMA}/api/chat",
        json={
            "model": MODEL,
            "stream": False,
            "format": SCHEMA,
            "options": {"temperature": 0},
            "messages": [
                {"role": "system", "content": SYSTEM},
                {"role": "user", "content": f"Tag these channels:\n{lines}"},
            ],
        },
        timeout=300,
    )
    resp.raise_for_status()
    data = json.loads(resp.json()["message"]["content"])
    valid_ids = {ch["id"] for ch in batch}
    return {
        entry["id"]: [t for t in entry["tags"] if t in TAG_NAMES][:3]
        for entry in data.get("channels", [])
        if entry.get("id") in valid_ids and entry.get("tags")
    }


async def run() -> None:
    cat = build_catalog(await load_raw())
    channels = cat["channels"]
    async with httpx.AsyncClient(follow_redirects=True) as client:
        await epg.refresh(client)

    tags: dict[str, list[str]] = {}
    if TAGS_PATH.exists():
        tags = json.loads(TAGS_PATH.read_text())
    todo = [ch for ch in channels if ch["id"] not in tags]
    print(f"{len(channels)} channels, {len(todo)} untagged, model={MODEL}")

    async with httpx.AsyncClient() as client:
        for i in range(0, len(todo), BATCH):
            batch = todo[i : i + BATCH]
            try:
                tags.update(await tag_batch(client, batch))
            except (httpx.HTTPError, json.JSONDecodeError, KeyError) as exc:
                print(f"  batch {i // BATCH} failed ({exc}); skipping")
                continue
            DATA_DIR.mkdir(parents=True, exist_ok=True)
            TAGS_PATH.write_text(json.dumps(tags))
            done = min(i + BATCH, len(todo))
            if (i // BATCH) % 5 == 0:
                print(f"  {done}/{len(todo)} tagged ({len(tags)} total)")

    print(f"done: {len(tags)} channels tagged -> {TAGS_PATH}")
    print("restart tvlc to pick up the new tags")


def main() -> None:
    asyncio.run(run())
