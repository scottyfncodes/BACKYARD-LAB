import { Euler, Quaternion, Vector3 } from 'three';
import { getPart, type PartDef, type V3 } from '../data/parts';
import type { ProjectDef } from '../data/projects';
import { inZone, WORLD, type SpawnDef } from '../data/world';
import type { Blueprint } from './blueprint';
import type { SimEvent } from './events';
import { wagonFrame, type WagonFrame } from './wagonbuild';
import { composePose, DEG, eulerDeg, invertPose, partArea, shapeVolume, transformPoint, v3, type Pose } from './geom';
import { criticalDamping, stableStiffness } from './links';
import { MachineInstance, type DynTarget, type MachineHost, type MachinePlacement, type RCInput } from './machine';
import { ObjectiveTracker, outOfBounds, type ObjectiveEvent, type WorldQuery } from './objectives';
import { DT, G_CARRIED, G_DYNAMIC, G_PLAYER, groups, GROUP, Physics, RAPIER, toQ, toV, type Collider, type Owner, type RigidBody } from './physics';

export interface Item {
  id: number;
  def: PartDef;
  rb: RigidBody;
  colliders: Collider[];
  tag?: string;
  spawn: SpawnDef;
  touched: boolean;
  snag?: { anchor: Vector3; local: Vector3; breakForce: number; over: number; tie?: boolean; rest?: number; peak?: number };
}

export interface SimInput {
  moveX: number; // strafe -1..1
  moveZ: number; // forward -1..1
  yaw: number; // radians, 0 = facing -Z
  pitch: number;
  jump: boolean;
  sprint: boolean;
  rc: RCInput;
}

export const emptyInput = (): SimInput => ({ moveX: 0, moveZ: 0, yaw: 0, pitch: 0, jump: false, sprint: false, rc: { throttle: 0, steer: 0, action: false } });

export const PLAYER = {
  radius: 0.22,
  halfHeight: 0.4,
  eye: 0.5, // above body centre
  mass: 30,
  walk: 3.4,
  run: 5.2,
  jump: 3.1,
  carryLimit: 26,
  strength: 320, // N the kid can hold with
};

/** A little red pull-along wagon for hauling junk back to the lab. */
export const WAGON = {
  half: [0.28, 0.16, 0.46] as V3, // bed collider; local -Z is the handle end
  mass: 9,
  capacity: 8,
  maxLoad: 60, // kg
  tow: 1.3, // handle length: kid centre to wagon centre
  maxSpeed: 7,
};

export interface Wagon {
  rb: RigidBody;
  collider: Collider;
  /** What's riding in the bed (taken out of the world, respawnable). */
  load: SpawnDef[];
  hitched: boolean;
  /** The kid's own design (Mission 0), or null for the little red wagon. */
  bp: Blueprint | null;
  frame: WagonFrame | null;
  /** Bed collider half extents; local -Z is the handle end. */
  half: V3;
  /** Handle length: kid centre to wagon centre. */
  tow: number;
}

export interface SimOptions {
  player?: boolean;
  /** Defaults to on whenever there is a player. */
  wagon?: boolean;
  /** A wagon the kid built, instead of the stock one. */
  wagonBp?: Blueprint | null;
  junk?: boolean;
  project?: ProjectDef | null;
  gateOpen?: boolean;
}

/**
 * The whole physical backyard, runnable headless (tests) or rendered (game).
 * Fixed 120 Hz steps; deterministic given the same inputs.
 */
export class Simulation implements MachineHost {
  physics: Physics;
  time = 0;
  items = new Map<number, Item>();
  machines = new Map<number, MachineInstance>();
  events: SimEvent[] = [];
  objective: ObjectiveTracker | null = null;
  objectiveEvents: ObjectiveEvent[] = [];
  projectTime = 0;
  player: RigidBody | null = null;
  playerCollider: Collider | null = null;
  yaw = 0;
  pitch = 0;
  grounded = false;
  groundTag: ReturnType<Physics['tag']> | undefined;
  private airVy = 0;
  private jumpHeld = 0;
  private wasGrounded = false;
  carried: { item: Item; dist: number; rel: Quaternion; age: number } | null = null;
  wagon: Wagon | null = null;
  gateOpen = false;
  /** Objectives only tick while the game says the project is live (not during intros). */
  objectivesPaused = false;
  private nextId = 1;
  private bodyOwner = new Map<number, Owner>();

  constructor(public opts: SimOptions = {}) {
    this.physics = new Physics();
    for (const s of WORLD.solids) this.physics.addSolid(s);
    if (opts.player !== false) this.createPlayer();
    if (opts.wagon ?? opts.player !== false) this.createWagon(opts.wagonBp ?? null);
    if (opts.junk !== false) for (const j of WORLD.junk) this.spawnItem(j);
    if (opts.project) this.startProject(opts.project);
    if (opts.gateOpen) this.openGate();
  }

  emit(e: SimEvent) {
    this.events.push(e);
  }

  drainEvents(): SimEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  // ---------------------------------------------------------------- items

  spawnItem(s: SpawnDef): Item {
    const def = getPart(s.part);
    const q = s.rot ? eulerDeg(s.rot) : new Quaternion().setFromEuler(new Euler(0, (s.rotY ?? 0) * DEG, 0));
    const desc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(s.pos[0], s.pos[1], s.pos[2])
      .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
      .setLinearDamping(def.linearDamping ?? 0.05)
      .setAngularDamping(def.angularDamping ?? 0.1)
      .setCcdEnabled(def.mass < 1.5);
    const rb = this.physics.world.createRigidBody(desc);
    const id = this.nextId++;
    const vols = def.shapes.map((sh) => sh.share ?? shapeVolume(sh));
    const total = vols.reduce((a, b) => a + b, 0);
    const colliders = def.shapes.map((sh, i) => {
      const mat = sh.mat ?? def.material;
      const cd = this.physics.shapeDesc(sh, { p: new Vector3(), q: new Quaternion() }, (def.mass * vols[i]) / total, mat).setCollisionGroups(G_DYNAMIC);
      const c = this.physics.world.createCollider(cd, rb);
      const bounce = def.behaviors.find((b) => b.type === 'bounce');
      this.physics.tags.set(c.handle, { owner: { kind: 'item', id }, mat, bounce: bounce && bounce.type === 'bounce' ? bounce.boost : undefined });
      return c;
    });
    const item: Item = { id, def, rb, colliders, tag: s.tag, spawn: s, touched: false };
    this.items.set(id, item);
    this.bodyOwner.set(rb.handle, { kind: 'item', id });
    if (s.tie) {
      const anchor = v3(s.tie);
      item.snag = { anchor, local: new Vector3(), breakForce: 60, over: 0, tie: true, rest: anchor.distanceTo(v3(s.pos)) };
    }
    return item;
  }

  removeItem(id: number) {
    const it = this.items.get(id);
    if (!it) return;
    if (this.carried?.item === it) this.carried = null;
    for (const c of it.colliders) this.physics.tags.delete(c.handle);
    this.bodyOwner.delete(it.rb.handle);
    this.physics.world.removeRigidBody(it.rb);
    this.items.delete(id);
  }

  itemByTag(tag: string): Item | undefined {
    for (const it of this.items.values()) if (it.tag === tag) return it;
    return undefined;
  }

  respawnItem(it: Item) {
    const s = it.spawn;
    if (this.carried?.item === it) this.carried = null;
    it.rb.setTranslation({ x: s.pos[0], y: s.pos[1], z: s.pos[2] }, true);
    it.rb.setLinvel({ x: 0, y: 0, z: 0 }, true);
    it.rb.setAngvel({ x: 0, y: 0, z: 0 }, true);
    const proj = this.objective?.project;
    const snag = proj?.snags?.find((x) => x.tag === it.tag);
    if (snag) this.snagItem(it, v3(snag.anchor), snag.breakForce);
  }

  private snagItem(it: Item, anchor: Vector3, breakForce: number) {
    const pose = { p: toV(it.rb.translation()), q: toQ(it.rb.rotation()) };
    it.snag = { anchor, local: transformPoint(invertPose(pose), anchor), breakForce, over: 0 };
  }

  // ---------------------------------------------------------------- project

  startProject(p: ProjectDef) {
    this.objective = new ObjectiveTracker(p);
    this.projectTime = 0;
    for (const s of p.props) {
      const it = this.spawnItem(s);
      const snag = p.snags?.find((x) => x.tag === s.tag);
      if (snag) this.snagItem(it, v3(snag.anchor), snag.breakForce);
    }
    if (!p.gateLocked) this.openGate();
  }

  openGate() {
    if (this.gateOpen) return;
    const c = this.physics.staticByName.get('gate');
    if (c) this.physics.removeCollider(c);
    this.gateOpen = true;
  }

  query(): WorldQuery {
    return {
      time: this.projectTime,
      pos: (tag) => {
        if (tag === 'player') return this.player ? toV(this.player.translation()) : null;
        if (tag === 'wagon') return this.wagon ? toV(this.wagon.rb.translation()) : null;
        const it = this.itemByTag(tag);
        return it ? toV(it.rb.translation()) : null;
      },
      speed: (tag) => {
        const it = this.itemByTag(tag);
        return it ? toV(it.rb.linvel()).length() : 0;
      },
      held: (tag) => this.carried?.item.tag === tag,
      touched: (tag) => !!this.itemByTag(tag)?.touched,
      snagged: (tag) => !!this.itemByTag(tag)?.snag,
      wagonLoad: () => this.wagon?.load.length ?? 0,
    };
  }

  // ---------------------------------------------------------------- machines

  addMachine(bp: Blueprint, placement: MachinePlacement): MachineInstance {
    const id = this.nextId++;
    const m = new MachineInstance(this, id, bp, placement);
    this.machines.set(id, m);
    this.refreshMachineOwners();
    return m;
  }

  removeMachine(id: number) {
    const m = this.machines.get(id);
    if (!m) return;
    m.destroy();
    this.machines.delete(id);
    this.refreshMachineOwners();
  }

  /** Put a machine back exactly where it was placed, frozen. */
  resetMachine(id: number): MachineInstance | null {
    const m = this.machines.get(id);
    if (!m) return null;
    const { bp, placement } = m;
    m.destroy();
    const fresh = new MachineInstance(this, id, bp, placement);
    this.machines.set(id, fresh);
    this.refreshMachineOwners();
    return fresh;
  }

  goAll() {
    for (const m of this.machines.values()) m.go();
    this.refreshMachineOwners();
  }

  private refreshMachineOwners() {
    for (const [h, o] of [...this.bodyOwner]) if (o.kind === 'machine') this.bodyOwner.delete(h);
    for (const m of this.machines.values()) for (const b of m.bodies) this.bodyOwner.set(b.rb.handle, { kind: 'machine', id: m.id });
  }

  ownerOfBody(rb: RigidBody): Owner | undefined {
    return this.bodyOwner.get(rb.handle);
  }

  dynamicTargets(): DynTarget[] {
    const out: DynTarget[] = [];
    for (const it of this.items.values()) out.push({ rb: it.rb, area: partArea(it.def), owner: { kind: 'item', id: it.id } });
    for (const m of this.machines.values()) {
      if (m.state !== 'running') continue;
      for (const b of m.bodies) out.push({ rb: b.rb, area: m.bodyArea(b.rb), owner: { kind: 'machine', id: m.id } });
    }
    return out;
  }

  // ---------------------------------------------------------------- player

  private createPlayer() {
    const sp = WORLD.playerSpawn;
    const rb = this.physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(sp.pos[0], sp.pos[1] + PLAYER.halfHeight + PLAYER.radius + 0.02, sp.pos[2])
        .lockRotations()
        .setLinearDamping(0)
        .setCcdEnabled(true)
        .setCanSleep(false),
    );
    const cd = RAPIER.ColliderDesc.capsule(PLAYER.halfHeight, PLAYER.radius)
      .setMass(PLAYER.mass)
      .setFriction(0)
      .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min)
      .setRestitution(0)
      .setCollisionGroups(G_PLAYER)
      .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
      .setContactForceEventThreshold(1);
    const c = this.physics.world.createCollider(cd, rb);
    this.physics.tags.set(c.handle, { owner: { kind: 'player' }, mat: 'player' });
    this.player = rb;
    this.playerCollider = c;
    this.yaw = (sp.yaw * Math.PI) / 180;
    this.bodyOwner.set(rb.handle, { kind: 'player' });
  }

  teleportPlayer(p: V3, yaw?: number) {
    if (!this.player) return;
    this.player.setTranslation({ x: p[0], y: p[1] + PLAYER.halfHeight + PLAYER.radius + 0.02, z: p[2] }, true);
    this.player.setLinvel({ x: 0, y: 0, z: 0 }, true);
    if (yaw !== undefined) this.yaw = yaw;
    // A wagon being pulled comes along, trailing behind.
    const w = this.wagon;
    if (w?.hitched) {
      const back = new Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw)).multiplyScalar(w.tow);
      const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), this.yaw);
      w.rb.setTranslation({ x: p[0] + back.x, y: p[1] + 0.01, z: p[2] + back.z }, true);
      w.rb.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true);
      w.rb.setLinvel({ x: 0, y: 0, z: 0 }, true);
    }
  }

  eye(): Vector3 {
    if (!this.player) return new Vector3(0, 1.1, 0);
    return toV(this.player.translation()).add(new Vector3(0, PLAYER.eye, 0));
  }

  look(): Vector3 {
    return new Vector3(0, 0, -1).applyEuler(new Euler(this.pitch, this.yaw, 0, 'YXZ'));
  }

  private stepPlayer(input: SimInput, dt: number) {
    const rb = this.player;
    if (!rb) return;
    this.yaw = input.yaw;
    this.pitch = input.pitch;
    const pos = toV(rb.translation());
    const vel = toV(rb.linvel());
    const footY = pos.y - PLAYER.halfHeight - PLAYER.radius;
    // Ground probe: a few rays so ledges and machine edges still count.
    let hit: ReturnType<Physics['raycast']> = null;
    for (const o of [[0, 0], [0.13, 0], [-0.13, 0], [0, 0.13], [0, -0.13]]) {
      const from = new Vector3(pos.x + o[0], pos.y, pos.z + o[1]);
      const h = this.physics.raycast(from, new Vector3(0, -1, 0), PLAYER.halfHeight + PLAYER.radius + 0.09, undefined, rb);
      if (h && (!hit || h.dist < hit.dist)) hit = h;
    }
    this.grounded = !!hit && vel.y < 1.5;
    this.groundTag = hit?.tag;
    if (this.grounded && !this.wasGrounded) {
      if (this.airVy < -2.5) this.emit({ type: 'land', pos: new Vector3(pos.x, footY, pos.z), speed: -this.airVy });
    }

    const carriedMass = this.carried?.item.def.mass ?? 0;
    // Rolling a load is a lot easier than lugging it.
    const towed = this.wagon?.hitched ? (WAGON.mass + this.wagonLoadMass()) * 0.2 : 0;
    const burden = Math.max(0.35, 1 - (carriedMass + towed) / 40);
    const speed = (input.sprint ? PLAYER.run : PLAYER.walk) * burden;
    const fwd = new Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const mv = new Vector3().addScaledVector(fwd, input.moveZ).addScaledVector(right, input.moveX);
    if (mv.lengthSq() > 1) mv.normalize();
    const desired = mv.multiplyScalar(speed);
    const accel = (this.grounded ? 28 : 7) * dt;
    const dv = new Vector3(desired.x - vel.x, 0, desired.z - vel.z);
    if (dv.length() > accel) dv.setLength(accel);
    let vy = vel.y;

    // Step-up assist for kerbs, deck edges and junk.
    if (this.grounded && desired.lengthSq() > 0.1) {
      const dir = desired.clone().normalize();
      // The wagon on the handle is never a step: walking into it shoves it along instead.
      const notWagon = (c: Collider) => !(this.wagon?.hitched && c.handle === this.wagon.collider.handle);
      const low = this.physics.raycast(new Vector3(pos.x, footY + 0.06, pos.z), dir, PLAYER.radius + 0.22, undefined, rb, notWagon);
      const high = this.physics.raycast(new Vector3(pos.x, footY + 0.42, pos.z), dir, PLAYER.radius + 0.3, undefined, rb, notWagon);
      if (low && !high && low.normal.y < 0.5) vy = Math.max(vy, 2.4);
    }

    if (input.jump) this.jumpHeld = 0.2;
    else this.jumpHeld = Math.max(0, this.jumpHeld - dt);
    const bounce = this.groundTag?.bounce;
    if (this.grounded && this.jumpHeld > 0) {
      if (bounce) {
        // Pumping a trampoline: time the jump with the bounce to go higher.
        const pumped = Math.min(8.5, Math.abs(Math.min(this.airVy, 0)) * 0.9 + bounce * 0.5 + 1.0);
        vy = Math.max(vy, pumped);
        this.emit({ type: 'bounce', pos: new Vector3(pos.x, footY, pos.z), speed: vy });
      } else {
        vy = PLAYER.jump;
        this.emit({ type: 'jump', pos });
      }
      this.jumpHeld = 0;
      this.grounded = false;
    }
    if (!this.grounded) this.airVy = vy;
    this.wasGrounded = this.grounded;
    rb.setLinvel({ x: vel.x + dv.x, y: vy, z: vel.z + dv.z }, true);

    // Touching an item counts (for the "hands off" bonus).
    if (this.playerCollider) {
      const partners = this.physics.partners.get(this.playerCollider.handle);
      if (partners) {
        for (const h of partners.keys()) {
          const t = this.physics.tags.get(h);
          if (t?.owner.kind === 'item') {
            const it = this.items.get(t.owner.id);
            if (it) it.touched = true;
          }
        }
      }
    }
  }

  // ---------------------------------------------------------------- carrying

  /** What the kid is looking at, within reach. */
  lookTarget(maxDist = 2.3): { kind: 'item'; item: Item; point: Vector3 } | { kind: 'machine'; machine: MachineInstance; point: Vector3 } | { kind: 'wagon'; point: Vector3 } | { kind: 'static'; id?: string; point: Vector3; normal: Vector3 } | null {
    if (!this.player) return null;
    const hit = this.physics.raycast(this.eye(), this.look(), maxDist, undefined, this.player, (c) => !(this.carried && c.parent()?.handle === this.carried.item.rb.handle));
    if (!hit || !hit.tag) return null;
    const o = hit.tag.owner;
    if (o.kind === 'item') return { kind: 'item', item: this.items.get(o.id)!, point: hit.point };
    if (o.kind === 'wagon') return { kind: 'wagon', point: hit.point };
    if (o.kind === 'machine') return { kind: 'machine', machine: this.machines.get(o.id)!, point: hit.point };
    if (o.kind === 'static') return { kind: 'static', id: o.id, point: hit.point, normal: hit.normal };
    return null;
  }

  pickUp(it: Item): { ok: boolean; reason?: string } {
    if (this.carried) return { ok: false, reason: 'Hands full' };
    if (it.def.mass > PLAYER.carryLimit) return { ok: false, reason: `Way too heavy (${Math.round(it.def.mass)} kg)` };
    it.touched = true;
    if (it.snag?.tie) it.snag = undefined;
    if (it.snag) return { ok: false, reason: 'It is stuck up there' };
    const rel = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), -this.yaw).multiply(toQ(it.rb.rotation()));
    const size = Math.max(...it.def.shapes.map((s) => (s.kind === 'box' ? Math.max(...s.half!) : s.kind === 'ball' ? s.r! : Math.max(s.r!, s.halfH!))));
    this.carried = { item: it, dist: 0.75 + size * 0.9, rel, age: 0 };
    for (const c of it.colliders) c.setCollisionGroups(G_CARRIED);
    it.rb.wakeUp();
    this.emit({ type: 'pickup', pos: toV(it.rb.translation()), part: it.def.id });
    return { ok: true };
  }

  drop(throwSpeed = 0) {
    const c = this.carried;
    if (!c) return;
    this.carried = null;
    for (const col of c.item.colliders) col.setCollisionGroups(G_DYNAMIC);
    const pos = toV(c.item.rb.translation());
    if (throwSpeed > 0) {
      const v = this.look().multiplyScalar(throwSpeed * Math.min(1, Math.sqrt(1 / Math.max(0.4, c.item.def.mass))));
      v.y += 1.2;
      const pv = this.player ? toV(this.player.linvel()) : new Vector3();
      c.item.rb.setLinvel({ x: v.x + pv.x, y: v.y + Math.max(0, pv.y), z: v.z + pv.z }, true);
      this.emit({ type: 'throw', pos, part: c.item.def.id });
    } else {
      this.emit({ type: 'drop', pos, part: c.item.def.id });
    }
  }

  private stepCarry(dt: number) {
    const c = this.carried;
    if (!c || !this.player) return;
    const rb = c.item.rb;
    const target = this.eye().add(this.look().multiplyScalar(c.dist));
    target.y = Math.max(target.y, 0.15);
    const p = toV(rb.worldCom());
    c.age += dt;
    if (c.age > 0.8 && p.distanceTo(target) > 2.2) {
      this.drop();
      return;
    }
    const m = rb.mass();
    const k = m * 90;
    const damp = criticalDamping(k, m, 1);
    const F = target.clone().sub(p).multiplyScalar(k).sub(toV(rb.linvel()).sub(toV(this.player.linvel())).multiplyScalar(damp));
    F.y += m * 9.81;
    if (F.length() > PLAYER.strength) F.setLength(PLAYER.strength);
    rb.resetForces(true);
    rb.resetTorques(true);
    rb.addForce({ x: F.x, y: F.y, z: F.z }, true);
    const want = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), this.yaw).multiply(c.rel);
    const cur = toQ(rb.rotation());
    const err = want.multiply(cur.clone().invert());
    if (err.w < 0) err.set(-err.x, -err.y, -err.z, -err.w);
    const angle = 2 * Math.acos(Math.min(1, err.w));
    const s = Math.sqrt(Math.max(1e-9, 1 - err.w * err.w));
    const axis = new Vector3(err.x / s, err.y / s, err.z / s);
    const w = angle > 1e-3 ? axis.multiplyScalar(Math.min(10, angle * 10)) : new Vector3();
    rb.setAngvel({ x: w.x, y: w.y, z: w.z }, true);
  }

  // ---------------------------------------------------------------- wagon

  private createWagon(bp: Blueprint | null = null, at: { pos: V3; yaw: number } = WORLD.wagon) {
    const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), at.yaw * DEG);
    const rb = this.physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(at.pos[0], at.pos[1] + 0.01, at.pos[2])
        .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
        .lockRotations()
        .setLinearDamping(1.5),
    );
    const frame = bp ? wagonFrame(bp) : null;
    const half: V3 = frame ? frame.half : WAGON.half;
    const [hx, hy, hz] = half;
    const mass = bp ? Math.max(WAGON.mass, bp.parts.reduce((m, p) => m + getPart(p.def).mass, 0)) : WAGON.mass;
    const cd = RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(0, hy, 0).setMass(mass).setFriction(0.5).setRestitution(0.05).setCollisionGroups(G_DYNAMIC);
    const collider = this.physics.world.createCollider(cd, rb);
    this.physics.tags.set(collider.handle, { owner: { kind: 'wagon' }, mat: bp ? 'wood' : 'metal' });
    this.bodyOwner.set(rb.handle, { kind: 'wagon' });
    this.wagon = { rb, collider, load: [], hitched: false, bp, frame, half, tow: frame?.tow ?? WAGON.tow };
  }

  /**
   * MISSION 0: the kid's own wagon rolls out of the lab. It is towed, loaded
   * and tipped exactly like the stock one; only its shape and looks are theirs.
   */
  addWagon(bp: Blueprint | null, at: { pos: V3; yaw: number } = WORLD.wagon): Wagon {
    this.removeWagon();
    this.createWagon(bp, at);
    return this.wagon!;
  }

  removeWagon() {
    const w = this.wagon;
    if (!w) return;
    this.physics.tags.delete(w.collider.handle);
    this.bodyOwner.delete(w.rb.handle);
    this.physics.world.removeRigidBody(w.rb);
    this.wagon = null;
  }

  resetWagon() {
    const w = this.wagon;
    if (!w) return;
    const s = WORLD.wagon;
    const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), s.yaw * DEG);
    w.hitched = false;
    w.rb.setTranslation({ x: s.pos[0], y: s.pos[1] + 0.01, z: s.pos[2] }, true);
    w.rb.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true);
    w.rb.setLinvel({ x: 0, y: 0, z: 0 }, true);
  }

  wagonLoadMass(): number {
    return this.wagon ? this.wagon.load.reduce((m, s) => m + getPart(s.part).mass, 0) : 0;
  }

  /** Horizontal distance from the kid to the wagon. */
  wagonDistance(): number {
    if (!this.wagon || !this.player) return Infinity;
    const a = this.player.translation();
    const b = this.wagon.rb.translation();
    return Math.hypot(a.x - b.x, a.z - b.z);
  }

  /** Why this item can't go in the wagon, or null if it can. */
  wagonRefusal(it: Item): string | null {
    const w = this.wagon;
    if (!w) return 'No wagon here';
    if (it.tag || !it.def.buildable) return `The ${it.def.name.toLowerCase()} stays out of the wagon`;
    if (it.def.mass > PLAYER.carryLimit) return `Too heavy to lift in (${Math.round(it.def.mass)} kg)`;
    if (it.snag && !it.snag.tie) return 'It is stuck up there';
    if (w.load.length >= WAGON.capacity) return 'The wagon is full';
    if (this.wagonLoadMass() + it.def.mass > WAGON.maxLoad) return 'The wagon would be too heavy';
    return null;
  }

  loadWagon(it: Item): { ok: boolean; reason?: string } {
    const reason = this.wagonRefusal(it);
    if (reason) return { ok: false, reason };
    it.touched = true;
    this.wagon!.load.push(it.spawn);
    const pos = toV(this.wagon!.rb.translation());
    this.removeItem(it.id);
    this.emit({ type: 'load', pos, part: it.def.id });
    return { ok: true };
  }

  /** Empty the wagon without putting anything back in the world (unloading into the lab). */
  emptyWagon(): SpawnDef[] {
    if (!this.wagon) return [];
    const load = this.wagon.load;
    this.wagon.load = [];
    return load;
  }

  /** Lift the last thing loaded out of the wagon and into the kid's hands. */
  takeFromWagon(): { ok: boolean; reason?: string } {
    const w = this.wagon;
    if (!w || !w.load.length) return { ok: false, reason: 'The wagon is empty' };
    if (this.carried) return { ok: false, reason: 'Hands full' };
    const s = w.load.pop()!;
    const p = toV(w.rb.translation());
    const it = this.spawnFromWagon(s, [p.x, p.y + 0.6, p.z]);
    return this.pickUp(it);
  }

  /** Tip everything out of the back of the wagon. */
  tipWagon(): number {
    const w = this.wagon;
    if (!w) return 0;
    const q = toQ(w.rb.rotation());
    const back = new Vector3(0, 0, 1).applyQuaternion(q);
    const side = new Vector3(1, 0, 0).applyQuaternion(q);
    const p = toV(w.rb.translation()).addScaledVector(back, w.half[2] + 0.45);
    const load = this.emptyWagon();
    load.forEach((s, i) => {
      const at = p.clone().addScaledVector(side, ((i % 3) - 1) * 0.35).addScaledVector(back, Math.floor(i / 3) * 0.35);
      const it = this.spawnFromWagon(s, [at.x, 0.25 + i * 0.12, at.z]);
      it.rb.setLinvel({ x: back.x, y: 0.5, z: back.z }, true);
    });
    if (load.length) this.emit({ type: 'drop', pos: p, part: load[0].part });
    return load.length;
  }

  private spawnFromWagon(s: SpawnDef, pos: V3): Item {
    const it = this.spawnItem({ part: s.part, pos, rot: s.rot, rotY: s.rotY });
    // Falling out of the world later still sends it home, not back to the wagon.
    it.spawn = s;
    it.touched = true;
    return it;
  }

  hitchWagon(on: boolean) {
    const w = this.wagon;
    if (!w || w.hitched === on) return;
    w.hitched = on;
    if (on) w.rb.wakeUp();
    this.emit({ type: 'hitch', pos: toV(w.rb.translation()), on });
  }

  private stepWagon() {
    const w = this.wagon;
    if (!w) return;
    const rb = w.rb;
    const p = toV(rb.translation());
    if (outOfBounds(p)) {
      this.resetWagon();
      return;
    }
    if (!w.hitched || !this.player) return;
    const kid = toV(this.player.translation());
    const d = new Vector3(kid.x - p.x, 0, kid.z - p.z);
    const len = d.length();
    // Snagged on something, or the kid climbed away: the handle slips out of their hand.
    if (len > w.tow + 1.4 || kid.y - p.y > 2.2) {
      this.hitchWagon(false);
      return;
    }
    const dir = len > 1e-4 ? d.divideScalar(len) : new Vector3(0, 0, -1).applyQuaternion(toQ(rb.rotation()));
    // Trail the kid at handle length (and roll back if they back into it).
    const v = kid.clone().addScaledVector(dir, -w.tow).sub(p).setY(0).multiplyScalar(10);
    if (v.length() > WAGON.maxSpeed) v.setLength(WAGON.maxSpeed);
    let vy = rb.linvel().y;
    // Bump up over kerbs and the deck edge (and the garage floor's little lip, which the wheels catch on).
    if (v.lengthSq() > 0.25) {
      const fwd = v.clone().normalize();
      const reach = w.half[2] + 0.12;
      const low = this.physics.raycast(p.clone().setY(p.y + 0.04), fwd, reach, groups(0xffff, GROUP.STATIC));
      const lip = low ? null : this.physics.raycast(p.clone().setY(p.y + 0.012), fwd, reach, groups(0xffff, GROUP.STATIC));
      const high = this.physics.raycast(p.clone().setY(p.y + 0.34), fwd, reach, groups(0xffff, GROUP.STATIC));
      if (low && !high && low.normal.y < 0.5) vy = Math.max(vy, 1.8);
      else if (lip && !high && lip.normal.y < 0.5) vy = Math.max(vy, 0.8);
    }
    rb.setLinvel({ x: v.x, y: vy, z: v.z }, true);
    // Handle end points at the kid.
    const want = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.atan2(-dir.x, -dir.z));
    const cur = toQ(rb.rotation());
    if (len > 0.5) cur.slerp(want, 0.08);
    rb.setRotation({ x: cur.x, y: cur.y, z: cur.z, w: cur.w }, true);
  }

  // ---------------------------------------------------------------- snags

  private stepSnags(dt: number) {
    for (const it of this.items.values()) {
      const s = it.snag;
      if (!s) continue;
      const pose = { p: toV(it.rb.translation()), q: toQ(it.rb.rotation()) };
      const p = transformPoint(pose, s.local);
      const v = toV(it.rb.velocityAtPoint({ x: p.x, y: p.y, z: p.z }));
      // The snag pulls on a point away from the centre, so it twists the item too: size the spring
      // for the mass that point really has (light flat kites have very little). Sizing it for the
      // whole mass made the damping over-correct each step and the kite shook itself loose.
      const m = it.rb.mass();
      const inertia = it.rb.principalInertia();
      const iMin = Math.max(1e-6, Math.min(inertia.x, inertia.y, inertia.z));
      const arm = p.distanceTo(toV(it.rb.worldCom()));
      const mEff = 1 / (1 / m + (arm * arm) / iMin);
      const k = stableStiffness(3000, mEff, dt);
      const d = s.anchor.clone().sub(p);
      const slack = s.rest ?? 0;
      const dl = d.length();
      if (dl <= slack) continue;
      const F = d.multiplyScalar(((dl - slack) / Math.max(dl, 1e-6)) * k).sub(v.multiplyScalar(criticalDamping(k, mEff, 0.9)));
      // Measure the pull ignoring the item's own weight.
      const pull = F.clone().add(new Vector3(0, -m * 9.81, 0)).length();
      // How hard it has been tugged, for the test readout (ignores the settling second).
      if (this.time > 1) s.peak = Math.max(s.peak ?? 0, pull / s.breakForce);
      // A hard bump that shoves the snagged corner well off the branch pops it free,
      // even if the pull is too brief to count as a steady tug.
      if (!s.tie && dl - slack > 0.04 && this.time > 1) {
        it.snag = undefined;
        this.emit({ type: 'unsnag', pos: p, tag: it.tag ?? '' });
        continue;
      }
      // Give snagged things a moment to settle before they can tear loose.
      if (pull > s.breakForce && this.time > 1) {
        s.over += dt;
        if (s.over > 0.08) {
          it.snag = undefined;
          this.emit({ type: 'unsnag', pos: p, tag: it.tag ?? '' });
          continue;
        }
      } else s.over = Math.max(0, s.over - dt * 0.5);
      it.rb.addForceAtPoint({ x: F.x, y: F.y, z: F.z }, { x: p.x, y: p.y, z: p.z }, true);
    }
  }

  private applyItemAero() {
    for (const it of this.items.values()) {
      if (this.carried?.item === it) continue;
      const lift = it.def.behaviors.find((b) => b.type === 'buoyancy');
      // Forces AND torques persist in Rapier until reset. Clear both on every item every step:
      // a force pushed at a point (a snag, a grab) leaves torque behind, and a freed kite used to
      // keep that phantom torque and spin forever.
      it.rb.resetForces(false);
      it.rb.resetTorques(false);
      if (it.rb.isSleeping() && !lift) continue;
      if (lift && lift.type === 'buoyancy') it.rb.addForce({ x: 0, y: lift.lift, z: 0 }, true);
      const v = toV(it.rb.linvel());
      const sp = v.length();
      if (sp < 0.3) continue;
      const cda = it.def.drag ?? 0.01;
      const f = v.multiplyScalar(-0.6 * cda * sp);
      it.rb.addForce({ x: f.x, y: f.y, z: f.z }, true);
    }
  }

  // ---------------------------------------------------------------- step

  step(input: SimInput = emptyInput(), dt = DT) {
    this.stepPlayer(input, dt);
    this.stepWagon();
    this.applyItemAero();
    this.stepCarry(dt);
    this.stepSnags(dt);
    let first = true;
    for (const m of this.machines.values()) {
      m.preStep(dt, first ? input.rc : { ...input.rc, action: input.rc.action });
      first = false;
    }
    this.physics.step();
    for (const m of this.machines.values()) m.postStep(dt);
    this.refreshMachineOwnersIfNeeded();
    for (const imp of this.physics.impacts) {
      this.emit({ type: 'impact', pos: imp.pos, mat: imp.matA, other: imp.matB, impulse: imp.impulse });
    }
    this.time += dt;
    if (this.objective && !this.objective.done && !this.objectivesPaused) {
      this.projectTime += dt;
      const evs = this.objective.update(this.query(), dt);
      for (const e of evs) {
        if (e.type === 'fail' && e.action === 'respawnTarget') {
          const t = this.itemByTag('target');
          if (t) this.respawnItem(t);
        }
      }
      this.objectiveEvents.push(...evs);
    }
    // Anything that fell out of the world comes back to where it started.
    for (const it of this.items.values()) {
      if (it.tag) continue;
      const p = it.rb.translation();
      if (outOfBounds(p)) this.respawnItem(it);
    }
  }

  private ownerCount = 0;
  private refreshMachineOwnersIfNeeded() {
    let n = 0;
    for (const m of this.machines.values()) n += m.bodies.length;
    if (n !== this.ownerCount) {
      this.ownerCount = n;
      this.refreshMachineOwners();
    }
  }

  run(seconds: number, input: SimInput | ((t: number) => SimInput) = emptyInput()) {
    const steps = Math.round(seconds / DT);
    for (let i = 0; i < steps; i++) this.step(typeof input === 'function' ? input(this.time) : input);
  }

  itemPos(it: Item): Vector3 {
    return toV(it.rb.translation());
  }

  inZone(p: Vector3, zone: string) {
    return inZone(p, zone);
  }

  /** Items resting inside the lab zone (for the workbench tray). */
  itemsInZone(zone: string): Item[] {
    return [...this.items.values()].filter((it) => !it.tag && it.def.buildable && inZone(toV(it.rb.translation()), zone) && this.carried?.item !== it);
  }

  worldPose(rb: RigidBody): Pose {
    return { p: toV(rb.translation()), q: toQ(rb.rotation()) };
  }

  machineAt(pose: Pose, p: Vector3) {
    return transformPoint(pose, p);
  }

  free() {
    this.physics.free();
  }
}

export { composePose, DT, groups, GROUP };
