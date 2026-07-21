const URI_ATTR = /URI="([^"]+)"/g;

export function proxied(url: string): string {
  const encoded = Buffer.from(url, 'utf-8').toString('hex');
  return `/proxy?url=${encoded}&obf=1`;
}

export function isPlaylist(url: string, contentType: string | null): boolean {
  if (contentType && (contentType.includes("mpegurl") || contentType.includes("m3u"))) {
    return true;
  }
  return url.split("?")[0].toLowerCase().endsWith(".m3u8") || url.split("?")[0].toLowerCase().endsWith(".m3u");
}

export function rewriteM3u8(text: string, baseUrl: string): string {
  const isVod = text.includes("#EXT-X-PLAYLIST-TYPE:VOD") || text.includes("#EXT-X-ENDLIST");
  
  const out: string[] = [];
  const lines = text.split('\n');
  let i = 0;
  
  while (i < lines.length) {
    const line = lines[i];
    const stripped = line.trim();
    
    if (!stripped) {
      out.push(line);
      i++;
      continue;
    }
    
    if (isVod) {
      if (!stripped.startsWith("#")) {
        const adKeywords = ["dai.google.com", "doubleclick", "pubads", "/ads/", "/creative/", "boltdns", "unicornmedia"];
        if (adKeywords.some(kw => stripped.includes(kw))) {
          if (out.length > 0 && out[out.length - 1].trim().startsWith("#EXTINF")) {
            out.pop();
          }
          if (out.length > 0 && out[out.length - 1].trim().startsWith("#EXT-X-DISCONTINUITY")) {
            out.pop();
          }
          i++;
          continue;
        }
      } else if (
        stripped.startsWith("#EXT-X-CUE-OUT") ||
        stripped.startsWith("#EXT-X-CUE-IN") ||
        stripped.startsWith("#EXT-X-CUE-OUT-CONT") ||
        stripped.startsWith("#EXT-X-DATERANGE")
      ) {
        i++;
        continue;
      }
    }
    
    if (stripped.startsWith("#")) {
      let newLine = line;
      let match;
      // RegExp needs to be matched individually since it's global if we were replacing,
      // but replace string function works fine
      newLine = line.replace(/URI="([^"]+)"/g, (m, p1) => {
        return `URI="${proxied(new URL(p1, baseUrl).href)}"`;
      });
      out.push(newLine);
    } else {
      out.push(proxied(new URL(stripped, baseUrl).href));
    }
    i++;
  }
  
  return out.join('\n') + (out.length > 0 && out[out.length - 1] === '' ? '' : '\n');
}
