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
let roster: { watching: Array<{ userId: string; name: string }>; waiting: Array<{ userId: string; name: string }> } =
  { watching: [], waiting: [] };
let joinCodeRef = "";
let linkRef = "";
let expanded = false;
let startedAt = 0;

/** The host's panel while a party runs.
 *
 *  Was a single always-open bar across the top of the video. It covered the
 *  picture, showed a bare viewer count, and put an arriving join request in the
 *  same visual weight as everything else -- the owner missed one while testing,
 *  which is the one thing this panel exists to prevent.
 *
 *  Collapsed to a tab by default so it stops sitting on the film; a pending
 *  request forces it open and marks the tab, because that is the only event
 *  here that needs an answer.
 */
export function mountHostLobby(joinCode: string, link: string): void {
  unmountHostLobby();
  joinCodeRef = joinCode;
  linkRef = link;
  roster = { watching: [], waiting: [] };
  expanded = false;
  startedAt = Date.now();

  lobby = document.createElement("div");
  lobby.id = "partyPanel";
  document.body.appendChild(lobby);
  render();

  window.addEventListener("veedeeoh:party-roster", onRoster);
  window.addEventListener("veedeeoh:party-presence", onPresence);
  clock = window.setInterval(render, 30_000);
}

let clock: number | null = null;

export function unmountHostLobby(): void {
  window.removeEventListener("veedeeoh:party-roster", onRoster);
  window.removeEventListener("veedeeoh:party-presence", onPresence);
  if (clock !== null) { clearInterval(clock); clock = null; }
  lobby?.remove();
  lobby = null;
}

function onRoster(e: Event): void {
  const d = (e as CustomEvent).detail || {};
  const hadWaiting = roster.waiting.length;
  roster = { watching: d.watching ?? [], waiting: d.waiting ?? [] };
  // A new request opens the panel by itself. Anything less relies on the host
  // happening to look at a collapsed tab mid-film.
  if (roster.waiting.length > hadWaiting) expanded = true;
  render();
}

function onPresence(): void { render(); }

function elapsed(): string {
  const m = Math.floor((Date.now() - startedAt) / 60_000);
  if (m < 1) return "just started";
  const h = Math.floor(m / 60);
  return h ? `${h}h ${m % 60}m` : `${m}m`;
}

function render(): void {
  if (!lobby) return;
  const waiting = roster.waiting.length;

  lobby.className = expanded ? "open" : "";
  lobby.innerHTML = `
    <button class="ppTab${waiting ? " alert" : ""}" id="ppToggle"
            aria-expanded="${expanded}" aria-label="Watch party controls">
      <span class="ppCode">${escapeHtml(joinCodeRef)}</span>
      <span class="ppDot"></span>
      <span class="ppCount">${roster.watching.length}</span>
      ${waiting ? `<span class="ppBadge">${waiting}</span>` : ""}
    </button>

    <div class="ppBody">
      ${waiting ? `
        <div class="ppSection ppUrgent">
          <div class="ppHead">${waiting === 1 ? "1 person wants to join" : `${waiting} people want to join`}</div>
          ${roster.waiting.map((w) => `
            <div class="ppRow" data-uid="${escapeHtml(w.userId)}">
              <span class="ppName">${escapeHtml(w.name)}</span>
              <span>
                <button class="ppBtn primary" data-act="admit">Let in</button>
                <button class="ppBtn" data-act="refuse">No</button>
              </span>
            </div>`).join("")}
        </div>` : ""}

      <div class="ppSection">
        <div class="ppHead">Invite</div>
        <div class="ppRow">
          <span class="ppBigCode">${escapeHtml(joinCodeRef)}</span>
          <button class="ppBtn" id="ppCopy">Copy link</button>
        </div>
      </div>

      <div class="ppSection">
        <div class="ppHead">Watching &middot; ${roster.watching.length}</div>
        ${roster.watching.length
          ? roster.watching.map((w) => `
              <div class="ppRow" data-uid="${escapeHtml(w.userId)}">
                <span class="ppName">${escapeHtml(w.name)}</span>
                <button class="ppBtn subtle" data-act="kick">Remove</button>
              </div>`).join("")
          : `<div class="ppEmpty">Nobody yet. Share the link.</div>`}
      </div>

      <div class="ppSection">
        <div class="ppRow"><span class="ppMuted">Running for</span><span>${elapsed()}</span></div>
        <div class="ppRow"><span class="ppMuted">Hosting uses</span><span>1 credit / 10 min</span></div>
      </div>

      <button class="ppBtn danger wide" id="ppEnd">End party for everyone</button>
    </div>`;

  lobby.querySelector("#ppToggle")!.addEventListener("click", () => { expanded = !expanded; render(); });

  lobby.querySelector("#ppCopy")?.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(linkRef); showToast("Invite link copied"); }
    catch { showToast(`Party code ${joinCodeRef}`); }
  });

  lobby.querySelector("#ppEnd")?.addEventListener("click", async () => {
    if (!confirm("End the party for everyone?")) return;
    const { endParty } = await import("./party");
    endParty();
    unmountHostLobby();
  });

  lobby.querySelectorAll<HTMLElement>("[data-act]").forEach((b) => {
    b.addEventListener("click", async () => {
      const uid = b.closest<HTMLElement>("[data-uid]")?.dataset.uid;
      if (!uid) return;
      const party = await import("./party");
      const act = b.dataset.act;
      if (act === "kick") {
        if (!confirm("Remove this person from the party?")) return;
        party.kickViewer(uid);
      } else {
        party.respondToKnock(uid, act === "admit");
      }
      // Optimistic: the worker's next roster broadcast is authoritative, but
      // leaving the row on screen makes the button feel dead.
      b.closest<HTMLElement>("[data-uid]")?.remove();
    });
  });
}
