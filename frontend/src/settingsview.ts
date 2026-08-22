// Settings as a routed PAGE, not a modal.
//
// It was a 620px modal holding five unrelated sections, which then opened the
// profile editor, which reopened the modal by callback. Meanwhile "Switch
// profile" was reachable from three different popups and Settings itself from
// exactly one, buried inside a menu.
//
// Organised by AUDIENCE rather than by feature, because this is a household
// product: Account is for the person paying, Household is for the person
// managing everyone else, Playback is per-viewer. A kids profile gets Playback
// and nothing else.

import { escapeHtml, showToast } from "./util";
import { getSession, signOut } from "./auth";
import { getStoredProfiles, openProfileEditor, getActiveProfile } from "./profiles";
import { getAccount, openBillingPortal, startCheckout } from "./db";

type SectionId = "account" | "household" | "playback" | "about";

interface Section {
  id: SectionId;
  label: string;
  icon: string;
  kidsSafe: boolean;
  render: (el: HTMLElement) => void | Promise<void>;
}

const ICON = {
  user: `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`,
  home: `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>`,
  play: `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>`,
  info: `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`,
};

// --------------------------------------------------------------- helpers ---

const card = (title: string, body: string, hint = "") => `
  <section class="setCard">
    <h2>${escapeHtml(title)}</h2>
    ${hint ? `<p class="setHint">${hint}</p>` : ""}
    ${body}
  </section>`;

const row = (label: string, value: string) => `
  <div class="setRow"><span class="setRowLabel">${escapeHtml(label)}</span><span class="setRowValue">${value}</span></div>`;

const fmtDate = (iso: string | null | undefined): string =>
  iso ? new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" }) : "—";

// --------------------------------------------------------------- sections ---

async function renderAccount(el: HTMLElement): Promise<void> {
  const session = getSession();
  const active = getActiveProfile();

  el.innerHTML = card("Account", `
    ${row("Signed in as", escapeHtml(session?.email || "Local / self-hosted"))}
    ${row("Role", active.role === "owner" ? "Account owner" : "Household member")}
    <div class="setField">
      <label for="setAccountName">Household name</label>
      <input id="setAccountName" type="text" placeholder="e.g. Cojac's Household" />
    </div>`)
    + `<div id="setBilling"></div>`
    + `<div id="setReferral"></div>`
    + card("Security", `
      <p class="setHint">Password and sign-in are managed on a dedicated page so a
        half-finished settings edit can never sit behind a redirect.</p>
      <div class="setBtnRow">
        <a class="setBtn" href="/change-password.html">Change password</a>
        <button class="setBtn danger" id="setSignOut">Sign out</button>
      </div>`);

  const nameInput = el.querySelector<HTMLInputElement>("#setAccountName")!;
  const defaultName = session?.email ? session.email.split("@")[0]! : "My Household";
  nameInput.value = localStorage.getItem("veedeeoh_account_name") || defaultName;
  nameInput.addEventListener("change", () => {
    const v = nameInput.value.trim();
    if (v) { localStorage.setItem("veedeeoh_account_name", v); showToast("Household name saved"); }
  });

  el.querySelector("#setSignOut")?.addEventListener("click", () => { void signOut(); });

  void renderBilling(el.querySelector<HTMLElement>("#setBilling")!);
  void renderReferral(el.querySelector<HTMLElement>("#setReferral")!);
}

// Billing states FACTS. The version this replaces hardcoded "Pro Cloud Tier",
// "$4.00 / month", a renewal date of August 28 2026 and a feature list, none of
// which came from the account -- so every subscriber was shown someone else's
// renewal date. It also offered two add-ons that do not exist, one priced
// "$TBD/mo", whose buttons started an ordinary $4 subscription.
async function renderBilling(el: HTMLElement): Promise<void> {
  el.innerHTML = card("Plan and billing", `<p class="setHint">Loading…</p>`);

  let acct: Awaited<ReturnType<typeof getAccount>> = null;
  try { acct = await getAccount(); }
  catch { el.innerHTML = card("Plan and billing", `<p class="setHint">Couldn't load your plan.</p>`); return; }

  if (!acct) {
    el.innerHTML = card("Plan and billing", `<p class="setHint">Self-hosted. No subscription, nothing to bill.</p>`);
    return;
  }

  const TIER_LABEL: Record<string, string> = {
    cloud_paid: "veedeeoh Cloud",
    founder_vip: "Founder",
    trial: "Free trial",
    canceled: "Canceled",
  };
  const label = TIER_LABEL[acct.tier] || acct.tier;
  const expires = acct.tier_expires ? new Date(acct.tier_expires) : null;
  const daysLeft = expires ? Math.ceil((expires.getTime() - Date.now()) / 86_400_000) : null;
  const lapsed = daysLeft !== null && daysLeft <= 0;
  const comped = acct.tier === "founder_vip";

  // A founder comp has no expiry and no Stripe customer, so a renewal line and
  // a portal button would both be nonsense.
  const dateLabel = comped ? "Access" : lapsed ? "Ended" : acct.tier === "trial" ? "Trial ends" : "Renews";
  const dateValue = comped ? "No expiry" : fmtDate(acct.tier_expires);

  el.innerHTML = card("Plan and billing", `
    ${row("Plan", `<span class="setBadge${comped ? " gold" : ""}">${escapeHtml(label)}</span>`)}
    ${row(dateLabel, escapeHtml(dateValue) + (daysLeft !== null && daysLeft > 0 && !comped ? ` <span class="setDim">(${daysLeft} day${daysLeft === 1 ? "" : "s"})</span>` : ""))}
    ${row("Profiles", `${getStoredProfiles().length} of ${acct.seats ?? 3} seats`)}
    <div class="setBtnRow">
      ${comped ? "" : acct.tier === "cloud_paid"
        ? `<button class="setBtn" id="setPortal">Manage billing</button>`
        : `<button class="setBtn primary" id="setSubscribe">Subscribe — $4/mo</button>`}
    </div>
    ${comped ? `<p class="setHint">Comped account. You are not charged and there is nothing to manage.</p>` : ""}`);

  el.querySelector("#setPortal")?.addEventListener("click", async (e) => {
    const b = e.currentTarget as HTMLButtonElement;
    b.disabled = true; b.textContent = "Opening…";
    try { await openBillingPortal(); }
    catch { showToast("Couldn't open the billing portal"); b.disabled = false; b.textContent = "Manage billing"; }
  });
  el.querySelector("#setSubscribe")?.addEventListener("click", async (e) => {
    const b = e.currentTarget as HTMLButtonElement;
    b.disabled = true; b.textContent = "Opening…";
    try { await startCheckout(); }
    catch (err: any) { showToast(err?.message || "Checkout failed"); b.disabled = false; b.textContent = "Subscribe — $4/mo"; }
  });
}

const SOURCE_LABEL: Record<string, string> = {
  link: "Referral link",
  party: "Watch party",
  household: "Household invite",
  partner: "Partner deal",
};

async function renderReferral(el: HTMLElement): Promise<void> {
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

function renderHousehold(el: HTMLElement): void {
  const profiles = getStoredProfiles();
  const active = getActiveProfile();

  el.innerHTML = card("Profiles", `
    <div class="setProfiles">
      ${profiles.map((p) => `
        <div class="setProfile">
          <span class="setAvatar" style="background:${escapeHtml(p.avatar_color || "#c5f04e")}">${escapeHtml(p.name.charAt(0).toUpperCase())}</span>
          <span class="setProfileMeta">
            <b>${escapeHtml(p.name)}${p.id === active.id ? ` <span class="setDim">(active)</span>` : ""}</b>
            <span>${p.is_kids ? "Kids profile" : p.role === "owner" ? "Account owner" : "Standard profile"}</span>
          </span>
          <button class="setBtn small" data-edit="${escapeHtml(p.id)}">Edit</button>
        </div>`).join("")}
    </div>
    <div class="setBtnRow"><button class="setBtn primary" id="setAddProfile">Add a profile</button></div>`)
    + card("Who can watch what", `<div id="setRatings"></div>`,
        "Rating limits for every profile, side by side. Editing one opens its profile.");

  el.querySelectorAll<HTMLElement>("[data-edit]").forEach((b) => {
    b.addEventListener("click", () => {
      const target = profiles.find((p) => p.id === b.dataset.edit);
      if (target) openProfileEditor(target, () => openSettings("household"));
    });
  });
  el.querySelector("#setAddProfile")?.addEventListener("click", () =>
    openProfileEditor(undefined, () => openSettings("household")));

  // The comparison table is the point of this section: a parent could
  // previously only see one child's limits at a time, inside that child's
  // editor, which made "is her sister allowed this?" a memory exercise.
  const box = el.querySelector<HTMLElement>("#setRatings")!;
  box.innerHTML = `
    <div class="setTable">
      ${profiles.map((p) => {
        const allowed = (p as any).allowed_ratings as string[] | null | undefined;
        const summary = !allowed?.length
          ? `<span class="setDim">Everything</span>`
          : allowed.map((r) => `<span class="setChip">${escapeHtml(r)}</span>`).join("");
        return `<div class="setTableRow"><span>${escapeHtml(p.name)}</span><span>${summary}</span></div>`;
      }).join("")}
    </div>`;
}

function renderPlayback(el: HTMLElement): void {
  const QK = "veedeeoh_pref_quality", CK = "veedeeoh_pref_cc";
  el.innerHTML = card("Playback", `
    <div class="setField">
      <label for="setQuality">Preferred quality</label>
      <select id="setQuality" class="setInput">
        <option value="auto">Auto</option>
        <option value="1080">1080p</option>
        <option value="720">720p</option>
        <option value="480">480p</option>
      </select>
    </div>
    <label class="setCheck"><input type="checkbox" id="setCC" /> <span>Turn on subtitles by default</span></label>`,
    "These apply to this profile on this device, so a tablet on hotel wifi and a TV at home can differ.");

  const q = el.querySelector<HTMLSelectElement>("#setQuality")!;
  q.value = localStorage.getItem(QK) || "auto";
  q.addEventListener("change", () => localStorage.setItem(QK, q.value));

  const cc = el.querySelector<HTMLInputElement>("#setCC")!;
  cc.checked = localStorage.getItem(CK) === "1";
  cc.addEventListener("change", () => localStorage.setItem(CK, cc.checked ? "1" : "0"));
}

function renderAbout(el: HTMLElement): void {
  el.innerHTML = card("About", `
    ${row("veedeeoh", `<span class="setDim">Cloud</span>`)}
    <div class="setBtnRow">
      <button class="setBtn" id="setReport">Report a problem</button>
      <button class="setBtn" id="setInstall">Install app</button>
    </div>`);
  // Forward to the real controls rather than duplicating them, so behaviour
  // cannot drift between here and the sidebar.
  el.querySelector("#setReport")?.addEventListener("click", () =>
    document.getElementById("fbEntry")?.click());
  el.querySelector("#setInstall")?.addEventListener("click", () =>
    document.querySelector<HTMLElement>("#pwaInstallEntry .sidebar-install-main")?.click());
}

const SECTIONS: Section[] = [
  { id: "account",   label: "Account",   icon: ICON.user, kidsSafe: false, render: renderAccount },
  { id: "household", label: "Household", icon: ICON.home, kidsSafe: false, render: renderHousehold },
  { id: "playback",  label: "Playback",  icon: ICON.play, kidsSafe: true,  render: renderPlayback },
  { id: "about",     label: "About",     icon: ICON.info, kidsSafe: true,  render: renderAbout },
];

// ------------------------------------------------------------------ page ---

let currentSection: SectionId = "account";

export function settingsSections(): Section[] {
  const kids = !!getActiveProfile()?.is_kids;
  return SECTIONS.filter((s) => !kids || s.kidsSafe);
}

/** Open the settings page at a section. Called by the router, so it must not
 *  push history itself -- main.ts owns the route. */
export async function renderSettings(section?: string): Promise<void> {
  const available = settingsSections();
  const wanted = available.find((s) => s.id === section) || available[0]!;
  currentSection = wanted.id;

  const nav = document.getElementById("settingsNav");
  const body = document.getElementById("settingsBody");
  if (!nav || !body) return;

  nav.innerHTML = available.map((s) => `
    <button class="setNavBtn${s.id === currentSection ? " active" : ""}" data-sec="${s.id}">
      ${s.icon}<span>${escapeHtml(s.label)}</span>
    </button>`).join("");

  nav.querySelectorAll<HTMLElement>("[data-sec]").forEach((b) => {
    b.addEventListener("click", () => {
      const id = b.dataset.sec!;
      if (id === currentSection) return;
      location.hash = `#settings/${id}`;   // router re-enters renderSettings
    });
  });

  body.innerHTML = "";
  await wanted.render(body);
  document.getElementById("scrollableArea")?.scrollTo({ top: 0 });
}

/** Navigate to settings. The hash is the source of truth, same as every other
 *  view, so a reload or a Back press lands where the user was. */
export function openSettings(section: SectionId = "account"): void {
  location.hash = `#settings/${section}`;
}
