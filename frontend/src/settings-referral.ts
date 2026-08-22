// Settings > Account > Refer and earn. Its own module because the affiliate
// surface has its own data dependencies (terms, per-source attribution) and
// will grow with the programme.

import { escapeHtml, showToast } from "./util";
import { card, row } from "./settings-ui";

const SOURCE_LABEL: Record<string, string> = {
  link: "Referral link",
  party: "Watch party",
  household: "Household invite",
  partner: "Partner deal",
};

export async function renderReferral(el: HTMLElement): Promise<void> {
  const db = await import("./db");
  const [code, sum, terms, sources] = await Promise.all([
    db.myReferralCode(), db.referralSummary(), db.myReferralTerms(), db.referralsBySource(),
  ]);
  if (!code) { el.innerHTML = ""; return; }

  const link = db.referralLink(code);
  const money = (c: number) => `$${(c / 100).toFixed(2)}`;
  const isPartner = terms?.kind === "partner";
  const rate = terms ? (terms.rate_bps / 100).toFixed(terms.rate_bps % 100 ? 1 : 0) : "20";
  const months = terms?.duration_months ?? 12;

  // Attribution by source is the honest answer to "is hosting parties worth
  // it?". Without it a host cannot tell whether their parties earned anything
  // or whether every signup came from the link they posted somewhere.
  const entries = Object.entries(sources).sort((a, b) => b[1] - a[1]);
  const breakdown = entries.length ? `
    <div class="setTable" style="margin-top:14px">
      ${entries.map(([src, n]) => `
        <div class="setTableRow">
          <span>${escapeHtml(SOURCE_LABEL[src] || src)}</span>
          <span><b>${n}</b></span>
        </div>`).join("")}
    </div>` : "";

  el.innerHTML = card(isPartner ? "Partner programme" : "Refer and earn", `
    ${row("Your terms", `<span class="setBadge${isPartner ? " gold" : ""}">${escapeHtml(rate)}% for ${months === 0 ? "the life of the account" : `${months} months`}</span>`)}
    <div class="setBtnRow">
      <input class="setInput" id="setRefLink" readonly value="${escapeHtml(link)}" />
      <button class="setBtn primary" id="setRefCopy">Copy</button>
    </div>
    <div class="setStats">
      <div><b>${sum?.referred ?? 0}</b><span>Signed up</span></div>
      <div><b>${sum?.converted ?? 0}</b><span>Subscribed</span></div>
      <div><b>${money(sum?.pending_cents ?? 0)}</b><span>Owed to you</span></div>
      <div><b>${money(sum?.paid_cents ?? 0)}</b><span>Paid out</span></div>
    </div>
    ${breakdown}`,
    isPartner
      ? "Negotiated partner terms. The rate is snapshotted onto each referral when it is made, so a later change never rewrites what you already earned."
      : "Anyone who joins a watch party you host is credited to you too, without this link. Payouts are made by hand while the programme is in beta.");

  el.querySelector("#setRefCopy")?.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(link); showToast("Referral link copied"); }
    catch { el.querySelector<HTMLInputElement>("#setRefLink")?.select(); }
  });
}
