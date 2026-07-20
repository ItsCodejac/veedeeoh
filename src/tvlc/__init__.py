"""TVLC — browse and watch the iptv-org catalog, with VLC as the player."""

from __future__ import annotations

import os
import sys
import threading
import webbrowser


def main() -> None:
    if len(sys.argv) > 1 and sys.argv[1] == "sweep":
        from . import maintenance

        maintenance.main()
        return
    if len(sys.argv) > 1 and sys.argv[1] == "categorize":
        from . import categorize

        categorize.main()
        return

    import uvicorn

    host = os.environ.get("TVLC_HOST", "127.0.0.1")
    port = int(os.environ.get("TVLC_PORT", "8321"))
    if os.environ.get("TVLC_NO_BROWSER") != "1":
        url = f"http://{host}:{port}"
        if sys.platform == "darwin":
            import subprocess
            def _open():
                subprocess.Popen(["/usr/bin/open", url])
        else:
            _open = lambda: webbrowser.open(url)
        threading.Timer(1.5, _open).start()
    uvicorn.run("tvlc.server:app", host=host, port=port)
