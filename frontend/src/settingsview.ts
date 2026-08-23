// Settings as a routed PAGE, not a modal.
//
// It was a 620px modal holding five unrelated sections, which then opened the
// profile editor, which reopened the modal by callback. Meanwhile "Switch
// profile" was reachable from three different popups and Settings itself from
// exactly one, buried inside a menu.
//
// Organised by AUDIENCE rather than by feature, because this is a household
// product: Account is for the person paying, Household is for the person
// managing everyone else, Playback is per-viewer. A kids profile gets Playback
// and nothing else.

import { escapeHtml, showToast } from "./util";
import { getStoredProfiles, openProfileEditor, getActiveProfile } from "./profiles";
import { card, row } from "./settings-ui";
import { renderAccount } from "./settings-account";

type SectionId = "account" | "household" | "public" | "refer" | "playback" | "about";

interface Section {
  id: SectionId;
  label: string;
  icon: string;
  kidsSafe: boolean;
  render: (el: HTMLElement) => void | Promise<void>;
}

const ICON = {
  user: `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`,
  home: `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>`,
  play: `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>`,
  info: `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`,
  badge: `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/><path d="M17 3.13a4 4 0 0 1 0 7.75"/></svg>`,
  share: `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.6" y1="10.5" x2="15.4" y2="6.5"/><line x1="8.6" y1="13.5" x2="15.4" y2="17.5"/></svg>`,
};

function renderHousehold(el: HTMLElement): void {
  const profiles = getStoredProfiles();
  const active = getActiveProfile();

  el.innerHTML = card("Profiles", `
    <div class="setProfiles">
      ${profiles.map((p) => `
        <div class="setProfile">
          <span class="setAvatar" style="background:${escapeHtml(p.avatar_color || "#c5f04e")}">${escapeHtml(p.name.charAt(0).toUpperCase())}</span>
          <span class="setProfileMeta">
            <b>${escapeHtml(p.name)}${p.id === active.id ? ` <span class="setDim">(active)</span>` : ""}</b>
            <span>${p.is_kids ? "Kids profile" : p.role === "owner" ? "Account owner" : "Standard profile"}${p.pin ? " · PIN set" : ""}</span>
          </span>
          <button class="setBtn small" data-edit="${escapeHtml(p.id)}">Edit</button>
        </div>`).join("")}
    </div>
    <div class="setBtnRow"><button class="setBtn primary" id="setAddProfile">Add a profile</button></div>`)
    ;

  el.querySelectorAll<HTMLElement>("[data-edit]").forEach((b) => {
    b.addEventListener("click", () => {
      const target = profiles.find((p) => p.id === b.dataset.edit);
      if (target) openProfileEditor(target, () => openSettings("household"));
    });
  });
  el.querySelector("#setAddProfile")?.addEventListener("click", () =>
    openProfileEditor(undefined, () => openSettings("household")));

  void renderRatingMatrix(el.querySelector<HTMLElement>("#setRatings")!);
}

/** The comparison matrix, editable in place.
 *
 *  This is the section that justified the whole rebuild. Limits used to live
 *  only inside each child's own editor, so "is her sister allowed this?" was a
 *  memory exercise across two modals. One grid, every profile, every rating.
 *
 *  Saves per toggle rather than behind a Save button: there is no coherent
 *  half-finished state to protect, and a parent who ticks a box and navigates
 *  away should not silently lose the change. */
async function renderRatingMatrix(box: HTMLElement): Promise<void> {
  const { RATING_GROUPS } = await import("./db");
  const { updateProfileEverywhere } = await import("./profiles");
  const profiles = getStoredProfiles();

  // Owners are not rating-gated, and showing a row that cannot restrain anyone
  // implies a control that does not exist.
  const gated = profiles.filter((p) => p.role !== "owner");
  if (!gated.length) {
    box.innerHTML = `<p class="setHint">Only the account owner exists so far. Add a profile to set limits for it.</p>`;
    return;
  }

  const codes = RATING_GROUPS.flatMap((g) => g.ratings.map((r) => r.code));

  box.innerHTML = `
    <div class="setMatrixScroll">
      <table class="setMatrix">
        <thead><tr><th></th>${codes.map((c) => `<th>${escapeHtml(c)}</th>`).join("")}</tr></thead>
        <tbody>
          ${gated.map((p) => {
            const allowed = new Set((p.allowed_ratings ?? []).map((r) => r.toUpperCase()));
            return `<tr data-pid="${escapeHtml(p.id)}">
              <th scope="row">${escapeHtml(p.name)}
                ${allowed.size ? "" : `<span class="setDim"> · everything</span>`}</th>
              ${codes.map((c) => `<td>
                <input type="checkbox" data-code="${escapeHtml(c)}"${allowed.has(c) ? " checked" : ""}
                  aria-label="${escapeHtml(p.name)} may watch ${escapeHtml(c)}" />
              </td>`).join("")}
            </tr>`;
          }).join("")}
        </tbody>
      </table>
    </div>`;

  box.querySelectorAll<HTMLInputElement>("input[type=checkbox]").forEach((cb) => {
    cb.addEventListener("change", async () => {
      const tr = cb.closest("tr")!;
      const pid = tr.dataset.pid!;
      const target = getStoredProfiles().find((p) => p.id === pid);
      if (!target) return;

      const picked = Array.from(tr.querySelectorAll<HTMLInputElement>("input:checked"))
        .map((i) => i.dataset.code!);

      // Empty means unrestricted, which is what allowedRatingsFor already
      // treats a null list as -- so store null rather than an empty array and
      // keep one meaning for one state.
      try {
        await updateProfileEverywhere(pid, {
          name: target.name,
          avatar_color: target.avatar_color,
          allowed_ratings: picked.length ? picked : null,
        });
        const note = tr.querySelector("th .setDim");
        if (picked.length && note) note.remove();
        if (!picked.length && !note) {
          tr.querySelector("th")!.insertAdjacentHTML("beforeend", `<span class="setDim"> · everything</span>`);
        }
        showToast(`${target.name}: limits saved`);
      } catch {
        cb.checked = !cb.checked;
        showToast("Couldn't save that. Try again.");
      }
    });
  });
}

function renderPlayback(el: HTMLElement): void {
  const QK = "veedeeoh_pref_quality", CK = "veedeeoh_pref_cc";
  el.innerHTML = card("Playback", `
    <div class="setField">
      <label for="setQuality">Preferred quality</label>
      <select id="setQuality" class="setInput">
        <option value="auto">Auto</option>
        <option value="1080">1080p</option>
        <option value="720">720p</option>
        <option value="480">480p</option>
      </select>
    </div>
    <label class="setCheck"><input type="checkbox" id="setCC" /> <span>Turn on subtitles by default</span></label>`,
    "These apply on this device, so a tablet on hotel wifi and a TV at home can differ. The player's own menu still overrides them for a single title.");

  const q = el.querySelector<HTMLSelectElement>("#setQuality")!;
  q.value = localStorage.getItem(QK) || "auto";
  q.addEventListener("change", () => { localStorage.setItem(QK, q.value); showToast("Saved"); });

  const cc = el.querySelector<HTMLInputElement>("#setCC")!;
  cc.checked = localStorage.getItem(CK) === "1";
  cc.addEventListener("change", () => { localStorage.setItem(CK, cc.checked ? "1" : "0"); showToast("Saved"); });
}

function renderAbout(el: HTMLElement): void {
  el.innerHTML = card("About", `
    ${row("veedeeoh", `<span class="setDim">Cloud</span>`)}
    <div class="setBtnRow">
      <button class="setBtn" id="setReport">Report a problem</button>
      <button class="setBtn" id="setInstall">Install app</button>
    </div>
    <p class="setHint" style="margin-top:14px">
      <a href="/terms.html" target="_blank" rel="noopener">Terms of Service</a>
      &nbsp;&middot;&nbsp;
      <a href="/privacy.html" target="_blank" rel="noopener">Privacy Policy</a>
    </p>`)
    + card("Credits", `<div id="setCredits"><p class="setHint">Loading…</p></div>`,
        "Avatar artwork used in household profiles. Everything here is generated on your device; none of it is fetched from anyone.");
  // Forward to the real controls rather than duplicating them, so behaviour
  // cannot drift between here and the sidebar.
  el.querySelector("#setReport")?.addEventListener("click", () =>
    document.getElementById("fbEntry")?.click());
  el.querySelector("#setInstall")?.addEventListener("click", () =>
    document.querySelector<HTMLElement>("#pwaInstallEntry .sidebar-install-main")?.click());

  void renderCredits(el.querySelector<HTMLElement>("#setCredits"));
}

function renderReferSection(el: HTMLElement): void {
  el.innerHTML = "";
  void import("./settings-referral").then((m) => m.renderReferral(el));
}

function renderPublicPage(el: HTMLElement): void {
  el.innerHTML = "";
  void import("./settings-referral").then((m) => m.renderPublicSection(el));
}

/** Attribution for the avatar styles.
 *
 *  GENERATED FROM THE STYLE LIST, not written out. About half the styles on
 *  offer are CC BY 4.0, which costs nothing but does require crediting the
 *  creator for as long as the style is available -- and a hand-kept list is
 *  precisely what goes stale the first time somebody adds a style and forgets.
 *  Being stale here means being out of licence, so it is derived from the same
 *  array the picker uses and the two cannot disagree. */
async function renderCredits(box: HTMLElement | null): Promise<void> {
  if (!box) return;
  try {
    const { avatarCredits } = await import("./avatars");
    const credits = await avatarCredits();
    box.innerHTML = `
      <ul class="setCredits">
        ${credits.map((c) => `
          <li>
            <span class="scName">${escapeHtml(c.title)}</span>
            <span class="scBy">by ${c.source
              ? `<a href="${escapeHtml(c.source)}" target="_blank" rel="noopener noreferrer">${escapeHtml(c.creator)}</a>`
              : escapeHtml(c.creator)}</span>
            <span class="scLic">${c.licenseUrl
              ? `<a href="${escapeHtml(c.licenseUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(c.license)}</a>`
              : escapeHtml(c.license)}</span>
          </li>`).join("")}
      </ul>`;
  } catch {
    box.innerHTML = `<p class="setHint">Avatar styles by DiceBear and its contributors.</p>`;
  }
}

const SECTIONS: Section[] = [
  { id: "account",   label: "Account",   icon: ICON.user, kidsSafe: false, render: renderAccount },
  { id: "household", label: "Profiles",  icon: ICON.home, kidsSafe: false, render: renderHousehold },
  // Its own section rather than buried in Account. Someone on partner terms
  // opens the app to share a link and check what it earned; making that the
  // fifth thing down inside another page is the wrong shape for the person
  // whose entire relationship with the product is this.
  { id: "public",    label: "Public profile", icon: ICON.badge, kidsSafe: false, render: renderPublicPage },
  { id: "refer",     label: "Refer and earn", icon: ICON.share, kidsSafe: false, render: renderReferSection },
  { id: "playback",  label: "Playback",  icon: ICON.play, kidsSafe: true,  render: renderPlayback },
  { id: "about",     label: "About",     icon: ICON.info, kidsSafe: true,  render: renderAbout },
];

// ------------------------------------------------------------------ page ---

let currentSection: SectionId = "account";

export function settingsSections(): Section[] {
  const kids = !!getActiveProfile()?.is_kids;
  return SECTIONS.filter((s) => !kids || s.kidsSafe);
}

/** Open the settings page at a section. Called by the router, so it must not
 *  push history itself -- main.ts owns the route. */
export async function renderSettings(section?: string): Promise<void> {
  const available = settingsSections();
  const nav = document.getElementById("settingsNav");
  const body = document.getElementById("settingsBody");
  if (!nav || !body) return;

  // ONE PAGE, NOT SIX. The old nav swapped the body between sections, which is
  // why twenty controls sat three and four clicks deep and why several were
  // reachable on one width and not the other. Everything renders now; the bar
  // scrolls rather than navigates, so there is no intermediate destination for
  // anything to hide behind and no second layout to keep correct.
  nav.innerHTML = available.map((s) => `
    <button class="setNavBtn" data-jump="${s.id}">
      ${s.icon}<span>${escapeHtml(s.label)}</span>
    </button>`).join("");

  body.innerHTML = available.map((s) => `
    <section class="setSection" id="setSec-${s.id}">
      <h2 class="setSectionHead">${escapeHtml(s.label)}</h2>
      <div id="setSecBody-${s.id}"></div>
    </section>`).join("");

  // Rendered in parallel: each section fetches its own data and one slow call
  // should not hold up the rest of the page.
  //
  // AND SEPARATELY, so one failure cannot take the page with it. On a single
  // page a rejected render inside Promise.all would blank all six sections --
  // strictly worse than the old behaviour, where a broken section only broke
  // itself. A section that throws now says so and leaves the rest alone.
  await Promise.all(available.map(async (sec) => {
    const host = document.getElementById(`setSecBody-${sec.id}`);
    if (!host) return;
    try {
      await sec.render(host);
    } catch (e) {
      console.error(`[settings] ${sec.id} failed to render`, e);
      host.innerHTML = `<p class="setHint">This section could not load. `
        + `<a href="#settings/${sec.id}" onclick="location.reload()">Reload</a></p>`;
    }
  }));

  const scroller = document.getElementById("scrollableArea");
  nav.querySelectorAll<HTMLElement>("[data-jump]").forEach((b) => {
    b.addEventListener("click", () => {
      const target = document.getElementById(`setSec-${b.dataset.jump}`);
      if (!target) return;
      currentSection = b.dataset.jump as SectionId;
      // Written to the hash so Back returns to where they were reading, which
      // is the one thing a jump bar loses over real navigation.
      history.replaceState({}, "", `#settings/${b.dataset.jump}`);
      target.scrollIntoView({ behavior: "smooth", block: "start" });
      paintActive();
    });
  });

  /** Highlight whichever section is actually on screen. A jump bar that never
   *  updates is a row of buttons; one that tracks position is a map. */
  const paintActive = () => {
    nav.querySelectorAll<HTMLElement>("[data-jump]").forEach((b) =>
      b.classList.toggle("active", b.dataset.jump === currentSection));
  };

  if ("IntersectionObserver" in window) {
    const seen = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        currentSection = e.target.id.replace("setSec-", "") as SectionId;
      }
      paintActive();
    }, { root: scroller || null, rootMargin: "-10% 0px -80% 0px" });
    body.querySelectorAll(".setSection").forEach((el) => seen.observe(el));
  }

  // Deep links still work: #settings/refer scrolls there instead of opening a
  // different page.
  const wanted = available.find((s) => s.id === section);
  currentSection = (wanted?.id || available[0]!.id) as SectionId;
  paintActive();
  if (wanted && wanted.id !== available[0]!.id) {
    document.getElementById(`setSec-${wanted.id}`)?.scrollIntoView({ block: "start" });
  } else {
    scroller?.scrollTo({ top: 0 });
  }
}

/** Navigate to settings. The hash is the source of truth, same as every other
 *  view, so a reload or a Back press lands where the user was. */
export function openSettings(section: SectionId = "account"): void {
  location.hash = `#settings/${section}`;
}
