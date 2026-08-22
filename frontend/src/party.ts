// Watch Party client.
//
// Design: docs/plans/2026-08-21-watch-party-design.md
//
// The host is authoritative and viewers reconcile. Crucially, every viewer
// resolves its OWN signed stream URL rather than receiving the host's: Pluto
// JWTs are per-session and expire in 24h, so a shared URL would break for
// everyone at once. Only playback POSITION travels between peers.

import { getSupabase } from "./auth";
import { getActiveProfile } from "./profiles";
import { allowedRatingsFor } from "./db";
import { showToast } from "./util";
import { openVodPlayer, setPartyEmitter, applyPartyState, setPartyViewerMode, resyncToHost, stopPartySync, type PartyPlaybackState } from "./vodplayer";

const WORKER_URL = (import.meta.env.VITE_PARTY_WORKER_URL as string) || "";

let socket: WebSocket | null = null;
let syncPoll: number | null = null;

// ---- reconnection -----------------------------------------------------------
//
// A dropped socket used to be the end of it: the viewer got a toast and sat
// there while the film carried on without them. Now that the worker remembers
// who it has admitted, walking back in is seamless -- so it should happen by
// itself.
//
// THE RISK IS SPAM, not the retry. A client that reconnects on every close
// hammers the Durable Object when the honest answer is "stop asking": the party
// ended, or this person was removed, or the room is full. Every one of those is
// a final answer, and retrying is asking the same question again. So each is
// checked before a retry is even scheduled, and what remains is bounded,
// backed off, and abandoned after a handful of attempts.
const RETRY_MAX = 6;
const RETRY_BASE_MS = 1000;
const RETRY_CAP_MS = 20000;

let retryTimer: number | null = null;
let retryCount = 0;
let onlineHandler: (() => void) | null = null;
/** Bumped by every connect and every deliberate disconnect. A socket whose
 *  generation is stale belongs to a connection that has been replaced, and its
 *  close must not schedule anything. */
let generation = 0;
/** Whether any socket for the CURRENT party has ever opened. Distinguishes "the
 *  room is not there" from "we were in it and lost the connection", which look
 *  identical from a failed upgrade. */
let sessionOpened = false;

function cancelRetry(): void {
  if (retryTimer !== null) { clearTimeout(retryTimer); retryTimer = null; }
  if (onlineHandler) { window.removeEventListener("online", onlineHandler); onlineHandler = null; }
  retryCount = 0;
}

function scheduleReconnect(joinCode: string, isHost: boolean): void {
  if (retryTimer !== null || onlineHandler) return;      // one attempt in flight

  // Offline is not a failed attempt, it is no attempt. Burning the budget on
  // retries that cannot possibly succeed means being out of them at the moment
  // the network comes back -- so wait for the browser to say it has returned.
  if (navigator.onLine === false) {
    const back = () => {
      window.removeEventListener("online", back);
      onlineHandler = null;
      void reconnectNow(joinCode, isHost);
    };
    onlineHandler = back;
    window.addEventListener("online", back);
    return;
  }

  if (retryCount >= RETRY_MAX) {
    showToast(isHost ? "Lost the party connection. Reopen it to carry on"
                     : "Lost the party connection");
    window.dispatchEvent(new CustomEvent("veedeeoh:party-lost"));
    return;
  }

  // Jittered, so a room that all dropped together does not come back in one
  // synchronised wave.
  const wait = Math.min(RETRY_CAP_MS, RETRY_BASE_MS * 2 ** retryCount)
             + Math.floor(Math.random() * 400);
  retryCount += 1;
  retryTimer = window.setTimeout(() => { retryTimer = null; void reconnectNow(joinCode, isHost); }, wait);
}

async function reconnectNow(joinCode: string, isHost: boolean): Promise<void> {
  if (currentCode !== joinCode) return;    // left the party while waiting
  try { await connect(joinCode, isHost, true); } catch { /* the close handler takes it from here */ }
}
let currentCode: string | null = null;

function code6(): string {
  const A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no O/0, I/1 — read aloud safely
  return Array.from({ length: 6 }, () => A[Math.floor(Math.random() * A.length)]).join("");
}

// The party a guest is currently in, remembered across a reload or an
// accidental close. Without this, someone who shut the tab had to go and find
// the original invite message again to get back into a party still running --
// and the code is not shown anywhere once the player is open.
const LAST_PARTY_KEY = "veedeeoh_last_party";

export interface LastParty { code: string; title: string; at: number; role: "host" | "guest" }

export function rememberParty(code: string, title: string, role: "host" | "guest" = "guest"): void {
  try { localStorage.setItem(LAST_PARTY_KEY, JSON.stringify({ code, title, role, at: Date.now() })); } catch {}
}

export function forgetParty(): void {
  try { localStorage.removeItem(LAST_PARTY_KEY); } catch {}
}

/** The last party joined, if it is recent enough to still plausibly be running.
 *  Six hours is well past any film, and stale enough entries are dropped rather
 *  than offered as a rejoin that will fail. */
export function recentParty(): LastParty | null {
  try {
    const raw = localStorage.getItem(LAST_PARTY_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as LastParty;
    if (!p?.code || Date.now() - (p.at || 0) > 6 * 3600_000) { forgetParty(); return null; }
    return { ...p, role: p.role === "host" ? "host" : "guest" };
  } catch { return null; }
}

export function partyLink(joinCode: string): string {
  return `${location.origin}/index.html?party=${joinCode}`;
}

// ---------------------------------------------------------------- hosting ---

/** Hosting is an ACCOUNT-level entitlement: only the account owner starts a
 *  party, never a kids profile, and never a lapsed account.
 *
 *  The subscription check is the real anti-abuse control for the free tier. A
 *  lapsed guest may ATTEND a party, so they can only ever watch what a paying
 *  customer chose to play; letting them host would hand them the whole catalogue
 *  back and make the paywall decorative. Credits, when they arrive, are a
 *  quantity on top of this gate -- not a substitute for it.
 *
 *  Enforced again by RLS, because a hidden button is not a control.
 */
export async function canHost(): Promise<boolean> {
  if (getActiveProfile()?.is_kids) return false;
  const { data } = await getSupabase().auth.getUser();
  if (!data.user) return false;
  const { hasActiveAccess } = await import("./db");
  // Fail CLOSED here, unlike the browse gate. A transient error that wrongly
  // lets someone browse is a small mistake; one that lets a lapsed account host
  // is the hole this exists to close.
  try { return await hasActiveAccess(); } catch { return false; }
}

export interface PartyOptions {
  contentId: string;
  streamIdx: number;
  title: string;
  seatLimit?: number | null;
  requireApproval?: boolean;
  isPublic?: boolean;
  blurb?: string | null;
}

/** 256 bits of randomness, generated by the host and never sent to a guest.
 *  This is what proves host identity to the Durable Object; the join code alone
 *  used to be enough, which meant anyone with the link could take the controls. */
function hostToken(): string {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join("");
}

// localStorage, not sessionStorage. This is the ONLY thing that proves a
// connection is the host's, so keeping it per-tab meant closing the tab
// permanently forfeited control of a party that is still running -- the host
// could not even rejoin their own room.
const tokenKey = (joinCode: string) => `veedeeoh_party_host_${joinCode}`;

function saveHostToken(joinCode: string, token: string): void {
  try { localStorage.setItem(tokenKey(joinCode), token); } catch {}
}
function readHostToken(joinCode: string): string | null {
  try { return localStorage.getItem(tokenKey(joinCode)); } catch { return null; }
}

export async function createParty(opts: PartyOptions): Promise<{ joinCode: string; link: string; partyId: string }> {
  const { data: u } = await getSupabase().auth.getUser();
  if (!u.user) throw new Error("not signed in");
  if (!WORKER_URL) throw new Error("Watch Party isn't configured yet");

  const joinCode = code6();
  const token = hostToken();

  const { data: created, error } = await getSupabase().from("parties").insert({
    host_user_id: u.user.id,
    join_code: joinCode,
    content_id: opts.contentId,
    stream_idx: opts.streamIdx,
    title: opts.title,
    seat_limit: opts.seatLimit ?? null,
    is_public: !!opts.isPublic,
    blurb: opts.isPublic ? (opts.blurb || null) : null,
    // Snapshotted so the listing has a name without exposing the host's
    // profile row, and so a later rename does not retitle a past party.
    host_name: opts.isPublic ? (getActiveProfile()?.name || null) : null,
  }).select("id").single();
  if (error) throw error;

  // Bind the party to this host BEFORE the link exists. Init is one-shot, so
  // there is no window in which someone who guessed the code could claim it.
  const res = await fetch(`${WORKER_URL}/init?party=${joinCode}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      hostToken: token,
      hostUserId: u.user.id,
      seatLimit: opts.seatLimit ?? null,
      requireApproval: opts.requireApproval !== false,
    }),
  });
  if (!res.ok) throw new Error("Couldn't start the party channel");

  saveHostToken(joinCode, token);
  partyTitle = opts.title;
  partyRowId = (created as any)?.id || "";
  partyStartedAt = 0;
  peakViewers = 0;
  rememberParty(joinCode, opts.title, "host");

  return { joinCode, link: partyLink(joinCode), partyId: (created as any)?.id || "" };
}

// ---------------------------------------------------------------- joining ---

export async function joinParty(joinCode: string): Promise<void> {
  if (!WORKER_URL) { showToast("Watch Party isn't configured yet"); return; }

  // A guest following a link previously landed on Home and waited through the
  // catalogue load, the party lookup and the stream resolve with nothing on
  // screen explaining any of it -- so the invite looked like it had failed
  // right up until the film appeared. Covered, and torn down on every exit
  // path below.
  const veil = showJoining(joinCode);

  const sb = getSupabase();
  // Through the definer function, not a table select. The select policy no
  // longer exposes other people's parties -- it used to expose every open one
  // with its code, so any signed-in user could enumerate and walk into a
  // "private" party. Knowing the code is now the credential.
  const { data: rows, error } = await sb.rpc("party_by_code", { code: joinCode });
  const party = Array.isArray(rows) ? rows[0] : rows;
  if (error || !party) { veil(); showToast("That party has ended or the link is wrong"); return; }

  // THE KIDS TRAP. A party link handed to a kids profile would otherwise play
  // whatever the host is playing. Refuse outright rather than filtering -- a
  // control any Discord link walks around is not a control.
  const profile = getActiveProfile();
  const allowed = allowedRatingsFor(profile);
  if (allowed) {
    const item = await lookupCatalogItem(party.content_id);
    const rating = (item?.rating || "").toUpperCase();
    if (!rating || !allowed.has(rating)) {
      veil();
      showToast(`This party is playing something outside ${profile.name}'s rating limits`);
      return;
    }
  }

  const { data: u } = await sb.auth.getUser();
  if (!u.user) { veil(); showToast("Sign in to join the party"); return; }

  // Two separate records, deliberately. party_joins is the presence log for
  // this party; the referral is a permanent, first-touch claim on the guest's
  // account that outlives it. attribute_party_join is a no-op if the guest
  // already has a referrer, so an existing customer joining a party does not
  // get reassigned to the host.
  await sb.from("party_joins").upsert({
    party_id: party.id, user_id: u.user.id, host_user_id: party.host_user_id,
  }).then(({ error: e }) => { if (e) console.warn("[party] join not recorded", e); });

  await sb.rpc("attribute_party_join", { party: party.id })
    .then(({ error: e }) => { if (e) console.warn("[party] referral not recorded", e); });

  const item = await lookupCatalogItem(party.content_id);
  if (!item) { veil(); showToast("That title isn't in the catalog any more"); return; }

  // Each viewer resolves their OWN url -- a Pluto JWT is per-session and
  // expires, so the host's cannot be shared. asPartyChannel used to read
  // `item.url`, which is only set for legacy catalogue rows, so a Pluto, Tubi
  // or Archive title handed the player a stream with url undefined and the
  // joiner landed on "this title isn't available to stream right now".
  const vod = await import("./vod");

  // A series guest needs the WHOLE episode list, not just one URL. streamIdx is
  // an index into this array, so without it a host moving to episode 4 would
  // send an index the viewer cannot resolve.
  let streams: any[] | null = null;
  if (item.series_id) {
    const { fetchVodSeries } = await import("./api");
    const eps = await fetchVodSeries(item.series_id).catch(() => [] as any[]);
    if (eps.length) {
      streams = [...eps]
        .sort((a, b) => (a.season ?? 1) - (b.season ?? 1) || (a.number ?? 0) - (b.number ?? 0))
        .map((ep) => ({
          url: ep.url, quality: null,
          source: `S${ep.season ?? "?"}E${ep.number ?? "?"} ${ep.title}`.slice(0, 48),
        }));
    }
  }

  const url = streams?.length ? null : await vod.resolveItemStream(item);
  if (!streams?.length && !url) { veil(); showToast("That title can't be streamed right now"); return; }

  // Do NOT open the player yet. A guest was dropped straight into the film the
  // instant they joined, so the host had no moment to gather anyone and an
  // early arrival watched alone. The player opens on the host's start signal --
  // or immediately, if the worker reports the party already running, which is
  // what a late joiner gets.
  partyTitle = item.title || "a watch party";
  partyRowId = party.id;
  partyStartedAt = Date.now();
  rememberParty(joinCode, partyTitle, "guest");

  const { showGuestLobby } = await import("./party-setup");
  const closeLobby = showGuestLobby(item, joinCode);
  veil();

  window.addEventListener("veedeeoh:party-dead", () => closeLobby(), { once: true });

  window.addEventListener("veedeeoh:party-start", () => {
    closeLobby();
    // Viewer mode goes on BEFORE the player mounts. Applying it afterwards left
    // a window where the transport controls were live, and the viewer in
    // testing used exactly that window to press play.
    setPartyViewerMode(true);
    // `streams` carries the whole episode list for a series, which is what
    // makes the host's streamIdx resolvable. An earlier edit to pass it did not
    // apply -- the argument is optional, so nothing failed to compile and the
    // guest silently kept a one-episode list.
    void openVodPlayer(asPartyChannel(item, url, streams), party.stream_idx || 0, 0)
      .then(async () => {
        setPartyViewerMode(true);
        (await import("./party-reactions")).mountReactions();
      });
  }, { once: true });

  await connect(joinCode, false);
}

// ----------------------------------------------------------------- socket ---

/** @param resume reconnecting to a party already in progress. Skips the full
 *  teardown: on a resume the player, the reactions bar, viewer mode and the
 *  host's metering must all survive, and tearing them down and rebuilding them
 *  is exactly the interruption reconnecting exists to avoid. */
async function connect(joinCode: string, isHost: boolean, resume = false): Promise<void> {
  if (resume) {
    if (syncPoll !== null) { clearInterval(syncPoll); syncPoll = null; }
    try { socket?.close(); } catch { /* already gone */ }
    socket = null;
  } else {
    disconnect();
    sessionOpened = false;
  }
  const gen = ++generation;
  currentCode = joinCode;

  const { data: u } = await getSupabase().auth.getUser();
  const profile = getActiveProfile();

  const base = WORKER_URL.replace(/^http/, "ws");
  const qs = new URLSearchParams({ party: joinCode, uid: u.user?.id || "", name: profile?.name || "Guest" });
  // The token is the ONLY thing that makes a connection the host's. A guest
  // never receives it, so a guest cannot send one.
  if (isHost) {
    const t = readHostToken(joinCode);
    if (t) qs.set("t", t);
  }
  socket = new WebSocket(`${base}?${qs.toString()}`);

  const emit = (detail: any, name: string) =>
    window.dispatchEvent(new CustomEvent(name, { detail }));

  socket.addEventListener("message", (e) => {
    let msg: any;
    try { msg = JSON.parse(String(e.data)); } catch { return; }
    switch (msg?.type) {
      case "state":
        if (!isHost && msg.state) {
          lastHostState = msg.state as PartyPlaybackState;
          // How old the host's report is, measured entirely on the SERVER's
          // clock so the two devices never have to agree on the time. A state
          // read out of storage -- on joining, on admission, or in answer to a
          // poll -- can be minutes old, and treating it as current is what put
          // a late joiner behind and kept them there.
          const age = Number(msg.serverNow) - Number(msg.state.updatedAt);
          applyPartyState(lastHostState, Number.isFinite(age) ? age : 0);
          clearResync("stale");
        }
        break;
      case "presence":
        peakViewers = Math.max(peakViewers, msg.viewers || 0);
        emit({ viewers: msg.viewers }, "veedeeoh:party-presence");
        break;
      case "roster":    emit({ watching: msg.watching, waiting: msg.waiting }, "veedeeoh:party-roster"); break;
      case "knock":     showToast(`${msg.name} wants to join`); break;
      case "pending":   emit({}, "veedeeoh:party-pending"); showToast("Waiting for the host to let you in"); break;
      case "admitted":  emit({}, "veedeeoh:party-admitted"); showToast("You're in"); break;
      case "start":     emit({}, "veedeeoh:party-start"); break;
      case "react":     emit({ kind: msg.kind, name: msg.name }, "veedeeoh:party-react"); break;
      case "away":      if (!isHost) showHostAway(true); break;
      case "back":      if (!isHost) showHostAway(false); break;
      case "refused":   showToast("The host did not let you in"); break;
      case "removed":
        // forgetParty() as well as disconnecting: the saved invite is an offer
        // to walk back in, and someone the host removed should not be given
        // one. A second, unreachable `case "removed"` further down held this
        // call and had been silently dead -- the duplicate label meant it never
        // ran, so a removed viewer kept the party in their recent list.
        showToast("The host removed you from the party");
        forgetParty();
        disconnect();
        break;
      case "closed": {
        // Was a toast and nothing else, so the film kept playing and a viewer
        // could not tell "the party ended" from "the host paused".
        const reason = msg.reason;
        forgetParty();
        disconnect();
        void import("./party-setup").then((m) => m.showPartyEnded({
          host: false,
          title: partyTitle || "the party",
          code: joinCode,
          watchedSecs: partyStartedAt ? (Date.now() - partyStartedAt) / 1000 : 0,
          reason,
        }));
        break;
      }
    }
  });

  // A room the Durable Object has already closed 404s the upgrade, so the
  // socket never opens at all. Nothing distinguished that from a normal close,
  // so a guest sat in the green room waiting for a start signal that could
  // never arrive -- and the Supabase row still said the party was live, so the
  // next person walked into the same dead end.
  let everOpened = false;
  socket.addEventListener("open", () => {
    if (gen !== generation) return;
    everOpened = true;
    // Reconnected rather than connected: say so, because the last thing this
    // viewer saw was a disconnection notice.
    if (sessionOpened && retryCount > 0) showToast("Reconnected to the party");
    sessionOpened = true;
    cancelRetry();
  });

  socket.addEventListener("close", (e) => {
    // A socket from a connection that has already been replaced or deliberately
    // ended. Anything it has to say is out of date, and acting on it would
    // reconnect a party the user has left.
    if (gen !== generation) return;

    // ---- final answers. Retrying any of these is asking again after being
    // told no, which is precisely the spam worth avoiding.
    if (e.code === 1008 || e.code === 4009) { cancelRetry(); showToast("That party is full"); return; }
    if (e.code === 4003 || e.code === 4004) { cancelRetry(); return; }  // refused / removed
    if (e.code === 1000) { cancelRetry(); return; }                     // closed cleanly, by us

    // The room was never there. Only trustworthy on the FIRST attempt: a failed
    // upgrade and a failed network look identical from here, so once we have
    // been inside the room, a failure to get back in is treated as something to
    // retry rather than as proof the party is over.
    if (!everOpened && !sessionOpened) {
      cancelRetry();
      showToast("That party has ended");
      window.dispatchEvent(new CustomEvent("veedeeoh:party-dead"));
      forgetParty();
      // Close the row too, so nobody else follows the same link into a room
      // that no longer exists. Best effort: only the host may write it, and a
      // guest failing here is harmless.
      void getSupabase().from("parties")
        .update({ ended_at: new Date().toISOString() })
        .eq("join_code", joinCode)
        .then(() => {}, () => {});
      return;
    }

    // Dropped mid-party, with no final answer attached. Walk back in.
    //
    // The worker remembers who it has admitted, so a guest who was approved
    // does not queue again, and the host's token still identifies them as the
    // host. If the room really has gone, the next attempt fails to upgrade and
    // the bounded retry gives up on its own rather than hammering it.
    if (retryCount === 0) {
      showToast(isHost ? "Connection lost. Reconnecting" : "Disconnected. Reconnecting");
    }
    scheduleReconnect(joinCode, isHost);
  });

  // ---- the viewer checks, rather than only listening --------------------
  //
  // Everything else about sync is push, which is fine while the host is
  // talking. The gap is that a viewer receiving nothing cannot tell "the host
  // has not moved" from "I have stopped hearing the host": between heartbeats
  // it is playing an extrapolation, and a socket that dies half-open -- routine
  // on mobile -- produces no close event at all, so it would keep playing that
  // guess indefinitely and believe it was in sync.
  //
  // So it asks. Every ten seconds, over the socket that is already open, the
  // worker answers from storage without waking the host. The reply carries the
  // server's clock, so a stale answer is recognisable AS stale rather than
  // being mistaken for a fresh one -- and the request itself is what proves the
  // socket is still alive.
  //
  // Twice as often as the staleness threshold, so a single lost message is
  // absorbed by the next poll instead of being reported to the viewer as a
  // problem. Cheap: one small message on an open socket, no media, and
  // Cloudflare does not bill data transfer.
  if (!isHost) {
    if (syncPoll !== null) clearInterval(syncPoll);
    syncPoll = window.setInterval(() => {
      if (socket?.readyState !== WebSocket.OPEN) return;
      try { socket.send(JSON.stringify({ type: "sync" })); } catch { /* closing */ }
    }, 10000);
  }

  if (isHost) {
    watchHostVisibility();
    setPartyEmitter((s) => {
      // Suppressed while the tab is hidden. A backgrounded browser pauses the
      // video, which would otherwise be emitted as paused:true and stop the
      // whole room -- turning "the host's phone rang" into "everyone's film
      // stopped". Absence is signalled once, as `away`, and viewers keep going.
      if (hostAway) {
        // Going silent for the WHOLE absence starved viewers of every
        // correction for as long as the host looked at another tab -- which,
        // when the host and a viewer are two tabs of one browser, is the entire
        // session. It also left them extrapolating a position nothing had
        // confirmed since the moment the host looked away.
        //
        // A hidden tab does not necessarily stop the video: desktop browsers
        // keep audio-bearing media running. So stay silent only in the case the
        // suppression was actually written for -- a position that has stopped
        // moving -- and otherwise keep the room informed, never reporting a
        // pause, because a pause caused by backgrounding is not one anybody
        // chose.
        const advanced = s.positionSecs > lastAwayPos + 0.25;
        lastAwayPos = s.positionSecs;
        if (!advanced) return;
        s = { ...s, paused: false };
      } else {
        lastAwayPos = -1;
      }
      if (socket?.readyState === WebSocket.OPEN) {
        // streamIdx travels; contentId does not. The episode index is what a
        // viewer needs to follow a binge, and it is meaningless outside this
        // party. contentId stays blank because every viewer already knows the
        // title and resolves their own URL for it -- sending the host's would
        // be a signed, per-session link that expires on them.
        socket.send(JSON.stringify({ type: "state", state: { ...s, contentId: "" } }));
      }
    });
  }
}

/** Host admits or refuses someone waiting in the lobby. */
export function respondToKnock(userId: string, admit: boolean): void {
  socket?.send(JSON.stringify({ type: admit ? "admit" : "refuse", userId }));
}

/** Host opens the doors. Until this is sent, every approved guest sits in the
 *  green room with a socket open and no playback state. */
export function startPlayback(): void {
  socket?.send(JSON.stringify({ type: "start" }));
}

/** Host removes someone already admitted. */
export function kickViewer(userId: string): void {
  socket?.send(JSON.stringify({ type: "kick", userId }));
}

/** Host ends the party for everyone, rather than leaving it to time out. */
export function endParty(): void {
  const secs = partyStartedAt ? (Date.now() - partyStartedAt) / 1000 : 0;
  const code = currentCode || "";
  const peak = peakViewers;
  const title = partyTitle;

  try { socket?.send(JSON.stringify({ type: "end" })); } catch {}
  disconnect();
  forgetParty();

  // The host was running something; tell them how it went rather than just
  // leaving the film playing as though nothing happened.
  void import("./party-setup").then((m) => m.showPartyEnded({
    host: true, title: title || "your party", code,
    watchedSecs: secs, peakViewers: peak, partyId: partyRowId,
  }));
}

export function disconnect(): void {
  // Before anything else: invalidate the live socket's generation so its close
  // event cannot schedule a reconnect to a party the user has just left.
  generation += 1;
  cancelRetry();
  sessionOpened = false;
  stopMetering();
  void import("./party-reactions").then((m) => m.unmountReactions()).catch(() => {});
  partyStartedAt = 0;
  peakViewers = 0;
  stopPartySync();
  stopWatchingVisibility();
  showHostAway(false);
  if (syncPoll !== null) { clearInterval(syncPoll); syncPoll = null; }
  clearResync();
  setPartyViewerMode(false);
  lastHostState = null;
  setPartyEmitter(null);
  try { socket?.close(); } catch {}
  socket = null;
  currentCode = null;
}

export function activePartyCode(): string | null { return currentCode; }

/** Whether this deployment has a sync worker configured at all. */
export function partyEnabled(): boolean { return !!WORKER_URL; }

/** Start hosting for a title already open in the player. */
export async function hostExisting(joinCode: string): Promise<void> {
  await connect(joinCode, true);
  startMetering(joinCode);
}

// ---------------------------------------------------------------- metering ---
//
// Hosting is billed in 10-minute credits, wall clock. Metered from the client
// on an interval, which a modified client could dodge -- accepted deliberately,
// because hosting already requires an active subscription and credits are a
// premium quantity rather than a security control. The BALANCE itself is
// server-side: spend_party_credits is SECURITY DEFINER and no client can write
// profiles.party_credits directly.

let meterTimer: number | null = null;
// For the host's end-of-party summary. Tracked here because the party outlives
// any one player instance -- a host can close and reopen the video mid-party.
let partyStartedAt = 0;
let peakViewers = 0;
let partyTitle = "";
let partyRowId = "";
const METER_MINUTES = 10;

/** True if the account may start a party at all. Checked before the first
 *  credit is spent so a host with an empty balance is told up front rather than
 *  cut off ten minutes in. */
export async function hasHostingCredit(): Promise<{ ok: boolean; exempt: boolean; balance: number }> {
  const { ensurePartyCredits, partyCreditSummary } = await import("./db");
  // Grant this month's allowance first if it has not been issued yet, so a
  // comped account -- which never triggers an invoice -- is not told it is out
  // of hours it was never given.
  const c = (await ensurePartyCredits()) ?? (await partyCreditSummary());
  if (!c) return { ok: true, exempt: false, balance: 0 };   // no data: do not block
  return { ok: c.exempt || c.balance > 0, exempt: c.exempt, balance: c.balance };
}

function startMetering(joinCode: string): void {
  partyStartedAt = partyStartedAt || Date.now();
  stopMetering();
  void charge(joinCode);                                     // the first block is due now
  meterTimer = window.setInterval(() => void charge(joinCode), METER_MINUTES * 60_000);
}

function stopMetering(): void {
  if (meterTimer !== null) { clearInterval(meterTimer); meterTimer = null; }
}

async function charge(joinCode: string): Promise<void> {
  const { spendPartyCredits, partyCreditSummary } = await import("./db");
  const ok = await spendPartyCredits(METER_MINUTES, undefined);
  if (!ok) {
    // Out of credit. The party is NOT cut off: ending someone's film twenty
    // minutes from the finish is the most memorable possible bad experience,
    // and the marginal cost of letting it run is fractions of a cent.
    stopMetering();
    showToast("You're out of watch party hours. This party can finish.");
    window.dispatchEvent(new CustomEvent("veedeeoh:party-credits-out"));
    return;
  }
  const c = await partyCreditSummary();
  if (c && !c.exempt && c.balance === 1) {
    showToast("10 minutes of hosting left");
  }
}

// ------------------------------------------------------------------ lookup ---

async function lookupCatalogItem(contentId: string): Promise<any | null> {
  const { getVodRails } = await import("./vod");
  const rails = await getVodRails();
  for (const rail of rails) {
    for (const it of rail.items as any[]) if (String(it.id) === contentId) return it;
  }
  return null;
}

/** Mirrors asChannel in vod.ts so the player receives the shape it expects. */
function asPartyChannel(item: any, url: string | null, streams?: any[] | null): any {
  return {
    id: `vod:${item.id}`,
    name: item.title,
    country: null, categories: [], nsfw: false, logo: null, logos: [],
    streams: streams?.length ? streams : [{ url, quality: null, source: item.genre || "Party" }],
    source: item.genre || "Watch Party",
    vodPoster: item.poster, vodBanner: item.banner, vodItem: item,
  };
}


/** Full-screen "joining" cover. Returns its own dismiss function so every exit
 *  path from joinParty -- including the failures -- can drop it, rather than
 *  relying on one happy-path removal that a `return` above it would skip. */
function showJoining(code: string): () => void {
  const el = document.createElement("div");
  el.id = "partyJoining";
  el.innerHTML = `
    <div class="pjInner">
      <div class="pjMark">veedeeoh<span class="dot">.</span><span class="sfx">party</span></div>
      <div class="pjSub">Joining ${code.toUpperCase()}</div>
      <div class="vdTrackBar"><span></span></div>
    </div>`;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add("in"));

  let gone = false;
  return () => {
    if (gone) return;
    gone = true;
    el.classList.remove("in");
    setTimeout(() => el.remove(), 380);
  };
}


// ------------------------------------------------------- viewer resync ---

let lastHostState: PartyPlaybackState | null = null;
let resyncEl: HTMLElement | null = null;

// WHY THE PILL HAS A REASON. It said "Tap to join the party" over a film that
// was already playing, and stayed there. Two causes, both from treating one
// button as one state:
//
//   the autoplay rejection resolves AFTER the message handler that clears the
//   pill, so every incoming heartbeat cleared it a moment before the same
//   heartbeat put it back, and
//
//   nothing watched for playback actually STARTING, so once the viewer pressed
//   play themselves -- or the browser relented -- the prompt outlived the
//   problem it was describing.
//
// Now each cause clears only its own prompt.
type ResyncReason = "blocked" | "stale";
let resyncReason: ResyncReason | null = null;

if (typeof window !== "undefined") {
  // Autoplay refused. The host is playing, the viewer is paused, and no
  // heartbeat can fix it -- only a real click can.
  window.addEventListener("veedeeoh:party-blocked",
    () => showResync("blocked", "Tap to join the party"));

  // Playing now, however it got there. Whatever the browser was refusing, it
  // is not refusing any more.
  window.addEventListener("veedeeoh:party-playing", () => clearResync("blocked"));

  // The sync has gone quiet: the viewer is running on an extrapolation nothing
  // has confirmed. Offered rather than forced -- a jump mid-scene should be the
  // viewer's choice when we are not certain where the host is.
  window.addEventListener("veedeeoh:party-stale", (e) => {
    const stale = !!(e as CustomEvent).detail?.stale;
    if (stale) showResync("stale", "Lost sync with the host. Tap to catch up");
    else clearResync("stale");
  });
}

function showResync(reason: ResyncReason, label: string): void {
  // A blocked player is the more urgent of the two and may replace a stale
  // notice; the reverse would talk over the only thing that can be acted on.
  if (resyncEl && !(reason === "blocked" && resyncReason === "stale")) return;
  resyncEl?.remove();

  resyncReason = reason;
  resyncEl = document.createElement("button");
  resyncEl.id = "partyResync";
  resyncEl.textContent = label;
  resyncEl.addEventListener("click", () => {
    if (lastHostState) resyncToHost(lastHostState);
    clearResync();
  });
  document.body.appendChild(resyncEl);
}

/** @param reason clear only if this is what put the prompt up. */
function clearResync(reason?: ResyncReason): void {
  if (reason && resyncReason !== reason) return;
  resyncEl?.remove();
  resyncEl = null;
  resyncReason = null;
}


/** Walk a host back into a party they closed out of.
 *
 *  A host who shut the tab lost the room entirely: the token was per-tab, and
 *  nothing offered it back. The party itself was still alive -- the Durable
 *  Object only closes after five idle minutes -- so guests could still be
 *  sitting in it with nobody driving.
 */
export async function resumeHosting(joinCode: string): Promise<boolean> {
  if (!WORKER_URL) { showToast("Watch Party isn't configured yet"); return false; }
  if (!readHostToken(joinCode)) {
    forgetParty();
    showToast("That party can't be resumed from this device");
    return false;
  }

  const sb = getSupabase();
  // A host may still read their own rows directly under the new policy.
  const { data: party } = await sb.from("parties")
    .select("*").eq("join_code", joinCode).is("ended_at", null).maybeSingle();
  if (!party) { forgetParty(); showToast("That party has already ended"); return false; }

  const item = await lookupCatalogItem(party.content_id);
  if (!item) { showToast("That title isn't in the catalog any more"); return false; }

  const { resolveItemStream } = await import("./vod");
  const url = await resolveItemStream(item);
  if (!url) { showToast("That title can't be streamed right now"); return false; }

  await openVodPlayer(asPartyChannel(item, url, null), party.stream_idx || 0, 0);
  await hostExisting(joinCode);

  const { mountHostLobby } = await import("./party-setup");
  mountHostLobby(joinCode, partyLink(joinCode));
  (await import("./party-reactions")).mountReactions();
  // Already started, by definition -- the room existed before this. Re-announce
  // so anyone who joined while the host was away is let through rather than
  // left in a green room waiting on someone who has already begun.
  startPlayback();
  return true;
}


/** End a party the host is not currently connected to.
 *
 *  endParty() only works over a live socket. A host who closed the tab has no
 *  socket, so shutting the room down needs both halves: mark the row ended so
 *  nobody can look it up and join, and connect briefly to tell the Durable
 *  Object to disconnect whoever is still sitting in it. Without the second, the
 *  room stays open until the idle alarm fires five minutes later.
 */
export async function closeParty(joinCode: string): Promise<void> {
  try {
    await getSupabase().from("parties")
      .update({ ended_at: new Date().toISOString() })
      .eq("join_code", joinCode);
  } catch (e) { console.warn("[party] could not mark ended", e); }

  const token = readHostToken(joinCode);
  if (token && WORKER_URL) {
    try {
      await connect(joinCode, true);
      endParty();
    } catch { /* the row is already ended; the alarm will clear the object */ }
  }
  try { localStorage.removeItem(tokenKey(joinCode)); } catch {}
  forgetParty();
}


// ------------------------------------------------- host presence & absence ---

let hostAway = false;
// The host's position at the last emit attempt while backgrounded, used to
// tell a throttled tab that has genuinely frozen from one that is still
// playing perfectly well behind another window.
let lastAwayPos = -1;
let visHandler: (() => void) | null = null;

/** Tell viewers when the host's tab goes away, instead of letting a
 *  browser-forced pause propagate as a deliberate one.
 *
 *  This matters most on mobile, where iOS suspends timers and throttles sockets
 *  the moment the user switches apps or locks the screen -- a completely
 *  routine thing to do with a phone, and previously enough to stall a whole
 *  party on its last known position. */
function watchHostVisibility(): void {
  stopWatchingVisibility();
  visHandler = () => {
    const hidden = document.visibilityState === "hidden";
    if (hidden === hostAway) return;
    hostAway = hidden;
    lastAwayPos = -1;
    try { socket?.send(JSON.stringify({ type: hidden ? "away" : "back" })); } catch {}
    // On return, resume if the browser paused us while backgrounded. Without
    // this the host comes back paused and the next heartbeat stops everyone --
    // reintroducing the exact problem one beat later.
    if (!hidden) {
      void import("./vodplayer").then((m) => m.resumeIfBackgroundPaused());
    }
  };
  document.addEventListener("visibilitychange", visHandler);
}

function stopWatchingVisibility(): void {
  if (visHandler) document.removeEventListener("visibilitychange", visHandler);
  visHandler = null;
  hostAway = false;
}

let awayEl: HTMLElement | null = null;

/** Viewer-side notice. Deliberately quiet and non-blocking: the film is still
 *  playing, and this is information, not an interruption. */
function showHostAway(on: boolean): void {
  if (!on) { awayEl?.remove(); awayEl = null; return; }
  if (awayEl) return;
  awayEl = document.createElement("div");
  awayEl.id = "partyHostAway";
  awayEl.textContent = "The host stepped away. Still playing";
  document.body.appendChild(awayEl);
}


export interface PublicParty {
  join_code: string; title: string; content_id: string;
  host_user_id: string; seat_limit: number | null;
  started_at: string; joined_count: number;
  blurb: string | null; host_name: string | null;
  social_platform: string | null; social_handle: string | null;
}

/** Parties whose hosts chose to be listed. */
export async function listPublicParties(): Promise<PublicParty[]> {
  const { data, error } = await getSupabase().rpc("public_parties", { max_rows: 20 });
  if (error) { console.warn("[party] public list", error); return []; }
  return (data ?? []) as PublicParty[];
}


/** Whether this account may list another public party. Checked before the
 *  choice is offered rather than after it is made. */
export async function canListPublicParty(): Promise<{ ok: boolean; reason?: string }> {
  const { data, error } = await getSupabase().rpc("can_list_public_party");
  if (error) return { ok: true };   // guarded server-side regardless
  return (data as any) ?? { ok: true };
}

/** Signups attributable to one party -- what the host actually gets paid on,
 *  not a headcount of who turned up. */
export async function partySignups(partyId: string): Promise<number> {
  const { data, error } = await getSupabase().rpc("party_signups", { party: partyId });
  if (error) return 0;
  return Number(data) || 0;
}

/** Build a social URL from a platform and a handle. The handle is pattern
 *  checked in the database and the URL is assembled HERE, so no user-supplied
 *  link is ever rendered -- a disguised link or a redirect is not expressible. */
export function socialUrl(platform: string | null, handle: string | null): string | null {
  if (!platform || !handle) return null;
  const h = encodeURIComponent(handle);
  switch (platform) {
    case "discord":   return `https://discord.gg/${h}`;
    case "twitch":    return `https://twitch.tv/${h}`;
    case "youtube":   return `https://youtube.com/@${h}`;
    case "x":         return `https://x.com/${h}`;
    case "tiktok":    return `https://tiktok.com/@${h}`;
    case "instagram": return `https://instagram.com/${h}`;
    default:          return null;
  }
}


// -------------------------------------------------------------- reactions ---

/** The vocabulary, mirrored from the worker, which validates it again. A fixed
 *  set is the whole reason this is reactions and not chat: nothing targeted can
 *  be expressed, so there is nothing to moderate. */
export const REACTIONS = [
  { kind: "laugh", glyph: "\u{1F602}", label: "Funny" },
  { kind: "love",  glyph: "\u{2764}\u{FE0F}", label: "Love it" },
  { kind: "shock", glyph: "\u{1F631}", label: "No way" },
  { kind: "sad",   glyph: "\u{1F622}", label: "Sad" },
  { kind: "fire",  glyph: "\u{1F525}", label: "Fire" },
  { kind: "clap",  glyph: "\u{1F44F}", label: "Applause" },
] as const;

export function sendReaction(kind: string): void {
  try { socket?.send(JSON.stringify({ type: "react", kind })); } catch {}
}
