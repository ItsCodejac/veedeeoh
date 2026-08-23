// The avatar character creator.
//
// WHAT THIS REPLACES. A <select> of thirty-one style names, six 96px tiles, a
// Shuffle button, and a collapsed "Customise" holding up to eight dropdowns of
// raw identifiers. Everything it could do, it did in words: you chose "top:
// winterHat02" from a list and found out what that meant afterwards.
//
// The library underneath is a character creator and always was. Avataaars
// alone exposes 21 properties -- 34 hairstyles, 13 eyebrows, 12 eyes, 12
// mouths, six colour palettes and three yes/no switches -- and the core adds
// flip, rotate, scale, radius and the background on top of that. We were
// showing a fraction of it, unpreviewed.
//
// WHY EVERY CHOICE IS A PICTURE. Because generating one costs nothing: 170
// avatars render in 10ms and average 5 KB, locally, with no network. Once that
// is true, a dropdown of names is not a simplification, it is a worse control
// for the same money. Every tile here is THIS avatar with one thing changed,
// so a row of hairstyles is a row of previews of you, not of a stranger.
//
// Nothing is lazy, paged or debounced. A full repaint of every thumbnail on
// screen is well under one frame, so the panel simply redraws whenever
// anything changes and there is no stale state to reason about.

import {
  AVATAR_STYLES, avatarFeatures, renderRecipe, humaniseValue, blankRecipe,
  type AvatarRecipe, type AvatarFeatures,
} from "./avatars";
import { registerOverlay } from "./overlay";

type Tab = "style" | "features" | "colors" | "frame";

const PREVIEW_PX = 240;
const TILE_PX = 96;

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

/** True when a recipe has nothing but a style and a seed. Used to decide
 *  whether Reset has anything to undo. */
function isPlain(r: AvatarRecipe): boolean {
  return !Object.keys(r.choices || {}).length
    && !Object.keys(r.colors || {}).length
    && !Object.keys(r.toggles || {}).length
    && !Object.keys(r.frame || {}).length;
}

export interface AvatarStudioOptions {
  /** Where to start. Null opens on the first style with nothing set. */
  recipe: AvatarRecipe | null;
  /** The profile name, used to seed the first avatar and to label the header. */
  name: string;
  /** The profile colour, used as the background when the frame does not set one. */
  color: string;
  onDone: (dataUri: string, recipe: AvatarRecipe) => void;
}

export function openAvatarStudio(o: AvatarStudioOptions): void {
  document.getElementById("avatarStudio")?.remove();

  let recipe: AvatarRecipe = o.recipe
    ? clone(o.recipe)
    : blankRecipe(AVATAR_STYLES[0]!.id, (o.name || "veedeeoh").trim() || "veedeeoh");
  const opened = clone(recipe);

  let tab: Tab = "style";
  let features: AvatarFeatures = { enums: [], colors: [], toggles: [] };
  let latestUri = "";
  // Every repaint carries a number, and a render that finishes after a newer
  // repaint has started is discarded. Without it, changing style twice quickly
  // could leave the slower first pass painting its tiles over the second.
  let generation = 0;

  // THE RAIL IS A DIV, NOT AN <aside>. style.css styles the bare `aside`
  // element as the app's navigation dock, and below 768px that rule is
  // position:fixed to the bottom of the screen at 64px tall. Using the
  // semantically correct tag put the preview, Shuffle, Reset and every tab
  // into a 64px strip pinned to the bottom of every phone, underneath the
  // panel. Nothing in this file was wrong; the tag name was the bug.
  const el = document.createElement("div");
  el.id = "avatarStudio";
  el.className = "asWrap";
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-modal", "true");
  el.setAttribute("aria-label", "Avatar creator");
  el.innerHTML = `
    <div class="asShell">
      <header class="asHead">
        <div class="asHeadTitle">
          <h2>Avatar</h2>
          <p id="asStyleName"></p>
        </div>
        <div class="asHeadActions">
          <button type="button" class="asBtn" id="asCancel">Cancel</button>
          <button type="button" class="asBtn primary" id="asSave">Use this avatar</button>
        </div>
      </header>

      <div class="asBody">
        <div class="asSide">
          <div class="asPreview" id="asPreview"></div>
          <div class="asSideBtns">
            <button type="button" class="asBtn" id="asShuffle">Shuffle</button>
            <button type="button" class="asBtn subtle" id="asReset">Reset</button>
          </div>
          <nav class="asTabs" id="asTabs"></nav>
        </div>
        <div class="asPanel" id="asPanel"></div>
      </div>
    </div>`;
  document.body.appendChild(el);

  const previewEl = el.querySelector<HTMLElement>("#asPreview")!;
  const panelEl = el.querySelector<HTMLElement>("#asPanel")!;
  const tabsEl = el.querySelector<HTMLElement>("#asTabs")!;
  const styleNameEl = el.querySelector<HTMLElement>("#asStyleName")!;

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
    if (latestUri) o.onDone(latestUri, clone(recipe));
    close();
  });

  el.querySelector("#asShuffle")!.addEventListener("click", () => {
    recipe.seed = `${(o.name || "veedeeoh").trim()}-${Math.floor(Math.random() * 1e9).toString(36)}`;
    void paint();
  });

  el.querySelector("#asReset")!.addEventListener("click", () => {
    // Style and seed survive. Reset means "undo my customisation", not "throw
    // away the character I picked and start from Avataaars again".
    recipe = blankRecipe(recipe.style, recipe.seed);
    void paint();
  });

  // ---- rendering helpers --------------------------------------------------

  /** This avatar with one mutation applied, at thumbnail size. */
  function variant(mutate: (r: AvatarRecipe) => void, size = TILE_PX): Promise<string | null> {
    const r = clone(recipe);
    mutate(r);
    return renderRecipe(r, { size, background: o.color });
  }

  /** Fill a strip of buttons with their thumbnails, dropping any that fail.
   *  Kept in one place so no row has to remember the generation check. */
  async function fill(strip: HTMLElement, jobs: Array<{ btn: HTMLElement; uri: Promise<string | null> }>, gen: number): Promise<void> {
    const uris = await Promise.all(jobs.map((j) => j.uri));
    if (gen !== generation || !strip.isConnected) return;
    jobs.forEach((j, i) => {
      const uri = uris[i];
      if (!uri) { j.btn.remove(); return; }
      j.btn.style.backgroundImage = `url("${uri}")`;
    });
  }

  // ---- panels -------------------------------------------------------------

  function tileBtn(label: string, on: boolean, extraClass = ""): HTMLButtonElement {
    const b = document.createElement("button");
    b.type = "button";
    b.className = `asTile ${extraClass}${on ? " on" : ""}`;
    b.title = label;
    b.setAttribute("aria-label", label);
    b.setAttribute("aria-pressed", on ? "true" : "false");
    return b;
  }

  function row(title: string, value: string): { wrap: HTMLElement; strip: HTMLElement } {
    const wrap = document.createElement("div");
    wrap.className = "asRow";
    wrap.innerHTML = `<div class="asRowHead"><span>${esc(title)}</span><span class="asRowVal">${esc(value)}</span></div><div class="asStrip"></div>`;
    return { wrap, strip: wrap.querySelector<HTMLElement>(".asStrip")! };
  }

  async function panelStyle(gen: number): Promise<void> {
    panelEl.innerHTML = "";
    const groups: string[] = [];
    for (const s of AVATAR_STYLES) if (!groups.includes(s.group)) groups.push(s.group);

    const jobs: Array<{ btn: HTMLElement; uri: Promise<string | null> }> = [];
    for (const g of groups) {
      const sec = document.createElement("section");
      sec.className = "asGroup";
      sec.innerHTML = `<h3>${esc(g)}</h3><div class="asGrid"></div>`;
      const grid = sec.querySelector<HTMLElement>(".asGrid")!;

      for (const s of AVATAR_STYLES.filter((x) => x.group === g)) {
        const cell = document.createElement("div");
        cell.className = "asCell";
        const b = tileBtn(s.label, s.id === recipe.style);
        b.addEventListener("click", () => {
          if (s.id === recipe.style) return;
          // Feature choices belong to the style that defined them. "eyes:
          // wink" means nothing to Shapes, and carrying it across would
          // silently do nothing while still appearing to be set. The frame
          // survives, because a background and a rotation mean the same thing
          // everywhere.
          const frame = { ...(recipe.frame || {}) };
          recipe = blankRecipe(s.id, recipe.seed);
          recipe.frame = frame;
          void paint();
        });
        cell.appendChild(b);
        const cap = document.createElement("span");
        cap.className = "asCap";
        cap.textContent = s.label;
        cell.appendChild(cap);
        grid.appendChild(cell);

        jobs.push({
          btn: b,
          uri: renderRecipe({ ...blankRecipe(s.id, recipe.seed), frame: recipe.frame }, { size: TILE_PX, background: o.color }),
        });
      }
      panelEl.appendChild(sec);
    }
    await fill(panelEl, jobs, gen);
  }

  async function panelFeatures(gen: number): Promise<void> {
    panelEl.innerHTML = "";
    if (!features.enums.length && !features.toggles.length) {
      panelEl.innerHTML = `<p class="asEmpty">This style has no separate features to set. Shuffle for a different one, or try the colours and frame.</p>`;
      return;
    }
    const jobs: Array<{ btn: HTMLElement; uri: Promise<string | null> }> = [];

    for (const f of features.enums) {
      const cur = recipe.choices[f.key] || "";
      const { wrap, strip } = row(f.label, cur ? humaniseValue(cur) : "Random");

      const rnd = tileBtn(`${f.label}: random`, !cur, "asRandom");
      rnd.textContent = "Any";
      rnd.addEventListener("click", () => { delete recipe.choices[f.key]; void paint(); });
      const rndCell = document.createElement("div");
      rndCell.className = "asCell";
      rndCell.appendChild(rnd);
      strip.appendChild(rndCell);

      for (const v of f.values) {
        const b = tileBtn(`${f.label}: ${humaniseValue(v)}`, v === cur);
        b.addEventListener("click", () => { recipe.choices[f.key] = v; void paint(); });
        const cell = document.createElement("div");
        cell.className = "asCell";
        cell.appendChild(b);
        strip.appendChild(cell);
        jobs.push({ btn: b, uri: variant((r) => { r.choices[f.key] = v; }) });
      }
      panelEl.appendChild(wrap);
    }
    for (const t of features.toggles) {
      const set = recipe.toggles?.[t.key];
      const label = set === undefined ? "Random" : set ? "Yes" : "No";
      // "Show top" rather than "Top", because the enum row it switches on and
      // off is also called Top, and two rows with one name is how you end up
      // changing the wrong one.
      const { wrap, strip } = row(`Show ${t.label.toLowerCase()}`, label);
      const opts: Array<[string, boolean | undefined]> = [["Random", undefined], ["No", false], ["Yes", true]];
      for (const [name, val] of opts) {
        const b = tileBtn(`${t.label}: ${name}`, set === val);
        b.addEventListener("click", () => {
          if (val === undefined) delete recipe.toggles![t.key];
          else recipe.toggles![t.key] = val;
          void paint();
        });
        const cap = document.createElement("span");
        cap.className = "asCap";
        cap.textContent = name;
        const cell = document.createElement("div");
        cell.className = "asCell";
        cell.append(b, cap);
        strip.appendChild(cell);
        jobs.push({
          btn: b,
          uri: variant((r) => { if (val === undefined) delete r.toggles![t.key]; else r.toggles![t.key] = val; }),
        });
      }
      panelEl.appendChild(wrap);
    }

    await fill(panelEl, jobs, gen);
  }

  /** A real <input type="color"> laid invisibly over a swatch, so the browser's
   *  own picker opens and no colour space has to be reimplemented.
   *
   *  Dragging inside that picker fires input continuously; only the preview
   *  follows it. The panel rebuild waits for change, because rebuilding the
   *  strip mid-drag removes the element the picker is anchored to. */
  function customColorCell(label: string, initial: string, set: (hex: string) => void): HTMLElement {
    const cell = document.createElement("label");
    cell.className = "asCell asCustomColor";
    cell.title = label;
    cell.innerHTML = `<span class="asTile asSwatch asAny" aria-hidden="true"></span>
      <input type="color" value="#${initial.replace("#", "")}" aria-label="${esc(label)}" />
      <span class="asCap">Custom</span>`;
    const input = cell.querySelector<HTMLInputElement>("input")!;
    input.addEventListener("input", () => { set(input.value.replace("#", "")); void paintPreview(); });
    input.addEventListener("change", () => void paint());
    return cell;
  }

  function paintColors(): void {
    panelEl.innerHTML = "";
    if (!features.colors.length) {
      panelEl.innerHTML = `<p class="asEmpty">This style draws its own colours. The background is on the Frame tab.</p>`;
      return;
    }
    for (const c of features.colors) {
      const cur = (recipe.colors?.[c.key] || "").replace("#", "");
      const { wrap, strip } = row(c.label, cur ? `#${cur}` : "Random");

      const rnd = tileBtn(`${c.label}: random`, !cur, "asRandom asSwatch");
      rnd.textContent = "Any";
      rnd.addEventListener("click", () => { delete recipe.colors![c.key]; void paint(); });
      const rc = document.createElement("div"); rc.className = "asCell"; rc.appendChild(rnd);
      strip.appendChild(rc);

      // Second, not last. These strips scroll, and the palettes long enough to
      // need scrolling are exactly the ones where a chip parked at the far
      // right is a control nobody finds.
      strip.appendChild(customColorCell(`${c.label}, custom color`, cur || c.palette[0]!, (hex) => {
        recipe.colors![c.key] = hex;
      }));

      // Solid swatches rather than rendered heads. A colour reads faster as a
      // colour, and the big preview above is already showing it applied.
      for (const hex of c.palette) {
        const b = tileBtn(`${c.label}: #${hex}`, hex.toLowerCase() === cur.toLowerCase(), "asSwatch");
        b.style.background = `#${hex}`;
        b.addEventListener("click", () => { recipe.colors![c.key] = hex; void paint(); });
        const cell = document.createElement("div"); cell.className = "asCell"; cell.appendChild(b);
        strip.appendChild(cell);
      }

      panelEl.appendChild(wrap);
    }
  }

  function paintFrame(): void {
    const f = recipe.frame || (recipe.frame = {});
    const bg = (f.bg || "").replace("#", "");
    const BG = ["", o.color.replace("#", ""), "c5f04e", "ff5e7e", "06d6a0", "118ab2", "ffd166", "a78bfa", "1a1f2b", "f3f4f6"]
      .filter((v, i, a) => a.indexOf(v) === i);

    panelEl.innerHTML = "";

    const bgRow = row("Background", bg ? `#${bg}` : "Profile color");
    for (const hex of BG) {
      const on = hex === bg || (!hex && !f.bg);
      const b = tileBtn(hex ? `Background #${hex}` : "Follow the profile color", on, "asSwatch");
      if (hex) b.style.background = `#${hex}`;
      else { b.classList.add("asRandom"); b.textContent = "Auto"; }
      b.addEventListener("click", () => { if (hex) f.bg = hex; else delete f.bg; void paint(); });
      const cell = document.createElement("div"); cell.className = "asCell"; cell.appendChild(b);
      bgRow.strip.appendChild(cell);
    }
    bgRow.strip.appendChild(customColorCell("Background, custom color", bg || o.color, (hex) => { f.bg = hex; }));
    panelEl.appendChild(bgRow.wrap);

    const gradOn = f.bgType === "gradientLinear";
    const typeRow = row("Background style", gradOn ? "Gradient" : "Solid");
    for (const [name, val] of [["Solid", "solid"], ["Gradient", "gradientLinear"]] as const) {
      const b = tileBtn(name, (f.bgType || "solid") === val, "asRandom");
      b.textContent = name;
      b.addEventListener("click", () => { f.bgType = val; void paint(); });
      const cell = document.createElement("div"); cell.className = "asCell"; cell.appendChild(b);
      typeRow.strip.appendChild(cell);
    }
    panelEl.appendChild(typeRow.wrap);

    if (gradOn) {
      const second = (f.bg2 || "").replace("#", "");
      const r2 = row("Gradient second color", second ? `#${second}` : "Not set");
      for (const hex of BG.filter(Boolean)) {
        const b = tileBtn(`Second color #${hex}`, hex === second, "asSwatch");
        b.style.background = `#${hex}`;
        b.addEventListener("click", () => { f.bg2 = hex; void paint(); });
        const cell = document.createElement("div"); cell.className = "asCell"; cell.appendChild(b);
        r2.strip.appendChild(cell);
      }
      r2.strip.appendChild(customColorCell("Second color, custom", second || o.color, (hex) => { f.bg2 = hex; }));
      panelEl.appendChild(r2.wrap);
    }

    const flipRow = row("Mirror", f.flip ? "Flipped" : "Normal");
    for (const [name, val] of [["Normal", false], ["Flipped", true]] as const) {
      const b = tileBtn(name, !!f.flip === val, "asRandom");
      b.textContent = name;
      b.addEventListener("click", () => { f.flip = val; void paint(); });
      const cell = document.createElement("div"); cell.className = "asCell"; cell.appendChild(b);
      flipRow.strip.appendChild(cell);
    }
    panelEl.appendChild(flipRow.wrap);

    slider("Corner rounding", "radius", 0, 50, f.radius ?? 0, (v) => { f.radius = v; }, (v) => `${v}%`);
    slider("Size in frame", "scale", 50, 150, f.scale ?? 100, (v) => { f.scale = v; }, (v) => `${v}%`);
    slider("Rotation", "rotate", 0, 359, f.rotate ?? 0, (v) => { f.rotate = v; }, (v) => `${v} degrees`);

    function slider(label: string, _key: string, min: number, max: number, val: number,
                    set: (v: number) => void, fmt: (v: number) => string): void {
      const wrap = document.createElement("div");
      wrap.className = "asRow";
      wrap.innerHTML = `<div class="asRowHead"><span>${esc(label)}</span><span class="asRowVal">${esc(fmt(val))}</span></div>
        <input class="asSlider" type="range" min="${min}" max="${max}" value="${val}" aria-label="${esc(label)}" />`;
      const out = wrap.querySelector<HTMLElement>(".asRowVal")!;
      const input = wrap.querySelector<HTMLInputElement>("input")!;
      // Dragging repaints the preview only. Rebuilding the whole panel on every
      // pixel of travel would tear the control out from under the pointer.
      input.addEventListener("input", () => {
        const v = Number(input.value);
        set(v);
        out.textContent = fmt(v);
        void paintPreview();
      });
      panelEl.appendChild(wrap);
    }
  }

  // ---- paint --------------------------------------------------------------

  async function paintPreview(): Promise<void> {
    const uri = await renderRecipe(recipe, { size: PREVIEW_PX, background: o.color });
    if (!uri) return;
    latestUri = uri;
    previewEl.style.backgroundImage = `url("${uri}")`;
  }

  function paintTabs(): void {
    const tabs: Array<[Tab, string, boolean]> = [
      ["style", "Style", true],
      ["features", "Features", !!(features.enums.length || features.toggles.length)],
      ["colors", "Colors", !!features.colors.length],
      ["frame", "Frame", true],
    ];
    if (!tabs.find(([id, , shown]) => id === tab && shown)) tab = "style";
    tabsEl.innerHTML = "";
    for (const [id, label, shown] of tabs) {
      if (!shown) continue;
      const b = document.createElement("button");
      b.type = "button";
      b.className = `asTab${id === tab ? " on" : ""}`;
      b.textContent = label;
      b.setAttribute("aria-current", id === tab ? "page" : "false");
      b.addEventListener("click", () => { tab = id; void paint(); });
      tabsEl.appendChild(b);
    }
  }

  async function paint(): Promise<void> {
    const gen = ++generation;
    features = await avatarFeatures(recipe.style);
    if (gen !== generation) return;

    const style = AVATAR_STYLES.find((s) => s.id === recipe.style);
    styleNameEl.textContent = style
      ? `${style.label}${isPlain(recipe) ? "" : ", customised"}`
      : recipe.style;

    paintTabs();
    void paintPreview();

    if (tab === "style") await panelStyle(gen);
    else if (tab === "features") await panelFeatures(gen);
    else if (tab === "colors") paintColors();
    else paintFrame();

    panelEl.scrollTop = 0;
    // A strip of 34 hairstyles opens on the first one, and the one that is
    // actually set can be twenty tiles to the right. Without this, reopening a
    // customised avatar shows every row as though nothing were chosen.
    panelEl.querySelectorAll<HTMLElement>(".asStrip .asTile.on").forEach((t) => {
      const strip = t.closest<HTMLElement>(".asStrip");
      if (!strip) return;
      const left = t.offsetLeft - strip.clientWidth / 2 + t.offsetWidth / 2;
      if (left > 0) strip.scrollLeft = left;
    });
  }

  // Opening on Style when there is already a customised avatar would put the
  // one control that discards that work in front of them first.
  if (o.recipe && !isPlain(opened)) tab = features.enums.length ? "features" : "style";
  void paint().then(() => {
    if (o.recipe && !isPlain(opened) && (features.enums.length || features.toggles.length) && tab === "style") {
      tab = "features";
      void paint();
    }
  });
}
