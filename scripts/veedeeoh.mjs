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

function inviteEmailHtml(code, tier) {
  const link = `${SITE}/landing.html?beta=${code}`;
  return `
  <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;background-color:#0b0f19;color:#f3f4f6;border-radius:12px;border:1px solid #1f293d;">
    <div style="margin-bottom:24px;"><span style="font-size:24px;font-weight:800;color:#ffffff;">veedeeoh</span><span style="color:#c5f04e;font-size:24px;font-weight:800;">.</span></div>
    <h1 style="font-size:22px;font-weight:700;margin-bottom:16px;color:#ffffff;">You're in.</h1>
    <p style="font-size:15px;line-height:1.6;color:#9ca3af;margin-bottom:20px;">
      You've been invited to the veedeeoh beta. Thousands of free movies and TV shows in one app, with profiles and parental controls for the whole household.
    </p>
    <p style="font-size:15px;line-height:1.6;color:#9ca3af;margin-bottom:24px;">
      Your invite includes <strong style="color:#ffffff;">${tier === "founder_vip" ? "founder access, free for as long as veedeeoh runs" : tier}</strong>. Create your account with this link and it is applied automatically.
    </p>
    <p style="margin:0 0 26px;">
      <a href="${link}" style="display:inline-block;background:#c5f04e;color:#06070a;font-weight:800;font-size:15px;text-decoration:none;padding:13px 26px;border-radius:10px;">Create your account</a>
    </p>
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

async function createInvite({ email, tier = "founder_vip", send = true }) {
  if (!email) return { ok: false, error: "email required" };
  const code = inviteCode();
  const r = await sb("beta_invites", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ code, email: email.trim().toLowerCase(), tier }),
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
          subject: "Your veedeeoh beta invite",
          html: inviteEmailHtml(code, tier),
        }),
      });
      const eb = await er.json().catch(() => ({}));
      sent = er.ok;
      if (!er.ok) sendError = eb?.message || `HTTP ${er.status}`;
      else await sb(`beta_invites?code=eq.${code}`, { method: "PATCH", body: JSON.stringify({ sent_at: new Date().toISOString() }) });
    }
  }
  return { ok: true, code, link: `${SITE}/landing.html?beta=${code}`, sent, sendError };
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
  no:     { name: "Not for kids",         min_age: null },
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

/** Candidates are whatever the current automatic filter surfaces for Kids. It is
 *  a reasonable pool because it is already maturity-gated -- but it decides
 *  nothing. The thing that was wrong as a GATE is fine as a SUGGESTION. */
async function curateQueue() {
  const j = await (await fetch(`${SITE}/api/vod`)).json();
  const rails = (j.rails || []).filter((r) => /kid|famil/i.test(r.name || ""));
  const seen = new Set(), pool = [];
  for (const rail of rails) {
    for (const it of rail.items || []) {
      if (seen.has(it.id)) continue;
      seen.add(it.id);
      pool.push(it);
    }
  }
  const decided = await decidedIds();
  const link = (it) => {
    const id = String(it.id || "");
    if (id.startsWith("tubi:")) return `https://tubitv.com/${it.series_id ? "series" : "movies"}/${id.replace("tubi:", "")}`;
    if (id.startsWith("archive:")) return `https://archive.org/details/${id.replace("archive:", "")}`;
    return "https://pluto.tv/en/on-demand";
  };
  return {
    counts: Object.entries(TIERS).reduce((a, [k]) => ({ ...a, [k]: Object.values(decided).filter((v) => v === k).length }), {}),
    total: pool.length,
    queue: pool.filter((it) => !decided[it.id]).map((it) => ({
      id: it.id, title: it.title, poster: it.poster, rating: it.rating,
      maturity: it.maturity, provider: it.provider || (String(it.id).startsWith("tubi:") ? "Tubi" : String(it.id).startsWith("archive:") ? "Internet Archive" : "Pluto TV"),
      summary: (it.summary || "").slice(0, 220),
      kind: it.series_id ? "series" : "title",
      watchUrl: link(it),
    })),
  };
}

async function curateDecide({ contentId, decision, kind = "title" }) {
  if (!TIERS[decision]) return { ok: false, error: "unknown decision" };
  const collection_id = await ensureCollection(decision);
  const r = await sb("collection_items", {
    method: "POST", headers: { Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({ collection_id, content_id: contentId, kind }),
  });
  if (!r.ok) return { ok: false, error: (await r.json().catch(() => ({}))).message || `HTTP ${r.status}` };
  return { ok: true };
}

async function curateUndo({ contentId }) {
  const ids = await Promise.all(Object.keys(TIERS).map((k) => ensureCollection(k)));
  const r = await sb(`collection_items?content_id=eq.${encodeURIComponent(contentId)}&collection_id=in.(${ids.join(",")})`, { method: "DELETE" });
  return { ok: r.ok };
}

// ------------------------------------------------------------------ users ---
const PAID = ["founder_vip", "giveaway", "cloud_paid", "trial_7day", "trial_dollar_month"];

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
const routes = {
  "GET /api/status": () => catalogStatus(),
  "POST /api/warm": () => rebuildCatalog(),
  "GET /api/providers": () => checkProviders(),
  "GET /api/user": (u) => findUser(u.searchParams.get("email") || ""),
  "POST /api/tier": (u, b) => setTier(b.email, b.tier),
  "GET /api/invites": () => listInvites(),
  "POST /api/invite": (u, b) => createInvite(b),
  "POST /api/invite/revoke": (u, b) => revokeInvite(b.code),
  "GET /api/feedback": (u) => listFeedback(u.searchParams.get("status") || "all"),
  "GET /api/curate": () => curateQueue(),
  "POST /api/curate/decide": (u, b) => curateDecide(b),
  "POST /api/curate/undo": (u, b) => curateUndo(b),
  "POST /api/feedback/update": (u, b) => updateFeedback(b),
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
