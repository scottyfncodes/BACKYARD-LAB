import RAPIER from '@dimforge/rapier3d-compat';
import { Quaternion, Vector3 } from 'three';
import { MATERIALS, type MaterialId } from '../data/materials';
import type { ShapeDef } from '../data/parts';
import type { SolidDef } from '../data/world';
import { DEG, shapeLocalPose, type Pose } from './geom';

export type R = typeof RAPIER;
export type RigidBody = RAPIER.RigidBody;
export type Collider = RAPIER.Collider;
export type ImpulseJoint = RAPIER.ImpulseJoint;

let ready: Promise<void> | null = null;

/** Rapier ships as WASM; call once before creating a Physics. */
export function initPhysics(): Promise<void> {
  if (!ready) {
    ready = (async () => {
      // rapier-compat logs a harmless deprecation warning about init params.
      const warn = console.warn;
      console.warn = () => {};
      try {
        await RAPIER.init();
      } finally {
        console.warn = warn;
      }
    })();
  }
  return ready;
}

export { RAPIER };

export const GROUP = { STATIC: 1, DYNAMIC: 2, PLAYER: 4, CARRIED: 8 } as const;
export const groups = (member: number, filter: number) => ((member & 0xffff) << 16) | (filter & 0xffff);
export const G_STATIC = groups(GROUP.STATIC, 0xffff);
export const G_DYNAMIC = groups(GROUP.DYNAMIC, GROUP.STATIC | GROUP.DYNAMIC | GROUP.PLAYER | GROUP.CARRIED);
export const G_CARRIED = groups(GROUP.CARRIED, GROUP.STATIC | GROUP.DYNAMIC);
export const G_PLAYER = groups(GROUP.PLAYER, GROUP.STATIC | GROUP.DYNAMIC);

export type Owner =
  | { kind: 'static'; id?: string }
  | { kind: 'item'; id: number }
  | { kind: 'machine'; id: number }
  | { kind: 'player' };

export interface ColliderTag {
  owner: Owner;
  part?: number; // blueprint uid for machine colliders
  mat: MaterialId;
  bounce?: number;
}

export interface Impact {
  pos: Vector3;
  matA: MaterialId;
  matB: MaterialId;
  impulse: number;
  ownerA: Owner;
  ownerB: Owner;
}

export const DT = 1 / 120;

export const toV = (v: { x: number; y: number; z: number }) => new Vector3(v.x, v.y, v.z);
export const toQ = (q: { x: number; y: number; z: number; w: number }) => new Quaternion(q.x, q.y, q.z, q.w);

export class Physics {
  world: RAPIER.World;
  queue: RAPIER.EventQueue;
  tags = new Map<number, ColliderTag>();
  /** Sum of contact force magnitudes per collider for the last step. */
  contactSum = new Map<number, number>();
  /** Contact partners with force for the last step. */
  partners = new Map<number, Map<number, number>>();
  impacts: Impact[] = [];
  private prevPairs = new Map<string, number>();
  staticByName = new Map<string, Collider>();

  constructor() {
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = DT;
    this.world.numSolverIterations = 8;
    this.queue = new RAPIER.EventQueue(true);
  }

  free() {
    this.world.free();
    this.queue.free();
  }

  tag(c: Collider): ColliderTag | undefined {
    return this.tags.get(c.handle);
  }

  addSolid(s: SolidDef): Collider {
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    let desc: RAPIER.ColliderDesc;
    const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), (s.rotY ?? 0) * DEG);
    if (s.kind === 'box') {
      desc = RAPIER.ColliderDesc.cuboid(s.half![0], s.half![1], s.half![2]).setTranslation(s.pos[0], s.pos[1], s.pos[2]);
    } else {
      desc = RAPIER.ColliderDesc.cylinder(s.h! / 2, s.r!).setTranslation(s.pos[0], s.pos[1] + s.h! / 2, s.pos[2]);
    }
    desc.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w });
    const m = MATERIALS[s.mat];
    desc.setFriction(m.friction).setRestitution(m.restitution).setCollisionGroups(G_STATIC);
    const c = this.world.createCollider(desc, body);
    this.tags.set(c.handle, { owner: { kind: 'static', id: s.id }, mat: s.mat });
    if (s.id) this.staticByName.set(s.id, c);
    return c;
  }

  removeCollider(c: Collider) {
    this.tags.delete(c.handle);
    this.world.removeCollider(c, true);
  }

  /** Make a collider description for a part shape positioned at `at` within its body. */
  shapeDesc(s: ShapeDef, at: Pose, mass: number, mat: MaterialId): RAPIER.ColliderDesc {
    let desc: RAPIER.ColliderDesc;
    const local = shapeLocalPose(s);
    const q = at.q.clone().multiply(local.q);
    if (s.kind === 'box') desc = RAPIER.ColliderDesc.cuboid(s.half![0], s.half![1], s.half![2]);
    else if (s.kind === 'ball') desc = RAPIER.ColliderDesc.ball(s.r!);
    else {
      desc = RAPIER.ColliderDesc.cylinder(s.halfH!, s.r!);
      const ax = s.axis ?? 'y';
      if (ax === 'x') q.multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 2));
      if (ax === 'z') q.multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 2));
    }
    const p = local.p.clone().applyQuaternion(at.q).add(at.p);
    desc.setTranslation(p.x, p.y, p.z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w });
    const m = MATERIALS[mat];
    desc.setMass(Math.max(0.005, mass)).setFriction(m.friction).setRestitution(m.restitution);
    if (mat === 'bouncy') desc.setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Max);
    if (mat === 'roller') desc.setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min);
    desc.setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS).setContactForceEventThreshold(0.5);
    return desc;
  }

  step() {
    this.world.step(this.queue);
    this.contactSum.clear();
    this.partners.clear();
    this.impacts.length = 0;
    const seen = new Map<string, number>();
    this.queue.drainContactForceEvents((ev) => {
      const h1 = ev.collider1();
      const h2 = ev.collider2();
      const f = ev.totalForceMagnitude();
      this.contactSum.set(h1, (this.contactSum.get(h1) ?? 0) + f);
      this.contactSum.set(h2, (this.contactSum.get(h2) ?? 0) + f);
      if (!this.partners.has(h1)) this.partners.set(h1, new Map());
      if (!this.partners.has(h2)) this.partners.set(h2, new Map());
      this.partners.get(h1)!.set(h2, f);
      this.partners.get(h2)!.set(h1, f);
      const key = h1 < h2 ? `${h1}:${h2}` : `${h2}:${h1}`;
      seen.set(key, f);
      const prev = this.prevPairs.get(key);
      const impulse = f * DT;
      // A new contact (or a sudden spike) is an impact worth hearing / seeing.
      if ((prev === undefined && impulse > 0.25) || (prev !== undefined && f > prev * 4 && impulse > 1.5)) {
        const ta = this.tags.get(h1);
        const tb = this.tags.get(h2);
        if (ta && tb) {
          const ca = this.world.getCollider(h1);
          const cb = this.world.getCollider(h2);
          const dyn = ta.owner.kind === 'static' ? cb : ca;
          if (dyn) {
            this.impacts.push({ pos: toV(dyn.translation()), matA: ta.mat, matB: tb.mat, impulse, ownerA: ta.owner, ownerB: tb.owner });
          }
        }
      }
    });
    this.prevPairs = seen;
  }

  /** First hit along a ray, with the collider's tag. */
  raycast(from: Vector3, dir: Vector3, maxDist: number, filterGroups?: number, exclude?: RigidBody, predicate?: (c: Collider) => boolean) {
    const ray = new RAPIER.Ray({ x: from.x, y: from.y, z: from.z }, { x: dir.x, y: dir.y, z: dir.z });
    const hit = this.world.castRayAndGetNormal(ray, maxDist, true, undefined, filterGroups, undefined, exclude, predicate);
    if (!hit) return null;
    const point = from.clone().add(dir.clone().multiplyScalar(hit.timeOfImpact));
    return { collider: hit.collider, tag: this.tags.get(hit.collider.handle), point, normal: toV(hit.normal), dist: hit.timeOfImpact };
  }

  /** Is the straight line between a and b blocked by static scenery? */
  blockedByStatic(a: Vector3, b: Vector3): boolean {
    const d = b.clone().sub(a);
    const len = d.length();
    if (len < 1e-4) return false;
    const hit = this.raycast(a, d.divideScalar(len), len, groups(0xffff, GROUP.STATIC));
    return !!hit && hit.dist < len - 0.02;
  }

  /** Keep a point at least `radius` away from static geometry (rope particles). */
  pushOutOfStatic(p: Vector3, radius = 0.012): boolean {
    const proj = this.world.projectPoint({ x: p.x, y: p.y, z: p.z }, false, undefined, groups(0xffff, GROUP.STATIC));
    if (!proj) return false;
    const sp = toV(proj.point);
    const d = p.clone().sub(sp);
    const dist = d.length();
    if (!proj.isInside && dist >= radius) return false;
    if (dist < 1e-6) {
      p.y = sp.y + radius;
      return true;
    }
    const n = proj.isInside ? d.negate().divideScalar(dist) : d.divideScalar(dist);
    p.copy(sp.addScaledVector(n, radius));
    return true;
  }
}
