// The brand ident, run from the design rather than from a video of it.
//
// IT WAS TWO MP4s: bump.mp4 at 1.57 MB and kids-bump.mp4 at 2.08 MB, 1920x1080
// H.264, to show a logo for five seconds. 3.6 MB of video for a dot, a word and
// a glow -- and the videos were themselves RENDERS of code that already exists
// in this repo, under "Video bump ident design 2". The scene table there sums
// to 4.95s and bump.mp4 is 4.97s long, which is how you can tell.
//
// So this is a port of bump-scenes.jsx, not an impression of the footage. Same
// five scenes, same easings, same numbers. The design is React on a scene
// runtime and the app is not, so the parts that runtime provided -- interpolate,
// the easings, a clock -- are reimplemented here and the scene functions are
// transcribed. Anything that reads oddly (the -10% on the clip inset, the
// dot riding revealPx + GAP) is from the original and deliberately unchanged.
//
// EACH VARIANT HAS ITS OWN STING. Both jsx files in the design bundle point at
// uploads/veedeeohbump.mp3, and that is stale: the rendered kids-bump.mp4
// plainly carries different audio. Measured a second at a time, the normal
// sting hits around -23 dB and decays to silence by four seconds, while the
// kids one runs even and quieter across the whole five and a half. They are
// separate pieces of music, not one piece at two volumes.
//
// So the normal ident uses the design master re-encoded 320k -> 128k, and the
// kids ident uses audio lifted out of kids-bump.mp4 -- the only copy of it that
// still exists anywhere, which is a reason not to delete that video until this
// file is in the repo twice over.
//
// Levels are left as they were mixed. The kids sting really is about 10 dB
// quieter, and that reads as deliberate for a children's profile rather than as
// a mistake to normalise away.
//
// Sound is the one part of those videos that could not be expressed as code.
//
// WHAT GOES WITH THE VIDEO. A video can stall, be refused autoplay, or fail to
// decode, so the old version carried a six second escape hatch, an onerror path
// and a muted-retry fallback -- three branches that existed only because the
// thing might not play. None of them have an equivalent here. The audio is
// allowed to fail on its own; the picture never can.

const BG = "#08090B";
const INK = "#FFFFFF";
// The app's accent, not the design file's #C6F53A. They differ by about one
// percent of hue -- close enough to be invisible side by side and far enough to
// be two values drifting apart in a codebase. #c5f04e is --accent and appears
// 65 times; the design's had already leaked into four other files.
const ACCENT = "#c5f04e";

// ---------------------------------------------------------------------------
// The three easings the design uses, and nothing else
// ---------------------------------------------------------------------------

const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);
const easeInCubic = (t: number): number => t * t * t;
const easeInOutCubic = (t: number): number =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
const easeInOutSine = (t: number): number => -(Math.cos(Math.PI * t) - 1) / 2;
const linear = (t: number): number => t;
const easeInQuad = (t: number): number => t * t;
const easeOutQuad = (t: number): number => 1 - (1 - t) * (1 - t);
const easeOutBack = (t: number): number => {
  const c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};

type Ease = (t: number) => number;

/** Piecewise interpolation over matched stop/value arrays, clamped at both
 *  ends. The design's `interpolate`; the scene code below is unreadable
 *  without it and identical with it.
 *
 *  The easing may be ONE function or one PER SEGMENT. The kids ball drop needs
 *  the second form -- a fall eases in, a landing eases out, and each bounce
 *  reverses again -- and a single easing across the whole curve turns a bounce
 *  into a wobble. */
function interpolate(stops: number[], values: number[], ease: Ease | Ease[]) {
  return (p: number): number => {
    if (p <= stops[0]!) return values[0]!;
    const last = stops.length - 1;
    if (p >= stops[last]!) return values[last]!;
    let i = 0;
    while (i < last && p > stops[i + 1]!) i++;
    const span = stops[i + 1]! - stops[i]!;
    const local = span === 0 ? 0 : (p - stops[i]!) / span;
    const fn = Array.isArray(ease) ? (ease[i] ?? ease[ease.length - 1]!) : ease;
    return values[i]! + (values[i + 1]! - values[i]!) * fn(local);
  };
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), hi);

const MOTION = {
  enter: (a: number, b: number, s: number, e: number) => interpolate([s, e], [a, b], easeOutCubic),
  glide: (a: number, b: number, s: number, e: number) => interpolate([s, e], [a, b], easeInOutCubic),
  pop:   (a: number, b: number, s: number, e: number) => interpolate([s, e], [a, b], easeOutBack),
};

// ---------------------------------------------------------------------------
// Scenes, transcribed
// ---------------------------------------------------------------------------

interface Frame {
  cam: number; fade: number; bloom: number;
  vPart: number; restPart: number;
  dotOpacity: number; dotScale: number; dotGlow: number; edge: number;
}

type Scene = { dur: number; at: (p: number) => Frame };

const SCENES: Scene[] = [
  // 1 -- a single point of light arrives out of black.
  { dur: 1.05, at: (p) => ({
      cam: MOTION.glide(1.12, 1.06, 0, 1)(p), fade: 1,
      bloom: MOTION.enter(0, 0.55, 0.1, 0.8)(p),
      vPart: 0, restPart: 0,
      dotOpacity: MOTION.enter(0, 1, 0.05, 0.3)(p),
      dotScale: p < 0.62 ? MOTION.pop(0.15, 1.14, 0.08, 0.62)(p)
                         : MOTION.glide(1.14, 1, 0.62, 1)(p),
      dotGlow: MOTION.enter(1, 0.55, 0.3, 0.95)(p),
      edge: 0,
    }) },
  // 2 -- the dot draws the v.
  { dur: 1.0, at: (p) => ({
      cam: MOTION.glide(1.06, 1.03, 0, 1)(p), fade: 1, bloom: 0.55,
      vPart: MOTION.glide(0, 1, 0.04, 0.74)(p), restPart: 0,
      dotOpacity: 1, dotScale: 1,
      dotGlow: p < 0.74 ? 0.55 : MOTION.pop(0.55, 0.85, 0.74, 1)(p),
      edge: MOTION.enter(0, 0.35, 0.04, 0.34)(p) * MOTION.enter(1, 0, 0.58, 0.88)(p),
    }) },
  // 3 -- the dot sweeps right and the rest of the name appears in its wake.
  { dur: 1.4, at: (p) => ({
      cam: MOTION.glide(1.03, 1, 0, 1)(p), fade: 1,
      bloom: interpolate([0, 0.7, 1], [0.55, 0.9, 0.7], easeInOutSine)(p),
      vPart: 1, restPart: MOTION.glide(0, 1, 0.04, 0.74)(p),
      dotOpacity: 1,
      dotScale: interpolate([0, 0.74, 0.86, 1], [1, 1.18, 0.96, 1], easeOutCubic)(p),
      dotGlow: interpolate([0, 0.3, 0.76, 1], [0.85, 0.7, 1, 0.6], easeInOutSine)(p),
      edge: interpolate([0, 0.1, 0.68, 0.82], [0, 0.85, 0.7, 0], easeInOutSine)(p),
    }) },
  // 4 -- settled hold, one slow breath.
  { dur: 0.8, at: (p) => {
      const breath = Math.sin(p * Math.PI);
      return {
        cam: MOTION.glide(1, 0.988, 0, 1)(p), fade: 1, bloom: 0.7 + breath * 0.18,
        vPart: 1, restPart: 1,
        dotOpacity: 1, dotScale: 1 + breath * 0.015,
        dotGlow: 0.6 + breath * 0.3, edge: 0,
      };
    } },
  // 5 -- flare, then dissolve to black so it can cut straight into content.
  { dur: 0.7, at: (p) => ({
      cam: MOTION.glide(0.988, 1.055, 0, 0.8)(p),
      fade: interpolate([0, 0.2, 0.72], [1, 1, 0], easeInCubic)(p),
      bloom: interpolate([0, 0.16, 0.6], [0.7, 1, 0], easeInOutSine)(p),
      vPart: 1, restPart: 1,
      dotOpacity: 1,
      dotScale: interpolate([0, 0.16, 0.5], [1, 1.24, 1.05], easeOutCubic)(p),
      dotGlow: interpolate([0, 0.16, 0.55], [0.6, 1.3, 0.5], easeOutCubic)(p),
      edge: 0,
    }) },
];

export const IDENT_SECONDS = SCENES.reduce((a, s) => a + s.dur, 0);   // 4.95

function frameAt(t: number): Frame {
  let acc = 0;
  for (const s of SCENES) {
    if (t < acc + s.dur) return s.at((t - acc) / s.dur);
    acc += s.dur;
  }
  return SCENES[SCENES.length - 1]!.at(1);
}

// ---------------------------------------------------------------------------
// The stage
// ---------------------------------------------------------------------------

export interface IdentOptions {
  /** Where to mount. Defaults to a full-screen overlay on document.body. */
  parent?: HTMLElement;
  /** Play the sting. */
  sound?: boolean;
  /** Which ident. Kids has its own animation, still rendered from video for
   *  now, but its own audio either way. */
  kids?: boolean;
  /** Wordmark height in px. The design authors at 240 against a 1080 frame;
   *  scaled to the container so it reads the same on a phone. */
  size?: number;
}

export function playIdent(done: () => void, opts: IdentOptions = {}): void {
  if (opts.kids) { playKidsIdent(done, opts); return; }
  const parent = opts.parent ?? document.body;

  const root = document.createElement("div");
  root.className = "idnt";
  root.style.cssText = opts.parent
    ? `position:absolute;inset:0;overflow:hidden;background:${BG};z-index:50;`
    : `position:fixed;inset:0;overflow:hidden;background:${BG};z-index:99999;`;

  // 240/1080 of the frame height, which is how the design is authored.
  const box = parent === document.body
    ? { w: window.innerWidth, h: window.innerHeight }
    : { w: parent.clientWidth, h: parent.clientHeight };
  const size = opts.size ?? Math.max(34, Math.min(240, Math.round(box.h * 0.222)));
  const DOT = Math.round(size * 0.158);
  const GAP = Math.round(size * 0.067);
  const dotW = DOT + GAP;

  const type = `font-family:'Manrope','Bricolage Grotesque','Space Grotesk',sans-serif;`
    + `font-weight:800;font-size:${size}px;letter-spacing:-0.045em;line-height:1;white-space:nowrap;`;

  root.innerHTML = `
    <div class="idntCam" style="position:absolute;inset:0;transform-origin:50% 50%;">
      <div class="idntBloom" style="position:absolute;left:50%;top:50%;width:157%;height:157%;
        margin-left:-78.5%;margin-top:-78.5%;border-radius:50%;
        background:radial-gradient(circle, ${ACCENT}22 0%, ${ACCENT}0a 32%, transparent 62%);"></div>
      <div style="position:absolute;inset:0;background:radial-gradient(ellipse at 50% 50%,
        transparent 38%, rgba(0,0,0,0.55) 78%, rgba(0,0,0,0.9) 100%);"></div>
      <div class="idntHolder" style="position:absolute;left:50%;top:50%;">
        <div class="idntInner" style="position:relative;height:${size}px;">
          <span class="idntWord" style="${type}position:absolute;left:0;top:0;color:${INK};"></span>
          <span class="idntV" style="${type}position:absolute;left:0;top:0;color:${INK};visibility:hidden;">v<i class="idntBase" style="display:inline-block;width:0;height:0;vertical-align:baseline;"></i></span>
          <div class="idntEdge" style="position:absolute;top:${-size * 0.14}px;
            width:${Math.max(4, size * 0.025)}px;height:${size * 1.25}px;background:${ACCENT};filter:blur(3px);"></div>
          <div class="idntDot" style="position:absolute;width:${DOT}px;height:${DOT}px;
            border-radius:50%;background:${ACCENT};transform-origin:50% 50%;"></div>
        </div>
      </div>
    </div>`;

  const word = root.querySelector<HTMLElement>(".idntWord")!;
  const vGhost = root.querySelector<HTMLElement>(".idntV")!;
  word.textContent = "veedeeoh";
  parent.appendChild(root);

  const cam = root.querySelector<HTMLElement>(".idntCam")!;
  const bloom = root.querySelector<HTMLElement>(".idntBloom")!;
  const holder = root.querySelector<HTMLElement>(".idntHolder")!;
  const inner = root.querySelector<HTMLElement>(".idntInner")!;
  const edge = root.querySelector<HTMLElement>(".idntEdge")!;
  const dot = root.querySelector<HTMLElement>(".idntDot")!;

  // Measured, never assumed. The design measures too, and it matters more here:
  // the brand face loads late on a cold start, and a width captured before it
  // arrives would animate the reveal to the fallback's metrics.
  const full = word.getBoundingClientRect().width;
  const vW = vGhost.getBoundingClientRect().width;
  // MEASURED, not assumed. This was `size`, i.e. the em box, which is not where
  // the baseline is -- Manrope sits it around 0.78 of the way down -- so the dot
  // rode roughly a fifth of a font size too low and did not line up with the
  // full stop it is supposed to become. The design probes it with a zero-sized
  // inline-block aligned to the baseline; so does this.
  const probe = root.querySelector<HTMLElement>(".idntBase");
  const base = probe ? probe.offsetTop : size;
  inner.style.width = `${full + dotW}px`;

  let audio: HTMLAudioElement | null = null;
  if (opts.sound !== false) {
    try {
      audio = new Audio(opts.kids ? "/ident-kids.mp3" : "/ident.mp3");
      audio.volume = 0.9;
      // Allowed to fail. Autoplay policy varies by browser and by how the user
      // arrived, and the picture does not depend on it.
      void audio.play().catch(() => {});
    } catch { audio = null; }
  }

  let finished = false;
  let raf = 0;
  const finish = (): void => {
    if (finished) return;
    finished = true;
    cancelAnimationFrame(raf);
    if (audio) { try { audio.pause(); } catch {} }
    try { sessionStorage.setItem("veedeeoh_ident_at", String(Date.now())); } catch {}
    root.remove();
    done();
  };
  root.addEventListener("click", finish);

  const start = performance.now();
  const tick = (now: number): void => {
    if (finished) return;
    const t = (now - start) / 1000;
    if (t >= IDENT_SECONDS) { finish(); return; }

    const f = frameAt(t);
    const revealPx = Math.max(0, Math.min(full, vW * f.vPart + (full - vW) * f.restPart));
    const shift = (full - revealPx) / 2;

    cam.style.transform = `scale(${f.cam})`;
    cam.style.opacity = String(f.fade);
    bloom.style.opacity = String(f.bloom);
    holder.style.transform = `translate(-50%, -50%) translateX(${shift - dotW / 2}px)`;

    word.style.clipPath = `inset(-30% ${Math.max(0, full - revealPx)}px -30% -10%)`;

    edge.style.left = `${revealPx - 3}px`;
    edge.style.opacity = String(f.edge);
    edge.style.boxShadow = `0 0 ${size * 0.25}px ${size * 0.075}px ${ACCENT}`;

    dot.style.left = `${revealPx + GAP}px`;
    dot.style.top = `${base - DOT}px`;
    dot.style.opacity = String(f.dotOpacity);
    dot.style.transform = `scale(${f.dotScale})`;
    dot.style.boxShadow =
      `0 0 ${14 + f.dotGlow * 26}px ${ACCENT}, 0 0 ${40 + f.dotGlow * 120}px ${ACCENT}${f.dotGlow > 0.8 ? "cc" : "88"}`;

    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
}

// ---------------------------------------------------------------------------
// Kids: a different animation, not a recolour
// ---------------------------------------------------------------------------
//
// Ported from bump-kids.jsx. Where the normal ident ignites a dot and writes
// with it, this one drops a ball, bounces it twice, hops it onto the v, rolls
// it along the word and pops ".kids" in letter by letter. Deep blue ground,
// three drifting colour blobs, and the ball carries a highlight so it reads as
// a ball rather than a full stop until it becomes one.
//
// The design authors at 1080p with a 230px face; every fixed pixel below is
// expressed against the wordmark size so it holds at any height.

const KBG = "#0B0E24";
const KINK = "#FFFFFF";
// The design's palette, with its last letter mapped onto the app's accent --
// which is what it was reaching for. The final letter matching the dot is the
// point of the sequence: the ball becomes the full stop, and the word it
// finishes lands in the same colour.
const KIDS_COLORS = ["#FF7A5A", "#FFC93A", "#3AC9F5", ACCENT];
const KACCENT = ACCENT;

interface KFrameState {
  cam: number; fade: number; bloom: number; drift: number;
  vPart: number; restPart: number; suffixReveal: number;
  dotY: number; dotSquash: [number, number]; dotSpin: number;
  dotGlow: number; edge: number;
}

const KSETTLED = {
  vPart: 1, restPart: 1, suffixReveal: 0, dotY: 0,
  dotSquash: [1, 1] as [number, number], dotSpin: 0, dotGlow: 0.5, edge: 0,
};

/** Scene durations are the design's: 1.6 + 0.9 + 1.3 + 1.0 + 0.7 = 5.5s, which
 *  is exactly the length of kids-bump.mp4. */
const KSCENES: Array<{ dur: number; at: (p: number) => KFrameState }> = [
  // 1 -- the ball drops in and bounces to a stop.
  { dur: 1.6, at: (p) => {
      // lands at p 0.675 (the sting's second note), then two decaying bounces
      const y = interpolate(
        [0, 0.05, 0.675, 0.80, 0.885, 0.95, 1],
        [-900, -900, 0, -170, 0, -40, 0],
        [linear, easeInQuad, easeOutQuad, easeInQuad, easeOutQuad, easeInQuad],
      )(p);
      const squash = (t0: number, t1: number) =>
        interpolate([t0, (t0 + t1) / 2, t1], [1, 0, 1], easeOutQuad)(p);
      const impact = p < 0.62 ? 1 : p < 0.76 ? squash(0.665, 0.76) : p < 0.93 ? squash(0.878, 0.93) : 1;
      const sq = 1 - (1 - impact) * 0.55;
      return { ...KSETTLED,
        cam: MOTION.glide(1.1, 1.04, 0, 1)(p), fade: 1,
        bloom: MOTION.enter(0.2, 1, 0.4, 1)(p), drift: p,
        vPart: 0, restPart: 0,
        dotY: y, dotSquash: [2 - sq, sq], dotSpin: 0,
        dotGlow: p < 0.675 ? 0.9 : MOTION.enter(0.9, 0.5, 0.675, 1)(p),
      };
    } },
  // 2 -- the ball hops right and draws the v on landing.
  { dur: 0.9, at: (p) => {
      const arc = interpolate([0.1, 0.51], [0, 1], (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2))(p);
      const hop = Math.sin(clamp((p - 0.1) / 0.41, 0, 1) * Math.PI) * -230;
      const land = p > 0.51 && p < 0.63
        ? interpolate([0.51, 0.57, 0.63], [1, 0, 1], easeOutQuad)(p) : 1;
      const sq = 1 - (1 - land) * 0.5;
      return { ...KSETTLED,
        cam: MOTION.glide(1.04, 1.02, 0, 1)(p), fade: 1, bloom: 1, drift: 1 + p,
        vPart: arc, restPart: 0,
        dotY: hop, dotSquash: [2 - sq, sq], dotSpin: arc * 120,
        dotGlow: p < 0.51 ? MOTION.enter(0.5, 0.85, 0, 0.45)(p) : MOTION.enter(0.85, 0.5, 0.51, 0.85)(p),
        edge: MOTION.enter(0, 0.3, 0.12, 0.4)(p) * MOTION.enter(1, 0, 0.5, 0.7)(p),
      };
    } },
  // 3 -- the ball rolls right and the rest of the name unrolls behind it.
  { dur: 1.3, at: (p) => {
      const r = MOTION.glide(0, 1, 0.04, 0.72)(p);
      const wobble = p > 0.72
        ? Math.sin((p - 0.72) * 22) * (1 - clamp((p - 0.72) / 0.28, 0, 1)) * 0.12 : 0;
      return { ...KSETTLED,
        cam: MOTION.glide(1.02, 1, 0, 1)(p), fade: 1, bloom: 1, drift: 2 + p,
        vPart: 1, restPart: r,
        dotY: 0, dotSquash: [1 + wobble, 1 - wobble], dotSpin: 120 + r * 760,
        dotGlow: interpolate([0, 0.2, 0.72, 1], [0.5, 0.75, 0.95, 0.5], easeInOutSine)(p),
        edge: interpolate([0, 0.12, 0.66, 0.8], [0, 0.7, 0.55, 0], easeInOutSine)(p),
      };
    } },
  // 4 -- kids pops in, letter by letter.
  { dur: 1.0, at: (p) => {
      const wiggle = Math.sin(p * Math.PI * 3) * (1 - p) * 0.08;
      return { ...KSETTLED,
        cam: MOTION.glide(1, 0.99, 0, 1)(p), fade: 1,
        bloom: 1 + Math.sin(p * Math.PI) * 0.15, drift: 3 + p,
        vPart: 1, restPart: 1, suffixReveal: MOTION.glide(0, 1, 0.06, 0.82)(p),
        dotY: 0, dotSquash: [1 + wiggle, 1 - wiggle], dotSpin: 880,
        dotGlow: 0.5 + Math.sin(p * Math.PI) * 0.35,
      };
    } },
  // 5 -- the whole lockup pops out to black, ready to cut to content.
  { dur: 0.7, at: (p) => ({ ...KSETTLED,
      cam: interpolate([0, 0.22, 0.8], [0.99, 1.02, 1.16], easeInCubic)(p),
      fade: interpolate([0, 0.24, 0.74], [1, 1, 0], easeInCubic)(p),
      bloom: interpolate([0, 0.2, 0.6], [1, 1.3, 0], easeInOutSine)(p),
      drift: 4 + p,
      vPart: 1, restPart: 1, suffixReveal: 1,
      dotY: 0, dotSquash: [1, 1], dotSpin: 880,
      dotGlow: interpolate([0, 0.2, 0.6], [0.5, 1.2, 0.4], easeOutCubic)(p),
    }) },
];

export const IDENT_KIDS_SECONDS = KSCENES.reduce((a, s) => a + s.dur, 0);   // 5.5

function kidsFrameAt(t: number): KFrameState {
  let acc = 0;
  for (const s of KSCENES) {
    if (t < acc + s.dur) return s.at((t - acc) / s.dur);
    acc += s.dur;
  }
  return KSCENES[KSCENES.length - 1]!.at(1);
}

/** The kids stage. Same shape as the normal one: build once, measure, then a
 *  rAF loop that writes the frame the scene table describes. */
function playKidsIdent(done: () => void, opts: IdentOptions): void {
  const parent = opts.parent ?? document.body;

  const root = document.createElement("div");
  root.className = "idnt kids";
  root.style.cssText = opts.parent
    ? `position:absolute;inset:0;overflow:hidden;background:${KBG};z-index:50;`
    : `position:fixed;inset:0;overflow:hidden;background:${KBG};z-index:99999;`;

  const box = parent === document.body
    ? { w: window.innerWidth, h: window.innerHeight }
    : { w: parent.clientWidth, h: parent.clientHeight };
  // The design authors at 230px against 1080. k scales every fixed pixel below.
  const size = opts.size ?? Math.max(32, Math.min(230, Math.round(box.h * 0.213)));
  const k = size / 230;
  const DOT = 40 * k, GAP = 18 * k, SUF_GAP = 10 * k;
  const dotW = DOT + GAP;

  const type = `font-family:'Manrope','Bricolage Grotesque','Space Grotesk',sans-serif;`
    + `font-weight:800;font-size:${size}px;letter-spacing:-0.045em;line-height:1;white-space:nowrap;`;

  const blob = (color: string, x: number, y: number, px: number) =>
    `position:absolute;left:${x}%;top:${y}%;width:${px * k}px;height:${px * k}px;`
    + `margin-left:${-px * k / 2}px;margin-top:${-px * k / 2}px;border-radius:50%;`
    + `background:radial-gradient(circle, ${color}33 0%, ${color}12 40%, transparent 68%);`;

  const letters = "kids".split("");
  root.innerHTML = `
    <div class="kCam" style="position:absolute;inset:0;transform-origin:50% 50%;">
      <div style="position:absolute;inset:0;background:${KBG};overflow:hidden;">
        <div class="kBloom" style="position:absolute;inset:0;">
          <div class="kBlob" data-dx="26"  style="${blob("#FF7A5A", 24, 34, 900)}"></div>
          <div class="kBlob" data-dx="-30" style="${blob("#3AC9F5", 76, 62, 1000)}"></div>
          <div class="kBlob" data-dx="14"  style="${blob(ACCENT, 52, 48, 1200)}"></div>
        </div>
        <div style="position:absolute;inset:0;background:radial-gradient(ellipse at 50% 50%,
          transparent 40%, rgba(4,6,20,0.6) 80%, rgba(4,6,20,0.92) 100%);"></div>
      </div>
      <div class="kHolder" style="position:absolute;left:50%;top:50%;">
        <div class="kInner" style="position:relative;height:${size}px;">
          <span class="kWord" style="${type}position:absolute;left:0;top:0;color:${KINK};">veedeeoh</span>
          <span class="kV"   style="${type}position:absolute;left:0;top:0;color:${KINK};visibility:hidden;">v<i class="kBase" style="display:inline-block;width:0;height:0;vertical-align:baseline;"></i></span>
          <span class="kSuf" style="${type}position:absolute;left:0;top:0;visibility:hidden;">kids</span>
          <div class="kEdge" style="position:absolute;top:${-30 * k}px;width:${6 * k}px;height:${290 * k}px;
            background:${KACCENT};filter:blur(3px);box-shadow:0 0 ${60 * k}px ${18 * k}px ${KACCENT};"></div>
          <div class="kBall" style="position:absolute;width:${DOT}px;height:${DOT}px;transform-origin:50% 100%;">
            <div class="kBallIn" style="position:absolute;inset:0;border-radius:50%;background:${KACCENT};transform-origin:50% 50%;">
              <div style="position:absolute;left:26%;top:18%;width:26%;height:26%;border-radius:50%;background:rgba(255,255,255,0.75);"></div>
            </div>
          </div>
          <div class="kSuffix" style="position:absolute;top:0;display:flex;">
            ${letters.map((ch, i) =>
              `<span style="${type}display:inline-block;color:${KIDS_COLORS[i % KIDS_COLORS.length]};transform-origin:50% 85%;">${ch}</span>`).join("")}
          </div>
        </div>
      </div>
    </div>`;
  parent.appendChild(root);

  const cam = root.querySelector<HTMLElement>(".kCam")!;
  const bloomEl = root.querySelector<HTMLElement>(".kBloom")!;
  const blobs = Array.from(root.querySelectorAll<HTMLElement>(".kBlob"));
  const holder = root.querySelector<HTMLElement>(".kHolder")!;
  const inner = root.querySelector<HTMLElement>(".kInner")!;
  const word = root.querySelector<HTMLElement>(".kWord")!;
  const edge = root.querySelector<HTMLElement>(".kEdge")!;
  const ball = root.querySelector<HTMLElement>(".kBall")!;
  const ballIn = root.querySelector<HTMLElement>(".kBallIn")!;
  const suffix = root.querySelector<HTMLElement>(".kSuffix")!;
  const sufLetters = Array.from(suffix.children) as HTMLElement[];

  const full = word.getBoundingClientRect().width;
  const vW = root.querySelector<HTMLElement>(".kV")!.getBoundingClientRect().width;
  const sufW = root.querySelector<HTMLElement>(".kSuf")!.getBoundingClientRect().width;
  const kProbe = root.querySelector<HTMLElement>(".kBase");
  const baseline = kProbe ? kProbe.offsetTop : size;
  const boxW = full + dotW + SUF_GAP + sufW;
  inner.style.width = `${boxW}px`;

  let audio: HTMLAudioElement | null = null;
  if (opts.sound !== false) {
    try {
      audio = new Audio("/ident-kids.mp3");
      audio.volume = 0.9;
      void audio.play().catch(() => {});
    } catch { audio = null; }
  }

  let finished = false;
  let raf = 0;
  const finish = (): void => {
    if (finished) return;
    finished = true;
    cancelAnimationFrame(raf);
    if (audio) { try { audio.pause(); } catch {} }
    try { sessionStorage.setItem("veedeeoh_ident_at", String(Date.now())); } catch {}
    root.remove();
    done();
  };
  root.addEventListener("click", finish);

  const step = 1 / (letters.length + 1);
  const start = performance.now();
  const tick = (now: number): void => {
    if (finished) return;
    const t = (now - start) / 1000;
    if (t >= IDENT_KIDS_SECONDS) { finish(); return; }
    const f = kidsFrameAt(t);

    const revealPx = Math.max(0, Math.min(full, vW * f.vPart + (full - vW) * f.restPart));
    const contentW = revealPx + dotW + (SUF_GAP + sufW) * f.suffixReveal;
    const shift = (boxW - contentW) / 2;

    cam.style.transform = `scale(${f.cam})`;
    cam.style.opacity = String(f.fade);
    bloomEl.style.opacity = String(f.bloom);
    blobs.forEach((b) => {
      const dx = Number(b.dataset.dx) * k * f.drift;
      b.style.transform = `translate(${dx}px, ${dx * -0.4}px)`;
    });
    holder.style.transform = `translate(-50%, -50%) translateX(${shift}px)`;
    word.style.clipPath = `inset(-30% ${Math.max(0, full - revealPx)}px -30% -10%)`;

    edge.style.left = `${revealPx - 3 * k}px`;
    edge.style.opacity = String(f.edge);

    // Squash rides the outer box (origin at the contact point); the spin rides
    // the inner one (origin at the ball's centre). Spinning about the contact
    // point would swing the ball off the baseline -- the design's note, kept
    // because the structure only makes sense with it.
    ball.style.left = `${revealPx + GAP}px`;
    ball.style.top = `${baseline - DOT}px`;
    ball.style.transform = `translateY(${f.dotY * k}px) scale(${f.dotSquash[0]}, ${f.dotSquash[1]})`;
    ballIn.style.transform = `rotate(${f.dotSpin}deg)`;
    ballIn.style.boxShadow =
      `0 0 ${(12 + f.dotGlow * 24) * k}px ${KACCENT}, 0 0 ${(34 + f.dotGlow * 110) * k}px ${KACCENT}88`;

    suffix.style.left = `${revealPx + dotW + SUF_GAP}px`;
    sufLetters.forEach((el, i) => {
      const lp = clamp((f.suffixReveal - i * step) / step, 0, 1);
      const e = easeOutBack(lp);
      el.style.opacity = String(Math.min(1, lp * 2.2));
      el.style.transform =
        `translateY(${(1 - e) * 90 * k}px) rotate(${(1 - e) * (i % 2 ? 10 : -10)}deg) scale(${0.55 + e * 0.45})`;
    });

    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
}
