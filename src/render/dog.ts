import * as THREE from 'three';
import { EAST_FENCE_X, WORLD } from '../data/world';
import { M } from './materials';

/**
 * Biscuit, the family dog. Purely for life and company: he has no collider and
 * never touches the simulation, so he can't change how a machine behaves. He
 * trots after the kid, chases anything that moves fast, barks at things that go
 * over the fence, loves being petted and goes bananas when something works.
 */
export interface Mover {
  pos: THREE.Vector3;
  speed: number;
}

export interface DogContext {
  kid: THREE.Vector3;
  movers: Mover[];
}

type State = 'follow' | 'sniff' | 'sit' | 'chase' | 'barkAt' | 'happy' | 'party' | 'goto';

const YARD = { x0: -13.5, x1: EAST_FENCE_X - 0.45, z0: -6.2, z1: 13.5 };
const RADIUS = 0.32;

interface Box {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

/** Everything in the yard a dog can't walk through, from the world data. */
function obstacles(): Box[] {
  const out: Box[] = [];
  for (const s of WORLD.solids) {
    if (s.vis === 'ground' || s.vis === 'gate') continue;
    if (s.kind === 'cyl') {
      const r = (s.r ?? 0) + RADIUS;
      out.push({ x0: s.pos[0] - r, x1: s.pos[0] + r, z0: s.pos[2] - r, z1: s.pos[2] + r });
      continue;
    }
    const h = s.half!;
    const bottom = s.pos[1] - h[1];
    const top = s.pos[1] + h[1];
    if (top < 0.25 || bottom > 0.5) continue;
    out.push({ x0: s.pos[0] - h[0] - RADIUS, x1: s.pos[0] + h[0] + RADIUS, z0: s.pos[2] - h[2] - RADIUS, z1: s.pos[2] + h[2] + RADIUS });
  }
  return out;
}

const clampYard = (p: THREE.Vector3) => {
  p.x = THREE.MathUtils.clamp(p.x, YARD.x0, YARD.x1);
  p.z = THREE.MathUtils.clamp(p.z, YARD.z0, YARD.z1);
  return p;
};

export class Dog {
  group = new THREE.Group();
  pos = new THREE.Vector3(2, 0, -2);
  heading = 0;
  state: State = 'follow';
  /** Called whenever Biscuit barks (the game plays the sound). */
  onBark: (at: THREE.Vector3) => void = () => {};
  /** Frozen in place (during replays). */
  paused = false;
  /** Somewhere Biscuit likes to hang around in this project (by the shed, say). */
  home: THREE.Vector3 | null = null;

  private boxes = obstacles();
  private target = new THREE.Vector3();
  private stateT = 0;
  private speed = 0;
  private gait = 0;
  private wag = 0;
  private sitAmt = 0;
  private barkT = 0;
  private barksLeft = 0;
  private chaseCooldown = 0;
  private hop = 0;
  private lookAt: THREE.Vector3 | null = null;
  /** Told to sit and stay (the cold open): no wandering off after the kid. */
  private stay = false;
  private body = new THREE.Group();
  private head = new THREE.Group();
  private tail = new THREE.Group();
  private legs: THREE.Group[] = [];
  private ears: THREE.Mesh[] = [];
  private mouth!: THREE.Mesh;

  constructor(scene: THREE.Scene) {
    const fur = M.matte(0xd8a35a);
    const dark = M.matte(0x8a5a2b);
    const cream = M.matte(0xf3dcb0);
    const box = (w: number, hgt: number, d: number, m: THREE.Material, x = 0, y = 0, z = 0, parent: THREE.Object3D = this.body) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, hgt, d), m);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      parent.add(mesh);
      return mesh;
    };
    // Body runs along +z (his nose points +z).
    box(0.26, 0.22, 0.52, fur, 0, 0.36, 0);
    box(0.2, 0.1, 0.36, cream, 0, 0.27, 0.02);
    box(0.27, 0.05, 0.06, M.plastic(0xd8352a), 0, 0.46, 0.25);
    // Head on a neck pivot so it can look around and bob.
    this.head.position.set(0, 0.5, 0.28);
    box(0.22, 0.2, 0.22, fur, 0, 0.04, 0.06, this.head);
    box(0.13, 0.1, 0.14, cream, 0, -0.01, 0.22, this.head);
    box(0.06, 0.05, 0.04, M.matte(0x221a14), 0, 0.03, 0.3, this.head);
    this.mouth = box(0.1, 0.03, 0.08, M.matte(0x9a3a3a), 0, -0.06, 0.22, this.head);
    this.mouth.visible = false;
    for (const s of [-1, 1]) {
      box(0.035, 0.035, 0.02, M.matte(0x221a14), s * 0.06, 0.08, 0.17, this.head);
      const ear = box(0.06, 0.14, 0.1, dark, s * 0.125, 0.03, 0.03, this.head);
      ear.geometry.translate(0, -0.05, 0);
      ear.position.y += 0.08;
      this.ears.push(ear);
    }
    this.body.add(this.head);
    // Tail on a pivot at the rump.
    this.tail.position.set(0, 0.44, -0.26);
    const t = box(0.05, 0.05, 0.22, fur, 0, 0, -0.1, this.tail);
    t.rotation.x = 0.5;
    this.body.add(this.tail);
    // Legs pivot at the hip/shoulder.
    for (const [x, z] of [
      [-0.09, 0.19],
      [0.09, 0.19],
      [-0.09, -0.19],
      [0.09, -0.19],
    ]) {
      const leg = new THREE.Group();
      leg.position.set(x, 0.3, z);
      box(0.07, 0.3, 0.07, fur, 0, -0.15, 0, leg);
      box(0.08, 0.04, 0.1, cream, 0, -0.28, 0.015, leg);
      this.legs.push(leg);
      this.body.add(leg);
    }
    this.group.add(this.body);
    this.group.position.copy(this.pos);
    scene.add(this.group);
  }

  /** Put him somewhere right now. */
  place(p: THREE.Vector3, heading = this.heading) {
    this.pos.copy(clampYard(p.clone().setY(0)));
    this.heading = heading;
    this.state = 'follow';
    this.stateT = 0;
    this.stay = false;
    this.lookAt = null;
    this.group.position.copy(this.pos);
  }

  /** Sit still somewhere and watch (the cold open). */
  sitAt(p: THREE.Vector3, look: THREE.Vector3) {
    this.place(p, Math.atan2(look.x - p.x, look.z - p.z));
    this.state = 'sit';
    this.stateT = 0;
    this.lookAt = look.clone();
    this.stay = true;
  }

  bark(n = 2) {
    if (this.barksLeft > 0) return;
    this.barksLeft = n;
    this.barkT = 0;
  }

  /** Run toward something interesting and bark at it. */
  chase(p: THREE.Vector3) {
    this.stay = false;
    this.state = 'chase';
    this.stateT = 0;
    this.target.copy(clampYard(p.clone()));
  }

  /** A pat on the head. */
  pet() {
    this.state = 'happy';
    this.stateT = 0;
    this.hop = 1;
    this.bark(1);
  }

  /** IT WORKED: run to the kid and spin in circles. */
  party() {
    this.state = 'party';
    this.stateT = 0;
    this.bark(3);
  }

  near(p: THREE.Vector3, r: number) {
    return Math.hypot(p.x - this.pos.x, p.z - this.pos.z) < r;
  }

  get headPos() {
    return this.pos.clone().setY(0.6);
  }

  private moveToward(goal: THREE.Vector3, maxSpeed: number, dt: number, stopAt = 0.3) {
    const d = goal.clone().sub(this.pos).setY(0);
    const dist = d.length();
    const want = dist > stopAt ? Math.min(maxSpeed, dist * 2.2) : 0;
    this.speed += (want - this.speed) * Math.min(1, dt * 5);
    if (dist > 0.05) {
      const h = Math.atan2(d.x, d.z);
      let dh = h - this.heading;
      dh = Math.atan2(Math.sin(dh), Math.cos(dh));
      this.heading += dh * Math.min(1, dt * 7);
    }
    const step = new THREE.Vector3(Math.sin(this.heading), 0, Math.cos(this.heading)).multiplyScalar(this.speed * dt);
    this.pos.add(step);
    this.collide();
    return dist;
  }

  private collide() {
    clampYard(this.pos);
    for (const b of this.boxes) {
      const p = this.pos;
      if (p.x <= b.x0 || p.x >= b.x1 || p.z <= b.z0 || p.z >= b.z1) continue;
      const dx0 = p.x - b.x0;
      const dx1 = b.x1 - p.x;
      const dz0 = p.z - b.z0;
      const dz1 = b.z1 - p.z;
      const m = Math.min(dx0, dx1, dz0, dz1);
      if (m === dx0) p.x = b.x0;
      else if (m === dx1) p.x = b.x1;
      else if (m === dz0) p.z = b.z0;
      else p.z = b.z1;
    }
  }

  update(dt: number, time: number, c: DogContext) {
    if (this.paused) return;
    this.stateT += dt;
    this.chaseCooldown -= dt;
    const kid = c.kid.clone().setY(0);
    const kidDist = Math.hypot(kid.x - this.pos.x, kid.z - this.pos.z);

    // Anything zooming around the yard is the best thing that ever happened.
    if (!this.stay && this.chaseCooldown <= 0 && (this.state === 'follow' || this.state === 'sniff' || this.state === 'sit')) {
      let best: Mover | null = null;
      for (const m of c.movers) {
        if (m.speed < 3 || m.pos.distanceTo(this.pos) > 16) continue;
        if (!best || m.speed > best.speed) best = m;
      }
      if (best) {
        this.chase(best.pos);
        this.bark(2);
      }
    }

    let moving = false;
    switch (this.state) {
      case 'follow': {
        // Hang around near the kid (or near his favourite spot), never underfoot.
        const anchor = this.home && kidDist < 14 ? this.home : kid;
        const want = anchor === kid ? 2.4 : 0.8;
        const dist = Math.hypot(anchor.x - this.pos.x, anchor.z - this.pos.z);
        if (dist > want + 2.2 || (dist > want && this.speed > 0.2)) {
          this.moveToward(anchor, dist > 7 ? 5 : 2.6, dt, want);
          moving = true;
        } else {
          this.speed *= 0.8;
          if (this.stateT > 3 + Math.random() * 4) {
            this.stateT = 0;
            if (Math.random() < 0.5) {
              this.state = 'sniff';
              const a = Math.random() * Math.PI * 2;
              this.target.copy(anchor).add(new THREE.Vector3(Math.cos(a) * 2.5, 0, Math.sin(a) * 2.5));
              clampYard(this.target);
            } else this.state = 'sit';
          }
          this.lookAt = kid.clone().setY(1.2);
        }
        break;
      }
      case 'sniff': {
        const d = this.moveToward(this.target, 1.4, dt, 0.25);
        moving = d > 0.3;
        if (!moving || this.stateT > 6) {
          this.state = 'follow';
          this.stateT = 0;
        }
        this.lookAt = null;
        break;
      }
      case 'sit': {
        this.speed *= 0.8;
        if (this.stay) break;
        if (this.stateT > 5 + Math.random() * 3 && !this.lookAt) this.state = 'follow';
        if (kidDist > 6 && this.stateT > 1.5) {
          this.state = 'follow';
          this.lookAt = null;
        }
        break;
      }
      case 'chase': {
        // Follow the thing as it moves; stop at the fence and bark at whatever went over.
        const m = c.movers.reduce<Mover | null>((b, x) => (x.pos.distanceTo(this.target) < 2.5 && (!b || x.speed > b.speed) ? x : b), null);
        if (m) {
          this.target.copy(m.pos).setY(0);
          if (m.pos.x > EAST_FENCE_X) {
            this.target.x = YARD.x1;
            this.state = 'barkAt';
            this.stateT = 0;
          }
          clampYard(this.target);
        }
        const d = this.moveToward(this.target, 6, dt, 0.6);
        moving = d > 0.6;
        this.lookAt = this.target.clone().setY(0.3);
        if ((!moving && this.stateT > 0.8) || this.stateT > 7) {
          this.state = 'sniff';
          this.stateT = 0;
          this.chaseCooldown = 4;
          this.target.copy(this.pos);
        }
        break;
      }
      case 'barkAt': {
        const d = this.moveToward(this.target, 6, dt, 0.4);
        moving = d > 0.4;
        this.lookAt = this.target.clone().setX(this.target.x + 4).setY(1.2);
        if (!moving && this.barksLeft === 0 && this.stateT < 5) this.bark(2);
        if (this.stateT > 5.5) {
          this.state = 'follow';
          this.stateT = 0;
          this.chaseCooldown = 5;
        }
        break;
      }
      case 'happy': {
        this.speed *= 0.7;
        this.lookAt = kid.clone().setY(1.3);
        if (this.stateT > 2.4) this.state = 'follow';
        break;
      }
      case 'party': {
        // Run to the kid, then tear around them in circles.
        if (kidDist > 2 && this.stateT < 2.5) {
          this.moveToward(kid, 6, dt, 1.5);
          moving = true;
        } else {
          const a = time * 4.5;
          this.target.copy(kid).add(new THREE.Vector3(Math.cos(a) * 1.4, 0, Math.sin(a) * 1.4));
          this.moveToward(this.target, 5.5, dt, 0.05);
          moving = true;
          if (Math.random() < dt * 1.2) this.hop = 1;
        }
        this.lookAt = null;
        if (this.stateT > 5.5) {
          this.state = 'follow';
          this.stateT = 0;
        }
        break;
      }
      case 'goto': {
        moving = this.moveToward(this.target, 3, dt, 0.3) > 0.3;
        if (!moving) this.state = 'follow';
        break;
      }
    }
    if (!moving) this.speed *= Math.max(0, 1 - dt * 6);

    // Barking: a little lunge and an open mouth.
    if (this.barksLeft > 0) {
      this.barkT -= dt;
      if (this.barkT <= 0) {
        this.barksLeft--;
        this.barkT = 0.32;
        this.onBark(this.headPos);
        this.mouth.visible = true;
      }
    }
    if (this.barkT < 0.18) this.mouth.visible = false;

    this.animate(dt, time, moving);
  }

  private animate(dt: number, time: number, moving: boolean) {
    this.group.position.copy(this.pos);
    this.group.rotation.y = this.heading;
    const sitting = this.state === 'sit' || (this.state === 'barkAt' && this.speed < 0.3) || (this.state === 'follow' && this.speed < 0.15 && this.stateT > 1.5);
    this.sitAmt += ((sitting ? 1 : 0) - this.sitAmt) * Math.min(1, dt * 4);
    // Gait: legs swing faster and wider the faster he goes.
    this.gait += dt * (4 + this.speed * 3.2);
    const swing = moving ? Math.min(0.9, 0.25 + this.speed * 0.14) : 0;
    this.legs.forEach((l, i) => {
      const phase = i === 0 || i === 3 ? 0 : Math.PI;
      l.rotation.x = Math.sin(this.gait + phase) * swing;
    });
    // Sitting: rump down, front up.
    this.body.rotation.x = -this.sitAmt * 0.45;
    this.body.position.y = -this.sitAmt * 0.08 + (moving ? Math.abs(Math.sin(this.gait)) * 0.03 * Math.min(1, this.speed) : 0);
    this.legs[2].rotation.x += this.sitAmt * 1.1;
    this.legs[3].rotation.x += this.sitAmt * 1.1;
    // Hops (happy, party).
    if (this.hop > 0) {
      this.hop = Math.max(0, this.hop - dt * 2.6);
      this.body.position.y += Math.sin(this.hop * Math.PI) * 0.22;
    }
    // Tail: always going, faster when excited.
    const excited = this.state === 'happy' || this.state === 'party' || this.state === 'chase' || this.barksLeft > 0;
    this.wag += dt * (excited ? 22 : 9);
    this.tail.rotation.y = Math.sin(this.wag) * (excited ? 0.7 : 0.4);
    this.tail.rotation.x = -0.3 - (excited ? 0.3 : 0);
    // Head: look at what matters, with a little bob; ears flop with speed.
    let yaw = 0;
    let pitch = 0;
    if (this.lookAt) {
      const d = this.lookAt.clone().sub(this.headPos);
      yaw = Math.atan2(d.x, d.z) - this.heading;
      yaw = THREE.MathUtils.clamp(Math.atan2(Math.sin(yaw), Math.cos(yaw)), -1.1, 1.1);
      pitch = THREE.MathUtils.clamp(-Math.atan2(d.y, Math.hypot(d.x, d.z)), -0.6, 0.5);
    } else if (this.state === 'sniff') pitch = 0.5 + Math.sin(time * 9) * 0.06;
    this.head.rotation.y += (yaw - this.head.rotation.y) * Math.min(1, dt * 6);
    this.head.rotation.x += (pitch + this.sitAmt * 0.4 - this.head.rotation.x) * Math.min(1, dt * 6);
    if (this.barksLeft > 0 && this.barkT > 0.18) this.head.rotation.x -= 0.15;
    for (const [i, e] of this.ears.entries()) e.rotation.z = (i ? -1 : 1) * (0.15 + Math.min(0.6, this.speed * 0.1) + Math.sin(this.gait * 2) * 0.05 * Math.min(1, this.speed));
  }
}
