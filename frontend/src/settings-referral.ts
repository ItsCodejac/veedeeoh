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

  void renderHostChannel(el);

  el.querySelector("#setRefCopy")?.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(link); showToast("Referral link copied"); }
    catch { el.querySelector<HTMLInputElement>("#setRefLink")?.select(); }
  });
}


const PLATFORMS = [
  ["", "None"], ["discord", "Discord"], ["twitch", "Twitch"],
  ["youtube", "YouTube"], ["x", "X"], ["tiktok", "TikTok"], ["instagram", "Instagram"],
];

/** Where a public party host sends people.
 *
 *  Platform and handle rather than a URL field: an arbitrary link shown to
 *  other users under veedeeoh's name is a phishing surface, and none of it is
 *  needed to point at a Discord or a Twitch channel. */
async function renderHostChannel(root: HTMLElement): Promise<void> {
  const { getHostSocial, setHostSocial } = await import("./db");
  let cur: { platform: string | null; handle: string | null };
  try { cur = await getHostSocial(); } catch { return; }

  const box = document.createElement("div");
  box.innerHTML = card("Your channel", `
    <div class="setBtnRow">
      <select id="hcPlatform" class="setInput" style="max-width:150px">
        ${PLATFORMS.map(([v, l]) => `<option value="${v}"${cur.platform === v ? " selected" : ""}>${l}</option>`).join("")}
      </select>
      <input id="hcHandle" class="setInput" placeholder="your handle" maxlength="32"
             value="${escapeHtml(cur.handle || "")}" />
      <button class="setBtn" id="hcSave">Save</button>
    </div>`,
    "Shown next to any party you list publicly, so people can find you afterwards. Letters, numbers, dots, dashes and underscores only.");
  root.appendChild(box);

  box.querySelector("#hcSave")!.addEventListener("click", async (e) => {
    const b = e.currentTarget as HTMLButtonElement;
    const platform = (box.querySelector("#hcPlatform") as HTMLSelectElement).value || null;
    const handle = (box.querySelector("#hcHandle") as HTMLInputElement).value;
    b.disabled = true;
    try {
      await setHostSocial(platform, handle);
      showToast("Channel saved");
    } catch {
      // The pattern check lives in the database, so an invalid handle surfaces
      // here rather than being silently dropped.
      showToast("That handle has characters we cannot use");
    } finally { b.disabled = false; }
  });
}
