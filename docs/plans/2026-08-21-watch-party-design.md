# Watch Party

**Status:** designed, not implemented
**Date:** 2026-08-21

## Scope for v1

Catalog titles only. No uploads, no R2, no storage add-on. That removes
transcoding, quota enforcement and DMCA exposure from v1 entirely, and finds out
whether parties get used before paying for storage.

Voice and chat are explicitly out of scope: parties happen alongside Discord,
Twitch or a phone call. veedeeoh syncs playback and nothing else.

## Mechanism

One Cloudflare Durable Object per party, holding:

```
{ contentId, streamIdx, positionSecs, paused, updatedAt }
```

The host is authoritative. Viewers receive and reconcile; they never send
playback commands. The host broadcasts on play, pause and seek, plus a heartbeat
roughly every 5s so drift self-corrects. A viewer more than ~2s out seeks; a
viewer whose paused state differs matches it. Late joiners receive current state
on connect and land at the right position mid-film.

**Each viewer resolves its own stream URL.** The host does not share a link to
the video. Every client independently calls `/api/vod/pluto?path=...` (or the
Tubi/Archive equivalent) and gets its own freshly signed URL. This is not an
optimisation, it is required: Pluto's JWTs are per-session and expire in 24h, so
a shared URL would break for everyone at once. It also means a party outlives any
individual token.

Consequence worth stating plainly: **media never passes through Cloudflare.** The
Durable Object relays on the order of 20 small JSON messages per hour per party.
Video streams from the provider directly to each viewer exactly as it does today,
so there is no egress to pay for in v1 and the zero-egress argument for R2 only
becomes relevant in phase 3.

Reuses the existing player as-is. `openVodPlayer(ch, streamIdx, startTime)` is
already the entry point; a party join is that call with `startTime` taken from
party state, plus a reconcile listener. No second player, no fork.

## Access

Supabase holds configuration, the Durable Object holds liveness.

```
parties: id, host_user_id, content_id, stream_idx,
         join_code, password_hash, seat_limit (null = uncapped),
         created_at, ended_at
```

Join: link -> sign in -> password if set -> seat check -> connect.

**Seat limits are enforced in the Durable Object, not the database.** It is the
only component that knows how many viewers are connected right now. A row count
in Postgres cannot express that.

### Hosting is the account owner's, not per-profile

Only the ACCOUNT OWNER can create a party. Watch Party is an account-level
entitlement (and, in phase 3, a paid add-on), so it attaches to the owner rather
than being granted to every profile in the household.

  - Owner profile: can create, host and control a party.
  - Other household profiles: can join a party, cannot create one.
  - Kids profiles: can never host, under any configuration.

This is checked server-side against the account, not by hiding the tab. Hiding
the Watch Party tab from non-owner profiles is a UI convenience, not the control
-- the same mistake as main.ts hiding Household Settings on kids profiles
without enforcing anything behind it.

### Joining

A free account is required to join. Not a paid one -- the party link is then a
growth funnel where every guest is a captured account, rather than an anonymous
uncapped pass to the catalog. Paid-only was rejected because it limits users to
watching with people who already subscribe, which makes the feature nearly
useless.

### Kids profiles: the trap

A party link handed to a kids profile would otherwise play whatever the host is
playing. A parental control that any Discord link walks around is not a control.

The joining profile's gate must run against the party's content at join time. A
kids profile joining an adult title is refused outright -- not shown a filtered
rail, refused. This is the same defect shape as the archiveKids bug: a gate that
exists but is bypassed by the path people actually take. See
[curated collections design](2026-08-21-curated-content-collections-design.md),
whose approved-set check is the right thing to reuse here once it exists.

## Phasing

1. Party sync: create, join, host controls, seats, password. Catalog only.
2. Watch Party tab: your parties, recent, rejoin.
3. Uploads + R2 + storage add-on. Only once parties are proven used, and only
   after DMCA safe-harbor is in place: registered agent, takedown process,
   repeat-infringer policy, and terms assigning responsibility. Hosting user
   uploads changes veedeeoh's legal posture from "aggregates public streams,
   hosts nothing" to "hosting provider". That is paperwork rather than code, and
   far cheaper before launch than after a first notice.

## Costs and dependencies

Durable Objects require Cloudflare's paid Workers plan, about $5/mo. The Workers
free tier alone will not do it. This adds Cloudflare as a vendor alongside
Vercel and Supabase.

Deliberately kept off Supabase Realtime: it would work and adds no new vendor,
but it puts party traffic on the platform the owner specifically wanted to
protect, and Realtime connection limits would silently become the seat cap.

WebRTC peer-to-peer was rejected: it still needs a signalling server, and a full
mesh degrades past roughly 6-8 peers, which contradicts uncapped seats.
