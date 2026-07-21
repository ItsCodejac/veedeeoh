import { Hono } from 'hono';
import { handle } from 'hono/vercel';
import * as vod from '../backend/vod';
import * as store from '../backend/store';
import { createClient } from '@supabase/supabase-js';

const app = new Hono().basePath('/api');

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://placeholder.supabase.co';
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || 'placeholder_key';
const supabase = createClient(supabaseUrl, supabaseAnonKey);

const waitlistStore = new store.Waitlist();

app.get('/health', (c) => c.json({ status: 'ok', environment: 'vercel' }));

app.post('/waitlist', async (c) => {
  try {
    const body = await c.req.json();
    const email = body?.email;
    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return c.json({ error: 'Please enter a valid email address.' }, 400);
    }
    const entry = waitlistStore.add(email);

    if (supabaseUrl && !supabaseUrl.includes('placeholder')) {
      supabase.from('waitlist').insert({ email: entry.email, created_at: entry.created_at }).then(() => {}).catch(() => {});
    }

    return c.json({ ok: true, message: "You're on the waitlist! We'll email you as cloud spots open.", entry });
  } catch (err: any) {
    return c.json({ error: 'Failed to record waitlist submission.' }, 500);
  }
});

app.get('/waitlist', (c) => {
  return c.json({ count: waitlistStore.entries.length, waitlist: waitlistStore.entries });
});

app.get('/vod', async (c) => {
  const rails: any[] = [];
  try {
    const plutoRails = await vod.getCatalog('US');
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
  return c.json({ rails });
});

app.get('/vod/series/:id', async (c) => {
  try {
    const episodes = await vod.getSeries(c.req.param('id'), 'US');
    return c.json({ episodes });
  } catch (e: any) {
    return c.json({ error: e.message }, 502);
  }
});

export const GET = handle(app);
export const POST = handle(app);
