# TVLC — design

A self-hosted web app for browsing and watching the [iptv-org](https://github.com/iptv-org/iptv) catalog
(~10k free live TV streams), with VLC as the "real" player.

## Goals

- Make the giant unfiltered `index.m3u` usable: search, filters, logos, favorites.
- Hybrid playback: instant in-page preview (hls.js) + one-click "Open in VLC".
- Export any filtered view / favorites as a clean grouped `.m3u` for VLC or other devices.
- Lazy stream-health checking with cached verdicts and badges.
- Shareable on GitHub: `uv run tvlc` and you're watching.

## Architecture

- **Backend:** Python 3.12, FastAPI + uvicorn, httpx, managed with `uv`.
- **Frontend:** static vanilla HTML/CSS/JS + hls.js (CDN). No build step.
- **Persistence:** JSON files under the platform cache/data dirs (`platformdirs`):
  - cached iptv-org API responses (refreshed after 24h)
  - `favorites.json` (set of channel ids)
  - `health.json` (stream url → {ok, checked_at})

### Modules (`src/tvlc/`)

| Module | Responsibility |
|---|---|
| `catalog.py` | Fetch/cache iptv-org API (`channels`, `streams`, `logos`, `countries`, `categories`); join into a flat channel list; filtering (country, category, search, nsfw, favorites) |
| `m3u.py` | Render a channel list to an `.m3u` with `group-title`, `tvg-id`, `tvg-logo` |
| `proxy.py` | Stream proxy for CORS; rewrites HLS playlists so segment URIs route back through the proxy |
| `health.py` | Probe a stream url (short GET, small read, timeout); verdict cache with TTL |
| `store.py` | Favorites + health JSON persistence |
| `server.py` | FastAPI app: API routes, static files, VLC launcher |
| `__init__.py` | `main()`: start uvicorn, open browser |

### API

- `GET /api/catalog` — joined channel list + countries/categories metadata
- `GET /proxy?url=...` — CORS proxy with m3u8 rewriting
- `POST /api/vlc` `{url}` — launch VLC on the host
- `GET/POST/DELETE /api/favorites` — favorites CRUD
- `POST /api/check` `{url}` — health-probe a stream (cached)
- `GET /playlist.m3u?country=&category=&q=&favorites=&alive=` — filtered export

## Decisions

- NSFW hidden by default (iptv-org flags it); toggle in UI.
- Dead channels sort last, never deleted (streams come back).
- Health checks are lazy (on view/play), never a full 10k upfront scan.
- Channel identity = channel id; a channel may have several streams, first is default,
  others exposed in the player panel.
