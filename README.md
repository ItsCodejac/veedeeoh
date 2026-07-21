# veedeeoh.

Stream Video-on-Demand (movies, TV series, and classic cinema) across your devices without subscription fees. **veedeeoh.** is an open-core, self-hostable web application built with Hono (TypeScript) and Vite.

## Features

- 🍿 **VOD Catalog** — Pluto TV movies & TV shows, plus Internet Archive cinema classics
- ▶️ **In-Page Playback** — Native HLS streaming with CORS stream proxying
- ★ **Favorites & History** — Atomic JSON persistence for user state
- 🐳 **1-Click Self-Hosting** — Docker & Docker Compose support out of the box
- ⚡ **Sub-Second Response** — Pre-warmed VOD catalog caching and zero-dependency production builds

---

## 🐳 Self-Hosting (Docker Compose)

The easiest way to self-host **veedeeoh.** is using Docker Compose:

```yaml
version: '3.8'

services:
  veedeeoh:
    image: ghcr.io/itscodejac/veedeeoh:latest # or build from source
    build: .
    container_name: veedeeoh
    ports:
      - "8321:8321"
    environment:
      - PORT=8321
      - NODE_ENV=production
    volumes:
      - veedeeoh_data:/root/.local/share/tvlc
    restart: unless-stopped

volumes:
  veedeeoh_data:
```

Run:
```sh
docker compose up -d
```

Open `http://localhost:8321` (or `http://<your-server-ip>:8321`) in your browser to start streaming.

---

## 💻 Running from Source

Requires [Node.js 20+](https://nodejs.org/).

### 1. Build the Frontend
```sh
cd frontend
npm install
npm run build
```

### 2. Start the Backend Server
```sh
cd ../backend
npm install
npm run start
```

Open `http://localhost:8321` in your browser.

---

## Environment Variables

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `8321` | HTTP server port |
| `SUPABASE_URL` | *(Optional)* | Supabase Auth URL |
| `SUPABASE_ANON_KEY` | *(Optional)* | Supabase Anonymous Key |

---

## Development

- **Backend** (Node.js / Hono):
  ```sh
  cd backend
  npm run dev   # auto-reloading dev server
  ```

- **Frontend** (Vite / TypeScript):
  ```sh
  cd frontend
  npm run dev   # dev server on :5173 with backend proxying
  ```

---

## Credits

Content indexed from public video APIs including Pluto TV and Internet Archive.
