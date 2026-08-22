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
  if (!parties.length) { box.innerHTML = ""; return; }

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

  if (!parties.length) { box.innerHTML = ""; return; }

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
