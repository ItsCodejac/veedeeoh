"""Bulk maintenance: `tvlc sweep` health-checks the entire catalog."""

from __future__ import annotations

import asyncio
import time

import httpx

from .catalog import build_catalog, load_raw
from .health import probe
from .store import HealthCache

CONCURRENCY = 40


async def sweep() -> None:
    """Probe every channel's default stream and persist the verdicts."""
    cat = build_catalog(await load_raw())
    cache = HealthCache()
    urls = {ch["streams"][0]["url"] for ch in cat["channels"]}
    todo = [u for u in urls if cache.get(u) is None]
    print(f"{len(urls)} streams, {len(todo)} need checking "
          f"({len(urls) - len(todo)} have fresh verdicts)")

    sem = asyncio.Semaphore(CONCURRENCY)
    done = alive = 0

    async with httpx.AsyncClient(follow_redirects=True) as client:
        async def check(url: str) -> None:
            nonlocal done, alive
            async with sem:
                ok = await probe(url, client)
            cache.data[url] = {"ok": ok, "checked_at": time.time()}
            done += 1
            alive += ok
            if done % 100 == 0:
                cache.store.save(cache.data)
                print(f"  {done}/{len(todo)} checked, {alive} alive")

        await asyncio.gather(*(check(u) for u in todo))

    cache.store.save(cache.data)
    total_alive = sum(1 for u in urls if cache.get(u))
    print(f"done: {total_alive}/{len(urls)} streams alive "
          f"({total_alive / len(urls):.0%}) — restart tvlc to pick up verdicts")


def main() -> None:
    asyncio.run(sweep())
