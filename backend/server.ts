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

// A Supabase client carrying the CALLER's bearer token, so RLS decides what
// they may touch. Never the service-role key on these routes: the profile id
// arrives from the client, and service-role would happily read and write
// somebody else's rows.
function callerSupabase(c: any) {
  return createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: c.req.header('authorization') || '' } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// Watch progress. The hosted deployment has had these since the beginning; here
// they returned the SPA's index.html, so the ticks silently never appeared.
app.get('/api/watched', async (c) => {
  const profileId = c.req.query('profileId');
  if (!profileId) return c.json({ watched: [] });
  try {
    const { data } = await callerSupabase(c)
      .from('watch_progress')
      .select('content_id, position_secs, duration_secs, completed, updated_at')
      .eq('profile_id', profileId);
    return c.json({ watched: data || [] });
  } catch (e: any) {
    return c.json({ watched: [], error: e?.message });
  }
});

app.post('/api/watched', async (c) => {
  try {
    const { profileId, contentId, positionSecs, durationSecs, completed } = await c.req.json();
    if (!profileId || !contentId) return c.json({ error: 'Missing profileId or contentId' }, 400);
    // Only send what was provided, so toggling "completed" does not wipe the
    // saved resume position: an omitted column keeps its value on upsert.
    const payload: any = { profile_id: profileId, content_id: contentId, updated_at: new Date().toISOString() };
    if (positionSecs !== undefined) payload.position_secs = positionSecs;
    if (durationSecs !== undefined) payload.duration_secs = durationSecs;
    if (completed !== undefined) payload.completed = !!completed;

    const { error } = await callerSupabase(c)
      .from('watch_progress')
      .upsert(payload, { onConflict: 'profile_id,content_id' });
    if (error) throw error;
    return c.json({ ok: true });
  } catch (e: any) {
    return c.json({ error: e?.message || 'Failed to update watch progress' }, 500);
  }
});

app.delete('/api/watched/:id?', async (c) => {
  try {
    const profileId = c.req.query('profileId');
    const contentId = c.req.param('id') || c.req.query('contentId');
    if (!profileId || !contentId) return c.json({ error: 'Missing profileId or contentId' }, 400);
    await callerSupabase(c).from('watch_progress').delete()
      .eq('profile_id', profileId).eq('content_id', contentId);
    return c.json({ ok: true });
  } catch (e: any) {
    return c.json({ error: e?.message || 'Failed to delete watch history' }, 500);
  }
});

// Everything this instance holds about the caller. RLS does the scoping, so
// each select returns only their own rows.
app.get('/api/account/export', async (c) => {
  const sb = callerSupabase(c);
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return c.json({ error: 'unauthorized' }, 401);

  const grab = async (table: string) => {
    const { data, error } = await sb.from(table).select('*');
    return error ? { error: error.message } : data;
  };

  return c.json({
    exported_at: new Date().toISOString(),
    account: { id: user.id, email: user.email },
    profiles: await grab('household_profiles'),
    watch_progress: await grab('watch_progress'),
    favorites: await grab('favorites'),
    collections: await grab('collections'),
    parties: await grab('parties'),
  });
});

// Deleting the auth user cascades the rest, which is true only from migration
// 20260826040000 onward -- before it, the viewing profiles and history survived.
//
// No Stripe step here, unlike the hosted route: a self-hosted instance has no
// subscription to cancel. It does need the service-role key, and says so
// plainly rather than half-deleting an account when it is absent.
app.post('/api/account/delete', async (c) => {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!serviceKey) {
    return c.json({
      error: 'account deletion needs SUPABASE_SERVICE_ROLE_KEY to be set on this instance',
    }, 501);
  }

  const { data: { user } } = await callerSupabase(c).auth.getUser();
  if (!user) return c.json({ error: 'unauthorized' }, 401);

  // The caller retypes their email. An accidental click here is unrecoverable,
  // so it is checked here and not only in the dialog.
  const body = await c.req.json().catch(() => ({} as any));
  const confirm = String(body?.confirm || '').trim().toLowerCase();
  if (!user.email || confirm !== user.email.toLowerCase()) {
    return c.json({ error: 'confirmation did not match the account email' }, 400);
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await admin.auth.admin.deleteUser(user.id);
  if (error) return c.json({ error: error.message }, 500);
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
    detail: 'This endpoint is part of the hosted veedeeoh deployment. A self-hosted instance has no billing, scheduled jobs or transactional email.',
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
