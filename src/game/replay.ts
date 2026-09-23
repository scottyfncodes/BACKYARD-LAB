import * as THREE from 'three';
import type { WorldView } from '../render/views';

interface Frame {
  t: number;
  tr: Map<string, Float32Array>;
  ropes: Map<string, Float32Array>;
}

const RATE = 1 / 30;
const MAX_SECONDS = 30;

/** Records every moving transform during a run so it can be watched again. */
export class Replay {
  frames: Frame[] = [];
  recording = false;
  playing = false;
  speed = 1;
  private acc = 0;
  private t = 0;
  playT = 0;

  start() {
    this.frames = [];
    this.recording = true;
    this.acc = 0;
    this.t = 0;
  }

  stop() {
    this.recording = false;
  }

  get duration() {
    return this.frames.length ? this.frames[this.frames.length - 1].t : 0;
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
    if (this.t > MAX_SECONDS) {
      this.recording = false;
      return;
    }
    const tr = new Map<string, Float32Array>();
    view.transforms((k, o) => tr.set(k, new Float32Array([o.position.x, o.position.y, o.position.z, o.quaternion.x, o.quaternion.y, o.quaternion.z, o.quaternion.w])));
    const ropes = new Map<string, Float32Array>();
    view.ropes((k, _v, pts) => {
      const a = new Float32Array(pts.length * 3);
      pts.forEach((p, i) => a.set([p.x, p.y, p.z], i * 3));
      ropes.set(k, a);
    });
    this.frames.push({ t: this.t, tr, ropes });
  }

  play(speed = 1) {
    if (!this.available) return false;
    this.playing = true;
    this.playT = 0;
    this.speed = speed;
    return true;
  }

  stopPlay() {
    this.playing = false;
  }

  /** Apply the replay to the view. Returns false when finished. */
  update(view: WorldView, dt: number): boolean {
    if (!this.playing) return false;
    this.playT += dt * this.speed;
    if (this.playT >= this.duration) {
      this.playing = false;
      return false;
    }
    let i = 0;
    while (i < this.frames.length - 2 && this.frames[i + 1].t < this.playT) i++;
    const a = this.frames[i];
    const b = this.frames[i + 1] ?? a;
    const u = b.t > a.t ? Math.min(1, (this.playT - a.t) / (b.t - a.t)) : 0;
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
    return true;
  }

  /** Where the action is at the current replay time (for the camera). */
  focusAt(key: string): THREE.Vector3 | null {
    if (!this.frames.length) return null;
    const f = this.frames.find((x) => x.t >= this.playT) ?? this.frames[this.frames.length - 1];
    const v = f.tr.get(key);
    return v ? new THREE.Vector3(v[0], v[1], v[2]) : null;
  }
}
