// The avatar character creator.
//
// WHAT THIS REPLACES, THE FIRST TIME. A <select> of thirty-one style names, six
// 96px tiles, a Shuffle button, and a collapsed "Customise" holding up to eight
// dropdowns of raw identifiers. Everything it could do, it did in words.
//
// WHAT THE SECOND PASS CHANGES, AND WHY. That version was four tabs of
// horizontal strips. Avataaars alone is sixteen rows, one of them forty-five
// tiles long, and a strip only shows five at a time. That shape works on a
// desktop and nowhere else: on a phone it is an endless vertical scroll of
// endless horizontal scrolls, and the tile that is actually selected is
// usually off-screen in a direction nothing indicates. It also opened on a
// grid of styles, which is a question about a library rather than about a
// face, asked before anything had been drawn.
//
// So: the studio opens on twelve finished avatars and you pick one. Editing is
// a list of parts, and choosing a part gives it the entire panel as a grid that
// WRAPS -- forty-five options is six readable rows instead of nine screens of
// sideways travel. Nothing is nested more than one level deep, and the same
// layout serves both widths.
//
// WHY EVERY CHOICE IS A PICTURE. Because generating one costs nothing: 170
// avatars render in 10ms and average 5 KB, locally, with no network. Every tile
// is THIS avatar with one thing changed, so a grid of hairstyles is a grid of
// previews of you, not of a stranger.
//
// RENDERED LOCALLY, NOT FETCHED. The reference build previews through
// api.dicebear.com because a static HTML page has no other option. Doing that
// here would tell a third party who is editing an avatar and from what IP,
// which is the exact behaviour avatars.ts was rewritten to remove. Every image
// on this screen comes from the local library.

import {
  AVATAR_STYLES, avatarFeatures, renderRecipe, humaniseValue, blankRecipe,
  type AvatarRecipe, type AvatarFeatures,
} from "./avatars";
import { AVATAR_PRESETS, presetRecipe } from "./avatar-presets";
import {
  buildParts, valueText, segValue, slideValue, chipColor, isNone,
  GROUP_ORDER, type Part,
} from "./avatar-parts";
import { registerOverlay } from "./overlay";

const PREVIEW_PX = 240;
const TILE_PX = 96;
const HISTORY_MAX = 40;

function esc(s: string): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function clone(r: AvatarRecipe): AvatarRecipe {
  return {
    style: r.style,
    seed: r.seed,
    choices: { ...(r.choices || {}) },
    colors: { ...(r.colors || {}) },
    toggles: { ...(r.toggles || {}) },
    frame: { ...(r.frame || {}) },
  };
}

function isPlain(r: AvatarRecipe): boolean {
  return !Object.keys(r.choices || {}).length
    && !Object.keys(r.colors || {}).length
    && !Object.keys(r.toggles || {}).length
    && !Object.keys(r.frame || {}).length;
}

export interface AvatarStudioOptions {
  /** Where to start. Null opens on the face picker with nothing chosen. */
  recipe: AvatarRecipe | null;
  /** The profile name. Seeds the first avatar and labels the preview. */
  name: string;
  /** The profile colour, used as the background when the frame does not set one. */
  color: string;
  onDone: (dataUri: string, recipe: AvatarRecipe) => void;
}

export function openAvatarStudio(o: AvatarStudioOptions): void {
  document.getElementById("avatarStudio")?.remove();

  const profileName = (o.name || "").trim() || "Untitled";
  const seedBase = (o.name || "veedeeoh").trim() || "veedeeoh";

  // Null until a face is picked. Everything on the stage acts on an avatar, so
  // while this is null the stage is not shown at all rather than shown empty.
  let recipe: AvatarRecipe | null = o.recipe ? clone(o.recipe) : null;
  let features: AvatarFeatures = { enums: [], colors: [], toggles: [] };
  let parts: Part[] = [];
  let latestUri = "";
  let generation = 0;

  /** Which parts the person has actually set, as opposed to inherited from the
   *  preset or the seed. Drives the counter in the header and the dot on each
   *  row, so "what did I change" is answerable without a diff. */
  let touched = new Set<string>();
  let openKey: string | null = null;
  let browsing = false;

  interface Snap { recipe: AvatarRecipe; touched: Set<string> }
  const past: Snap[] = [];
  const future: Snap[] = [];
  let held: Array<Snap | null> = [null, null];

  const snap = (): Snap => ({ recipe: clone(recipe!), touched: new Set(touched) });
  function commit(): void {
    if (!recipe) return;
    past.push(snap());
    if (past.length > HISTORY_MAX) past.shift();
    future.length = 0;
  }
  function restore(s: Snap): void {
    recipe = clone(s.recipe);
    touched = new Set(s.touched);
  }

  // THE RAIL IS A DIV, NOT AN <aside>. style.css styles the bare `aside`
  // element as the app's navigation dock, and below 768px that rule is
  // position:fixed to the bottom of the screen at 64px tall. Using the
  // semantically correct tag put the preview and every control into a 64px
  // strip pinned to the bottom of every phone, underneath the panel. Nothing
  // in this file was wrong; the tag name was the bug.
  const el = document.createElement("div");
  el.id = "avatarStudio";
  el.className = "asWrap picking";
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-modal", "true");
  el.setAttribute("aria-label", "Avatar creator");
  el.innerHTML = `
    <div class="asShell">
      <header class="asHead">
        <h2>Avatar<i>.</i></h2>
        <div class="asMine" id="asMine" title="Parts you have chosen yourself">
          <span class="asMineN" id="asMineN">0</span><span class="asMineL">yours</span>
        </div>
        <div class="asGrow"></div>
        <div class="asHist">
          <button type="button" class="asIcon" id="asUndo" disabled title="Undo" aria-label="Undo">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/></svg>
          </button>
          <button type="button" class="asIcon" id="asRedo" disabled title="Redo" aria-label="Redo">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 7v6h-6"/><path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3L21 13"/></svg>
          </button>
        </div>
        <button type="button" class="asBtn" id="asCancel">Cancel</button>
        <button type="button" class="asBtn primary" id="asSave">Use<span class="asLong"> this avatar</span></button>
      </header>

      <div class="asBody">
        <div class="asStage">
          <div class="asHero"><div class="asHeroImg" id="asHero"></div>
            <div class="asHeroTag"><b id="asHeroName"></b><span id="asHeroStyle"></span></div>
          </div>
          <div class="asCompare">
            <div class="asCompareHead">
              <b>Holding</b>
              <button type="button" class="asBtn sm" id="asHold">Hold</button>
            </div>
            <div class="asSlots" id="asSlots"></div>
          </div>
          <button type="button" class="asBtn subtle" id="asReset">Start this face over</button>
        </div>

        <div class="asPanel" id="asPanel"></div>
      </div>
    </div>`;
  document.body.appendChild(el);

  const panelEl = el.querySelector<HTMLElement>("#asPanel")!;
  const heroEl = el.querySelector<HTMLElement>("#asHero")!;
  const slotsEl = el.querySelector<HTMLElement>("#asSlots")!;

  // ---- closing ------------------------------------------------------------

  // Escape and the Back button come from the shared overlay stack, so this
  // screen unwinds in the same order it was opened: creator, then editor, then
  // switcher. No dismissOn -- the creator fills the screen and holds a lot of
  // deliberate choices, so there is no background to click by accident and no
  // reason to treat a stray click as "discard".
  const prevOverflow = document.body.style.overflow;
  document.body.style.overflow = "hidden";
  const ov = registerOverlay(el, {
    onClose: () => { document.body.style.overflow = prevOverflow; },
  });
  const close = () => ov.close();

  el.querySelector("#asCancel")!.addEventListener("click", close);
  el.querySelector("#asSave")!.addEventListener("click", () => {
    // The image shown is the image saved. Re-rendering at save time with a
    // different size would be a second chance to disagree with the preview.
    if (recipe && latestUri) o.onDone(latestUri, clone(recipe));
    close();
  });

  el.querySelector("#asReset")!.addEventListener("click", () => {
    if (!recipe) return;
    commit();
    // The face survives. Reset means "undo my customisation", not "throw away
    // the character I picked and go back to the grid".
    recipe = blankRecipe(recipe.style, recipe.seed);
    touched = new Set();
    openKey = null;
    void paint();
  });

  el.querySelector("#asHold")!.addEventListener("click", () => {
    if (!recipe) return;
    held = [snap(), held[0] ?? null];
    void paintSlots();
  });

  el.querySelector("#asUndo")!.addEventListener("click", () => {
    if (!past.length || !recipe) return;
    future.push(snap());
    restore(past.pop()!);
    openKey = null;
    void paint();
  });
  el.querySelector("#asRedo")!.addEventListener("click", () => {
    if (!future.length || !recipe) return;
    past.push(snap());
    restore(future.pop()!);
    openKey = null;
    void paint();
  });

  // ---- rendering helpers --------------------------------------------------

  /** This avatar with one mutation applied, at thumbnail size. */
  function variant(mutate: (r: AvatarRecipe) => void, size = TILE_PX): Promise<string | null> {
    const r = clone(recipe!);
    mutate(r);
    return renderRecipe(r, { size, background: o.color });
  }

  /** Fill a set of buttons with their thumbnails, dropping any that fail.
   *  Kept in one place so no grid has to remember the generation check. */
  async function fill(host: HTMLElement, jobs: Array<{ btn: HTMLElement; uri: Promise<string | null> }>, gen: number): Promise<void> {
    const uris = await Promise.all(jobs.map((j) => j.uri));
    if (gen !== generation || !host.isConnected) return;
    jobs.forEach((j, i) => {
      const uri = uris[i];
      if (!uri) { j.btn.remove(); return; }
      j.btn.style.backgroundImage = `url("${uri}")`;
    });
  }


  // ---- painting: the opener ----------------------------------------------

  async function paintOpener(gen: number): Promise<void> {
    el.classList.add("picking");
    panelEl.innerHTML = `
      <section class="asOpener">
        <h3>Pick a face to start from</h3>
        <div class="asFaces" id="asFaces"></div>
        <div class="asOpenMore">
          <button type="button" class="asBtn" id="asAllStyles">Browse all ${AVATAR_STYLES.length} styles</button>
          <button type="button" class="asBtn" id="asSurprise">Surprise me</button>
        </div>
      </section>`;

    const grid = panelEl.querySelector<HTMLElement>("#asFaces")!;
    const jobs: Array<{ btn: HTMLElement; uri: Promise<string | null> }> = [];

    for (const p of AVATAR_PRESETS) {
      const f = await avatarFeatures(p.style);
      if (gen !== generation) return;
      const r = presetRecipe(p, f);

      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = "asFace";
      cell.setAttribute("aria-label", `Start from ${p.label}`);
      const cap = document.createElement("span");
      cap.className = "asFaceCap";
      cap.textContent = p.label;
      cell.appendChild(cap);
      cell.addEventListener("click", () => void startFrom(r));
      grid.appendChild(cell);
      jobs.push({ btn: cell, uri: renderRecipe(r, { size: 160, background: o.color }) });
    }

    panelEl.querySelector("#asSurprise")!.addEventListener("click", () => {
      const p = AVATAR_PRESETS[Math.floor(Math.random() * AVATAR_PRESETS.length)]!;
      void avatarFeatures(p.style).then((f) => {
        const r = presetRecipe(p, f);
        // A new seed is what makes it a surprise rather than the same twelve.
        r.seed = `${seedBase}-${Math.floor(Math.random() * 1e9).toString(36)}`;
        void startFrom(r);
      });
    });
    panelEl.querySelector("#asAllStyles")!.addEventListener("click", () => {
      browsing = true;
      void paint();
    });

    await fill(panelEl, jobs, gen);
  }

  /** Every style, for someone who wants one the twelve presets do not cover.
   *  The reference build stubs this out; here it is the real list. */
  async function paintStyles(gen: number): Promise<void> {
    el.classList.add("picking");
    panelEl.innerHTML = `
      <section class="asOpener">
        <div class="asCrumb"><button type="button" class="asBack" id="asBackFaces">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M15 18l-6-6 6-6"/></svg>
          Faces</button></div>
        <h3>All ${AVATAR_STYLES.length} styles</h3>
        <div id="asStyleGroups"></div>
      </section>`;
    panelEl.querySelector("#asBackFaces")!.addEventListener("click", () => { browsing = false; void paint(); });

    const host = panelEl.querySelector<HTMLElement>("#asStyleGroups")!;
    const seed = recipe?.seed || seedBase;
    const jobs: Array<{ btn: HTMLElement; uri: Promise<string | null> }> = [];
    const groups: string[] = [];
    for (const s of AVATAR_STYLES) if (!groups.includes(s.group)) groups.push(s.group);

    for (const g of groups) {
      const sec = document.createElement("section");
      sec.className = "asGrp";
      sec.innerHTML = `<div class="asGrpHead"><h4>${esc(g)}</h4><span class="asRule"></span></div><div class="asFaces"></div>`;
      const grid = sec.querySelector<HTMLElement>(".asFaces")!;
      for (const s of AVATAR_STYLES.filter((x) => x.group === g)) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "asFace";
        b.setAttribute("aria-label", `Start from ${s.label}`);
        const cap = document.createElement("span");
        cap.className = "asFaceCap";
        cap.textContent = s.label;
        b.appendChild(cap);
        b.addEventListener("click", () => { browsing = false; void startFrom(blankRecipe(s.id, seed)); });
        grid.appendChild(b);
        jobs.push({ btn: b, uri: renderRecipe(blankRecipe(s.id, seed), { size: 160, background: o.color }) });
      }
      host.appendChild(sec);
    }
    await fill(panelEl, jobs, gen);
  }

  async function startFrom(r: AvatarRecipe): Promise<void> {
    recipe = r;
    touched = new Set();
    past.length = 0;
    future.length = 0;
    openKey = null;
    browsing = false;
    await paint();
  }

  // ---- painting: the part list -------------------------------------------

  function paintParts(): void {
    el.classList.remove("picking");
    panelEl.innerHTML = `
      <section class="asEditor">
        <div class="asCrumb">
          <button type="button" class="asBack" id="asChangeFace">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M15 18l-6-6 6-6"/></svg>
            Change face
          </button>
          <span class="asCrumbStyle">${esc(styleLabel())}</span>
        </div>
        <div id="asPartHost"></div>
      </section>`;
    panelEl.querySelector("#asChangeFace")!.addEventListener("click", () => {
      // Deliberately does not discard: coming back to the picker and then
      // changing your mind must not cost the face you already built.
      recipe = null;
      openKey = null;
      void paint();
    });

    const host = panelEl.querySelector<HTMLElement>("#asPartHost")!;

    for (const g of GROUP_ORDER) {
      const mine = parts.filter((p) => p.group === g);
      if (!mine.length) continue;

      const sec = document.createElement("section");
      sec.className = "asGrp";
      sec.innerHTML = `<div class="asGrpHead"><h4>${esc(g)}</h4><span class="asRule"></span></div><div class="asParts"></div>`;
      const grid = sec.querySelector<HTMLElement>(".asParts")!;

      for (const p of mine) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "asPart";

        if (p.kind === "color") {
          const chip = document.createElement("span");
          chip.className = "asPartChip";
          chip.style.background = chipColor(p, recipe!, o.color);
          b.appendChild(chip);
        }

        const txt = document.createElement("span");
        txt.className = "asPartTxt";
        const mark = touched.has(p.key) ? `<span class="asMark" title="You chose this"></span>` : "";
        txt.innerHTML = `<b>${esc(p.label)}${mark}</b><small>${esc(valueText(p, recipe!, o.color))}</small>`;
        b.appendChild(txt);

        const go = document.createElement("span");
        go.className = "asPartGo";
        go.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M9 18l6-6-6-6"/></svg>`;
        b.appendChild(go);

        b.addEventListener("click", () => { openKey = p.key; void paint(); });
        grid.appendChild(b);
      }
      host.appendChild(sec);
    }
  }

  // ---- painting: one part -------------------------------------------------

  async function paintDetail(gen: number): Promise<void> {
    el.classList.remove("picking");
    const p = parts.find((x) => x.key === openKey);
    if (!p) { openKey = null; paintParts(); return; }

    panelEl.innerHTML = `
      <section class="asEditor">
        <div class="asDetailHead">
          <button type="button" class="asBack" id="asAllParts">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M15 18l-6-6 6-6"/></svg>
            All parts
          </button>
          <h3>${esc(p.label)}</h3>
          <span class="asDetailNow">${esc(valueText(p, recipe!, o.color))}</span>
          <span class="asGrow"></span>
          <button type="button" class="asIcon asDice" id="asDice" title="Re-roll ${esc(p.label.toLowerCase())}" aria-label="Re-roll ${esc(p.label.toLowerCase())}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.2" fill="currentColor"/><circle cx="15.5" cy="15.5" r="1.2" fill="currentColor"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/></svg>
          </button>
        </div>
        <div id="asDetailBody"></div>
      </section>`;
    panelEl.querySelector("#asAllParts")!.addEventListener("click", () => { openKey = null; void paint(); });
    panelEl.querySelector("#asDice")!.addEventListener("click", () => reroll(p));

    const body = panelEl.querySelector<HTMLElement>("#asDetailBody")!;
    if (p.kind === "enum") await detailEnum(p, body, gen);
    else if (p.kind === "color") detailColor(p, body);
    else if (p.kind === "seg") detailSeg(p, body);
    else if (p.kind === "slide") detailSlide(p, body);
    else detailPad(body);
  }

  async function detailEnum(p: Extract<Part, { kind: "enum" }>, body: HTMLElement, gen: number): Promise<void> {
    const r = recipe!;
    const off = isNone(p, r);
    const cur = off ? "" : (r.choices[p.key] || "");
    const grid = document.createElement("div");
    grid.className = "asOptGrid";
    const jobs: Array<{ btn: HTMLElement; uri: Promise<string | null> }> = [];

    // "Any" means leave it to the seed. It is not the same as None, and
    // collapsing the two would make a deliberate bald head indistinguishable
    // from not having decided yet.
    const any = document.createElement("button");
    any.type = "button";
    any.className = `asTile asTxtTile${!cur && !off ? " on" : ""}`;
    any.textContent = "Any";
    any.setAttribute("aria-pressed", String(!cur && !off));
    any.addEventListener("click", () => {
      commit();
      delete r.choices[p.key];
      if (p.toggleKey) delete r.toggles![p.toggleKey];
      touched.delete(p.key);
      void paint();
    });
    grid.appendChild(any);

    // Only offered where the library actually has a switch for it. Inventing a
    // None for a part that cannot be absent would be a control that does
    // nothing, which is the failure this whole screen exists to remove.
    if (p.toggleKey) {
      const none = document.createElement("button");
      none.type = "button";
      none.className = `asTile asTxtTile${off ? " on" : ""}`;
      none.textContent = "None";
      none.setAttribute("aria-pressed", String(off));
      none.addEventListener("click", () => {
        commit();
        r.toggles![p.toggleKey!] = false;
        touched.add(p.key);
        void paint();
      });
      grid.appendChild(none);
    }

    for (const v of p.values) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = `asTile${v === cur ? " on" : ""}`;
      b.title = `${p.label}: ${humaniseValue(v)}`;
      b.setAttribute("aria-label", `${p.label}: ${humaniseValue(v)}`);
      b.setAttribute("aria-pressed", String(v === cur));
      b.addEventListener("click", () => {
        commit();
        r.choices[p.key] = v;
        // Picking a variant of an optional part turns it on. Otherwise
        // choosing glasses after choosing None does nothing visible.
        if (p.toggleKey) r.toggles![p.toggleKey] = true;
        touched.add(p.key);
        void paint();
      });
      grid.appendChild(b);
      jobs.push({
        btn: b,
        uri: variant((x) => {
          x.choices[p.key] = v;
          if (p.toggleKey) x.toggles![p.toggleKey] = true;
          // Tiles are drawn square and uncropped so the difference between two
          // hairstyles is not hidden behind the frame's corner radius.
          x.frame = { ...(x.frame || {}), radius: 0 };
        }),
      });
    }

    body.appendChild(grid);
    await fill(panelEl, jobs, gen);
  }

  function detailColor(p: Extract<Part, { kind: "color" }>, body: HTMLElement): void {
    const r = recipe!;
    const cur = (p.frame === "bg" ? r.frame?.bg : p.frame === "bg2" ? r.frame?.bg2 : r.colors?.[p.key]) || "";
    const curHex = cur.replace("#", "").toLowerCase();

    const write = (hex: string | null): void => {
      commit();
      if (p.frame === "bg") { if (hex) r.frame!.bg = hex; else delete r.frame!.bg; }
      else if (p.frame === "bg2") { if (hex) r.frame!.bg2 = hex; else delete r.frame!.bg2; }
      else if (hex) r.colors![p.key] = hex; else delete r.colors![p.key];
      if (hex) touched.add(p.key); else touched.delete(p.key);
      void paint();
    };

    const grid = document.createElement("div");
    grid.className = "asSwGrid";

    // "Any"/"Profile colour" first. It is the state everything starts in, so
    // the way back to it should not be at the end of a palette.
    const auto = document.createElement("button");
    auto.type = "button";
    auto.className = `asSw asTxtTile${!curHex ? " on" : ""}`;
    auto.textContent = p.frame === "bg" ? "Auto" : "Any";
    auto.title = p.frame === "bg" ? "Follow the profile colour" : `${p.label}: leave to the seed`;
    auto.setAttribute("aria-pressed", String(!curHex));
    auto.addEventListener("click", () => write(null));
    grid.appendChild(auto);

    // A real <input type="color"> laid invisibly over a swatch, so the
    // browser's own picker opens and no colour space has to be reimplemented.
    // Dragging fires input continuously; only the preview follows it, because
    // rebuilding the grid mid-drag removes the element the picker is anchored
    // to. The undo entry is taken once, on change.
    const lab = document.createElement("label");
    lab.className = "asSw asSwCustom";
    lab.title = `${p.label}, any colour`;
    lab.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 3v18M3 12h18"/></svg>
      <input type="color" value="#${curHex || (p.palette[0] || "c5f04e")}" aria-label="${esc(p.label)}, custom colour">`;
    const input = lab.querySelector<HTMLInputElement>("input")!;
    input.addEventListener("input", () => {
      const hex = input.value.replace("#", "");
      if (p.frame === "bg") r.frame!.bg = hex;
      else if (p.frame === "bg2") r.frame!.bg2 = hex;
      else r.colors![p.key] = hex;
      void paintPreview();
    });
    input.addEventListener("change", () => write(input.value.replace("#", "")));
    grid.appendChild(lab);

    for (const hex of p.palette) {
      const b = document.createElement("button");
      b.type = "button";
      const on = hex.toLowerCase() === curHex;
      b.className = `asSw${on ? " on" : ""}`;
      b.style.background = `#${hex}`;
      b.title = `#${hex}`;
      b.setAttribute("aria-label", `${p.label}: #${hex}`);
      b.setAttribute("aria-pressed", String(on));
      b.addEventListener("click", () => write(hex));
      grid.appendChild(b);
    }
    body.appendChild(grid);
  }

  function detailSeg(p: Extract<Part, { kind: "seg" }>, body: HTMLElement): void {
    const r = recipe!;
    const cur = segValue(p, recipe!);
    const seg = document.createElement("div");
    seg.className = "asSeg";
    for (const [val, name] of p.options) {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = name;
      b.setAttribute("aria-pressed", String(val === cur));
      b.addEventListener("click", () => {
        commit();
        if (p.key === "frame:bgType") r.frame!.bgType = val as "solid" | "gradientLinear";
        else if (p.key === "frame:flip") r.frame!.flip = val === "yes";
        else {
          const tk = p.key.slice("toggle:".length);
          if (val === "auto") delete r.toggles![tk];
          else r.toggles![tk] = val === "yes";
        }
        if (val === "auto") touched.delete(p.key); else touched.add(p.key);
        void paint();
      });
      seg.appendChild(b);
    }
    body.appendChild(seg);
  }

  function detailSlide(p: Extract<Part, { kind: "slide" }>, body: HTMLElement): void {
    const r = recipe!;
    const cur = slideValue(p, recipe!);
    const wrap = document.createElement("div");
    wrap.className = "asSlide";
    wrap.innerHTML = `<input type="range" min="${p.min}" max="${p.max}" step="${p.step}" value="${cur}" aria-label="${esc(p.label)}"><span class="asSlideNum">${cur}${p.suffix}</span>`;
    const input = wrap.querySelector<HTMLInputElement>("input")!;
    const num = wrap.querySelector<HTMLElement>(".asSlideNum")!;

    let dragged = false;
    const apply = (v: number): void => {
      if (p.key === "frame:scale") r.frame!.scale = v;
      else if (p.key === "frame:rotate") r.frame!.rotate = v;
      else r.frame!.radius = v;
    };
    // Dragging repaints the preview only. Rebuilding the panel on every pixel
    // of travel would tear the control out from under the pointer, and would
    // also push forty undo entries for one gesture.
    input.addEventListener("pointerdown", () => { if (!dragged) { commit(); dragged = true; } });
    input.addEventListener("input", () => {
      if (!dragged) { commit(); dragged = true; }
      const v = Number(input.value);
      apply(v);
      num.textContent = `${v}${p.suffix}`;
      touched.add(p.key);
      void paintPreview();
    });
    input.addEventListener("change", () => { dragged = false; void paint(); });
    body.appendChild(wrap);
  }

  function detailPad(body: HTMLElement): void {
    const r = recipe!;
    const wrap = document.createElement("div");
    wrap.className = "asPadWrap";
    const pad = document.createElement("div");
    pad.className = "asPad";
    pad.setAttribute("role", "slider");
    pad.setAttribute("aria-label", "Position within the frame");
    const dot = document.createElement("div");
    dot.className = "asPadDot";
    pad.appendChild(dot);

    const place = (): void => {
      dot.style.left = `${50 + (r.frame?.translateX || 0) / 2}%`;
      dot.style.top = `${50 + (r.frame?.translateY || 0) / 2}%`;
    };
    place();

    let dragging = false;
    const move = (e: PointerEvent): void => {
      const rc = pad.getBoundingClientRect();
      const nx = Math.min(1, Math.max(0, (e.clientX - rc.left) / rc.width));
      const ny = Math.min(1, Math.max(0, (e.clientY - rc.top) / rc.height));
      r.frame!.translateX = Math.round((nx - 0.5) * 100);
      r.frame!.translateY = Math.round((ny - 0.5) * 100);
      touched.add("translate");
      place();
      void paintPreview();
    };
    pad.addEventListener("pointerdown", (e) => {
      dragging = true;
      commit();
      pad.setPointerCapture(e.pointerId);
      move(e);
    });
    pad.addEventListener("pointermove", (e) => { if (dragging) move(e); });
    pad.addEventListener("pointerup", () => { dragging = false; void paint(); });

    const reset = document.createElement("button");
    reset.type = "button";
    reset.className = "asBtn sm";
    reset.textContent = "Centre";
    reset.addEventListener("click", () => {
      commit();
      delete r.frame!.translateX;
      delete r.frame!.translateY;
      touched.delete("translate");
      void paint();
    });

    wrap.append(pad, reset);
    body.appendChild(wrap);
  }

  function reroll(p: Part): void {
    const r = recipe!;
    commit();
    if (p.kind === "enum") {
      r.choices[p.key] = p.values[Math.floor(Math.random() * p.values.length)]!;
      if (p.toggleKey) r.toggles![p.toggleKey] = true;
      touched.add(p.key);
    } else if (p.kind === "color") {
      const hex = p.palette[Math.floor(Math.random() * p.palette.length)]!;
      if (p.frame === "bg") r.frame!.bg = hex;
      else if (p.frame === "bg2") r.frame!.bg2 = hex;
      else r.colors![p.key] = hex;
      touched.add(p.key);
    } else if (p.kind === "seg") {
      const [val] = p.options[Math.floor(Math.random() * p.options.length)]!;
      if (p.key === "frame:bgType") r.frame!.bgType = val as "solid" | "gradientLinear";
      else if (p.key === "frame:flip") r.frame!.flip = val === "yes";
      else {
        const tk = p.key.slice("toggle:".length);
        if (val === "auto") delete r.toggles![tk]; else r.toggles![tk] = val === "yes";
      }
      touched.add(p.key);
    } else if (p.kind === "slide") {
      const steps = Math.floor((p.max - p.min) / p.step);
      const v = p.min + Math.round(Math.random() * steps) * p.step;
      if (p.key === "frame:scale") r.frame!.scale = v;
      else if (p.key === "frame:rotate") r.frame!.rotate = v;
      else r.frame!.radius = v;
      touched.add(p.key);
    } else {
      r.frame!.translateX = Math.round(Math.random() * 40 - 20);
      r.frame!.translateY = Math.round(Math.random() * 40 - 20);
      touched.add("translate");
    }
    void paint();
  }

  // ---- stage --------------------------------------------------------------

  async function paintPreview(): Promise<void> {
    if (!recipe) return;
    const uri = await renderRecipe(recipe, { size: PREVIEW_PX, background: o.color });
    if (!uri) return;
    latestUri = uri;
    heroEl.style.backgroundImage = `url("${uri}")`;
  }

  function styleLabel(): string {
    const s = AVATAR_STYLES.find((x) => x.id === recipe?.style);
    return s ? s.label : (recipe?.style || "");
  }

  async function paintSlots(): Promise<void> {
    slotsEl.innerHTML = "";
    for (let i = 0; i < 2; i++) {
      const h = held[i];
      if (!h) {
        const d = document.createElement("div");
        d.className = "asSlot empty";
        d.textContent = "Empty";
        slotsEl.appendChild(d);
        continue;
      }
      const b = document.createElement("button");
      b.type = "button";
      b.className = "asSlot";
      b.title = "Go back to this one";
      b.setAttribute("aria-label", "Go back to this held avatar");
      const tag = document.createElement("span");
      tag.className = "asSlotSwap";
      tag.textContent = "Go back";
      b.appendChild(tag);
      b.addEventListener("click", () => {
        commit();
        restore(h);
        openKey = null;
        void paint();
      });
      slotsEl.appendChild(b);
      void renderRecipe(h.recipe, { size: TILE_PX, background: o.color }).then((uri) => {
        if (uri && b.isConnected) b.style.backgroundImage = `url("${uri}")`;
      });
    }
  }

  // ---- paint --------------------------------------------------------------

  async function paint(): Promise<void> {
    const gen = ++generation;

    (el.querySelector("#asUndo") as HTMLButtonElement).disabled = !past.length;
    (el.querySelector("#asRedo") as HTMLButtonElement).disabled = !future.length;
    el.querySelector("#asMineN")!.textContent = String(touched.size);

    if (!recipe) {
      el.querySelector("#asHeroName")!.textContent = "";
      el.querySelector("#asHeroStyle")!.textContent = "";
      if (browsing) await paintStyles(gen);
      else await paintOpener(gen);
      return;
    }

    features = await avatarFeatures(recipe.style);
    if (gen !== generation) return;
    parts = buildParts(features, recipe);

    el.querySelector("#asHeroName")!.textContent = profileName;
    el.querySelector("#asHeroStyle")!.textContent = styleLabel() + (isPlain(recipe) ? "" : ", yours");

    void paintPreview();
    void paintSlots();

    if (openKey) await paintDetail(gen);
    else paintParts();

    panelEl.scrollTop = 0;
  }

  void paint();
}
