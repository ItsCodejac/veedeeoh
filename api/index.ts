import { Hono, Context } from 'hono';
import { handle } from 'hono/vercel';
import * as vod from '../backend/vod';
import * as store from '../backend/store';
import * as billing from '../backend/billing';
import * as emailHelper from '../backend/email';
import * as authEmail from '../backend/auth-email';

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

  // Edge-cache the catalogue. It was `max-age=0, must-revalidate`, so every
  // page load in every browser pulled the whole 5 MB payload from the function
  // -- billed as origin transfer, and served by a cron that only rebuilds it
  // once a day. Ten minutes fresh with a day of stale-while-revalidate means
  // the origin is touched roughly once per region per ten minutes instead of
  // once per visitor, and nobody ever waits for a rebuild.
  c.header('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=86400');
  c.header('Vary', 'Accept-Encoding');

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

// Trial reminders. Runs daily; picks out the accounts whose trial ends in 2
// days, tomorrow, or ended yesterday.
//
// Idempotent through trial_email_sent, so a double cron run or a retry cannot
// mail the same person twice. Six real trials expired with no warning at all
// and none converted -- this is the fix for that, and mailing them twice would
// be a worse version of the same failure.
app.get('/cron/trial-emails', async (c: Context) => {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && c.req.header('authorization') !== `Bearer ${cronSecret}`) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const { createClient } = await import('@supabase/supabase-js');
  const sb = createClient(
    process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '',
    process.env.SUPABASE_SERVICE_ROLE_KEY || '',
    { auth: { persistSession: false, autoRefreshToken: false } }
  );

  const now = Date.now();
  const day = 86_400_000;
  const { data: rows, error } = await sb
    .from('profiles')
    .select('id, email, tier, tier_expires, trial_email_sent')
    .like('tier', 'trial%')
    .not('tier_expires', 'is', null)
    .gt('tier_expires', new Date(now - 2 * day).toISOString())
    .lt('tier_expires', new Date(now + 3 * day).toISOString());
  if (error) return c.json({ error: error.message }, 500);

  const sent: string[] = [];
  const failed: string[] = [];
  for (const r of rows ?? []) {
    if (!r.email) continue;
    const days = Math.ceil((new Date(r.tier_expires).getTime() - now) / day);
    // One stage per account. The column records WHICH mail went out, so an
    // account that already got the 2-day notice is not sent it again tomorrow.
    const stage = days <= 0 ? 'ended' : days <= 1 ? 'day1' : days <= 2 ? 'day2' : null;
    if (!stage || r.trial_email_sent === stage) continue;

    try {
      if (stage === 'ended') await emailHelper.sendTrialEndedEmail(r.email);
      else await emailHelper.sendTrialEndingEmail(r.email, days);
      await sb.from('profiles').update({ trial_email_sent: stage }).eq('id', r.id);
      sent.push(`${r.email}:${stage}`);
    } catch (e: any) {
      // NOT marked. The send helpers throw now, so a failure leaves
      // trial_email_sent alone and tomorrow's run retries -- previously a dead
      // API key would have burned through every trial marking them reminded
      // with nothing delivered and no second chance.
      console.error('[cron] trial email failed', r.email, e?.message);
      failed.push(`${r.email}:${e?.message || 'unknown'}`);
    }
  }
  // Failures are reported, not hidden: a cron that always returns ok is a cron
  // nobody notices has stopped working.
  return c.json({ ok: failed.length === 0, considered: rows?.length ?? 0, sent, failed });
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

// One-time Checkout for a watch party credit top-up. mode:payment, so it can
// never touch the subscription.
app.post('/billing/credits', async (c: Context) => {
  const user = await userFromRequest(c);
  if (!user) return c.json({ error: 'unauthorized' }, 401);
  try {
    const origin = new URL(c.req.url).origin;
    return c.json({ url: await billing.createCreditCheckout(user.id, user.email, origin) });
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
// ---------------------------------------------------------------- account ---

// Everything the account holds, as one JSON file. A user who can be deleted
// must be able to leave with their data first, and GDPR portability expects a
// machine-readable export rather than a screenshot.
//
// Uses the CALLER's client throughout, so RLS scopes every table to them --
// service-role here would let a crafted request export someone else's history.
app.get('/account/export', async (c: Context) => {
  const user = await userFromRequest(c);
  if (!user) return c.json({ error: 'unauthorized' }, 401);
  const sb = await callerSupabase(c);

  // EVERY TABLE THAT HOLDS SOMETHING OF THEIRS, not the six somebody thought of
  // first. The old list covered profiles, watch progress, favourites,
  // collections, referrals and parties, and left out eighteen others: the credit
  // ledger, what they earned, which parties they joined, the problems they
  // reported, who they follow, who they blocked, their invitations, and more.
  // An export that quietly omits most of the record is not a copy of what we
  // hold, which is the only thing it is for.
  //
  // Row-level security still decides what comes back, so this cannot become a
  // way to read somebody else's data by naming their table. A table the caller
  // has no policy for is reported by name under not_included rather than
  // silently dropped, because "we hold this and you cannot see it here" is a
  // fact they are entitled to.
  const TABLES = [
    'household_profiles', 'household_members', 'household_invites',
    'watch_progress', 'favorites', 'collections', 'collection_items',
    'profile_exclusions',
    'parties', 'party_joins', 'party_credit_ledger', 'party_blocks',
    'party_reminders', 'party_block_appeals',
    'referrals', 'referral_codes', 'referral_earnings', 'free_month_grants',
    'host_follows', 'host_suggestions', 'public_picks',
    'feedback', 'profile_reports', 'beta_invites',
  ];

  const data: Record<string, unknown> = {};
  const notIncluded: Array<{ table: string; reason: string }> = [];
  await Promise.all(TABLES.map(async (table) => {
    const { data: rows, error } = await sb.from(table).select('*');
    if (error) notIncluded.push({ table, reason: error.message });
    else data[table] = rows ?? [];
  }));

  // The account row itself, which is the one thing not reachable by listing a
  // table the caller owns rows in.
  const { data: profile } = await sb.from('profiles').select('*').eq('id', user.id).maybeSingle();

  return c.json({
    exported_at: new Date().toISOString(),
    account: { id: user.id, email: user.email },
    profile: profile ?? null,
    data,
    not_included: notIncluded,
  });
});

// Delete the account and everything hanging off it.
//
// Order matters and is not interchangeable:
//   1. cancel Stripe   -- the customer is an independent object, so deleting
//                         the row first leaves a subscription renewing forever
//                         against a user who no longer exists
//   2. delete the auth user -- every table FKs auth.users ON DELETE CASCADE, so
//                         this removes profiles, history, parties and referrals
//                         in one transaction rather than a best-effort sweep
//
// Requires the caller to re-state their email, because an accidental click here
// is unrecoverable. Verified server-side, not just in the dialog.
app.post('/account/delete', async (c: Context) => {
  const user = await userFromRequest(c);
  if (!user) return c.json({ error: 'unauthorized' }, 401);

  const body = await c.req.json().catch(() => ({} as any));
  const confirm = String(body?.confirm || '').trim().toLowerCase();
  if (!user.email || confirm !== user.email.toLowerCase()) {
    return c.json({ error: 'confirmation did not match the account email' }, 400);
  }

  // Uses the module-level import. A dynamic import('../backend/billing') here
  // resolved fine locally and threw ERR_MODULE_NOT_FOUND on Vercel, because the
  // extensionless specifier is not traced into the serverless bundle -- so the
  // delete endpoint 500'd in production while passing every local check.
  const cancel = await billing.cancelForDeletion(user.id);

  const { createClient } = await import('@supabase/supabase-js');
  const admin = createClient(
    process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '',
    process.env.SUPABASE_SERVICE_ROLE_KEY || '',
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
  const { error } = await admin.auth.admin.deleteUser(user.id);
  if (error) return c.json({ error: error.message }, 500);

  // Belt and braces since 20260826040000, which gave profiles, household_
  // profiles, household_members and household_invites the foreign key to
  // auth.users they never had, so the delete above now cascades all of it.
  //
  // Before that migration this line was the only thing removing the account
  // row, and it was not enough: the viewing profiles, watch history, favourites
  // and pending invites had nothing pointing at auth.users and survived the
  // deletion outright. Kept because it is free, and because it still holds if
  // someone runs this against a database that has not taken that migration.
  const { error: profErr } = await admin.from('profiles').delete().eq('id', user.id);
  if (profErr) console.error('[account] profile row not removed after delete', profErr);

  // Reported rather than swallowed: if Stripe refused, the user needs to know
  // to check, because their account is now gone and they cannot look it up.
  return c.json({
    ok: true,
    subscriptionCanceled: cancel.canceled,
    billingError: cancel.error ?? null,
    profileRemoved: !profErr,
  });
});

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

// Supabase Send Email Hook.
//
// Supabase posts the authentication email here instead of sending it over
// SMTP, which never once reached Resend. Everything else this product emails
// already goes out over Resend's HTTP API without trouble, so this hands the
// message to the path that works. With the hook enabled, email confirmation
// can be switched back on.
app.post('/auth/email-hook', async (c: Context) => {
  const secret = process.env.SEND_EMAIL_HOOK_SECRET || '';
  if (!secret) {
    console.error('[auth-email] SEND_EMAIL_HOOK_SECRET is not set');
    return c.json({ error: 'hook not configured' }, 500);
  }

  // RAW body: the signature covers the exact bytes Supabase sent, and
  // re-serialising parsed JSON changes them.
  const raw = await c.req.text();
  const check = authEmail.verifyHook(raw, {
    id: c.req.header('webhook-id'),
    timestamp: c.req.header('webhook-timestamp'),
    signature: c.req.header('webhook-signature'),
  }, secret);
  if (!check.ok) {
    console.warn('[auth-email] rejected:', check.reason);
    return c.json({ error: 'invalid signature' }, 401);
  }

  try {
    await authEmail.sendAuthEmail(JSON.parse(raw));
    // AN EMPTY JSON OBJECT, not an empty body. The documentation says "an
    // empty response with a status code of 200", and a bare 200 with no
    // Content-Type is what that reads like -- but Supabase rejects it with
    // hook_payload_invalid_content_type and fails the whole auth request,
    // AFTER the mail has already gone out. The user sees an error for an email
    // that was in fact sent. Found by triggering a real password reset;
    // nothing short of that would have shown it, because the signature check,
    // the send and the status code were all already correct.
    return c.json({}, 200);
  } catch (e: any) {
    console.error('[auth-email] send failed:', e?.message);
    return c.json({ error: e?.message || 'send failed' }, 500);
  }
});

export const GET = handle(app);
export const POST = handle(app);
export const DELETE = handle(app);
