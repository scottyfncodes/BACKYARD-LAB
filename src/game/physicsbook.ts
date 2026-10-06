import { CHAPTERS, CHAPTER_MAP, distanceTravelled, heightAt, heightFromEnergy, LATER_CHAPTERS, lever, projectilePeak, projectileRange, slide, speedAfter, speedFromEnergy, springEnergy, trajectory, type ChapterDef, type ChapterId } from '../data/physics101';
import { btn, h, type Modal } from '../ui/dom';

/**
 * PHYSICS 101, the book. A worn textbook with Mom's notes in the margins.
 * Each chapter is one page: the idea in plain words, a little experiment with
 * sliders, and a sentence that says what the sliders just did. It is a tool,
 * not a lesson: the kid opens it because something didn't work.
 */
export interface BookHost {
  modal: Modal;
  book: { found: boolean; read: string[] };
  onChange(): void;
  play(sound: string): void;
}

const NS = 'http://www.w3.org/2000/svg';
type SvgChild = Node | string | null | undefined | false;

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, unknown> = {}, ...children: SvgChild[]): SVGElementTagNameMap[K] {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null && v !== false) el.setAttribute(k, String(v));
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

const f1 = (x: number) => (Math.abs(x) >= 10 ? x.toFixed(0) : x.toFixed(1));

interface Slider {
  el: HTMLElement;
  get(): number;
}

function slider(label: string, min: number, max: number, step: number, value: number, unit: (v: number) => string, onInput: () => void): Slider {
  const input = h('input', { type: 'range', min: String(min), max: String(max), step: String(step), value: String(value) }) as HTMLInputElement;
  const out = h('b', {}, unit(value));
  input.addEventListener('input', () => {
    out.textContent = unit(Number(input.value));
    onInput();
  });
  input.addEventListener('pointerdown', (e) => e.stopPropagation());
  const el = h('label', { class: 'book-slider' }, h('span', {}, label, out), input);
  return { el, get: () => Number(input.value) };
}

/** One experiment: builds its DOM, redraws on slider changes, and may animate. */
interface Experiment {
  el: HTMLElement;
  tick?(dt: number): void;
}

const INK = '#2f2418';
const PENCIL = '#5b6b8a';
const RED = '#c8443a';
const BLUE = '#2a7fd0';
const GREEN = '#3a9a5a';

/** Diagram paper: a wide, short SVG that scales to the card. */
function paper(w: number, hgt: number): SVGSVGElement {
  return svg('svg', { viewBox: `0 0 ${w} ${hgt}`, class: 'book-fig', preserveAspectRatio: 'xMidYMid meet' });
}

function arrow(x1: number, y1: number, x2: number, y2: number, color: string, label?: string): SVGGElement {
  const g = svg('g');
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (len < 2) return g;
  const ux = dx / len;
  const uy = dy / len;
  const hx = x2 - ux * 9;
  const hy = y2 - uy * 9;
  g.append(svg('line', { x1, y1, x2: hx, y2: hy, stroke: color, 'stroke-width': 3, 'stroke-linecap': 'round' }));
  g.append(svg('polygon', { points: `${x2},${y2} ${hx - uy * 5},${hy + ux * 5} ${hx + uy * 5},${hy - ux * 5}`, fill: color }));
  if (label) g.append(svg('text', { x: (x1 + x2) / 2 + uy * -12, y: (y1 + y2) / 2 + ux * 12 + 4, fill: color, 'font-size': 11, 'font-weight': 800, 'text-anchor': 'middle' }, label));
  return g;
}

// ------------------------------------------------------------------ experiments

function motionExperiment(): Experiment {
  const W = 340;
  const H = 110;
  const fig = paper(W, H);
  const caption = h('p', { class: 'book-caption' });
  const scale = (W - 40) / 30; // 30 m across
  let t = 0;
  const T = 4;
  const ball = svg('circle', { r: 9, fill: RED, stroke: INK, 'stroke-width': 2 });
  const ghost = svg('g');
  const draw = () => {
    fig.replaceChildren();
    fig.append(svg('line', { x1: 20, y1: 80, x2: W - 20, y2: 80, stroke: INK, 'stroke-width': 2 }));
    for (let m = 0; m <= 30; m += 5) {
      fig.append(svg('line', { x1: 20 + m * scale, y1: 76, x2: 20 + m * scale, y2: 86, stroke: INK, 'stroke-width': 2 }));
      fig.append(svg('text', { x: 20 + m * scale, y: 100, 'font-size': 11, fill: PENCIL, 'text-anchor': 'middle', 'font-weight': 800 }, `${m} m`));
    }
    fig.append(ghost, ball);
  };
  const speed = slider('Start speed', 0, 6, 0.5, 3, (v) => `${f1(v)} m/s`, () => update());
  const accel = slider('Speeding up / slowing down', -2, 3, 0.5, 0, (v) => (v === 0 ? 'steady' : `${v > 0 ? '+' : ''}${f1(v)} m/s each second`), () => update());
  const update = () => {
    const v0 = speed.get();
    const a = accel.get();
    const stopT = a < 0 ? v0 / -a : Infinity;
    const tEnd = Math.min(T, stopT);
    const d = Math.min(30, distanceTravelled(v0, a, tEnd));
    const v = speedAfter(v0, a, tEnd);
    // Pencil marks: where it is after each second.
    ghost.replaceChildren();
    for (let s = 1; s <= Math.floor(tEnd); s++) {
      const x = 20 + Math.min(30, distanceTravelled(v0, a, s)) * scale;
      ghost.append(svg('circle', { cx: x, cy: 80, r: 4, fill: 'none', stroke: PENCIL, 'stroke-width': 2, 'stroke-dasharray': '3 2' }));
      ghost.append(svg('text', { x, y: 64, 'font-size': 10, fill: PENCIL, 'text-anchor': 'middle', 'font-weight': 800 }, `${s}s`));
    }
    if (a === 0) caption.textContent = v0 === 0 ? 'Speed zero. It sits there, however long you wait.' : `At ${f1(v0)} m/s, steady, it covers ${f1(d)} m in ${f1(tEnd)} seconds. Same gap every second.`;
    else if (a > 0) caption.textContent = `Speeding up ${f1(a)} m/s every second: after ${f1(tEnd)} s it is doing ${f1(v)} m/s and has gone ${f1(d)} m. The gaps grow.`;
    else if (stopT < T) caption.textContent = `Slowing down ${f1(-a)} m/s every second: it stops after ${f1(stopT)} s, ${f1(d)} m along. The gaps shrink.`;
    else caption.textContent = `Slowing down ${f1(-a)} m/s every second: after ${f1(T)} s it is only doing ${f1(v)} m/s. It went ${f1(d)} m.`;
    t = 0;
  };
  draw();
  update();
  return {
    el: h('div', {}, fig, caption, speed.el, accel.el),
    tick(dt) {
      t = (t + dt) % (T + 0.8);
      const v0 = speed.get();
      const a = accel.get();
      const stopT = a < 0 ? v0 / -a : Infinity;
      const tt = Math.min(t, T, stopT);
      ball.setAttribute('cx', String(20 + Math.min(30, distanceTravelled(v0, a, tt)) * scale));
      ball.setAttribute('cy', '70');
    },
  };
}

function forcesExperiment(): Experiment {
  const W = 340;
  const H = 150;
  const fig = paper(W, H);
  const caption = h('p', { class: 'book-caption' });
  let grip = 0.6;
  let x = 0;
  let v = 0;
  const crate = svg('g');
  const arrows = svg('g');
  const push = slider('Push', 0, 120, 5, 40, (n) => `${n} N`, () => update());
  const mass = slider('How heavy', 1, 20, 1, 5, (m) => `${m} kg`, () => update());
  const surfaces: [string, number][] = [
    ['🧊 ice', 0.05],
    ['🌱 grass', 0.6],
    ['🧶 carpet', 0.9],
  ];
  const surfaceRow = h('div', { class: 'book-choices' });
  const renderSurfaces = () => {
    surfaceRow.replaceChildren(
      ...surfaces.map(([label, g]) =>
        btn(label, () => {
          grip = g;
          renderSurfaces();
          update();
        }, `small ${grip === g ? 'on' : ''}`),
      ),
    );
  };
  const update = () => {
    const r = slide(push.get(), mass.get(), grip);
    const name = surfaces.find((s) => s[1] === grip)![0].slice(2);
    caption.textContent = r.moves
      ? `Push ${push.get()} N. The ${name} fights back with ${f1(r.friction)} N of friction. ${f1(push.get() - r.friction)} N is left over, so it slides, picking up ${f1(r.accel)} m/s every second.`
      : push.get() === 0
        ? `No push. Gravity pulls it down with ${f1(r.weight)} N and the ground pushes back just as hard. It sits.`
        : `Push ${push.get()} N. Friction on ${name} can hold up to ${f1(grip * r.weight)} N, so it matches your push exactly. It doesn’t budge.`;
    x = 0;
    v = 0;
  };
  renderSurfaces();
  fig.append(svg('line', { x1: 10, y1: 110, x2: W - 10, y2: 110, stroke: INK, 'stroke-width': 3 }), crate, arrows);
  update();
  return {
    el: h('div', {}, fig, caption, push.el, mass.el, surfaceRow),
    tick(dt) {
      const r = slide(push.get(), mass.get(), grip);
      if (r.moves) {
        v += r.accel * dt;
        x += v * dt * 18;
        if (x > W - 120) {
          x = 0;
          v = 0;
        }
      }
      const size = 26 + mass.get() * 1.6;
      const cx = 60 + x;
      const cy = 110 - size / 2;
      crate.replaceChildren(svg('rect', { x: cx - size / 2, y: 110 - size, width: size, height: size, fill: '#c9a26a', stroke: INK, 'stroke-width': 2, rx: 3 }));
      arrows.replaceChildren();
      if (push.get() > 0) arrows.append(arrow(cx + size / 2 + 4, cy, cx + size / 2 + 4 + push.get() * 0.9, cy, BLUE, 'push'));
      if (r.friction > 0) arrows.append(arrow(cx - size / 2 - 4, cy, cx - size / 2 - 4 - r.friction * 0.9, cy, RED, 'friction'));
      // Weight pulls from the middle; drawn from the crate's underside so the label stays clear of it.
      arrows.append(arrow(cx, 112, cx, 118 + r.weight * 0.18, GREEN, 'weight'));
    },
  };
}

function leversExperiment(): Experiment {
  const W = 340;
  const H = 150;
  const fig = paper(W, H);
  const caption = h('p', { class: 'book-caption' });
  const L = 1.2; // plank length, m
  const px = (m: number) => 30 + (m / L) * (W - 60);
  const fulcrum = slider('Where the pivot sits (from the load end)', 0.15, 1.05, 0.05, 0.3, (m) => `${f1(m)} m`, () => update());
  const load = slider('The load', 1, 12, 1, 5, (kg) => `${kg} kg`, () => update());
  const push = slider('Your push on the far end', 5, 100, 5, 30, (n) => `${n} N`, () => update());
  let tilt = 0;
  let want = 0;
  const plank = svg('g');
  const update = () => {
    const f = fulcrum.get();
    const r = lever(push.get(), L - f, load.get(), f);
    want = r.lifts ? -1 : r.pushTorque < r.loadTorque * 0.999 ? 1 : 0;
    const adv = r.advantage;
    caption.textContent = `${push.get()} N pushing ${f1(L - f)} m from the pivot makes ${f1(r.pushTorque)} N·m of turn. The ${load.get()} kg load, ${f1(f)} m out, pushes back with ${f1(r.loadTorque)} N·m. ${
      r.lifts ? `It lifts! Your push counts ${f1(adv)}× here.` : `Not enough: you need ${f1(r.pushNeeded)} N. Move the pivot closer to the load, or push harder.`
    }`;
  };
  update();
  fig.append(svg('line', { x1: 10, y1: 130, x2: W - 10, y2: 130, stroke: INK, 'stroke-width': 3 }), plank);
  return {
    el: h('div', {}, fig, caption, fulcrum.el, load.el, push.el),
    tick(dt) {
      tilt += (want * 14 - tilt) * Math.min(1, dt * 4);
      const f = fulcrum.get();
      const fx = px(f);
      plank.replaceChildren();
      plank.append(svg('polygon', { points: `${fx - 14},130 ${fx + 14},130 ${fx},104`, fill: '#8a7a66', stroke: INK, 'stroke-width': 2 }));
      const g = svg('g', { transform: `rotate(${tilt} ${fx} 104)` });
      g.append(svg('rect', { x: px(0), y: 100, width: px(L) - px(0), height: 8, fill: '#c9a26a', stroke: INK, 'stroke-width': 2, rx: 2 }));
      const size = 14 + load.get() * 2;
      g.append(svg('rect', { x: px(0) + 2, y: 100 - size, width: size, height: size, fill: '#7a7f86', stroke: INK, 'stroke-width': 2, rx: 3 }));
      g.append(svg('text', { x: px(0) + 2 + size / 2, y: 100 - size - 5, 'font-size': 11, fill: PENCIL, 'font-weight': 800, 'text-anchor': 'middle' }, `${load.get()} kg`));
      g.append(arrow(px(L) - 6, 100 - 10 - push.get() * 0.5, px(L) - 6, 98, BLUE, `${push.get()} N`));
      plank.append(g);
      plank.append(svg('text', { x: fx, y: 146, 'font-size': 11, fill: PENCIL, 'font-weight': 800, 'text-anchor': 'middle' }, 'pivot'));
    },
  };
}

function projectileExperiment(): Experiment {
  const W = 340;
  const H = 170;
  const fig = paper(W, H);
  const caption = h('p', { class: 'book-caption' });
  const FENCE_X = 9.1;
  const FENCE_H = 2.1;
  const reach = 16; // m across
  const sx = (m: number) => 24 + (m / reach) * (W - 40);
  const sy = (m: number) => 140 - m * ((W - 40) / reach);
  const speed = slider('Launch speed', 2, 16, 0.5, 8, (v) => `${f1(v)} m/s`, () => update());
  const angle = slider('Launch angle', 5, 85, 5, 45, (a) => `${a}°`, () => update());
  const grav = slider('Gravity', 2, 20, 0.5, 9.8, (g) => (Math.abs(g - 9.8) < 0.3 ? '9.8 (Earth)' : g < 9.8 ? `${f1(g)} (lighter)` : `${f1(g)} (heavier)`), () => update());
  const path = svg('polyline', { fill: 'none', stroke: RED, 'stroke-width': 3, 'stroke-dasharray': '6 4', 'stroke-linejoin': 'round' });
  const ball = svg('circle', { r: 6, fill: RED, stroke: INK, 'stroke-width': 2 });
  const marks = svg('g');
  let pts: { x: number; y: number }[] = [];
  let t = 0;
  const update = () => {
    const v = speed.get();
    const a = angle.get();
    const g = grav.get();
    pts = trajectory(v, a, g);
    path.setAttribute('points', pts.map((p) => `${sx(p.x)},${sy(p.y)}`).join(' '));
    const range = projectileRange(v, a, g);
    const peak = projectilePeak(v, a, g);
    const atFence = heightAt(v, a, FENCE_X, g);
    marks.replaceChildren(
      svg('line', { x1: sx(range), y1: 134, x2: sx(range), y2: 146, stroke: RED, 'stroke-width': 3 }),
      svg('text', { x: sx(Math.min(range, reach - 1)), y: 160, 'font-size': 11, fill: RED, 'font-weight': 800, 'text-anchor': 'middle' }, `${f1(range)} m`),
    );
    let verdict: string;
    if (range < FENCE_X) verdict = `The fence is ${FENCE_X} m away: ${f1(FENCE_X - range)} m short.`;
    else if (atFence !== null && atFence < FENCE_H) verdict = `It reaches the fence, but only ${f1(atFence)} m up. Thunk: it hits the fence.`;
    else verdict = `It clears the ${FENCE_H} m fence with ${f1((atFence ?? 0) - FENCE_H)} m to spare!`;
    caption.textContent = `${f1(v)} m/s at ${a}°: lands ${f1(range)} m away, tops out at ${f1(peak)} m. ${verdict}`;
    t = 0;
  };
  fig.append(
    svg('line', { x1: 10, y1: 140, x2: W - 10, y2: 140, stroke: INK, 'stroke-width': 3 }),
    svg('rect', { x: sx(FENCE_X) - 3, y: sy(FENCE_H), width: 6, height: 140 - sy(FENCE_H), fill: '#c9a26a', stroke: INK, 'stroke-width': 2 }),
    svg('text', { x: sx(FENCE_X), y: sy(FENCE_H) - 6, 'font-size': 11, fill: PENCIL, 'font-weight': 800, 'text-anchor': 'middle' }, 'fence'),
    ...[5, 10, 15].map((m) => svg('text', { x: sx(m), y: 154, 'font-size': 10, fill: PENCIL, 'font-weight': 800, 'text-anchor': 'middle' }, `${m} m`)),
    path,
    marks,
    ball,
  );
  update();
  return {
    el: h('div', {}, fig, caption, speed.el, angle.el, grav.el),
    tick(dt) {
      if (!pts.length) return;
      t = (t + dt * 0.7) % 1.6;
      const i = Math.min(pts.length - 1, Math.floor((Math.min(1, t) * pts.length) / 1));
      const p = pts[i];
      ball.setAttribute('cx', String(sx(p.x)));
      ball.setAttribute('cy', String(sy(p.y)));
    },
  };
}

function energyExperiment(): Experiment {
  const W = 340;
  const H = 150;
  const fig = paper(W, H);
  const caption = h('p', { class: 'book-caption' });
  const K = 400; // bungee stiffness, N/m
  const stretch = slider('Stretch the bungee', 0, 50, 5, 30, (cm) => `${cm} cm`, () => update());
  const mass = slider('What it launches', 0.2, 3, 0.2, 0.4, (kg) => `${f1(kg)} kg`, () => update());
  const bars = svg('g');
  const ball = svg('circle', { r: 7, fill: RED, stroke: INK, 'stroke-width': 2 });
  let t = 0;
  let E = 0;
  let v = 0;
  let hgt = 0;
  const update = () => {
    E = springEnergy(K, stretch.get() / 100);
    v = speedFromEnergy(E, mass.get());
    hgt = heightFromEnergy(E, mass.get());
    const bar = (i: number, label: string, frac: number, color: string, text: string) => {
      const x = 30 + i * 105;
      const hb = Math.max(2, Math.min(1, frac) * 80);
      bars.append(
        svg('rect', { x, y: 110 - hb, width: 44, height: hb, fill: color, stroke: INK, 'stroke-width': 2, rx: 4 }),
        svg('text', { x: x + 22, y: 126, 'font-size': 11, fill: PENCIL, 'font-weight': 800, 'text-anchor': 'middle' }, label),
        svg('text', { x: x + 22, y: 104 - hb, 'font-size': 12, fill: INK, 'font-weight': 900, 'text-anchor': 'middle' }, text),
      );
      if (i < 2) bars.append(arrow(x + 52, 70, x + 98, 70, PENCIL));
    };
    bars.replaceChildren();
    bar(0, 'stored', E / 50, '#f0b429', `${f1(E)} J`);
    bar(1, 'moving', E / 50, BLUE, `${f1(v)} m/s`);
    bar(2, 'lifted', Math.min(1, hgt / 12), GREEN, `${f1(hgt)} m up`);
    caption.textContent =
      E === 0
        ? 'No stretch, nothing stored. Let go and… nothing. Energy has to come from somewhere.'
        : `Stretching ${stretch.get()} cm stores ${f1(E)} J. Let go and it all becomes moving energy: the ${f1(mass.get())} kg thing leaves at ${f1(v)} m/s. Fired straight up, that is ${f1(hgt)} m of climb before gravity has it all back.`;
    t = 0;
  };
  fig.append(bars, ball);
  update();
  return {
    el: h('div', {}, fig, caption, stretch.el, mass.el),
    tick(dt) {
      t = (t + dt) % 2.4;
      const u = Math.min(1, t / 1.6);
      const y = 110 - Math.sin(u * Math.PI) * Math.min(1, hgt / 12) * 80;
      ball.setAttribute('cx', String(30 + 2 * 105 + 22 + 30));
      ball.setAttribute('cy', String(y));
      ball.setAttribute('opacity', E === 0 ? '0.2' : '1');
    },
  };
}

const EXPERIMENTS: Record<ChapterId, () => Experiment> = {
  motion: motionExperiment,
  forces: forcesExperiment,
  levers: leversExperiment,
  projectile: projectileExperiment,
  energy: energyExperiment,
};

// ------------------------------------------------------------------ the book

export class PhysicsBook {
  private experiment: Experiment | null = null;
  private raf = 0;
  private last = 0;
  constructor(private host: BookHost) {}

  /** Open the book: at the contents, or straight at a chapter (from a test result, say). */
  open(chapter: ChapterId | null = null, onClose: () => void = () => this.host.modal.hide()) {
    if (!this.host.book.found) {
      this.host.book.found = true;
      this.host.onChange();
    }
    if (chapter) this.showChapter(CHAPTER_MAP[chapter], onClose);
    else this.showContents(onClose);
  }

  private close(onClose: () => void) {
    this.stopAnim();
    onClose();
  }

  private showContents(onClose: () => void) {
    this.stopAnim();
    const read = this.host.book.read;
    const rows = CHAPTERS.map((c) =>
      btn(
        `<span class="book-ch"><b>${c.n}. ${c.title}</b><small>${c.useFor}</small></span><span class="book-tick">${read.includes(c.id) ? '✓' : ''}</span>`,
        () => this.showChapter(c, onClose),
        'book-row',
      ),
    );
    const later = LATER_CHAPTERS.map((c) => h('div', { class: 'book-later' }, h('b', {}, c.title), h('small', {}, c.useFor)));
    this.host.modal.show(
      [
        h('div', { class: 'book-cover' }, h('div', { class: 'book-title' }, 'PHYSICS 101'), h('div', { class: 'book-sub' }, 'Mom’s old college textbook.'), h('div', { class: 'book-sticky' }, 'Probably boring.', h('br'), 'Probably useful.')),
        h('div', { class: 'label' }, 'CONTENTS'),
        h('div', { class: 'book-toc' }, ...rows),
        h('div', { class: 'label' }, 'FURTHER IN · pages stuck together, for now'),
        h('div', { class: 'book-toc later' }, ...later),
        h('p', { class: 'book-note' }, '“Don’t read it cover to cover. Open it when something doesn’t work and you want to know why.” — Mom, on a sticky note inside the cover'),
        h('div', { class: 'row' }, btn('Put it back', () => this.close(onClose), 'go')),
      ],
      'book',
    );
  }

  private showChapter(c: ChapterDef, onClose: () => void) {
    this.stopAnim();
    if (!this.host.book.read.includes(c.id)) {
      this.host.book.read.push(c.id);
      this.host.onChange();
    }
    this.host.play('ui');
    const exp = EXPERIMENTS[c.id]();
    this.experiment = exp;
    const i = CHAPTERS.indexOf(c);
    const prev = CHAPTERS[i - 1];
    const next = CHAPTERS[i + 1];
    const math = h('details', { class: 'book-math' }, h('summary', {}, 'The math, if you want it'), ...c.math.map((m) => h('div', { class: 'book-formula' }, h('code', {}, m.formula), h('small', {}, m.plain))));
    math.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.host.modal.show(
      [
        h('div', { class: 'book-head' }, h('span', { class: 'muted' }, `PHYSICS 101 · CHAPTER ${c.n}`), btn('✕', () => this.close(onClose), 'small round close')),
        h('h2', { class: 'book-h' }, c.title),
        h('p', { class: 'book-idea' }, c.idea),
        h('div', { class: 'label' }, '✏️ TRY IT: CHANGE SOMETHING AND WATCH'),
        h('div', { class: 'book-lab' }, exp.el),
        h('div', { class: 'book-words' }, ...c.words.map((w) => h('div', {}, h('b', {}, w.term), ' — ', w.plain))),
        h('div', { class: 'book-margin' }, c.momsNote),
        h('p', { class: 'book-try' }, `🔧 ${c.tryIt}`),
        math,
        h(
          'div',
          { class: 'row' },
          btn('📖 Contents', () => this.showContents(onClose), 'small'),
          prev ? btn(`◀ ${prev.title}`, () => this.showChapter(prev, onClose), 'small') : null,
          next ? btn(`${next.title} ▶`, () => this.showChapter(next, onClose), 'small') : null,
          btn('Back to it', () => this.close(onClose), 'go'),
        ),
      ],
      'book',
    );
    this.startAnim();
  }

  private startAnim() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - this.last) / 1000);
      this.last = now;
      if (this.experiment?.tick && this.host.modal.open) this.experiment.tick(dt);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  private stopAnim() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.experiment = null;
  }
}
