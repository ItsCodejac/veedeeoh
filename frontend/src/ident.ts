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
const ACCENT = "#C6F53A";

// ---------------------------------------------------------------------------
// The three easings the design uses, and nothing else
// ---------------------------------------------------------------------------

const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);
const easeInCubic = (t: number): number => t * t * t;
const easeInOutCubic = (t: number): number =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
const easeInOutSine = (t: number): number => -(Math.cos(Math.PI * t) - 1) / 2;
const easeOutBack = (t: number): number => {
  const c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};

/** Piecewise interpolation over matched stop/value arrays, clamped at both
 *  ends. The design's `interpolate`; the scene code below is unreadable
 *  without it and identical with it. */
function interpolate(stops: number[], values: number[], ease: (t: number) => number) {
  return (p: number): number => {
    if (p <= stops[0]!) return values[0]!;
    const last = stops.length - 1;
    if (p >= stops[last]!) return values[last]!;
    let i = 0;
    while (i < last && p > stops[i + 1]!) i++;
    const span = stops[i + 1]! - stops[i]!;
    const local = span === 0 ? 0 : (p - stops[i]!) / span;
    return values[i]! + (values[i + 1]! - values[i]!) * ease(local);
  };
}

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
          <span class="idntV" style="${type}position:absolute;left:0;top:0;color:${INK};visibility:hidden;"></span>
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
  vGhost.textContent = "v";
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
  const base = size;                       // baseline, per the design's offsetTop probe
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
