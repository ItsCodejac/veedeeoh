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
}

const STATE_KEY = "state";
const CONFIG_KEY = "config";

// How long an idle party lives before it closes itself. A host who shuts the
// laptop without ending the party would otherwise leave the object alive
// indefinitely -- and once hosting is metered, silently spending the host's
// credits on an empty room. Checked by alarm rather than a timer, because a
// timer does not survive eviction.
const IDLE_CLOSE_MS = 5 * 60 * 1000;
const ALARM_EVERY_MS = 60 * 1000;

export class Party extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);

    // ---- host binds the party, before the link is shared -------------------
    if (url.pathname.endsWith("/init")) {
      if (req.method !== "POST") return new Response("POST only", { status: 405 });
      const body = await req.json().catch(() => null) as any;
      const token = String(body?.hostToken || "");
      if (token.length < 20) return new Response("bad token", { status: 400 });

      const existing = await this.ctx.storage.get<Config>(CONFIG_KEY);
      // One-shot. A second init cannot re-bind a party to a different host,
      // which is what would let someone steal a room mid-session.
      if (existing) return new Response("already initialised", { status: 409 });

      const seats = Number(body?.seatLimit);
      await this.ctx.storage.put<Config>(CONFIG_KEY, {
        seatLimit: Number.isFinite(seats) && seats > 0 ? seats : null,
        hostUserId: String(body?.hostUserId || ""),
        hostToken: token,
        requireApproval: body?.requireApproval !== false,
        createdAt: Date.now(),
      });
      await this.ctx.storage.setAlarm(Date.now() + ALARM_EVERY_MS);
      return Response.json({ ok: true });
    }

    if (url.pathname.endsWith("/state")) {
      const state = await this.ctx.storage.get<PartyState>(STATE_KEY);
      return Response.json({ state: state ?? null, viewers: this.viewerCount() });
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
    // watch for free.
    const approved = isHost || !config.requireApproval;
    server.serializeAttachment({ isHost, userId, name, approved } satisfies Attachment);

    if (approved) {
      const state = await this.ctx.storage.get<PartyState>(STATE_KEY);
      if (state) server.send(JSON.stringify({ type: "state", state }));
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
        const state = await this.ctx.storage.get<PartyState>(STATE_KEY);
        try {
          sock.send(JSON.stringify({ type: "admitted" }));
          if (state) sock.send(JSON.stringify({ type: "state", state }));
        } catch {}
      }
      this.broadcastPresence();
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
    this.broadcast({ type: "state", state }, ws, true);
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    try { ws.close(); } catch { /* already closed */ }
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
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment() as Attachment | null;
      if (a && !a.isHost && !a.approved) waiting.push({ userId: a.userId, name: a.name });
    }
    this.broadcast({ type: "presence", viewers: this.viewerCount() });
    if (waiting.length) this.sendToHost({ type: "waiting", waiting });
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
