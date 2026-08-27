// The twelve faces the avatar studio opens on.
//
// A preset is a fully specified avatar, not a style name. The studio opens on
// finished work rather than twenty rows reading "Any" and an invitation to
// start guessing -- picking one and changing three things is a far shorter path
// to something you like than building a face from nothing.
//
// EVERY VALUE HERE WAS CHECKED against the installed library's own schema, not
// trusted from the design that specified them: the reference build authored
// these against api.dicebear.com, and the HTTP API and the npm package can
// drift apart. presetRecipe() repeats that check at runtime, so a library
// upgrade that renames or drops a value degrades to "that part is left to the
// seed" instead of silently rendering something nobody chose.

import { blankRecipe, type AvatarRecipe, type AvatarFeatures } from "./avatars";

export interface Preset {
  style: string;
  label: string;
  seed: string;
  choices: Record<string, string>;
  /** backgroundColor is handled as a frame property, not a style colour. */
  colors: Record<string, string>;
}

export const AVATAR_PRESETS: Preset[] = [
  { style: "notionists", label: "Notionists", seed: "Aneka",
    choices: { hair: "variant04", eyes: "variant02", brows: "variant05", lips: "variant09", nose: "variant03" },
    colors: { backgroundColor: "c5f04e" } },
  { style: "avataaars", label: "Avataaars", seed: "Brooklynn",
    choices: { top: "bigHair", eyes: "happy", eyebrows: "defaultNatural", mouth: "smile", clothing: "shirtCrewNeck" },
    colors: { skinColor: "ae5d29", hairColor: "2c1b18", backgroundColor: "118ab2" } },
  { style: "adventurer", label: "Adventurer", seed: "Jocelyn",
    choices: { hair: "long12", eyes: "variant07", eyebrows: "variant04", mouth: "variant16" },
    colors: { skinColor: "9e5622", hairColor: "0e0e0e", backgroundColor: "2ba6dd" } },
  { style: "lorelei", label: "Lorelei", seed: "Maria",
    choices: { hair: "variant08", eyes: "variant11", eyebrows: "variant06", mouth: "happy07", nose: "variant02" },
    colors: { hairColor: "6c4545", backgroundColor: "ffd166" } },
  { style: "bigSmile", label: "Big Smile", seed: "Sadie",
    choices: { hair: "braids", eyes: "cheery", mouth: "teethSmile" },
    colors: { skinColor: "8c5a2b", hairColor: "3a1a00", backgroundColor: "ffd166" } },
  { style: "bottts", label: "Bottts", seed: "Zephyr",
    choices: { eyes: "eva", face: "square02", mouth: "grill01", top: "antenna", sides: "cables01" },
    colors: { baseColor: "00acc1", backgroundColor: "1a1f2b" } },
  { style: "notionists", label: "Notionists", seed: "Kingston",
    choices: { hair: "variant17", eyes: "variant04", brows: "variant11", lips: "variant22", nose: "variant14", beard: "variant03" },
    colors: { backgroundColor: "a78bfa" } },
  { style: "avataaars", label: "Avataaars", seed: "Easton",
    choices: { top: "shortWaved", eyes: "squint", eyebrows: "raisedExcited", mouth: "twinkle", clothing: "hoodie", accessories: "prescription02" },
    colors: { skinColor: "f2d3b1", hairColor: "a55728", backgroundColor: "e82a7e" } },
  { style: "adventurer", label: "Adventurer", seed: "Ryker",
    choices: { hair: "short09", eyes: "variant19", eyebrows: "variant12", mouth: "variant03", features: "freckles" },
    colors: { skinColor: "763900", hairColor: "6c4545", backgroundColor: "06d6a0" } },
  { style: "lorelei", label: "Lorelei", seed: "Wren",
    choices: { hair: "variant15", eyes: "variant20", eyebrows: "variant02", mouth: "sad04", nose: "variant05", glasses: "variant03" },
    colors: { hairColor: "c5f04e", backgroundColor: "1a1f2b" } },
  { style: "bigSmile", label: "Big Smile", seed: "Nova",
    choices: { hair: "shavedHead", eyes: "starstruck", mouth: "kawaii", accessories: "sunglasses" },
    colors: { skinColor: "efcc9f", hairColor: "0e0e0e", backgroundColor: "e5a82b" } },
  { style: "bottts", label: "Bottts", seed: "Riley",
    choices: { eyes: "roundFrame01", face: "round01", mouth: "smile02", top: "lights" },
    colors: { baseColor: "7cb342", backgroundColor: "f3f4f6" } },
];

/** A preset as a recipe, with anything the installed library does not
 *  recognise dropped rather than sent. */
export function presetRecipe(p: Preset, f: AvatarFeatures): AvatarRecipe {
  const r = blankRecipe(p.style, p.seed);

  for (const [k, v] of Object.entries(p.choices)) {
    const e = f.enums.find((x) => x.key === k);
    if (!e || !e.values.includes(v)) continue;
    r.choices[k] = v;
    // A part that is off by default has to be switched on, or the preset asks
    // for glasses and renders a face with none.
    const t = f.toggles.find((x) => x.base === k);
    if (t) r.toggles![t.key] = true;
  }

  for (const [k, v] of Object.entries(p.colors)) {
    if (k === "backgroundColor") { r.frame!.bg = v; continue; }
    if (f.colors.some((x) => x.key === k)) r.colors![k] = v;
  }

  return r;
}
