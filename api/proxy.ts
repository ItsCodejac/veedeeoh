import { Hono, Context } from 'hono';
import { handle } from 'hono/vercel';
import { rewriteM3u8, isPlaylist } from '../backend/proxy';

const app = new Hono();

const BLOCKED_HOSTS = /^(localhost|127\.|169\.254\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.|0\.0\.0\.0|::1)/i;

// Media players send Range requests. `Range` is not a CORS-simple header, so the
// browser fires an OPTIONS preflight BEFORE the real request. This file used to
// export only GET, so that preflight got a 405 and the actual request was never
// sent — every proxied stream failed before a byte moved. Expose the range
// headers too, or the player cannot tell partial content is supported.
const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges, Content-Type',
  'Access-Control-Max-Age': '86400',
};

app.options('/proxy', (c: Context) => c.body(null, 204, CORS));

app.on(['GET', 'HEAD'], '/proxy', async (c: Context) => {
  const rawUrl = c.req.query('url');
  const obf = c.req.query('obf');
  if (!rawUrl) return c.text('bad url', 400, CORS);

  const url: string = obf === '1' ? Buffer.from(rawUrl, 'hex').toString('utf-8') : rawUrl;
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    return c.text('bad url', 400, CORS);
  }

  try {
    const parsedUrl = new URL(url);
    if (BLOCKED_HOSTS.test(parsedUrl.hostname)) {
      return c.text('Forbidden proxy target', 403, CORS);
    }

    const headers: Record<string, string> = {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      'Referer': 'https://pluto.tv/',
      'Origin': 'https://pluto.tv'
    };

    if (url.includes('pluto.tv') || url.includes('jmp2.uk/plu-')) {
      headers['X-Forwarded-For'] = '76.81.9.69';
    }

    // Forward the client's Range so seeking works and the player can fetch
    // partial segments instead of pulling whole files.
    const range = c.req.header('range');
    if (range) headers['Range'] = range;

    const res = await fetch(url, { headers });

    if (!res.ok) {
      return c.text(`Proxy target returned HTTP ${res.status}`, res.status as any, CORS);
    }

    const contentType = res.headers.get('Content-Type') || '';
    if (isPlaylist(url, contentType)) {
      const text = await res.text();
      const rewritten = rewriteM3u8(text, res.url || url);
      return c.text(rewritten, 200, { ...CORS, 'Content-Type': 'application/x-mpegURL' });
    }

    const out: Record<string, string> = { ...CORS, 'Content-Type': contentType || 'application/octet-stream' };
    // Preserve partial-content semantics; dropping these turns a 206 into a
    // truncated 200 and the player stalls or refuses to seek.
    const contentRange = res.headers.get('content-range');
    if (contentRange) out['Content-Range'] = contentRange;
    const acceptRanges = res.headers.get('accept-ranges');
    if (acceptRanges) out['Accept-Ranges'] = acceptRanges;

    const body = await res.arrayBuffer();
    return c.body(body, (res.status === 206 ? 206 : 200) as any, out);
  } catch (e: any) {
    return c.text(e.message || 'proxy error', 500, CORS);
  }
});

export const GET = handle(app);
export const HEAD = handle(app);
export const OPTIONS = handle(app);
