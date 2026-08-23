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
import { mountOnTop, unmountFromTop } from "./overlay";

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
  /** Opted in to the open directory. Explicit, not inferred from the other two
   *  settings: a host picking "anyone with the link" for convenience should not
   *  find out later that strangers were watching. */
  isPublic: boolean;
  blurb: string | null;
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

        <label class="psCheck" id="psPublicRow" hidden>
          <input type="checkbox" id="psPublic" />
          <span>
            <b>List it publicly</b>
            <em>Anyone browsing veedeeoh.party can drop in. You can still remove people,
              and anyone who signs up from your party earns you a share of what they pay.</em>
          </span>
        </label>

        <div class="psField" id="psBlurbRow" hidden>
          <label class="psLabel" for="psBlurb">Say what it is</label>
          <input id="psBlurb" class="psInput" maxlength="70" placeholder="Horror night, come in late" />
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

    // Listing is only offered once approval is off. A public party that makes
    // strangers knock is a queue the host did not sign up to manage, and the
    // stranger has no idea who they are waiting on.
    const publicRow = el.querySelector<HTMLElement>("#psPublicRow")!;
    const publicBox = el.querySelector<HTMLInputElement>("#psPublic")!;
    const blurbRow = el.querySelector<HTMLElement>("#psBlurbRow")!;
    const syncPublic = () => {
      const open = el.querySelector<HTMLElement>("[data-approval].selected")?.dataset.approval === "0";
      publicRow.hidden = !open;
      if (!open) publicBox.checked = false;
      // A blurb only means anything on a listing, so it appears with one.
      blurbRow.hidden = !publicBox.checked;
    };
    publicBox.addEventListener("change", syncPublic);

    // Checked up front so a host who is capped or blocked finds out before
    // choosing, rather than by having the tick silently ignored.
    void (async () => {
      try {
        const { canListPublicParty } = await import("./party");
        const r = await canListPublicParty();
        if (!r.ok) {
          publicBox.disabled = true;
          publicRow.classList.add("disabled");
          publicRow.querySelector("em")!.textContent = r.reason || "Listing is unavailable right now.";
        }
      } catch { /* leave it enabled; the insert is still guarded */ }
    })();
    el.querySelectorAll<HTMLElement>("[data-approval]").forEach((b) =>
      b.addEventListener("click", syncPublic));
    syncPublic();

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
        isPublic: publicBox.checked && approval === "0",
        blurb: (el.querySelector<HTMLInputElement>("#psBlurb")?.value || "").trim() || null,
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
      <div class="phcBox" id="prGuestChannel"></div>
      <button class="partyBtn prLeave" id="prGuestLeave">Leave</button>
    </div>`;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add("in"));

  // Waiting is the best moment for this: nothing is playing, and "join the chat
  // while you wait" is the whole point of a host running one.
  void fillHostChannel(el.querySelector<HTMLElement>("#prGuestChannel"));

  // WAITING WAS A ROOM WITH NO DOOR. A guest whose request the host had not
  // answered -- or was never going to -- had no way out of this screen except
  // closing the tab, which is not a control, it is an escape.
  el.querySelector("#prGuestLeave")!.addEventListener("click", async () => {
    const { disconnect, forgetParty } = await import("./party");
    disconnect();
    forgetParty();
    close();
    showToast("Left the party");
  });

  // The host may still be approving them; say so rather than leaving the same
  // line up regardless of what is actually happening.
  const pending = () => {
    const n = el.querySelector("#prGuestNote");
    if (n) n.textContent = "Waiting for the host to let you in";
    const b = el.querySelector("#prGuestLeave");
    if (b) b.textContent = "Cancel request";
  };
  const admitted = () => {
    const n = el.querySelector("#prGuestNote");
    if (n) n.textContent = "You are in. Waiting for the host to start";
    const b = el.querySelector("#prGuestLeave");
    if (b) b.textContent = "Leave";
  };
  window.addEventListener("veedeeoh:party-pending", pending);
  window.addEventListener("veedeeoh:party-admitted", admitted);

  let gone = false;
  function close(): void {
    if (gone) return;
    gone = true;
    window.removeEventListener("veedeeoh:party-pending", pending);
    window.removeEventListener("veedeeoh:party-admitted", admitted);
    el.classList.remove("in");
    setTimeout(() => el.remove(), 320);
  }
  return close;
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

      <button class="ppBtn wide" id="ppNext">Change what's playing</button>
      <button class="ppBtn danger wide" id="ppEnd">End party for everyone</button>
    </div>`;

  lobby.querySelector("#ppToggle")!.addEventListener("click", () => { expanded = !expanded; render(); });

  lobby.querySelector("#ppCopy")?.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(linkRef); showToast("Invite link copied"); }
    catch { showToast(`Party code ${joinCodeRef}`); }
  });

  lobby.querySelector("#ppNext")?.addEventListener("click", () => {
    expanded = false; render();
    void showNextPicker();
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
        const name = b.closest<HTMLElement>("[data-uid]")?.querySelector(".ppName")?.textContent || "them";
        const reason = await askRemovalReason(name);
        if (!reason) return;
        party.kickViewer(uid, reason);
      } else {
        party.respondToKnock(uid, act === "admit");
      }
      // Optimistic: the worker's next roster broadcast is authoritative, but
      // leaving the row on screen makes the button feel dead.
      b.closest<HTMLElement>("[data-uid]")?.remove();
    });
  });
}


// -------------------------------------------------------------- ended ------

/** What everyone sees when a party finishes.
 *
 *  Ending used to close the socket and nothing else: the film carried on
 *  playing for the host AND for every viewer, so the only signal that the party
 *  was over was that it silently stopped syncing. Worse for a viewer, who had
 *  no way to tell "the party ended" from "the host paused".
 *
 *  The host gets a summary because they were running something and deserve to
 *  know how it went; a viewer gets the exit and a way back to browsing.
 */
export function showPartyEnded(opts: {
  host: boolean;
  title: string;
  code: string;
  watchedSecs: number;
  peakViewers?: number;
  reason?: string;
  partyId?: string;
}): void {
  document.getElementById("partyEnded")?.remove();

  const mins = Math.max(1, Math.round(opts.watchedSecs / 60));
  const dur = mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins} min`;

  const el = document.createElement("div");
  el.id = "partyEnded";
  el.innerHTML = `
    <div class="peInner">
      <div class="peMark">veedeeoh<span class="dot">.</span><span class="sfx">party</span></div>
      <h1 class="peTitle">${opts.host ? "Party ended" : "The party ended"}</h1>
      <p class="peSub">${escapeHtml(opts.title)}</p>

      ${opts.host ? `
        <div class="peStats">
          <div><b>${escapeHtml(dur)}</b><span>Watched</span></div>
          <div><b>${opts.peakViewers ?? 0}</b><span>Most watching</span></div>
          <div><b>${escapeHtml(opts.code)}</b><span>Party code</span></div>
        </div>
        <p class="peNote">Hosting used about ${Math.max(1, Math.ceil(mins / 10))} credit${Math.ceil(mins / 10) === 1 ? "" : "s"}.</p>
        <p class="peNote" id="peEarned"></p>
      ` : `
        <p class="peNote">${opts.reason === "idle"
          ? "It timed out after everyone left."
          : "The host closed it. You can keep watching on your own."}</p>
      `}

      <div class="peRow" id="peActions"></div>

      ${opts.host ? "" : `<div class="phcBox" id="peChannel"></div>`}

      <div id="peUpsell"></div>
    </div>`;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add("in"));

  const close = () => { el.classList.remove("in"); setTimeout(() => el.remove(), 300); };
  void renderEndedActions(el.querySelector<HTMLElement>("#peActions")!, opts, close);
  void renderEndedUpsell(el.querySelector<HTMLElement>("#peUpsell")!, opts.host);
  // The end of a party is when someone decides whether they want the next one.
  // Handing them the host's channel here is the difference between an audience
  // and a one-off.
  if (!opts.host) void fillHostChannel(el.querySelector<HTMLElement>("#peChannel"));
  if (opts.host && opts.partyId) void renderEndedEarnings(el, opts.partyId);

}

/** Two actions, chosen by who this is and what they can actually do.
 *
 *  Not four. An ending screen is where someone wants an obvious next step, and
 *  a menu is the opposite of that. The pair changes instead:
 *
 *  A LAPSED GUEST cannot browse, so "Home" was a lie -- it walked them into a
 *  paywall. Joining another party is the only thing they can genuinely do, so
 *  it becomes their second action rather than a nice extra.
 */
async function renderEndedActions(
  box: HTMLElement,
  opts: { host: boolean },
  close: () => void,
): Promise<void> {
  if (!box) return;

  let entitled = true;
  try {
    const { hasActiveAccess } = await import("./db");
    entitled = await hasActiveAccess();
  } catch { /* fail open: a browse button that works is better than one hidden */ }

  const secondary = opts.host
    ? { id: "peAnother", label: "Start another party" }
    : entitled
      ? { id: "peExplore", label: "Explore veedeeoh" }
      : { id: "peAnother", label: "Join another party" };

  box.innerHTML = `
    <button class="prBtn primary" id="peKeep">${opts.host ? "Explore veedeeoh" : "Keep watching this"}</button>
    <button class="prBtn" id="${secondary.id}">${escapeHtml(secondary.label)}</button>`;

  const shutPlayer = async () => {
    const { closeVodPlayer } = await import("./vodplayer");
    closeVodPlayer();
  };

  // A viewer may well want to finish the film alone, so this leaves the player
  // up for them. The host is done with it.
  box.querySelector("#peKeep")!.addEventListener("click", async () => {
    close();
    if (opts.host) { await shutPlayer(); location.hash = "#home"; }
  });

  box.querySelector("#peExplore")?.addEventListener("click", async () => {
    close(); await shutPlayer(); location.hash = "#home";
  });

  box.querySelector("#peAnother")?.addEventListener("click", async () => {
    close(); await shutPlayer(); location.hash = "#party";
  });
}


/** Conversion prompt on the ended screen.
 *
 *  This is the highest-intent moment a party guest will ever have: they just
 *  finished something they chose to watch with people they know. Deliberately
 *  quiet though -- below the real actions, no colour competing with them, and
 *  absent entirely for anyone already paying. A hard sell over the end of a
 *  film someone enjoyed is how you lose the goodwill the film just earned.
 */
async function renderEndedUpsell(box: HTMLElement, isHost: boolean): Promise<void> {
  if (!box) return;
  try {
    const { hasActiveAccess, trialDaysLeft, getAccount, startCheckout } = await import("./db");

    if (await hasActiveAccess()) {
      // On a trial, and only near the end. Someone on day one does not need
      // reminding, and a subscriber needs nothing at all.
      const days = await trialDaysLeft();
      const acct = await getAccount();
      if (days === null || days > 3 || !String(acct?.tier || "").startsWith("trial")) return;
      box.innerHTML = `<p class="peUpsell">${days <= 1 ? "Your trial ends tomorrow" : `${days} days left in your trial`}.
        <button class="peLink" id="peSub">Keep your profiles and lists</button></p>`;
    } else if (!isHost) {
      // A lapsed guest: they can follow party links forever but cannot browse.
      // Say exactly that, because it is true and it is the actual difference.
      box.innerHTML = `<p class="peUpsell">You can always join a party you are invited to.
        <button class="peLink" id="peSub">Watch anything, any time &mdash; $4/mo</button></p>`;
    } else {
      return;
    }

    box.querySelector("#peSub")?.addEventListener("click", async () => {
      try { await startCheckout(); } catch { showToast("Couldn't start checkout"); }
    });
  } catch { box.innerHTML = ""; }
}


/** What the host earned from this party.
 *
 *  Every join creates a first-touch, permanent referral to the host, so a
 *  public host has been doing affiliate work and being paid for it without
 *  ever being told. Shown only when it is non-zero: "0 people signed up" is a
 *  worse thing to read at the end of your own party than nothing at all.
 */
async function renderEndedEarnings(root: HTMLElement, partyId: string): Promise<void> {
  const box = root.querySelector<HTMLElement>("#peEarned");
  if (!box) return;
  try {
    const { partySignups } = await import("./party");
    const n = await partySignups(partyId);
    if (!n) return;
    box.innerHTML = `<strong>${n} ${n === 1 ? "person" : "people"} signed up from this party.</strong>
      You earn a share of everything they pay, for a year.`;
  } catch { /* a missing number is better than a wrong one */ }
}

// ---------------------------------------------------------------------------
// Moving the room on
// ---------------------------------------------------------------------------
//
// A party was one title and then it was over: the film ended, the player shut,
// and everyone was returned to the catalogue individually with the socket still
// open behind them. To watch a second thing together the host had to end the
// party and build a new one, which means re-sharing the link and losing whoever
// does not come back. These two sheets are the difference between an evening and
// a single showing.

/** Host: pick the next thing, mid-party. Sits over the player rather than
 *  replacing it, so backing out leaves the room exactly as it was. */
export async function showNextPicker(): Promise<void> {
  document.getElementById("partyNextSheet")?.remove();

  const sheet = document.createElement("div");
  sheet.id = "partyNextSheet";
  sheet.innerHTML = `
    <div class="pnCard" role="dialog" aria-modal="true" aria-label="Choose what to watch next">
      <div class="pnHead">
        <h2>What's next</h2>
        <button class="pnClose" aria-label="Close">&times;</button>
      </div>
      <p class="partyHint">Everyone in the party moves with you.</p>
      <div class="pnPicker"></div>
    </div>`;
  document.body.appendChild(sheet);

  const close = () => sheet.remove();
  sheet.querySelector(".pnClose")!.addEventListener("click", close);
  sheet.addEventListener("click", (e) => { if (e.target === sheet) close(); });

  const { mountPicker } = await import("./party-picker");
  mountPicker(sheet.querySelector<HTMLElement>(".pnPicker")!, async (pick) => {
    const card = sheet.querySelector<HTMLElement>(".pnCard")!;
    card.classList.add("busy");
    const { switchPartyTo } = await import("./party");
    const ok = await switchPartyTo(pick.item, pick.streamIdx);
    card.classList.remove("busy");
    if (ok) { close(); dismissWrap(); }
  });
}

let wrapEl: HTMLElement | null = null;

/** Shown to everyone when the title finishes and there is nothing after it.
 *
 *  Before this the player simply closed. For the host that was survivable; for
 *  a viewer it was indistinguishable from the party ending, so people left. */
export function showWrap(isHost: boolean, title: string): void {
  dismissWrap();
  wrapEl = document.createElement("div");
  wrapEl.id = "partyWrapEnd";
  wrapEl.innerHTML = `
    <div class="pwCard">
      <p class="pwKicker">That's a wrap</p>
      <h2>${escapeHtml(title || "That's the end")}</h2>
      <p class="pwHint">${isHost
        ? "Pick something else and everyone comes with you."
        : "Still here. Waiting for the host to pick the next one."}</p>
      ${isHost ? `
        <div class="pwRow">
          <button class="partyBtn primary" id="pwNext">Pick something else</button>
          <button class="partyBtn danger" id="pwEnd">End party</button>
        </div>` : `
        <div class="pwRow">
          <button class="partyBtn" id="pwLeave">Leave party</button>
        </div>`}
      ${isHost ? "" : `<div class="phcBox" id="pwChannel"></div>`}
    </div>`;
  mountOnTop(wrapEl);
  if (!isHost) void fillHostChannel(wrapEl.querySelector("#pwChannel"));

  wrapEl.querySelector("#pwNext")?.addEventListener("click", () => void showNextPicker());
  wrapEl.querySelector("#pwEnd")?.addEventListener("click", async () => {
    if (!confirm("End the party for everyone?")) return;
    const { endParty } = await import("./party");
    endParty();
    dismissWrap();
    unmountHostLobby();
  });
  wrapEl.querySelector("#pwLeave")?.addEventListener("click", async () => {
    const { disconnect, forgetParty } = await import("./party");
    disconnect();
    forgetParty();
    dismissWrap();
    const { closeVodPlayer } = await import("./vodplayer");
    closeVodPlayer();
  });
}

export function dismissWrap(): void { if (wrapEl) unmountFromTop(wrapEl); wrapEl = null; }

// ---------------------------------------------------------------------------
// Removing someone
// ---------------------------------------------------------------------------
//
// Removal used to be one undifferentiated act behind a browser confirm(). The
// host got "Remove this person from the party?" whether the guest's connection
// kept dying or they were being unpleasant, it always shut the door for good,
// and the person on the other end was told nothing at all -- a three-second
// toast, over a film that had just disappeared.
//
// Both halves are now proportionate: the host says which of these it is, and
// the guest is told the same thing.

const REMOVAL_REASONS: Array<{ code: string; label: string; note: string }> = [
  { code: "technical", label: "Connection trouble", note: "They can come back when it settles." },
  { code: "space",     label: "Making room for someone else", note: "They can come back if a seat frees up." },
  { code: "fit",       label: "Not the right fit", note: "They cannot rejoin this party." },
  { code: "conduct",   label: "Behaviour in the party", note: "They cannot rejoin this party." },
];

/** Resolves with a reason code, or null if the host backed out. */
function askRemovalReason(name: string): Promise<string | null> {
  return new Promise((resolve) => {
    const sheet = document.createElement("div");
    sheet.id = "partyKickSheet";
    sheet.innerHTML = `
      <div class="pkkCard" role="dialog" aria-modal="true" aria-label="Remove someone from the party">
        <h2>Remove ${escapeHtml(name)}?</h2>
        <p class="partyHint">They will be told why. The softer reasons let them come back.</p>
        <div class="pkkList">
          ${REMOVAL_REASONS.map((r) => `
            <button class="pkkReason" data-code="${r.code}">
              <span class="pkkLabel">${escapeHtml(r.label)}</span>
              <span class="pkkNote">${escapeHtml(r.note)}</span>
            </button>`).join("")}
        </div>
        <button class="partyBtn pkkCancel">Cancel</button>
      </div>`;
    // The host is watching when they decide to remove somebody, which means
    // fullscreen, which means document.body is not painted.
    mountOnTop(sheet);

    const done = (v: string | null) => { sheet.remove(); resolve(v); };
    sheet.querySelectorAll<HTMLElement>(".pkkReason").forEach((b) => {
      b.addEventListener("click", () => done(b.dataset.code || null));
    });
    sheet.querySelector(".pkkCancel")!.addEventListener("click", () => done(null));
    sheet.addEventListener("click", (e) => { if (e.target === sheet) done(null); });
  });
}

/** What the removed person sees. Full screen, with the reason, and a way back
 *  in when the reason allows one. */
export function showRemoved(o: { title: string; code: string; text: string; canReturn: boolean }): void {
  document.getElementById("partyRemoved")?.remove();
  const el = document.createElement("div");
  el.id = "partyRemoved";
  el.innerHTML = `
    <div class="prmCard">
      <p class="prmKicker">Removed from the party</p>
      <h2>${escapeHtml(o.title || "The party")}</h2>
      ${o.text ? `<p class="prmReason">${escapeHtml(o.text)}</p>` : ""}
      <p class="prmHint">${o.canReturn
        ? "The host said you can come back. They will be asked again when you do."
        : "The host has closed this party to you."}</p>
      <div class="prmRow">
        ${o.canReturn ? `<button class="partyBtn primary" id="prmBack">Ask to rejoin</button>` : ""}
        <button class="partyBtn" id="prmClose">Back to veedeeoh</button>
      </div>
    </div>`;
  // Mounted where fullscreen can paint it. Being removed mid-film is the one
  // moment a viewer most needs to be told something, and it is also the moment
  // they are guaranteed to be fullscreen.
  mountOnTop(el);

  el.querySelector("#prmBack")?.addEventListener("click", async () => {
    el.remove();
    const { joinParty } = await import("./party");
    await joinParty(o.code);
  });
  el.querySelector("#prmClose")!.addEventListener("click", () => el.remove());
}

/** Pressing play on a free account.
 *
 *  Reached from openVodPlayer, so it covers every route into the player rather
 *  than only the card that has a hover state. On a card the hover has already
 *  said this; arriving here from the detail view, a search result or a resume
 *  tile, it is the first time.
 *
 *  Two ways out and they are equally real. Self-hosting is not a consolation
 *  prize we are obliged to mention -- it is the free version of this product,
 *  and someone who takes it is a user rather than a lost sale. */
export function showPlaybackLocked(title: string): void {
  document.getElementById("partyRemoved")?.remove();
  const el = document.createElement("div");
  el.id = "partyRemoved";
  el.innerHTML = `
    <div class="prmCard">
      <p class="prmKicker">Your free account is limited to watch parties</p>
      <h2>${escapeHtml(title || "This title")}</h2>
      <p class="prmReason">You can join any watch party you are invited to. Watching on
        your own is part of Cloud.</p>
      <div class="prmRow">
        <button class="partyBtn primary" id="prmSub">Subscribe, $4/mo</button>
        <a class="partyBtn" href="/self-hosting.html">Self-host it free</a>
      </div>
      <button class="prmDismiss" id="prmClose">Back to browsing</button>
    </div>`;
  document.body.appendChild(el);
  el.querySelector("#prmSub")!.addEventListener("click", async () => {
    const { startCheckout } = await import("./db");
    try { await startCheckout(); } catch { showToast("Couldn't start checkout"); }
  });
  el.querySelector("#prmClose")!.addEventListener("click", () => el.remove());
}

/** A free account that has used its four parties for the month.
 *
 *  The same full-screen card as a removal, deliberately, and not a toast. A
 *  toast is the right size for "link copied" and the wrong size for "you
 *  cannot come in, and here is the only way to change that" -- it expires on
 *  its own while the person is still reading it, and it leaves them on a
 *  veiled player with no idea what happened.
 *
 *  It says which party they are missing, because the specific one they were
 *  invited to tonight is the argument. A generic wall is not. */
export function showJoinLimit(o: { title: string; used: number; limit: number }): void {
  document.getElementById("partyRemoved")?.remove();
  const el = document.createElement("div");
  el.id = "partyRemoved";
  el.innerHTML = `
    <div class="prmCard">
      <p class="prmKicker">That is ${o.used} of ${o.limit} parties this month</p>
      <h2>${escapeHtml(o.title || "This party")}</h2>
      <p class="prmReason">A free account can be in ${o.limit} watch parties a month.
        Yours resets on the first.</p>
      <p class="prmHint">Cloud is $4 a month for unlimited parties, three profiles and the
        whole catalogue to browse on your own. veedeeoh is also free to run yourself.</p>
      <div class="prmRow">
        <button class="partyBtn primary" id="prmSub">Subscribe, $4/mo</button>
        <button class="partyBtn" id="prmClose">Not now</button>
      </div>
    </div>`;
  document.body.appendChild(el);

  el.querySelector("#prmSub")!.addEventListener("click", async () => {
    const { startCheckout } = await import("./db");
    try { await startCheckout(); } catch { showToast("Couldn't start checkout"); }
  });
  el.querySelector("#prmClose")!.addEventListener("click", () => el.remove());
}

// ---------------------------------------------------------------------------
// Someone is asking to come in
// ---------------------------------------------------------------------------

/** A knock the host cannot miss.
 *
 *  It was a toast, which is the wrong instrument for something that needs an
 *  answer: it expires on its own, and it is the same size as a copied-link
 *  confirmation. Worse, the side panel is the only other place a request
 *  appears, and it is not mounted at all when the host has closed the player --
 *  so a host sitting on the party page was never told anyone had arrived.
 */
export function showKnock(userId: string, name: string): void {
  const existing = document.getElementById("partyKnocks");
  const stack = existing || (() => {
    const s = document.createElement("div");
    s.id = "partyKnocks";
    mountOnTop(s);
    return s;
  })();
  if (stack.querySelector(`[data-uid="${CSS.escape(userId)}"]`)) return;

  const row = document.createElement("div");
  row.className = "pknRow";
  row.dataset.uid = userId;
  row.innerHTML = `
    <span class="pknName">${escapeHtml(name)}</span>
    <span class="pknWhat">wants to join</span>
    <span class="pknBtns">
      <button class="ppBtn primary" data-knock="in">Let in</button>
      <button class="ppBtn" data-knock="no">No</button>
    </span>`;
  stack.appendChild(row);

  row.querySelectorAll<HTMLElement>("[data-knock]").forEach((b) => {
    b.addEventListener("click", async () => {
      const { respondToKnock } = await import("./party");
      respondToKnock(userId, b.dataset.knock === "in");
      dismissKnock(userId);
    });
  });
}

export function dismissKnock(userId?: string): void {
  const stack = document.getElementById("partyKnocks");
  if (!stack) return;
  if (userId) stack.querySelector(`[data-uid="${CSS.escape(userId)}"]`)?.remove();
  else stack.replaceChildren();
  if (!stack.childElementCount) unmountFromTop(stack);
}

/** Drop any request that is no longer in the host's waiting list. */
export function reconcileKnocks(stillWaiting: Set<string>): void {
  const stack = document.getElementById("partyKnocks");
  if (!stack) return;
  for (const row of [...stack.querySelectorAll<HTMLElement>("[data-uid]")]) {
    if (!stillWaiting.has(row.dataset.uid || "")) row.remove();
  }
  if (!stack.childElementCount) unmountFromTop(stack);
}

// ---------------------------------------------------------------------------
// The host's channel
// ---------------------------------------------------------------------------
//
// It reached exactly one surface: the public directory. Someone browsing could
// see a host was on Discord, join, and then never see it again -- and a private
// party, which is people the host actually invited, could not show it at all.
//
// Offered at the three moments a viewer's attention is not on a film: waiting
// for the party to start, between titles, and after it ends. Never over
// playback, which is the one place an outbound link has no business being.

const CHANNEL_LABEL: Record<string, string> = {
  discord: "Discord", twitch: "Twitch", youtube: "YouTube",
  x: "X", tiktok: "TikTok", instagram: "Instagram",
};

const CHANNEL_VERB: Record<string, string> = {
  discord: "is chatting on", twitch: "streams on", youtube: "is on",
  x: "is on", tiktok: "is on", instagram: "is on",
};

/** Markup for the host's channel, or "" when they have not set one.
 *
 *  Built from a platform and a handle, never from a stored URL, so a disguised
 *  link, an open redirect or a shortener cannot appear here. rel is noopener
 *  noreferrer: this is an outbound link to a stranger's page, rendered under
 *  veedeeoh's name.
 */
export function hostChannelHtml(
  ch: { name: string | null; platform: string | null; handle: string | null } | null,
  tone: "full" | "chip" = "full",
): string {
  if (!ch?.platform || !ch.handle) return "";
  const label = CHANNEL_LABEL[ch.platform] || "their channel";
  const who = ch.name || "The host";
  const link = `<a class="partySocial" data-host-channel="1"
     href="#" target="_blank" rel="noopener noreferrer">Open ${escapeHtml(label)}</a>`;
  if (tone === "chip") return link;
  return `<p class="phcLine">${escapeHtml(who)} ${CHANNEL_VERB[ch.platform] || "is on"}
    ${escapeHtml(label)}</p>${link}`;
}

/** Render the host's channel into a container, if there is one. Async because
 *  the party module owns the channel and the URL builder both. */
export async function fillHostChannel(box: HTMLElement | null, tone: "full" | "chip" = "full"): Promise<void> {
  if (!box) return;
  const { partyHostChannel } = await import("./party");
  box.innerHTML = hostChannelHtml(partyHostChannel(), tone);
  await wireHostChannel(box);
}

/** Fill in the href from the party module. Kept out of the markup so the URL is
 *  assembled by the one function that knows how, rather than by every caller. */
export async function wireHostChannel(root: ParentNode): Promise<void> {
  const anchors = [...root.querySelectorAll<HTMLAnchorElement>("[data-host-channel]")];
  if (!anchors.length) return;
  const { partyHostChannel, socialUrl } = await import("./party");
  const ch = partyHostChannel();
  const url = socialUrl(ch.platform, ch.handle);
  for (const a of anchors) {
    if (url) a.href = url;
    else a.remove();
  }
}

/** The catalogue picker as a one-shot sheet. Resolves with the chosen title, or
 *  null if it was dismissed. Used wherever picking a title is the whole
 *  interaction -- a recommendation, a suggestion to a host. */
export function pickSheet(heading: string): Promise<import("./party-picker").PartyPick | null> {
  return new Promise((resolve) => {
    const sheet = document.createElement("div");
    sheet.id = "partyNextSheet";
    sheet.innerHTML = `
      <div class="pnCard" role="dialog" aria-modal="true" aria-label="${escapeHtml(heading)}">
        <div class="pnHead">
          <h2>${escapeHtml(heading)}</h2>
          <button class="pnClose" aria-label="Close">&times;</button>
        </div>
        <div class="pnPicker"></div>
      </div>`;
    document.body.appendChild(sheet);

    const done = (v: any) => { sheet.remove(); resolve(v); };
    sheet.querySelector(".pnClose")!.addEventListener("click", () => done(null));
    sheet.addEventListener("click", (e) => { if (e.target === sheet) done(null); });

    void import("./party-picker").then(({ mountPicker }) => {
      mountPicker(sheet.querySelector<HTMLElement>(".pnPicker")!, (pick) => done(pick));
    });
  });
}
