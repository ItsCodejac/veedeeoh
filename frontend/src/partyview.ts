// veedeeoh.party — the sidebar surface for Watch Party.
//
// Hosting starts from a TITLE (the Watch Party button in the detail overlay),
// because a party is meaningless without something to play. This panel is the
// other half: joining by code, and seeing/ending the party you already host.

import { escapeHtml, showToast } from "./util";
import {
  activePartyCode, disconnect, joinParty, partyEnabled, partyLink,
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
      <header class="partyHero">
        <h1>veedeeoh<span style="color:#c5f04e;">.</span><span style="color:#c5f04e;">party</span></h1>
        <p>Watch the same thing at the same time. The host controls playback; everyone else follows.</p>
      </header>

      ${code ? activeCard(code) : ""}

      <section class="partyCard">
        <h2>Join a party</h2>
        <p class="partyHint">Enter the six-character code a host shared with you.</p>
        <div class="partyRow">
          <input id="partyCodeInput" class="partyInput" maxlength="6" autocomplete="off"
                 spellcheck="false" placeholder="ABC234" aria-label="Party code" />
          <input id="partyPassInput" class="partyInput" type="password" autocomplete="off"
                 placeholder="Password (if any)" aria-label="Party password" />
          <button id="partyJoinBtn" class="partyBtn primary">Join</button>
        </div>
      </section>

      <section class="partyCard">
        <h2>Start a party</h2>
        <p class="partyHint">
          Open any title, then press <strong>Watch Party</strong> on its details page.
          You will get a code and a link to share.
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
    void joinParty(c, el.querySelector<HTMLInputElement>("#partyPassInput")!.value || undefined);
  };
  el.querySelector("#partyJoinBtn")!.addEventListener("click", join);

  el.querySelector("#partyCopyBtn")?.addEventListener("click", async () => {
    const c = activePartyCode();
    if (!c) return;
    try { await navigator.clipboard.writeText(partyLink(c)); showToast("Party link copied"); }
    catch { showToast(`Party code ${c}`); }
  });

  el.querySelector("#partyLeaveBtn")?.addEventListener("click", () => {
    disconnect();
    showToast("Left the party");
    renderParty(el);
  });
}

function activeCard(code: string): string {
  return `
    <section class="partyCard partyActive">
      <h2>You are in a party</h2>
      <div class="partyCodeBig">${escapeHtml(code)}</div>
      <p class="partyHint">${viewers ? `${viewers} watching` : "Waiting for people to join"}</p>
      <div class="partyRow">
        <button id="partyCopyBtn" class="partyBtn">Copy invite link</button>
        <button id="partyLeaveBtn" class="partyBtn danger">Leave party</button>
      </div>
    </section>`;
}
