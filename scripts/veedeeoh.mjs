#!/usr/bin/env node
// veedeeoh control panel — local only.
//
// Runs on localhost and holds the privileged keys from .env, so nothing
// admin-related ever ships to users and there is no public endpoint to secure.
// Resolves the repo from its OWN path, not the cwd, so `veedeeoh` works from
// any directory once npm-linked.

import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));
const SITE = process.env.VEEDEEOH_SITE || "https://veedeeoh.com";

function loadEnv() {
  const f = join(REPO, ".env");
  if (!existsSync(f)) return {};
  const out = {};
  for (const line of readFileSync(f, "utf8").split("\n")) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  return out;
}
const ENV = { ...loadEnv(), ...process.env };

const SUPABASE_URL = ENV.SUPABASE_URL || ENV.VITE_SUPABASE_URL;
const SERVICE_KEY = ENV.SUPABASE_SERVICE_ROLE_KEY;
const CRON_SECRET = ENV.CRON_SECRET;

const missing = [
  !SUPABASE_URL && "SUPABASE_URL",
  !SERVICE_KEY && "SUPABASE_SERVICE_ROLE_KEY",
  !CRON_SECRET && "CRON_SECRET",
].filter(Boolean);
if (missing.length) {
  console.error(`\n  Missing from ${join(REPO, ".env")}: ${missing.join(", ")}`);
  console.error("  The panel needs these to reach production. Add them and re-run.\n");
  process.exit(1);
}

const sb = (path, init = {}) =>
  fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });

// ---------------------------------------------------------------- catalog ---
async function catalogStatus() {
  const t0 = Date.now();
  const res = await fetch(`${SITE}/api/vod?cb=${Date.now()}`);
  const bytes = Number(res.headers.get("content-length")) || 0;
  const j = await res.json();
  const ms = Date.now() - t0;
  const items = (j.rails || []).flatMap((r) => r.items || []);
  const kidsRails = (j.rails || []).filter((r) => /kid|famil/i.test(r.name || ""));
  const by = (p) => items.filter((i) => String(i.id || "").startsWith(p)).length;
  return {
    updatedAt: Number(j.updatedAt) || null,
    ageHours: j.updatedAt ? (Date.now() - Number(j.updatedAt)) / 3600000 : null,
    titles: items.length,
    rails: (j.rails || []).length,
    bytes: bytes || JSON.stringify(j).length,
    loadMs: ms,
    providers: { pluto: items.filter((i) => i.pluto_path).length, tubi: by("tubi:"), archive: by("archive:") },
    archiveInKids: kidsRails.flatMap((r) => r.items || []).filter((i) => String(i.id || "").startsWith("archive:")).length,
  };
}

async function rebuildCatalog() {
  const res = await fetch(`${SITE}/api/cron/catalog-warm`, { headers: { Authorization: `Bearer ${CRON_SECRET}` } });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, ...body };
}

// --------------------------------------------------------------- providers ---
// Sends a REAL CORS preflight, not just a GET. A plain GET check passed at
// every hop while the browser path was dead on a 405 preflight; a health check
// that tests the wrong request shape reports green while users see black.
async function checkProviders() {
  const out = [];
  const j = await (await fetch(`${SITE}/api/vod`)).json();
  const items = (j.rails || []).flatMap((r) => r.items || []);

  // Pluto: resolve -> preflight -> manifest
  const pl = items.find((i) => i.pluto_path);
  if (pl) {
    const step = { provider: "Pluto", title: pl.title, steps: [] };
    try {
      const r = await fetch(`${SITE}/api/vod/pluto?path=${encodeURIComponent(pl.pluto_path)}`);
      const { url } = await r.json();
      step.steps.push({ name: "resolve signed url", ok: r.ok, detail: String(r.status) });
      const px = `${SITE}/proxy?url=${encodeURIComponent(url)}`;
      const pf = await fetch(px, { method: "OPTIONS", headers: { Origin: SITE, "Access-Control-Request-Method": "GET", "Access-Control-Request-Headers": "range" } });
      step.steps.push({ name: "CORS preflight", ok: pf.status === 204 || pf.ok, detail: String(pf.status) });
      const m = await fetch(px, { headers: { Origin: SITE } });
      step.steps.push({ name: "manifest via proxy", ok: m.ok, detail: `${m.status} · CORS ${m.headers.get("access-control-allow-origin") || "none"}` });
    } catch (e) { step.steps.push({ name: "error", ok: false, detail: e.message }); }
    step.ok = step.steps.every((s) => s.ok);
    out.push(step);
  }

  // Tubi: resolve on click, direct CDN
  const tb = items.find((i) => String(i.id || "").startsWith("tubi:") && !i.series_id);
  if (tb) {
    const step = { provider: "Tubi", title: tb.title, steps: [] };
    try {
      const r = await fetch(`${SITE}/api/vod/tubi/${encodeURIComponent(String(tb.id).replace("tubi:", ""))}`);
      const { url, error } = await r.json();
      step.steps.push({ name: "resolve stream", ok: r.ok && !!url, detail: error || String(r.status) });
      if (url) {
        const m = await fetch(url, { headers: { Origin: SITE } });
        step.steps.push({ name: "manifest direct", ok: m.ok, detail: `${m.status} · CORS ${m.headers.get("access-control-allow-origin") || "none"}` });
      }
    } catch (e) { step.steps.push({ name: "error", ok: false, detail: e.message }); }
    step.ok = step.steps.every((s) => s.ok);
    out.push(step);
  }

  // Internet Archive: progressive mp4
  const ar = items.find((i) => String(i.id || "").startsWith("archive:") && i.identifier);
  if (ar) {
    const step = { provider: "Internet Archive", title: ar.title, steps: [] };
    try {
      const r = await fetch(`${SITE}/api/vod/archive/${encodeURIComponent(ar.identifier)}`);
      const { url } = await r.json();
      step.steps.push({ name: "resolve stream", ok: r.ok && !!url, detail: String(r.status) });
      if (url) {
        // Range GET, not HEAD: match what a player actually sends. And retry
        // once — archive.org intermittently 500s the same URL that works
        // seconds later, so a single failed probe is not a real outage.
        let m = await fetch(url, { headers: { Range: "bytes=0-1023" } });
        if (!m.ok) {
          await new Promise((r) => setTimeout(r, 1200));
          m = await fetch(url, { headers: { Range: "bytes=0-1023" } });
        }
        step.steps.push({
          name: "media reachable",
          ok: m.ok,
          detail: m.ok ? `${m.status} · ${m.headers.get("content-type") || "?"}` : `${m.status} (archive.org is flaky; retried once)`,
        });
      }
    } catch (e) { step.steps.push({ name: "error", ok: false, detail: e.message }); }
    step.ok = step.steps.every((s) => s.ok);
    out.push(step);
  }
  return out;
}

// ---------------------------------------------------------------- invites ---
const RESEND_KEY = ENV.RESEND_API_KEY || ENV.RESENT_API_KEY;

function inviteCode() {
  // Unambiguous alphabet: no O/0, I/1, so it survives being read aloud.
  const A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 10 }, () => A[Math.floor(Math.random() * A.length)]).join("");
}

// Editions. One invite pipeline, several audiences -- a founder comp, a beta
// tester, an affiliate partner and a personal comp all need different copy and
// different terms, and picking the wrong one is easy to do by hand. Keeping the
// copy and the granted tier together in one record is what stops the email
// promising something the tier does not actually grant.
const EDITIONS = {
  founder: {
    label: "Founder",
    subject: "You're a veedeeoh founder",
    heading: "You're in.",
    lede: "You've been invited to the veedeeoh beta. Thousands of free movies and TV shows in one app, with profiles and parental controls for the whole household.",
    grant: "founder access, free for as long as veedeeoh runs",
    // Preset only. Every field is overridable in the panel before sending --
    // the presets exist so the common case is one click, not so the controls
    // are hidden.
    grants: { tier: "founder_vip", tier_days: null, party_credits_exempt: true },
  },
  beta: {
    label: "Beta tester",
    subject: "Your veedeeoh beta invite",
    heading: "Want to break something?",
    lede: "You've been invited to test veedeeoh before it opens up. Thousands of free movies and TV shows in one app, with profiles and parental controls for the whole household. Expect rough edges -- that's the point.",
    grant: "full access for the length of the beta",
    grants: { tier: "founder_vip", tier_days: 180, party_credits: 60 },
  },
  partner: {
    label: "Affiliate partner",
    subject: "Your veedeeoh partner account",
    heading: "Let's work together.",
    lede: "Here's your veedeeoh partner account. Thousands of free movies and TV shows in one app, with profiles and parental controls for the whole household.",
    grant: "full access plus a partner share of every subscription you refer",
    extra: "Your referral link is in Settings once you sign in. Anyone who joins a watch party you host is credited to you as well, with no link needed.",
    grants: {
      tier: "founder_vip", tier_days: null, party_credits_exempt: true,
      referral_kind: "partner", referral_rate_bps: 3000, referral_duration_months: 0,
    },
  },
  comp: {
    label: "Friends and family",
    subject: "veedeeoh, on me",
    heading: "This one's on me.",
    lede: "I built veedeeoh: thousands of free movies and TV shows in one app, with profiles and parental controls for the whole household. Here's an account, no charge.",
    grant: "full access, on the house, permanently",
    grants: { tier: "founder_vip", tier_days: null, party_credits_exempt: true },
  },
};

function inviteEmailHtml(code, edition) {
  const ed = EDITIONS[edition] || EDITIONS.founder;
  const link = `${SITE}/landing.html?beta=${code}`;
  return `
  <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;background-color:#0b0f19;color:#f3f4f6;border-radius:12px;border:1px solid #1f293d;">
    <div style="margin-bottom:24px;"><span style="font-size:24px;font-weight:800;color:#ffffff;">veedeeoh</span><span style="color:#c5f04e;font-size:24px;font-weight:800;">.</span></div>
    <h1 style="font-size:22px;font-weight:700;margin-bottom:16px;color:#ffffff;">${ed.heading}</h1>
    <p style="font-size:15px;line-height:1.6;color:#9ca3af;margin-bottom:20px;">
      ${ed.lede}
    </p>
    <p style="font-size:15px;line-height:1.6;color:#9ca3af;margin-bottom:24px;">
      Your invite includes <strong style="color:#ffffff;">${ed.grant}</strong>. Create your account with this link and it is applied automatically.
    </p>
    <p style="margin:0 0 26px;">
      <a href="${link}" style="display:inline-block;background:#c5f04e;color:#06070a;font-weight:800;font-size:15px;text-decoration:none;padding:13px 26px;border-radius:10px;">Create your account</a>
    </p>
    ${ed.extra ? `<p style="font-size:14px;line-height:1.6;color:#9ca3af;margin-bottom:24px;">${ed.extra}</p>` : ""}
    <p style="font-size:13px;line-height:1.6;color:#6b7280;margin-bottom:8px;">
      Or use invite code <strong style="color:#9ca3af;letter-spacing:1px;">${code}</strong> at <a href="${SITE}" style="color:#9ca3af;">veedeeoh.com</a>.
    </p>
    <p style="font-size:13px;line-height:1.6;color:#6b7280;margin-bottom:0;">
      Found a bug or want something added? There's a report link in the sidebar. It reaches me directly.
    </p>
    <hr style="border:none;border-top:1px solid #1f293d;margin:24px 0;" />
    <p style="font-size:12px;color:#6b7280;text-align:center;">veedeeoh &bull; <a href="${SITE}" style="color:#6b7280;text-decoration:underline;">veedeeoh.com</a></p>
  </div>`;
}

async function createInvite({ email, edition = "founder", grants, note, send = true }) {
  if (!email) return { ok: false, error: "email required" };
  const ed = EDITIONS[edition] || EDITIONS.founder;

  // The caller's grant wins outright when supplied. Merging it over the preset
  // would make "unset the exemption" impossible -- an absent key would silently
  // fall back to the preset's true.
  const g = grants && typeof grants === "object" ? grants : { ...ed.grants };

  const code = inviteCode();
  const expires = g.tier_days ? new Date(Date.now() + g.tier_days * 86400000).toISOString() : null;

  const r = await sb("beta_invites", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      code,
      email: email.trim().toLowerCase(),
      tier: g.tier || "founder_vip",
      tier_expires: expires,
      grants: g,
      note: note || null,
    }),
  });
  const rows = await r.json();
  if (!r.ok) return { ok: false, error: rows.message || JSON.stringify(rows) };

  let sent = false, sendError = null;
  if (send) {
    if (!RESEND_KEY) sendError = "RESEND_API_KEY not in .env";
    else {
      const er = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${RESEND_KEY.trim()}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: "veedeeoh <support@veedeeoh.com>",
          to: [email],
          subject: ed.subject,
          html: inviteEmailHtml(code, edition),
        }),
      });
      const eb = await er.json().catch(() => ({}));
      sent = er.ok;
      if (!er.ok) sendError = eb?.message || `HTTP ${er.status}`;
      else await sb(`beta_invites?code=eq.${code}`, { method: "PATCH", body: JSON.stringify({ sent_at: new Date().toISOString() }) });
    }
  }
  return { ok: true, code, edition, grants: g, link: `${SITE}/landing.html?beta=${code}`, sent, sendError };
}

async function listInvites() {
  const r = await sb("beta_invites?select=*&order=created_at.desc&limit=50");
  return r.json();
}

async function revokeInvite(code) {
  const r = await sb(`beta_invites?code=eq.${encodeURIComponent(code)}`, {
    method: "PATCH", body: JSON.stringify({ revoked_at: new Date().toISOString() }),
  });
  return { ok: r.ok };
}

// --------------------------------------------------------------- feedback ---
async function listFeedback(status) {
  const q = status && status !== "all" ? `&status=eq.${status}` : "";
  const r = await sb(`feedback?select=*&order=created_at.desc&limit=100${q}`);
  return r.json();
}

async function updateFeedback({ id, status, notes }) {
  const patch = {};
  if (status !== undefined) patch.status = status;
  if (notes !== undefined) patch.notes = notes;
  const r = await sb(`feedback?id=eq.${id}`, { method: "PATCH", body: JSON.stringify(patch) });
  return { ok: r.ok };
}

// --------------------------------------------------------------- curation ---
// Kids content is approved by a human, one title or series at a time. The old
// approach stamped TV-Y7 onto everything from an Archive query and "validated"
// it against values we had just invented, which certified wartime and racial
// caricature shorts as kid-safe. Nothing reaches a restricted profile now unless
// it is in one of these collections.
const TIERS = {
  little: { name: "Little Kids Approved", min_age: 0 },
  older:  { name: "Older Kids Approved",  min_age: 1 },
  // Third answer is "not sure", not "never". With TV ratings gating
  // automatically, what reaches this queue is film-rated titles the operator may
  // simply not know. Parking one is a deferral, and the bucket stays reviewable.
  no:     { name: "Unsure / not approved", min_age: null },
};

const _collCache = {};
async function ensureCollection(key) {
  if (_collCache[key]) return _collCache[key];
  const { name, min_age } = TIERS[key];
  let r = await sb(`collections?select=id&scope=eq.platform&name=eq.${encodeURIComponent(name)}`);
  let rows = await r.json();
  if (Array.isArray(rows) && rows[0]) return (_collCache[key] = rows[0].id);
  r = await sb("collections", {
    method: "POST", headers: { Prefer: "return=representation" },
    body: JSON.stringify({ scope: "platform", name, min_age, show_as_tab: false }),
  });
  rows = await r.json();
  if (!r.ok) throw new Error(rows.message || "could not create collection");
  return (_collCache[key] = rows[0].id);
}

async function decidedIds() {
  const ids = await Promise.all(Object.keys(TIERS).map((k) => ensureCollection(k)));
  const r = await sb(`collection_items?select=content_id,collection_id&collection_id=in.(${ids.join(",")})`);
  const rows = await r.json();
  const byColl = Object.fromEntries(ids.map((id, i) => [id, Object.keys(TIERS)[i]]));
  const map = {};
  for (const row of Array.isArray(rows) ? rows : []) map[row.content_id] = byColl[row.collection_id];
  return map;
}

const TV_RATINGS = new Set(["TV-Y", "TV-Y7", "TV-Y7-FV", "TV-G", "TV-PG", "TV-14", "TV-MA"]);




// ------------------------------------------------------------------ users ---
const PAID = ["founder_vip", "giveaway", "cloud_paid", "trial_7day", "trial_dollar_month"];

// -------------------------------------------------------------- referrals ---

/** Who is owed what. Grouped in JS rather than SQL because PostgREST cannot
 *  express a grouped aggregate without a view, and this list is small. */
async function referralPayouts() {
  const r = await sb("referral_earnings?select=*&order=occurred_at.desc&limit=2000");
  if (!r.ok) return { ok: false, error: await r.text() };
  const rows = await r.json();

  const byReferrer = new Map();
  for (const e of rows) {
    let g = byReferrer.get(e.referrer_user_id);
    if (!g) {
      g = { user_id: e.referrer_user_id, email: null, pending_cents: 0, paid_cents: 0, invoices: 0 };
      byReferrer.set(e.referrer_user_id, g);
    }
    g.invoices += 1;
    if (e.paid_out_at) g.paid_cents += e.commission_cents;
    else g.pending_cents += e.commission_cents;
  }

  const ids = [...byReferrer.keys()];
  if (ids.length) {
    const pr = await sb(`profiles?select=id,email&id=in.(${ids.join(",")})`);
    if (pr.ok) for (const p of await pr.json()) {
      const g = byReferrer.get(p.id);
      if (g) g.email = p.email;
    }
  }

  const out = [...byReferrer.values()].sort((a, b) => b.pending_cents - a.pending_cents);
  return { ok: true, total_pending_cents: out.reduce((n, g) => n + g.pending_cents, 0), referrers: out };
}

/** Settle everything currently owed to one referrer. Scoped to unpaid rows so
 *  an accrual landing mid-payout is not swept into a payment that predates it. */
async function markReferralPaid({ user_id, ref }) {
  if (!user_id) return { ok: false, error: "user_id required" };
  const r = await sb(
    `referral_earnings?referrer_user_id=eq.${encodeURIComponent(user_id)}&paid_out_at=is.null`,
    { method: "PATCH", headers: { Prefer: "return=representation" },
      body: JSON.stringify({ paid_out_at: new Date().toISOString(), payout_ref: ref || null }) }
  );
  if (!r.ok) return { ok: false, error: await r.text() };
  const rows = await r.json();
  return { ok: true, settled: rows.length, cents: rows.reduce((n, e) => n + e.commission_cents, 0) };
}

/** Partner terms. Snapshotted onto FUTURE referrals only -- existing agreements
 *  keep the terms they were made under, by design. */
async function setReferralTerms({ email, rate_bps, duration_months, kind }) {
  const ur = await sb(`profiles?select=id&email=eq.${encodeURIComponent((email || "").toLowerCase())}`);
  const users = ur.ok ? await ur.json() : [];
  if (!users.length) return { ok: false, error: "no such user" };

  const patch = {};
  if (rate_bps != null) patch.rate_bps = Number(rate_bps);
  if (duration_months != null) patch.duration_months = Number(duration_months);
  if (kind) patch.kind = kind;

  const r = await sb(`referral_codes?user_id=eq.${users[0].id}`, {
    method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify(patch),
  });
  if (!r.ok) return { ok: false, error: await r.text() };
  const rows = await r.json();
  if (!rows.length) return { ok: false, error: "that user has no referral code yet -- they must open Settings once" };
  return { ok: true, code: rows[0].code, rate_bps: rows[0].rate_bps, duration_months: rows[0].duration_months };
}

// ---------------------------------------------------------------- credits ---

async function creditsFor(email) {
  const r = await sb(`profiles?select=id,email,tier,party_credits,party_credits_accrued,party_credits_spent,party_credits_exempt,public_parties_banned&email=eq.${encodeURIComponent((email || "").toLowerCase())}`);
  if (!r.ok) return { ok: false, error: await r.text() };
  const rows = await r.json();
  if (!rows.length) return { ok: false, error: "no such user" };
  const u = rows[0];

  const g = await sb(`free_month_grants?select=trigger,milestone,year,applied_at&user_id=eq.${u.id}&order=created_at.desc`);
  u.free_months = g.ok ? await g.json() : [];
  const l = await sb(`party_credit_ledger?select=delta,reason,created_at&user_id=eq.${u.id}&order=created_at.desc&limit=10`);
  u.ledger = l.ok ? await l.json() : [];
  return { ok: true, user: u };
}

/** Exemption is its own axis, not a tier property: granted and revoked per
 *  account regardless of what that account pays. */
async function setCreditExempt({ email, exempt }) {
  const r = await sb(`profiles?email=eq.${encodeURIComponent((email || "").toLowerCase())}`, {
    method: "PATCH", headers: { Prefer: "return=representation" },
    body: JSON.stringify({ party_credits_exempt: !!exempt }),
  });
  if (!r.ok) return { ok: false, error: await r.text() };
  const rows = await r.json();
  if (!rows.length) return { ok: false, error: "no such user" };
  return { ok: true, exempt: rows[0].party_credits_exempt };
}

/** Hand-adjust a balance, and write the ledger too. A balance that changed
 *  with no ledger row is the thing you cannot explain to a customer later. */
async function adjustCredits({ email, delta, note }) {
  const n = parseInt(delta, 10);
  if (!Number.isFinite(n) || n === 0) return { ok: false, error: "delta must be a non-zero integer" };

  const cur = await creditsFor(email);
  if (!cur.ok) return cur;
  const next = Math.max(0, (cur.user.party_credits || 0) + n);

  const r = await sb(`profiles?id=eq.${cur.user.id}`, {
    method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ party_credits: next }),
  });
  if (!r.ok) return { ok: false, error: await r.text() };

  await sb("party_credit_ledger", {
    method: "POST",
    body: JSON.stringify({ user_id: cur.user.id, delta: n, reason: "admin", note: note || "manual adjustment" }),
  });
  return { ok: true, balance: next };
}

/** Remove a host from the PUBLIC DIRECTORY without touching their ability to
 *  host at all. A blanket hosting ban would punish their own household for a
 *  public-listing problem. */
async function setPartyListing({ email, banned }) {
  const r = await sb(`profiles?email=eq.${encodeURIComponent((email || "").toLowerCase())}`, {
    method: "PATCH", headers: { Prefer: "return=representation" },
    body: JSON.stringify({ public_parties_banned: !!banned }),
  });
  if (!r.ok) return { ok: false, error: await r.text() };
  const rows = await r.json();
  if (!rows.length) return { ok: false, error: "no such user" };
  return { ok: true, banned: rows[0].public_parties_banned };
}

async function findUser(email) {
  const r = await sb(`profiles?select=id,email,tier,tier_expires,seats&email=eq.${encodeURIComponent(email.toLowerCase())}`);
  const rows = await r.json();
  return Array.isArray(rows) ? rows[0] || null : { error: rows };
}

async function setTier(email, tier) {
  const body = JSON.stringify({ tier, tier_expires: tier === "founder_vip" ? null : undefined });
  const r = await sb(`profiles?email=eq.${encodeURIComponent(email.toLowerCase())}`, {
    method: "PATCH", body, headers: { Prefer: "return=representation" },
  });
  const rows = await r.json();
  return { ok: r.ok, rows };
}

// ------------------------------------------------------------------- http ---
/** Apply a named benefits bundle to an account that already exists.
 *
 *  The bundles were only reachable through an invite, which by definition goes
 *  to someone who has not joined. Making an existing account a partner meant
 *  four separate writes across three tables with nothing recording that they
 *  belonged together -- and the referral half failed outright unless that
 *  person had happened to open Settings once, because the code is minted
 *  lazily.
 *
 *  Goes through admin_apply_grants so the meaning of a bundle is defined in
 *  exactly one place, shared with invite redemption. A partner granted today
 *  and a partner invited last week get identical terms, which is not true if
 *  the two paths each carry their own copy of the numbers.
 */
async function applyEdition({ email, edition, grants, note }) {
  const target = (email || "").trim().toLowerCase();
  if (!target) return { ok: false, error: "email required" };

  // An explicit grants object wins, so the panel can override a preset before
  // applying it -- same rule the invite form already follows.
  const g = grants && typeof grants === "object" ? grants : EDITIONS[edition]?.grants;
  if (!g) return { ok: false, error: `unknown edition: ${edition}` };

  const r = await sb("rpc/admin_apply_grants", {
    method: "POST",
    body: JSON.stringify({
      target_email: target,
      g,
      note: note || `admin grant: ${EDITIONS[edition]?.label || edition}`,
    }),
  });
  if (!r.ok) return { ok: false, error: await r.text() };

  const out = await r.json();
  if (out && out.ok === false) return out;

  // Read back rather than report the request. Saying "done" on the strength of
  // a 200 is how a grant that silently applied to nobody looks like a success.
  const after = await accountSnapshot(target);
  return { ok: true, applied: EDITIONS[edition]?.label || edition, user: after };
}

/** Everything the panel should show about one account after a change. */
async function accountSnapshot(email) {
  const r = await sb(`profiles?select=id,email,tier,tier_expires,party_credits,party_credits_exempt&email=eq.${encodeURIComponent(email)}`);
  const rows = r.ok ? await r.json() : [];
  const u = rows[0];
  if (!u) return null;
  const c = await sb(`referral_codes?select=code,kind,rate_bps,duration_months&user_id=eq.${u.id}`);
  const codes = c.ok ? await c.json() : [];
  return { ...u, referral: codes[0] || null };
}

// ------------------------------------------------------------------ overview ---

/** The numbers that answer "how is it going" without opening four sections.
 *
 *  Every count is exact rather than sampled: PostgREST returns one through the
 *  content-range header when asked, so an accurate figure costs the same as a
 *  wrong one. */
async function overview() {
  // select=* rather than a named column: referrals and party_joins have no `id`
  // -- their keys are composite -- so asking for one is a 400.
  //
  // AND A FAILED COUNT RETURNS NULL, NOT ZERO. The first version fell back to 0
  // when the header was missing, so a rejected query rendered as a confident
  // "0 referrals" on a dashboard whose whole job is to be believed. A number
  // that cannot be produced should look unavailable, not empty.
  const count = async (table, query = "") => {
    const r = await sb(`${table}?select=*${query ? "&" + query : ""}`, {
      headers: { Prefer: "count=exact", Range: "0-0" },
    });
    if (!r.ok) { console.error(`  count(${table}) failed:`, await r.text()); return null; }
    const n = Number((r.headers.get("content-range") || "").split("/")[1]);
    return Number.isFinite(n) ? n : null;
  };

  const dayAgo = new Date(Date.now() - 864e5).toISOString();
  const weekAgo = new Date(Date.now() - 7 * 864e5).toISOString();
  const nowIso = new Date().toISOString();

  const [users, newWeek, paid, trialing, partiesDay, joinsDay, refs, refsPaid, reports, waitlist] =
    await Promise.all([
      count("profiles"),
      count("profiles", `created_at=gte.${weekAgo}`),
      // Access means a paid tier that has not lapsed. Counting tier alone
      // reports expired founders as customers, which is how a dashboard tells
      // you business is better than it is.
      count("profiles", `tier=in.(founder_vip,cloud_paid,giveaway)&or=(tier_expires.is.null,tier_expires.gte.${nowIso})`),
      count("profiles", `tier=eq.trial_7day&tier_expires=gte.${nowIso}`),
      count("parties", `created_at=gte.${dayAgo}`),
      count("party_joins", `joined_at=gte.${dayAgo}`),
      count("referrals"),
      count("referrals", "first_paid_at=not.is.null"),
      count("profile_reports", "handled_at=is.null"),
      count("waitlist"),
    ]);

  return {
    users, newWeek, paid, trialing,
    partiesDay, joinsDay,
    referrals: refs, referralsConverted: refsPaid,
    openReports: reports, waitlist,
  };
}

// ------------------------------------------------------------------- reports ---

/** Profiles people have flagged.
 *
 *  NOTHING READ THIS TABLE. Reporting shipped with the public profiles, the
 *  rows have been accumulating with nowhere to go, and a report nobody can see
 *  is worse than no report button at all -- it tells someone their complaint
 *  was received when it was only stored. */
async function reportQueue(status = "open") {
  const filter = status === "open" ? "&handled_at=is.null"
    : status === "handled" ? "&handled_at=not.is.null" : "";
  const r = await sb(
    `profile_reports?select=id,subject_user_id,reason,created_at,handled_at${filter}` +
    `&order=created_at.desc&limit=100`);
  if (!r.ok) return { ok: false, error: await r.text() };
  const rows = await r.json();
  if (!rows.length) return { ok: true, groups: [] };

  // Grouped by subject: five reports about one person is one decision, not
  // five, and a list of individual rows hides how bad something is.
  const ids = [...new Set(rows.map((x) => x.subject_user_id))];
  const pr = await sb(
    `profiles?select=id,email,public_handle,display_name,public_parties_banned&id=in.(${ids.join(",")})`);
  const people = pr.ok ? await pr.json() : [];
  const byId = Object.fromEntries(people.map((p) => [p.id, p]));

  const groups = ids.map((id) => {
    const mine = rows.filter((x) => x.subject_user_id === id);
    const reasons = {};
    for (const m of mine) reasons[m.reason] = (reasons[m.reason] || 0) + 1;
    const p = byId[id] || {};
    return {
      userId: id,
      email: p.email || null,
      handle: p.public_handle || null,
      name: p.display_name || null,
      banned: !!p.public_parties_banned,
      count: mine.length,
      open: mine.filter((m) => !m.handled_at).length,
      reasons,
      latest: mine[0]?.created_at,
    };
  }).sort((a, b) => b.open - a.open || b.count - a.count);

  return { ok: true, groups };
}

/** Ban or unban a profile from being listed publicly, and close its reports.
 *
 *  Banning hides the profile and its public parties; it does not touch the
 *  account, which can still watch. Marking handled is separate from banning so
 *  a report can be dismissed without punishing anyone -- most will be. */
async function resolveReport({ userId, ban, dismiss }) {
  if (!userId) return { ok: false, error: "userId required" };

  if (ban !== undefined) {
    const r = await sb(`profiles?id=eq.${userId}`, {
      method: "PATCH", headers: { Prefer: "return=representation" },
      body: JSON.stringify({ public_parties_banned: !!ban }),
    });
    if (!r.ok) return { ok: false, error: await r.text() };
  }

  if (dismiss || ban !== undefined) {
    await sb(`profile_reports?subject_user_id=eq.${userId}&handled_at=is.null`, {
      method: "PATCH", body: JSON.stringify({ handled_at: new Date().toISOString() }),
    });
  }
  return { ok: true, ...(await reportQueue("open")) };
}

// ------------------------------------------------------------------- parties ---

/** What is running now, and what ran recently.
 *
 *  Twelve parties have happened and there has been no way to see any of them --
 *  not who hosted, not whether anyone joined, not whether a public one is live
 *  right now. */
async function partyActivity() {
  const sixHours = new Date(Date.now() - 6 * 3600e3).toISOString();
  const r = await sb(
    "parties?select=id,join_code,title,host_user_id,is_public,seat_limit,created_at,ended_at" +
    "&order=created_at.desc&limit=40");
  if (!r.ok) return { ok: false, error: await r.text() };
  const rows = await r.json();
  if (!rows.length) return { ok: true, live: [], recent: [] };

  const hostIds = [...new Set(rows.map((p) => p.host_user_id).filter(Boolean))];
  const hr = hostIds.length
    ? await sb(`profiles?select=id,email,public_handle&id=in.(${hostIds.join(",")})`) : null;
  const hosts = hr && hr.ok ? await hr.json() : [];
  const hostBy = Object.fromEntries(hosts.map((h) => [h.id, h]));

  const jr = await sb(`party_joins?select=party_id`);
  const joins = jr.ok ? await jr.json() : [];
  const joinCount = {};
  for (const j of joins) joinCount[j.party_id] = (joinCount[j.party_id] || 0) + 1;

  const shape = (p) => ({
    code: p.join_code, title: p.title || "Untitled",
    host: hostBy[p.host_user_id]?.public_handle || hostBy[p.host_user_id]?.email || "unknown",
    isPublic: !!p.is_public, joins: joinCount[p.id] || 0,
    started: p.created_at, ended: p.ended_at,
  });

  // "Live" is not ended AND started within the idle window the worker uses --
  // a row whose host vanished without ending it is not a live party, and
  // counting it as one makes the number a lie that never goes down.
  const live = rows.filter((p) => !p.ended_at && p.created_at > sixHours).map(shape);
  const recent = rows.filter((p) => p.ended_at || p.created_at <= sixHours).slice(0, 20).map(shape);
  return { ok: true, live, recent };
}

// ----------------------------------------------------------------- referrals ---

/** Who introduced whom, and whether it has converted yet.
 *
 *  referral_earnings shows money owed; this shows the pipeline behind it,
 *  including claims that have not converted -- which is the half that tells you
 *  whether the programme is working at all. */
async function referralLedger() {
  const r = await sb(
    "referrals?select=referrer_user_id,referred_user_id,code,source,first_paid_at,created_at,expires_at" +
    "&order=created_at.desc&limit=100");
  if (!r.ok) return { ok: false, error: await r.text() };
  const rows = await r.json();
  if (!rows.length) return { ok: true, rows: [] };

  const ids = [...new Set(rows.flatMap((x) => [x.referrer_user_id, x.referred_user_id]).filter(Boolean))];
  const pr = await sb(`profiles?select=id,email,public_handle&id=in.(${ids.join(",")})`);
  const people = pr.ok ? await pr.json() : [];
  const by = Object.fromEntries(people.map((p) => [p.id, p.public_handle || p.email]));

  const now = Date.now();
  return {
    ok: true,
    rows: rows.map((x) => ({
      referrer: by[x.referrer_user_id] || "unknown",
      referred: by[x.referred_user_id] || "unknown",
      code: x.code, source: x.source,
      converted: !!x.first_paid_at,
      // A claim that has lapsed is still on the books and still looks like a
      // pending conversion unless it is called what it is.
      lapsed: !x.first_paid_at && !!x.expires_at && new Date(x.expires_at).getTime() < now,
      created: x.created_at,
    })),
  };
}

const routes = {
  "GET /api/status": () => catalogStatus(),
  "POST /api/warm": () => rebuildCatalog(),
  "GET /api/providers": () => checkProviders(),
  "GET /api/user": (u) => findUser(u.searchParams.get("email") || ""),
  "POST /api/tier": (u, b) => setTier(b.email, b.tier),
  "POST /api/grant": (u, b) => applyEdition(b),
  "GET /api/account": (u) => accountSnapshot((u.searchParams.get("email") || "").toLowerCase()),
  "GET /api/editions": () => Object.entries(EDITIONS).map(([id, e]) =>
    ({ id, label: e.label, subject: e.subject, grants: e.grants })),
  "GET /api/invites": () => listInvites(),
  "POST /api/invite": (u, b) => createInvite(b),
  "POST /api/invite/revoke": (u, b) => revokeInvite(b.code),
  "GET /api/feedback": (u) => listFeedback(u.searchParams.get("status") || "all"),
  "GET /api/overview": () => overview(),
  "GET /api/reports": (u) => reportQueue(u.searchParams.get("status") || "open"),
  "POST /api/reports/resolve": (u, b) => resolveReport(b),
  "GET /api/parties": () => partyActivity(),
  "GET /api/referral-ledger": () => referralLedger(),
  "POST /api/feedback/update": (u, b) => updateFeedback(b),
  "GET /api/credits": (u) => creditsFor(u.searchParams.get("email") || ""),
  "POST /api/credits/exempt": (u, b) => setCreditExempt(b),
  "POST /api/credits/adjust": (u, b) => adjustCredits(b),
  "GET /api/referrals": () => referralPayouts(),
  "POST /api/referrals/paid": (u, b) => markReferralPaid(b),
  "POST /api/referrals/terms": (u, b) => setReferralTerms(b),
  "POST /api/party/listing": (u, b) => setPartyListing(b),
};

// Read per request, not once at startup: this is a local tool, the file is
// ~15KB, and reading it once meant every edit to the panel needed a server
// restart to show up.
const uiPath = join(REPO, "scripts", "veedeeoh-panel.html");

const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const key = `${req.method} ${url.pathname}`;
  if (routes[key]) {
    let body = {};
    if (req.method === "POST") {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      try { body = JSON.parse(Buffer.concat(chunks).toString() || "{}"); } catch {}
    }
    try {
      const data = await routes[key](url, body);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(data));
    } catch (e) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(readFileSync(uiPath, "utf8").replace("__PAID_TIERS__", JSON.stringify(PAID)).replace("__SITE__", JSON.stringify(SITE)));
});

const PORT = Number(process.env.VEEDEEOH_PORT) || 8787;

// A second launch used to dump an unhandled EADDRINUSE stack trace. Say what is
// actually going on instead.
server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`\n  Port ${PORT} is already in use -- the control panel is probably already running.`);
    console.error(`  Open http://localhost:${PORT}, or stop the other instance and re-run.`);
    console.error(`  (VEEDEEOH_PORT=8788 veedeeoh starts a second one on another port.)\n`);
  } else {
    console.error("\n  Could not start the control panel:", err.message, "\n");
  }
  process.exit(1);
});
server.listen(PORT, "127.0.0.1", () => {
  const at = `http://localhost:${PORT}`;
  console.log(`\n  veedeeoh control panel  ${at}`);
  console.log(`  repo   ${REPO}`);
  console.log(`  target ${SITE}\n`);
  if (!process.env.VEEDEEOH_NO_OPEN) spawn("open", [at], { stdio: "ignore", detached: true }).unref();
});
