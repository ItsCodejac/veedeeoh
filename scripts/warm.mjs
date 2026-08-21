#!/usr/bin/env node
// Rebuild the production catalog cache and report what changed.
//
// /api/vod serves a cached payload, so backend changes (genre rules, the kids
// allowlist, duration units) do nothing until the catalog is rebuilt. The cron
// does this daily; this triggers it on demand after a deploy.
//
//   npm run warm
import { readFileSync } from "node:fs";

const SITE = process.env.SITE || "https://veedeeoh.com";

function env(key) {
  if (process.env[key]) return process.env[key];
  try {
    const line = readFileSync(new URL("../.env", import.meta.url), "utf8")
      .split("\n").find((l) => l.startsWith(`${key}=`));
    return line?.slice(key.length + 1).trim().replace(/^["']|["']$/g, "");
  } catch { return undefined; }
}

async function snapshot() {
  const r = await fetch(`${SITE}/api/vod`);
  if (!r.ok) throw new Error(`GET /api/vod -> ${r.status}`);
  const j = await r.json();
  const rails = j.rails || [];
  const items = rails.flatMap((x) => x.items || []);
  const kidsRails = rails.filter((x) => /kid|famil/i.test(x.name || ""));
  return {
    age: (Date.now() - Number(j.updatedAt)) / 3600000,
    titles: items.length,
    archiveInKids: kidsRails
      .flatMap((x) => x.items || [])
      .filter((i) => String(i.id || "").startsWith("archive:")).length,
    plutoBaked: items.filter((i) => i.url && /pluto\.tv/.test(i.url)).length,
  };
}

const secret = env("CRON_SECRET");
if (!secret) {
  console.error("CRON_SECRET not found in environment or .env");
  process.exit(1);
}

const before = await snapshot();
console.log(`before  catalog ${before.age.toFixed(1)}h old · ${before.titles} titles · ${before.archiveInKids} archive items in Kids`);

process.stdout.write("rebuilding… ");
const res = await fetch(`${SITE}/api/cron/catalog-warm`, {
  headers: { Authorization: `Bearer ${secret}` },
});
const body = await res.json().catch(() => ({}));
if (!res.ok) {
  console.log(`FAILED (${res.status})`, body.error || "");
  process.exit(1);
}
console.log("done");

const after = await snapshot();
console.log(`after   catalog ${after.age.toFixed(1)}h old · ${after.titles} titles · ${after.archiveInKids} archive items in Kids`);
console.log();
console.log(after.archiveInKids === 0
  ? "Kids rail is clear of un-vetted Internet Archive content."
  : `WARNING: ${after.archiveInKids} archive items still in Kids — allowlist may not be deployed.`);
