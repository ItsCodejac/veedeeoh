// A still from what the host is playing, for the party card.
//
// WHY THE HOST'S BROWSER. It is the only place the frame exists. Video segments
// go from the provider's CDN straight to each viewer and never touch our
// infrastructure -- which is the entire reason hosting a party costs us a
// socket rather than bandwidth -- so there is no server-side moment at which a
// frame could be taken.
//
// WHAT IT IS NOT. 240x135 at JPEG quality 0.4. Measured against a worst case
// -- full-frame RGB noise, which is the hardest thing there is to compress --
// that comes out at 6,951 characters; real film content lands well under half
// of it. Enough to say what is on, nowhere near a watchable stream. The size
// is what makes storing it inline on the party row affordable: forty cards
// cost less than a couple of posters.
//
// PRIVATE ROOMS ARE NEVER CAPTURED. Checked here and again by a trigger in the
// database, because this check sits on the caller's side of the boundary and
// that is exactly the sort of check that goes missing.
//
// TAINTED CANVAS IS AN EXPECTED OUTCOME, NOT AN ERROR. HLS plays through
// MediaSource -- the bytes arrive via script, so the canvas stays clean and a
// Pluto or Tubi party captures fine. A progressive mp4 served cross-origin
// without CORS taints the canvas and toDataURL throws, which is how Internet
// Archive titles will usually behave. The fix for that would be setting
// crossorigin on the video element, and it is the wrong trade: if the host
// does not send the header the video then fails to load at all. Losing a
// thumbnail is better than losing the film. So capture is attempted, a taint
// disables it for the rest of the party, and the card keeps its empty well --
// which is a correct final state, not a broken one.

import { getSupabase } from "./auth";

const WIDTH = 240;
const HEIGHT = 135;
const QUALITY = 0.4;

/** How often to take one. A directory refreshed faster than this is not
 *  telling anyone anything new, and every capture is a database write. */
const EVERY_MS = 90_000;

/** The first one waits, so the card does not show a black frame from the
 *  moment before the picture arrives. */
const FIRST_MS = 20_000;

let timer: number | null = null;
let firstTimer: number | null = null;
let partyId: string | null = null;
/** Set when the canvas turns out to be tainted, or when the database has no
 *  column to write to. One attempt is enough to know either; retrying every
 *  ninety seconds would just be noise in the console. */
let refused = false;

/** Whether public.parties actually has the frame columns. Null until asked.
 *
 *  NOT A DEPLOYMENT WORKAROUND -- a permanent condition. A self-hosted instance
 *  runs whatever schema its owner last applied, and there is no version of this
 *  project in which every database is guaranteed to be current. Code that
 *  assumes otherwise fails by writing to a column that is not there, which
 *  costs a request and a console error every ninety seconds and gives the
 *  person running it nothing to act on.
 *
 *  Asked once per session, with a request that returns no rows. */
let hasColumns: boolean | null = null;

async function schemaSupportsFrames(): Promise<boolean> {
  if (hasColumns !== null) return hasColumns;
  const { error } = await getSupabase().from("parties").select("frame").limit(0);
  // PGRST204 / 42703 both mean the column is not there. Anything else is a
  // transient problem and should not permanently disable the feature.
  hasColumns = !error;
  if (error) {
    console.info("[frames] this database has no frame column; captures are off");
  }
  return hasColumns;
}

/** The element Vidstack is painting into. Looked up each time rather than held:
 *  the player is destroyed and rebuilt when the host changes what is playing,
 *  so a cached reference goes stale exactly when the frame would change. */
function videoEl(): HTMLVideoElement | null {
  const v = document.querySelector<HTMLVideoElement>("media-player video")
    || document.querySelector<HTMLVideoElement>("video");
  return v && v.videoWidth > 0 ? v : null;
}

function grab(): string | null {
  const v = videoEl();
  if (!v) return null;
  // Nothing worth showing before the first frame has decoded, and a paused
  // player at position zero is a black rectangle.
  if (v.readyState < 2 || v.currentTime < 1) return null;

  try {
    const c = document.createElement("canvas");
    c.width = WIDTH;
    c.height = HEIGHT;
    const ctx = c.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(v, 0, 0, WIDTH, HEIGHT);
    return c.toDataURL("image/jpeg", QUALITY);
  } catch {
    // SecurityError: the media is cross-origin without CORS. Expected for some
    // providers; see the note at the top.
    refused = true;
    return null;
  }
}

async function capture(): Promise<void> {
  if (!partyId || refused) return;
  if (!(await schemaSupportsFrames())) { refused = true; return; }
  const frame = grab();
  if (!frame) return;
  // The cap is enforced by a CHECK constraint. Failing the write because a
  // complicated frame compressed badly would be a silly way to lose one.
  if (frame.length > 12_000) return;

  const { error } = await getSupabase().from("parties")
    .update({ frame, frame_at: new Date().toISOString() })
    .eq("id", partyId);
  if (error) {
    // One failure is not worth a retry storm. RLS already restricts this to
    // the host's own row, so an error here means something structural.
    console.warn("[frames] write", error);
    refused = true;
  }
}

/** Start capturing for a party this client is hosting.
 *
 *  @param isPublic pass the party's own listing flag. A private room is never
 *  captured, and calling this for one does nothing at all. */
export function startFrameCapture(id: string, isPublic: boolean): void {
  stopFrameCapture();
  if (!isPublic || !id) return;
  partyId = id;
  refused = false;
  firstTimer = window.setTimeout(() => { void capture(); }, FIRST_MS);
  timer = window.setInterval(() => { void capture(); }, EVERY_MS);
}

/** Stop, and clear the frame the card is still showing.
 *
 *  The trigger clears it when ended_at is set, so this is belt and braces for
 *  the case where the host closes the tab on a party that stays open: the row
 *  outlives the session, and a picture of what was on should not. */
export function stopFrameCapture(clearNow = false): void {
  if (firstTimer !== null) { clearTimeout(firstTimer); firstTimer = null; }
  if (timer !== null) { clearInterval(timer); timer = null; }
  const id = partyId;
  partyId = null;
  if (clearNow && id && hasColumns) {
    void getSupabase().from("parties")
      .update({ frame: null, frame_at: null }).eq("id", id);
  }
}
