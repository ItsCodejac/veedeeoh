# Curated content collections

**Status:** designed, not implemented
**Date:** 2026-08-21

## Why

Automatic classification decides what children see today, and it has been
consistently, confidently wrong:

- `archiveKids()` stamped `genre: "Kids & Family"`, `rating: "TV-Y7"`,
  `maturity: 1` onto every Internet Archive result, then "validated" them
  against those self-supplied values. The only real filter was a title-keyword
  denylist that dropped 0 of 60 results, certifying wartime and
  racial-caricature shorts as TV-Y7.
- `KIDS_SIGNAL_RE` is tested against the RAIL NAME as well as the item, so the
  result is constant across a rail. Tubi ships a rail named "Adult Animation",
  which matches `/animat/`.
- Two divergent copies of that regex exist (`backend/vod.ts:36`,
  `frontend/src/db.ts:76`); the frontend one is a superset, so tightening the
  backend has no effect on what a kid actually sees.
- Home regroups by genre, putting TV-MA adult cartoons in the same rail as
  nursery rhymes because both providers list "Animation" first.

The conclusion is not "fix the regexes". It is that no regex should decide what
a child sees. **A human approves; automation only proposes.**

## The gate

```
Adult        -> entire catalog
Teen         -> catalog minus TV-MA / R / NC-17 / unrated  (provider rating only)
Older Kids   -> approved set only
Little Kids  -> approved set only
```

Approved set for a profile =
  platform collections with `min_age <= tier`
  + household collections with `min_age <= tier`
  - household exclusions (always win)

For the two kid tiers there is no other path in. A title is visible if and only
if a human put it in a collection.

Provider rating metadata still gates Teen. That is real upstream data rather
than something we invented, and the Teen tier needs volume that curation cannot
supply. Named as a deliberate, weaker guarantee.

## Model

One concept. A collection is a named set of titles with two optional properties:

```
name          "Little Kids Approved" | "Date Night" | "Bluey & friends"
min_age       0-3, or null for no age meaning
show_as_tab   whether it appears in the sidebar
items         title ids, or series ids (a series brings its episodes)
```

Every case falls out of combinations:

| Need | min_age | show_as_tab |
|---|---|---|
| Approve a title for kids | `0` | false |
| Personal sidebar category | `null` | true |
| Kids-facing rail | `0` | true |

Two layers, same shape. **Platform** collections are curated by the operator and
readable by every household — the baseline that makes a new kids profile usable
on day one. **Household** collections belong to one account. A household can
clone a platform collection and prune it, so disagreeing with an operator pick
does not mean being stuck with it.

## Storage

```
collections        id, scope('platform'|'household'), owner_id, name, min_age, show_as_tab
collection_items   collection_id, content_id, kind('title'|'series')
profile_exclusions profile_id, content_id
```

RLS: platform rows world-readable, operator-writable; household rows readable
and writable only by their owner.

Approvals key on **provider ids** (`tubi:300005157`, `archive:ElephantsDream`,
Pluto `_id`). These are stable across catalog rebuilds, which matters because
the catalog is fully regenerated nightly — anything keyed on rail position or
array index would silently rot. A title dropped by a provider simply stops
appearing.

Visibility is computed client-side from the cached catalog plus the account's
collections, so the catalog stays one shared 5 MB payload rather than being
rendered per profile.

**Known limitation, accepted:** client-side filtering means devtools can reach
the unfiltered catalog. This is a parental control, not a security boundary.
Making it a boundary would require per-profile server-side catalog rendering and
would cost the shared cache.

## Curation UI

**Operator** gets a review queue. Automation proposes and ranks candidates; the
human approves or rejects. Every card shows poster, title, year, provider, the
provider's own rating, and a play button.

That requirement is load-bearing. The denylist failed because it judged a title
*string*. Any screen where a human approves content for children must show the
content, not its metadata.

Approving carries an age: Little Kids / Older Kids / Not for kids. "Not for
kids" is recorded so the title never returns to the queue. Series are one
decision — approve *Bluey*, its episodes come along.

**Parents** get the same mechanism without the queue: an "Allow for..." control
on any title they can already see, a "Remove" control on a restricted profile's
rail (writes an exclusion), and tab creation by naming a collection. No separate
curation mode — the controls live on the content.

The asymmetry is deliberate: the operator processes thousands and needs a queue;
a parent makes a handful of decisions about things they happened to notice.

Approval granularity is title-level and series-level only. Rail-level bulk
approval is deliberately excluded: it is exactly how "Adult Animation" would
slip in. **Coverage is intentionally partial — not comprehensive, just correct.**

## Rollout

Flipping the gate before anything is approved would empty every existing kids
profile, which is worse than the bug being fixed. The order is forced:

1. **Schema + admin panel.** Nothing user-facing changes.
2. **Seed the platform collection.** The current auto-filter output becomes the
   candidate queue (~68 titles now that archive items are gone). It is already
   maturity-gated, so it is a reasonable pool. What was wrong as a *gate* is
   fine as a *suggestion*.
3. **Parent controls.**
4. **Flip the gate** — one change in `getVodRails()`, trivially revertable.

Steps 1-3 change nothing anyone sees. Teen keeps rating filtering throughout and
never has an empty phase.

## Deleted at step 4, not before

- `KIDS_SIGNAL_RE` (`backend/vod.ts:36`) and its divergent twin
  (`frontend/src/db.ts:76`)
- `isKidsSafe()`, `isKidsSafeItem()`, `filterRailsForKids()`
- rail-name contamination, structurally — rail names stop being an input

`maturityLevel()` survives to serve the Teen filter, demoted from safety
mechanism to convenience filter.

Every bug found on 2026-08-21 becomes impossible rather than fixed:
`archiveKids` could not self-certify because self-certification stops being a
code path.
