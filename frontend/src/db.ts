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
export async function getAccount(): Promise<Account | null> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from("profiles")
    .select("id, email, tier, tier_expires, seats, must_change_password")
    .maybeSingle();
  // Distinguish a real failure (network/RLS/transient) from "no row". Callers
  // that gate access must fail OPEN on a thrown error, but may treat null (no
  // account row) as no access.
  if (error) throw error;
  if (!data) return null;
  return data as Account;
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

/** Client-side access gate: an active, non-expired paid/trial tier. Server RLS
 *  (has_active_access) is the real enforcement; this drives the UI. */
export async function hasActiveAccess(): Promise<boolean> {
  const acct = await getAccount();
  if (!acct || !PAID_TIERS.has(acct.tier)) return false;
  if (acct.tier_expires && new Date(acct.tier_expires).getTime() < Date.now()) return false;
  return true;
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
  is_kids: boolean;
  max_rating: string | null;
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
  is_kids?: boolean;
  max_rating?: string;
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
  fields: Partial<Pick<HouseholdProfile, "name" | "avatar_color" | "avatar_url" | "is_kids" | "max_rating" | "pin">>
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
    .limit(15);
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
  ceiling: number,
  approved: Set<string>,
): T[] {
  return rails
    .map((r) => ({
      ...r,
      items: r.items.filter((i: any) => {
        if (approved.has(String(i.id))) return true;
        const m = tvMaturity(i.rating);
        return m !== null && m <= ceiling;
      }),
    }))
    .filter((r) => r.items.length > 0);
}
