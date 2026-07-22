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

export function showToast(message: string, durationMs = 4000): void {
  const existing = document.getElementById("appToast");
  if (existing) existing.remove();

  const toast = document.createElement("div");
  toast.id = "appToast";
  toast.style.cssText = `
    position: fixed; bottom: 30px; right: 30px; z-index: 100000;
    background: #10141e; border: 1px solid rgba(197,240,78,0.4);
    color: #fff; padding: 14px 22px; border-radius: 14px;
    font-family: 'Space Grotesk', sans-serif; font-size: 14px; font-weight: 700;
    box-shadow: 0 10px 30px rgba(0,0,0,0.8); display: flex; align-items: center; gap: 12px;
    transition: opacity 0.3s ease;
  `;
  toast.innerHTML = `<span>${escapeHtml(message)}</span>`;

  document.body.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = "0";
    setTimeout(() => toast.remove(), 300);
  }, durationMs);
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

export function setupHorizontalScroll(scroller: HTMLElement, parent: HTMLElement): void {
  if (parent.querySelector(".scrollArrow")) return;
  
  const leftBtn = document.createElement("button");
  leftBtn.className = "scrollArrow left";
  leftBtn.innerHTML = "❮";
  
  const rightBtn = document.createElement("button");
  rightBtn.className = "scrollArrow right";
  rightBtn.innerHTML = "❯";

  parent.append(leftBtn, rightBtn);

  const scrollAmount = () => scroller.clientWidth * 0.75;

  leftBtn.addEventListener("click", (e) => {
    e.preventDefault();
    scroller.scrollBy({ left: -scrollAmount(), behavior: "smooth" });
  });

  rightBtn.addEventListener("click", (e) => {
    e.preventDefault();
    scroller.scrollBy({ left: scrollAmount(), behavior: "smooth" });
  });

  const updateArrows = () => {
    const atStart = scroller.scrollLeft <= 10;
    const atEnd = scroller.scrollLeft >= scroller.scrollWidth - scroller.clientWidth - 10;
    leftBtn.style.opacity = atStart ? "0" : "1";
    leftBtn.style.pointerEvents = atStart ? "none" : "auto";
    rightBtn.style.opacity = atEnd ? "0" : "1";
    rightBtn.style.pointerEvents = atEnd ? "none" : "auto";
  };

  scroller.addEventListener("scroll", updateArrows);
  // initial state after DOM paint
  window.setTimeout(updateArrows, 150);
  window.addEventListener("resize", updateArrows);
}
