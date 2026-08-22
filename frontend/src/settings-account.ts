// Settings > Account. Split out of settingsview.ts when the danger zone landed,
// because a page module that both routes AND renders every section stops being
// readable at about this size.

import { escapeHtml, showToast } from "./util";
import { getSession, signOut, getSupabase } from "./auth";
import { getActiveProfile, getStoredProfiles } from "./profiles";
import { getAccount, openBillingPortal, startCheckout } from "./db";
import { card, row, fmtDate } from "./settings-ui";

export async function renderAccount(el: HTMLElement): Promise<void> {
  const session = getSession();
  const active = getActiveProfile();

  el.innerHTML =
    card("Account", `
      ${row("Signed in as", escapeHtml(session?.email || "Local / self-hosted"))}
      ${row("Role", active.role === "owner" ? "Account owner" : "Household member")}
      <div class="setField">
        <label for="setAccountName">Household name</label>
        <input id="setAccountName" type="text" placeholder="e.g. Cojac's Household" />
      </div>`)
    + `<div id="setBilling"></div>`
    + `<div id="setReferral"></div>`
    + card("Sign-in and security", `
        <div class="setBtnRow">
          <a class="setBtn" href="/change-password.html">Change password</a>
          <button class="setBtn" id="setSignOutAll">Sign out everywhere</button>
          <button class="setBtn danger" id="setSignOut">Sign out</button>
        </div>`,
        "Signing out everywhere ends every session on every device, including this one. Use it if you have lost a device or shared a password.")
    + card("Your data", `
        <div class="setBtnRow">
          <button class="setBtn" id="setExport">Download my data</button>
          <button class="setBtn danger" id="setDelete">Delete my account</button>
        </div>`,
        "Deleting is permanent and takes your profiles, watch history and lists with it. Any active subscription is cancelled first.");

  const nameInput = el.querySelector<HTMLInputElement>("#setAccountName")!;
  nameInput.value = localStorage.getItem("veedeeoh_account_name")
    || (session?.email ? session.email.split("@")[0]! : "My Household");
  nameInput.addEventListener("change", () => {
    const v = nameInput.value.trim();
    if (v) { localStorage.setItem("veedeeoh_account_name", v); showToast("Household name saved"); }
  });

  el.querySelector("#setSignOut")?.addEventListener("click", () => { void signOut(); });

  el.querySelector("#setSignOutAll")?.addEventListener("click", async () => {
    if (!confirm("Sign out of veedeeoh on every device, including this one?")) return;
    // scope: "global" revokes every refresh token for the user, which is the
    // whole point -- the default scope would only end the session in this tab.
    try { await getSupabase().auth.signOut({ scope: "global" }); } catch { /* fall through */ }
    void signOut();
  });

  el.querySelector("#setExport")?.addEventListener("click", (e) => void exportData(e));
  el.querySelector("#setDelete")?.addEventListener("click", () => void confirmDelete(session?.email || ""));

  void renderBilling(el.querySelector<HTMLElement>("#setBilling")!);
  const { renderReferral } = await import("./settings-referral");
  void renderReferral(el.querySelector<HTMLElement>("#setReferral")!);
}

// ---------------------------------------------------------------- billing ---

// Reports FACTS. The panel this replaced hardcoded "Pro Cloud Tier", "$4.00 /
// month", a renewal date of August 28 2026 and a feature list, none of it read
// from the account -- so every subscriber saw a renewal date that was not
// theirs -- plus two add-ons that do not exist, one priced "$TBD/mo".
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
    cloud_paid: "veedeeoh Cloud", founder_vip: "Founder",
    trial: "Free trial", canceled: "Canceled",
  };
  const label = TIER_LABEL[acct.tier] || acct.tier;
  const expires = acct.tier_expires ? new Date(acct.tier_expires) : null;
  const daysLeft = expires ? Math.ceil((expires.getTime() - Date.now()) / 86_400_000) : null;
  const lapsed = daysLeft !== null && daysLeft <= 0;
  const comped = acct.tier === "founder_vip";

  // A comped account keeps the row and is TOLD it is not charged, rather than
  // having the section hidden. Hiding it leaves someone unable to tell whether
  // the thing is free for them or simply missing.
  const dateLabel = comped ? "Access" : lapsed ? "Ended" : acct.tier === "trial" ? "Trial ends" : "Renews";
  const dateValue = comped ? "No expiry" : fmtDate(acct.tier_expires);

  el.innerHTML = card("Plan and billing", `
    ${row("Plan", `<span class="setBadge${comped ? " gold" : ""}">${escapeHtml(label)}</span>`)}
    ${row(dateLabel, escapeHtml(dateValue)
        + (daysLeft !== null && daysLeft > 0 && !comped
            ? ` <span class="setDim">(${daysLeft} day${daysLeft === 1 ? "" : "s"})</span>` : ""))}
    ${row("Profiles", `${getStoredProfiles().length} of ${acct.seats ?? 3} seats`)}
    <div class="setBtnRow">
      ${comped ? "" : acct.tier === "cloud_paid"
        ? `<button class="setBtn" id="setPortal">Manage billing</button>`
        : `<button class="setBtn primary" id="setSubscribe">Subscribe — $4/mo</button>`}
    </div>
    ${comped ? `<p class="setHint">Comped account. You are not charged, and there is nothing to manage.</p>` : ""}`);

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

// ------------------------------------------------------------ data rights ---

async function authedFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const { data } = await getSupabase().auth.getSession();
  const token = data.session?.access_token;
  return fetch(path, {
    ...init,
    headers: { ...(init.headers || {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
}

async function exportData(e: Event): Promise<void> {
  const b = e.currentTarget as HTMLButtonElement;
  b.disabled = true; b.textContent = "Preparing…";
  try {
    const res = await authedFetch("/api/account/export");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = new Blob([JSON.stringify(await res.json(), null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `veedeeoh-data-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast("Download started");
  } catch {
    showToast("Couldn't prepare your data. Try again shortly.");
  } finally {
    b.disabled = false; b.textContent = "Download my data";
  }
}

/** Deletion asks the user to type their email. An accidental click here cannot
 *  be undone, and confirm() alone is one stray Enter key away from wiping an
 *  account. The server checks the same string, so the friction is real rather
 *  than cosmetic. */
async function confirmDelete(email: string): Promise<void> {
  const typed = prompt(
    `This permanently deletes your account, every profile, and all watch history.\n\n`
    + `Any active subscription is cancelled first.\n\n`
    + `Type ${email} to confirm:`
  );
  if (typed === null) return;
  if (typed.trim().toLowerCase() !== email.toLowerCase()) {
    showToast("That did not match. Nothing was deleted.");
    return;
  }

  try {
    const res = await authedFetch("/api/account/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirm: typed.trim() }),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) { showToast(out?.error || "Deletion failed. Nothing was removed."); return; }

    // Surfaced, not swallowed: the account is gone, so the user can no longer
    // look this up themselves if Stripe refused the cancellation.
    if (out.billingError) {
      alert(`Your account was deleted, but the subscription could not be cancelled automatically:\n\n`
        + `${out.billingError}\n\nPlease check your card statement and contact support@veedeeoh.com.`);
    }
    void signOut();
  } catch {
    showToast("Deletion failed. Nothing was removed.");
  }
}
