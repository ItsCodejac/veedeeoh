// Stream proxy — Cloudflare Worker.
//
// WHY THIS MOVED OFF VERCEL. Pluto's manifests and segments have no usable CORS
// headers, so the browser cannot fetch them directly and every byte has to be
// relayed. On Vercel that relay is Fast Origin Transfer, billed by the gigabyte:
// measured at 874 KB per segment, roughly 1.00 GB for a two-hour film, against
// a 10 GB free allowance. Ten films and the project pauses.
//
// MEASURED, and it turned out only the MANIFESTS need relaying at all:
//
//   master / variant  Access-Control-Allow-Origin: http://pluto.tv   -> blocked
//   media segments    Access-Control-Allow-Origin: <requesting origin> -> allowed
//
// So segments are rewritten to their direct CDN URLs and the player fetches
// them itself. Only a few manifests per stream pass through here, which is a
// few hundred KB against the ~1 GB a film used to cost. Cloudflare never bills
// data transfer anyway, so this is belt and braces -- but it also means the
// video path does not depend on our infrastructure staying up.
//
// Deploy: cd worker && npx wrangler deploy --config wrangler-proxy.toml

const BLOCKED_HOSTS =
  /^(localhost|127\.|169\.254\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.|0\.0\.0\.0|::1)/i;

// Media players send Range requests, which are not CORS-simple, so the browser
// preflights. Answering that bare is what broke playback on Vercel once before.
const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Expose-Headers": "Content-Length, Content-Range, Accept-Ranges, Content-Type",
  "Access-Control-Max-Age": "86400",
};

const hexToStr = (hex: string): string => {
  let out = "";
  for (let i = 0; i < hex.length; i += 2) out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
  return decodeURIComponent(escape(out));   // the bytes were UTF-8
};

const strToHex = (s: string): string => {
  const bytes = new TextEncoder().encode(s);
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
};

/** Rewrite a manifest so every nested playlist and segment comes back through
 *  here. Absolute, not relative: the player resolves these against the WORKER
 *  origin, and a relative /proxy would resolve against veedeeoh.com and send
 *  the bytes back through Vercel -- the exact cost this exists to remove. */
function proxied(url: string, base: string): string {
  return `${base}/proxy?url=${strToHex(url)}&obf=1`;
}

function isPlaylist(url: string, contentType: string | null): boolean {
  if (contentType && (contentType.includes("mpegurl") || contentType.includes("m3u"))) return true;
  const path = url.split("?")[0]!.toLowerCase();
  return path.endsWith(".m3u8") || path.endsWith(".m3u");
}

const AD_HINTS = ["dai.google.com", "doubleclick", "pubads", "/ads/", "/creative/", "boltdns", "unicornmedia"];

function rewriteM3u8(text: string, baseUrl: string, workerBase: string): string {
  const isVod = text.includes("#EXT-X-PLAYLIST-TYPE:VOD") || text.includes("#EXT-X-ENDLIST");
  const out: string[] = [];

  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t) { out.push(line); continue; }

    if (isVod) {
      // Ad segments and their cue markers are dropped, along with the EXTINF
      // that introduced them -- leaving it behind gives the player a duration
      // for a segment that is no longer there.
      if (!t.startsWith("#") && AD_HINTS.some((k) => t.includes(k))) {
        if (out.length && out[out.length - 1]!.trim().startsWith("#EXTINF")) out.pop();
        if (out.length && out[out.length - 1]!.trim().startsWith("#EXT-X-DISCONTINUITY")) out.pop();
        continue;
      }
      if (t.startsWith("#EXT-X-CUE-OUT") || t.startsWith("#EXT-X-CUE-IN") || t.startsWith("#EXT-X-DATERANGE")) {
        continue;
      }
    }

    if (t.startsWith("#")) {
      // Keys and init segments keep going through here: they are tiny, and
      // they come from the manifest host, which does not allow our origin.
      out.push(line.replace(/URI="([^"]+)"/g, (_m, p1) => `URI="${proxied(new URL(p1, baseUrl).href, workerBase)}"`));
    } else {
      const abs = new URL(t, baseUrl).href;
      // A nested PLAYLIST must be proxied -- the manifest host pins
      // Access-Control-Allow-Origin to http://pluto.tv, so the browser cannot
      // read it. A media SEGMENT must NOT be: siloh-ns1.plutotv.net reflects
      // the requesting origin, so the player fetches those straight from the
      // CDN. That is the whole point -- ~874 KB a segment and ~1,200 segments
      // in a film, none of which now touches our infrastructure.
      out.push(isPlaylist(abs, null) ? proxied(abs, workerBase) : abs);
    }
  }
  return out.join("\n") + (out.length && out[out.length - 1] === "" ? "" : "\n");
}

export default {
  async fetch(req: Request): Promise<Response> {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    if (req.method !== "GET" && req.method !== "HEAD") {
      return new Response("method not allowed", { status: 405, headers: CORS });
    }

    const reqUrl = new URL(req.url);
    const raw = reqUrl.searchParams.get("url");
    if (!raw) return new Response("bad url", { status: 400, headers: CORS });

    const target = reqUrl.searchParams.get("obf") === "1" ? hexToStr(raw) : raw;
    if (!target.startsWith("http://") && !target.startsWith("https://")) {
      return new Response("bad url", { status: 400, headers: CORS });
    }

    let parsed: URL;
    try { parsed = new URL(target); } catch { return new Response("bad url", { status: 400, headers: CORS }); }
    if (BLOCKED_HOSTS.test(parsed.hostname)) {
      return new Response("forbidden proxy target", { status: 403, headers: CORS });
    }

    const headers: Record<string, string> = {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
      Referer: "https://pluto.tv/",
      Origin: "https://pluto.tv",
    };
    if (target.includes("pluto.tv") || target.includes("jmp2.uk/plu-")) {
      headers["X-Forwarded-For"] = "76.81.9.69";
    }
    const range = req.headers.get("range");
    if (range) headers["Range"] = range;

    const res = await fetch(target, { headers });
    if (!res.ok) {
      return new Response(`upstream returned ${res.status}`, { status: res.status, headers: CORS });
    }

    const contentType = res.headers.get("Content-Type") || "";
    if (isPlaylist(target, contentType)) {
      const body = rewriteM3u8(await res.text(), res.url || target, reqUrl.origin);
      return new Response(body, {
        status: 200,
        headers: { ...CORS, "Content-Type": "application/x-mpegURL", "Cache-Control": "no-store" },
      });
    }

    // Segments stream STRAIGHT THROUGH. Reading them into memory first would
    // buy nothing, cap the object at its memory limit, and add latency to every
    // one of the ~1,200 in a film.
    const out: Record<string, string> = {
      ...CORS,
      "Content-Type": contentType || "application/octet-stream",
      // Segment URLs are signed and immutable for the life of the token, so the
      // edge can serve repeats without touching the origin at all.
      "Cache-Control": "public, max-age=3600",
    };
    const cr = res.headers.get("content-range");
    if (cr) out["Content-Range"] = cr;
    const ar = res.headers.get("accept-ranges");
    if (ar) out["Accept-Ranges"] = ar;

    return new Response(res.body, { status: res.status === 206 ? 206 : 200, headers: out });
  },
};
