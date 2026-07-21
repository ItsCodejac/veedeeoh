import { Hono, Context } from 'hono';
import { handle } from 'hono/vercel';
import * as vod from '../backend/vod';
import * as store from '../backend/store';

const app = new Hono().basePath('/api');

const waitlistStore = new store.Waitlist();

const ALLOWED_EMAILS = new Set([
  'dannywsalama1@gmail.com',
  'itscojac@gmail.com',
  'fel250@live.com',
  'anthonyg.video@gmail.com',
  'davereed388@gmail.com'
]);

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

app.get('/catalog', (c: Context) => {
  return c.json({
    region: { code: 'US', source: 'default' },
    favorites: [],
    health: {}
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
  const region = c.req.query('region') || c.req.header('x-forwarded-for') || undefined;
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

export const GET = handle(app);
export const POST = handle(app);
