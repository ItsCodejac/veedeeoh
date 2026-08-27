// Profile avatars, generated in the browser.
//
// THEY USED TO BE FETCHED. Every avatar was an <img> pointing at
// api.dicebear.com, so rendering the profile switcher told a third party who
// was using veedeeoh and from what IP -- a third party our published privacy
// policy does not list, which made the policy inaccurate as well as the
// behaviour unwanted. Nothing about the pictures needed to be remote: the same
// library runs locally and produces identical SVG.
//
// WHAT IS STORED IS THE RENDERED IMAGE, not a `style:seed` spec to regenerate
// from. The spec is thirty bytes against up to twenty kilobytes, which is the
// obvious argument for it -- but regenerating means the library has to be
// present wherever an avatar is DISPLAYED, and that is the header and the
// profile switcher, on every cold start. The collection is 678 KB gzipped.
// Paying that to draw three small pictures is the wrong trade by a wide margin.
//
// Stored as a data URI in avatar_url, so every existing render path -- which
// already does url(avatar_url) -- keeps working untouched, and this module is
// only ever imported by the editor, where a lazy chunk and a deliberate action
// line up.
//
// A second consequence, and a good one: a stored image cannot change under
// someone. DiceBear warns that style artwork may change between versions, and
// regenerating from a seed would have quietly redrawn people's avatars on a
// package upgrade.

export interface AvatarStyle { id: string; label: string; group: string }

/** Every style in the published collection, grouped so a row of thirty-one
 *  chips is browsable rather than a wall.
 *
 *  All of them, deliberately. Licences differ across the set -- roughly half
 *  are CC0 and half CC BY 4.0 -- but avatarCredits() derives the attribution
 *  from each style's own metadata, so offering more of them costs nothing to
 *  stay compliant with. Curating down to a handful would only have been to
 *  avoid a problem that is already solved. */
export const AVATAR_STYLES: AvatarStyle[] = [
  // People
  { id: "avataaars",        label: "Avataaars",   group: "People" },
  { id: "adventurer",       label: "Adventurer",  group: "People" },
  { id: "openPeeps",        label: "Open Peeps",  group: "People" },
  { id: "personas",         label: "Personas",    group: "People" },
  { id: "micah",            label: "Micah",       group: "People" },
  { id: "miniavs",          label: "Miniavs",     group: "People" },
  { id: "lorelei",          label: "Lorelei",     group: "People" },
  { id: "notionists",       label: "Notionists",  group: "People" },
  { id: "bigSmile",         label: "Big Smile",   group: "People" },
  { id: "bigEars",          label: "Big Ears",    group: "People" },
  { id: "croodles",         label: "Croodles",    group: "People" },
  { id: "dylan",            label: "Dylan",       group: "People" },
  { id: "toonHead",         label: "Toon Head",   group: "People" },
  { id: "pixelArt",         label: "Pixel Art",   group: "People" },
  // Faces only
  { id: "avataaarsNeutral", label: "Avataaars",   group: "Faces" },
  { id: "adventurerNeutral", label: "Adventurer", group: "Faces" },
  { id: "loreleiNeutral",   label: "Lorelei",     group: "Faces" },
  { id: "notionistsNeutral", label: "Notionists", group: "Faces" },
  { id: "bigEarsNeutral",   label: "Big Ears",    group: "Faces" },
  { id: "croodlesNeutral",  label: "Croodles",    group: "Faces" },
  { id: "pixelArtNeutral",  label: "Pixel Art",   group: "Faces" },
  { id: "funEmoji",         label: "Fun Emoji",   group: "Faces" },
  { id: "thumbs",           label: "Thumbs",      group: "Faces" },
  // Machines
  { id: "bottts",           label: "Bottts",      group: "Robots" },
  { id: "botttsNeutral",    label: "Bottts face", group: "Robots" },
  // Abstract
  { id: "shapes",           label: "Shapes",      group: "Abstract" },
  { id: "rings",            label: "Rings",       group: "Abstract" },
  { id: "glass",            label: "Glass",       group: "Abstract" },
  { id: "identicon",        label: "Identicon",   group: "Abstract" },
  { id: "icons",            label: "Icons",       group: "Abstract" },
  { id: "initials",         label: "Initials",    group: "Abstract" },
];

const PREFIX = "dicebear:";

export function avatarSpec(style: string, seed: string): string {
  return `${PREFIX}${style}:${seed}`;
}

/** Understands both the spec form and the api.dicebear.com URLs written before
 *  this existed, so nothing has to be migrated and no old profile keeps
 *  reaching out. */
export function parseAvatar(value?: string | null): { style: string; seed: string } | null {
  const v = (value || "").trim();
  if (!v) return null;

  if (v.startsWith(PREFIX)) {
    const rest = v.slice(PREFIX.length);
    const i = rest.indexOf(":");
    if (i < 1) return null;
    return { style: rest.slice(0, i), seed: rest.slice(i + 1) };
  }

  // An api.dicebear.com URL saved by the old picker. Recognised so the editor
  // can regenerate the same avatar locally and replace it; see isRemoteAvatar
  // for what display does with one in the meantime.
  const m = /api\.dicebear\.com\/[^/]+\/([A-Za-z0-9-]+)\/svg\?(.*)$/.exec(v);
  if (m) {
    const style = m[1]!.replace(/-([a-z])/g, (_s, c) => c.toUpperCase());
    const seed = new URLSearchParams(m[2]).get("seed") || style;
    return { style, seed };
  }
  return null;
}

/** A stored avatar that would reach a third party if rendered.
 *
 *  Display treats these as no avatar at all and falls back to the initial,
 *  rather than making the request this whole module exists to remove. Opening
 *  the profile editor regenerates it locally and saves the replacement, so it
 *  heals on the next edit. */
export function isRemoteAvatar(value?: string | null): boolean {
  return /^https?:\/\//i.test((value || "").trim());
}

// The collection is a few hundred kilobytes, and profile pictures are not worth
// blocking a cold start for. Imported on first use and shared thereafter.
let collectionPromise: Promise<any> | null = null;
function collection(): Promise<any> {
  if (!collectionPromise) {
    collectionPromise = Promise.all([
      import("@dicebear/core"),
      import("@dicebear/collection"),
    ]).then(([core, col]) => ({ createAvatar: core.createAvatar, col }));
  }
  return collectionPromise;
}

const cache = new Map<string, string>();

/** The shorter of the two ways to inline an SVG.
 *
 *  Measured across the collection: percent-encoding wins on the detailed styles
 *  (Open Peeps, Notionists) where the payload is mostly path data, and base64
 *  wins by up to 15% on the sparse ones (Shapes, Identicon, Initials) where the
 *  markup is mostly angle brackets and quotes -- exactly the characters
 *  percent-encoding triples. Neither wins everywhere, so measure and pick.
 *
 *  Minifying first was tried and dropped: DiceBear already emits SVG with no
 *  whitespace and no excess precision, so stripping and rounding returned
 *  byte-identical output for eleven of twelve styles. */
function smallestUri(svg: string, percentEncoded: string): string {
  // DiceBear writes `;utf8,` here, which is not a valid media-type parameter.
  // Corrected on principle, not as a bug fix: WebKit renders the malformed form
  // perfectly well, so this was never the reason avatars went missing. See
  // fixSvgDataUri in util.ts, which applies the same repair on display.
  percentEncoded = percentEncoded.startsWith("data:image/svg+xml;utf8,")
    ? `data:image/svg+xml;charset=utf-8,${percentEncoded.slice(24)}`
    : percentEncoded;
  try {
    const bytes = new TextEncoder().encode(svg);
    let bin = "";
    for (const b of bytes) bin += String.fromCharCode(b);
    const base64 = `data:image/svg+xml;base64,${btoa(bin)}`;
    return base64.length < percentEncoded.length ? base64 : percentEncoded;
  } catch {
    return percentEncoded;
  }
}

/** A data URI for a stored avatar value, or null when there is none or the
 *  style is unknown -- callers fall back to the profile's initial. */
export async function renderAvatar(
  value: string | null | undefined,
  opts: { size?: number; background?: string } = {},
): Promise<string | null> {
  const parsed = parseAvatar(value);
  if (!parsed) return null;

  const size = opts.size ?? 128;
  const bg = (opts.background || "").replace("#", "");
  const key = `${parsed.style}|${parsed.seed}|${size}|${bg}`;
  const hit = cache.get(key);
  if (hit) return hit;

  try {
    const { createAvatar, col } = await collection();
    const style = (col as any)[parsed.style];
    if (!style) return null;
    const built = createAvatar(style, {
      seed: parsed.seed,
      size,
      ...(bg ? { backgroundColor: [bg] } : {}),
    });
    const uri = smallestUri(built.toString(), built.toDataUri());
    cache.set(key, uri);
    return uri;
  } catch {
    return null;   // never let a decorative image break a render path
  }
}

// ---------------------------------------------------------------------------
// Attribution
// ---------------------------------------------------------------------------

export interface AvatarCredit {
  title: string; creator: string; source?: string;
  license: string; licenseUrl?: string;
}

/** Credits for the styles actually offered, read from each style's own
 *  metadata.
 *
 *  GENERATED, NOT WRITTEN DOWN. Several of these styles are CC BY 4.0, which
 *  costs nothing but does require crediting the creator for as long as the
 *  style is used. A hand-maintained list is exactly the thing that falls out of
 *  date the first time somebody adds a style and forgets -- and being out of
 *  date here means being out of licence. Deriving it from AVATAR_STYLES means
 *  the two cannot disagree.
 */
export async function avatarCredits(): Promise<AvatarCredit[]> {
  const { col } = await collection();
  const out: AvatarCredit[] = [];
  for (const s of AVATAR_STYLES) {
    const meta = (col as any)[s.id]?.meta;
    if (!meta) continue;
    out.push({
      title: meta.title || s.id,
      creator: meta.creator || "Unknown",
      source: meta.source || meta.homepage,
      license: meta.license?.name || "See DiceBear",
      licenseUrl: meta.license?.url,
    });
  }
  return out.sort((a, b) => a.title.localeCompare(b.title));
}

// ---------------------------------------------------------------------------
// Customisation
// ---------------------------------------------------------------------------
//
// WHAT WE WERE OFFERING AND WHAT THE LIBRARY ACTUALLY HAS. The first version
// read each style's schema, kept the enumerated features, sorted them by
// length and took eight -- rendered as text dropdowns of raw identifiers like
// "winterHat02". For Avataaars that meant 8 of 21 properties, described in a
// vocabulary nobody outside the library speaks, with no picture attached.
//
// The three things it dropped are the three worth having:
//
//   COLOURS. Six properties on Avataaars alone -- skin, hair, clothes, hat,
//   facial hair, accessories -- each shipping its own palette in the schema
//   default. Skipping them meant you could not make an avatar look like you.
//
//   TOGGLES. The *Probability integers are not settings that need a slider,
//   they are yes/no questions: glasses, facial hair, a hat. Set to 0 or 100
//   they stop being probabilities at all.
//
//   FRAMING. flip, rotate, scale, radius, background type and colour live on
//   the core rather than the style, so reading the style schema never saw
//   them.
//
// The reason to show all of it as pictures rather than words is that
// generating is close to free: 170 avatars render in 10ms and average 5 KB.
// A full repaint of every thumbnail in the editor costs less than one frame,
// which is why nothing here is lazy, paged or debounced.

export interface AvatarFrame {
  flip?: boolean;
  rotate?: number;
  scale?: number;
  radius?: number;
  /** Offset within the frame, -100 to 100, as a percentage of the viewbox.
   *  Zoom alone crops from the centre, which is the wrong middle for any style
   *  that does not sit centred -- the tall hair ones lose the top of the head. */
  translateX?: number;
  translateY?: number;
  /** Hex without '#'. Absent means follow the profile colour. */
  bg?: string;
  bgType?: "solid" | "gradientLinear";
  bg2?: string;
}

/** How an avatar was made. Stored in household_profiles.avatar_recipe as jsonb
 *  and read only by the editor, so new keys are additive: a recipe written
 *  before colours existed simply has no colours, and the stored image stays
 *  authoritative for display either way. */
export interface AvatarRecipe {
  style: string;
  seed: string;
  /** Enumerated features. Absent key means "leave it to the seed". */
  choices: Record<string, string>;
  /** Hex without '#', per colour property. */
  colors?: Record<string, string>;
  /** Explicit yes/no for a *Probability property. Absent means leave alone. */
  toggles?: Record<string, boolean>;
  frame?: AvatarFrame;
}

export type AvatarFeature =
  | { kind: "enum";   key: string; label: string; values: string[] }
  | { kind: "color";  key: string; label: string; palette: string[] }
  | { kind: "toggle"; key: string; label: string; base: string };

export interface AvatarFeatures {
  enums: Extract<AvatarFeature, { kind: "enum" }>[];
  colors: Extract<AvatarFeature, { kind: "color" }>[];
  toggles: Extract<AvatarFeature, { kind: "toggle" }>[];
}

const HEX = /^[0-9a-f]{6}$/i;

/** Everything a style lets you set, read from its own JSON schema.
 *
 *  SCHEMA-DRIVEN AND UNCAPPED. Every style has a different set and the library
 *  adds to them; a hand-written list would be 31 lists rotting in parallel.
 *  The previous version also capped the result at eight, which is a sensible
 *  limit for a column of dropdowns and a pointless one for rows of pictures.
 *
 *  backgroundColor is excluded on purpose: it is offered in the frame controls
 *  alongside the background type it depends on, and offering it twice would
 *  let the two disagree. */
export async function avatarFeatures(styleId: string): Promise<AvatarFeatures> {
  const out: AvatarFeatures = { enums: [], colors: [], toggles: [] };
  const { col } = await collection();
  const props = (col as any)[styleId]?.schema?.properties;
  if (!props) return out;

  const has = (k: string) => Object.prototype.hasOwnProperty.call(props, k);

  for (const [key, raw] of Object.entries(props as Record<string, any>)) {
    if (key === "backgroundColor") continue;

    const m = /^(.*)Probability$/.exec(key);
    if (m) {
      // Only a real question if there is something for it to turn on. A stray
      // probability with no matching feature would be a switch labelled with a
      // word that appears nowhere else on the screen.
      const base = m[1]!;
      if (has(base)) out.toggles.push({ kind: "toggle", key, label: humanise(base), base });
      continue;
    }

    const values: string[] | undefined = raw?.items?.enum || raw?.enum;
    if (Array.isArray(values)) {
      // A single-valued enum -- Avataaars' nose, base -- is not a choice.
      if (values.length >= 2) out.enums.push({ kind: "enum", key, label: humanise(key), values });
      continue;
    }

    // Colour properties carry their palette as the schema default. Matching on
    // that rather than on a name ending in "Color" means a style that names one
    // differently still gets swatches.
    const def = raw?.default;
    if (Array.isArray(def) && def.length && def.every((v: unknown) => typeof v === "string" && HEX.test(v))) {
      out.colors.push({ kind: "color", key, label: humanise(key), palette: def as string[] });
    }
  }

  // Most variety first: the features that change the face most are the ones
  // worth putting at the top of the panel.
  out.enums.sort((a, b) => b.values.length - a.values.length);
  out.colors.sort((a, b) => b.palette.length - a.palette.length);
  return out;
}

// A handful of schema keys are unreadable or collide with something else on
// the screen. Everything not listed here is derived, so a style added next year
// still gets a label.
const RELABEL: Record<string, string> = {
  // Avataaars calls its outline variant "style", which in an editor whose first
  // tab is Style means two different things one click apart.
  style: "Shape",
  clothingGraphic: "Shirt print",
};

function humanise(key: string): string {
  const fixed = RELABEL[key];
  if (fixed) return fixed;
  const s = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** A value identifier turned into something readable. */
export function humaniseValue(v: string): string {
  const s = String(v).replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[-_]/g, " ").toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** The options object a recipe describes, ready for createAvatar.
 *
 *  Kept separate from the render so the editor can build a thumbnail by
 *  layering one override on top of the current recipe without cloning it. */
function recipeOptions(r: AvatarRecipe, fallbackBg: string): Record<string, unknown> {
  const o: Record<string, unknown> = { seed: r.seed };

  for (const [k, v] of Object.entries(r.choices || {})) if (v) o[k] = [v];
  for (const [k, v] of Object.entries(r.colors || {})) if (v) o[k] = [v.replace("#", "")];
  for (const [k, v] of Object.entries(r.toggles || {})) o[k] = v ? 100 : 0;

  const f = r.frame || {};
  if (f.flip) o.flip = true;
  if (f.rotate) o.rotate = f.rotate;
  if (typeof f.scale === "number" && f.scale !== 100) o.scale = f.scale;
  if (typeof f.radius === "number" && f.radius > 0) o.radius = f.radius;
  if (f.translateX) o.translateX = f.translateX;
  if (f.translateY) o.translateY = f.translateY;

  const bg = (f.bg ?? fallbackBg ?? "").replace("#", "");
  if (bg) {
    const second = (f.bg2 || "").replace("#", "");
    o.backgroundColor = f.bgType === "gradientLinear" && second ? [bg, second] : [bg];
    if (f.bgType) o.backgroundType = [f.bgType];
  }
  return o;
}

// Renders are cheap but not free, and the editor asks for the same tile many
// times while someone moves around the panel. Capped rather than unbounded:
// every entry holds a few kilobytes of SVG.
const recipeCache = new Map<string, string>();
const RECIPE_CACHE_MAX = 3000;

/** Render a recipe, optionally with one property overridden.
 *
 *  The override is how every thumbnail in the editor is drawn: the current
 *  avatar, with only the value under the cursor changed, so a row of choices
 *  is a row of previews of THIS avatar rather than of a generic one. */
export async function renderRecipe(
  recipe: AvatarRecipe,
  opts: { size?: number; background?: string; override?: Record<string, unknown> } = {},
): Promise<string | null> {
  try {
    const { createAvatar, col } = await collection();
    const style = (col as any)[recipe.style];
    if (!style) return null;

    const size = opts.size ?? 128;
    const built = {
      ...recipeOptions(recipe, opts.background || ""),
      size,
      ...(opts.override || {}),
    };

    const key = `${recipe.style}|${size}|${JSON.stringify(built)}`;
    const hit = recipeCache.get(key);
    if (hit) return hit;

    const res = createAvatar(style, built as any);
    const uri = smallestUri(res.toString(), res.toDataUri());
    if (recipeCache.size > RECIPE_CACHE_MAX) recipeCache.clear();
    recipeCache.set(key, uri);
    return uri;
  } catch {
    return null;
  }
}

/** A recipe with nothing set, ready to be customised. */
export function blankRecipe(style: string, seed: string): AvatarRecipe {
  return { style, seed, choices: {}, colors: {}, toggles: {}, frame: {} };
}
