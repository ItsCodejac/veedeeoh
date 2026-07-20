"""JSON persistence for favorites and health verdicts."""

from __future__ import annotations

import json
import threading
import time
from pathlib import Path

from platformdirs import user_data_dir

DATA_DIR = Path(user_data_dir("tvlc"))

_lock = threading.Lock()


class JsonStore:
    """A small thread-safe JSON file store."""

    def __init__(self, path: Path, default: object) -> None:
        self.path = path
        self.default = default

    def load(self) -> object:
        try:
            return json.loads(self.path.read_text())
        except (OSError, json.JSONDecodeError):
            return json.loads(json.dumps(self.default))

    def save(self, data: object) -> None:
        with _lock:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            tmp = self.path.with_suffix(".tmp")
            tmp.write_text(json.dumps(data))
            tmp.replace(self.path)


class Favorites:
    def __init__(self, path: Path | None = None) -> None:
        self.store = JsonStore(path or DATA_DIR / "favorites.json", [])
        self.ids: set[str] = set(self.store.load())

    def add(self, channel_id: str) -> None:
        self.ids.add(channel_id)
        self.store.save(sorted(self.ids))

    def remove(self, channel_id: str) -> None:
        self.ids.discard(channel_id)
        self.store.save(sorted(self.ids))


class Watched:
    def __init__(self, path: Path | None = None) -> None:
        self.store = JsonStore(path or DATA_DIR / "watched.json", [])
        self.ids: set[str] = set(self.store.load())

    def add(self, episode_id: str) -> None:
        self.ids.add(episode_id)
        self.store.save(sorted(self.ids))

    def remove(self, episode_id: str) -> None:
        self.ids.discard(episode_id)
        self.store.save(sorted(self.ids))


class HealthCache:
    """Stream url -> {"ok": bool, "checked_at": epoch}. Verdicts expire after ttl."""

    def __init__(self, path: Path | None = None, ttl: float = 24 * 3600) -> None:
        self.store = JsonStore(path or DATA_DIR / "health.json", {})
        self.ttl = ttl
        self.data: dict[str, dict] = self.store.load()

    def get(self, url: str) -> bool | None:
        entry = self.data.get(url)
        if not entry or time.time() - entry["checked_at"] > self.ttl:
            return None
        return entry["ok"]

    def set(self, url: str, ok: bool) -> None:
        self.data[url] = {"ok": ok, "checked_at": time.time()}
        self.store.save(self.data)
