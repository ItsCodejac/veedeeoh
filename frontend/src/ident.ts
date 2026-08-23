// The brand ident.
//
// A THIN WRAPPER, DELIBERATELY. This file used to be a hand port of the design
// bundle's React scene code -- the numbers matched frame for frame and the
// result was still rejected on sight, which is the whole lesson: transcribing
// the maths is not the same as reproducing the thing.
//
// src/vendor/veedeeoh-ident.js is the design's own standalone build: a custom
// element, no framework, no build step. Nothing here reimplements any of it.
// This module exists only to give the app the call shape it already uses, and
// to keep the three variants' audio paths in one place.

import "./vendor/veedeeoh-ident.js";

export type IdentVariant = "main" | "kids" | "party";

/** Each variant has its own sting. The two mp3s are the design's masters,
 *  copied rather than re-encoded -- they are already lossy, so a second pass
 *  would cost quality for nothing. The party sting arrived as a 2.9 MB wav and
 *  is the only one converted. */
const AUDIO: Record<IdentVariant, string> = {
  main: "/ident.mp3",
  kids: "/ident-kids.mp3",
  party: "/ident-party.mp3",
};

export interface IdentOptions {
  /** Where to mount. Defaults to a full-screen overlay on document.body. */
  parent?: HTMLElement;
  /** Play the sting. Off inside the player, which is already someone's film. */
  sound?: boolean;
  variant?: IdentVariant;
}

/** Run the ident once, then call done().
 *
 *  done() fires exactly once, from whichever comes first: ident-end, a click to
 *  skip, or a timeout a second past the variant's own length. The component
 *  cannot stall the way a video could, so the timeout is a backstop rather than
 *  a real path -- but a brand animation must never be why somebody cannot reach
 *  the app.
 */
export function playIdent(done: () => void, opts: IdentOptions = {}): void {
  const variant = opts.variant ?? "main";
  const parent = opts.parent ?? document.body;

  const host = document.createElement("div");
  host.className = "identHost";
  host.style.cssText = opts.parent
    ? "position:absolute;inset:0;z-index:50;background:#000;"
    : "position:fixed;inset:0;z-index:99999;background:#000;";

  const node = document.createElement("veedeeoh-ident") as HTMLElement & {
    play(): void; pause(): void; muted: boolean;
  };
  node.setAttribute("variant", variant);
  node.setAttribute("autoplay", "false");
  node.style.cssText = "display:block;width:100%;height:100%;";
  if (opts.sound !== false) node.setAttribute("audio", AUDIO[variant]);

  host.appendChild(node);
  parent.appendChild(host);

  let finished = false;
  const finish = (): void => {
    if (finished) return;
    finished = true;
    try { node.pause(); } catch {}
    try { sessionStorage.setItem("veedeeoh_ident_at", String(Date.now())); } catch {}
    host.remove();
    done();
  };

  node.addEventListener("ident-end", finish);
  host.addEventListener("click", finish);

  // Muted unless the caller asked for sound, because autoplay with audio needs
  // a gesture and the component says so in its own notes. playIdent runs on
  // profile selection and on a party click, both of which are gestures, so the
  // unmuted path is the normal one -- but a browser refusing it must not also
  // refuse the picture.
  node.muted = opts.sound === false;
  node.play();

  // 6s covers the longest variant (kids, 5.5s) with room to spare.
  window.setTimeout(finish, 6500);
}
