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

/** Full-page branded loader: shimmering wordmark + pulse dot + progress track. */
export function buildBrandLoader(): HTMLElement {
  const el = document.createElement("div");
  el.className = "brandLoader";
  el.innerHTML = `
    <div class="brandLoaderMark">
      <span class="brandLoaderWord">veedeeoh</span>
      <span class="brandLoaderDot"></span>
    </div>
    <div class="brandLoaderTrack"><div class="brandLoaderTrackFill"></div></div>
  `;
  return el;
}

/** Shimmering rail placeholder shown while a catalog fetch is in flight. */
export function buildRailSkeleton(cardCount = 5): HTMLElement {
  const el = document.createElement("div");
  el.className = "railSkeleton";

  const title = document.createElement("div");
  title.className = "railSkeletonTitle";
  title.innerHTML = `<div class="skeletonSweep"></div>`;
  el.append(title);

  const cards = document.createElement("div");
  cards.className = "railSkeletonCards";
  for (let i = 0; i < cardCount; i++) {
    const card = document.createElement("div");
    card.className = "skeletonCard";
    card.innerHTML = `<div class="skeletonSweep" style="animation-delay: ${(i * 0.12).toFixed(2)}s"></div>`;
    cards.append(card);
  }
  el.append(cards);

  const lines = document.createElement("div");
  lines.className = "railSkeletonLines";
  for (let i = 0; i < cardCount; i++) {
    const group = document.createElement("div");
    group.className = "skeletonLineGroup";
    group.innerHTML = `
      <div class="skeletonLine"><div class="skeletonSweep dim" style="animation-delay: ${(i * 0.12).toFixed(2)}s"></div></div>
      <div class="skeletonLineShort"></div>
    `;
    lines.append(group);
  }
  el.append(lines);

  return el;
}

/** Compact inline loader (three bouncing dots) for small surfaces. */
export function buildInlineLoader(): HTMLElement {
  const el = document.createElement("div");
  el.className = "inlineLoaderBounce";
  el.innerHTML = `<span></span><span></span><span></span>`;
  return el;
}

export function setupHorizontalScroll(scroller: HTMLElement, parent: HTMLElement): void {
  if (parent.querySelector(".scrollArrow")) return;
  
  const chevron = (dir: "left" | "right") =>
    `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="${dir === "left" ? "15 18 9 12 15 6" : "9 18 15 12 9 6"}"></polyline></svg>`;

  const leftBtn = document.createElement("button");
  leftBtn.className = "scrollArrow left";
  leftBtn.innerHTML = chevron("left");

  const rightBtn = document.createElement("button");
  rightBtn.className = "scrollArrow right";
  rightBtn.innerHTML = chevron("right");

  parent.append(leftBtn, rightBtn);

  // Center the arrows on the card row itself (not the rail header), so they never
  // float detached. Requires the rail to be position:relative (see CSS).
  const positionArrows = () => {
    const top = scroller.offsetTop + scroller.clientHeight / 2;
    leftBtn.style.top = `${top}px`;
    rightBtn.style.top = `${top}px`;
  };

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
    positionArrows();
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

/** Repair an SVG data URI that iOS Safari will not render.
 *
 *  DiceBear's toDataUri() emits `data:image/svg+xml;utf8,...`. `utf8` is not a
 *  valid media-type parameter -- the spelling is `charset=utf-8` -- and while
 *  Chrome and Firefox shrug and render it anyway, iOS Safari rejects the whole
 *  URI and draws nothing.
 *
 *  THIS IS WHY AVATARS WERE INCONSISTENT ON IPHONE RATHER THAN ABSENT. Each
 *  avatar is stored in whichever encoding came out smaller, base64 or
 *  percent-encoded. Base64 is unaffected. So the sparse styles -- Bottts,
 *  Shapes, Initials, Fun Emoji -- rendered, and the detailed ones -- Open
 *  Peeps, Notionists -- did not, which looks random unless you know that the
 *  encoding is chosen per picture.
 *
 *  Applied on DISPLAY, not only at generation, because every avatar already
 *  saved carries the bad prefix in avatar_url. Fixing the generator alone would
 *  leave existing profiles broken until somebody re-edited them.
 */
export function fixSvgDataUri(uri: string): string {
  return uri.startsWith("data:image/svg+xml;utf8,")
    ? `data:image/svg+xml;charset=utf-8,${uri.slice("data:image/svg+xml;utf8,".length)}`
    : uri;
}
