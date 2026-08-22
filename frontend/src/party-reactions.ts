// Reactions during a watch party.
//
// Chosen over chat because a fixed set of six cannot say anything targeted --
// that is a property of the design rather than a moderation policy someone has
// to enforce. Nothing is stored: a reaction is a moment, so there is no record
// to leak, nothing to moderate after the fact, and no reason for a late joiner
// to see how people felt about a scene they missed.

import { REACTIONS, sendReaction } from "./party";

const HIDE_KEY = "veedeeoh_party_reactions_off";

let bar: HTMLElement | null = null;
let stage: HTMLElement | null = null;
let onReact: ((e: Event) => void) | null = null;

export function mountReactions(): void {
  unmountReactions();
  if (localStorage.getItem(HIDE_KEY) === "1") { mountToggleOnly(); return; }

  stage = document.createElement("div");
  stage.id = "reactStage";
  document.body.appendChild(stage);

  bar = document.createElement("div");
  bar.id = "reactBar";
  bar.innerHTML = `
    ${REACTIONS.map((r) => `
      <button class="reactBtn" data-kind="${r.kind}" title="${r.label}" aria-label="${r.label}">${r.glyph}</button>
    `).join("")}
    <button class="reactBtn reactOff" id="reactHide" title="Hide reactions" aria-label="Hide reactions">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
        <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
        <line x1="1" y1="1" x2="23" y2="23"/>
      </svg>
    </button>`;
  document.body.appendChild(bar);

  bar.querySelectorAll<HTMLElement>("[data-kind]").forEach((b) => {
    b.addEventListener("click", () => {
      sendReaction(b.dataset.kind!);
      // Shown locally straight away rather than waiting for the round trip.
      // The worker does not echo to the sender, and a button that appears to
      // do nothing for 100ms gets pressed again.
      float(b.textContent || "", "You");
    });
  });
  bar.querySelector("#reactHide")!.addEventListener("click", () => {
    localStorage.setItem(HIDE_KEY, "1");
    unmountReactions();
    mountToggleOnly();
  });

  onReact = (e: Event) => {
    const d = (e as CustomEvent).detail || {};
    const r = REACTIONS.find((x) => x.kind === d.kind);
    if (r) float(r.glyph, d.name);
  };
  window.addEventListener("veedeeoh:party-react", onReact);
}

/** When reactions are hidden, leave a way back. A preference with no visible
 *  control is a preference nobody can undo. */
function mountToggleOnly(): void {
  bar = document.createElement("div");
  bar.id = "reactBar";
  bar.className = "collapsed";
  bar.innerHTML = `<button class="reactBtn" id="reactShow" title="Show reactions" aria-label="Show reactions">
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
    </svg></button>`;
  document.body.appendChild(bar);
  bar.querySelector("#reactShow")!.addEventListener("click", () => {
    localStorage.removeItem(HIDE_KEY);
    unmountReactions();
    mountReactions();
  });
}

export function unmountReactions(): void {
  if (onReact) window.removeEventListener("veedeeoh:party-react", onReact);
  onReact = null;
  bar?.remove(); bar = null;
  stage?.remove(); stage = null;
}

/** One reaction drifting up the side of the picture. Deliberately at the edge
 *  and short-lived: this is peripheral, and anything that sits over the middle
 *  of a film is a nuisance however nice it looks. */
function float(glyph: string, who?: string): void {
  if (!stage) return;
  const el = document.createElement("span");
  el.className = "reactFloat";
  el.innerHTML = `<span class="reactGlyph">${glyph}</span>${who ? `<span class="reactWho">${who}</span>` : ""}`;
  el.style.setProperty("--drift", `${Math.round(Math.random() * 40 - 20)}px`);
  stage.appendChild(el);
  setTimeout(() => el.remove(), 2600);
}
