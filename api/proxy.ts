import { Hono, Context } from 'hono';
import { handle } from 'hono/vercel';

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

    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        'Referer': 'https://pluto.tv/',
        'Origin': 'https://pluto.tv'
      }
    });

    if (!res.ok) {
      return c.text(`Proxy target returned HTTP ${res.status}`, res.status as any);
    }

    const contentType = res.headers.get('Content-Type') || '';
    if (contentType.includes('mpegurl') || contentType.includes('m3u') || url.includes('.m3u8')) {
      let text = await res.text();
      const baseUrl = new URL(url);

      // 1. Rewrite URI="..." attributes in tags (#EXT-X-KEY, #EXT-X-MEDIA, #EXT-X-MAP)
      text = text.replace(/(URI=["'])([^"']+)(["'])/gi, (_match, p1, p2, p3) => {
        try {
          const abs = new URL(p2, baseUrl).toString();
          return `${p1}/proxy?url=${encodeURIComponent(abs)}${p3}`;
        } catch {
          return _match;
        }
      });
      
      // 2. Rewrite non-comment playlist lines (sub-playlists, .ts segments)
      const lines = text.split('\n');
      const rewrittenLines = lines.map((line) => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) return line;
        try {
          const abs = new URL(trimmed, baseUrl).toString();
          return `/proxy?url=${encodeURIComponent(abs)}`;
        } catch {
          return line;
        }
      });

      return c.text(rewrittenLines.join('\n'), 200, {
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
