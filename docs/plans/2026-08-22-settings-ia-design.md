# Settings and menu information architecture

Status: design, agreed in outline. 2026-08-22.

## Why

Two audits of the shipped app found the menu system had grown by accretion.
Nothing was designed wrong; things were added next to whatever they resembled,
and the result is that meaning and filing came apart.

The specific failures, all verified in source:

- **Five near-identical labels, five destinations.** Settings section
  `Profiles`; the `Profiles` row in Plan and billing (a seat count); `Manage
  Profiles` in the switcher; the `Public profile` section; the `Profile` link
  on a party row.
- **`Switch profile` means two different things.** On mobile it opens the
  account *menu*; inside that menu a second control with the same words opens
  the switcher.
- **Editing a profile is four clicks and never labelled "edit"**: You →
  Switch profile → Manage Profiles → click an avatar.
- **Six sign-out controls, three behaviours**, one of which does nothing when
  there is no session and one of which skips a PIN gate.
- **Two sections most users will never need** — Public presence and Earning —
  sat alongside four that everyone needs.
- **Ratings were edited in two places**, a household matrix and the profile
  editor, both writing the same field.

## The inventory

Everything that must live in the menu system, grouped by what it is rather
than by which module happens to render it.

| Group | Items |
|---|---|
| Who's watching | switch profile, edit, add, delete, PIN, allowed ratings, exit kids mode |
| Account | email, password, passkeys, sign out, sign out everywhere, export, delete account |
| Plan and money | plan and expiry, seats, subscribe, manage billing, credit balance, buy credits |
| Public presence | handle, display name, bio, region, usual host time, channel, recommendations, suggestions inbox, view page |
| Earning | rate and term, link, copy/share, signed-up/subscribed/owed/paid, source breakdown |
| Playback | preferred quality, subtitles by default |
| App | install, report a problem, terms, privacy, avatar credits, region |

Two filing corrections fall straight out of the grouping:

**Ratings belong to a profile, not to the household.** A limit applies to one
person, so it is set where that person is edited, next to their name, avatar
and PIN. The separate matrix is removed. One control, one field, no drift.

**Public presence and Earning stay permanently visible.** They are useless to
most accounts, which argues for hiding them until relevant — but a menu that
changes shape is harder to learn than a menu with two entries you ignore, and
hiding the affiliate programme conceals it from exactly the people worth
recruiting.

## Structure

One scrolling page, same on every width, with a jump bar pinned to the top.

    Settings
    [Account] [Profiles] [Public] [Earning] [Playback] [App]

    ACCOUNT          email, plan, seats, billing, credits,
                     password, passkeys, sign out, export, delete
    PROFILES         one row per profile with Edit; add a profile
    PUBLIC PROFILE   handle, name, bio, region, schedule, channel,
                     recommendations, suggestions
    EARNING          terms, link, share, stats, breakdown
    PLAYBACK         quality, subtitles
    APP              install, report, terms, privacy, credits

Rationale for one page over sections:

- **Everything becomes one click from Settings instead of three.** Section
  navigation was the whole reason twenty controls sat at depth three or four.
- **Nothing can hide behind a label that misdescribes it**, because there are
  no intermediate labels left to hide behind.
- **One layout, not two.** The desktop sidebar and the mobile stack were two
  structures to keep correct, and every item that went missing went missing on
  mobile. A single column that reflows removes the version that gets tested
  least.
- The jump bar keeps long-page navigation cheap without reintroducing a level.

## Naming

One name per thing, chosen and applied everywhere.

| Was | Becomes |
|---|---|
| `Favorites` tab / `My List` rail / `Add to My List` | **My List**, everywhere |
| `Switch profile` (two meanings) | **Who's watching** (switcher), **Edit profile** (editor) |
| `Manage Profiles` → click avatar | **Edit** on each profile row |
| `Add Profile` / `Add a profile` | **Add a profile** |
| `Report something` / `Report a problem` | **Report a problem** (abuse reporting keeps **Report**) |
| `Household name` | removed — it is device-local and read by nothing |
| `Manage seats` | removed — it reloads the page and sells a plan that does not exist |

## Direct paths

The account menu stops being a corridor and becomes a shortcut list:

    You ▸  Edit profile        (was 4 clicks, now 2)
           Who's watching      (was 2, now 2, correctly named)
           Settings            (2)
           Sign out            (2)

## Out of scope, tracked separately

Found by the audits, not IA work, fixed on their own:

1. `#trialNotice` hidden below 760px — the conversion nudge is invisible on
   every phone.
2. Refer and earn renders an empty pane when the account has no referral code.
3. Switcher sign-out skips the adult PIN gate.
4. Settings "Add a profile" skips the seat cap and PIN that the switcher path
   enforces.
5. Kids profiles reach Settings on mobile and not on desktop.
6. Five hard-coded gold stars on every title.
7. Dead code: `ocean.ts` (581 lines, no importer), the party visualizer markup
   in index.html, the mini-player docking code, the household invite API.

---

## Addendum, 2026-08-23: what is actually being sold

I got this wrong once and it is worth writing down so it is not re-derived.

**The error.** The catalogue is Pluto, Tubi and the Internet Archive, all free
with no paid tier of their own. From that I concluded we could not charge for
access, moved the paid line to metered watch party hosting, and opened the
whole hosted app up for free. That reasoning is about the wrong product.

**The correction.** veedeeoh is free: clone it, run it, done. What costs $4 is
*us* running it -- the deploy, the database, the catalogue warming, the Durable
Objects. A hosted account that browses, streams, syncs and hosts for nothing is
not a generous free tier, it is the product given away. Free means self-host.

    Self-host      free, forever, no account with us
    Cloud, $4/mo   we run it: browse, sync, 3 profiles, unlimited parties
    Free account   join 4 watch parties a month, nothing else

**Why the free account exists at all.** Someone invited to a party needs to be
able to accept without a card. That was already true -- `canJoinParty` returned
true for anyone signed in -- but it was *unlimited*, which is not a taste: a
household where one person pays could seat everyone else forever. Four a month
is enough to be in the thing a friend keeps inviting you to and decide whether
you want your own, and not enough to be a standing arrangement on their bill.

**Counted in parties, not joins**, which the schema gives for free:
`party_joins` is keyed `(party_id, user_id)`, so a refresh, a dropped socket or
the auto-reconnect never creates a second row. The RLS insert policy fires only
for a party this account has not been in, so the limit counts the right thing
without a single line of dedup logic. The client check has to special-case a
party already joined, or it ends up stricter than the database.

Numbers live in `20260823030000_free_party_join_limit.sql` (4/month) and
`grant_monthly_credits` (60 credits = 10h hosting, inside the subscription).
