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
};

const UI = readFileSync(join(REPO, "scripts", "veedeeoh-panel.html"), "utf8");

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
  res.end(UI.replace("__PAID_TIERS__", JSON.stringify(PAID)).replace("__SITE__", SITE));
});

const PORT = Number(process.env.VEEDEEOH_PORT) || 8787;
server.listen(PORT, "127.0.0.1", () => {
  const at = `http://localhost:${PORT}`;
  console.log(`\n  veedeeoh control panel  ${at}`);
  console.log(`  repo   ${REPO}`);
  console.log(`  target ${SITE}\n`);
  if (!process.env.VEEDEEOH_NO_OPEN) spawn("open", [at], { stdio: "ignore", detached: true }).unref();
});
