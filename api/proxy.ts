import { Hono } from 'hono';
import { handle } from 'hono/vercel';

const app = new Hono();

app.get('/proxy', async (c) => {
  const rawUrl = c.req.query('url');
  const obf = c.req.query('obf');
  if (!rawUrl) return c.text('bad url', 400);

  const url: string = obf === '1' ? Buffer.from(rawUrl, 'hex').toString('utf-8') : rawUrl;
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    return c.text('bad url', 400);
  }

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
      }
    });

    const body = await res.arrayBuffer();
    return c.body(body, res.status as any, {
      'Content-Type': res.headers.get('Content-Type') || 'application/octet-stream',
      'Access-Control-Allow-Origin': '*'
    });
  } catch (e: any) {
    return c.text(e.message || 'proxy error', 500);
  }
});

export const GET = handle(app);
