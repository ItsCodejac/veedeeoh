// Watch party setup, and the host's lobby.
//
// Replaces three stacked prompt() dialogs. OS prompts could not show the title
// being hosted, could not validate, could not be cancelled halfway without
// losing the earlier answers, and looked like a phishing attempt on top of a
// video player.
//
// The password went with them. It travelled in the same message as the link, so
// it protected nothing -- and the boot handler read it from `?pw=`, which put it
// in browser history, server logs and referrer headers. Access control is now a
// seat limit plus host approval, which is what the password was badly
// approximating.

import type { VodItem } from "./types";
import { escapeHtml, showToast } from "./util";

export interface PartySetup {
  seatLimit: number | null;
  requireApproval: boolean;
}

/** Resolves with the chosen settings, or null if the host backed out. */
export function openPartySetup(item: VodItem): Promise<PartySetup | null> {
  return new Promise((resolve) => {
    document.getElementById("partySetup")?.remove();

    const art = item.banner || item.poster || "";
    const el = document.createElement("div");
    el.id = "partySetup";
    el.innerHTML = `
      <div class="psSheet" role="dialog" aria-modal="true" aria-labelledby="psTitle">
        <div class="psHead">
          ${art ? `<img class="psArt" src="${escapeHtml(art)}" alt="">` : ""}
          <div>
            <div class="psKicker">Start a watch party</div>
            <h2 id="psTitle">${escapeHtml(item.title)}</h2>
          </div>
        </div>

        <div class="psField">
          <span class="psLabel">Who can join</span>
          <div class="psChoice" role="radiogroup" aria-label="Who can join">
            <button type="button" class="psOpt selected" data-approval="1" role="radio" aria-checked="true">
              <b>Ask me first</b>
              <em>You approve each person before they see anything</em>
            </button>
            <button type="button" class="psOpt" data-approval="0" role="radio" aria-checked="false">
              <b>Anyone with the link</b>
              <em>No approval step</em>
            </button>
          </div>
        </div>

        <div class="psField">
          <label class="psLabel" for="psSeats">Seat limit</label>
          <input id="psSeats" class="psInput" type="number" inputmode="numeric"
                 min="1" max="500" step="1" placeholder="Leave blank for no limit"
                 aria-describedby="psSeatsHint" />
          <span class="psSub" id="psSeatsHint">People waiting for approval do not use a seat.</span>
        </div>

        <p class="psNote">
          You control playback. Everyone else follows along, and each person
          streams from the provider directly &mdash; nothing is re-broadcast.
        </p>

        <div class="psRow">
          <button class="psBtn" id="psCancel">Cancel</button>
          <button class="psBtn primary" id="psGo">Start party</button>
        </div>
      </div>`;

    const done = (v: PartySetup | null) => { el.remove(); resolve(v); };

    el.addEventListener("click", (e) => { if (e.target === el) done(null); });
    el.querySelector("#psCancel")!.addEventListener("click", () => done(null));
    // Segmented rather than <select>: a native option list cannot be styled, it
    // renders as an OS menu over the app, and "Ask me before letting someone in"
    // was truncating inside the control. Two and five short options both fit on
    // screen, so there is nothing a dropdown was buying.
    const pick = (group: string, cls: string) => {
      el.querySelectorAll<HTMLElement>(`[data-${group}]`).forEach((b) => {
        b.addEventListener("click", () => {
          el.querySelectorAll<HTMLElement>(`[data-${group}]`).forEach((o) => {
            o.classList.remove("selected");
            o.setAttribute("aria-checked", "false");
          });
          b.classList.add("selected");
          b.setAttribute("aria-checked", "true");
        });
        void cls;
      });
    };
    pick("approval", "psOpt");

    const seatsEl = el.querySelector<HTMLInputElement>("#psSeats")!;
    // Blank means unlimited, so an empty field must stay empty -- clamping on
    // input would turn "I am still typing" into a number the host did not pick.
    seatsEl.addEventListener("blur", () => {
      const v = seatsEl.value.trim();
      if (!v) return;
      const n = Math.round(Number(v));
      seatsEl.value = Number.isFinite(n) && n >= 1 ? String(Math.min(500, n)) : "";
    });

    el.querySelector("#psGo")!.addEventListener("click", () => {
      const raw = seatsEl.value.trim();
      const n = raw ? Math.round(Number(raw)) : NaN;
      const approval = el.querySelector<HTMLElement>("[data-approval].selected")?.dataset.approval;
      done({
        seatLimit: Number.isFinite(n) && n >= 1 ? Math.min(500, n) : null,
        requireApproval: approval !== "0",
      });
    });
    // Escape cancels, which a prompt() chain never allowed cleanly.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { document.removeEventListener("keydown", onKey); done(null); }
    };
    document.addEventListener("keydown", onKey);

    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add("in"));
  });
}

// ------------------------------------------------------------------ lobby ---

let lobby: HTMLElement | null = null;

/** The host's controls while a party is running: the invite link, who is
 *  waiting, and a way to end it. Mounted over the player, because that is where
 *  the host is looking. */
export function mountHostLobby(joinCode: string, link: string): void {
  unmountHostLobby();

  lobby = document.createElement("div");
  lobby.id = "partyLobby";
  lobby.innerHTML = `
    <div class="plBar">
      <span class="plCode">${escapeHtml(joinCode)}</span>
      <button class="plBtn" id="plCopy">Copy invite link</button>
      <span class="plCount" id="plCount">0 watching</span>
      <button class="plBtn danger" id="plEnd">End party</button>
    </div>
    <div class="plKnocks" id="plKnocks"></div>`;
  document.body.appendChild(lobby);

  lobby.querySelector("#plCopy")!.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(link); showToast("Invite link copied"); }
    catch { showToast(`Party code ${joinCode}`); }
  });
  lobby.querySelector("#plEnd")!.addEventListener("click", async () => {
    if (!confirm("End the party for everyone?")) return;
    const { endParty } = await import("./party");
    endParty();
    unmountHostLobby();
  });

  window.addEventListener("veedeeoh:party-presence", onPresence);
  window.addEventListener("veedeeoh:party-waiting", onWaiting);
}

export function unmountHostLobby(): void {
  window.removeEventListener("veedeeoh:party-presence", onPresence);
  window.removeEventListener("veedeeoh:party-waiting", onWaiting);
  lobby?.remove();
  lobby = null;
}

function onPresence(e: Event): void {
  const n = (e as CustomEvent).detail?.viewers ?? 0;
  const el = document.getElementById("plCount");
  if (el) el.textContent = `${n} watching`;
}

function onWaiting(e: Event): void {
  const waiting = ((e as CustomEvent).detail?.waiting ?? []) as Array<{ userId: string; name: string }>;
  const box = document.getElementById("plKnocks");
  if (!box) return;

  box.innerHTML = waiting.map((w) => `
    <div class="plKnock" data-uid="${escapeHtml(w.userId)}">
      <span><b>${escapeHtml(w.name)}</b> wants to join</span>
      <button class="plBtn small primary" data-act="admit">Let in</button>
      <button class="plBtn small" data-act="refuse">No</button>
    </div>`).join("");

  box.querySelectorAll<HTMLElement>("[data-act]").forEach((b) => {
    b.addEventListener("click", async () => {
      const uid = b.closest<HTMLElement>(".plKnock")?.dataset.uid;
      if (!uid) return;
      const { respondToKnock } = await import("./party");
      respondToKnock(uid, b.dataset.act === "admit");
      b.closest(".plKnock")?.remove();
    });
  });
}
