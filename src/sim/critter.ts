import { Vector3 } from 'three';
import { inZone } from '../data/world';
import type { SimEvent } from './events';
import { GROUP, groups, RAPIER, toV, type Physics, type RigidBody } from './physics';

/**
 * Biscuit, the neighbour's dog. A small living thing in the yard next door: he
 * naps by his house, wanders, and chases anything that moves over there. He is
 * never needed for anything, but he does get involved. Deterministic: his whims
 * come from a seeded generator, so the same run always plays out the same way.
 */
export interface CritterTarget {
  rb: RigidBody;
  /** true for a running machine (worth barking at), false for loose junk */
  machine: boolean;
}

export interface CritterHost {
  physics: Physics;
  emit(e: SimEvent): void;
  targets(): CritterTarget[];
  gateOpen: boolean;
}

export const DOG = {
  home: new Vector3(23.1, 0, -2.0),
  radius: 0.16,
  halfHeight: 0.12,
  mass: 8,
  walk: 1.3,
  run: 3.4,
  /** How fast something has to move to catch his eye. */
  interest: 1.2,
  sniff: 0.7,
  /** Machines are loud. He barks at those from a safe distance. */
  wary: 1.4,
};

/**
 * He bumps into the ground, the fences and the kid, and nothing else: a dog that could body-check
 * an RC car, or park himself in front of a ball being towed home, would turn a bit of life next
 * door into a way for a project to fail through no fault of the builder.
 */
const G_DOG = groups(GROUP.DYNAMIC, GROUP.STATIC | GROUP.PLAYER);

export class Critter {
  rb: RigidBody;
  state: 'nap' | 'wander' | 'chase' | 'sniff' = 'nap';
  yaw = Math.PI / 2;
  /** 0..1, how much he is bounding along (for the renderer). */
  gait = 0;
  private goal = DOG.home.clone();
  private timer = 3;
  private quarry: RigidBody | null = null;
  private quarryMachine = false;
  private seed: number;
  private barkT = 0;

  constructor(
    private host: CritterHost,
    seed = 7,
  ) {
    this.seed = seed;
    const desc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(DOG.home.x, DOG.halfHeight + DOG.radius + 0.02, DOG.home.z)
      .lockRotations()
      .setLinearDamping(0.5)
      .setCanSleep(false);
    this.rb = host.physics.world.createRigidBody(desc);
    const cd = RAPIER.ColliderDesc.capsule(DOG.halfHeight, DOG.radius).setMass(DOG.mass).setFriction(0.6).setRestitution(0).setCollisionGroups(G_DOG);
    const c = host.physics.world.createCollider(cd, this.rb);
    host.physics.tags.set(c.handle, { owner: { kind: 'dog' }, mat: 'fabric' });
  }

  private rand(): number {
    this.seed = (this.seed * 16807) % 2147483647;
    return (this.seed - 1) / 2147483646;
  }

  position(): Vector3 {
    return toV(this.rb.translation());
  }

  private pickWanderGoal(): Vector3 {
    // Mostly his own yard; through the open gate now and then to see what the kid is up to.
    const ours = this.host.gateOpen && this.rand() < 0.3;
    const x = ours ? 2 + this.rand() * 11 : 16.5 + this.rand() * 10;
    const z = ours ? -4 + this.rand() * 14 : -8 + this.rand() * 20;
    return new Vector3(x, 0, z);
  }

  /** The most exciting thing moving in his yard, if any. */
  private lookAround(): CritterTarget | null {
    const me = this.position();
    let best: { t: CritterTarget; score: number } | null = null;
    for (const t of this.host.targets()) {
      const p = toV(t.rb.translation());
      if (!inZone(p, 'neighbor_yard') || p.y > 2.5) continue;
      const speed = toV(t.rb.linvel()).length();
      if (speed < DOG.interest && !t.machine) continue;
      const d = me.distanceTo(p);
      if (d > 11) continue;
      const score = (t.machine ? 6 : 0) + speed - d * 0.3;
      if (!best || score > best.score) best = { t, score };
    }
    return best?.t ?? null;
  }

  step(dt: number) {
    const me = this.position();
    this.timer -= dt;
    this.barkT -= dt;
    // Something to chase beats everything except a fresh sniff. Once he is after something he
    // sees it through until he reaches it (or it gets away), even if it has stopped rolling.
    const committed = this.state === 'chase' && this.quarry?.isValid() && me.distanceTo(toV(this.quarry.translation())) < 6;
    if (!committed && (this.state !== 'sniff' || this.timer < 0)) {
      const q = this.lookAround();
      if (q && q.rb.isValid()) {
        if (this.state !== 'chase' || q.rb !== this.quarry) {
          this.quarry = q.rb;
          this.quarryMachine = q.machine;
          this.state = 'chase';
          this.bark(me);
        }
      } else if (this.state === 'chase') {
        this.state = 'sniff';
        this.timer = 1.5;
      }
    }
    if (this.state === 'nap' && this.timer < 0) {
      this.state = 'wander';
      this.goal = this.pickWanderGoal();
      this.timer = 4 + this.rand() * 5;
    } else if (this.state === 'wander' && this.timer < 0) {
      if (this.rand() < 0.35) {
        this.state = 'nap';
        this.goal = DOG.home.clone();
        this.timer = 6 + this.rand() * 8;
      } else {
        this.goal = this.pickWanderGoal();
        this.timer = 4 + this.rand() * 5;
      }
    } else if (this.state === 'sniff' && this.timer < 0) {
      this.state = 'wander';
      this.goal = this.pickWanderGoal();
      this.timer = 3 + this.rand() * 3;
    }

    let target: Vector3 | null = null;
    let speed = DOG.walk;
    if (this.state === 'chase' && this.quarry && this.quarry.isValid()) {
      target = toV(this.quarry.translation());
      speed = DOG.run;
      // Right up to a ball; a respectful distance from anything with a motor in it.
      if (me.distanceTo(target) < (this.quarryMachine ? DOG.wary : DOG.sniff)) {
        // Got there. Have a good sniff (or a good bark), then lose interest unless it moves again.
        this.state = 'sniff';
        this.timer = 2;
        target = null;
        if (this.barkT < 0) this.bark(me);
      }
    } else if (this.state === 'wander' || this.state === 'nap') {
      target = this.goal;
      if (me.distanceTo(new Vector3(target.x, me.y, target.z)) < 0.4) target = null;
    }

    const vel = toV(this.rb.linvel());
    let vx = 0;
    let vz = 0;
    if (target) {
      const d = new Vector3(target.x - me.x, 0, target.z - me.z);
      const len = d.length();
      if (len > 1e-3) {
        d.divideScalar(len);
        vx = d.x * speed;
        vz = d.z * speed;
        this.yaw = Math.atan2(d.x, d.z);
      }
    }
    // Ease toward the wanted velocity; gravity and bumps are the physics engine's business.
    const k = Math.min(1, dt * 8);
    this.rb.setLinvel({ x: vel.x + (vx - vel.x) * k, y: vel.y, z: vel.z + (vz - vel.z) * k }, true);
    const sp = Math.hypot(vx, vz);
    this.gait += ((sp > 0.1 ? sp / DOG.run : 0) - this.gait) * Math.min(1, dt * 6);
  }

  private bark(at: Vector3) {
    this.barkT = 1.2 + this.rand() * 1.5;
    this.host.emit({ type: 'bark', pos: at.clone() });
  }

  destroy() {
    this.host.physics.world.removeRigidBody(this.rb);
  }
}
