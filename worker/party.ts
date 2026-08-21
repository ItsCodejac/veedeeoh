// Watch Party sync — Cloudflare Durable Object, one per party.
//
// Media never passes through here. The object relays a small JSON state blob
// over WebSocket, roughly 20 messages an hour per party; video streams from
// Pluto/Tubi/Archive straight to each viewer. That is why v1 costs nothing in
// egress and why R2 is irrelevant until uploads exist.
//
// The host is authoritative: viewers receive and reconcile, and never send
// playback commands. Each viewer resolves its OWN signed stream URL rather than
// receiving the host's -- Pluto JWTs are per-session and expire in 24h, so a
// shared URL would break for every viewer simultaneously.
//
// Deploy: wrangler deploy (needs the paid Workers plan; Durable Objects are not
// on the free tier).

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

type Client = { socket: WebSocket; isHost: boolean; userId: string };

export class Party {
  private state: PartyState | null = null;
  private clients = new Set<Client>();
  private seatLimit: number | null = null;
  private hostUserId: string | null = null;

  constructor(private ctx: DurableObjectState, private env: Env) {}

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);

    if (url.pathname.endsWith("/state")) {
      return Response.json({ state: this.state, viewers: this.clients.size, seatLimit: this.seatLimit });
    }

    if (req.headers.get("Upgrade") !== "websocket") {
      return new Response("expected websocket", { status: 426 });
    }

    const isHost = url.searchParams.get("host") === "1";
    const userId = url.searchParams.get("uid") || "";
    const seatLimit = Number(url.searchParams.get("seats")) || null;
    if (seatLimit) this.seatLimit = seatLimit;
    if (isHost) this.hostUserId = userId;

    // Seat limits are enforced HERE because this is the only component that
    // knows the live connection count. A row count in Postgres cannot.
    const viewers = [...this.clients].filter((c) => !c.isHost).length;
    if (!isHost && this.seatLimit !== null && viewers >= this.seatLimit) {
      return new Response("party full", { status: 409 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
    server.accept();

    const entry: Client = { socket: server, isHost, userId };
    this.clients.add(entry);

    // A late joiner lands at the right position immediately, mid-film.
    if (this.state) server.send(JSON.stringify({ type: "state", state: this.state }));
    this.broadcastPresence();

    server.addEventListener("message", (evt: MessageEvent) => {
      let msg: any;
      try { msg = JSON.parse(String(evt.data)); } catch { return; }

      // Only the host drives playback. A viewer sending state is ignored rather
      // than trusted, so a modified client cannot hijack everyone's playback.
      if (msg?.type === "state" && entry.isHost && msg.state) {
        this.state = {
          contentId: String(msg.state.contentId || ""),
          streamIdx: Number(msg.state.streamIdx) || 0,
          positionSecs: Number(msg.state.positionSecs) || 0,
          paused: !!msg.state.paused,
          updatedAt: Date.now(),
        };
        this.broadcast({ type: "state", state: this.state }, entry);
      }
    });

    const drop = () => { this.clients.delete(entry); this.broadcastPresence(); };
    server.addEventListener("close", drop);
    server.addEventListener("error", drop);

    return new Response(null, { status: 101, webSocket: client });
  }

  private broadcast(payload: unknown, except?: Client): void {
    const data = JSON.stringify(payload);
    for (const c of this.clients) {
      if (c === except) continue;
      try { c.socket.send(data); } catch { this.clients.delete(c); }
    }
  }

  private broadcastPresence(): void {
    this.broadcast({ type: "presence", viewers: [...this.clients].filter((c) => !c.isHost).length });
  }
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const code = url.searchParams.get("party");
    if (!code) return new Response("missing party code", { status: 400 });
    // One object per party, addressed by join code.
    const id = env.PARTY.idFromName(code);
    return env.PARTY.get(id).fetch(req);
  },
};
