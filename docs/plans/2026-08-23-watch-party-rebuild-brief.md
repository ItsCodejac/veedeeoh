# Watch party rebuild: brief and backend prep

Written 2026-08-23, for the party UI rebuild happening outside this repo.

## What the app can accept

The ident rebuild is the working example. What slotted in was a plain custom
element: no framework, no build step, attributes in, an event out. What did not
work was a `.dc.html` export against a React scene runtime, because this app is
vanilla TypeScript on Vite with five runtime dependencies and none of them is
React. Translating it by hand produced something that matched the source
numbers and still looked wrong.

So, in order of preference:

1. A custom element per surface, or one element with a `state` attribute.
2. Failing that, a `mount(container, props) -> { destroy() }` function in plain
   JS with its CSS in the same file or a plain `.css`.

Either way it needs to: take its size from the container rather than assume a
1920x1080 stage, work on a phone in both orientations, and emit an event rather
than call back into anything it imports.

## Tokens it must use

    --accent        #c5f04e   one green. Not #C6F53A, which is the design
                              bundle's and has leaked in twice already.
    ground          #06070a
    panel           #10141e
    display font    Bricolage Grotesque
    body font       Space Grotesk
    ident font      Manrope 800   (ident only)
    kids accent     --brand-accent flips to #ff9f1c in body.kids-mode
    kids letters    #ff7a5a #ffc93a #3ac9f5 then --accent

No emoji in chrome or copy: SVG icons. No em dashes.

## Every state the party actually has

This is the part a redesign usually misses. Twelve of these exist in code today
and each one is reachable in normal use.

**Before it starts**

- *Setup* — seat limit, require approval, list publicly.
- *Curtain* — three round trips on the host side, two on the guest side. The
  party ident covers it now; whatever replaces it must tolerate the work
  outlasting the animation.
- *Host lobby / green room* — code and link, people arriving, host starts when
  ready. Playback deliberately does not begin on create.
- *Guest waiting for approval* — only when the host required it.

**Running**

- *Playing, host* — authoritative. Seeks and pauses propagate.
- *Playing, viewer* — receives and reconciles, never sends.
- *Reactions bar* — draggable, two orientations, hideable, and it must be
  parented to the fullscreen element or it is not painted at all.
- *Knock* — someone is asking to come in. Needs an answer, so it cannot be a
  toast that expires on its own.
- *Host away* — the host's tab is backgrounded.
- *Out of sync / resync* — the viewer has drifted and wants a way back.
- *Reconnecting* — the socket dropped. Retries are capped and must distinguish
  a dropped connection from a removal or an ended party, or it spams.
- *Next title* — the host changes what is playing without ending the party.

**Endings and refusals**

- *Removal, host side* — reason picker: connection trouble, making room, not
  the right fit, behaviour. The first two do not ban; the last two do.
- *Removal, guest side* — full screen with the reason, and a way back in when
  the reason allows one.
- *Party ended / wrap-up* — plus what the host earned, shown only when non-zero.
- *Free account at its join limit* — four parties a month.
- *Rating block* — a kids profile cannot join a party playing something outside
  its limits. Refused outright rather than filtered.
- *Out of hosting credit* — the party is never cut off mid-film; metering just
  stops.

**A rule that keeps being rediscovered:** anything that appears during playback
must be mounted on the fullscreen element, not `document.body`. Fullscreen
paints only that subtree. This was found once for reactions and fixed only
there; the knock, the removal card and the wrap-up were all invisible on a
phone for weeks afterwards. `mountOnTop()` in `src/overlay.ts` does it.

## Backend to prepare, and what to leave

**Worth doing before the UI lands, because the UI cannot paper over it:**

1. **Authenticate the relay.** `worker/party.ts` checks a random `hostToken`
   the client generated and nothing else — no Supabase JWT, no entitlement.
   Entitlement is enforced in the client and in an RLS policy, both on the
   caller's side. Anyone pointing `VITE_PARTY_WORKER_URL` at our worker gets
   free party hosting on our Cloudflare account. CORS does not stop it: the
   allowlist accepts any `*.vercel.app`, and WebSocket upgrades ignore CORS.
   This is the one thing that costs real money and the only one with no lock.

2. **One open party per host.** Nothing enforces it. A partial unique index
   does — `on parties (host_user_id) where ended_at is null` — but it will not
   create while any host already has two open rows, so it needs a pass closing
   stale ones first.

**Decide before designing the public list, because it changes the data model:**

3. **Registry and relay are separable.** A party is three things: the registry
   row and join code (cheap), the Durable Object relay (the actual cost), and
   content resolution (per viewer, local). A self-hoster could use their own
   relay with our registry, which needs `parties.relay_url` recording where to
   connect. Worth deciding before the join flow is redesigned around one
   assumption.

**Known to work already, so nobody needs to solve it:** content ids are
provider-derived — `tubi:12345`, `archive:<identifier>` — so they are stable
across instances and a cross-instance party resolves without federation. The
exceptions are a title the guest's catalogue has not indexed, and any local
media a self-hoster adds, which cloud guests cannot play at all.

**Leave alone:** listing publicly puts a party on our shelf, resolved from a
catalogue we did not index, served by an instance we do not control. That is a
moderation question, not a design one, and `public_parties_banned` and
`profile_reports` exist because it already needed answering once.
