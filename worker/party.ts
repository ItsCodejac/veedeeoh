// Watch Party sync — Cloudflare Durable Object, one per party.
//
// Media never passes through here. This object relays a small JSON state blob
// over WebSocket; video streams from Pluto/Tubi/Archive straight to each viewer.
// Cloudflare bills requests and CPU time only -- data transfer is not metered --
// and the payload is ~80 bytes about twenty times an hour per party.
//
// The host is authoritative: viewers receive and reconcile, and never send
// playback commands. Each viewer resolves its OWN signed stream URL rather than
// receiving the host's -- Pluto JWTs are per-session and expire in 24h, so a
// shared URL would break for every viewer at once.
//
// HOST IDENTITY IS PROVEN, NOT CLAIMED. This used to read `?host=1` and believe
// it, so anyone holding a join code could connect as the host and drive
// playback for the whole room. The host now initialises the party over HTTP
// with a secret it generated, before the link is shared, and every later host
// connection must present the same secret. Init is one-shot: the first caller
// binds the party and a second init is refused, which closes the race where an
// attacker who learned the code could claim it first.
//
// USES THE HIBERNATION API. Two reasons, one of them correctness:
//   1. A Durable Object can be evicted at any time. Holding clients and state in
//      plain instance fields loses both on eviction. Hibernation forces state
//      into storage and sockets into the runtime's keeping, which is simply the
//      correct way to write this.
//   2. Cloudflare bills GB-s for time the object is resident. Per the docs,
//      "Billable Duration (GB-s) charges do not accrue during hibernation", so a
//      hibernated party costs nothing while nobody is touching the controls.
//      (Data transfer is never billed on Workers either way -- no egress.)
//
// Deploy: cd worker && npx wrangler deploy
// Free plan requires the SQLite backend -- see new_sqlite_classes in wrangler.toml.

import { DurableObject } from "cloudflare:workers";

export interface PartyState {
  contentId: string;
  streamIdx: number;
  positionSecs: number;
  paused: boolean;
  updatedAt: number;
}

interface Env {
  PARTY: DurableObjectNamespace;
  /** The Supabase project's JWT secret. Set with
   *  `wrangler secret put SUPABASE_JWT_SECRET`; never in wrangler.toml. */
  SUPABASE_JWT_SECRET?: string;
}

// ---------------------------------------------------------------------------
// Who is calling
// ---------------------------------------------------------------------------
//
// UNTIL NOW: NOBODY ASKED. The host was whoever presented the random hostToken
// their own browser generated, and every other identity -- the `uid` on the
// socket, the `uid` on /access, the `hostUserId` in the init body -- was a
// string the client chose. Three things followed from that:
//
//   Anyone could use this relay. Entitlement is checked in our client and in an
//   RLS policy on our database, both on the caller's side, so a self-hosted
//   instance pointing VITE_PARTY_WORKER_URL here got watch party hosting on our
//   Cloudflare account. CORS did not stop it: the allowlist takes any
//   *.vercel.app, and a WebSocket upgrade ignores CORS entirely.
//
//   Removal was cosmetic. The ban list is keyed on `uid`, and `uid` came from
//   the query string, so somebody removed for conduct rejoined by sending a
//   different one.
//
//   A party could be bound to someone else's user id.
//
// Verifying the token fixes all three at once, and fixes the first one exactly:
// a self-hoster's users hold tokens signed by THEIR project secret, which do
// not verify against ours. No allowlist to maintain.
//
// HS256, which is what Supabase issues, so this is an HMAC check against the
// project secret rather than a fetch. No round trip on the hot path.

interface Caller { sub: string; role: string }

function b64urlToBytes(s: string): Uint8Array<ArrayBuffer> {
  const pad = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(pad + "=".repeat((4 - (pad.length % 4)) % 4));
  // Backed by a concrete ArrayBuffer so it satisfies BufferSource; the default
  // Uint8Array type admits SharedArrayBuffer, which crypto.subtle will not take.
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Verify a Supabase access token and return who it belongs to.
 *
 *  Null for anything that does not check out: wrong signature, expired, or
 *  malformed. Also null when no secret is configured, which fails CLOSED --
 *  a relay that cannot tell who is calling should refuse rather than guess,
 *  and a missing secret is a deployment mistake that ought to be loud. */
async function verifyCaller(token: string, secret?: string): Promise<Caller | null> {
  if (!token || !secret) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [h, p, sig] = parts as [string, string, string];

  try {
    const header = JSON.parse(new TextDecoder().decode(b64urlToBytes(h)));
    if (header.alg !== "HS256") return null;

    const key = await crypto.subtle.importKey(
      "raw", new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" }, false, ["verify"],
    );
    const ok = await crypto.subtle.verify(
      "HMAC", key, b64urlToBytes(sig), new TextEncoder().encode(`${h}.${p}`),
    );
    if (!ok) return null;

    const claims = JSON.parse(new TextDecoder().decode(b64urlToBytes(p)));
    if (typeof claims.exp === "number" && claims.exp * 1000 <= Date.now()) return null;
    if (!claims.sub) return null;              // the anon key has no sub
    return { sub: String(claims.sub), role: String(claims.role || "") };
  } catch {
    return null;
  }
}

interface Attachment {
  isHost: boolean;
  userId: string;
  name: string;
  /** Set once the host lets them in. A pending socket is connected but receives
   *  no state, so it cannot watch along while it waits. */
  approved: boolean;
}

interface Config {
  seatLimit: number | null;
  hostUserId: string;
  hostToken: string;
  requireApproval: boolean;
  createdAt: number;
  /** Set once the host presses play. Persisted rather than held in memory so a
   *  guest arriving after the object was evicted still learns the party is
   *  already running, instead of sitting in a lobby that will never open. */
  started?: boolean;
}

const STATE_KEY = "state";
const CONFIG_KEY = "config";
// Everyone the host has let in, by user id. Persisted because approval is a
// decision about a PERSON, not about a socket: a viewer who reloads, loses
// signal for a moment, or switches from wifi to cellular is the same person
// the host already approved, and making them queue again -- while the film
// runs on without them -- turns one decision into an interruption for both
// of them every time a connection blips.
const ADMITTED_KEY = "admitted";
// Removed by the host. Kicking was a revolving door: nothing stopped the
// person reconnecting a second later, and in an open party there was no
// approval step to stop them at either. A kick has to mean something or it
// is not moderation.
const BANNED_KEY = "banned";

// WebSocket upgrades are exempt from CORS, so the object needed none until
// /init arrived -- a fetch() with a JSON content-type is not a simple request,
// so the browser sends an OPTIONS preflight first and refuses the POST when it
// comes back bare. Same trap that broke /proxy earlier: the WS path worked, so
// the missing preflight only surfaced on the one endpoint that is plain HTTP.
//
// Restricted rather than "*": /init carries the secret that makes a connection
// the host's, so no unrelated origin should be able to post one.
const ALLOWED_ORIGINS = [
  "https://veedeeoh.com",
  "https://www.veedeeoh.com",
  "http://localhost:5173",
  "http://localhost:5199",
];

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin") || "";
  const ok = ALLOWED_ORIGINS.includes(origin) || /^https:\/\/[a-z0-9-]+\.vercel\.app$/.test(origin);
  return {
    "Access-Control-Allow-Origin": ok ? origin : ALLOWED_ORIGINS[0]!,
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

// How long an idle party lives before it closes itself. A host who shuts the
// laptop without ending the party would otherwise leave the object alive
// indefinitely -- and once hosting is metered, silently spending the host's
// credits on an empty room. Checked by alarm rather than a timer, because a
// timer does not survive eviction.
// The complete vocabulary. Deliberately small: a set this size cannot be used
// to say anything targeted, which is the entire reason reactions were chosen
// over chat.
const REACTIONS = ["laugh", "love", "shock", "sad", "fire", "clap"];

// Why someone was removed, softest first, and whether it shuts the door behind
// them. Removal was one undifferentiated act that always meant "never come
// back" -- so a host with a guest whose connection kept dying had the same
// blunt instrument as one dealing with someone behaving badly, and the person
// on the other end was told nothing at all about which had just happened.
//
// An allowlist here rather than free text from the host, for the same reason
// reactions are: this string is shown to another person under veedeeoh's name,
// and a box the host can type anything into is a box for abuse. The ban is
// derived from the reason server-side so the two can never disagree.
const KICK_REASONS: Record<string, { text: string; ban: boolean }> = {
  technical: { text: "Connection trouble", ban: false },
  space:     { text: "Making room for someone else", ban: false },
  fit:       { text: "Not the right fit for this party", ban: true },
  conduct:   { text: "Behaviour in the party", ban: true },
};

const IDLE_CLOSE_MS = 5 * 60 * 1000;
const ALARM_EVERY_MS = 60 * 1000;

export class Party extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const cors = corsHeaders(req);

    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    // ---- host binds the party, before the link is shared -------------------
    if (url.pathname.endsWith("/init")) {
      if (req.method !== "POST") return new Response("POST only", { status: 405, headers: cors });
      const body = await req.json().catch(() => null) as any;
      const token = String(body?.hostToken || "");
      if (token.length < 20) return new Response("bad token", { status: 400, headers: cors });

      // Who is starting this. hostUserId used to be read straight out of the
      // body, so a party could be bound to somebody else's id.
      const caller = await verifyCaller(String(body?.accessToken || ""), this.env.SUPABASE_JWT_SECRET);
      if (!caller) return new Response("not signed in", { status: 401, headers: cors });

      const existing = await this.ctx.storage.get<Config>(CONFIG_KEY);
      // One-shot. A second init cannot re-bind a party to a different host,
      // which is what would let someone steal a room mid-session.
      if (existing) return new Response("already initialised", { status: 409, headers: cors });

      const seats = Number(body?.seatLimit);
      await this.ctx.storage.put<Config>(CONFIG_KEY, {
        seatLimit: Number.isFinite(seats) && seats > 0 ? seats : null,
        hostUserId: caller.sub,
        hostToken: token,
        requireApproval: body?.requireApproval !== false,
        createdAt: Date.now(),
      });
      await this.ctx.storage.setAlarm(Date.now() + ALARM_EVERY_MS);
      return Response.json({ ok: true }, { headers: cors });
    }

    // ---- why a join failed -------------------------------------------------
    //
    // A rejected WebSocket upgrade has no socket, so it has no close code
    // either: every reason -- the room is gone, you were removed, it is full,
    // your wifi dropped -- arrives at the browser as the same silent failure.
    // The client used to guess, and guessed "that party has ended" at everyone,
    // which is a lie to someone the host removed and to anyone whose network
    // blinked.
    //
    // Deliberately says nothing about the party itself: no title, no position,
    // no headcount. Only whether this one person can get in, which is the
    // question being asked.
    if (url.pathname.endsWith("/access")) {
      // IDENTITY FIRST, before saying whether the party exists.
      //
      // The "gone" check used to come first, so an unauthenticated request got
      // {"status":"gone"} with a 200 and a live code got something else. That
      // is an oracle: anyone could walk join codes and learn which ones are
      // real without holding an account. Six characters is two billion
      // combinations, so it is slow rather than free -- but a free endpoint
      // that answers the question at all is the wrong shape, and it is the
      // only endpoint here that would answer it.
      //
      // Caught by probing the deployed worker rather than by reading this: it
      // returned 200 where I expected 401.
      const asker = await verifyCaller(url.searchParams.get("jwt") || "", this.env.SUPABASE_JWT_SECRET);
      if (!asker) return Response.json({ status: "unauthorised" }, { status: 401, headers: cors });

      const config = await this.ctx.storage.get<Config>(CONFIG_KEY);
      if (!config) return Response.json({ status: "gone" }, { headers: cors });

      // The ban list is keyed on this, so a client-supplied value made removal
      // a formality.
      const who = asker.sub;
      const bans = (await this.ctx.storage.get<string[]>(BANNED_KEY)) ?? [];
      if (who !== "" && bans.includes(who)) {
        return Response.json({ status: "removed" }, { headers: cors });
      }
      if (config.seatLimit != null && this.viewerCount() >= config.seatLimit) {
        return Response.json({ status: "full" }, { headers: cors });
      }
      return Response.json({ status: "ok" }, { headers: cors });
    }

    if (url.pathname.endsWith("/state")) {
      const state = await this.ctx.storage.get<PartyState>(STATE_KEY);
      return Response.json({ state: state ?? null, viewers: this.viewerCount() }, { headers: cors });
    }

    if (req.headers.get("Upgrade") !== "websocket") {
      return new Response("expected websocket", { status: 426 });
    }

    const config = await this.ctx.storage.get<Config>(CONFIG_KEY);
    if (!config) return new Response("party not started", { status: 404 });

    const token = url.searchParams.get("t") || "";
    const name = (url.searchParams.get("name") || "Guest").slice(0, 40);

    // A browser cannot set headers on a WebSocket upgrade, so the access token
    // rides in the query string. Supabase access tokens are short-lived, which
    // is the mitigation for it appearing in a log line.
    const caller = await verifyCaller(url.searchParams.get("jwt") || "", this.env.SUPABASE_JWT_SECRET);
    if (!caller) return new Response("not signed in", { status: 401 });
    const userId = caller.sub;


    // The ONLY way to be the host: present the secret the party was bound with.
    // Constant-time is unnecessary here (the token is 256 bits of randomness and
    // an attacker gets no oracle), but the comparison must be against the stored
    // value rather than a client-supplied flag.
    const isHost = token !== "" && token === config.hostToken;

    if (!isHost && config.seatLimit != null && this.viewerCount() >= config.seatLimit) {
      return new Response("party full", { status: 409 });
    }

    // BEFORE the pair is created. This used to run after acceptWebSocket, so a
    // removed guest had a socket accepted and then got a 403 for it -- the
    // response is what the browser sees, but the accepted server side was left
    // dangling. Checked here as well as in /access because /access is advisory:
    // a client that skips it goes straight to the upgrade.
    const banned = (await this.ctx.storage.get<string[]>(BANNED_KEY)) ?? [];
    if (!isHost && banned.includes(userId)) {
      return new Response("removed from this party", { status: 403 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];

    this.ctx.acceptWebSocket(server);

    // A guest starts UNAPPROVED when the host asked for approval. They hold an
    // open socket but receive no state, so waiting in the lobby is not a way to
    // watch for free. Someone the host has ALREADY admitted goes straight back
    // in: they are not a new arrival, they are the same guest reconnecting.
    const admitted = (await this.ctx.storage.get<string[]>(ADMITTED_KEY)) ?? [];
    const approved = isHost || !config.requireApproval
      || (userId !== "" && admitted.includes(userId));
    server.serializeAttachment({ isHost, userId, name, approved } satisfies Attachment);

    if (approved) {
      // A late joiner needs both: "the film has begun" and where it is up to.
      if (config.started) server.send(JSON.stringify({ type: "start" }));
      const state = await this.ctx.storage.get<PartyState>(STATE_KEY);
      if (state) server.send(JSON.stringify({ type: "state", state, serverNow: Date.now() }));
    } else {
      server.send(JSON.stringify({ type: "pending" }));
      this.sendToHost({ type: "knock", userId, name });
    }

    this.broadcastPresence();
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    const att = ws.deserializeAttachment() as Attachment | null;
    let msg: any;
    try { msg = JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw)); } catch { return; }
    if (!att) return;

    // ---- host admits or refuses a waiting guest ----------------------------
    if (msg?.type === "admit" || msg?.type === "refuse") {
      if (!att.isHost) return;           // only the host decides
      const target = String(msg.userId || "");
      const closing = new Set<WebSocket>();
      for (const sock of this.ctx.getWebSockets()) {
        const a = sock.deserializeAttachment() as Attachment | null;
        if (!a || a.isHost || a.userId !== target || a.approved) continue;

        if (msg.type === "refuse") {
          closing.add(sock);
          try { sock.send(JSON.stringify({ type: "refused" })); sock.close(4003, "refused"); } catch {}
          continue;
        }
        sock.serializeAttachment({ ...a, approved: true });
        // Remembered, so a reload does not put them back in the queue. Capped:
        // this is a party, not a mailing list, and an unbounded array in
        // storage is a slow leak.
        if (a.userId) {
          const list = (await this.ctx.storage.get<string[]>(ADMITTED_KEY)) ?? [];
          if (!list.includes(a.userId)) {
            await this.ctx.storage.put(ADMITTED_KEY, [...list, a.userId].slice(-200));
          }
        }
        const cfg = await this.ctx.storage.get<Config>(CONFIG_KEY);
        const state = await this.ctx.storage.get<PartyState>(STATE_KEY);
        try {
          sock.send(JSON.stringify({ type: "admitted" }));
          // Admitted mid-film: send them straight in rather than into a lobby
          // that has already been left behind.
          if (cfg?.started) sock.send(JSON.stringify({ type: "start" }));
          if (state) sock.send(JSON.stringify({ type: "state", state, serverNow: Date.now() }));
        } catch {}
      }
      this.broadcastPresence(closing);
      return;
    }

    // Host removes someone already admitted. Approval covers who gets IN; this
    // covers changing your mind, which is the other half of moderating a room
    // you are responsible for.
    if (msg?.type === "kick") {
      if (!att.isHost) return;
      const target = String(msg.userId || "");
      const reason = KICK_REASONS[String(msg.reason || "")] ?? KICK_REASONS.fit!;

      if (target) {
        // Only the harder reasons close the door. A guest dropped for a bad
        // connection who then cannot get back in has been punished for their
        // wifi, which is not what the host meant.
        if (reason.ban) {
          const bans = (await this.ctx.storage.get<string[]>(BANNED_KEY)) ?? [];
          if (!bans.includes(target)) {
            await this.ctx.storage.put(BANNED_KEY, [...bans, target].slice(-200));
          }
        }
        // Admission is revoked either way: coming back means asking again,
        // which is what gives the host the chance to say no a second time.
        const list = (await this.ctx.storage.get<string[]>(ADMITTED_KEY)) ?? [];
        await this.ctx.storage.put(ADMITTED_KEY, list.filter((u) => u !== target));
      }

      const closing = new Set<WebSocket>();
      for (const sock of this.ctx.getWebSockets()) {
        const a = sock.deserializeAttachment() as Attachment | null;
        if (!a || a.isHost || a.userId !== target) continue;
        closing.add(sock);
        try {
          sock.send(JSON.stringify({
            type: "removed", reason: String(msg.reason || "fit"),
            text: reason.text, canReturn: !reason.ban,
          }));
          sock.close(4004, "removed");
        } catch { /* already gone */ }
      }
      this.broadcastPresence(closing);
      return;
    }

    // The host stepped away or came back. Deliberately NOT a pause: a pause is
    // a command and stops everyone, while a host backgrounding a tab, crashing
    // or losing wifi is an absence. Viewers keep playing through an absence --
    // stopping a room of people because one person's phone rang is the wrong
    // default, and they are all playing the same content at the same rate, so
    // they stay together until the host returns and corrects them.
    if (msg?.type === "away" || msg?.type === "back") {
      if (!att.isHost) return;
      this.broadcast({ type: msg.type }, ws, true);
      return;
    }

    // Reactions. A FIXED SET, chosen from an allowlist here rather than trusted
    // from the client: the whole safety property of reactions over chat is that
    // nothing arbitrary can be expressed, and that only holds if the server
    // decides what is expressible.
    //
    // Not persisted. A reaction is a moment, not a record -- there is nothing
    // to moderate afterwards, nothing to leak, and a late joiner has no reason
    // to see what people felt about a scene they missed.
    if (msg?.type === "react") {
      if (!att.approved) return;          // the lobby is not a room
      const kind = String(msg.kind || "");
      if (!REACTIONS.includes(kind)) return;
      this.broadcast({ type: "react", kind, name: att.name }, undefined, true);
      return;
    }

    // ---- a viewer checking it is still with the host ----------------------
    //
    // Everything else here is push. That is fine while the host is talking, but
    // a viewer that only ever receives cannot tell "the host has not moved" from
    // "I have stopped hearing the host" -- and between heartbeats it is running
    // on an extrapolation nothing has confirmed. A half-open socket, which is
    // ordinary on mobile, produces no close event at all: the viewer keeps
    // playing a guess indefinitely and believes it is in sync.
    //
    // So the viewer asks. The reply is the stored state plus the server's clock,
    // which is what lets the viewer work out how OLD that state is rather than
    // treating it as current. Answered from storage without waking the host, and
    // sent only to the socket that asked.
    if (msg?.type === "sync") {
      if (!att.approved) return;          // the lobby is not a room
      const state = await this.ctx.storage.get<PartyState>(STATE_KEY);
      try {
        ws.send(JSON.stringify({ type: "state", state: state ?? null, serverNow: Date.now() }));
      } catch { /* socket went away mid-reply */ }
      return;
    }

    // ---- the host moves the room on to something else ----------------------
    //
    // Everything else about a party assumed one title for its whole life: the
    // content id was fixed when the room was created and only the episode index
    // ever moved. A film ending therefore ended the evening -- the socket stayed
    // open with nothing playing and no way to choose together, so the only way
    // on was to end the party and rebuild it, losing the room and the people in
    // it to do it.
    //
    // The content id travels here, and ONLY here. Ordinary playback heartbeats
    // still omit it: a viewer resolves their own stream for a title, because a
    // Pluto URL is signed per session, so what has to be shared is which title
    // it is -- not how the host is watching it.
    if (msg?.type === "switch") {
      if (!att.isHost) return;
      const contentId = String(msg.contentId || "");
      if (!contentId) return;

      // Position resets rather than carrying over. The old position means
      // nothing in a different title, and anything but zero would seek every
      // viewer into the middle of something they have not started.
      const state: PartyState = {
        contentId,
        streamIdx: Number(msg.streamIdx) || 0,
        positionSecs: 0,
        paused: false,
        updatedAt: Date.now(),
      };
      await this.ctx.storage.put(STATE_KEY, state);
      this.broadcast({
        type: "switch",
        contentId,
        streamIdx: state.streamIdx,
        title: String(msg.title || "").slice(0, 120),
      }, ws, true);
      return;
    }

    // Host opens the doors. Until this lands, an approved guest sits in the
    // lobby holding a socket and receives no playback state at all.
    if (msg?.type === "start") {
      if (!att.isHost) return;
      const config = await this.ctx.storage.get<Config>(CONFIG_KEY);
      if (config && !config.started) {
        await this.ctx.storage.put<Config>(CONFIG_KEY, { ...config, started: true });
      }
      this.broadcast({ type: "start" }, ws, true);
      return;
    }

    if (msg?.type === "end") {
      if (!att.isHost) return;
      await this.closeParty("ended by host");
      return;
    }

    // Only the host drives playback. A viewer sending state is ignored rather
    // than trusted, so a modified client cannot hijack playback for everyone.
    if (msg?.type !== "state" || !att.isHost || !msg.state) return;

    // The heartbeat omits contentId deliberately -- viewers resolve their own
    // stream -- so it must not blank the one a switch put there, or the stored
    // state stops saying what the room is watching one beat after it changed.
    const prev = await this.ctx.storage.get<PartyState>(STATE_KEY);
    const state: PartyState = {
      contentId: String(msg.state.contentId || prev?.contentId || ""),
      streamIdx: Number(msg.state.streamIdx) || 0,
      positionSecs: Number(msg.state.positionSecs) || 0,
      paused: !!msg.state.paused,
      updatedAt: Date.now(),
    };
    await this.ctx.storage.put(STATE_KEY, state);
    // Unapproved sockets are skipped: a guest in the lobby must not receive
    // playback position, or the lobby becomes a free seat.
    this.broadcast({ type: "state", state, serverNow: Date.now() }, ws, true);
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    const att = ws.deserializeAttachment() as Attachment | null;
    try { ws.close(); } catch { /* already closed */ }

    // The host's socket dropping is the same class of event as backgrounding:
    // tell viewers, do not stop them. The party is not over -- the host may be
    // reconnecting, and the idle alarm will close the room if they are not.
    if (att?.isHost) this.broadcast({ type: "away" }, ws, true);

    // Excluded for the same reason as a kick: this socket is on its way out but
    // may still be listed, and counting it leaves a ghost in the roster.
    this.broadcastPresence(new Set([ws]));
  }

  /** Closes a party that everyone has left. Runs on a timer rather than on the
   *  last disconnect, so a viewer who reloads does not kill the room. */
  async alarm(): Promise<void> {
    const live = this.ctx.getWebSockets().length;
    if (live > 0) {
      await this.ctx.storage.setAlarm(Date.now() + ALARM_EVERY_MS);
      return;
    }
    const config = await this.ctx.storage.get<Config>(CONFIG_KEY);
    const state = await this.ctx.storage.get<PartyState>(STATE_KEY);
    const lastSeen = Math.max(state?.updatedAt ?? 0, config?.createdAt ?? 0);
    if (Date.now() - lastSeen < IDLE_CLOSE_MS) {
      await this.ctx.storage.setAlarm(Date.now() + ALARM_EVERY_MS);
      return;
    }
    await this.closeParty("idle");
  }

  private async closeParty(reason: string): Promise<void> {
    for (const ws of this.ctx.getWebSockets()) {
      try { ws.send(JSON.stringify({ type: "closed", reason })); ws.close(1000, reason); } catch {}
    }
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
  }

  /** Approved, non-host sockets. The lobby does not count toward the seat
   *  limit -- a seat is a person watching, not a person waiting. */
  private viewerCount(): number {
    let n = 0;
    for (const ws of this.ctx.getWebSockets()) {
      const att = ws.deserializeAttachment() as Attachment | null;
      if (att && !att.isHost && att.approved) n++;
    }
    return n;
  }

  private broadcast(payload: unknown, except?: WebSocket, approvedOnly = false): void {
    const data = JSON.stringify(payload);
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === except) continue;
      if (approvedOnly) {
        const a = ws.deserializeAttachment() as Attachment | null;
        if (!a?.approved) continue;
      }
      try { ws.send(data); } catch { /* dropped; runtime will fire close */ }
    }
  }

  private sendToHost(payload: unknown): void {
    const data = JSON.stringify(payload);
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment() as Attachment | null;
      if (a?.isHost) { try { ws.send(data); } catch {} }
    }
  }

  /** @param closing sockets this request has just closed.
   *
   *  THE REASON THIS PARAMETER EXISTS. close() does not remove a socket from
   *  getWebSockets() synchronously, so a roster built immediately after a kick
   *  still contains the person who was kicked. The name therefore stayed on the
   *  host's list until some later event rebuilt it -- which, in practice, meant
   *  removing somebody else. The host pressed the button, nothing happened, and
   *  the only evidence it had worked arrived minutes later.
   */
  private broadcastPresence(closing?: Set<WebSocket>): void {
    const waiting: Array<{ userId: string; name: string }> = [];
    const watching: Array<{ userId: string; name: string }> = [];
    for (const ws of this.ctx.getWebSockets()) {
      if (closing?.has(ws)) continue;
      const a = ws.deserializeAttachment() as Attachment | null;
      if (!a || a.isHost) continue;
      (a.approved ? watching : waiting).push({ userId: a.userId, name: a.name });
    }
    // Everyone gets the count; only the host gets the names. A guest has no
    // business enumerating the other guests.
    this.broadcast({ type: "presence", viewers: watching.length });
    this.sendToHost({ type: "roster", watching, waiting });
  }
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const code = new URL(req.url).searchParams.get("party");
    if (!code) return new Response("missing party code", { status: 400 });
    // One object per party, addressed by join code.
    const id = env.PARTY.idFromName(code);
    return env.PARTY.get(id).fetch(req);
  },
};
