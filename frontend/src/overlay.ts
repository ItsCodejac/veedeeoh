// A way back out of anything that opens on top of the app.
//
// THE PROBLEM WAS NOT ANY ONE MODAL. Each overlay in the app had invented its
// own exit, and between them they covered three of the four ways a person
// tries to leave: some had a Cancel button, some closed on a backdrop click,
// one had neither, and none of them answered Escape or the browser's Back
// button. On a phone, Back and the edge-swipe that maps to it are the primary
// gesture -- and Back on a full-screen overlay left the app entirely, because
// nothing had put a history entry between here and there.
//
// So exits live in one place. Register an overlay and it gets all four:
//
//   Escape            keyboard
//   backdrop click    pointer, if the overlay names a backdrop
//   its own control   whatever Cancel/Close/X it already had, via close()
//   Back / swipe      history
//
// HOW BACK WORKS. Opening pushes a history entry with the same URL, so the
// address never changes and the route is untouched; it exists only to give
// Back something to consume. Pressing Back pops it, main's popstate handler
// asks closeTopOverlay() first, and the overlay closes instead of the app
// navigating. Closing by any other route consumes that entry with history.back()
// so the stack does not fill up with dead states -- and the popstate that
// results is swallowed, or it would close the overlay underneath as well.
//
// The stack is a stack on purpose: overlays here genuinely nest (switcher ->
// editor -> avatar creator), and Back has to unwind them one at a time.

interface Entry {
  id: number;
  el: HTMLElement;
  onClose?: () => void;
  alive: boolean;
}

let seq = 0;
const stack: Entry[] = [];

/** Set while we are consuming our own history entry, so the popstate it causes
 *  is not mistaken for the user pressing Back again. */
let selfPop = false;

export interface OverlayOptions {
  /** Clicked directly (not a child) to dismiss. Usually the full-screen
   *  scrim. Omit for an overlay that must not be dismissed by a stray click,
   *  such as one holding half-typed input. */
  dismissOn?: HTMLElement;
  /** Default true. */
  escape?: boolean;
  /** Run after the element is removed, whichever exit was used. This is where
   *  "go back to where this was opened from" belongs. */
  onClose?: () => void;
}

export interface OverlayHandle {
  /** Close it, as though the user had. Safe to call twice. */
  close(): void;
}

export function registerOverlay(el: HTMLElement, opts: OverlayOptions = {}): OverlayHandle {
  const entry: Entry = { id: ++seq, el, onClose: opts.onClose, alive: true };

  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "Escape") return;
    // Only the topmost responds. Otherwise one Escape unwinds the whole nest,
    // which is never what the person pressing it meant.
    if (stack[stack.length - 1] !== entry) return;
    e.stopPropagation();
    handle.close();
  };

  const onClick = (e: MouseEvent) => {
    if (e.target === opts.dismissOn) handle.close();
  };

  const detach = (): void => {
    document.removeEventListener("keydown", onKey, true);
    opts.dismissOn?.removeEventListener("click", onClick);
    el.remove();
    entry.onClose?.();
  };

  const handle: OverlayHandle = {
    close() {
      if (!entry.alive) return;
      entry.alive = false;
      const wasTop = stack[stack.length - 1] === entry;
      const i = stack.indexOf(entry);
      if (i >= 0) stack.splice(i, 1);
      detach();
      // Give back the history entry we took, but only if it is the one Back
      // would reach. Closing a buried overlay must not rewind past a live one.
      if (wasTop) { selfPop = true; history.back(); }
    },
  };

  (entry as any).detach = detach;

  if (opts.escape !== false) document.addEventListener("keydown", onKey, true);
  opts.dismissOn?.addEventListener("click", onClick);

  history.pushState({ __overlay: entry.id }, "", location.href);
  stack.push(entry);
  return handle;
}

/** Called first thing in the app's popstate handler.
 *
 *  Returns true when the Back press was consumed by an overlay, which means
 *  the router must not run: the URL never changed, and re-applying the route
 *  would rebuild the view sitting underneath for no reason. */
export function closeTopOverlay(): boolean {
  if (selfPop) { selfPop = false; return true; }
  const top = stack.pop();
  if (!top || !top.alive) return false;
  top.alive = false;
  (top as any).detach();
  return true;
}

/** Whether anything is open on top of the app. */
export function hasOverlay(): boolean {
  return stack.length > 0;
}

// ---------------------------------------------------------------------------
// Where an overlay has to live
// ---------------------------------------------------------------------------
//
// FULLSCREEN RENDERS ONLY THE FULLSCREEN ELEMENT'S SUBTREE. Anything parented
// to document.body is not painted while a video is fullscreen -- which is the
// state a watch party spends almost all of its time in, and on a phone is the
// only state anyone watches in.
//
// This was found once, for the reactions bar, and fixed only there. Every
// other thing a party puts on screen went on being appended to document.body:
// the knock that tells a host somebody is asking to come in, the card that
// tells a viewer they have been removed, the wrap-up when a party ends. All of
// them fire DURING playback, which is exactly when they cannot be seen. A host
// watching fullscreen was never told anyone had arrived.
//
// So the rule lives in one place and anything that must survive fullscreen
// registers here rather than reimplementing it.

const topLevel = new Set<HTMLElement>();
let fullscreenWatched = false;

/** The element an overlay must be parented to right now. */
export function overlayHost(): HTMLElement {
  return (document.fullscreenElement as HTMLElement | null)
    || ((document as any).webkitFullscreenElement as HTMLElement | null)
    || document.body;
}

function reparentAll(): void {
  const h = overlayHost();
  for (const el of topLevel) {
    if (!el.isConnected && el.parentElement === null) { topLevel.delete(el); continue; }
    if (el.parentElement !== h) h.appendChild(el);
  }
}

/** Append where it will actually be seen, and keep it there.
 *
 *  Re-parents in BOTH directions: an overlay opened before fullscreen has to
 *  move in, and one opened during it has to move back out, or it is destroyed
 *  along with the fullscreen element when the user exits. */
export function mountOnTop(el: HTMLElement): void {
  overlayHost().appendChild(el);
  topLevel.add(el);
  if (!fullscreenWatched) {
    fullscreenWatched = true;
    document.addEventListener("fullscreenchange", reparentAll);
    document.addEventListener("webkitfullscreenchange", reparentAll);
    // A rotation can end fullscreen, or change which element is fullscreen,
    // without firing fullscreenchange first. Re-checking the parent costs a
    // comparison and saves an overlay stranded in a detached subtree.
    window.addEventListener("orientationchange", reparentAll);
  }
}

/** Stop tracking an element. Safe to call on one that was never mounted. */
export function unmountFromTop(el: HTMLElement): void {
  topLevel.delete(el);
  el.remove();
}
