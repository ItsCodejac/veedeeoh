import { Hono, Context } from 'hono';
import { handle } from 'hono/vercel';

const app = new Hono();

app.get('/proxy', async (c: Context) => {
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
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        'Referer': 'https://pluto.tv/',
        'Origin': 'https://pluto.tv',
        'X-Forwarded-For': '76.81.9.69'
      }
    });

    if (!res.ok) {
      return c.text(`Proxy target returned HTTP ${res.status}`, res.status as any);
    }

    const contentType = res.headers.get('Content-Type') || '';
    if (contentType.includes('mpegurl') || contentType.includes('m3u') || url.includes('.m3u8')) {
      let text = await res.text();
      const baseUrl = new URL(url);
      
      // Rewrite relative URLs inside m3u8 playlist to absolute /proxy?url=
      text = text.replace(/^(?!\s*#)(?!\s*$)(.+)$/gm, (line) => {
        const trimmed = line.trim();
        if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
          return `/proxy?url=${encodeURIComponent(trimmed)}`;
        }
        try {
          const absolute = new URL(trimmed, baseUrl).toString();
          return `/proxy?url=${encodeURIComponent(absolute)}`;
        } catch {
          return trimmed;
        }
      });

      return c.text(text, 200, {
        'Content-Type': 'application/x-mpegURL',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': '*'
      });
    }

    const body = await res.arrayBuffer();
    return c.body(body, 200, {
      'Content-Type': contentType || 'application/octet-stream',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': '*'
    });
  } catch (e: any) {
    return c.text(e.message || 'proxy error', 500);
  }
});

export const GET = handle(app);
