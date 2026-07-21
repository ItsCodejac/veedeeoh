import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import * as path from 'path';
import * as vod from './vod';
import * as proxy from './proxy';
import * as store from './store';
import { createClient } from '@supabase/supabase-js';

const app = new Hono();

const supabaseUrl = process.env.SUPABASE_URL || 'https://placeholder.supabase.co';
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || 'placeholder_key';
const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Auth middleware for API and Proxy
const requireAuth = async (c: any, next: any) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.text('Unauthorized', 401);
  }
  const token = authHeader.split(' ')[1];
  const { data: { user }, error } = await supabase.auth.getUser(token);
  
  if (error || !user) {
    return c.text('Unauthorized', 401);
  }
  await next();
};

app.use('*', cors());

// Apply auth middleware to protected routes (disabled for now)
// app.use('/api/*', requireAuth);
// app.use('/proxy/*', requireAuth);

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
    const entry = state.waitlist.add(email);

    if (supabaseUrl && !supabaseUrl.includes('placeholder')) {
      try {
        await supabase.from('waitlist').insert({ email: entry.email, created_at: entry.created_at });
      } catch (e) {
        // Ignore optional Supabase insert error
      }
    }

    return c.json({ ok: true, message: "You're on the waitlist! We'll email you as cloud spots open.", entry });
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
    const plutoRails = await vod.getCatalog(state.region.code);
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
