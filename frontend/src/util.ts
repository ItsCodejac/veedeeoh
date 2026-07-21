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

export function setupHorizontalScroll(scroller: HTMLElement, parent: HTMLElement): void {
  // 1. Click and drag logic
  let isDown = false;
  let startX = 0;
  let scrollLeft = 0;
  let isDragging = false;

  scroller.addEventListener("mousedown", (e) => {
    isDown = true;
    isDragging = false;
    scroller.style.cursor = "grabbing";
    startX = e.pageX - scroller.offsetLeft;
    scrollLeft = scroller.scrollLeft;
  });

  const stopDrag = () => {
    isDown = false;
    scroller.style.cursor = "";
    // Snap back from rubber banding
    scroller.style.transition = "transform 0.3s cubic-bezier(0.25, 0.8, 0.25, 1)";
    scroller.style.transform = "translateX(0px)";
    setTimeout(() => {
      scroller.style.transition = "";
    }, 300);
  };

  scroller.addEventListener("mouseleave", stopDrag);
  scroller.addEventListener("mouseup", stopDrag);
  
  scroller.addEventListener("mousemove", (e) => {
    if (!isDown) return;
    e.preventDefault();
    isDragging = true;
    const x = e.pageX - scroller.offsetLeft;
    const walk = (x - startX) * 2;
    
    const maxScroll = scroller.scrollWidth - scroller.clientWidth;
    const nextScroll = scrollLeft - walk;

    if (nextScroll < 0) {
      // Rubber band on the left edge
      const overscroll = -nextScroll;
      const resistance = Math.min(overscroll * 0.3, 100); 
      scroller.style.transform = `translateX(${resistance}px)`;
      scroller.scrollLeft = 0;
    } else if (nextScroll > maxScroll) {
      // Rubber band on the right edge
      const overscroll = nextScroll - maxScroll;
      const resistance = Math.min(overscroll * 0.3, 100);
      scroller.style.transform = `translateX(-${resistance}px)`;
      scroller.scrollLeft = maxScroll;
    } else {
      scroller.style.transform = "translateX(0px)";
      scroller.scrollLeft = nextScroll;
    }
  });

  scroller.addEventListener("click", (e) => {
    if (isDragging) {
      e.preventDefault();
      e.stopPropagation();
      isDragging = false;
    }
  }, true);

  // Block native browser drag-and-drop of images/links
  scroller.addEventListener("dragstart", (e) => {
    e.preventDefault();
  });

  // 2. Netflix-style scroll arrows
  parent.style.position = "relative";
  
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
