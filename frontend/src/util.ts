export function $<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing element #${id}`);
  return el as T;
}

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
};

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c] ?? c);
}

// Detect the Pluto "not available in your region" loop by sampling the frame:
// an overwhelmingly black screen with Pluto-yellow accents and little else.
// Calibrated so genuinely dark content (no yellow) is never flagged.
const bumperCanvas = document.createElement("canvas");
bumperCanvas.width = bumperCanvas.height = 32;

export function isGeoBlockBumper(video: HTMLVideoElement): boolean {
  const ctx = bumperCanvas.getContext("2d", { willReadFrequently: true });
  if (!ctx || !video.videoWidth) return false;
  try {
    ctx.drawImage(video, 0, 0, 32, 32);
    const px = ctx.getImageData(0, 0, 32, 32).data;
    let black = 0;
    let yellow = 0;
    const n = px.length / 4;
    for (let i = 0; i < px.length; i += 4) {
      const r = px[i]!, g = px[i + 1]!, b = px[i + 2]!;
      if (Math.max(r, g, b) < 45) black++;
      else if (r > 185 && g > 165 && b < 120) yellow++;
    }
    return black / n > 0.7 && yellow / n > 0.003;
  } catch {
    return false; // tainted canvas — the proxy should prevent this, but be safe
  }
}

export function fmtTime(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}
