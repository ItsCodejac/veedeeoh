"""TVLC — browse and watch the iptv-org catalog, with VLC as the player."""

from __future__ import annotations

import os
import threading
import webbrowser


def main() -> None:
    import uvicorn

    host = os.environ.get("TVLC_HOST", "127.0.0.1")
    port = int(os.environ.get("TVLC_PORT", "8321"))
    if os.environ.get("TVLC_NO_BROWSER") != "1":
        threading.Timer(1.5, webbrowser.open, args=(f"http://{host}:{port}",)).start()
    uvicorn.run("tvlc.server:app", host=host, port=port)
