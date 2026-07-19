# TVLC 📺

Browse and watch the [iptv-org](https://github.com/iptv-org/iptv) catalog — ~10,000 free,
legal live TV streams from around the world — without drowning in one giant alphabetical
playlist. TVLC gives you a searchable channel grid with logos, filters, favorites, and
instant in-page previews, with **VLC one click away** for proper watching.

## Features

- 🔍 **Instant search** across ~10k channels, plus country / category filters
- 🖼 **Channel grid with logos** — lazy-loaded, infinite scroll
- ▶️ **In-page preview** via hls.js (streams are proxied locally to dodge CORS), with an
  **Open in VLC** button for the real thing
- ★ **Favorites** — persisted locally, pinned to the top of the grid
- 🎲 **Surprise me** — jump to a random channel within your current filters
- 🟢 **Lazy health checks** — streams are probed as their cards scroll into view;
  dead channels dim and sink to the bottom (never deleted — streams come back)
- ⤓ **Export M3U** — download whatever your current filters show as a clean playlist with
  `group-title` folders and logos, ready for plain VLC or any IPTV app; or subscribe
  directly to e.g. `http://localhost:8321/playlist.m3u?favorites=true&alive=true`
- 🔞 NSFW channels hidden by default

## Run it

Requires [uv](https://docs.astral.sh/uv/) and (optionally) [VLC](https://www.videolan.org/).

```sh
uv run tvlc
```

First launch downloads and caches the iptv-org catalog (~20 MB), then opens
`http://127.0.0.1:8321` in your browser.

Environment knobs: `TVLC_PORT` (default 8321), `TVLC_HOST` (default 127.0.0.1),
`TVLC_NO_BROWSER=1` to skip auto-opening the browser.

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

Design notes live in [docs/plans/](docs/plans/).

## Credits

All channel data and streams come from the wonderful [iptv-org](https://github.com/iptv-org)
project. TVLC hosts nothing — it only organizes publicly available streams they index.
