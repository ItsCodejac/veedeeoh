// veedeeoh.party — the sidebar surface for Watch Party.
//
// A party is meaningless without something to play, so hosting always starts
// from a TITLE -- either the Watch Party button in the detail overlay, or the
// picker below. This panel also covers what the overlay cannot: joining by
// code, and seeing or ending the party you already host.

import type { VodItem } from "./types";
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
        <p class="partyHint">Pick something to watch. You will get a code and a link to share.</p>
        <div class="partyRow">
          <input id="partyPickInput" class="partyInput" autocomplete="off" spellcheck="false"
                 placeholder="Search movies and shows" aria-label="Search for something to host" />
        </div>
        <div id="partyPickResults" class="partyPickList"></div>
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
    void joinParty(c, el.querySelector<HTMLInputElement>("#partyPassInput")!.value || undefined);
  };
  el.querySelector("#partyJoinBtn")!.addEventListener("click", join);

  wirePicker(el);

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

/** Title picker. Reuses the catalog search ranking, so it is gated by the
 *  active profile's rating limits exactly like every other surface -- and
 *  hosting from a kids profile is refused before this tab is even reachable. */
function wirePicker(el: HTMLElement): void {
  const input = el.querySelector<HTMLInputElement>("#partyPickInput");
  const list = el.querySelector<HTMLElement>("#partyPickResults");
  if (!input || !list) return;

  let timer = 0;
  let token = 0;

  const run = async (q: string) => {
    const mine = ++token;
    const { searchCatalog } = await import("./search");
    const results = (await searchCatalog(q)).slice(0, 8);
    // A slower earlier query must not overwrite a newer one's results.
    if (mine !== token) return;

    if (!results.length) {
      list.innerHTML = `<p class="partyHint" style="margin:12px 0 0;">Nothing found for "${escapeHtml(q)}".</p>`;
      return;
    }

    list.replaceChildren();
    for (const item of results) list.append(pickRow(item));
  };

  input.addEventListener("input", () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (!q) { token++; list.replaceChildren(); return; }
    timer = window.setTimeout(() => void run(q), 150);
  });
}

function pickRow(item: VodItem): HTMLElement {
  const b = document.createElement("button");
  b.className = "partyPick";
  const img = item.banner || item.poster || "";
  const meta = [item.genre, item.rating].filter(Boolean).join(" \u00b7 ");
  b.innerHTML = `
    <img src="${escapeHtml(img)}" alt="" loading="lazy">
    <span>
      <span class="partyPickTitle">${escapeHtml(item.title)}</span><br>
      <span class="partyPickMeta">${escapeHtml(meta)}</span>
    </span>`;

  b.addEventListener("click", async () => {
    b.disabled = true;
    const { startWatchParty } = await import("./vod");
    const started = await startWatchParty(item);
    b.disabled = false;
    // Re-render so the active-party card appears with the new code.
    if (started && mounted) renderParty(mounted);
  });
  return b;
}
