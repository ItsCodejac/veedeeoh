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
  // A BLANK PANE IS NOT AN ANSWER, and it was the wrong diagnosis too.
  // myReferralCode() calls ensure_referral_code, which MINTS one -- so a null
  // here does not mean "no code yet", it means the call failed: signed out, or
  // the network. Offering "get my link" would have been a button for a problem
  // nobody has. Say what happened and let them try again.
  if (!code) {
    el.innerHTML = card("Refer and earn", `
      <p class="setHint" style="margin:0 0 14px">
        Could not load your referral details just now.
      </p>
      <button class="setBtn" id="setRefRetry">Try again</button>`);
    el.querySelector("#setRefRetry")?.addEventListener("click", () => { void renderReferral(el); });
    return;
  }

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
      <button class="setBtn primary" id="setRefShare" hidden>Share</button>
      <button class="setBtn" id="setRefCopy">Copy</button>
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
      : "Anyone who joins a watch party you host is credited to you too, without this link. "
        + "A referral is yours for 90 days; once they subscribe it is yours for good. "
        + "Payouts are made by hand while the programme is in beta.");


  // WHAT GETS SHARED IS A SENTENCE, NOT A URL. Copying a bare link means
  // writing "hey, try this" yourself every time, which for somebody sharing
  // twenty times is nineteen more sentences than they should have to write --
  // and a naked link pasted into a chat is the thing people do not click.
  const shareText = "I'm watching free movies and TV on veedeeoh. Thousands of "
    + "titles in one app, and you can watch together in sync. Have a look:";

  // Feature-detected rather than assumed. navigator.share exists on phones and
  // in Safari, and is missing in most desktop browsers -- offering a button
  // that throws is worse than not offering one.
  const shareBtn = el.querySelector<HTMLButtonElement>("#setRefShare");
  if (shareBtn && typeof navigator.share === "function") {
    shareBtn.hidden = false;
    shareBtn.addEventListener("click", async () => {
      try {
        await navigator.share({ title: "veedeeoh", text: shareText, url: link });
      } catch (e: any) {
        // AbortError is the user closing the sheet, which is not a failure and
        // must not be reported as one.
        if (e?.name !== "AbortError") showToast("Could not open the share sheet");
      }
    });
  }

  el.querySelector("#setRefCopy")?.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(`${shareText} ${link}`);
      showToast("Message and link copied");
    } catch { el.querySelector<HTMLInputElement>("#setRefLink")?.select(); }
  });
}


const WEEKDAYS = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"];

const REGIONS: Array<[string, string]> = [
  ["US", "United States"], ["GB", "United Kingdom"], ["CA", "Canada"],
  ["DE", "Germany"], ["ES", "Spain"], ["MX", "Mexico"], ["FR", "France"],
];

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

/** A public page, and the handle that addresses it.
 *
 *  ENTIRELY OPT IN, and the handle is what opts you in: there is no page until
 *  one is claimed, and clearing it withdraws the page again. Nothing on it is
 *  derived from the account -- not the email, not the join date, not anything
 *  watched -- only what is typed into these three fields, plus parties the host
 *  has separately chosen to list publicly.
 */
async function renderPublicProfile(root: HTMLElement): Promise<void> {
  const { getSupabase } = await import("./auth");
  const { data: u } = await getSupabase().auth.getUser();
  if (!u.user) return;
  const { data } = await getSupabase()
    .from("profiles").select("public_handle, display_name, bio")
    .eq("id", u.user.id).maybeSingle();

  const cur = {
    handle: (data as any)?.public_handle || "",
    name: (data as any)?.display_name || "",
    bio: (data as any)?.bio || "",
  };

  const box = document.createElement("div");
  box.innerHTML = card("Your public page", `
    <div class="setField">
      <label class="setLabel" for="ppHandle">Handle</label>
      <input id="ppHandle" class="setInput" maxlength="24" placeholder="yourname"
             value="${escapeHtml(cur.handle)}" />
    </div>
    <div class="setField">
      <label class="setLabel" for="ppName">Display name</label>
      <input id="ppName" class="setInput" maxlength="40" placeholder="What people call you"
             value="${escapeHtml(cur.name)}" />
    </div>
    <div class="setField">
      <label class="setLabel" for="ppBio">About</label>
      <input id="ppBio" class="setInput" maxlength="200" placeholder="One line about what you host"
             value="${escapeHtml(cur.bio)}" />
    </div>
    <div class="setField">
      <label class="setLabel" for="ppRegion">Region you host from</label>
      <select id="ppRegion" class="setInput" style="max-width:220px">
        <option value="">Not shown</option>
        ${REGIONS.map(([v, l]) => `<option value="${v}">${l}</option>`).join("")}
      </select>
    </div>
    <div class="setField">
      <label class="setLabel" for="ppDay">Usually hosts</label>
      <div class="setBtnRow">
        <select id="ppDay" class="setInput" style="max-width:150px">
          <option value="">Not shown</option>
          ${WEEKDAYS.map((d, i) => `<option value="${i}">${d}</option>`).join("")}
        </select>
        <select id="ppHour" class="setInput" style="max-width:120px">
          ${Array.from({ length: 24 }, (_, h) =>
            `<option value="${h}">${((h + 11) % 12) + 1}${h < 12 ? "am" : "pm"}</option>`).join("")}
        </select>
      </div>
    </div>
    <div class="setBtnRow">
      <button class="setBtn" id="ppSave">Save</button>
      <a class="setBtn" id="ppView" href="#host/${encodeURIComponent(cur.handle)}"
         ${cur.handle ? "" : "hidden"}>View page</a>
    </div>
    <p class="setHint" id="ppLink">${cur.handle
      ? `People can find you at <strong>veedeeoh.com/app#host/${escapeHtml(cur.handle)}</strong>`
      : ""}</p>`,
    "Claim a handle and people can follow you, so your public parties reach them. Leave the handle blank to take the page down. Lowercase letters, numbers and underscores.");
  root.appendChild(box);

  // Region matters more than it looks: a party plays region-locked content and
  // the join refuses a title the viewer's catalogue does not have, so saying
  // where you host from stops someone following you for parties they could
  // never join.
  const { data: extra } = await getSupabase()
    .from("profiles").select("region, hosts_weekday, hosts_hour, hosts_tz")
    .eq("id", u.user.id).maybeSingle();
  const sel = (id: string) => box.querySelector<HTMLSelectElement>(id)!;
  sel("#ppRegion").value = (extra as any)?.region || "";
  sel("#ppDay").value = (extra as any)?.hosts_weekday == null ? "" : String((extra as any).hosts_weekday);
  sel("#ppHour").value = String((extra as any)?.hosts_hour ?? 20);

  box.querySelector("#ppSave")!.addEventListener("click", async (e) => {
    const b = e.currentTarget as HTMLButtonElement;
    const handle = (box.querySelector("#ppHandle") as HTMLInputElement).value.trim().toLowerCase();
    const name = (box.querySelector("#ppName") as HTMLInputElement).value;
    const bio = (box.querySelector("#ppBio") as HTMLInputElement).value;
    b.disabled = true;
    try {
      const { claimHandle, saveProfileExtras } = await import("./party");
      const err = await claimHandle(handle, name, bio);
      if (err) { showToast(err); return; }
      const day = sel("#ppDay").value;
      await saveProfileExtras({
        region: sel("#ppRegion").value || null,
        weekday: day === "" ? null : Number(day),
        hour: day === "" ? null : Number(sel("#ppHour").value),
        // Captured from the browser rather than asked for: nobody knows their
        // own IANA zone, and a schedule without one is a time in no place.
        tz: day === "" ? null : (Intl.DateTimeFormat().resolvedOptions().timeZone || null),
      });
      showToast(handle ? "Public page saved" : "Public page taken down");
      const view = box.querySelector<HTMLAnchorElement>("#ppView");
      const hint = box.querySelector<HTMLElement>("#ppLink");
      if (view) { view.href = `#host/${encodeURIComponent(handle)}`; view.toggleAttribute("hidden", !handle); }
      if (hint) {
        hint.innerHTML = handle
          ? `People can find you at <strong>veedeeoh.com/app#host/${escapeHtml(handle)}</strong>` : "";
      }
    } finally { b.disabled = false; }
  });
}

/** What you recommend, shown on your public page.
 *
 *  A DELIBERATE LIST rather than My List republished. Repurposing a private
 *  watchlist means someone discovers they have published something they saved
 *  for themselves, and there is no good apology for that. Built with the same
 *  picker the party uses, so adding to it is browsing rather than typing.
 */
async function renderPicks(root: HTMLElement): Promise<void> {
  const box = document.createElement("div");
  box.innerHTML = card("What you recommend", `
    <div id="pkList" class="setPickRow"></div>
    <div class="setBtnRow"><button class="setBtn" id="pkAdd">Add a title</button></div>`,
    "Shown on your public page. Nothing appears here unless you put it there.");
  root.appendChild(box);

  const list = box.querySelector<HTMLElement>("#pkList")!;
  const { myPicks, setPick } = await import("./party");

  const paint = async () => {
    const picks = await myPicks();
    if (!picks.length) { list.innerHTML = `<p class="setHint">Nothing yet.</p>`; return; }
    list.replaceChildren();
    for (const k of picks) {
      const chip = document.createElement("span");
      chip.className = "setChip";
      chip.innerHTML = `${escapeHtml(k.title || k.content_id)}
        <button class="setChipX" aria-label="Remove">&times;</button>`;
      chip.querySelector("button")!.addEventListener("click", async () => {
        await setPick(k.content_id, false);
        void paint();
      });
      list.append(chip);
    }
  };
  void paint();

  box.querySelector("#pkAdd")!.addEventListener("click", async () => {
    const { pickSheet } = await import("./party-setup");
    const chosen = await pickSheet("Add a recommendation");
    if (!chosen) return;
    await setPick(String(chosen.item.id), true, chosen.item.title, chosen.item.poster || chosen.item.banner);
    void paint();
  });
}

/** What people have asked you to host.
 *
 *  Counts only, never who asked. Someone pointing at a title should not have to
 *  wonder whether they are being watched doing it. */
async function renderSuggestionsInbox(root: HTMLElement): Promise<void> {
  const { mySuggestions } = await import("./party");
  const rows = await mySuggestions().catch(() => []);
  if (!rows.length) return;

  const box = document.createElement("div");
  box.innerHTML = card("Suggested to you", `
    <div class="setPickRow">
      ${rows.slice(0, 20).map((r) => `
        <span class="setChip">${escapeHtml(r.title || r.content_id)}
          ${r.votes > 1 ? `<b class="setChipN">${r.votes}</b>` : ""}</span>`).join("")}
    </div>`,
    "Titles people would like you to host. Who asked stays private.");
  root.appendChild(box);
}

/** Settings > Public profile.
 *
 *  These four were rendered by renderReferral because they happened to live in
 *  the same file, which put "your recommendations" and "who suggested what to
 *  you" inside a section called Refer and earn. Filing by module is not filing
 *  by meaning: one of these is how you get paid, the other is who you are.
 */
export async function renderPublicSection(el: HTMLElement): Promise<void> {
  el.innerHTML = "";
  await renderPublicProfile(el);
  await renderHostChannel(el);
  await renderPicks(el);
  await renderSuggestionsInbox(el);
}
