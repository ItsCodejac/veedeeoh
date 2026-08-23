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

## Addendum, 2026-08-23: where the paid line goes

The gate moved from the front door to watch party hosting. The reasoning, kept
here because the code can only show the result:

**We are not paid for access.** The catalogue is Pluto, Tubi and the Internet
Archive. All three are free with no paid tier of their own, so there is nothing
to resell and no cost to us in serving it. veedeeoh is also free to self-host,
which means a wall does not send a technical visitor to a competitor -- it
sends them to `git clone`, and we lose the revenue and the relationship at once.

**We are paid for hosting.** Watch party hosting is the only line on our bill:
Durable Objects, sockets, signalling. It already had a per-minute meter that
only paying accounts ever reached, so the app was charging for the free thing
and giving away the expensive one.

The shape now:

| | Free | $4 | Self-host |
|---|---|---|---|
| Browse, search, stream | yes | yes | yes |
| Join a party | yes | yes | yes |
| Host a party | 3 hours/month | 10 hours/month | your bill |
| Profiles | 3 seats | 3 seats | yours |

Three hours, not one, because a film is about two: an allowance that cannot
host one complete party demos a countdown rather than a feature. Both numbers
are constants in `20260823010000_free_tier_hosting.sql`.

Seats are unchanged and still not tier-gated. If the free tier needs to be
narrower, seats are the next lever, not access.

### Carried over, not yet rebuilt

`showWhatIsWaiting()` was deleted with the paywall. It rendered the account's
own half-finished films behind the price, on the reasoning that a number asks
somebody to value an abstraction while their own unfinished film is concrete
and already theirs. It was the best thing on that screen. It belongs on
whatever eventually *asks* a free account to subscribe -- not on anything that
blocks a door. Recovered from git history at the commit that removed it.
