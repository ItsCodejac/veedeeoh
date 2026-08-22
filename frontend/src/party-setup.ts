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

/** Phone-sized and touch-primary. Not a blocklist -- hosting from a phone is
 *  allowed, because it works as long as the tab stays open. This only warns,
 *  since backgrounding is a completely routine thing to do with a phone and a
 *  host who does not know that will blame the app. */
function isPhone(): boolean {
  return window.matchMedia("(max-width: 820px), (pointer: coarse)").matches;
}

export interface PartySetup {
  seatLimit: number | null;
  requireApproval: boolean;
}

/** The handoff from the catalogue into the party surface.
 *
 *  Clicking Watch Party used to leave the detail overlay on screen while a lazy
 *  chunk loaded and the sheet faded in over the top of it -- nothing said the
 *  press had registered, so it read as unresponsive rather than as a
 *  transition. This wipes the catalogue away first, on the veedeeoh.party mark,
 *  and hands over to the setup sheet.
 *
 *  Kept to ~520ms on purpose. Long enough to read as deliberate, short enough
 *  that it never becomes the thing standing between a host and their party.
 */
export function partyTransition(): Promise<void> {
  return new Promise((resolve) => {
    // The detail overlay must go BEFORE the wipe covers the screen, or it is
    // still sitting underneath when the setup sheet opens.
    document.getElementById("vodDetailsOverlay")?.setAttribute("hidden", "");

    const el = document.createElement("div");
    el.id = "partyWipe";
    el.innerHTML = `
      <div class="pwMark">veedeeoh<span class="dot">.</span><span class="sfx">party</span></div>`;
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add("in"));

    setTimeout(() => {
      el.classList.add("out");
      setTimeout(() => el.remove(), 320);
      resolve();
    }, 520);
  });
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
        ${isPhone() ? `
          <p class="psWarn">
            Hosting from a phone works, but keep this tab open. Switching apps
            or locking the screen suspends the sync, and the party carries on
            without you until you come back.
          </p>` : ""}

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

// ------------------------------------------------------------- green room ---

const partyArt = (item: VodItem) => item.banner || item.poster || "";

/** The host's green room. Nothing plays until they say so.
 *
 *  Creating a party used to start the film immediately, so the host was
 *  watching alone while still copying the link, and anyone who arrived came in
 *  part-way through. The party now has a beginning that the host controls.
 *
 *  Resolves when they press play. */
export function showHostLobby(
  item: VodItem, joinCode: string, link: string, seatLimit: number | null = null,
): Promise<void> {
  return new Promise((resolve) => {
    const el = document.createElement("div");
    el.id = "partyRoom";
    el.innerHTML = `
      <div class="prInner">
        <div class="prMark">veedeeoh<span class="dot">.</span><span class="sfx">party</span></div>
        ${partyArt(item) ? `<img class="prArt" src="${escapeHtml(partyArt(item))}" alt="">` : ""}
        <h1 class="prTitle">${escapeHtml(item.title)}</h1>

        <div class="prCodeBlock">
          <span class="prCodeLabel">Party code</span>
          <span class="prCode">${escapeHtml(joinCode)}</span>
          <button class="prBtn" id="prCopy">Copy invite link</button>
        </div>

        <div class="prRoster" id="prRoster"></div>

        <button class="prBtn primary big" id="prStart">Start watching</button>
        <button class="prBtn text" id="prCancel">Cancel the party</button>
        <p class="prNote">Nobody sees anything until you press start.</p>
      </div>`;
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add("in"));

    // How many waiting people to list individually before collapsing. Thirty
    // knocks at once -- a link posted in a group chat -- rendered thirty rows
    // in a 460px column, pushing Start watching a screen and a half below the
    // fold and asking the host to tap sixty buttons while everyone waited.
    const KNOCK_LIST_MAX = 6;

    const paintRoster = (e?: Event) => {
      const d = (e as CustomEvent)?.detail || {};
      const watching: any[] = d.watching ?? [];
      const waiting: any[] = d.waiting ?? [];
      const box = el.querySelector<HTMLElement>("#prRoster");
      if (!box) return;

      const shown = waiting.slice(0, KNOCK_LIST_MAX);
      const hidden = waiting.length - shown.length;
      // Seats are what actually constrains this, so say so rather than letting
      // the host admit twenty people into an eight-seat party and find out from
      // the worker's refusals.
      const seatNote = seatLimit
        ? `<div class="prSeats">${watching.length} of ${seatLimit} seats used</div>`
        : "";

      box.innerHTML = `
        ${waiting.length ? `
          <div class="prWaiting">
            <div class="prSub">${waiting.length === 1 ? "1 person wants to join" : `${waiting.length} people want to join`}</div>
            ${waiting.length > 1 ? `
              <div class="prBulk">
                <button class="prBtn small primary" data-bulk="admit">Let everyone in</button>
                <button class="prBtn small" data-bulk="refuse">Refuse all</button>
              </div>` : ""}
            ${shown.map((w) => `
              <div class="prPerson" data-uid="${escapeHtml(w.userId)}">
                <span>${escapeHtml(w.name)}</span>
                <span>
                  <button class="prBtn small primary" data-act="admit">Let in</button>
                  <button class="prBtn small" data-act="refuse">No</button>
                </span>
              </div>`).join("")}
            ${hidden > 0 ? `<div class="prMore">and ${hidden} more waiting</div>` : ""}
          </div>` : ""}
        ${seatNote}
        <div class="prSub">${watching.length ? `${watching.length} ready` : "Waiting for people to join"}</div>
        <div class="prChips">
          ${watching.slice(0, 24).map((w) => `<span class="prChip">${escapeHtml(w.name)}</span>`).join("")}
          ${watching.length > 24 ? `<span class="prChip">+${watching.length - 24}</span>` : ""}
        </div>`;

      box.querySelectorAll<HTMLElement>("[data-bulk]").forEach((b) => {
        b.addEventListener("click", async () => {
          const admit = b.dataset.bulk === "admit";
          if (!admit && !confirm(`Refuse all ${waiting.length}?`)) return;
          const { respondToKnock } = await import("./party");
          // Every currently waiting id, not just the visible ones -- the point
          // of the button is to clear the queue, including the collapsed tail.
          for (const w of waiting) respondToKnock(w.userId, admit);
        });
      });

      box.querySelectorAll<HTMLElement>("[data-act]").forEach((b) => {
        b.addEventListener("click", async () => {
          const uid = b.closest<HTMLElement>("[data-uid]")?.dataset.uid;
          if (!uid) return;
          const { respondToKnock } = await import("./party");
          respondToKnock(uid, b.dataset.act === "admit");
          b.closest<HTMLElement>("[data-uid]")?.remove();
        });
      });
    };
    paintRoster();
    window.addEventListener("veedeeoh:party-roster", paintRoster);

    const close = () => {
      window.removeEventListener("veedeeoh:party-roster", paintRoster);
      el.classList.remove("in");
      setTimeout(() => el.remove(), 320);
    };

    el.querySelector("#prCopy")!.addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(link); showToast("Invite link copied"); }
      catch { showToast(`Party code ${joinCode}`); }
    });
    el.querySelector("#prStart")!.addEventListener("click", () => { close(); resolve(); });
    el.querySelector("#prCancel")!.addEventListener("click", async () => {
      if (!confirm("Cancel this party? Anyone waiting will be disconnected.")) return;
      const { endParty } = await import("./party");
      endParty();
      close();
    });
  });
}

/** The guest's side of the same moment. No controls -- they are waiting on
 *  someone else -- so this only has to say what they are waiting for, and make
 *  it obvious the link worked. */
export function showGuestLobby(item: any, joinCode: string): () => void {
  const el = document.createElement("div");
  el.id = "partyRoom";
  el.innerHTML = `
    <div class="prInner">
      <div class="prMark">veedeeoh<span class="dot">.</span><span class="sfx">party</span></div>
      ${partyArt(item) ? `<img class="prArt" src="${escapeHtml(partyArt(item))}" alt="">` : ""}
      <h1 class="prTitle">${escapeHtml(item.title)}</h1>
      <div class="prSub">Party ${escapeHtml(joinCode)}</div>
      <div class="vdTrackBar"><span></span></div>
      <p class="prNote" id="prGuestNote">Waiting for the host to start</p>
    </div>`;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add("in"));

  // The host may still be approving them; say so rather than leaving the same
  // line up regardless of what is actually happening.
  const pending = () => {
    const n = el.querySelector("#prGuestNote");
    if (n) n.textContent = "Waiting for the host to let you in";
  };
  const admitted = () => {
    const n = el.querySelector("#prGuestNote");
    if (n) n.textContent = "You are in. Waiting for the host to start";
  };
  window.addEventListener("veedeeoh:party-pending", pending);
  window.addEventListener("veedeeoh:party-admitted", admitted);

  let gone = false;
  return () => {
    if (gone) return;
    gone = true;
    window.removeEventListener("veedeeoh:party-pending", pending);
    window.removeEventListener("veedeeoh:party-admitted", admitted);
    el.classList.remove("in");
    setTimeout(() => el.remove(), 320);
  };
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
  // NOT "partyPanel": that id already belongs to the veedeeoh.party PAGE
  // container in index.html, so this rule set -- position:fixed, pinned right,
  // vertically centred -- was landing on the page itself and shoving it against
  // the right edge of the window.
  lobby.id = "partyHostPanel";
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
