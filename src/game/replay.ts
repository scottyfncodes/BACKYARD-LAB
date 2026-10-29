import * as THREE from 'three';
import type { WorldView } from '../render/views';
import type { SimEvent } from '../sim/events';

interface Frame {
  t: number;
  tr: Map<string, Float32Array>;
  ropes: Map<string, Float32Array>;
}

const RATE = 1 / 30;
const MAX_SECONDS = 30;

/** The events worth hearing again in a replay (no pickups or discoveries). */
const REPLAYED = new Set<SimEvent['type']>(['impact', 'break', 'snap', 'stick', 'unstick', 'suck', 'unsnag', 'ignite', 'ding', 'bounce', 'brownout']);

/**
 * A rolling recording of every moving transform (the last 30 seconds), plus
 * the sounds that went with them, so any moment can be watched again.
 */
export class Replay {
  frames: Frame[] = [];
  events: { t: number; e: SimEvent }[] = [];
  recording = false;
  playing = false;
  speed = 1;
  /** Recording clock: seconds since start(). */
  t = 0;
  playT = 0;
  from = 0;
  to = 0;
  private acc = 0;
  private evAt = 0;

  start() {
    this.frames = [];
    this.events = [];
    this.recording = true;
    this.acc = 0;
    this.t = 0;
  }

  stop() {
    this.recording = false;
  }

  get first() {
    return this.frames.length ? this.frames[0].t : 0;
  }

  get last() {
    return this.frames.length ? this.frames[this.frames.length - 1].t : 0;
  }

  get duration() {
    return this.to - this.from;
  }

  get available() {
    return this.frames.length > 10;
  }

  record(view: WorldView, dt: number) {
    if (!this.recording) return;
    this.t += dt;
    this.acc += dt;
    if (this.acc < RATE) return;
    this.acc = 0;
    const tr = new Map<string, Float32Array>();
    view.transforms((k, o) => tr.set(k, new Float32Array([o.position.x, o.position.y, o.position.z, o.quaternion.x, o.quaternion.y, o.quaternion.z, o.quaternion.w])));
    const ropes = new Map<string, Float32Array>();
    view.ropes((k, _v, pts) => {
      const a = new Float32Array(pts.length * 3);
      pts.forEach((p, i) => a.set([p.x, p.y, p.z], i * 3));
      ropes.set(k, a);
    });
    this.frames.push({ t: this.t, tr, ropes });
    // Rolling window: forget anything older than MAX_SECONDS.
    while (this.frames.length && this.frames[0].t < this.t - MAX_SECONDS) this.frames.shift();
    while (this.events.length && this.events[0].t < this.t - MAX_SECONDS) this.events.shift();
  }

  /** Remember a sound-making event at the current recording time. */
  event(e: SimEvent) {
    if (this.recording && REPLAYED.has(e.type)) this.events.push({ t: this.t, e });
  }

  /** Play [from, to] of the recording (clamped to what is still there). */
  play(speed = 1, from = this.first, to = this.last) {
    if (!this.available) return false;
    this.from = Math.max(from, this.first);
    this.to = Math.min(to, this.last);
    if (this.to - this.from < 0.3) return false;
    this.playing = true;
    this.playT = this.from;
    this.speed = speed;
    this.evAt = this.events.findIndex((x) => x.t >= this.from);
    if (this.evAt < 0) this.evAt = this.events.length;
    return true;
  }

  stopPlay() {
    this.playing = false;
  }

  private frameIndex(t: number) {
    // Binary search: the last frame at or before t.
    let lo = 0;
    let hi = this.frames.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.frames[mid].t <= t) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  /**
   * Apply the replay to the view and advance it. Returns the events that
   * happened in this slice (to be heard again), or null when finished.
   */
  update(view: WorldView, dt: number): SimEvent[] | null {
    if (!this.playing) return null;
    this.playT = Math.min(this.to, this.playT + dt * this.speed);
    this.apply(view, this.playT);
    const due: SimEvent[] = [];
    while (this.evAt < this.events.length && this.events[this.evAt].t <= this.playT) due.push(this.events[this.evAt++].e);
    if (this.playT >= this.to) this.playing = false;
    return due;
  }

  /** Show the world exactly as it was at time t. */
  apply(view: WorldView, t: number) {
    if (!this.frames.length) return;
    const i = this.frameIndex(t);
    const a = this.frames[i];
    const b = this.frames[i + 1] ?? a;
    const u = b.t > a.t ? THREE.MathUtils.clamp((t - a.t) / (b.t - a.t), 0, 1) : 0;
    const qa = new THREE.Quaternion();
    const qb = new THREE.Quaternion();
    view.transforms((k, o) => {
      const fa = a.tr.get(k);
      const fb = b.tr.get(k) ?? fa;
      if (!fa || !fb) return;
      o.position.set(fa[0] + (fb[0] - fa[0]) * u, fa[1] + (fb[1] - fa[1]) * u, fa[2] + (fb[2] - fa[2]) * u);
      qa.set(fa[3], fa[4], fa[5], fa[6]);
      qb.set(fb[3], fb[4], fb[5], fb[6]);
      o.quaternion.copy(qa.slerp(qb, u));
    });
    view.ropes((k, vis) => {
      const r = a.ropes.get(k);
      if (!r) return;
      const pts: THREE.Vector3[] = [];
      for (let j = 0; j < r.length; j += 3) pts.push(new THREE.Vector3(r[j], r[j + 1], r[j + 2]));
      vis.setPoints(pts);
    });
  }

  /** Where something was at time t (interpolated). */
  posAt(key: string, t: number): THREE.Vector3 | null {
    if (!this.frames.length) return null;
    const i = this.frameIndex(t);
    const a = this.frames[i].tr.get(key);
    const b = (this.frames[i + 1] ?? this.frames[i]).tr.get(key) ?? a;
    if (!a || !b) return null;
    const fa = this.frames[i];
    const fb = this.frames[i + 1] ?? fa;
    const u = fb.t > fa.t ? THREE.MathUtils.clamp((t - fa.t) / (fb.t - fa.t), 0, 1) : 0;
    return new THREE.Vector3(a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u);
  }

  /**
   * The thing most worth watching between from and to: whatever travelled
   * furthest (a machine part, a ball…), and the moment it was moving fastest.
   */
  highlight(from: number, to: number, prefer?: (key: string) => boolean): Highlight | null {
    const fs = this.frames.filter((f) => f.t >= from && f.t <= to);
    if (fs.length < 3) return null;
    const travel = new Map<string, number>();
    for (let i = 1; i < fs.length; i++) {
      for (const [k, b] of fs[i].tr) {
        const a = fs[i - 1].tr.get(k);
        if (!a) continue;
        const d = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
        // Teleports (respawns, resets) are not motion.
        if (d < 1.5) travel.set(k, (travel.get(k) ?? 0) + d);
      }
    }
    let key: string | null = null;
    let best = 0;
    for (const [k, d] of travel) {
      const score = d * (prefer?.(k) ? 4 : 1);
      if (score > best) {
        best = score;
        key = k;
      }
    }
    if (!key || best < 0.05) return null;
    let peak = fs[0].t;
    let top = -1;
    for (let i = 1; i < fs.length; i++) {
      const a = fs[i - 1].tr.get(key);
      const b = fs[i].tr.get(key);
      if (!a || !b) continue;
      const v = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) / Math.max(1e-3, fs[i].t - fs[i - 1].t);
      if (v < 45 && v > top) {
        top = v;
        peak = fs[i].t;
      }
    }
    return { key, from: fs[0].t, to: fs[fs.length - 1].t, peak, topSpeed: top };
  }
}

export interface Highlight {
  /** The transform key the camera follows. */
  key: string;
  from: number;
  to: number;
  /** When it was moving fastest: that's the slow-motion moment. */
  peak: number;
  topSpeed: number;
}

/** Playback speed through a highlight: full speed, easing into slow motion around the peak. */
export function highlightSpeed(t: number, peak: number, slow = 0.3, width = 0.8): number {
  const u = Math.min(1, Math.abs(t - peak) / width);
  const s = u * u * (3 - 2 * u);
  return slow + (1 - slow) * s;
}
