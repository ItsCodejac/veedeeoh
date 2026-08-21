import { Hono, Context } from 'hono';
import { handle } from 'hono/vercel';
import * as vod from '../backend/vod';
import * as store from '../backend/store';
import * as billing from '../backend/billing';
import * as emailHelper from '../backend/email';

const app = new Hono().basePath('/api');

const waitlistStore = new store.Waitlist();

const ALLOWED_EMAILS = new Set([
  'dannywsalama1@gmail.com',
  'itscojac@gmail.com',
  'fel250@live.com',
  'anthonyg.video@gmail.com',
  'davereed388@gmail.com'
]);

// A Supabase client scoped to the CALLER's JWT (anon key + their bearer token),
// so RLS enforces per-profile ownership. MUST be used for any endpoint touching
// user data with a client-supplied id — never the service-role key there, which
// bypasses RLS and lets any caller read/write another profile's rows (IDOR).
async function callerSupabase(c: Context) {
  const { createClient } = await import('@supabase/supabase-js');
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '';
  const anon = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';
  const authHeader = c.req.header('authorization') || '';
  return createClient(url, anon, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

app.get('/health', (c: Context) => c.json({ status: 'ok', environment: 'vercel' }));

app.post('/auth/authorize', async (c: Context) => {
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

app.get('/catalog', async (c: Context) => {
  const profileId = c.req.query('profileId');
  const userRegion = c.req.query('region') || c.req.header('x-vercel-ip-country') || 'US';
  let favorites: string[] = [];

  // Caller-scoped: RLS returns favorites only for a profile the caller owns.
  if (profileId) {
    try {
      const supabase = await callerSupabase(c);
      const { data } = await supabase
        .from('favorites')
        .select('content_id')
        .eq('profile_id', profileId);
      if (data) {
        favorites = data.map((f: any) => f.content_id);
      }
    } catch {
      // fallback to empty array
    }
  }

  return c.json({
    region: { code: userRegion.toUpperCase(), source: 'detected' },
    favorites,
    health: { ok: true }
  });
});

app.post('/waitlist', async (c: Context) => {
  try {
    const body = await c.req.json();
    const email = body?.email;
    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return c.json({ error: 'Please enter a valid email address.' }, 400);
    }
    const entry = waitlistStore.add(email);
    
    // Asynchronously send waitlist confirmation email via Resend
    emailHelper.sendWaitlistConfirmationEmail(email).catch(err => {
      console.warn('[Waitlist] Background email sending failed:', err);
    });

    return c.json({ ok: true, message: "You're on the waitlist! We'll email you as cloud spots open.", entry });
  } catch (err: any) {
    return c.json({ error: 'Failed to record waitlist submission.' }, 500);
  }
});

app.get('/waitlist', (c: Context) => {
  return c.json({ count: waitlistStore.entries.length, waitlist: waitlistStore.entries });
});

app.get('/stats', async (c: Context) => {
  try {
    const catalogData = await vod.getCatalog('US');
    const archiveCount = 30;
    return c.json({
      totalTitles: catalogData.stats.totalTitles + archiveCount,
      moviesCount: catalogData.stats.moviesCount + archiveCount,
      showsCount: catalogData.stats.showsCount,
      updatedAt: Date.now()
    });
  } catch {
    return c.json({ totalTitles: 3400, moviesCount: 2150, showsCount: 1250, updatedAt: Date.now() });
  }
});

app.get('/vod', async (c: Context) => {
  const region = (c.req.query('region') || 'US').toUpperCase();

  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

  if (supabaseUrl && supabaseKey) {
    try {
      const { createClient } = await import('@supabase/supabase-js');
      const supabase = createClient(supabaseUrl, supabaseKey);
      const { data } = await supabase
        .from('catalog_cache')
        .select('payload')
        .eq('region', region)
        .maybeSingle();

      if (data?.payload) {
        return c.json(data.payload);
      }
    } catch (e) {
      console.warn('Supabase catalog_cache fetch error, falling back to live:', e);
    }
  }

  const rails: any[] = [];
  let stats: any = { totalTitles: 0, moviesCount: 0, showsCount: 0 };
  try {
    const catalogData = await vod.getCatalog(region);
    rails.push(...catalogData.rails);
    stats = catalogData.stats;
  } catch (e) {
    console.error("VOD error:", e);
  }
  try {
    const archive = await vod.archiveMovies(30);
    rails.push({ name: "🏛️ Archive Classics", items: archive });
    stats.totalTitles += archive.length;
    stats.moviesCount += archive.length;
  } catch (e) {
    console.error("Archive VOD error:", e);
  }
  return c.json({ rails, stats });
});

app.get('/vod/archive/:id', async (c: Context) => {
  try {
    const id = c.req.param('id');
    if (!id) return c.json({ error: 'Missing Archive ID' }, 400);
    const streamUrl = await vod.archiveStream(id);
    return c.json({ url: streamUrl });
  } catch (e: any) {
    return c.json({ error: e?.message || 'Failed to load archive stream' }, 500);
  }
});

// Pluto movies are cached WITHOUT a signed URL (see backend/vod.ts normalize) —
// the signature is minted here, per click, so it is never stale.
app.get('/vod/pluto', async (c: Context) => {
  try {
    const path = c.req.query('path');
    if (!path) return c.json({ error: 'Missing Pluto path' }, 400);
    if (!path.startsWith('/stitch/')) return c.json({ error: 'Invalid Pluto path' }, 400);
    const region = c.req.query('region') || undefined;
    const url = await vod.plutoStream(path, region);
    return c.json({ url });
  } catch (e: any) {
    return c.json({ error: e?.message || 'Failed to load Pluto stream' }, 502);
  }
});

app.get('/vod/tubi/:id', async (c: Context) => {
  try {
    const id = c.req.param('id');
    if (!id) return c.json({ error: 'Missing Tubi ID' }, 400);
    const url = await vod.tubiStream(id);
    return c.json({ url });
  } catch (e: any) {
    return c.json({ error: e?.message || 'Failed to load Tubi stream' }, 502);
  }
});

app.get('/vod/series/:id', async (c: Context) => {
  try {
    const region = c.req.query('region') || c.req.header('x-forwarded-for') || undefined;
    const seriesId = c.req.param('id') || '';
    const episodes = await vod.getSeries(seriesId, region);
    return c.json({ episodes });
  } catch (e: any) {
    return c.json({ error: e.message }, 502);
  }
});

app.get('/watched', async (c: Context) => {
  const profileId = c.req.query('profileId');
  if (!profileId) return c.json({ watched: [] });
  try {
    const supabase = await callerSupabase(c); // RLS scopes to the caller's profiles
    const { data } = await supabase
      .from('watch_progress')
      .select('content_id, position_secs, duration_secs, completed, updated_at')
      .eq('profile_id', profileId);
    return c.json({ watched: data || [] });
  } catch (err: any) {
    return c.json({ watched: [], error: err?.message });
  }
});

app.post('/watched', async (c: Context) => {
  try {
    const body = await c.req.json();
    const { profileId, contentId, positionSecs, durationSecs, completed } = body;
    if (!profileId || !contentId) {
      return c.json({ error: 'Missing profileId or contentId' }, 400);
    }
    // Only include provided fields so toggling "completed" doesn't reset the
    // saved resume position (omitted columns keep their existing value on upsert).
    const payload: any = { profile_id: profileId, content_id: contentId, updated_at: new Date().toISOString() };
    if (positionSecs !== undefined) payload.position_secs = positionSecs;
    if (durationSecs !== undefined) payload.duration_secs = durationSecs;
    if (completed !== undefined) payload.completed = !!completed;

    const supabase = await callerSupabase(c); // RLS with_check enforces ownership
    const { error } = await supabase
      .from('watch_progress')
      .upsert(payload, { onConflict: 'profile_id,content_id' });
    if (error) throw error;
    return c.json({ ok: true });
  } catch (e: any) {
    return c.json({ error: e?.message || 'Failed to update watch progress' }, 500);
  }
});

app.delete('/watched/:id?', async (c: Context) => {
  try {
    const profileId = c.req.query('profileId');
    const contentId = c.req.param('id') || c.req.query('contentId');
    if (!profileId || !contentId) return c.json({ error: 'Missing profileId or contentId' }, 400);

    const supabase = await callerSupabase(c); // RLS scopes deletes to the caller
    await supabase.from('watch_progress').delete()
      .eq('profile_id', profileId)
      .eq('content_id', contentId);
    return c.json({ ok: true });
  } catch (e: any) {
    return c.json({ error: e?.message || 'Failed to delete watch history' }, 500);
  }
});

app.get('/cron/catalog-warm', async (c: Context) => {
  const authHeader = c.req.header('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  try {
    const catalogData = await vod.getCatalog('US');
    const archive = await vod.archiveMovies(30);
    const rails = [...catalogData.rails, { name: '🏛️ Archive Classics', items: archive }];
    const stats = {
      ...catalogData.stats,
      totalTitles: catalogData.stats.totalTitles + archive.length,
      moviesCount: catalogData.stats.moviesCount + archive.length
    };
    const payload = { rails, stats, updatedAt: Date.now() };

    const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return c.json({ error: 'Catalog built but NOT persisted: Supabase env vars missing' }, 500);
    }

    const { createClient } = await import('@supabase/supabase-js');
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Persisting IS the job of this endpoint: /api/vod serves the cached payload,
    // so a failed write means the catalog silently goes stale while the cron keeps
    // reporting success. That exact failure went unnoticed for 10 days. Never
    // return ok without checking the write.
    // NOTE: the anon key cannot write here (RLS 42501) — SUPABASE_SERVICE_ROLE_KEY
    // must be set in the deployment environment.
    const { error: writeError } = await supabase.from('catalog_cache').upsert(
      { region: 'US', payload, updated_at: new Date().toISOString() },
      { onConflict: 'region' }
    );

    if (writeError) {
      console.error('[cron] catalog_cache write FAILED:', writeError);
      return c.json({
        error: `Catalog built but NOT persisted: ${writeError.message}`,
        code: writeError.code,
        hint: writeError.code === '42501'
          ? 'RLS rejected the write — SUPABASE_SERVICE_ROLE_KEY is probably missing in this environment.'
          : undefined,
      }, 500);
    }

    return c.json({ ok: true, persisted: true, stats });
  } catch (e: any) {
    return c.json({ error: e?.message || 'Catalog warm failed' }, 500);
  }
});

// --- Stripe billing -------------------------------------------------------

async function userFromRequest(c: Context): Promise<{ id: string; email: string } | null> {
  const auth = c.req.header('authorization');
  if (!auth || !auth.startsWith('Bearer ')) return null;
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '';
  const key = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';
  try {
    const { createClient } = await import('@supabase/supabase-js');
    const sb = createClient(url, key);
    const { data } = await sb.auth.getUser(auth.slice(7));
    if (!data.user?.email) return null;
    return { id: data.user.id, email: data.user.email };
  } catch {
    return null;
  }
}

// Start a $4/mo subscription Checkout (7-day trial). Returns the hosted URL.
app.post('/billing/checkout', async (c: Context) => {
  const user = await userFromRequest(c);
  if (!user) return c.json({ error: 'unauthorized' }, 401);
  try {
    const origin = new URL(c.req.url).origin;
    return c.json({ url: await billing.createCheckoutSession(user.id, user.email, origin) });
  } catch (e: any) {
    return c.json({ error: e?.message || 'checkout failed' }, 500);
  }
});

// Self-service manage/cancel via the Stripe Customer Portal.
app.post('/billing/portal', async (c: Context) => {
  const user = await userFromRequest(c);
  if (!user) return c.json({ error: 'unauthorized' }, 401);
  try {
    const origin = new URL(c.req.url).origin;
    return c.json({ url: await billing.createPortalSession(user.id, origin) });
  } catch (e: any) {
    return c.json({ error: e?.message || 'portal failed' }, 500);
  }
});

// Change seat count (extra seats at $2/mo each). Body: { seats: number }.
app.post('/billing/seats', async (c: Context) => {
  const user = await userFromRequest(c);
  if (!user) return c.json({ error: 'unauthorized' }, 401);
  try {
    const body = await c.req.json().catch(() => ({}));
    const seats = await billing.setSeats(user.id, Number(body?.seats) || 3);
    return c.json({ ok: true, seats });
  } catch (e: any) {
    return c.json({ error: e?.message || 'seat update failed' }, 500);
  }
});

// Stripe webhook — signature-verified, raw body. Sets tier/expiry on payment.
app.post('/billing/webhook', async (c: Context) => {
  const sig = c.req.header('stripe-signature') || '';
  const raw = await c.req.text();
  try {
    await billing.handleWebhook(raw, sig);
    return c.json({ received: true });
  } catch (e: any) {
    return c.json({ error: `webhook error: ${e?.message}` }, 400);
  }
});

export const GET = handle(app);
export const POST = handle(app);
export const DELETE = handle(app);
