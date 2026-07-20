# veedeeoh.

Browse and watch the [iptv-org](https://github.com/iptv-org/iptv) catalog — ~10,000 free,
legal live TV streams from around the world — without drowning in one giant alphabetical
playlist. veedeeoh. gives you a channel grid with logos, filters, favorites, and
instant in-page previews, with **VLC one click away** for proper watching.

## Features

- 🖼 **Channel grid with logos** — lazy-loaded, infinite scroll
- ▶️ **In-page preview** via hls.js (streams are proxied locally to dodge CORS), with an
  **Open in VLC** button for the real thing
- ★ **Favorites** — persisted locally, pinned to the top of the grid
- 🎲 **Surprise me** — jump to a random channel within your current filters
- 🟢 **Lazy health checks** — streams are probed as their cards scroll into view;
  dead channels dim and sink to the bottom (never deleted — streams come back)
- ⤓ **Export M3U** — download whatever your current filters show as a clean playlist with
  `group-title` folders and logos, ready for plain VLC or any IPTV app
- 💬 **Live captions & translation** — a CC button in the player runs the stream's audio
  through a local Whisper model ([faster-whisper](https://github.com/SYSTRAN/faster-whisper)):
  one click for original-language captions, another for live translation to English.
  Needs `ffmpeg` (`brew install ffmpeg`); the model (~500 MB) downloads on first use.
- 🔞 NSFW channels hidden by default

## Known issues

- Search doesn't work yet
- The country dropdown is from a removed feature and does nothing
- The home page is still under development

## Download (Windows)

Grab the latest build from the [Releases](../../releases) page:

1. Download `veedeeoh-windows.zip` and unzip it
2. Open the `veedeeoh` folder
3. Double-click `veedeeoh.exe`
4. Your browser opens automatically to `http://127.0.0.1:8321`

> VLC must be installed separately if you want "Open in VLC" to work.

## Run from source

Requires [uv](https://docs.astral.sh/uv/) and (optionally) [VLC](https://www.videolan.org/).

```sh
uv run tvlc
```

First launch downloads and caches the iptv-org catalog (~20 MB), then opens
`http://127.0.0.1:8321` in your browser.

Environment knobs: `TVLC_PORT` (default 8321), `TVLC_HOST` (default 127.0.0.1),
`TVLC_NO_BROWSER=1` to skip auto-opening the browser, `TVLC_REGION` to force an
availability region (ISO country code) instead of auto-detecting your egress.

## Development

Backend (Python / FastAPI):

```sh
uv run pytest        # tests
uv run ruff check .  # lint
```

Frontend (TypeScript / Vite, in `frontend/`). The built bundle is committed to
`src/tvlc/static/`, so Python-only users never need node — rebuild it when you
change frontend code:

```sh
cd frontend
npm install
npm run dev    # dev server on :5173, proxies API calls to the running backend
npm run build  # type-check + build into src/tvlc/static/
```

## Credits

All channel data and streams come from the wonderful [iptv-org](https://github.com/iptv-org)
project. veedeeoh. hosts nothing — it only organizes publicly available streams they index.
