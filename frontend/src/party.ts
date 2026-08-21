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
import { openVodPlayer, setPartyEmitter, applyPartyState, type PartyPlaybackState } from "./vodplayer";

const WORKER_URL = (import.meta.env.VITE_PARTY_WORKER_URL as string) || "";

let socket: WebSocket | null = null;
let currentCode: string | null = null;

function code6(): string {
  const A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no O/0, I/1 — read aloud safely
  return Array.from({ length: 6 }, () => A[Math.floor(Math.random() * A.length)]).join("");
}

async function sha(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function partyLink(joinCode: string): string {
  return `${location.origin}/index.html?party=${joinCode}`;
}

// ---------------------------------------------------------------- hosting ---

/** Hosting is an ACCOUNT-level entitlement: only the account owner starts a
 *  party, and never a kids profile. Checked here and again by RLS, because a
 *  hidden button is not a control. */
export async function canHost(): Promise<boolean> {
  if (getActiveProfile()?.is_kids) return false;
  const { data } = await getSupabase().auth.getUser();
  return !!data.user;
}

export async function createParty(opts: {
  contentId: string; streamIdx: number; title: string;
  seatLimit?: number | null; password?: string | null;
}): Promise<{ joinCode: string; link: string }> {
  const { data: u } = await getSupabase().auth.getUser();
  if (!u.user) throw new Error("not signed in");

  const joinCode = code6();
  const { error } = await getSupabase().from("parties").insert({
    host_user_id: u.user.id,
    join_code: joinCode,
    content_id: opts.contentId,
    stream_idx: opts.streamIdx,
    title: opts.title,
    seat_limit: opts.seatLimit ?? null,
    password_hash: opts.password ? await sha(opts.password) : null,
  });
  if (error) throw error;
  return { joinCode, link: partyLink(joinCode) };
}

// ---------------------------------------------------------------- joining ---

export async function joinParty(joinCode: string, password?: string): Promise<void> {
  if (!WORKER_URL) { showToast("Watch Party isn't configured yet"); return; }

  const sb = getSupabase();
  const { data: party, error } = await sb.from("parties")
    .select("*").eq("join_code", joinCode).is("ended_at", null).maybeSingle();
  if (error || !party) { showToast("That party has ended or the link is wrong"); return; }

  if (party.password_hash && (await sha(password || "")) !== party.password_hash) {
    showToast("Wrong party password");
    return;
  }

  // THE KIDS TRAP. A party link handed to a kids profile would otherwise play
  // whatever the host is playing. Refuse outright rather than filtering -- a
  // control any Discord link walks around is not a control.
  const profile = getActiveProfile();
  const allowed = allowedRatingsFor(profile);
  if (allowed) {
    const item = await lookupCatalogItem(party.content_id);
    const rating = (item?.rating || "").toUpperCase();
    if (!rating || !allowed.has(rating)) {
      showToast(`This party is playing something outside ${profile.name}'s rating limits`);
      return;
    }
  }

  const { data: u } = await sb.auth.getUser();
  if (!u.user) { showToast("Sign in to join the party"); return; }

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
  if (!item) { showToast("That title isn't in the catalog any more"); return; }

  await openVodPlayer(asPartyChannel(item), party.stream_idx || 0, 0);
  connect(joinCode, false, party.seat_limit);
}

// ----------------------------------------------------------------- socket ---

function connect(joinCode: string, isHost: boolean, seatLimit?: number | null): void {
  disconnect();
  currentCode = joinCode;

  const base = WORKER_URL.replace(/^http/, "ws");
  const qs = new URLSearchParams({ party: joinCode, host: isHost ? "1" : "0" });
  if (seatLimit) qs.set("seats", String(seatLimit));
  socket = new WebSocket(`${base}?${qs.toString()}`);

  socket.addEventListener("message", (e) => {
    let msg: any;
    try { msg = JSON.parse(String(e.data)); } catch { return; }
    if (msg?.type === "state" && !isHost) applyPartyState(msg.state as PartyPlaybackState);
    if (msg?.type === "presence") window.dispatchEvent(
      new CustomEvent("veedeeoh:party-presence", { detail: { viewers: msg.viewers } }));
  });

  socket.addEventListener("close", (e) => {
    if (e.code === 1008 || e.code === 4009) showToast("That party is full");
  });

  if (isHost) {
    setPartyEmitter((s) => {
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "state", state: { ...s, contentId: "", streamIdx: 0 } }));
      }
    });
  }
}

export function disconnect(): void {
  setPartyEmitter(null);
  try { socket?.close(); } catch {}
  socket = null;
  currentCode = null;
}

export function activePartyCode(): string | null { return currentCode; }

/** Whether this deployment has a sync worker configured at all. */
export function partyEnabled(): boolean { return !!WORKER_URL; }

/** Start hosting for a title already open in the player. */
export function hostExisting(joinCode: string, seatLimit?: number | null): void {
  connect(joinCode, true, seatLimit);
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
function asPartyChannel(item: any): any {
  return {
    id: `vod:${item.id}`,
    name: item.title,
    country: null, categories: [], nsfw: false, logo: null, logos: [],
    streams: item.streams || [{ url: item.url, quality: null, source: item.genre || "Party" }],
    source: item.genre || "Watch Party",
    vodPoster: item.poster, vodBanner: item.banner, vodItem: item,
  };
}
