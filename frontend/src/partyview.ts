// veedeeoh.party — the sidebar surface for Watch Party.
//
// A party is meaningless without something to play, so hosting always starts
// from a TITLE -- either the Watch Party button in the detail overlay, or the
// picker below. This panel also covers what the overlay cannot: joining by
// code, and seeing or ending the party you already host.

import { escapeHtml, showToast } from "./util";
import {
  activePartyCode, disconnect, joinParty, partyEnabled, partyLink, recentParty, forgetParty,
  resumeHosting, listPublicParties, socialUrl,
} from "./party";

let viewers = 0;
let mounted: HTMLElement | null = null;

window.addEventListener("veedeeoh:party-presence", (e) => {
  viewers = (e as CustomEvent).detail?.viewers ?? 0;
  if (mounted) renderParty(mounted);
});

export function renderParty(el: HTMLElement): void {
  mounted = el;
  const code = activePartyCode();

  el.innerHTML = `
    <div class="partyWrap">
      <div class="partyHero">
        <h1>veedeeoh<span style="color:#c5f04e;">.</span><span style="color:#c5f04e;">party</span></h1>
        <p>Watch the same thing at the same time. The host controls playback; everyone else follows.</p>
      </div>

      ${code ? activeCard(code) : rejoinCard()}

      <div id="partyFollowing"></div>
      <div id="partyOpenList"></div>

      <section class="partyCard">
        <h2>Join a party</h2>
        <p class="partyHint">Enter the six-character code a host shared with you.</p>
        <div class="partyRow">
          <input id="partyCodeInput" class="partyInput" maxlength="6" autocomplete="off"
                 spellcheck="false" placeholder="ABC234" aria-label="Party code" />
          <button id="partyJoinBtn" class="partyBtn primary">Join</button>
        </div>
      </section>

      <section class="partyCard">
        <h2>Start a party</h2>
        <p class="partyHint">Pick something to watch. You will get a code and a link to share.</p>
        <div id="partyPicker" class="partyPicker"></div>
        <p class="partyHint" style="margin: 12px 0 0;">
          You can also press <strong>Watch Party</strong> on any title's details page.
        </p>
      </section>

      ${partyEnabled() ? "" : `<p class="partyWarn">Watch Party is not configured on this deployment yet.</p>`}
    </div>`;

  const input = el.querySelector<HTMLInputElement>("#partyCodeInput")!;
  // Codes are generated from an uppercase alphabet with no O/0 or I/1, so
  // normalising here means a code read aloud over voice chat still lands.
  input.addEventListener("input", () => {
    input.value = input.value.toUpperCase().replace(/[^A-Z2-9]/g, "").slice(0, 6);
  });
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") join(); });

  const join = () => {
    const c = input.value.trim();
    if (c.length !== 6) { showToast("A party code is six characters"); return; }
    void joinParty(c);
  };
  el.querySelector("#partyJoinBtn")!.addEventListener("click", join);

  el.querySelector("#partyRejoin")?.addEventListener("click", async (e) => {
    const last = recentParty();
    if (!last) return;
    const b = e.currentTarget as HTMLButtonElement;
    b.disabled = true; b.textContent = "Reconnecting…";
    // A host resumes control of their own room; a guest rejoins someone else's.
    // Same button, different action, because to the user it is the same thing.
    if (last.role === "host") await resumeHosting(last.code);
    else await joinParty(last.code);
    b.disabled = false;
  });
  el.querySelector("#partyForget")?.addEventListener("click", async () => {
    const last = recentParty();
    // For a HOST this button says "End it", so it has to actually end the
    // party. Forgetting it locally would leave the room running with guests
    // sitting in it and nobody able to reach the controls.
    if (last?.role === "host") {
      if (!confirm("End this party? Anyone still in it will be disconnected.")) return;
      const { closeParty } = await import("./party");
      await closeParty(last.code);
    }
    forgetParty();
    renderParty(el);
  });

  void renderFollowed(el.querySelector<HTMLElement>("#partyFollowing")!);
  void renderOpenParties(el.querySelector<HTMLElement>("#partyOpenList")!);
  wirePicker(el);

  el.querySelector("#partyCopyBtn")?.addEventListener("click", async () => {
    const c = activePartyCode();
    if (!c) return;
    try { await navigator.clipboard.writeText(partyLink(c)); showToast("Party link copied"); }
    catch { showToast(`Party code ${c}`); }
  });

  el.querySelector("#partyReturnBtn")?.addEventListener("click", async (e) => {
    const c = activePartyCode();
    if (!c) return;
    const b = e.currentTarget as HTMLButtonElement;
    b.disabled = true; b.textContent = "Opening…";
    // Re-resolves the title and reopens the player. Heavier than reusing the
    // last channel, but the last channel is gone once the player is destroyed,
    // and these are the same paths a fresh join or resume already exercises.
    if (recentParty()?.role === "host") await resumeHosting(c);
    else await joinParty(c);
    b.disabled = false;
  });

  el.querySelector("#partyLeaveBtn")?.addEventListener("click", async () => {
    const host = recentParty()?.role === "host";
    if (host) {
      // A host leaving is a host ENDING it. Quietly dropping the socket would
      // strand everyone still watching with nobody driving.
      if (!confirm("End the party for everyone?")) return;
      const { closeParty } = await import("./party");
      await closeParty(activePartyCode() || "");
      showToast("Party ended");
    } else {
      disconnect();
      forgetParty();
      showToast("Left the party");
    }
    renderParty(el);
  });
}

function activeCard(code: string): string {
  // Closing the player does not leave the party -- the socket stays open, which
  // is right, but this card then showed a code and no way back to the video.
  // The host had it worst: still connected, still driving playback nobody could
  // see, with only "Leave party" on offer.
  const host = recentParty()?.role === "host";
  return `
    <section class="partyCard partyActive">
      <h2>${host ? "You are hosting" : "You are in a party"}</h2>
      <div class="partyCodeBig">${escapeHtml(code)}</div>
      <p class="partyHint">${viewers ? `${viewers} watching` : host ? "Waiting for people to join" : "Connected"}</p>
      <div class="partyRow">
        <button id="partyReturnBtn" class="partyBtn primary">Back to the party</button>
        <button id="partyCopyBtn" class="partyBtn">Copy invite link</button>
        <button id="partyLeaveBtn" class="partyBtn danger">${host ? "End party" : "Leave party"}</button>
      </div>
    </section>`;
}

/** Title picker. The rating gate is the picker's own -- and hosting from a kids
 *  profile is refused before this tab is even reachable. */
function wirePicker(el: HTMLElement): void {
  const host = el.querySelector<HTMLElement>("#partyPicker");
  if (!host) return;
  void import("./party-picker").then(({ mountPicker }) => {
    mountPicker(host, async (pick) => {
      const { startWatchParty } = await import("./vod");
      const started = await startWatchParty(pick.item, pick.streamIdx);
      // Re-render so the active-party card appears with the new code.
      if (started && mounted) renderParty(mounted);
    });
  });
}

/** Offered when the viewer has left a party that is probably still running.
 *
 *  Closing the tab used to mean going back to the original invite message to
 *  find the code again -- and the code is not shown anywhere once the player is
 *  open, so there was often nowhere to find it. */
function rejoinCard(): string {
  const last = recentParty();
  if (!last) return "";
  const host = last.role === "host";
  return `
    <section class="partyCard partyActive">
      <h2>${host ? "Your party is still running" : "Rejoin your party"}</h2>
      <p class="partyHint">
        ${host
          ? `You were hosting <strong>${escapeHtml(last.title)}</strong> in party
             <span class="partyCodeInline">${escapeHtml(last.code)}</span>.
             Anyone still in there is waiting on you.`
          : `You were watching <strong>${escapeHtml(last.title)}</strong> in party
             <span class="partyCodeInline">${escapeHtml(last.code)}</span>.`}
      </p>
      <div class="partyRow">
        <button id="partyRejoin" class="partyBtn primary">${host ? "Resume hosting" : "Rejoin"}</button>
        <button id="partyForget" class="partyBtn">${host ? "End it" : "Not now"}</button>
      </div>
    </section>`;
}


/** Parties anyone can drop into.
 *
 *  Rendered only when there is something to show. An empty "open parties"
 *  heading on a new product is worse than no heading: it advertises that
 *  nobody is using the feature, every time someone opens the page.
 *
 *  Gated by the active profile's rating limits like every other surface. The
 *  join path refuses out-of-limit content anyway, but listing something a
 *  profile may not watch and then refusing it is a worse experience than never
 *  offering it.
 */
async function renderOpenParties(box: HTMLElement): Promise<void> {
  if (!box) return;

  let parties = await listPublicParties();
  // NOT an early return with empty markup, which is what this used to do. A
  // section that renders nothing when it is empty cannot be discovered, so
  // nobody learns the feature exists -- and a directory nobody knows about is
  // one nobody hosts for either. It says what it is even when it is quiet.
  if (!parties.length) { box.innerHTML = emptyDirectory(); return; }

  try {
    const { getVodRails } = await import("./vod");
    const { allowedRatingsFor } = await import("./db");
    const { getActiveProfile } = await import("./profiles");

    const rails = await getVodRails();
    const byId = new Map<string, any>();
    for (const r of rails) for (const i of r.items as any[]) byId.set(String(i.id).replace(/^vod:/, ""), i);

    const allowed = allowedRatingsFor(getActiveProfile());
    parties = parties.filter((p) => {
      const item = byId.get(p.content_id);
      // Not in this profile's catalogue at all -- a different region, or
      // excluded -- so do not advertise it.
      if (!item) return false;
      if (!allowed) return true;
      return allowed.has(String(item.rating || "").toUpperCase());
    }).map((p) => ({ ...p, art: byId.get(p.content_id)?.banner || byId.get(p.content_id)?.poster || "" }));
  } catch { /* if the catalogue will not load, list what we have */ }

  if (!parties.length) { box.innerHTML = emptyDirectory(); return; }

  const ago = (iso: string) => {
    const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
    if (m < 1) return "just started";
    return m < 60 ? `${m}m in` : `${Math.floor(m / 60)}h ${m % 60}m in`;
  };

  box.innerHTML = `
    <section class="partyCard">
      <h2>Happening now</h2>
      <p class="partyHint">Parties anyone can drop into. The host controls playback.</p>
      <div class="partyPickList">
        ${parties.map((p: any) => `
          <div class="partyOpenRow">
            <button class="partyPick" data-code="${escapeHtml(p.join_code)}">
              <img src="${escapeHtml(p.art || "")}" alt="" loading="lazy">
              <span>
                <span class="partyPickTitle">${escapeHtml(p.title || "Untitled")}</span><br>
                <span class="partyPickMeta">${p.host_name ? `${escapeHtml(p.host_name)} &middot; ` : ""}${escapeHtml(ago(p.started_at))}
                  &middot; ${p.joined_count} watching${p.seat_limit ? ` of ${p.seat_limit}` : ""}</span>
                ${p.blurb ? `<br><span class="partyBlurb">${escapeHtml(p.blurb)}</span>` : ""}
              </span>
            </button>
            ${socialLink(p)}
          </div>`).join("")}
      </div>
    </section>`;

  box.querySelectorAll<HTMLElement>("[data-code]").forEach((b) => {
    b.addEventListener("click", () => {
      (b as HTMLButtonElement).disabled = true;
      void joinParty(b.dataset.code!);
    });
  });
}


const SOCIAL_LABEL: Record<string, string> = {
  discord: "Discord", twitch: "Twitch", youtube: "YouTube",
  x: "X", tiktok: "TikTok", instagram: "Instagram",
};

function emptyDirectory(): string {
  return `
    <section class="partyCard">
      <h2>Happening now</h2>
      <p class="partyHint">
        Parties anyone can drop into. Nothing is open at the moment, so this is
        as good a time as any to be the one running it.
      </p>
      <p class="partyHint partyEmptyNote">
        Pick something below, tick <strong>List this publicly</strong>, and it
        shows up here for everyone.
      </p>
    </section>`;
}

/** The host's channel, if they set one.
 *
 *  Built from a platform and a handle, never from a stored URL -- so a
 *  disguised link, a redirect or a shortener cannot appear here. rel is
 *  noopener noreferrer because this is an outbound link to a stranger's page
 *  shown under veedeeoh's name. */
function socialLink(p: any): string {
  const url = socialUrl(p.social_platform, p.social_handle);
  if (!url) return "";
  return `<a class="partySocial" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer"
     title="${escapeHtml(SOCIAL_LABEL[p.social_platform] || "Channel")}">
     ${escapeHtml(SOCIAL_LABEL[p.social_platform] || "Channel")}</a>`;
}

// ---------------------------------------------------------------------------
// Hosts you follow
// ---------------------------------------------------------------------------

/** Pinned above the open directory. The whole reason to follow someone is that
 *  their party should not be one row among strangers' -- if it is, following
 *  has bought you nothing. */
async function renderFollowed(box: HTMLElement): Promise<void> {
  if (!box) return;
  const { followedLiveParties } = await import("./party");
  const rows = await followedLiveParties().catch(() => []);
  if (!rows.length) { box.innerHTML = ""; return; }

  box.innerHTML = `
    <section class="partyCard partyFollowed">
      <h2>From hosts you follow</h2>
      <div class="partyPickList">
        ${rows.map((p) => `
          <div class="partyOpenRow">
            <button class="partyPick" data-code="${escapeHtml(p.join_code)}">
              <span class="pfLive" aria-hidden="true"></span>
              <span>
                <span class="partyPickTitle">${escapeHtml(p.title || "Untitled")}</span><br>
                <span class="partyPickMeta">${escapeHtml(p.host_name || "A host")}
                  &middot; ${p.joined_count} watching</span>
                ${p.blurb ? `<br><span class="partyBlurb">${escapeHtml(p.blurb)}</span>` : ""}
              </span>
            </button>
            ${p.host_handle
              ? `<a class="partySocial" href="#host/${encodeURIComponent(p.host_handle)}">Profile</a>`
              : ""}
          </div>`).join("")}
      </div>
    </section>`;

  box.querySelectorAll<HTMLElement>("[data-code]").forEach((b) => {
    b.addEventListener("click", () => {
      (b as HTMLButtonElement).disabled = true;
      void joinParty(b.dataset.code!);
    });
  });
}

// ---------------------------------------------------------------------------
// A public profile
// ---------------------------------------------------------------------------

/** Someone's public profile, rendered into the party panel so a permalink lands
 *  somewhere that already has the rest of the party furniture around it. */
export async function renderProfilePage(el: HTMLElement, handle: string): Promise<void> {
  mounted = null;
  el.innerHTML = `<div class="partyWrap"><p class="partyHint">Loading…</p></div>`;

  const { publicProfile, followHost } = await import("./party");
  const page = await publicProfile(handle);

  if (!page.ok) {
    el.innerHTML = `
      <div class="partyWrap">
        <div class="partyHero"><h1>Not found</h1>
        <p>There is nobody at that address.</p></div>
        <div class="partyRow"><a class="partyBtn" href="#party">Back to veedeeoh.party</a></div>
      </div>`;
    return;
  }

  const live = page.live || [];
  el.innerHTML = `
    <div class="partyWrap">
      <section class="partyCard hostCard">
        <div class="hostTop">
          <div>
            <h1 class="hostName">${escapeHtml(page.name || handle)}</h1>
            <p class="hostHandle">@${escapeHtml(page.handle || handle)}</p>
          </div>
          ${page.isSelf ? "" : `
            <button class="partyBtn ${page.following ? "" : "primary"}" id="hostFollow">
              ${page.following ? "Following" : "Follow"}
            </button>`}
        </div>
        ${page.bio ? `<p class="hostBio">${escapeHtml(page.bio)}</p>` : ""}
        ${profileFacts(page)}
        <p class="hostMeta">
          ${page.followers ? `${page.followers} follower${page.followers === 1 ? "" : "s"}` : ""}
          ${page.followers && socialUrl(page.platform ?? null, page.handleSocial ?? null) ? " &middot; " : ""}
          ${socialUrl(page.platform ?? null, page.handleSocial ?? null)
            ? `<a class="partySocial" href="${escapeHtml(socialUrl(page.platform ?? null, page.handleSocial ?? null)!)}"
                  target="_blank" rel="noopener noreferrer">${escapeHtml(SOCIAL_LABEL[page.platform || ""] || "Channel")}</a>`
            : ""}
        </p>
      </section>

      <section class="partyCard">
        <h2>${live.length ? "On right now" : "Nothing on right now"}</h2>
        ${live.length ? `
          <div class="partyPickList">
            ${live.map((p) => `
              <div class="partyOpenRow">
                <button class="partyPick" data-code="${escapeHtml(p.joinCode)}">
                  <span class="pfLive" aria-hidden="true"></span>
                  <span>
                    <span class="partyPickTitle">${escapeHtml(p.title || "Untitled")}</span><br>
                    <span class="partyPickMeta">${p.watching} watching</span>
                    ${p.blurb ? `<br><span class="partyBlurb">${escapeHtml(p.blurb)}</span>` : ""}
                  </span>
                </button>
              </div>`).join("")}
          </div>`
        : `<p class="partyHint">${page.isSelf
            ? "Parties you list publicly will show here."
            : "Follow to see it here when they start one."}</p>`}
      </section>

      ${picksSection(page)}
      ${recentSection(page)}

      <div class="partyRow">
        <a class="partyBtn" href="#party">Back to veedeeoh.party</a>
        ${page.isSelf ? "" : `<button class="partyBtn" id="hostSuggest">Suggest something</button>`}
        <button class="partyBtn" id="hostShare">Copy link</button>
        ${page.isSelf ? "" : `<button class="partyBtn subtle" id="hostReport">Report</button>`}
      </div>
    </div>`;

  el.querySelectorAll<HTMLElement>("[data-code]").forEach((b) => {
    b.addEventListener("click", () => {
      (b as HTMLButtonElement).disabled = true;
      void joinParty(b.dataset.code!);
    });
  });

  el.querySelector("#hostShare")?.addEventListener("click", async () => {
    const url = `${location.origin}${location.pathname}#u/${encodeURIComponent(page.handle || handle)}`;
    try { await navigator.clipboard.writeText(url); showToast("Profile link copied"); }
    catch { showToast(url); }
  });

  // A TITLE, never a message. Pointing at something in the catalogue is a row
  // with a content id in it; letting people write to a stranger is a moderation
  // queue. Only the first is worth having here.
  el.querySelector("#hostSuggest")?.addEventListener("click", async () => {
    const { pickSheet } = await import("./party-setup");
    const chosen = await pickSheet(`Suggest something to ${page.name || handle}`);
    if (!chosen) return;
    const { suggestToHost } = await import("./party");
    const err = await suggestToHost(page.handle || handle, String(chosen.item.id), chosen.item.title);
    showToast(err || `Suggested ${chosen.item.title}`);
  });

  el.querySelector("#hostReport")?.addEventListener("click", () => void reportSheet(page.handle || handle));

  const btn = el.querySelector<HTMLButtonElement>("#hostFollow");
  btn?.addEventListener("click", async () => {
    btn.disabled = true;
    const now = await followHost(page.userId!, !page.following);
    page.following = now;
    btn.textContent = now ? "Following" : "Follow";
    btn.classList.toggle("primary", !now);
    btn.disabled = false;
    showToast(now ? `Following ${page.name}` : `Unfollowed ${page.name}`);
  });
}

const WEEKDAYS = ["Sundays","Mondays","Tuesdays","Wednesdays","Thursdays","Fridays","Saturdays"];

const REGION_LABEL: Record<string, string> = {
  US: "United States", GB: "United Kingdom", CA: "Canada",
  DE: "Germany", ES: "Spain", MX: "Mexico", FR: "France",
};

/** Region and schedule.
 *
 *  Region is not decoration: a party plays region-locked content and the join
 *  refuses a title that is not in the viewer's catalogue, so following someone
 *  in another region can mean never being able to join anything they run. The
 *  schedule is what turns a follow into a habit -- it tells someone when to
 *  come back rather than relying on them being here when a party starts. */
function profileFacts(page: any): string {
  const bits: string[] = [];
  if (page.region) {
    const mine = (localStorage.getItem("tvlc_region") || "US").toUpperCase();
    const label = REGION_LABEL[page.region] || page.region;
    bits.push(page.region === mine
      ? `Hosts from ${escapeHtml(label)}`
      : `Hosts from ${escapeHtml(label)}, so some titles may not be in your catalogue`);
  }
  if (page.hostsWeekday != null && page.hostsHour != null) {
    const hour = Number(page.hostsHour);
    const h12 = `${((hour + 11) % 12) + 1}${hour < 12 ? "am" : "pm"}`;
    bits.push(`Usually hosts ${WEEKDAYS[Number(page.hostsWeekday)]} around ${h12}${
      page.hostsTz ? ` ${escapeHtml(String(page.hostsTz))}` : ""}`);
  }
  if (!bits.length) return "";
  return `<ul class="hostFacts">${bits.map((b) => `<li>${b}</li>`).join("")}</ul>`;
}

function picksSection(page: any): string {
  const picks = (page.picks || []) as Array<{ contentId: string; title: string | null; poster: string | null }>;
  if (!picks.length) return "";
  return `
    <section class="partyCard">
      <h2>Recommends</h2>
      <div class="hostPicks">
        ${picks.slice(0, 18).map((k) => `
          <figure class="hostPick">
            ${k.poster ? `<img src="${escapeHtml(k.poster)}" alt="" loading="lazy">` : `<span class="hostPickBlank"></span>`}
            <figcaption>${escapeHtml(k.title || "Untitled")}</figcaption>
          </figure>`).join("")}
      </div>
    </section>`;
}

function recentSection(page: any): string {
  const recent = (page.recent || []) as string[];
  if (!recent.length) return "";
  return `
    <section class="partyCard">
      <h2>Recently hosted</h2>
      <p class="partyHint">${recent.map((t) => escapeHtml(t)).join(" &middot; ")}</p>
    </section>`;
}

// A report control, because a page carrying a name, a line of text and an
// outbound link written by one person and shown to strangers under veedeeoh's
// name needs one. Reasons are fixed: a free text box here would be one more
// place to receive abuse, and none of it is needed to say what is wrong.
const REPORT_REASONS: Array<[string, string]> = [
  ["impersonation", "Pretending to be someone else"],
  ["abusive", "Abusive or hateful"],
  ["spam", "Spam or a scam link"],
  ["adult", "Adult or graphic content"],
  ["other", "Something else"],
];

async function reportSheet(handle: string): Promise<void> {
  document.getElementById("profileReport")?.remove();
  const sheet = document.createElement("div");
  sheet.id = "profileReport";
  sheet.innerHTML = `
    <div class="pkkCard" role="dialog" aria-modal="true" aria-label="Report this profile">
      <h2>Report @${escapeHtml(handle)}</h2>
      <p class="partyHint">We read every report. The person is not told who sent it.</p>
      <div class="pkkList">
        ${REPORT_REASONS.map(([code, label]) => `
          <button class="pkkReason" data-code="${code}"><span class="pkkLabel">${escapeHtml(label)}</span></button>`).join("")}
      </div>
      <button class="partyBtn pkkCancel">Cancel</button>
    </div>`;
  document.body.appendChild(sheet);

  const close = () => sheet.remove();
  sheet.querySelector(".pkkCancel")!.addEventListener("click", close);
  sheet.addEventListener("click", (e) => { if (e.target === sheet) close(); });
  sheet.querySelectorAll<HTMLElement>(".pkkReason").forEach((b) => {
    b.addEventListener("click", async () => {
      close();
      const { reportProfile } = await import("./party");
      await reportProfile(handle, b.dataset.code || "other");
      // The same answer either way, including for a repeat report: whether
      // something is already on file is not information this should leak.
      showToast("Thanks. We will take a look");
    });
  });
}
