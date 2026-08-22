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
