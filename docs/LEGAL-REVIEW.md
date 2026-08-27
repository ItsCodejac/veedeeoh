# veedeeoh legal review pack

**This is not legal advice and was not written by a lawyer.** It is an engineering description
of what the veedeeoh code actually does with user data, written so that a qualified lawyer can
turn it into enforceable documents. The Terms of Service and Privacy Policy in
`frontend/terms.html` and `frontend/privacy.html` are accurate descriptions of the system's
behaviour as of 22 August 2026. They are **not** verified as legally sufficient for any
jurisdiction, and several clauses a real policy needs are deliberately left as
`[REVIEW: ...]` placeholders rather than guessed at.

## Status, 27 August 2026: these pages are already live, placeholders and all

`veedeeoh.com/terms` and `veedeeoh.com/privacy` are serving right now, and the
`[REVIEW: ...]` markers are **visible text on them** -- eleven on the terms, ten on the
privacy policy, rendered as notice blocks a customer can read. That is the honest state of
the documents, but it is also a paid product asking for a card behind terms that openly say
which clauses have not been settled.

Two things follow, and both are decisions rather than engineering:

- Whether it is acceptable to take payment under terms in this state, or whether the
  placeholders must be resolved first.
- Whether the markers should be visible at all. Visible is candid; hidden would misrepresent
  the documents as finished. The engineering position is that hiding them without resolving
  them is the one option that should be off the table.

The list below is unchanged and is what counsel needs to settle.

## What a lawyer must confirm

1. The legal entity behind veedeeoh, its form, and a postal address for both documents.
2. Governing law, venue, and whether arbitration and a class action waiver are wanted.
3. Whether accessing Pluto TV and Tubi through their internal APIs is permitted by those
   providers' terms. See "Risk areas" below. This is the largest open question.
4. Automatic renewal disclosure compliance (California ARL and equivalents) and the EU/UK
   statutory withdrawal right versus the current "no refunds" wording.
5. Whether GDPR/UK GDPR apply, and if so: lawful bases, transfer mechanism, DPAs with each
   processor, and whether a representative or DPO is required.
6. Whether COPPA or the UK Age Appropriate Design Code apply given kids profiles.
7. DMCA designated agent registration and a notice-and-takedown plus repeat infringer policy.
8. Whether purchased watch party credits fall under gift card, stored value, or unclaimed
   property rules, given the current forfeit-on-closure and rollover-ceiling behaviour.
9. Referral programme structure: payout mechanics, tax reporting, and FTC disclosure duties
   on referrers.
10. Retention periods, which are currently "until account deletion" because that is what the
    code does, not because anyone chose it.

---

## (a) What the code actually collects

Source of truth: `supabase/migrations/*.sql`, `frontend/src/db.ts`, `frontend/src/auth.ts`,
`api/index.ts`, `backend/billing.ts`, `backend/email.ts`, `frontend/src/feedback.ts`,
`worker/party.ts`.

**RESOLVED, 27 August 2026.** This section previously warned that `profiles`,
`household_profiles`, `household_members`, `household_invites`, `favorites`, `watch_progress`
and `catalog_cache` had no migration file, that their columns had been inferred from client
code, and that a schema dump was needed before the document could be relied on.

That dump has now been taken. Those seven tables, and six functions that were also missing,
are recorded in `supabase/migrations/20260720000000_baseline_core_schema.sql` and
`20260826000000_record_live_only_functions.sql`, both read directly out of the live database
rather than reconstructed. A database built from the repository alone was then diffed against
production and matches it exactly: 29 tables, 48 functions, 39 policies, 67 indexes, and every
column, type, default and nullability. `npm run verify:db` reproduces that build and check.

So the inventory below is now derived from the live schema and can be relied on. One correction
it produced: `watch_progress` stores `position_secs`, `duration_secs` and a `completed` boolean,
not the `position_sec`/`duration_sec`/`percentage` this document previously listed.

### Authentication (Supabase managed, `auth.users`)

Email address, salted password hash (never seen by veedeeoh), Google OAuth identity if used,
enrolled WebAuthn passkeys with a friendly name, email confirmation state, sessions, and a
`must_change_password` flag in user metadata.

### `profiles` (one row per account)

`id` (= auth user id), `email`, `tier`, `tier_expires`, `seats`, `stripe_customer_id`,
`stripe_subscription_id`, `must_change_password`, `party_credits`, `party_credits_accrued`,
`party_credits_spent`, `party_credits_exempt`, `credits_granted_for`, `trial_email_sent`.

### `household_profiles` (the "who is watching" avatars)

`user_id`, `name`, `avatar_color`, `avatar_url`, `is_kids`, `max_rating`, `allowed_ratings[]`,
`pin`, `created_at`. The PIN is stored only as a salted SHA-256 hash
(`frontend/src/profiles.ts:35`), unsalted-per-user with a fixed string prefix, and a 4-digit
PIN is trivially brute-forced from the hash. The code comments say as much and treat it as a
convenience gate, not security. The policy text says the same.

### `household_members`, `household_invites`

Owner and member user ids; invite token, email address, status. Acceptance is via the
`accept_household_invite(token)` RPC, which enforces the seat cap.

### `favorites`, `watch_progress` (both per household profile)

`favorites`: `profile_id`, `content_id`, `title`, `poster`.
`watch_progress`: `profile_id`, `content_id`, `title`, `position_secs`, `duration_secs`,
`completed`, `updated_at`. This is a full viewing history, retained indefinitely.

### `collections`, `collection_items`, `profile_exclusions`

User-built lists (`scope='household'`) alongside platform-curated ones, list contents by
provider content id, and per-profile hidden titles.

### `parties`, `party_joins`

`host_user_id`, `join_code`, `content_id`, `stream_idx`, `title`, `seat_limit`, `created_at`,
`ended_at`; and per join, `party_id`, `user_id`, `host_user_id`, `joined_at`. `password_hash`
still exists in the create-table migration but was dropped by
`20260822030000_drop_party_password.sql`.

### Watch party sync (Cloudflare Durable Object, `worker/party.ts`)

Persisted in the object: `PartyState` (`contentId`, `streamIdx`, `positionSecs`, `paused`,
`updatedAt`) and `Config` (`seatLimit`, `hostUserId`, `hostToken`, `requireApproval`,
`createdAt`, `started`). Per connected socket: `isHost`, `userId`, `name` (display name),
`approved`. No media, no chat, no audio passes through it. **The claim in the brief that it
carries "playback position only" is not exact**: it also carries the account id and the display
name of every participant, and each participant's chosen name is visible to the rest of the
party. The privacy policy states this accurately.

### `party_credit_ledger`, `free_month_grants`

Every credit movement with a reason (`monthly_grant` / `purchase` / `spend` / `admin`), the
party it was spent on, and free months earned at milestones, with the Stripe reference.

### `referral_codes`, `referrals`, `referral_earnings`

Referral code and rate per user; permanent first-touch attribution of who referred whom,
through which `source` (`link` / `party` / `household` / `partner`), with the rate and duration
snapshotted; and per-invoice earnings rows carrying `stripe_invoice_id`, `gross_cents`,
`rate_bps`, `commission_cents`, `paid_out_at`, `payout_ref`.

### `feedback` (problem reports)

`kind`, `title`, `body`, `reporter_user_id`, `reporter_email`, `profile_id`,
`profile_is_kids`, `url`, `view`, `app_version`, `user_agent`, `viewport`, `console_tail`
(jsonb), `status`, `notes` (owner-only). The console tail is a client-side ring buffer of
recent console output, scrubbed by a regex for `jwt=`, `access_token=`, `apikey=`, `api_key=`,
`Bearer `, `token=` and truncated to 500 characters per line
(`frontend/src/feedback.ts:18`). That regex is a denylist and will not catch a token in an
unusual format or a value logged by a browser extension.

### `beta_invites`, `waitlist`

Invite code, target email, tier, expiry, a `grants` jsonb blob, a note, and who redeemed it
when. Waitlist stores email and timestamp, with an RLS policy allowing public inserts.

### `catalog_cache`

Region plus a catalogue blob. No personal data.

### Browser storage (not on our servers)

`veedeeoh_cloud_session` (email plus the Supabase **access token**, written to both
localStorage and a `Secure; SameSite=Lax` cookie), `veedeeoh_supabase_auth_session`,
`veedeeoh_active_profile`, `veedeeoh_household_profiles`, `veedeeoh_account_name`,
`tvlc_region`, `veedeeoh_pref_cc`, `veedeeoh_pref_quality`, `veedeeoh_pwa_dismissed`,
`veedeeoh_mpaa_warning_ack`, `veedeeoh_pending_beta`, `veedeeoh_pending_household_invite`,
`veedeeoh_trial_notice_day`.

### Processors

Supabase (auth + database, US region), Stripe (payments; card data never reaches veedeeoh),
Vercel (app and API hosting), Cloudflare (party sync Durable Object + manifest relay), Resend
(transactional email, `backend/email.ts`), Google (OAuth, only if chosen), Google Fonts (loaded
on every page of `landing.html`, `index.html`, `privacy.html`, `terms.html`).

### Existing user controls

- `GET /api/account/export` (`api/index.ts:461`) returns JSON of `household_profiles`,
  `watch_progress`, `favorites`, `collections`, `referrals`, `parties`, using the caller's own
  JWT so RLS scopes it. Wired to Settings > Account > "Download my data".
- `POST /api/account/delete` requires the caller to retype their email, cancels every Stripe
  subscription on the customer, and deletes the auth user, which now cascades every table.

  **CORRECTION, 27 August 2026, material to any erasure analysis.** Until that date this
  deleted far less than it appeared to. The four hand-created tables had no foreign key to
  `auth.users`, so deleting the auth user removed only the `parties` row; `household_profiles`
  (profile names, avatars, PIN hashes, rating limits), `watch_progress`, `favorites` and
  `household_invites` all survived, and the endpoint explicitly removed only `profiles`.
  Worse than residue: RLS on those tables keys on `auth.uid()`, so once the auth user was gone
  no session could ever match them again -- unreadable and undeletable through the product,
  retained indefinitely, with the erasure request already reported as completed.

  Migration `20260826040000_account_deletion_cascades.sql` added the five missing foreign keys,
  all `on delete cascade`, after an orphan sweep. Production had no orphans at that point, so
  no pre-existing data was destroyed by the sweep and none was left behind by it. Check 10 in
  `npm run verify:db` asserts that nothing of a deleted account survives.

  Counsel should note that any erasure request completed **before** 27 August 2026 did not
  delete the viewing profiles, watch history, favourites, or the invited third party's email
  address, and should advise on whether that requires notification or remediation.
- Sign out everywhere, profile editing, and subscription cancellation via the Stripe portal are
  all in Settings.

---

## (b) Every `[REVIEW]` placeholder and the decision it needs

### `frontend/privacy.html`

| Marker | Decision needed |
| --- | --- |
| `[REVIEW: legal entity]` | Controller name, legal form, country, postal address. |
| `[REVIEW: log retention]` | Confirm and state how long Vercel and Cloudflare retain request logs containing IP addresses. |
| `[REVIEW: lawful basis]` | GDPR lawful basis per processing purpose, plus legitimate interests balancing tests. |
| `[REVIEW: transfers and DPAs]` | Transfer mechanism per processor, signed DPAs, and whether Google Fonts must be self-hosted given EU rulings. |
| `[REVIEW: retention periods]` | Concrete periods for feedback reports, waitlist rows, invoices, and referral earnings, including the statutory tax retention period. |
| `[REVIEW: export completeness]` | Whether the export omitting `feedback`, `party_credit_ledger`, `referral_earnings`, `profile_exclusions`, `collection_items`, `party_joins` satisfies portability duties. This is a code change if the answer is no. |
| `[REVIEW: rights and requests]` | Response deadlines, identity verification, authorised agents, appeals, supervisory authority contacts. |
| `[REVIEW: children's privacy law]` | Whether COPPA / AADC / state minor laws apply to kids profiles, and whether verifiable parental consent is required. |
| `[REVIEW: breach notification]` | Statutory timelines and what the policy should commit to. |
| `[REVIEW: contact and DPO]` | Postal address; whether a DPO or EU/UK representative must be appointed. |

### `frontend/terms.html`

| Marker | Decision needed |
| --- | --- |
| `[REVIEW: legal entity]` | Contracting entity and registered address. |
| `[REVIEW: provider terms of service]` | Whether reaching Pluto TV and Tubi through internal APIs with browser-style headers is permitted. See risk 1 below. |
| `[REVIEW: age of majority]` | Confirm 18 is right for every jurisdiction served. |
| `[REVIEW: automatic renewal and refunds]` | ARL-style disclosure wording and consent capture; EU/UK withdrawal right; whether Stripe Tax should collect VAT or sales tax. |
| `[REVIEW: credits as stored value]` | Whether purchased credits trigger gift card / stored value / escheat rules that restrict forfeiture. |
| `[REVIEW: referral payouts]` | Payout mechanics, thresholds, treatment of unpaid balances on closure, tax reporting, separate affiliate terms, FTC disclosure. |
| `[REVIEW: DMCA safe harbour]` | Register a designated agent, publish a takedown procedure, adopt a repeat infringer policy, or decide the safe harbour is not the right frame. |
| `[REVIEW: consumer warranties]` | Carve-outs for non-excludable consumer warranties. |
| `[REVIEW: liability carve-outs]` | Non-excludable liability carve-outs and whether the 12-month cap survives. |
| `[REVIEW: governing law, venue and dispute resolution]` | The whole clause. Nothing is stated today. |
| `[REVIEW: notices]` | Postal address for legal notices. |

---

## (c) Risk areas found while reading the code

**1. Content access method (highest exposure).** `backend/vod.ts` reaches Pluto TV's internal
`boot.pluto.tv` and `service-vod.clusters.pluto.tv` endpoints with a spoofed desktop Chrome
`User-Agent`, `Referer: https://pluto.tv/`, `Origin: https://pluto.tv`, and a **hardcoded
`X-Forwarded-For` IP chosen from a per-country table** (`backend/vod.ts:110-127`) in order to
select a regional catalogue. `backend/tubi.ts` similarly calls Tubi's `adrise` content API with
a spoofed user agent. `worker/proxy.ts` relays Pluto manifests specifically because Pluto's
CORS headers are set to deny non-pluto.tv origins. Every one of those is a deliberate
circumvention of an access control the provider put in place. The Terms describe this honestly
and flag it, but a lawyer needs to assess exposure under provider terms of service, the CFAA,
and equivalents, before launch. Mitigating facts worth stating to counsel: no content is copied
or rehosted, `serverSideAds: "true"` is set so the providers' advertising is left intact, and
the browser fetches segments directly from the providers' CDNs.

**2. Access token in localStorage and a cookie.** `frontend/src/auth.ts` writes the Supabase
access token into `localStorage` and into a 365-day cookie under `veedeeoh_cloud_session`. Any
XSS on the origin exfiltrates a live session. This is a security posture question that also
affects what the Privacy Policy can honestly promise about safeguards.

**3. Hardcoded Supabase anon key and URL as fallbacks** in `frontend/src/auth.ts`. The anon key
is public by design, but pinning it in source means a key rotation ships as a code change, and
it defeats environment separation.

**4. Console log capture in feedback reports.** The scrub in `frontend/src/feedback.ts` is a
denylist regex over six known token prefixes. Browser extensions log into the same console, and
the code comment acknowledges this. Reports therefore may contain third-party or incidental
personal data that the user did not intend to send. Consider showing the captured tail to the
user before sending, and setting a short retention period on `feedback`.

**5. The data export is incomplete** relative to what the database holds. Listed under
`[REVIEW: export completeness]` above; it is a code change, not a wording change.

**6. `ALLOWED_EMAILS` hardcoded in `api/index.ts:12`.** Five real personal email addresses are
committed to a public repository (`github.com/ItsCodejac/veedeeoh` is linked from the landing
page footer). That is a personal data disclosure independent of anything the policy says.

**7. Kids profile rating gate depends on third-party metadata.** `backend/vod.ts` maps provider
ratings to a maturity number and defaults unrated content to adult, which is the right
direction. But the Terms must not imply the filter is reliable, because the underlying data is
not. The Terms as written disclaim this explicitly.

**8. Waitlist table allows public inserts** with no rate limit visible
(`20260721000000_create_waitlist.sql`). Anyone can enumerate-insert email addresses into it.
Minor, but it is a table of personal data with an open write policy.

**9. `x-forwarded-for` used as a region code.** `api/index.ts:211` falls back to the caller's
real IP address as the `region` argument to `vod.getSeries`. It is uppercased and used as a
lookup key, so it misses the spoof table and falls through to the US default rather than
leaking the IP onward to Pluto. It is harmless today and one refactor away from not being.

**10. Referral payouts are manual.** `20260822000000_referrals.sql` states plainly that money
leaves by hand and `paid_out_at` records it. Anything the Terms promise about earnings needs to
match a process that a human currently performs.

**11. Google OAuth and passkey sign-up bypass the consent checkbox.** The new required checkbox
gates the email-and-password create-account path only, as specified. A user who signs up with
"Continue with Google" never ticks it. If recorded consent at sign-up matters legally, that
path needs the same gate, and consent probably needs to be persisted with a timestamp and the
document version rather than only enforced client-side.

**12. Consent is not recorded anywhere.** The checkbox blocks submission in the browser and
nothing more. There is no column storing that the user agreed, when, or to which version of
which document. If proof of acceptance is ever needed, it does not exist. Adding
`terms_accepted_at` and `terms_version` to `profiles` would fix it.
