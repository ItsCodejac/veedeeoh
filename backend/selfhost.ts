import { serveStatic } from '@hono/node-server/serve-static';
import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import * as path from 'path';
import * as vod from './vod';
import * as proxy from './proxy';
import * as store from './store';
import { LocalLibrary, localProfile } from './local-library';

export interface SelfHostOptions {
  dataDir?: string;
  staticRoot?: string;
  providers?: typeof vod;
  fetch?: typeof fetch;
}

export function createSelfHostApp(options: SelfHostOptions = {}) {
  const app = new Hono();
  const providers = options.providers || vod;
  const upstream = options.fetch || fetch;
  const library = new LocalLibrary(options.dataDir);
  const dataDir = options.dataDir || store.DATA_DIR;
  const staticRoot = options.staticRoot || path.resolve(__dirname, '../src/tvlc/static');
  const profile = (c: Context): string | undefined => c.req.query('profileId');
  const text = (value: unknown): string | null => typeof value === 'string' ? value.slice(0, 1000) : null;
  const itemId = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 500;
  const region = (c: Context): string => {
    const value = (c.req.query('region') || 'US').toUpperCase();
    return /^[A-Z]{2}$/.test(value) ? value : 'US';
  };
  app.use('/api/*', async (c, next) => {
    try { localProfile(profile(c)); } catch { return c.json({ error: 'Invalid local profile' }, 400); }
    await next();
  });
  app.onError((error, c) => {
    if (error instanceof SyntaxError) return c.json({ error: 'Invalid JSON request' }, 400);
    console.error('[self-host]', error);
    return c.json({ error: 'Could not read or save local data. Check the server log and data-folder permissions.' }, 500);
  });

  app.use('*', cors());

  // Disable caching for all API routes to prevent stale UI state
  app.use('/api/*', async (c, next) => {
    await next();
    c.header('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
    c.header('Pragma', 'no-cache');
    c.header('Expires', '0');
  });

  const health = new store.HealthCache(path.join(dataDir, 'health.json'));
  app.get('/api/health', c => c.json({ status: 'ok', mode: 'selfhost', version: '1.0.0-ts' }));

  app.get('/api/catalog', (c) => {
    const healthVerdicts: Record<string, boolean> = {};
    for (const [url, entry] of Object.entries(health.data)) {
      if (health.get(url) !== null) {
        healthVerdicts[url] = entry.ok;
      }
    }

    return c.json({
      region: { code: region(c), source: 'selected' },
      favorites: library.read(profile(c)).favorites.map(x => x.content_id),
      health: healthVerdicts
    });
  });


  app.get('/api/vod', async (c) => {
    const rails: any[] = [];
    let stats: any = {};
    try {
      const { rails: plutoRails, stats: catalogStats } = await providers.getCatalog(region(c));
      stats = catalogStats;
      rails.push(...plutoRails);
    } catch (e) {
      console.error("Pluto VOD error:", e);
    }

    try {
      const archive = await providers.archiveMovies(30);
      rails.push({ name: "🏛️ Archive Classics", items: archive });
    } catch (e) {
      console.error("Archive VOD error:", e);
    }


    console.log(`[GET /api/vod] Returning ${rails.length} rails to frontend.`);
    return c.json({ rails, stats });
  });

  app.get('/api/vod/series/:id', async (c) => {
    try {
      const episodes = await providers.getSeries(c.req.param('id'), region(c));
      return c.json({ episodes });
    } catch (e: any) {
      return c.json({ error: e.message }, 502);
    }
  });

  // Resolve an Internet Archive item to a playable file URL (was previously
  // missing, so Archive Classics + kids cartoons could never play).
  app.get('/api/vod/archive/:id', async (c) => {
    try {
      const url = await providers.archiveStream(c.req.param('id'));
      if (!url) return c.json({ error: 'no playable file' }, 404);
      return c.json({ url });
    } catch (e: any) {
      return c.json({ error: e.message }, 502);
    }
  });

  // Resolve a Tubi movie to a playable HLS URL (adrise content API). Tubi's listing
  // no longer embeds manifests, so movies resolve their stream on demand here.
  app.get('/api/vod/tubi/:id', async (c) => {
    try {
      const url = await providers.tubiStream(c.req.param('id'));
      if (!url) return c.json({ error: 'no playable stream' }, 404);
      return c.json({ url });
    } catch (e: any) {
      return c.json({ error: e.message }, 502);
    }
  });

  // Resolve a Pluto movie to a playable HLS URL. The catalog stores only the
  // short unsigned path; the signed 24h URL is minted at play time.
  //
  // THIS WAS MISSING, and it is the reason self-hosting did not work. The
  // frontend calls /api/vod/pluto and throws when it fails, so every Pluto title
  // -- most of the catalogue -- was unplayable on a self-hosted instance while
  // working fine on the hosted one. Nothing caught it because the two servers
  // were only ever compared by reading them.
  app.get('/api/vod/pluto', async (c) => {
    try {
      const path = c.req.query('path');
      if (!path) return c.json({ error: 'Missing Pluto path' }, 400);
      // Same guard as the hosted route: this value reaches an upstream fetch, so
      // it is checked against the one shape it is allowed to have.
      if (!path.startsWith('/stitch/')) return c.json({ error: 'Invalid Pluto path' }, 400);
      const url = await providers.plutoStream(path, region(c));
      return c.json({ url });
    } catch (e: any) {
      return c.json({ error: e?.message || 'Failed to load Pluto stream' }, 502);
    }
  });

  // Both products use the same frontend data contract. Local shelves are stored
  // on this server, keyed by the browser's local profile ID, without cloud auth.
  app.get('/api/favorites', c => c.json({ favorites: library.read(profile(c)).favorites }));
  app.post('/api/favorites', async c => {
    const body = await c.req.json();
    if (!itemId(body.content_id)) return c.json({ error: 'Missing content_id' }, 400);
    library.favorite(profile(c), { content_id: body.content_id, title: text(body.title), poster: text(body.poster) });
    return c.json({ ok: true });
  });
  app.delete('/api/favorites/:id', c => {
    library.removeFavorite(profile(c), c.req.param('id'));
    return c.json({ ok: true });
  });
  app.get('/api/progress', c => c.json({ progress: library.read(profile(c)).progress }));
  app.post('/api/progress', async c => {
    const body = await c.req.json();
    if (!itemId(body.content_id) || !Number.isFinite(body.position_secs) || body.position_secs < 0 ||
        (body.duration_secs != null && (!Number.isFinite(body.duration_secs) || body.duration_secs < 0))) {
      return c.json({ error: 'Invalid watch progress' }, 400);
    }
    const duration = body.duration_secs == null ? null : Math.floor(body.duration_secs);
    library.progress(profile(c), {
      content_id: body.content_id, title: text(body.title), position_secs: Math.floor(body.position_secs),
      duration_secs: duration, completed: !!duration && body.position_secs >= duration * 0.95,
      updated_at: new Date().toISOString(),
      stream_idx: Number.isSafeInteger(body.stream_idx) && body.stream_idx >= 0 ? body.stream_idx : 0,
      episode_title: text(body.episode_title),
    });
    return c.json({ ok: true });
  });
  app.get('/api/watched', c => c.json({ watched: library.read(profile(c)).progress.filter(x => x.completed) }));
  app.post('/api/watched', async c => {
    const body = await c.req.json();
    if (!itemId(body.contentId) || typeof body.completed !== 'boolean') return c.json({ error: 'Invalid watched item' }, 400);
    library.watched(profile(c), body.contentId, body.completed);
    return c.json({ ok: true });
  });
  app.delete('/api/watched/:id', c => {
    library.watched(profile(c), c.req.param('id'), false);
    return c.json({ ok: true });
  });

  // Anything under /api that nothing above handled. Without this it fell through
  // to the static handler and answered with the SPA's index.html and a 200, so a
  // caller asking for JSON got a page of HTML and had to guess why. The routes
  // that legitimately do not exist here are the hosted-only ones -- billing, the
  // crons, the auth email hook -- and this says so instead of pretending.
  app.all('/api/*', (c) =>
    c.json({
      error: 'not available on this instance',
      detail: 'This endpoint belongs to the hosted veedeeoh deployment. A self-hosted instance has no accounts, billing, scheduled jobs or transactional email, and needs none of them.',
      path: c.req.path,
    }, 501));

  // Keep streaming bodies streaming, including byte ranges used for seeking.
  const mediaCors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Range, Content-Type',
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges, Content-Type',
  };
  app.options('/proxy', c => c.body(null, 204, mediaCors));
  app.on(['GET', 'HEAD'], '/proxy', async c => {
    const raw = c.req.query('url');
    if (!raw) return c.text('bad url', 400, mediaCors);
    const url = c.req.query('obf') === '1' ? Buffer.from(raw, 'hex').toString('utf8') : raw;
    let parsed: URL;
    try { parsed = new URL(url); } catch { return c.text('bad url', 400, mediaCors); }
    if (!['http:', 'https:'].includes(parsed.protocol)) return c.text('bad url', 400, mediaCors);
    const headers: Record<string, string> = { 'User-Agent': 'TVLC-TS/1.0' };
    if (/(^|\.)pluto\.tv$/.test(parsed.hostname) || parsed.hostname === 'jmp2.uk') {
      headers['X-Forwarded-For'] = '76.81.9.69';
      headers.Referer = 'https://pluto.tv/';
      headers.Origin = 'https://pluto.tv';
    }
    const range = c.req.header('range');
    if (range) headers.Range = range;
    try {
      const response = await upstream(url, { headers, method: c.req.method, signal: c.req.raw.signal });
      const out: Record<string, string> = { ...mediaCors };
      for (const name of ['Content-Type', 'Content-Length', 'Content-Range', 'Accept-Ranges']) {
        const value = response.headers.get(name);
        // Node fetch decompresses upstream bodies while retaining their original
        // headers. A compressed Content-Length would truncate or stall the
        // browser's request (notably Pluto's 16-byte AES keys).
        const encoded = response.headers.get('content-encoding');
        if (value && !(name === 'Content-Length' && encoded && encoded !== 'identity')) out[name] = value;
      }
      if (c.req.method === 'HEAD') return c.body(null, response.status as any, out);
      if (!response.ok) return new Response(response.body, { status: response.status, headers: out });
      if (proxy.isPlaylist(response.url || url, response.headers.get('content-type'))) {
        const rewritten = proxy.rewriteM3u8(await response.text(), response.url || url);
        return c.body(rewritten, 200, { ...mediaCors, 'Content-Type': 'application/vnd.apple.mpegurl' });
      }
      return new Response(response.body, { status: response.status, headers: out });
    } catch (error: any) {
      return c.text(`upstream error: ${error.message}`, 502, mediaCors);
    }
  });

  // Serve real assets first; only known application routes get the SPA shell.
  app.use('/*', serveStatic({ root: staticRoot, rewriteRequestPath: p => p === '/' ? '/index.html' : p }));
  for (const route of ['/home', '/shows', '/movies', '/list', '/favorites', '/kids', '/search', '/search/:query', '/app', '/settings', '/settings/:section']) {
    app.get(route, serveStatic({ path: path.join(staticRoot, 'index.html') }));
    app.get(route + '/', serveStatic({ path: path.join(staticRoot, 'index.html') }));
  }
  return app;
}
