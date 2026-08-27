// What the avatar editor is a list OF.
//
// The reference build declares its rows per style by hand, which it has to: the
// HTTP API cannot be asked what a style supports, so it covers six styles and
// the other forty-nine get nothing. We can ask. Everything here is derived from
// the library's own schema, so a style added next year gets a real editor
// without anyone writing its parts out.
//
// Kept separate from the screen because it is all pure: a recipe and a feature
// set go in, a list of parts and their current values come out. That is the
// half worth reading on its own, and the half worth being able to test.

import { humaniseValue, type AvatarRecipe, type AvatarFeatures } from "./avatars";

export type Part =
  | { kind: "enum";   key: string; label: string; group: string; values: string[]; toggleKey?: string }
  | { kind: "color";  key: string; label: string; group: string; palette: string[]; frame?: "bg" | "bg2" }
  | { kind: "seg";    key: string; label: string; group: string; options: Array<[string, string]> }
  | { kind: "slide";  key: string; label: string; group: string; min: number; max: number; step: number; suffix: string }
  | { kind: "pad";    key: "translate"; label: string; group: string };

// Grouping is derived too. The design groups by which part of a face something
// is, which reads far better than one flat list of sixteen rows -- so the key
// name decides the group, and anything unrecognised falls to "More" rather than
// being forced somewhere wrong.
const GROUP_RULES: Array<[RegExp, string]> = [
  [/^(hair|top|skin|base|head)/i, "Skin and hair"],
  [/^(eye|brow|glasses|eyewear|sunglasses)/i, "Eyes and brows"],
  [/^(mouth|lips|teeth|nose|beard|facialhair|moustache|mustache|features|freckles|blush|ear|snout|face)/i, "Face"],
  [/^(clothing|clothes|shirt|body|outfit)/i, "Clothes"],
  [/^(accessor|hat|mask|earring|piercing|gesture|sides|texture)/i, "Extras"],
];

export const GROUP_ORDER = ["Skin and hair", "Eyes and brows", "Face", "Clothes", "Extras", "More", "Frame"];

export function groupFor(key: string): string {
  for (const [re, g] of GROUP_RULES) if (re.test(key)) return g;
  return "More";
}

const FRAME_BG = ["c5f04e", "ff5e7e", "06d6a0", "118ab2", "ffd166", "a78bfa", "e82a7e", "1a1f2b", "f3f4f6"];

export function buildParts(features: AvatarFeatures, recipe: AvatarRecipe): Part[] {
  const out: Part[] = [];

  for (const e of features.enums) {
    // The library models an optional part as two properties: `glasses` for
    // which one, and `glassesProbability` for whether at all. Two rows for one
    // question is how you end up choosing a pair of glasses and seeing no
    // change, so they are joined here and the "None" tile drives the switch.
    const t = features.toggles.find((x) => x.base === e.key);
    out.push({ kind: "enum", key: e.key, label: e.label, group: groupFor(e.key), values: e.values, toggleKey: t?.key });
  }

  for (const c of features.colors) {
    out.push({ kind: "color", key: c.key, label: c.label, group: groupFor(c.key), palette: c.palette });
  }

  // A probability with no enum beside it is its own question -- "does this face
  // have freckles", where there is only one kind of freckle.
  for (const t of features.toggles) {
    if (features.enums.some((e) => e.key === t.base)) continue;
    out.push({
      kind: "seg", key: `toggle:${t.key}`, label: `Show ${t.label.toLowerCase()}`,
      group: groupFor(t.base), options: [["auto", "Auto"], ["no", "No"], ["yes", "Yes"]],
    });
  }

  out.push({ kind: "color", key: "frame:bg", label: "Background", group: "Frame", palette: FRAME_BG, frame: "bg" });
  out.push({ kind: "seg", key: "frame:bgType", label: "Fill", group: "Frame",
    options: [["solid", "Solid"], ["gradientLinear", "Gradient"]] });
  // Only when it has something to do. A second colour with a solid fill is a
  // control whose effect is invisible until an unrelated one is changed.
  if (recipe.frame?.bgType === "gradientLinear") {
    out.push({ kind: "color", key: "frame:bg2", label: "Second colour", group: "Frame", palette: FRAME_BG, frame: "bg2" });
  }
  out.push({ kind: "pad", key: "translate", label: "Position", group: "Frame" });
  out.push({ kind: "slide", key: "frame:scale", label: "Zoom", group: "Frame", min: 50, max: 150, step: 5, suffix: "%" });
  out.push({ kind: "slide", key: "frame:rotate", label: "Rotate", group: "Frame", min: 0, max: 359, step: 1, suffix: "°" });
  out.push({ kind: "slide", key: "frame:radius", label: "Corners", group: "Frame", min: 0, max: 50, step: 5, suffix: "%" });
  out.push({ kind: "seg", key: "frame:flip", label: "Mirror", group: "Frame",
    options: [["no", "Normal"], ["yes", "Flipped"]] });

  return out;
}

// ---- reading the current value ------------------------------------------

export function segValue(p: Extract<Part, { kind: "seg" }>, r: AvatarRecipe): string {
  if (p.key === "frame:bgType") return r.frame?.bgType || "solid";
  if (p.key === "frame:flip") return r.frame?.flip ? "yes" : "no";
  const tk = p.key.slice("toggle:".length);
  const v = r.toggles?.[tk];
  return v === undefined ? "auto" : v ? "yes" : "no";
}

export function slideValue(p: Extract<Part, { kind: "slide" }>, r: AvatarRecipe): number {
  const f = r.frame || {};
  if (p.key === "frame:scale") return f.scale ?? 100;
  if (p.key === "frame:rotate") return f.rotate ?? 0;
  return f.radius ?? 0;
}

/** True when an optional part has been explicitly switched off. */
export function isNone(p: Part, r: AvatarRecipe): boolean {
  return p.kind === "enum" && !!p.toggleKey && r.toggles?.[p.toggleKey] === false;
}

/** What the row shows on the right: the current value, in words.
 *
 *  "Any" and "None" are deliberately different words. Any means the seed
 *  decides; None means there is no such part. Collapsing them would make a
 *  chosen bald head indistinguishable from not having decided yet. */
export function valueText(p: Part, r: AvatarRecipe, profileColor: string): string {
  if (p.kind === "enum") {
    if (isNone(p, r)) return "None";
    const v = r.choices[p.key];
    return v ? humaniseValue(v) : "Any";
  }
  if (p.kind === "color") {
    if (p.frame === "bg") return r.frame?.bg ? `#${r.frame.bg}` : "Profile colour";
    if (p.frame === "bg2") return r.frame?.bg2 ? `#${r.frame.bg2}` : "Not set";
    const v = r.colors?.[p.key];
    return v ? `#${v.replace("#", "")}` : "Any";
  }
  if (p.kind === "seg") {
    const cur = segValue(p, r);
    const hit = p.options.find(([v]) => v === cur);
    return hit ? hit[1] : "—";
  }
  if (p.kind === "slide") return `${slideValue(p, r)}${p.suffix}`;
  void profileColor;
  return `${r.frame?.translateX || 0}, ${r.frame?.translateY || 0}`;
}

/** The swatch shown on a colour row, so the list is scannable without opening
 *  anything. */
export function chipColor(p: Extract<Part, { kind: "color" }>, r: AvatarRecipe, profileColor: string): string {
  if (p.frame === "bg") return `#${(r.frame?.bg || profileColor).replace("#", "")}`;
  if (p.frame === "bg2") return `#${(r.frame?.bg2 || "1a1f2b").replace("#", "")}`;
  return `#${(r.colors?.[p.key] || p.palette[0] || "1a1f2b").replace("#", "")}`;
}
