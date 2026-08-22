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

      const existing = await this.ctx.storage.get<Config>(CONFIG_KEY);
      // One-shot. A second init cannot re-bind a party to a different host,
      // which is what would let someone steal a room mid-session.
      if (existing) return new Response("already initialised", { status: 409, headers: cors });

      const seats = Number(body?.seatLimit);
      await this.ctx.storage.put<Config>(CONFIG_KEY, {
        seatLimit: Number.isFinite(seats) && seats > 0 ? seats : null,
        hostUserId: String(body?.hostUserId || ""),
        hostToken: token,
        requireApproval: body?.requireApproval !== false,
        createdAt: Date.now(),
      });
      await this.ctx.storage.setAlarm(Date.now() + ALARM_EVERY_MS);
      return Response.json({ ok: true }, { headers: cors });
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
    const userId = url.searchParams.get("uid") || "";
    const name = (url.searchParams.get("name") || "Guest").slice(0, 40);

    // The ONLY way to be the host: present the secret the party was bound with.
    // Constant-time is unnecessary here (the token is 256 bits of randomness and
    // an attacker gets no oracle), but the comparison must be against the stored
    // value rather than a client-supplied flag.
    const isHost = token !== "" && token === config.hostToken;

    if (!isHost && config.seatLimit != null && this.viewerCount() >= config.seatLimit) {
      return new Response("party full", { status: 409 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];

    this.ctx.acceptWebSocket(server);

    // A guest starts UNAPPROVED when the host asked for approval. They hold an
    // open socket but receive no state, so waiting in the lobby is not a way to
    // watch for free. Someone the host has ALREADY admitted goes straight back
    // in: they are not a new arrival, they are the same guest reconnecting.
    const banned = (await this.ctx.storage.get<string[]>(BANNED_KEY)) ?? [];
    if (!isHost && userId !== "" && banned.includes(userId)) {
      return new Response("removed from this party", { status: 403 });
    }

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
      for (const sock of this.ctx.getWebSockets()) {
        const a = sock.deserializeAttachment() as Attachment | null;
        if (!a || a.isHost || a.userId !== target || a.approved) continue;

        if (msg.type === "refuse") {
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
      this.broadcastPresence();
      return;
    }

    // Host removes someone already admitted. Approval covers who gets IN; this
    // covers changing your mind, which is the other half of moderating a room
    // you are responsible for.
    if (msg?.type === "kick") {
      if (!att.isHost) return;
      const target = String(msg.userId || "");
      if (target) {
        const bans = (await this.ctx.storage.get<string[]>(BANNED_KEY)) ?? [];
        if (!bans.includes(target)) {
          await this.ctx.storage.put(BANNED_KEY, [...bans, target].slice(-200));
        }
        const list = (await this.ctx.storage.get<string[]>(ADMITTED_KEY)) ?? [];
        await this.ctx.storage.put(ADMITTED_KEY, list.filter((u) => u !== target));
      }
      for (const sock of this.ctx.getWebSockets()) {
        const a = sock.deserializeAttachment() as Attachment | null;
        if (!a || a.isHost || a.userId !== target) continue;
        try { sock.send(JSON.stringify({ type: "removed" })); sock.close(4004, "removed"); } catch {}
      }
      this.broadcastPresence();
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

    const state: PartyState = {
      contentId: String(msg.state.contentId || ""),
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

    this.broadcastPresence();
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

  private broadcastPresence(): void {
    const waiting: Array<{ userId: string; name: string }> = [];
    const watching: Array<{ userId: string; name: string }> = [];
    for (const ws of this.ctx.getWebSockets()) {
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
