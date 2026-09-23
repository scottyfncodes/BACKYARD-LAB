import * as THREE from 'three';

export type CamMode = 'eyes' | 'chase' | 'wide' | 'free' | 'bench' | 'intro';

export interface CamContext {
  eye: THREE.Vector3;
  yaw: number;
  pitch: number;
  subject: THREE.Vector3 | null;
  subjectVel: THREE.Vector3;
  heading: THREE.Vector3 | null;
  focus: THREE.Vector3 | null;
}

const ease = (t: number) => t * t * (3 - 2 * t);

/**
 * First person by default; cinematic pull-backs to watch machines work.
 * Mode changes blend smoothly instead of cutting like a debug view.
 */
export class CameraDirector {
  mode: CamMode = 'eyes';
  private from = { p: new THREE.Vector3(), q: new THREE.Quaternion() };
  private blend = 1;
  private blendTime = 0.9;
  private chasePos = new THREE.Vector3();
  private chaseLook = new THREE.Vector3();
  orbit = { yaw: 0.8, pitch: 0.55, dist: 6, center: new THREE.Vector3() };
  intro = { p: new THREE.Vector3(), look: new THREE.Vector3() };
  private lastHeading = new THREE.Vector3(0, 0, 1);

  constructor(public camera: THREE.PerspectiveCamera) {}

  set(mode: CamMode, instant = false, time = 0.9) {
    if (mode === this.mode && !instant) return;
    this.from.p.copy(this.camera.position);
    this.from.q.copy(this.camera.quaternion);
    this.mode = mode;
    this.blend = instant ? 1 : 0;
    this.blendTime = time;
    if (mode === 'chase') this.chasePos.copy(this.camera.position);
  }

  get blending() {
    return this.blend < 1;
  }

  private lookQuat(pos: THREE.Vector3, at: THREE.Vector3): THREE.Quaternion {
    const m = new THREE.Matrix4().lookAt(pos, at, new THREE.Vector3(0, 1, 0));
    return new THREE.Quaternion().setFromRotationMatrix(m);
  }

  update(dt: number, c: CamContext) {
    let p = new THREE.Vector3();
    let q = new THREE.Quaternion();
    const subject = c.subject ?? c.eye;
    switch (this.mode) {
      case 'eyes': {
        p.copy(c.eye);
        q.setFromEuler(new THREE.Euler(c.pitch, c.yaw, 0, 'YXZ'));
        break;
      }
      case 'chase': {
        const h = c.heading ?? (c.subjectVel.lengthSq() > 0.3 ? c.subjectVel.clone().setY(0).normalize() : this.lastHeading);
        if (h.lengthSq() > 0.01) this.lastHeading.lerp(h, Math.min(1, dt * 2)).normalize();
        const want = subject.clone().addScaledVector(this.lastHeading, -3.2).add(new THREE.Vector3(0, 1.7, 0));
        want.y = Math.max(want.y, 0.6);
        const k = 1 - Math.exp(-dt * 4);
        this.chasePos.lerp(want, k);
        this.chaseLook.lerp(subject.clone().add(new THREE.Vector3(0, 0.3, 0)), 1 - Math.exp(-dt * 8));
        p.copy(this.chasePos);
        q = this.lookQuat(p, this.chaseLook);
        break;
      }
      case 'wide': {
        const f = c.focus ?? subject;
        const mid = subject.clone().lerp(f, 0.5);
        const span = Math.max(6, subject.distanceTo(f) * 1.3);
        const dir = c.eye.clone().sub(mid).setY(0);
        if (dir.lengthSq() < 0.01) dir.set(-1, 0, -1);
        dir.normalize();
        p.copy(mid).addScaledVector(dir, span).add(new THREE.Vector3(0, span * 0.55 + 1.5, 0));
        this.chaseLook.lerp(mid, 1 - Math.exp(-dt * 3));
        q = this.lookQuat(p, this.chaseLook.lengthSq() ? this.chaseLook : mid);
        break;
      }
      case 'free':
      case 'bench': {
        const o = this.orbit;
        if (this.mode === 'free') o.center.lerp(subject, 1 - Math.exp(-dt * 3));
        p = new THREE.Vector3(Math.sin(o.yaw) * Math.cos(o.pitch), Math.sin(o.pitch), Math.cos(o.yaw) * Math.cos(o.pitch)).multiplyScalar(o.dist).add(o.center);
        p.y = Math.max(p.y, 0.25);
        q = this.lookQuat(p, o.center);
        break;
      }
      case 'intro': {
        p.copy(this.intro.p);
        q = this.lookQuat(p, this.intro.look);
        break;
      }
    }
    if (this.blend < 1) {
      this.blend = Math.min(1, this.blend + dt / this.blendTime);
      const e = ease(this.blend);
      p = this.from.p.clone().lerp(p, e);
      q = this.from.q.clone().slerp(q, e);
    }
    this.camera.position.copy(p);
    this.camera.quaternion.copy(q);
  }
}
