// Reactions during a watch party.
//
// Chosen over chat because a fixed set of six cannot say anything targeted --
// that is a property of the design rather than a moderation policy someone has
// to enforce. Nothing is stored: a reaction is a moment, so there is no record
// to leak, nothing to moderate after the fact, and no reason for a late joiner
// to see how people felt about a scene they missed.
//
// THE BAR IS FURNITURE, NOT CHROME. It sits over someone's film, so it obeys
// the same two rules the player controls do: it fades when the viewer stops
// moving, and it goes where they put it. Most screens letterbox a film, so
// "somewhere that is not over the picture" usually exists -- but only the
// person watching knows where that is, so the position is theirs to set and
// is remembered.

import { REACTIONS, sendReaction } from "./party";

const HIDE_KEY = "veedeeoh_party_reactions_off";
const POS_KEY  = "veedeeoh_party_reactions_pos";
const ORIENT_KEY = "veedeeoh_party_reactions_vertical";

// Long enough not to fight someone reaching for a button, short enough that it
// is gone by the time they have settled back into the film.
const IDLE_MS = 2600;

let bar: HTMLElement | null = null;
let stage: HTMLElement | null = null;
let onReact: ((e: Event) => void) | null = null;
let onFullscreen: (() => void) | null = null;
let idleTimer: number | null = null;
let onMove: (() => void) | null = null;
let onResize: (() => void) | null = null;
let dragging = false;

const EYE_OFF = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
  <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
  <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
  <line x1="1" y1="1" x2="23" y2="23"/></svg>`;

const EYE_ON = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;

const GRIP = `<button class="reactGrip" type="button"
  title="Drag to move, click to stack vertically" aria-label="Move or stack the reaction bar">
  <svg width="10" height="16" viewBox="0 0 10 16" fill="currentColor">
    <circle cx="2.5" cy="3" r="1.4"/><circle cx="7.5" cy="3" r="1.4"/>
    <circle cx="2.5" cy="8" r="1.4"/><circle cx="7.5" cy="8" r="1.4"/>
    <circle cx="2.5" cy="13" r="1.4"/><circle cx="7.5" cy="13" r="1.4"/>
  </svg></button>`;

/** Where the bar has to live right now.
 *
 *  FULLSCREEN RENDERS ONLY THE FULLSCREEN ELEMENT'S SUBTREE. Anything parented
 *  to document.body is simply not painted, which is why reactions worked in the
 *  mini player and vanished the moment anyone went fullscreen -- that is, during
 *  the part of a watch party people actually watch. Nothing was broken about the
 *  bar; it was in the wrong branch of the tree. */
function host(): HTMLElement {
  return (document.fullscreenElement as HTMLElement | null)
    || ((document as any).webkitFullscreenElement as HTMLElement | null)
    || document.body;
}

/** Re-parent on every fullscreen change, in both directions. */
function follow(): void {
  const h = host();
  if (bar && bar.parentElement !== h) h.appendChild(bar);
  if (stage && stage.parentElement !== h) h.appendChild(stage);
}

function watchFullscreen(): void {
  if (onFullscreen) return;
  onFullscreen = () => follow();
  document.addEventListener("fullscreenchange", onFullscreen);
  document.addEventListener("webkitfullscreenchange", onFullscreen);
}

export function mountReactions(): void {
  unmountReactions();
  if (localStorage.getItem(HIDE_KEY) === "1") { mountToggleOnly(); return; }

  stage = document.createElement("div");
  stage.id = "reactStage";
  host().appendChild(stage);

  bar = document.createElement("div");
  bar.id = "reactBar";
  bar.innerHTML = `
    ${GRIP}
    ${REACTIONS.map((r) => `
      <button class="reactBtn" data-kind="${r.kind}" title="${r.label}" aria-label="${r.label}">${r.glyph}</button>
    `).join("")}
    <button class="reactBtn reactOff" id="reactHide"
            title="Hide the bar and everyone else's reactions"
            aria-label="Hide the bar and everyone else's reactions">${EYE_OFF}</button>`;
  host().appendChild(bar);

  bar.querySelectorAll<HTMLElement>("[data-kind]").forEach((b) => {
    b.addEventListener("click", () => {
      sendReaction(b.dataset.kind!);
      // Shown locally straight away rather than waiting for the round trip.
      // The worker does not echo to the sender, and a button that appears to
      // do nothing for 100ms gets pressed again.
      float(b.textContent || "", "You");
    });
  });
  bar.querySelector("#reactHide")!.addEventListener("click", () => {
    localStorage.setItem(HIDE_KEY, "1");
    unmountReactions();
    mountToggleOnly();
  });

  onReact = (e: Event) => {
    const d = (e as CustomEvent).detail || {};
    const r = REACTIONS.find((x) => x.kind === d.kind);
    if (r) float(r.glyph, d.name);
  };
  window.addEventListener("veedeeoh:party-react", onReact);

  finishMount();
}

/** When reactions are hidden, leave a way back. A preference with no visible
 *  control is a preference nobody can undo. It keeps its grip so it can still
 *  be pushed off the picture without being turned back on first. */
function mountToggleOnly(): void {
  bar = document.createElement("div");
  bar.id = "reactBar";
  bar.className = "collapsed";
  bar.innerHTML = `${GRIP}
    <button class="reactBtn" id="reactShow"
            title="Show reactions" aria-label="Show reactions">${EYE_ON}</button>`;
  host().appendChild(bar);
  bar.querySelector("#reactShow")!.addEventListener("click", () => {
    localStorage.removeItem(HIDE_KEY);
    unmountReactions();
    mountReactions();
  });

  finishMount();
}

/** Position, drag and idle-fade -- identical for both states of the bar. */
function finishMount(): void {
  const el = bar!;
  watchFullscreen();
  if (localStorage.getItem(ORIENT_KEY) === "1") el.classList.add("vert");
  restorePosition(el);
  makeDraggable(el, el.querySelector<HTMLElement>(".reactGrip")!);

  onMove = () => wake();
  window.addEventListener("pointermove", onMove, { passive: true });
  window.addEventListener("touchstart", onMove, { passive: true });
  window.addEventListener("keydown", onMove);
  el.addEventListener("pointerenter", () => wake());

  onResize = () => restorePosition(el);
  window.addEventListener("resize", onResize);

  wake();
}

/** Full opacity now, faded again once the viewer settles. Hovering the bar or
 *  dragging it holds it open -- fading something out from under the cursor is
 *  the one case where this reads as a bug rather than as tidiness. */
function wake(): void {
  if (!bar) return;
  bar.classList.remove("idle");
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = window.setTimeout(() => {
    if (!bar || dragging || bar.matches(":hover")) return;
    bar.classList.add("idle");
  }, IDLE_MS);
}

export function unmountReactions(): void {
  if (onReact) window.removeEventListener("veedeeoh:party-react", onReact);
  onReact = null;
  if (onMove) {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("touchstart", onMove);
    window.removeEventListener("keydown", onMove);
  }
  onMove = null;
  if (onResize) window.removeEventListener("resize", onResize);
  onResize = null;
  if (onFullscreen) {
    document.removeEventListener("fullscreenchange", onFullscreen);
    document.removeEventListener("webkitfullscreenchange", onFullscreen);
  }
  onFullscreen = null;
  if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
  dragging = false;
  bar?.remove(); bar = null;
  stage?.remove(); stage = null;
}

// ---------------------------------------------------------------------------
// Placement
// ---------------------------------------------------------------------------

/** Stored as a fraction of the viewport rather than pixels: someone who parks
 *  the bar in the letterbox band under a film should still find it there after
 *  resizing the window, and a saved pixel offset from a large monitor would
 *  otherwise put it off-screen on a laptop. Clamped on every read regardless. */
function restorePosition(el: HTMLElement): void {
  let raw: { fx: number; fy: number } | null = null;
  try { raw = JSON.parse(localStorage.getItem(POS_KEY) || "null"); } catch { raw = null; }
  if (!raw || typeof raw.fx !== "number" || typeof raw.fy !== "number") return;

  el.classList.add("placed");
  const r = el.getBoundingClientRect();
  const x = clamp(raw.fx * window.innerWidth,  8, Math.max(8, window.innerWidth  - r.width  - 8));
  const y = clamp(raw.fy * window.innerHeight, 8, Math.max(8, window.innerHeight - r.height - 8));
  el.style.left = `${Math.round(x)}px`;
  el.style.top  = `${Math.round(y)}px`;
}

function savePosition(el: HTMLElement): void {
  const r = el.getBoundingClientRect();
  localStorage.setItem(POS_KEY, JSON.stringify({
    fx: r.left / window.innerWidth,
    fy: r.top  / window.innerHeight,
  }));
}

/** Dragging is on a grip, not on the bar itself. Dragging from anywhere would
 *  mean every reaction press is a potential drag, and a press that has to be
 *  held still to count is a press that feels broken. */
function makeDraggable(el: HTMLElement, grip: HTMLElement): void {
  let dx = 0, dy = 0, startX = 0, startY = 0, moved = false;

  grip.addEventListener("pointerdown", (e: PointerEvent) => {
    e.preventDefault();
    const r = el.getBoundingClientRect();
    // Switch from the centred default to explicit coordinates before the first
    // move, so the bar does not jump by half its width as it is picked up.
    el.classList.add("placed");
    el.style.left = `${r.left}px`;
    el.style.top  = `${r.top}px`;
    dx = e.clientX - r.left;
    dy = e.clientY - r.top;
    startX = e.clientX; startY = e.clientY; moved = false;
    dragging = true;
    el.classList.add("dragging");
    grip.setPointerCapture(e.pointerId);
    wake();
  });

  grip.addEventListener("pointermove", (e: PointerEvent) => {
    if (!dragging) return;
    // A few pixels of slip is a click, not a drag. Without this every attempt
    // to press the grip would count as a one-pixel move and the orientation
    // toggle would be unreachable on a trackpad.
    if (Math.abs(e.clientX - startX) > 4 || Math.abs(e.clientY - startY) > 4) moved = true;
    const r = el.getBoundingClientRect();
    el.style.left = `${Math.round(clamp(e.clientX - dx, 8, window.innerWidth  - r.width  - 8))}px`;
    el.style.top  = `${Math.round(clamp(e.clientY - dy, 8, window.innerHeight - r.height - 8))}px`;
  });

  const end = (e: PointerEvent) => {
    if (!dragging) return;
    dragging = false;
    el.classList.remove("dragging");
    try { grip.releasePointerCapture(e.pointerId); } catch { /* already gone */ }
    if (moved) savePosition(el);
    else toggleOrientation(el);
    wake();
  };
  grip.addEventListener("pointerup", end);
  grip.addEventListener("pointercancel", end);

  // Keyboard reaches the same toggle. Dragging is a pointer affordance, but
  // choosing a row or a column should not require one.
  grip.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    toggleOrientation(el);
  });
}

/** A row across the letterbox band, or a column down a pillarbox one. Which
 *  one has spare space depends entirely on the film's aspect ratio against the
 *  window's, so this is the viewer's call rather than something to detect. */
function toggleOrientation(el: HTMLElement): void {
  const vert = el.classList.toggle("vert");
  if (vert) localStorage.setItem(ORIENT_KEY, "1");
  else localStorage.removeItem(ORIENT_KEY);
  el.querySelector(".reactGrip")!.setAttribute(
    "title", vert ? "Drag to move, click to lay flat" : "Drag to move, click to stack vertically");
  // The bar just swapped its width and its height, so a position that was on
  // screen a moment ago may not be any more.
  if (el.classList.contains("placed")) { clampNow(el); savePosition(el); }
}

/** Pull the bar back inside the viewport from wherever it currently sits. */
function clampNow(el: HTMLElement): void {
  const r = el.getBoundingClientRect();
  const x = clamp(r.left, 8, Math.max(8, window.innerWidth  - r.width  - 8));
  const y = clamp(r.top,  8, Math.max(8, window.innerHeight - r.height - 8));
  el.style.left = `${Math.round(x)}px`;
  el.style.top  = `${Math.round(y)}px`;
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), hi);

/** One reaction drifting up the side of the picture. Deliberately at the edge
 *  and short-lived: this is peripheral, and anything that sits over the middle
 *  of a film is a nuisance however nice it looks. */
function float(glyph: string, who?: string): void {
  if (!stage) return;
  const el = document.createElement("span");
  el.className = "reactFloat";
  el.innerHTML = `<span class="reactGlyph">${glyph}</span>${who ? `<span class="reactWho">${who}</span>` : ""}`;
  el.style.setProperty("--drift", `${Math.round(Math.random() * 40 - 20)}px`);
  stage.appendChild(el);
  setTimeout(() => el.remove(), 2600);
}
