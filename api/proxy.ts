import { Hono, Context } from 'hono';
import { handle } from 'hono/vercel';
import { rewriteM3u8, isPlaylist } from '../backend/proxy';

const app = new Hono();

const BLOCKED_HOSTS = /^(localhost|127\.|169\.254\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.|0\.0\.0\.0|::1)/i;

app.get('/proxy', async (c: Context) => {
  const rawUrl = c.req.query('url');
  const obf = c.req.query('obf');
  if (!rawUrl) return c.text('bad url', 400);

  const url: string = obf === '1' ? Buffer.from(rawUrl, 'hex').toString('utf-8') : rawUrl;
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    return c.text('bad url', 400);
  }

  try {
    const parsedUrl = new URL(url);
    if (BLOCKED_HOSTS.test(parsedUrl.hostname)) {
      return c.text('Forbidden proxy target', 403);
    }

    const headers: Record<string, string> = {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      'Referer': 'https://pluto.tv/',
      'Origin': 'https://pluto.tv'
    };

    if (url.includes('pluto.tv') || url.includes('jmp2.uk/plu-')) {
      headers['X-Forwarded-For'] = '76.81.9.69';
    }

    const res = await fetch(url, { headers });

    if (!res.ok) {
      return c.text(`Proxy target returned HTTP ${res.status}`, res.status as any);
    }

    const contentType = res.headers.get('Content-Type') || '';
    if (isPlaylist(url, contentType)) {
      const text = await res.text();
      const rewritten = rewriteM3u8(text, res.url || url);

      return c.text(rewritten, 200, {
        'Content-Type': 'application/x-mpegURL',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS'
      });
    }

    const body = await res.arrayBuffer();
    return c.body(body, 200, {
      'Content-Type': contentType || 'application/octet-stream',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS'
    });
  } catch (e: any) {
    return c.text(e.message || 'proxy error', 500);
  }
});

export const GET = handle(app);
