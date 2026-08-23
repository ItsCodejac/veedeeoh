// Supabase data layer for the cloud (SaaS) pipeline.
//
// Matches the LIVE schema on project fwlbmksxmfzgkazrulgt (verified via MCP):
//   profiles           - one row per auth user (account): id = auth.uid(), email, tier
//   household_profiles - "who's watching" avatars, owned by user_id
//   household_members  - owner_id + member_user_id (+ optional profile_id)
//   household_invites  - owner_id + invited_email + token + status
//   favorites          - per USER: user_id + item_id + title + poster
//   watch_progress     - per USER: user_id + item_id + position_sec/duration_sec/percentage
//
// RLS enforces ownership (auth.uid() = user_id / id / owner_id), so these
// helpers never check ownership themselves — the database does. A caller with
// no valid session simply reads/writes nothing.

import { getSupabase } from "./auth";

async function uid(): Promise<string | null> {
  const { data } = await getSupabase().auth.getUser();
  return data.user?.id ?? null;
}

// ---------------------------------------------------------------------------
// Account / tier
// ---------------------------------------------------------------------------

export interface Account {
  id: string;
  email: string;
  tier: string;
  tier_expires: string | null;
  seats: number;
  must_change_password: boolean;
}

/** The logged-in user's account row (tier, expiry, seats). Null if not signed in. */
// The account row is read on every title open (the Watch Party button asks
// whether hosting is allowed), on the access gate, and by the billing panel.
// Each of those was a fresh round trip, which is why the Watch Party button
// took a visible couple of seconds to appear over the detail view.
//
// Short TTL rather than a permanent cache: tier changes when a webhook lands or
// an admin grants something, and a stale entitlement for a few seconds is
// harmless where a stale one for the session is not.
let accountCache: { at: number; value: Account | null } | null = null;
const ACCOUNT_TTL_MS = 30_000;

/** Drop the cached account. Call after anything that can change entitlement. */
export function invalidateAccount(): void { accountCache = null; }

export async function getAccount(): Promise<Account | null> {
  if (accountCache && Date.now() - accountCache.at < ACCOUNT_TTL_MS) return accountCache.value;
  const sb = getSupabase();

  // Wait for auth before asking. This used to lean on RLS to pick the row, so
  // a query issued before the client had hydrated its session matched NOTHING
  // and came back with no data and no error -- indistinguishable from "this
  // account does not exist". That is the paywall appearing for a founder
  // account, and the 30 second cache is what made a momentary race last long
  // enough to see and to need a sign-out to clear.
  const { data: u } = await sb.auth.getUser();
  if (!u.user) return null;               // not cached: this is a timing state

  const { data, error } = await sb
    .from("profiles")
    .select("id, email, tier, tier_expires, seats, must_change_password")
    .eq("id", u.user.id)
    .maybeSingle();
  // Distinguish a real failure (network/RLS/transient) from "no row". Callers
  // that gate access must fail OPEN on a thrown error, but may treat null (no
  // account row) as no access.
  // A thrown error is NOT cached: callers that gate access fail open on a throw,
  // and caching that would extend a transient network blip into 30 seconds of
  // wrongly-granted access.
  if (error) throw error;

  // Only a POSITIVE result is cached. A null means either the row genuinely
  // does not exist or something transient went wrong, and holding that for
  // thirty seconds turns a blip into a locked-out user.
  if (data) accountCache = { at: Date.now(), value: data as Account };
  return (data as Account) ?? null;
}

// Same maturity ladder the backend tags items with (kept in sync deliberately —
// frontend and backend can't share a module). Maps a profile's max_rating to the
// highest item.maturity it may see. Unknown/absent cap = 5 (no restriction).
const MATURITY_BY_RATING: Record<string, number> = {
  "TV-Y": 0, "TV-Y7": 1, "G": 2, "TV-G": 2, "PG": 3, "TV-PG": 3,
  "PG-13": 4, "TV-14": 4, "R": 5, "TV-MA": 5, "NC-17": 5,
};

export function maturityCeiling(maxRating?: string | null): number {
  if (!maxRating) return 5;
  return MATURITY_BY_RATING[maxRating.trim().toUpperCase()] ?? 5;
}

/** Filter catalog rails to what a profile is allowed to see, by item maturity.
 *  Empty rails are dropped. A ceiling of 5 (adult) returns everything. */
export function filterRailsByMaturity<T extends { items: any[] }>(rails: T[], ceiling: number): T[] {
  if (ceiling >= 5) return rails;
  return rails
    .map((r) => ({ ...r, items: r.items.filter((i: any) => (typeof i.maturity === "number" ? i.maturity : 5) <= ceiling) }))
    .filter((r) => r.items.length > 0);
}

// Kid-friendly genre/category signal (mirrors the backend KIDS_SIGNAL_RE). A kids
// profile only ever sees titles that are BOTH within the maturity ceiling AND
// carry a kid-friendly signal, so a G/TV-Y rated horror/crime/drama title can't
// leak into the kid view just because its rating is low.
const KIDS_SIGNAL_RE = /child|famil|preschool|\bkid|cartoon|animat|toon|nick|disney|sesame|pixar/i;
const KIDS_MAX_MATURITY = 2; // TV-Y7 and below

/** True if an item is safe for a kids profile: low maturity AND a kid genre signal. */
export function isKidsSafeItem(item: any, railName?: string): boolean {
  const maturity = typeof item?.maturity === "number" ? item.maturity : 5;
  if (maturity > KIDS_MAX_MATURITY) return false;
  const hay = `${item?.genre || ""} ${item?.category || ""} ${railName || ""}`;
  return KIDS_SIGNAL_RE.test(hay);
}

/** Kids-mode rail filter: keeps only kid-safe items (maturity + genre gate). */
export function filterRailsForKids<T extends { name?: string; items: any[] }>(rails: T[]): T[] {
  return rails
    .map((r) => ({ ...r, items: r.items.filter((i: any) => isKidsSafeItem(i, r.name)) }))
    .filter((r) => r.items.length > 0);
}

const PAID_TIERS = new Set(["founder_vip", "giveaway", "cloud_paid", "trial_7day", "trial_dollar_month"]);

/** Client-side access gate: an active, non-expired paid/trial tier.
 *
 *  THIS IS THE ONLY GATE ON BROWSING. The comment here used to say server RLS
 *  (has_active_access) was the real enforcement and this merely drove the UI.
 *  No such function exists in any migration -- it was never written -- so
 *  anyone willing to edit the client can browse the catalogue while lapsed.
 *
 *  Left alone deliberately, and written down rather than quietly patched: what
 *  is behind this gate is Pluto, Tubi and Internet Archive listings, which are
 *  public and free to reach directly. The account's own data -- household
 *  profiles, favorites, watch_progress -- is RLS'd by user_id and genuinely
 *  protected. Hosting and joining parties are enforced in the database, because
 *  those cost us money. This one is a conversion boundary, not a security one,
 *  and saying so is worth more than a claim that fails the first time somebody
 *  relies on it. */
export async function hasActiveAccess(): Promise<boolean> {
  const acct = await getAccount();

  // No row for a signed-in user is an ANOMALY, not a lapsed subscription. A
  // lapsed account still has a row, with tier 'canceled'. Treating a missing
  // one as no access is what put a paywall in front of a founder account
  // whenever the row could not be read.
  if (!acct) {
    const { data: u } = await getSupabase().auth.getUser();
    return !!u.user;   // signed in but unreadable: fail open, do not lock out
  }

  if (!PAID_TIERS.has(acct.tier)) return false;
  if (acct.tier_expires && new Date(acct.tier_expires).getTime() < Date.now()) return false;
  return true;
}

/** Entitlement is TWO-DIMENSIONAL, not one boolean.
 *
 *  hasActiveAccess  -> may browse and stream the catalogue
 *  canJoinParty     -> may join a watch party someone else is hosting
 *
 *  A lapsed account keeps the second. The marginal cost of a viewer is zero --
 *  streams come from the providers, not from us -- so walling someone out
 *  entirely converts a live prospect into a lost one for no saving. A guest can
 *  only watch what a host chose, when the host chose it, which is a genuinely
 *  lesser product than a subscription rather than a substitute for one.
 *
 *  Deliberately derived rather than a new tier: "signed in but not entitled" is
 *  already expressible, and a `party_guest` tier would be a second source of
 *  truth that the Stripe webhook would have to learn not to overwrite.
 */
export interface PartyJoinAllowance {
  entitled: boolean;
  used: number;
  limit: number;
  remaining: number;
  can_join: boolean;
}

/** How many parties this account may still be in this month.
 *
 *  Asked of the database rather than counted here, because the RLS policy on
 *  party_joins is the real limit and two implementations of one rule drift.
 *  This one exists to EXPLAIN the limit before somebody hits it; the policy is
 *  what holds when they open the console.
 *
 *  Null on any failure, and every caller treats null as "let them through". A
 *  transient read error must not look like a spent allowance -- the insert will
 *  be refused by the policy if it genuinely is. */
export async function partyJoinAllowance(): Promise<PartyJoinAllowance | null> {
  const { data, error } = await getSupabase().rpc("party_join_allowance");
  if (error) { console.warn("[party] allowance", error); return null; }
  return (data as PartyJoinAllowance) ?? null;
}

/** May this account join another party right now?
 *
 *  Unlimited on a plan. Four a month otherwise -- enough to be in the thing a
 *  friend keeps inviting you to and decide whether you want your own account,
 *  not enough to be a standing Friday arrangement on somebody else's bill. */
export async function canJoinParty(): Promise<boolean> {
  const { data } = await getSupabase().auth.getUser();
  if (!data.user) return false;
  const a = await partyJoinAllowance();
  return a ? a.can_join : true;   // unreadable: let RLS decide
}

/** Days left in the current trial/subscription (null if none or already expired). */
export async function trialDaysLeft(): Promise<number | null> {
  const acct = await getAccount();
  if (!acct?.tier_expires) return null;
  const ms = new Date(acct.tier_expires).getTime() - Date.now();
  return ms > 0 ? Math.ceil(ms / 86_400_000) : 0;
}

// ---------------------------------------------------------------------------
// Billing (Stripe)
// ---------------------------------------------------------------------------

async function authedPost(path: string): Promise<any> {
  const { data } = await getSupabase().auth.getSession();
  const token = data.session?.access_token;
  const res = await fetch(path, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
  return res.json();
}

/** Redirect to Stripe Checkout for the $4/mo subscription. */
export async function startCheckout(): Promise<void> {
  const { url } = await authedPost("/api/billing/checkout");
  if (url) window.location.href = url;
}

/** Redirect to the Stripe Customer Portal to manage/cancel. */
export async function openBillingPortal(): Promise<void> {
  const { url } = await authedPost("/api/billing/portal");
  if (url) window.location.href = url;
}

// ---------------------------------------------------------------------------
// Popularity (aggregate, cross-household) — drives the "Popular on veedeeoh" rail.
// Backed by a SECURITY DEFINER RPC that only returns counts, never rows.
// ---------------------------------------------------------------------------

export interface PopularContent {
  content_id: string;
  title: string | null;
  plays: number;
}

/** Top content_ids by aggregate play count. Empty (and the rail hides) until
 *  there's enough real watch data. */
export async function getPopularContentIds(max = 20): Promise<PopularContent[]> {
  try {
    const { data, error } = await getSupabase().rpc("popular_content", { max_rows: max });
    if (error || !Array.isArray(data)) return [];
    return data as PopularContent[];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Household profiles ("Who's Watching?" avatars)
// ---------------------------------------------------------------------------

export interface HouseholdProfile {
  id: string;
  user_id: string;
  name: string;
  avatar_color: string;
  avatar_url?: string | null;
  /** How avatar_url was generated. Editor-only; see the migration. */
  avatar_recipe?: { style: string; seed: string; choices: Record<string, string> } | null;
  is_kids: boolean;
  /** Legacy single ceiling. Superseded by allowed_ratings; kept so existing
   *  profiles keep working until a parent edits them. */
  max_rating: string | null;
  /** Explicit permitted ratings. null means unrestricted. */
  allowed_ratings?: string[] | null;
  pin: string | null;
}

export async function listProfiles(): Promise<HouseholdProfile[]> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from("household_profiles")
    .select("*")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as HouseholdProfile[];
}

export async function createProfile(fields: {
  name: string;
  avatar_color?: string;
  avatar_url?: string | null;
  avatar_recipe?: { style: string; seed: string; choices: Record<string, string> } | null;
  is_kids?: boolean;
  max_rating?: string;
  allowed_ratings?: string[] | null;
  pin?: string | null;
}): Promise<HouseholdProfile> {
  const sb = getSupabase();
  const user_id = await uid();
  if (!user_id) throw new Error("not signed in");
  const { data, error } = await sb
    .from("household_profiles")
    .insert({ user_id, ...fields })
    .select()
    .single();
  if (error) throw error;
  return data as HouseholdProfile;
}

export async function updateProfile(
  profileId: string,
  fields: Partial<Pick<HouseholdProfile, "name" | "avatar_color" | "avatar_url" | "avatar_recipe" | "is_kids" | "max_rating" | "pin">>
): Promise<void> {
  const sb = getSupabase();
  const { error } = await sb.from("household_profiles").update(fields).eq("id", profileId);
  if (error) throw error;
}

export async function deleteProfile(profileId: string): Promise<void> {
  const sb = getSupabase();
  const { error } = await sb.from("household_profiles").delete().eq("id", profileId);
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Favorites — per PROFILE (Netflix "My List"). Each profile has its own.
// ---------------------------------------------------------------------------

export interface Favorite {
  content_id: string;
  title: string | null;
  poster: string | null;
}

export async function listFavorites(profileId: string): Promise<Favorite[]> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from("favorites")
    .select("content_id, title, poster")
    .eq("profile_id", profileId);
  if (error) throw error;
  return (data ?? []) as Favorite[];
}

export async function addFavorite(profileId: string, fav: Favorite): Promise<void> {
  const sb = getSupabase();
  const { error } = await sb
    .from("favorites")
    .upsert({ profile_id: profileId, ...fav }, { onConflict: "profile_id,content_id" });
  if (error) throw error;
}

export async function removeFavorite(profileId: string, contentId: string): Promise<void> {
  const sb = getSupabase();
  const { error } = await sb
    .from("favorites")
    .delete()
    .eq("profile_id", profileId)
    .eq("content_id", contentId);
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Watch progress — per PROFILE (Netflix "Continue Watching"). Resume + done.
// ---------------------------------------------------------------------------

export interface WatchRow {
  content_id: string;
  title: string | null;
  position_secs: number;
  duration_secs: number | null;
  completed: boolean;
}

export async function listProgress(profileId: string): Promise<WatchRow[]> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from("watch_progress")
    .select("content_id, title, position_secs, duration_secs, completed")
    .eq("profile_id", profileId)
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as WatchRow[];
}

export async function saveProgress(profileId: string, row: {
  content_id: string;
  title?: string | null;
  position_secs: number;
  duration_secs?: number | null;
}): Promise<void> {
  const sb = getSupabase();
  const completed = !!row.duration_secs && row.position_secs >= row.duration_secs - 60;
  const { error } = await sb.from("watch_progress").upsert(
    {
      profile_id: profileId,
      content_id: row.content_id,
      title: row.title,
      position_secs: Math.floor(row.position_secs),
      duration_secs: row.duration_secs != null ? Math.floor(row.duration_secs) : null,
      updated_at: new Date().toISOString(),
      completed,
    },
    { onConflict: "profile_id,content_id" }
  );
  if (error) console.warn("[db] saveProgress error", error);
}

export async function getWatchHistory(profileId: string): Promise<any[]> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from("watch_progress")
    .select("*")
    .eq("profile_id", profileId)
    .order("updated_at", { ascending: false })
    // Fetches more than the rail shows. The merge drops anything already
    // finished and anything missing from the current catalogue, so pulling
    // exactly the display count left the rail short whenever a row aged out.
    .limit(40);
  if (error) {
    console.warn("[db] getWatchHistory error", error);
    return [];
  }
  return data ?? [];
}

// ---------------------------------------------------------------------------
// Invites (owner creates; token-based). Note: accepting an invite writes to
// household_members, which currently has no INSERT policy — that flow needs a
// SECURITY DEFINER RPC (accept_household_invite) still to be added.
// ---------------------------------------------------------------------------

export interface HouseholdInvite {
  id: string;
  invited_email: string;
  profile_name: string | null;
  token: string;
  status: string;
  created_at: string;
}

export async function listInvites(): Promise<HouseholdInvite[]> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from("household_invites")
    .select("id, invited_email, profile_name, token, status, created_at")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as HouseholdInvite[];
}

/** Owner creates an invite; token is generated by the DB default. */
export async function createInvite(invitedEmail: string, profileName?: string): Promise<HouseholdInvite> {
  const sb = getSupabase();
  const owner_id = await uid();
  if (!owner_id) throw new Error("not signed in");
  const { data, error } = await sb
    .from("household_invites")
    .insert({ owner_id, invited_email: invitedEmail, profile_name: profileName ?? null })
    .select()
    .single();
  if (error) throw error;
  return data as HouseholdInvite;
}

export async function revokeInvite(inviteId: string): Promise<void> {
  const sb = getSupabase();
  const { error } = await sb.from("household_invites").update({ status: "revoked" }).eq("id", inviteId);
  if (error) throw error;
}

/** Invitee accepts a token and joins the owner's household; returns owner_id. */
export async function acceptInvite(token: string): Promise<string> {
  const sb = getSupabase();
  const { data, error } = await sb.rpc("accept_household_invite", { invite_token: token });
  if (error) throw error;
  return data as string;
}

// ---------------------------------------------------------------------------
// Curated collections (household side)
//
// See docs/plans/2026-08-21-curated-content-collections-design.md. Platform
// collections are the operator-curated baseline; a household layers its own
// picks on top and its own exclusions over everything. Exclusions always win.
// ---------------------------------------------------------------------------

export interface Collection {
  id: string;
  scope: "platform" | "household";
  name: string;
  min_age: number | null;
  show_as_tab: boolean;
}

/** Platform collections plus this household's own, in one call. RLS decides
 *  what comes back: platform rows are world-readable, household rows are not. */
export async function listCollections(): Promise<Collection[]> {
  const { data, error } = await getSupabase()
    .from("collections")
    .select("id, scope, name, min_age, show_as_tab");
  if (error) { console.warn("[db] listCollections", error); return []; }
  return (data ?? []) as Collection[];
}

/** Content ids visible at or below a maturity tier, from every collection the
 *  caller can see. Used to build the approved set for a restricted profile. */
export async function listApprovedContent(maxAge: number): Promise<Set<string>> {
  const sb = getSupabase();
  const { data: cols, error: e1 } = await sb
    .from("collections").select("id").not("min_age", "is", null).lte("min_age", maxAge);
  if (e1 || !cols?.length) return new Set();
  const { data, error } = await sb
    .from("collection_items").select("content_id")
    .in("collection_id", cols.map((c: any) => c.id));
  if (error) { console.warn("[db] listApprovedContent", error); return new Set(); }
  return new Set((data ?? []).map((r: any) => r.content_id));
}

/** Add a title to one of this household's collections, creating it on demand. */
export async function allowForAge(minAge: number, item: { id: string; isSeries?: boolean }): Promise<void> {
  const sb = getSupabase();
  const { data: user } = await sb.auth.getUser();
  const owner = user.user?.id;
  if (!owner) throw new Error("not signed in");

  const name = minAge === 0 ? "Allowed: Little Kids" : minAge === 1 ? "Allowed: Older Kids" : "Allowed: Teen";
  let { data: found } = await sb.from("collections")
    .select("id").eq("scope", "household").eq("owner_id", owner).eq("name", name).maybeSingle();

  let id = found?.id;
  if (!id) {
    const { data, error } = await sb.from("collections")
      .insert({ scope: "household", owner_id: owner, name, min_age: minAge, show_as_tab: false })
      .select("id").single();
    if (error) throw error;
    id = data.id;
  }
  const { error } = await sb.from("collection_items")
    .upsert({ collection_id: id, content_id: item.id, kind: item.isSeries ? "series" : "title" });
  if (error) throw error;
}

/** Hide a title from one profile. Exclusions beat every collection, so this is
 *  how a parent overrules an operator pick they disagree with. */
export async function excludeFromProfile(profileId: string, contentId: string): Promise<void> {
  const { data: user } = await getSupabase().auth.getUser();
  const owner = user.user?.id;
  if (!owner) throw new Error("not signed in");
  const { error } = await getSupabase().from("profile_exclusions")
    .upsert({ profile_id: profileId, content_id: contentId, owner_id: owner });
  if (error) throw error;
}

export async function unexcludeFromProfile(profileId: string, contentId: string): Promise<void> {
  const { error } = await getSupabase().from("profile_exclusions")
    .delete().eq("profile_id", profileId).eq("content_id", contentId);
  if (error) throw error;
}

export async function listExclusions(profileId: string): Promise<Set<string>> {
  const { data, error } = await getSupabase()
    .from("profile_exclusions").select("content_id").eq("profile_id", profileId);
  if (error) { console.warn("[db] listExclusions", error); return new Set(); }
  return new Set((data ?? []).map((r: any) => r.content_id));
}

// ---------------------------------------------------------------------------
// Gating for restricted profiles
//
// Only the TV Parental Guidelines are trusted to gate automatically. They were
// introduced in 1997, so a TV rating cannot suffer the drift that makes MPAA
// letters unreliable: PG-13 did not exist until 1984, so pre-1984 PG absorbed
// what would now be PG-13 (Airplane!, 1980, is rated PG and has nudity). Old G
// drifted similarly. We have no release year for Pluto titles -- 56% of the
// catalog -- so era cannot even be detected, let alone corrected for.
//
// So: TV-rated content within the profile's ceiling is admitted automatically.
// Everything else -- every MPAA letter, every unrated title -- is opt-in, and
// reaches a restricted profile only if a human put it in a collection.
// ---------------------------------------------------------------------------

const TV_MATURITY: Record<string, number> = {
  "TV-Y": 0, "TV-Y7": 1, "TV-Y7-FV": 1, "TV-G": 2, "TV-PG": 3, "TV-14": 4, "TV-MA": 5,
};

export function isTvRated(rating?: string | null): boolean {
  return !!rating && Object.prototype.hasOwnProperty.call(TV_MATURITY, rating.trim().toUpperCase());
}

export function tvMaturity(rating?: string | null): number | null {
  if (!rating) return null;
  const m = TV_MATURITY[rating.trim().toUpperCase()];
  return m === undefined ? null : m;
}

/** Content a restricted profile may see: TV-rated within its ceiling, plus
 *  anything explicitly approved. Approvals bypass the rating test entirely --
 *  that is the point of them, and how a G-rated film a parent trusts gets in. */
export function filterRailsForGatedProfile<T extends { items: any[] }>(
  rails: T[],
  allowed: Set<string>,
  approved: Set<string>,
): T[] {
  return rails
    .map((r) => ({
      ...r,
      items: r.items.filter((i: any) => {
        if (approved.has(String(i.id))) return true;
        const r0 = (i.rating || "").trim().toUpperCase();
        return !!r0 && allowed.has(r0);
      }),
    }))
    .filter((r) => r.items.length > 0);
}

/** Every rating a profile permits. Prefers the explicit set; falls back to
 *  expanding the legacy ceiling so a profile saved before the change keeps
 *  behaving identically. Returns null for an unrestricted profile. */
export function allowedRatingsFor(p: { allowed_ratings?: string[] | null; max_rating?: string | null }): Set<string> | null {
  if (p.allowed_ratings?.length) return new Set(p.allowed_ratings.map((r) => r.trim().toUpperCase()));
  if (!p.max_rating) return null;
  const ceiling = MATURITY_BY_RATING[p.max_rating.trim().toUpperCase()];
  if (ceiling === undefined) return new Set();               // unknown cap: allow nothing
  // A cap at the top of the ladder was never a restriction -- filterRailsByMaturity
  // short-circuited on it and showed everything. Expanding it into "TV ratings
  // only" would quietly strip every film from profiles that had no limit.
  if (ceiling >= 5) return null;
  const out = new Set<string>();
  for (const [rating, m] of Object.entries(TV_MATURITY)) if (m <= ceiling) out.add(rating);
  return out;
}

/** Ratings offered when building a profile, grouped by the system they come
 *  from. Kept in one place so the editor and the gate cannot drift apart. */
export const RATING_GROUPS: { system: string; note: string; ratings: { code: string; label: string }[] }[] = [
  {
    system: "TV Parental Guidelines",
    note: "Introduced 1997, so these have not drifted.",
    ratings: [
      { code: "TV-Y", label: "TV-Y · all children, ages 2-6" },
      { code: "TV-Y7", label: "TV-Y7 · age 7+, mild fantasy violence" },
      { code: "TV-G", label: "TV-G · all ages, not made for children" },
      { code: "TV-PG", label: "TV-PG · parental guidance suggested" },
      { code: "TV-14", label: "TV-14 · unsuitable under 14" },
      { code: "TV-MA", label: "TV-MA · adults only" },
    ],
  },
  {
    system: "MPAA film ratings",
    note: "Meanings changed over time. Older films carry ratings that would be stricter today.",
    ratings: [
      { code: "G", label: "G · general audiences" },
      { code: "PG", label: "PG · parental guidance" },
      { code: "PG-13", label: "PG-13 · unsuitable under 13" },
      { code: "R", label: "R · restricted" },
      { code: "NC-17", label: "NC-17 · adults only" },
    ],
  },
];

/** A household "section" is a collection that shows as a sidebar tab. Same
 *  mechanism as the kids collections, different scope -- one concept, two uses. */
export async function createSection(name: string): Promise<string> {
  const sb = getSupabase();
  const { data: user } = await sb.auth.getUser();
  const owner = user.user?.id;
  if (!owner) throw new Error("not signed in");
  const { data, error } = await sb.from("collections")
    .insert({ scope: "household", owner_id: owner, name, min_age: null, show_as_tab: true })
    .select("id").single();
  if (error) throw error;
  return data.id as string;
}

export async function addToCollection(collectionId: string, contentId: string, isSeries = false): Promise<void> {
  const { error } = await getSupabase().from("collection_items")
    .upsert({ collection_id: collectionId, content_id: contentId, kind: isSeries ? "series" : "title" });
  if (error) throw error;
}

export async function listCollectionItems(collectionId: string): Promise<string[]> {
  const { data, error } = await getSupabase()
    .from("collection_items").select("content_id").eq("collection_id", collectionId);
  if (error) { console.warn("[db] listCollectionItems", error); return []; }
  return (data ?? []).map((r: any) => r.content_id);
}

// ------------------------------------------------------------- referrals ---
//
// Attribution is first-touch and permanent, enforced by the definer functions
// in the database rather than here. The client's only jobs are to remember a
// ?ref= code across the sign-up round trip and to hand it over once there is a
// session to attach it to.

const REF_PENDING_KEY = "veedeeoh_pending_ref";

export interface ReferralSummary {
  referred: number;
  converted: number;
  pending_cents: number;
  paid_cents: number;
}

/** Stash a ?ref= code seen before sign-in. Kept until it is either redeemed or
 *  superseded, because the sign-up flow leaves the page (OAuth, magic link). */
export function rememberReferral(code: string): void {
  try { localStorage.setItem(REF_PENDING_KEY, code.toUpperCase()); } catch {}
}

/** Redeem a stashed code, if any. Safe to call on every boot: the function is
 *  a no-op once the account already has a referrer. */
export async function redeemPendingReferral(): Promise<void> {
  let code: string | null = null;
  try { code = localStorage.getItem(REF_PENDING_KEY); } catch {}
  if (!code) return;

  const { data: user } = await getSupabase().auth.getUser();
  if (!user.user) return;                       // still anonymous; try next boot

  const { data, error } = await getSupabase().rpc("attribute_referral", {
    ref_code: code, src: "link", party: null,
  });
  if (error) { console.warn("[referral] attribute failed", error); return; }

  // Clear on any definitive answer -- success, already attributed, unknown
  // code, self-referral. Only a transport error is worth retrying, and that
  // returns above with the code still stored.
  try { localStorage.removeItem(REF_PENDING_KEY); } catch {}
  if ((data as any)?.ok === false) console.info("[referral]", (data as any).error);
}

/** The caller's own referral code, minted on first request. */
export async function myReferralCode(): Promise<string | null> {
  const { data, error } = await getSupabase().rpc("ensure_referral_code");
  if (error) { console.warn("[referral] ensure code", error); return null; }
  return (data as string) || null;
}

export function referralLink(code: string): string {
  return `${location.origin}/?ref=${code}`;
}

export async function referralSummary(): Promise<ReferralSummary | null> {
  const { data, error } = await getSupabase().rpc("referral_summary");
  if (error) { console.warn("[referral] summary", error); return null; }
  return data as ReferralSummary;
}

export interface ReferralTerms {
  code: string;
  kind: "user" | "partner";
  rate_bps: number;
  duration_months: number;
}

/** The caller's own affiliate terms. Partners carry a negotiated rate, so the
 *  page must read the row rather than print the 20%/12mo default at everyone. */
export async function myReferralTerms(): Promise<ReferralTerms | null> {
  const { data, error } = await getSupabase()
    .from("referral_codes")
    .select("code, kind, rate_bps, duration_months")
    .maybeSingle();
  if (error) { console.warn("[referral] terms", error); return null; }
  return (data as ReferralTerms) ?? null;
}

/** Where this affiliate's referrals came from. Counted client-side over the
 *  referrer's own rows -- RLS already scopes the select, and the row count is
 *  small enough that a grouped RPC would be premature. */
export async function referralsBySource(): Promise<Record<string, number>> {
  const { data, error } = await getSupabase()
    .from("referrals")
    .select("source, first_paid_at");
  if (error) { console.warn("[referral] sources", error); return {}; }
  const out: Record<string, number> = {};
  for (const r of (data ?? []) as Array<{ source: string }>) {
    out[r.source] = (out[r.source] || 0) + 1;
  }
  return out;
}

// ------------------------------------------------------- watch party credits ---

export interface PartyCreditSummary {
  balance: number;
  exempt: boolean;
  accrued: number;
  spent: number;
  cap: number;
  to_free_accrued: number;
  to_free_spent: number;
  free_months_this_year: number;
}

/** Top up the monthly allowance if it is due, then return the summary.
 *
 *  Called before hosting rather than relying on the Stripe webhook alone: a
 *  comped account never produces an invoice, so it would otherwise sit at zero
 *  credits forever and be told it is out of hours it was never given. */
export async function ensurePartyCredits(): Promise<PartyCreditSummary | null> {
  const { data, error } = await getSupabase().rpc("ensure_party_credits");
  if (error) { console.warn("[credits] ensure", error); return null; }
  const out = data as any;
  return out && out.ok === false ? null : (out as PartyCreditSummary);
}

export async function partyCreditSummary(): Promise<PartyCreditSummary | null> {
  const { data, error } = await getSupabase().rpc("party_credit_summary");
  if (error) { console.warn("[credits] summary", error); return null; }
  return (data as PartyCreditSummary) ?? null;
}

/** Charge the host for a stretch of hosting. Returns false when the balance is
 *  short, so the caller can warn rather than fail the party outright. */
export async function spendPartyCredits(minutes: number, partyId?: string): Promise<boolean> {
  const { data, error } = await getSupabase()
    .rpc("spend_party_credits", { minutes, party: partyId ?? null });
  if (error) { console.warn("[credits] spend", error); return false; }
  return !!(data as any)?.ok;
}

/** Redirect to one-time Checkout for a top-up. */
export async function buyPartyCredits(): Promise<void> {
  const { url } = await authedPost("/api/billing/credits");
  if (url) window.location.href = url;
}

// ------------------------------------------------- host channel (socials) ---

export interface HostSocial { platform: string | null; handle: string | null }

export async function getHostSocial(): Promise<HostSocial> {
  // Filtered explicitly rather than left to RLS. The same omission in
  // getAccount() was what intermittently paywalled a paying account: a query
  // issued before the session had hydrated came back with no row AND no error,
  // which is indistinguishable from "you have not set one".
  const { data: u } = await getSupabase().auth.getUser();
  if (!u.user) return { platform: null, handle: null };
  const { data } = await getSupabase()
    .from("profiles").select("social_platform, social_handle")
    .eq("id", u.user.id).maybeSingle();
  return { platform: data?.social_platform ?? null, handle: data?.social_handle ?? null };
}

/** Platform and handle, never a URL. The database also pattern-checks the
 *  handle, so a link cannot be smuggled in through this field. */
export async function setHostSocial(platform: string | null, handle: string | null): Promise<void> {
  const { data: u } = await getSupabase().auth.getUser();
  if (!u.user) throw new Error("not signed in");
  const clean = (handle || "").trim().replace(/^@/, "");
  const { error } = await getSupabase().from("profiles").update({
    social_platform: clean ? platform : null,
    social_handle: clean || null,
  }).eq("id", u.user.id);
  if (error) throw error;
}
