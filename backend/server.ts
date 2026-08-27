import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import * as path from 'path';
import * as vod from './vod';
import * as proxy from './proxy';
import * as store from './store';

const app = new Hono();

// NO SUPABASE IN THIS FILE, and that is the point of the file.
//
// This server IS the self-hosted product: it scrapes the same catalogue, proxies
// the same streams, and keeps its state in a JSON store on the machine it runs
// on. It has no accounts, no subscription, no watch parties and no database
// with anyone -- all of which are the cloud product, which is Vercel plus
// Supabase and lives in api/index.ts.
//
// What was here until now: a module-level Supabase client built from
// 'https://placeholder.supabase.co' and 'placeholder_key', feeding a requireAuth
// middleware whose two uses were commented out. Dead, and pointed at nothing,
// but it made this file look like it needed a cloud to run.

app.use('*', cors());

// Disable caching for all API routes to prevent stale UI state
app.use('/api/*', async (c, next) => {
  await next();
  c.header('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
  c.header('Pragma', 'no-cache');
  c.header('Expires', '0');
});

// Application state
const state = {
  favorites: new store.Favorites(),
  watched: new store.Watched(),
  health: new store.HealthCache(),
  waitlist: new store.Waitlist(),
  region: { code: 'US', source: 'default' }
};

// Initialize
async function init() {
  // Pre-warm VOD caches
  vod.getCatalog().catch(console.error);
  
  console.log("Initialization complete!");
}

init().catch(console.error);

app.get('/api/health', (c) => c.json({ status: 'ok', version: '1.0.0-ts' }));

const ALLOWED_EMAILS = new Set([
  'dannywsalama1@gmail.com',
  'itscojac@gmail.com',
  'fel250@live.com',
  'anthonyg.video@gmail.com',
  'davereed388@gmail.com'
]);

app.post('/api/auth/authorize', async (c) => {
  try {
    const body = await c.req.json();
    const email = (body?.email || '').trim().toLowerCase();

    if (ALLOWED_EMAILS.has(email)) {
      return c.json({ authorized: true, email });
    }

    return c.json({ authorized: false, error: 'Access is reserved for invited waitlist members.' }, 403);
  } catch (err) {
    return c.json({ authorized: false, error: 'Invalid request.' }, 400);
  }
});

app.post('/api/waitlist', async (c) => {
  try {
    const body = await c.req.json();
    const email = body?.email;
    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return c.json({ error: 'Please enter a valid email address.' }, 400);
    }
    // Local only. This used to also insert into the cloud project's waitlist
    // table whenever credentials happened to be present, which meant somebody
    // else's self-hosted instance could write rows into our database. The cloud
    // waitlist is api/index.ts's job and belongs to the deployment that owns it.
    const entry = state.waitlist.add(email);

    return c.json({ ok: true, message: "Added to the local waitlist.", entry });
  } catch (err: any) {
    return c.json({ error: 'Failed to record waitlist submission.' }, 500);
  }
});

app.get('/api/waitlist', (c) => {
  return c.json({ count: state.waitlist.entries.length, waitlist: state.waitlist.entries });
});

app.get('/api/catalog', (c) => {
  const healthVerdicts: Record<string, boolean> = {};
  for (const [url, entry] of Object.entries(state.health.data)) {
    if (state.health.get(url) !== null) {
      healthVerdicts[url] = entry.ok;
    }
  }

  return c.json({
    region: state.region,
    favorites: Array.from(state.favorites.ids).sort(),
    health: healthVerdicts
  });
});


app.get('/api/vod', async (c) => {
  const rails: any[] = [];
  try {
    const { rails: plutoRails } = await vod.getCatalog(state.region.code);
    rails.push(...plutoRails);
  } catch (e) {
    console.error("Pluto VOD error:", e);
  }
  
  try {
    const archive = await vod.archiveMovies(30);
    rails.push({ name: "🏛️ Archive Classics", items: archive });
  } catch (e) {
    console.error("Archive VOD error:", e);
  }
  

  console.log(`[GET /api/vod] Returning ${rails.length} rails to frontend.`);
  return c.json({ rails });
});

app.get('/api/vod/series/:id', async (c) => {
  try {
    const episodes = await vod.getSeries(c.req.param('id'), state.region.code);
    return c.json({ episodes });
  } catch (e: any) {
    return c.json({ error: e.message }, 502);
  }
});

// Resolve an Internet Archive item to a playable file URL (was previously
// missing, so Archive Classics + kids cartoons could never play).
app.get('/api/vod/archive/:id', async (c) => {
  try {
    const url = await vod.archiveStream(c.req.param('id'));
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
    const url = await vod.tubiStream(c.req.param('id'));
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
    const url = await vod.plutoStream(path, c.req.query('region') || state.region.code);
    return c.json({ url });
  } catch (e: any) {
    return c.json({ error: e?.message || 'Failed to load Pluto stream' }, 502);
  }
});

// Watch progress, kept on this machine.
//
// SELF-HOST HAS NO ACCOUNTS, so there is no per-profile row in a database to
// read: state lives in a JSON file next to the rest of it, which is what
// store.ts has always been for. An earlier pass wired these to Supabase with
// the caller's token, which quietly made the self-hosted server a client of the
// cloud one -- the exact coupling this build exists to not have.
//
// The profileId the client sends is accepted and ignored. One machine, one
// store; the parameter is part of the shared contract with the cloud API and
// costs nothing to tolerate.
app.get('/api/watched', (c) => {
  const watched = Array.from(state.watched.ids).sort().map((content_id) => ({
    content_id,
    position_secs: 0,
    duration_secs: null,
    completed: true,
    updated_at: null,
  }));
  return c.json({ watched });
});

app.post('/api/watched', async (c) => {
  try {
    const { contentId, completed } = await c.req.json();
    if (!contentId) return c.json({ error: 'Missing contentId' }, 400);
    // Only the completed flag is meaningful here. The local store is a set of
    // finished items, not a resume ledger, so a position update is a no-op
    // rather than an error: the client sends both and should not have to know
    // which server it is talking to.
    if (completed === true) state.watched.add(contentId);
    else if (completed === false) state.watched.remove(contentId);
    return c.json({ ok: true });
  } catch (e: any) {
    return c.json({ error: e?.message || 'Failed to update watch progress' }, 500);
  }
});

app.delete('/api/watched/:id?', (c) => {
  const contentId = c.req.param('id') || c.req.query('contentId');
  if (!contentId) return c.json({ error: 'Missing contentId' }, 400);
  state.watched.remove(contentId);
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

// Proxy route
app.get('/proxy', async (c) => {
  const rawUrl = c.req.query('url');
  const obf = c.req.query('obf');
  if (!rawUrl) return c.text('bad url', 400);
  
  const url: string = obf === '1' ? Buffer.from(rawUrl, 'hex').toString('utf-8') : rawUrl;
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    return c.text('bad url', 400);
  }

  const headers: Record<string, string> = { "User-Agent": "TVLC-TS/1.0" };
  if (url.includes('pluto.tv') || url.includes('jmp2.uk/plu-')) {
    headers["X-Forwarded-For"] = "76.81.9.69";
    headers["Referer"] = "https://pluto.tv/";
    headers["Origin"] = "https://pluto.tv";
  }

  try {
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    
    const contentType = res.headers.get('content-type');
    
    if (proxy.isPlaylist(url, contentType || "")) {
      const body = await res.text();
      return c.body(proxy.rewriteM3u8(body, res.url), 200, {
        'Content-Type': 'application/vnd.apple.mpegurl',
        'Access-Control-Allow-Origin': '*'
      });
    } else {
      return c.body(res.body as any, 200, {
        'Content-Type': contentType || 'application/octet-stream',
        'Access-Control-Allow-Origin': '*'
      });
    }
  } catch (e: any) {
    return c.text(`upstream error: ${e.message}`, 502);
  }
});

// Fallback serve static frontend (default '/' serves main player directly for self-hosting)
app.use('/*', serveStatic({ 
  root: '../src/tvlc/static',
  rewriteRequestPath: (p) => p === '/' ? '/index.html' : p
}));

const port = Number(process.env.PORT) || 8321;
console.log(`Hono Server is running on http://localhost:${port}`);

serve({
  fetch: app.fetch,
  port
});
