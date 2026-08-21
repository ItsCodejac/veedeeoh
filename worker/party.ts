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
}

const STATE_KEY = "state";
const CONFIG_KEY = "config";

// Must extend DurableObject for the hibernation handlers to be invoked.
export class Party extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);

    if (url.pathname.endsWith("/state")) {
      const state = await this.ctx.storage.get<PartyState>(STATE_KEY);
      return Response.json({ state: state ?? null, viewers: this.viewerCount() });
    }

    if (req.headers.get("Upgrade") !== "websocket") {
      return new Response("expected websocket", { status: 426 });
    }

    const isHost = url.searchParams.get("host") === "1";
    const userId = url.searchParams.get("uid") || "";
    const seatParam = Number(url.searchParams.get("seats"));
    const seatLimit = Number.isFinite(seatParam) && seatParam > 0 ? seatParam : null;

    // Config is written by the host's connection and survives eviction.
    if (isHost) await this.ctx.storage.put(CONFIG_KEY, { seatLimit, hostUserId: userId });
    const config = await this.ctx.storage.get<{ seatLimit: number | null }>(CONFIG_KEY);

    // Seat limits are enforced HERE because this is the only component that
    // knows the live connection count. A row count in Postgres cannot.
    if (!isHost && config?.seatLimit != null && this.viewerCount() >= config.seatLimit) {
      return new Response("party full", { status: 409 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];

    // acceptWebSocket, not accept: this hands the socket to the runtime so the
    // object can be evicted while the connection stays open.
    this.ctx.acceptWebSocket(server);
    // Role travels on the attachment rather than a socket tag: attachments are
    // documented and survive eviction, and tag filtering is not.
    server.serializeAttachment({ isHost, userId } satisfies Attachment);

    // A late joiner lands at the right position immediately, mid-film.
    const state = await this.ctx.storage.get<PartyState>(STATE_KEY);
    if (state) server.send(JSON.stringify({ type: "state", state }));
    this.broadcastPresence();

    return new Response(null, { status: 101, webSocket: client });
  }

  // Hibernation delivers messages here rather than to an addEventListener
  // closure, because no closure survives eviction.
  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    const att = ws.deserializeAttachment() as Attachment | null;
    let msg: any;
    try { msg = JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw)); } catch { return; }

    // Only the host drives playback. A viewer sending state is ignored rather
    // than trusted, so a modified client cannot hijack playback for everyone.
    if (msg?.type !== "state" || !att?.isHost || !msg.state) return;

    const state: PartyState = {
      contentId: String(msg.state.contentId || ""),
      streamIdx: Number(msg.state.streamIdx) || 0,
      positionSecs: Number(msg.state.positionSecs) || 0,
      paused: !!msg.state.paused,
      updatedAt: Date.now(),
    };
    await this.ctx.storage.put(STATE_KEY, state);
    this.broadcast({ type: "state", state }, ws);
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    try { ws.close(); } catch { /* already closed */ }
    this.broadcastPresence();
  }

  /** Live sockets come from the runtime, not an in-memory Set, so the count is
   *  correct on the first message after the object was evicted. Roles are read
   *  back from each socket's attachment. */
  private viewerCount(): number {
    let n = 0;
    for (const ws of this.ctx.getWebSockets()) {
      const att = ws.deserializeAttachment() as Attachment | null;
      if (!att?.isHost) n++;
    }
    return n;
  }

  private broadcast(payload: unknown, except?: WebSocket): void {
    const data = JSON.stringify(payload);
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === except) continue;
      try { ws.send(data); } catch { /* dropped; runtime will fire close */ }
    }
  }

  private broadcastPresence(): void {
    this.broadcast({ type: "presence", viewers: this.viewerCount() });
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
