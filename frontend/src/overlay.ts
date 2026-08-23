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
