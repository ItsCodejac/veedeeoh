/* veedeeoh. — logo ident, standalone. No framework, no build step.
 *
 *   <script src="/veedeeoh-ident.js"></script>
 *   <veedeeoh-ident></veedeeoh-ident>                 <!-- main, 4.95s -->
 *   <veedeeoh-ident variant="kids"></veedeeoh-ident>  <!-- kids, 5.50s -->
 *   <veedeeoh-ident variant="party"></veedeeoh-ident> <!-- party, 1.50s -->
 *
 * Attributes
 *   variant   "main" (default) | "kids" | "party"
 *   word      wordmark text, default "veedeeoh"
 *   suffix    kids/party only, default "kids" / "party"
 *   accent    hex, default #C6F53A
 *   size      type size in stage px (default 240 main / 230 kids)
 *   width     stage width, default 1920
 *   height    stage height, default 1080
 *   audio     URL of the sting; omit for silent. Set .muted = true to
 *             autoplay without a gesture, then flip it back on a click.
 *   autoplay  present = play on connect (default). Remove to call .play()
 *   loop      present = restart when finished
 *
 * Methods:  play(), pause(), reset(), seek(seconds)
 * Events:   "ident-end" fires once the frame is black
 * Requires Manrope 800 (any weight-800 sans will render, metrics adapt).
 */
(() => {
  'use strict';

  /* ---------- easing + interpolation ---------- */

  const E = {
    linear: (t) => t,
    easeInQuad: (t) => t * t,
    easeOutQuad: (t) => 1 - (1 - t) * (1 - t),
    easeInCubic: (t) => t * t * t,
    easeOutCubic: (t) => 1 - Math.pow(1 - t, 3),
    easeInOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
    easeInOutSine: (t) => -(Math.cos(Math.PI * t) - 1) / 2,
    easeOutBack: (t) => {
      const c1 = 1.70158, c3 = c1 + 1;
      return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
    },
  };

  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  /* interp([stops], [values], easing | [easings]) -> (p) => value */
  function interp(stops, values, easing = E.easeInOutCubic) {
    const eases = Array.isArray(easing) ? easing : null;
    return (p) => {
      if (p <= stops[0]) return values[0];
      const last = stops.length - 1;
      if (p >= stops[last]) return values[last];
      let i = 0;
      while (i < last && p > stops[i + 1]) i++;
      const span = stops[i + 1] - stops[i] || 1;
      const local = (p - stops[i]) / span;
      const fn = eases ? (eases[i] || E.linear) : easing;
      return values[i] + (values[i + 1] - values[i]) * fn(local);
    };
  }

  const enter = (a, b, s, e) => interp([s, e], [a, b], E.easeOutCubic);
  const glide = (a, b, s, e) => interp([s, e], [a, b], E.easeInOutCubic);
  const pop = (a, b, s, e) => interp([s, e], [a, b], E.easeOutBack);

  /* ---------- shared config ---------- */

  const MAIN = {
    bg: '#08090B',
    typeSize: 240,
    scenes: [
      { name: 'Ignite', dur: 1.05 },
      { name: 'Draw the V', dur: 1.0 },
      { name: 'Expand', dur: 1.4 },
      { name: 'Hold', dur: 0.8 },
      { name: 'Cut out', dur: 0.7 },
    ],
  };

  const KIDS = {
    bg: '#0B0E24',
    typeSize: 230,
    letterColors: ['#FF7A5A', '#FFC93A', '#3AC9F5', '#C6F53A'],
    blobs: [['#FF7A5A', 24, 34, 900], ['#3AC9F5', 76, 62, 1000], ['#C6F53A', 52, 48, 1200]],
    veil: 'rgba(4,6,20',
    scenes: [
      { name: 'Ball drop', dur: 1.6 },
      { name: 'Hop to the V', dur: 0.9 },
      { name: 'Roll out the name', dur: 1.3 },
      { name: 'kids pops in', dur: 1.0 },
      { name: 'Pop out', dur: 0.7 },
    ],
  };

  /* party — a 1.5s in-app transition: four guests fly in and land as the
     period, the room flashes, "party" snaps on. Short enough to sit under a
     route change, loud enough to feel like an event. */
  const PARTY = {
    bg: '#0A0716',
    typeSize: 230,
    letterColors: ['#FF3D9A', '#C6F53A', '#3AC9F5', '#FFC93A', '#FF3D9A'],
    blobs: [['#FF3D9A', 27, 36, 950], ['#3AC9F5', 74, 60, 1000], ['#C6F53A', 50, 50, 1150]],
    veil: 'rgba(8,4,20',
    satellites: [
      { color: '#FF3D9A', angle: -138, dist: 660 },
      { color: '#3AC9F5', angle: -36, dist: 600 },
      { color: '#FFC93A', angle: 44, dist: 700 },
      { color: '#C6F53A', angle: 148, dist: 640 },
    ],
    scenes: [
      { name: 'Guests arrive', dur: 0.9 },
      { name: 'Room pops', dur: 0.75 },
      { name: 'Cut out', dur: 0.75 },
    ],
  };

  const el = (tag, css, parent) => {
    const n = document.createElement(tag);
    if (css) n.style.cssText = css;
    if (parent) parent.appendChild(n);
    return n;
  };

  const TYPE = (size) =>
    `font-family:Manrope,system-ui,sans-serif;font-weight:800;font-size:${size}px;` +
    `letter-spacing:-0.045em;line-height:1;white-space:nowrap`;

  /* ---------- component ---------- */

  class VeedeeohIdent extends HTMLElement {
    static get observedAttributes() { return ['variant', 'word', 'suffix', 'accent', 'size', 'width', 'height', 'audio']; }

    constructor() {
      super();
      this._muted = false;
      this._raf = 0;
      this._t = 0;
      this._playing = false;
      this._ended = false;
      this._last = 0;
      this.attachShadow({ mode: 'open' });
    }

    /* --- config read off attributes --- */
    get variant() {
      const v = this.getAttribute('variant');
      return v === 'kids' || v === 'party' ? v : 'main';
    }
    get cfg() { return this.variant === 'kids' ? KIDS : this.variant === 'party' ? PARTY : MAIN; }
    get hasSuffix() { return this.variant !== 'main'; }
    get word() { return this.getAttribute('word') || 'veedeeoh'; }
    get suffix() { return this.getAttribute('suffix') || (this.variant === 'party' ? 'party' : 'kids'); }
    get accent() { return this.getAttribute('accent') || '#C6F53A'; }
    get typeSize() { return Number(this.getAttribute('size')) || this.cfg.typeSize; }
    get stageW() { return Number(this.getAttribute('width')) || 1920; }
    get stageH() { return Number(this.getAttribute('height')) || 1080; }
    get duration() { return this.cfg.scenes.reduce((a, s) => a + s.dur, 0); }

    connectedCallback() {
      this._build();
      this._fit();
      this._ro = new ResizeObserver(() => this._fit());
      this._ro.observe(this);
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { this._measure(); this._frame(this._t); });
      this._frame(0);
      if (!this.hasAttribute('autoplay') || this.getAttribute('autoplay') !== 'false') this.play();
    }

    disconnectedCallback() {
      cancelAnimationFrame(this._raf);
      if (this._ro) this._ro.disconnect();
    }

    attributeChangedCallback(name) {
      if (!this.shadowRoot.firstChild) return;
      this._build();
      this._fit();
      this._frame(this._t);
    }

    /* --- public API --- */
    get muted() { return this._muted; }
    set muted(v) {
      this._muted = !!v;
      if (this._audio) this._audio.muted = this._muted;
    }

    play() {
      if (this._playing) return;
      if (this._ended) this.reset();
      this._playing = true;
      this._last = performance.now();
      if (this._audio) { this._audio.currentTime = Math.max(0, this._t); this._audio.play().catch(() => {}); }
      const step = (now) => {
        if (!this._playing) return;
        this._t += (now - this._last) / 1000;
        this._last = now;
        if (this._t >= this.duration) {
          this._t = this.duration;
          this._frame(this._t);
          this._playing = false;
          this._ended = true;
          // the picture is done but the sting keeps ringing — let it finish
          this.dispatchEvent(new CustomEvent('ident-end'));
          if (this.hasAttribute('loop')) {
            this._t = 0;
            this._ended = false;
            this._playing = true;
            if (this._audio) { this._audio.currentTime = 0; this._audio.play().catch(() => {}); }
            this._frame(0);
            this._raf = requestAnimationFrame(step);
          }
          return;
        }
        this._frame(this._t);
        this._raf = requestAnimationFrame(step);
      };
      this._raf = requestAnimationFrame(step);
    }

    pause() {
      this._playing = false;
      cancelAnimationFrame(this._raf);
      if (this._audio) this._audio.pause();
    }

    reset() {
      this.pause();
      this._t = 0;
      this._ended = false;
      if (this._audio) this._audio.currentTime = 0;
      this._frame(0);
    }

    seek(sec) {
      this._t = clamp(sec, 0, this.duration);
      this._ended = false;
      if (this._audio) this._audio.currentTime = Math.min(this._t, this.duration - 0.02);
      this._frame(this._t);
    }

    /* --- layout --- */

    _build() {
      const root = this.shadowRoot;
      root.innerHTML = '';
      const style = document.createElement('style');
      style.textContent = ':host{display:block;position:relative;overflow:hidden;background:' + this.cfg.bg + '}';
      root.appendChild(style);

      const size = this.typeSize;
      const isKids = this.hasSuffix;

      this._viewport = el('div', 'position:absolute;inset:0;overflow:hidden;background:' + this.cfg.bg, root);
      this._stage = el('div',
        `position:absolute;left:50%;top:50%;width:${this.stageW}px;height:${this.stageH}px;` +
        'transform-origin:50% 50%;overflow:hidden;background:' + this.cfg.bg, this._viewport);

      // frame: holds fade + camera scale
      this._frameEl = el('div', 'position:absolute;inset:0;transform-origin:50% 50%', this._stage);

      // backdrop
      this._backdrop = el('div', 'position:absolute;inset:0;overflow:hidden', this._frameEl);
      if (isKids) {
        this._bloomWrap = el('div', 'position:absolute;inset:0', this._backdrop);
        const blob = (color, x, y, s) => el('div',
          `position:absolute;left:${x}%;top:${y}%;width:${s}px;height:${s}px;` +
          `margin-left:${-s / 2}px;margin-top:${-s / 2}px;border-radius:50%;` +
          `background:radial-gradient(circle, ${color}33 0%, ${color}12 40%, transparent 68%)`, this._bloomWrap);
        this._blobs = this.cfg.blobs.map((b) => blob(b[0], b[1], b[2], b[3]));
        const veil = this.cfg.veil;
        el('div', 'position:absolute;inset:0;background:radial-gradient(ellipse at 50% 50%,' +
          ' transparent 40%, ' + veil + ',0.6) 80%, ' + veil + ',0.92) 100%)', this._backdrop);
      } else {
        this._bloom = el('div',
          'position:absolute;left:50%;top:50%;width:1700px;height:1700px;margin-left:-850px;' +
          'margin-top:-850px;border-radius:50%;background:radial-gradient(circle,' +
          `${this.accent}22 0%, ${this.accent}0a 32%, transparent 62%)`, this._backdrop);
        el('div', 'position:absolute;inset:0;background:radial-gradient(ellipse at 50% 50%,' +
          ' transparent 38%, rgba(0,0,0,0.55) 78%, rgba(0,0,0,0.9) 100%)', this._backdrop);
      }

      // lockup
      this._lockup = el('div', 'position:absolute;left:50%;top:50%', this._frameEl);
      this._box = el('div', `position:relative;height:${size}px`, this._lockup);

      this._wordEl = el('span', TYPE(size) + ';position:absolute;left:0;top:0;color:#fff', this._box);
      this._wordEl.textContent = this.word;

      // hidden measure span: first glyph + a zero-size baseline probe
      this._vEl = el('span', TYPE(size) + ';position:absolute;left:0;top:0;visibility:hidden', this._box);
      this._vEl.textContent = this.word.slice(0, 1);
      this._baseEl = el('span', 'display:inline-block;width:0;height:0;vertical-align:baseline', this._vEl);

      this._edge = el('div', `position:absolute;background:${this.accent};filter:blur(3px)`, this._box);

      if (isKids) {
        this._sufEl = el('span', TYPE(size) + ';position:absolute;left:0;top:0;visibility:hidden', this._box);
        this._sufEl.textContent = this.suffix;
        // squash rides the outer node (origin at the contact point); spin rides
        // the inner one (origin at centre) — spinning about the contact point
        // would swing the ball off the baseline.
        this._ball = el('div', 'position:absolute;transform-origin:50% 100%', this._box);
        this._ballInner = el('div',
          `position:absolute;inset:0;border-radius:50%;background:${this.accent};transform-origin:50% 50%`, this._ball);
        el('div', 'position:absolute;left:26%;top:18%;width:26%;height:26%;border-radius:50%;' +
          'background:rgba(255,255,255,0.75)', this._ballInner);
        this._sufWrap = el('div', 'position:absolute;top:0;display:flex', this._box);
        const pal = this.cfg.letterColors;
        this._letters = this.suffix.split('').map((ch, i) => {
          const s = el('span', TYPE(size) + ';display:inline-block;transform-origin:50% 85%;color:' +
            pal[i % pal.length], this._sufWrap);
          s.textContent = ch;
          return s;
        });
        if (this.variant === 'party') {
          // impact ring + four incoming guests, positioned off the ball's cell
          this._ring = el('div',
            'position:absolute;border-radius:50%;pointer-events:none;opacity:0', this._box);
          this._sats = PARTY.satellites.map((s) => el('div',
            'position:absolute;border-radius:50%;background:' + s.color +
            ';box-shadow:0 0 26px ' + s.color + ',0 0 80px ' + s.color + '66', this._box));
        } else {
          this._ring = null;
          this._sats = null;
        }
      } else {
        this._dot = el('div', `position:absolute;border-radius:50%;background:${this.accent};transform-origin:50% 50%`, this._box);
      }

      const audioSrc = this.getAttribute('audio');
      if (audioSrc) {
        const keep = this._audio && this._audio.src.endsWith(audioSrc.replace(/^\.?\//, ''));
        if (!keep) {
          this._audio = new Audio(audioSrc);
          this._audio.preload = 'auto';
          this._audio.volume = 0.9;
        }
        this._audio.muted = this.muted;
      } else {
        this._audio = null;
      }

      this._measure();
    }

    _measure() {
      const size = this.typeSize;
      const DOT = this.hasSuffix ? 40 : Math.round(size * 0.158);
      const GAP = this.hasSuffix ? 18 : Math.round(size * 0.067);
      this._m = {
        full: this._wordEl.offsetWidth || size * 4.6,
        v: this._vEl.offsetWidth || size * 0.62,
        suf: this._sufEl ? this._sufEl.offsetWidth : 0,
        base: this._baseEl.offsetTop || Math.round(size * 0.78),
        DOT, GAP, SUF_GAP: 10,
      };
      const boxW = this.hasSuffix
        ? this._m.full + DOT + GAP + this._m.SUF_GAP + this._m.suf
        : this._m.full + DOT + GAP;
      this._box.style.width = boxW + 'px';
      if (this._dot) { this._dot.style.width = DOT + 'px'; this._dot.style.height = DOT + 'px'; }
      if (this._ball) { this._ball.style.width = DOT + 'px'; this._ball.style.height = DOT + 'px'; }
      this._edge.style.width = Math.max(4, size * 0.025) + 'px';
      this._edge.style.height = size * 1.25 + 'px';
      this._edge.style.top = -size * 0.14 + 'px';
      this._edge.style.boxShadow = `0 0 ${size * 0.25}px ${size * 0.075}px ${this.accent}`;
    }

    _fit() {
      const w = this.clientWidth || this.stageW;
      const h = this.clientHeight || this.stageH;
      const k = Math.min(w / this.stageW, h / this.stageH);
      this._stage.style.transform = `translate(-50%,-50%) scale(${k})`;
    }

    /* --- per-frame --- */

    _sceneAt(t) {
      const s = this.cfg.scenes;
      let acc = 0;
      for (let i = 0; i < s.length; i++) {
        if (t < acc + s[i].dur || i === s.length - 1) {
          return { i, p: clamp((t - acc) / s[i].dur, 0, 1) };
        }
        acc += s[i].dur;
      }
      return { i: 0, p: 0 };
    }

    _frame(t) {
      const { i, p } = this._sceneAt(t);
      if (this.variant === 'kids') this._kidsFrame(i, p);
      else if (this.variant === 'party') this._partyFrame(i, p);
      else this._mainFrame(i, p);
    }

    /* apply the shared lockup state */
    _apply(v) {
      const m = this._m, size = this.typeSize;
      const revealPx = clamp(m.v * v.vPart + (m.full - m.v) * v.restPart, 0, m.full);
      const dotW = m.DOT + m.GAP;

      this._frameEl.style.opacity = v.fade;
      this._frameEl.style.transform = `scale(${v.cam})`;
      this._wordEl.style.clipPath = `inset(-30% ${Math.max(0, m.full - revealPx)}px -30% -10%)`;
      this._edge.style.left = revealPx - 3 + 'px';
      this._edge.style.opacity = v.edge;

      if (this.hasSuffix) {
        const boxW = m.full + dotW + m.SUF_GAP + m.suf;
        const contentW = revealPx + dotW + (m.SUF_GAP + m.suf) * v.suffixReveal;
        this._lockup.style.transform = `translate(-50%,-50%) translateX(${(boxW - contentW) / 2}px)`;

        this._blobs[0].style.transform = `translate(${v.drift * 26}px, ${v.drift * -10.4}px)`;
        this._blobs[1].style.transform = `translate(${v.drift * -30}px, ${v.drift * 12}px)`;
        this._blobs[2].style.transform = `translate(${v.drift * 14}px, ${v.drift * -5.6}px)`;
        this._bloomWrap.style.opacity = v.bloom;

        this._ball.style.left = revealPx + m.GAP + 'px';
        this._ball.style.top = m.base - m.DOT + 'px';
        this._ball.style.transform =
          `translateY(${v.dotY}px) scale(${v.dotSquash[0]}, ${v.dotSquash[1]})`;
        this._ballInner.style.transform = `rotate(${v.dotSpin}deg)`;
        this._ballInner.style.boxShadow =
          `0 0 ${12 + v.dotGlow * 24}px ${this.accent}, 0 0 ${34 + v.dotGlow * 110}px ${this.accent}88`;

        if (this._sats) {
          const cx = revealPx + m.GAP + m.DOT / 2, cy = m.base - m.DOT / 2;
          PARTY.satellites.forEach((s, si) => {
            const a = s.angle * Math.PI / 180;
            const d = s.dist * v.satDist;
            const n = this._sats[si];
            const sz = m.DOT * (0.62 + 0.38 * (1 - v.satDist));
            n.style.width = n.style.height = sz + 'px';
            n.style.left = cx - sz / 2 + 'px';
            n.style.top = cy - sz / 2 + 'px';
            n.style.opacity = v.satOpacity;
            n.style.transform = 'translate(' + Math.cos(a) * d + 'px,' + Math.sin(a) * d + 'px)';
          });
          const rs = m.DOT * v.ringScale;
          this._ring.style.width = this._ring.style.height = rs + 'px';
          this._ring.style.left = cx - rs / 2 + 'px';
          this._ring.style.top = cy - rs / 2 + 'px';
          this._ring.style.opacity = v.ringOpacity;
          this._ring.style.border = Math.max(2, 10 * (1 - v.ringScale / 26)) + 'px solid ' + this.accent;
        }
        this._sufWrap.style.left = revealPx + dotW + m.SUF_GAP + 'px';
        const step = 1 / (this._letters.length + 1);
        this._letters.forEach((s, li) => {
          const lp = clamp((v.suffixReveal - li * step) / step, 0, 1);
          const e = E.easeOutBack(lp);
          s.style.opacity = Math.min(1, lp * 2.2);
          s.style.transform =
            `translateY(${(1 - e) * 90}px) rotate(${(1 - e) * (li % 2 ? 10 : -10)}deg) scale(${0.55 + e * 0.45})`;
        });
      } else {
        this._lockup.style.transform = `translate(-50%,-50%) translateX(${(m.full - revealPx) / 2 - dotW / 2}px)`;
        this._bloom.style.opacity = v.bloom;
        this._dot.style.left = revealPx + m.GAP + 'px';
        this._dot.style.top = m.base - m.DOT + 'px';
        this._dot.style.opacity = v.dotOpacity;
        this._dot.style.transform = `scale(${v.dotScale})`;
        this._dot.style.boxShadow =
          `0 0 ${14 + v.dotGlow * 26}px ${this.accent}, 0 0 ${40 + v.dotGlow * 120}px ` +
          `${this.accent}${v.dotGlow > 0.8 ? 'cc' : '88'}`;
      }
    }

    /* ----- main ident ----- */
    _mainFrame(i, p) {
      const base = {
        fade: 1, cam: 1, bloom: 0.7, edge: 0,
        vPart: 1, restPart: 1, dotOpacity: 1, dotScale: 1, dotGlow: 0.6,
      };
      let v;
      if (i === 0) {
        // a single point of light arrives out of black
        const scale = p < 0.62 ? pop(0.15, 1.14, 0.08, 0.62)(p) : glide(1.14, 1, 0.62, 1)(p);
        v = { ...base, cam: glide(1.12, 1.06, 0, 1)(p), bloom: enter(0, 0.55, 0.1, 0.8)(p),
          vPart: 0, restPart: 0, dotOpacity: enter(0, 1, 0.05, 0.3)(p),
          dotScale: scale, dotGlow: enter(1, 0.55, 0.3, 0.95)(p) };
      } else if (i === 1) {
        // the dot draws the v
        v = { ...base, cam: glide(1.06, 1.03, 0, 1)(p), bloom: 0.55,
          vPart: glide(0, 1, 0.04, 0.74)(p), restPart: 0,
          dotGlow: p < 0.74 ? 0.55 : pop(0.55, 0.85, 0.74, 1)(p),
          edge: enter(0, 0.35, 0.04, 0.34)(p) * enter(1, 0, 0.58, 0.88)(p) };
      } else if (i === 2) {
        // sweep right, the rest of the name appears in its wake
        v = { ...base, cam: glide(1.03, 1, 0, 1)(p),
          bloom: interp([0, 0.7, 1], [0.55, 0.9, 0.7], E.easeInOutSine)(p),
          restPart: glide(0, 1, 0.04, 0.74)(p),
          dotScale: interp([0, 0.74, 0.86, 1], [1, 1.18, 0.96, 1], E.easeOutCubic)(p),
          dotGlow: interp([0, 0.3, 0.76, 1], [0.85, 0.7, 1, 0.6], E.easeInOutSine)(p),
          edge: interp([0, 0.1, 0.68, 0.82], [0, 0.85, 0.7, 0], E.easeInOutSine)(p) };
      } else if (i === 3) {
        // settled hold, one slow breath
        const b = Math.sin(p * Math.PI);
        v = { ...base, cam: glide(1, 0.988, 0, 1)(p), bloom: 0.7 + b * 0.18,
          dotScale: 1 + b * 0.015, dotGlow: 0.6 + b * 0.3 };
      } else {
        // flare, then dissolve to black
        v = { ...base, cam: glide(0.988, 1.055, 0, 0.8)(p),
          fade: interp([0, 0.2, 0.72], [1, 1, 0], E.easeInCubic)(p),
          bloom: interp([0, 0.16, 0.6], [0.7, 1, 0], E.easeInOutSine)(p),
          dotScale: interp([0, 0.16, 0.5], [1, 1.24, 1.05], E.easeOutCubic)(p),
          dotGlow: interp([0, 0.16, 0.55], [0.6, 1.3, 0.5], E.easeOutCubic)(p) };
      }
      this._apply(v);
    }

    /* ----- party ident: 1.5s, built to sit under a route change ----- */
    _partyFrame(i, p) {
      const base = {
        fade: 1, cam: 1, bloom: 1, drift: 0, edge: 0,
        vPart: 1, restPart: 1, suffixReveal: 0,
        dotY: 0, dotSquash: [1, 1], dotSpin: 0, dotGlow: 0.6,
        satDist: 0, satOpacity: 0, ringScale: 1, ringOpacity: 0,
      };
      let v;
      if (i === 0) {
        // the name wipes on fast while four guests rush the period
        const wipe = interp([0.06, 0.66], [0, 1], E.easeOutCubic)(p);
        const grow = enter(0.2, 0.9, 0.12, 0.92)(p);
        v = { ...base, cam: glide(1.1, 1.01, 0, 1)(p), drift: p * 0.6,
          fade: interp([0, 0.16], [0, 1], E.easeOutCubic)(p),
          bloom: enter(0.2, 1, 0, 0.72)(p),
          vPart: wipe, restPart: wipe,
          satDist: interp([0.04, 1], [1, 0], E.easeInQuad)(p),
          satOpacity: enter(0, 1, 0.04, 0.2)(p),
          dotGlow: 0.35, dotSquash: [grow, grow], edge: 0 };
      } else if (i === 1) {
        // impact: ring blows out, the dot overshoots, "party" snaps on
        const sq = interp([0, 0.1, 0.26], [1.5, 0.72, 1], E.easeOutQuad)(p);
        v = { ...base, cam: interp([0, 0.16, 1], [1.01, 1.035, 1.005], E.easeOutCubic)(p),
          drift: 0.6 + p * 0.5,
          bloom: interp([0, 0.14, 1], [1, 1.5, 1.05], E.easeOutCubic)(p),
          suffixReveal: interp([0.06, 0.66], [0, 1], E.easeOutCubic)(p),
          dotSquash: [2 - sq, sq],
          dotGlow: interp([0, 0.12, 0.6], [0.35, 1.3, 0.6], E.easeOutCubic)(p),
          satOpacity: interp([0, 0.1], [1, 0], E.easeOutQuad)(p),
          ringScale: interp([0, 0.62], [1, 26], E.easeOutCubic)(p),
          ringOpacity: interp([0, 0.06, 0.62], [0, 0.75, 0], E.easeOutQuad)(p) };
      } else {
        // punch out to black so the party route can cut straight in
        v = { ...base, cam: interp([0, 0.4, 1], [1.005, 1.03, 1.09], E.easeInOutCubic)(p),
          fade: interp([0, 0.34, 1], [1, 0.86, 0], E.easeInOutSine)(p),
          drift: 1.1 + p, bloom: interp([0, 0.2, 0.9], [1.05, 1.2, 0], E.easeInOutSine)(p),
          suffixReveal: 1,
          dotGlow: interp([0, 0.24, 0.7], [0.6, 1.35, 0.4], E.easeOutCubic)(p) };
      }
      this._apply(v);
    }

    /* ----- kids ident ----- */
    _kidsFrame(i, p) {
      const base = {
        fade: 1, cam: 1, bloom: 1, drift: 0, edge: 0,
        vPart: 1, restPart: 1, suffixReveal: 0,
        dotY: 0, dotSquash: [1, 1], dotSpin: 0, dotGlow: 0.5,
      };
      let v;
      if (i === 0) {
        // the ball drops in and bounces to a stop — lands on the sting's 2nd note
        const y = interp(
          [0, 0.05, 0.675, 0.80, 0.885, 0.95, 1],
          [-900, -900, 0, -170, 0, -40, 0],
          [E.linear, E.easeInQuad, E.easeOutQuad, E.easeInQuad, E.easeOutQuad, E.easeInQuad]
        )(p);
        const squash = (t0, t1) => interp([t0, (t0 + t1) / 2, t1], [1, 0, 1], E.easeOutQuad)(p);
        const impact = p < 0.62 ? 1 : p < 0.76 ? squash(0.665, 0.76) : p < 0.93 ? squash(0.878, 0.93) : 1;
        const sq = 1 - (1 - impact) * 0.55;
        v = { ...base, cam: glide(1.1, 1.04, 0, 1)(p), drift: p, bloom: enter(0.2, 1, 0.4, 1)(p),
          vPart: 0, restPart: 0, dotY: y, dotSquash: [2 - sq, sq],
          dotGlow: p < 0.675 ? 0.9 : enter(0.9, 0.5, 0.675, 1)(p) };
      } else if (i === 1) {
        // hops right, draws the v on landing
        const arc = interp([0.1, 0.51], [0, 1], E.easeInOutQuad)(p);
        const hop = Math.sin(clamp((p - 0.1) / 0.41, 0, 1) * Math.PI) * -230;
        const land = p > 0.51 && p < 0.63 ? interp([0.51, 0.57, 0.63], [1, 0, 1], E.easeOutQuad)(p) : 1;
        const sq = 1 - (1 - land) * 0.5;
        v = { ...base, cam: glide(1.04, 1.02, 0, 1)(p), drift: 1 + p,
          vPart: arc, restPart: 0, dotY: hop, dotSquash: [2 - sq, sq], dotSpin: arc * 120,
          dotGlow: p < 0.51 ? enter(0.5, 0.85, 0, 0.45)(p) : enter(0.85, 0.5, 0.51, 0.85)(p),
          edge: enter(0, 0.3, 0.12, 0.4)(p) * enter(1, 0, 0.5, 0.7)(p) };
      } else if (i === 2) {
        // rolls right, the rest of the name unrolls behind it
        const r = glide(0, 1, 0.04, 0.72)(p);
        const wobble = p > 0.72
          ? Math.sin((p - 0.72) * 22) * (1 - clamp((p - 0.72) / 0.28, 0, 1)) * 0.12 : 0;
        v = { ...base, cam: glide(1.02, 1, 0, 1)(p), drift: 2 + p,
          restPart: r, dotSquash: [1 + wobble, 1 - wobble], dotSpin: 120 + r * 760,
          dotGlow: interp([0, 0.2, 0.72, 1], [0.5, 0.75, 0.95, 0.5], E.easeInOutSine)(p),
          edge: interp([0, 0.12, 0.66, 0.8], [0, 0.7, 0.55, 0], E.easeInOutSine)(p) };
      } else if (i === 3) {
        // "kids" pops in, letter by letter
        const wiggle = Math.sin(p * Math.PI * 3) * (1 - p) * 0.08;
        v = { ...base, cam: glide(1, 0.99, 0, 1)(p), drift: 3 + p,
          bloom: 1 + Math.sin(p * Math.PI) * 0.15,
          suffixReveal: glide(0, 1, 0.06, 0.82)(p),
          dotSquash: [1 + wiggle, 1 - wiggle], dotSpin: 880,
          dotGlow: 0.5 + Math.sin(p * Math.PI) * 0.35 };
      } else {
        // the whole lockup pops out to black
        v = { ...base, cam: interp([0, 0.22, 0.8], [0.99, 1.02, 1.16], E.easeInCubic)(p),
          fade: interp([0, 0.24, 0.74], [1, 1, 0], E.easeInCubic)(p), drift: 4 + p,
          bloom: interp([0, 0.2, 0.6], [1, 1.3, 0], E.easeInOutSine)(p),
          suffixReveal: 1, dotSpin: 880,
          dotGlow: interp([0, 0.2, 0.6], [0.5, 1.2, 0.4], E.easeOutCubic)(p) };
      }
      this._apply(v);
    }
  }

  if (!customElements.get('veedeeoh-ident')) customElements.define('veedeeoh-ident', VeedeeohIdent);
})();
