import { Quaternion, Vector3 } from 'three';
import { getPart, type BehaviorDef, type LinkDef, type PartDef, type V3 } from '../data/parts';
import { components, findPart, linkLength, partPose, type BPConnection, type BPLink, type Blueprint } from './blueprint';
import type { SimEvent } from './events';
import { composePose, invertPose, partArea, shapeVolume, transformPoint, v3, type Pose } from './geom';
import { criticalDamping, linkTension, reducedMass, RopeSim, stableStiffness } from './links';
import { G_DYNAMIC, RAPIER, toQ, toV, type ImpulseJoint, type Owner, type Physics, type RigidBody } from './physics';
import { solvePower, type BatteryState, type Consumer } from './power';

export interface MachinePlacement {
  pos: V3;
  yaw: number; // radians
}

export interface DynTarget {
  rb: RigidBody;
  area: number;
  owner: Owner;
}

export interface MachineHost {
  physics: Physics;
  emit(e: SimEvent): void;
  dynamicTargets(): DynTarget[];
  ownerOfBody(rb: RigidBody): Owner | undefined;
}

export interface RCInput {
  throttle: number;
  steer: number;
  action: boolean; // edge
}

interface MBody {
  rb: RigidBody;
  parts: number[];
  prevLin: Vector3;
  prevAng: Vector3;
}

export interface PartRt {
  uid: number;
  def: PartDef;
  body: MBody;
  local: Pose; // pose within body
  colliders: number[];
  stress: number;
  energy: number;
  burn: number;
  pressed: boolean;
  cmd: number; // current drive command -1..1 (motors, fans)
  power: number; // delivered fraction
  active: boolean; // doing its thing right now (visual)
  extForce: number; // link / behaviour force applied this step (N)
}

interface JointRt {
  idx: number;
  conn: BPConnection;
  joint: ImpulseJoint;
}

interface ConnLocal {
  aAnchor: Vector3;
  bAnchor: Vector3;
  aAxis: Vector3;
  bAxis: Vector3;
}

export interface LinkEndRt {
  part: number;
  local: Vector3;
  reel?: boolean;
}

export interface LinkRt {
  id: number;
  partUid: number;
  def: PartDef;
  link: LinkDef;
  a: LinkEndRt;
  b: LinkEndRt;
  length: number;
  rope?: RopeSim;
  tension: number;
  prevLen: number;
  broken: boolean;
  fromTether?: number; // connection index
}

export interface GrabRt {
  part: number;
  partLocal: Vector3; // point in the part frame
  other: RigidBody;
  otherLocal: Vector3; // point in the other body's frame
  hold: number;
  source: 'sticky' | 'suction';
  over: number;
}

interface CompRt {
  uids: number[];
  live: boolean;
  wasLive: boolean;
  on: boolean;
  receiver?: number;
  factor: number;
  demand: number;
  delivered: number;
  warnedBrownout: boolean;
  warnedDead: boolean;
}

interface DriveMap {
  mode: 'drive' | 'turret' | 'throttle' | 'lift';
  sign: number;
  side: number;
}

const RPM = (Math.PI * 2) / 60;
/** Rapier's revolute motor turns body 2 the opposite way to the right-hand rule on our axis. */
const MOTOR_SIGN = -1;
const BREAK_GRACE = 0.25;

let linkIds = 1;

export class MachineInstance {
  state: 'frozen' | 'running' = 'frozen';
  runTime = 0;
  bodies: MBody[] = [];
  parts = new Map<number, PartRt>();
  joints: JointRt[] = [];
  links: LinkRt[] = [];
  grabs: GrabRt[] = [];
  intact: Set<number>;
  comps: CompRt[] = [];
  private connLocal = new Map<number, ConnLocal>();
  private driveMap = new Map<string, DriveMap>();
  private partMachinePose = new Map<number, Pose>();
  /** Per-part persistent state that must survive rebuilds. */
  private persist = new Map<number, { energy: number; burn: number; pressed: boolean; stress: number }>();

  constructor(
    public host: MachineHost,
    public id: number,
    public bp: Blueprint,
    public placement: MachinePlacement,
  ) {
    this.intact = new Set(bp.connections.map((_, i) => i));
    for (const p of bp.parts) this.partMachinePose.set(p.uid, partPose(p));
    bp.connections.forEach((c, i) => {
      const pa = this.partMachinePose.get(c.a)!;
      const pb = this.partMachinePose.get(c.b)!;
      const anchor = v3(c.anchor);
      const axis = v3(c.axis ?? [0, 1, 0]);
      this.connLocal.set(i, {
        aAnchor: transformPoint(invertPose(pa), anchor),
        bAnchor: transformPoint(invertPose(pb), anchor),
        aAxis: axis.clone().applyQuaternion(pa.q.clone().invert()),
        bAxis: axis.clone().applyQuaternion(pb.q.clone().invert()),
      });
    });
    for (const p of bp.parts) {
      const def = getPart(p.def);
      const bat = def.behaviors.find((b) => b.type === 'battery');
      const thr = def.behaviors.find((b) => b.type === 'thrust');
      this.persist.set(p.uid, {
        energy: bat && bat.type === 'battery' ? bat.energy : 0,
        burn: thr && thr.type === 'thrust' && thr.burn ? thr.burn : 0,
        pressed: false,
        stress: 0,
      });
    }
    this.build(this.initialPoses(), null, false);
    this.createLinks();
    this.recomputeComps();
  }

  get placementPose(): Pose {
    return { p: v3(this.placement.pos), q: new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), this.placement.yaw) };
  }

  private initialPoses(): Map<number, Pose> {
    const P = this.placementPose;
    const m = new Map<number, Pose>();
    for (const p of this.bp.parts) {
      if (getPart(p.def).link) continue;
      m.set(p.uid, composePose(P, this.partMachinePose.get(p.uid)!));
    }
    return m;
  }

  // ------------------------------------------------------------------ build

  private build(poses: Map<number, Pose>, vels: Map<number, { v: Vector3; w: Vector3 }> | null, dynamic: boolean) {
    const { physics } = this.host;
    const R = RAPIER;
    const solid = this.bp.parts.filter((p) => !getPart(p.def).link);
    // Rigid clusters: parts joined by intact welds become one body.
    const parent = new Map<number, number>();
    for (const p of solid) parent.set(p.uid, p.uid);
    const find = (x: number): number => (parent.get(x) === x ? x : (parent.set(x, find(parent.get(x)!)), parent.get(x)!));
    this.bp.connections.forEach((c, i) => {
      if (c.kind === 'weld' && this.intact.has(i) && parent.has(c.a) && parent.has(c.b)) parent.set(find(c.a), find(c.b));
    });
    const clusters = new Map<number, number[]>();
    for (const p of solid) {
      const r = find(p.uid);
      if (!clusters.has(r)) clusters.set(r, []);
      clusters.get(r)!.push(p.uid);
    }

    this.bodies = [];
    this.parts.clear();
    for (const uids of clusters.values()) {
      const bodyPose = poses.get(uids[0])!;
      const defs = uids.map((u) => getPart(findPart(this.bp, u)!.def));
      const lin = Math.max(0.02, ...defs.map((d) => d.linearDamping ?? 0));
      const ang = Math.max(0.05, ...defs.map((d) => d.angularDamping ?? 0));
      const desc = (dynamic ? R.RigidBodyDesc.dynamic() : R.RigidBodyDesc.fixed())
        .setTranslation(bodyPose.p.x, bodyPose.p.y, bodyPose.p.z)
        .setRotation({ x: bodyPose.q.x, y: bodyPose.q.y, z: bodyPose.q.z, w: bodyPose.q.w })
        .setLinearDamping(lin)
        .setAngularDamping(ang)
        .setCcdEnabled(true)
        .setCanSleep(false);
      const rb = physics.world.createRigidBody(desc);
      const body: MBody = { rb, parts: uids, prevLin: new Vector3(), prevAng: new Vector3() };
      const inv = invertPose(bodyPose);
      for (const uid of uids) {
        const def = getPart(findPart(this.bp, uid)!.def);
        const local = composePose(inv, poses.get(uid)!);
        const vols = def.shapes.map((s) => s.share ?? shapeVolume(s));
        const total = vols.reduce((a, b) => a + b, 0);
        const colliders: number[] = [];
        def.shapes.forEach((s, i) => {
          const mat = s.mat ?? def.material;
          const cd = physics.shapeDesc(s, local, (def.mass * vols[i]) / total, mat).setCollisionGroups(G_DYNAMIC);
          const col = physics.world.createCollider(cd, rb);
          const bounce = def.behaviors.find((b) => b.type === 'bounce');
          physics.tags.set(col.handle, {
            owner: { kind: 'machine', id: this.id },
            part: uid,
            mat,
            bounce: bounce && bounce.type === 'bounce' ? bounce.boost : undefined,
          });
          colliders.push(col.handle);
        });
        const ps = this.persist.get(uid)!;
        this.parts.set(uid, {
          uid,
          def,
          body,
          local,
          colliders,
          stress: ps.stress,
          energy: ps.energy,
          burn: ps.burn,
          pressed: ps.pressed,
          cmd: 0,
          power: 0,
          active: false,
          extForce: 0,
        });
      }
      if (vels) {
        const first = poses.get(uids[0])!;
        const fv = vels.get(uids[0])!;
        const com = toV(rb.worldCom());
        const v = fv.v.clone().add(new Vector3().crossVectors(fv.w, com.sub(first.p)));
        rb.setLinvel({ x: v.x, y: v.y, z: v.z }, true);
        rb.setAngvel({ x: fv.w.x, y: fv.w.y, z: fv.w.z }, true);
        body.prevLin.copy(v);
        body.prevAng.copy(fv.w);
      }
      this.bodies.push(body);
    }

    // Pivots, axles and motor shafts become revolute joints between bodies.
    this.joints = [];
    this.bp.connections.forEach((c, i) => {
      if (!this.intact.has(i) || c.kind === 'weld' || c.kind === 'tether') return;
      const pa = this.parts.get(c.a);
      const pb = this.parts.get(c.b);
      if (!pa || !pb || pa.body === pb.body) return;
      const cl = this.connLocal.get(i)!;
      const a1 = transformPoint(pa.local, cl.aAnchor);
      const a2 = transformPoint(pb.local, cl.bAnchor);
      const x1 = cl.aAxis.clone().applyQuaternion(pa.local.q).normalize();
      const x2 = cl.bAxis.clone().applyQuaternion(pb.local.q).normalize();
      const data = R.JointData.revoluteWithAxes(
        { x: a1.x, y: a1.y, z: a1.z },
        { x: a2.x, y: a2.y, z: a2.z },
        { x: x1.x, y: x1.y, z: x1.z },
        { x: x2.x, y: x2.y, z: x2.z },
      );
      const joint = physics.world.createImpulseJoint(data, pa.body.rb, pb.body.rb, true);
      joint.setContactsEnabled(false);
      if (c.kind === 'driven') {
        const rj = joint as RAPIER.RevoluteImpulseJoint;
        rj.configureMotorModel(R.MotorModel.ForceBased);
        rj.setMotorMaxForce(0.4);
        rj.configureMotorVelocity(0, 1);
      }
      this.joints.push({ idx: i, conn: c, joint });
    });
  }

  private destroyBodies() {
    const { physics } = this.host;
    for (const b of this.bodies) {
      for (let i = 0; i < b.rb.numColliders(); i++) physics.tags.delete(b.rb.collider(i).handle);
      physics.world.removeRigidBody(b.rb);
    }
    this.bodies = [];
    this.joints = [];
  }

  private snapshot(): { poses: Map<number, Pose>; vels: Map<number, { v: Vector3; w: Vector3 }> } {
    const poses = new Map<number, Pose>();
    const vels = new Map<number, { v: Vector3; w: Vector3 }>();
    for (const [uid, p] of this.parts) {
      const wp = this.partWorldPose(uid)!;
      poses.set(uid, wp);
      const rb = p.body.rb;
      const w = toV(rb.angvel());
      const v = toV(rb.linvel()).add(new Vector3().crossVectors(w, wp.p.clone().sub(toV(rb.worldCom()))));
      vels.set(uid, { v, w });
      const ps = this.persist.get(uid)!;
      ps.energy = p.energy;
      ps.burn = p.burn;
      ps.pressed = p.pressed;
      ps.stress = p.stress;
    }
    return { poses, vels };
  }

  private rebuild() {
    const { poses, vels } = this.snapshot();
    this.destroyBodies();
    this.build(poses, vels, this.state === 'running');
    this.recomputeComps();
  }

  private createLinks() {
    this.links = [];
    for (const l of this.bp.links) this.addLinkRt(l);
    this.bp.connections.forEach((c, i) => {
      if (c.kind !== 'tether') return;
      const bpart = findPart(this.bp, c.b)!;
      const def = getPart(bpart.def);
      const sock = def.sockets.find((s) => s.joint === 'tether')!;
      const sp = v3(sock.pos);
      const len = c.tether ?? 1;
      const bLocal = sp.clone().multiplyScalar(1 - len / sp.length());
      const aPose = this.partMachinePose.get(c.a)!;
      const aLocal = transformPoint(invertPose(aPose), v3(c.anchor));
      const stringDef: LinkDef = { kind: 'rope', length: len, stiffness: 1500, damping: 0.5, breakForce: def.strength, maxSpan: len * 2, radius: 0.003 };
      this.pushLink({ partUid: c.b, def, link: stringDef, a: { part: c.a, local: aLocal }, b: { part: c.b, local: bLocal }, length: len, fromTether: i });
    });
  }

  private addLinkRt(l: BPLink) {
    const part = findPart(this.bp, l.part)!;
    const def = getPart(part.def);
    this.pushLink({
      partUid: l.part,
      def,
      link: def.link!,
      a: { part: l.a.part, local: v3(l.a.local), reel: l.a.reel },
      b: { part: l.b.part, local: v3(l.b.local), reel: l.b.reel },
      length: linkLength(this.bp, l),
    });
  }

  private pushLink(x: Omit<LinkRt, 'id' | 'tension' | 'prevLen' | 'broken' | 'rope'>) {
    const a = this.linkEndWorld(x.a);
    const b = this.linkEndWorld(x.b);
    const rt: LinkRt = { ...x, id: linkIds++, tension: 0, prevLen: a.distanceTo(b), broken: false };
    if (x.link.kind === 'rope') {
      rt.rope = new RopeSim(a, b, x.length);
      // Let the slack settle onto the ground now, so GO does not start with a jolt.
      const { physics } = this.host;
      for (let i = 0; i < 90; i++) rt.rope.step(a, b, 1 / 120, (p, r) => physics.pushOutOfStatic(p, r), 12);
    }
    this.links.push(rt);
  }

  // ------------------------------------------------------------ queries

  partWorldPose(uid: number): Pose | null {
    const p = this.parts.get(uid);
    if (!p) return null;
    const rb = p.body.rb;
    return composePose({ p: toV(rb.translation()), q: toQ(rb.rotation()) }, p.local);
  }

  linkEndWorld(e: LinkEndRt): Vector3 {
    const wp = this.partWorldPose(e.part);
    return wp ? transformPoint(wp, e.local) : new Vector3();
  }

  totalMass(): number {
    return this.bodies.reduce((m, b) => m + b.rb.mass(), 0);
  }

  center(): Vector3 {
    const c = new Vector3();
    let m = 0;
    for (const b of this.bodies) {
      const bm = b.rb.mass();
      c.addScaledVector(toV(b.rb.worldCom()), bm);
      m += bm;
    }
    return m > 0 ? c.divideScalar(m) : v3(this.placement.pos);
  }

  ownsBody(rb: RigidBody): boolean {
    return this.bodies.some((b) => b.rb.handle === rb.handle);
  }

  // ------------------------------------------------------------ lifecycle

  go() {
    if (this.state === 'running') return;
    this.state = 'running';
    this.runTime = 0;
    for (const b of this.bodies) {
      b.rb.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
      b.prevLin.set(0, 0, 0);
      b.prevAng.set(0, 0, 0);
    }
    this.computeDriveMap();
  }

  destroy() {
    this.destroyBodies();
    this.links = [];
    this.grabs = [];
  }

  private recomputeComps() {
    const intactConns = this.bp.connections.filter((_, i) => this.intact.has(i));
    const old = this.comps;
    this.comps = components(this.bp, intactConns).map((uids) => {
      const prev = old.find((o) => o.uids.some((u) => uids.includes(u)));
      const receiver = uids.find((u) => getPart(findPart(this.bp, u)!.def).behaviors.some((b) => b.type === 'receiver'));
      return {
        uids,
        live: prev?.live ?? false,
        wasLive: prev?.wasLive ?? false,
        on: prev?.on ?? true,
        receiver,
        factor: 0,
        demand: 0,
        delivered: 0,
        warnedBrownout: prev?.warnedBrownout ?? false,
        warnedDead: prev?.warnedDead ?? false,
      };
    });
  }


  /** Work out, once at GO, which way each motor / fan should turn for "forward". */
  private computeDriveMap() {
    this.driveMap.clear();
    for (const comp of this.comps) {
      if (comp.receiver === undefined) continue;
      const rp = this.partWorldPose(comp.receiver)!;
      const fwd = new Vector3(0, 0, 1).applyQuaternion(rp.q);
      const up = new Vector3(0, 1, 0);
      fwd.y = 0;
      if (fwd.lengthSq() < 1e-4) fwd.set(0, 0, 1);
      fwd.normalize();
      const right = new Vector3().crossVectors(fwd, up);
      const center = new Vector3();
      comp.uids.forEach((u) => center.add(this.partWorldPose(u)!.p));
      center.divideScalar(comp.uids.length);
      const sideOf = (p: Vector3) => {
        const s = p.clone().sub(center).dot(right);
        return Math.abs(s) < 0.03 ? 0 : Math.sign(s);
      };
      this.bp.connections.forEach((c, i) => {
        if (c.kind !== 'driven' || !comp.uids.includes(c.a)) return;
        const wa = this.partWorldPose(c.a)!;
        const axis = this.connLocal.get(i)!.aAxis.clone().applyQuaternion(wa.q).normalize();
        const fwdPerRad = -new Vector3().crossVectors(axis, up).dot(fwd);
        const anchor = transformPoint(wa, this.connLocal.get(i)!.aAnchor);
        if (Math.abs(fwdPerRad) > 0.3) this.driveMap.set(`j${i}`, { mode: 'drive', sign: Math.sign(fwdPerRad) * MOTOR_SIGN, side: sideOf(anchor) });
        else if (Math.abs(axis.dot(up)) > 0.7) this.driveMap.set(`j${i}`, { mode: 'turret', sign: -Math.sign(axis.dot(up)) * MOTOR_SIGN, side: 0 });
        else this.driveMap.set(`j${i}`, { mode: 'throttle', sign: 1, side: 0 });
      });
      for (const u of comp.uids) {
        const p = this.parts.get(u)!;
        const th = p.def.behaviors.find((b) => b.type === 'thrust');
        if (!th || th.type !== 'thrust' || !th.watts) continue;
        const wp = this.partWorldPose(u)!;
        const dir = v3(th.axis).applyQuaternion(wp.q);
        if (Math.abs(dir.y) > 0.7) this.driveMap.set(`f${u}`, { mode: 'lift', sign: 1, side: 0 });
        else this.driveMap.set(`f${u}`, { mode: 'drive', sign: Math.sign(dir.dot(fwd)) || 1, side: sideOf(wp.p) });
      }
    }
  }

  // ------------------------------------------------------------ stepping

  /** Apply all forces for the coming physics step. */
  preStep(dt: number, rc: RCInput) {
    if (this.state !== 'running') return;
    this.runTime += dt;
    for (const b of this.bodies) {
      b.rb.resetForces(false);
      b.rb.resetTorques(false);
    }
    for (const p of this.parts.values()) {
      p.extForce = 0;
      p.active = false;
    }
    this.updateGates(rc);
    this.updatePowerAndActuators(dt, rc);
    this.applyAero();
    this.applyLinks(dt);
    this.applyGrabs(dt);
  }

  private behaviorsOf(uid: number): BehaviorDef[] {
    return this.parts.get(uid)!.def.behaviors;
  }

  private updateGates(rc: RCInput) {
    for (const comp of this.comps) {
      let open = true;
      for (const u of comp.uids) {
        const p = this.parts.get(u)!;
        for (const b of this.behaviorsOf(u)) {
          if (b.type === 'timer') {
            const delay = findPart(this.bp, u)!.settings?.delay ?? b.delay;
            if (this.runTime < delay) open = false;
            else if (!p.pressed) {
              p.pressed = true;
              this.host.emit({ type: 'ding', pos: this.partWorldPose(u)!.p, machine: this.id });
            }
          }
          if (b.type === 'pressure' && !p.pressed) open = false;
        }
      }
      comp.live = open;
      if (open && !comp.wasLive) {
        this.host.emit({ type: 'live', pos: this.partWorldPose(comp.uids[0])!.p, machine: this.id });
      }
      comp.wasLive = open;
      if (rc.action && comp.receiver !== undefined) {
        comp.on = !comp.on;
        this.host.emit({ type: 'toggle', pos: this.partWorldPose(comp.receiver)!.p, machine: this.id, on: comp.on });
      }
    }
  }

  private motorCmd(key: string, comp: CompRt, reverse: boolean, rc: RCInput): number {
    const flip = reverse ? -1 : 1;
    if (comp.receiver === undefined) return flip;
    const m = this.driveMap.get(key);
    if (!m) return 0;
    const clamp = (x: number) => Math.max(-1, Math.min(1, x));
    switch (m.mode) {
      case 'drive':
        return flip * m.sign * clamp(rc.throttle - rc.steer * m.side);
      case 'turret':
        return flip * m.sign * rc.steer;
      case 'throttle':
        return flip * rc.throttle;
      case 'lift':
        return comp.on ? 1 : 0;
    }
  }

  private updatePowerAndActuators(dt: number, rc: RCInput) {
    for (const comp of this.comps) {
      const consumers: Consumer[] = [];
      const batteries: { st: BatteryState; part: PartRt }[] = [];
      const motors: { j: JointRt; part: PartRt; b: Extract<BehaviorDef, { type: 'motor' }>; cmd: number }[] = [];
      const fans: { part: PartRt; b: Extract<BehaviorDef, { type: 'thrust' }>; cmd: number }[] = [];
      const suckers: { part: PartRt; b: Extract<BehaviorDef, { type: 'suction' }> }[] = [];
      const winches: { part: PartRt; b: Extract<BehaviorDef, { type: 'winch' }> }[] = [];
      for (const u of comp.uids) {
        const part = this.parts.get(u)!;
        for (const b of part.def.behaviors) {
          if (b.type === 'battery') batteries.push({ st: { energy: part.energy, maxWatts: b.maxWatts }, part });
          if (b.type === 'motor') {
            const reverse = !!findPart(this.bp, u)!.settings?.reverse;
            for (const j of this.joints) {
              if (j.conn.kind !== 'driven' || j.conn.a !== u) continue;
              const cmd = comp.live ? this.motorCmd(`j${j.idx}`, comp, reverse, rc) : 0;
              motors.push({ j, part, b, cmd });
              consumers.push({ watts: b.watts, demand: Math.abs(cmd) });
            }
          }
          if (b.type === 'thrust' && b.watts) {
            let cmd = comp.live ? Math.max(0, this.motorCmd(`f${u}`, comp, false, rc)) : 0;
            if (comp.receiver !== undefined && this.driveMap.get(`f${u}`)?.mode === 'lift') cmd = comp.live && comp.on ? 1 : 0;
            fans.push({ part, b, cmd });
            consumers.push({ watts: b.watts, demand: cmd });
          }
          if (b.type === 'suction' && comp.live && comp.on) {
            suckers.push({ part, b });
            consumers.push({ watts: b.watts, demand: 1 });
          }
          if (b.type === 'winch' && comp.live && comp.on) {
            winches.push({ part, b });
            consumers.push({ watts: b.watts, demand: 1 });
          }
          if (b.type === 'thrust' && b.burn && comp.live && part.burn > 0) {
            const full = b.burn;
            if (part.burn >= full - 1e-9) this.host.emit({ type: 'ignite', pos: this.partWorldPose(u)!.p, machine: this.id });
            part.burn = Math.max(0, part.burn - dt);
            const wp = this.partWorldPose(u)!;
            const f = v3(b.axis).applyQuaternion(wp.q).multiplyScalar(b.force);
            const at = b.at ? transformPoint(wp, v3(b.at)) : wp.p;
            part.body.rb.addForceAtPoint({ x: f.x, y: f.y, z: f.z }, { x: at.x, y: at.y, z: at.z }, true);
            part.active = true;
            part.extForce += b.force;
          }
        }
      }
      const res = solvePower(consumers, batteries.map((b) => b.st), dt);
      batteries.forEach((b) => (b.part.energy = b.st.energy));
      comp.factor = res.factor;
      comp.demand = res.demandWatts;
      comp.delivered = res.deliveredWatts;
      if (res.demandWatts > 0) {
        const pos = this.partWorldPose(comp.uids[0])!.p;
        if (batteries.length === 0 || batteries.every((b) => b.st.energy <= 0)) {
          if (!comp.warnedDead) {
            comp.warnedDead = true;
            this.host.emit({ type: 'batteryDead', pos, machine: this.id });
          }
        } else if (res.factor < 0.4 && !comp.warnedBrownout) {
          comp.warnedBrownout = true;
          this.host.emit({ type: 'brownout', pos, machine: this.id });
        }
      }
      const f = res.factor;
      for (const m of motors) {
        const rj = m.j.joint as RAPIER.RevoluteImpulseJoint;
        const target = m.b.rpm * RPM * m.cmd * f;
        const on = Math.abs(m.cmd) > 0.01 && f > 0.01;
        rj.setMotorMaxForce(on ? m.b.torque * f : 0.4);
        rj.configureMotorVelocity(on ? target : 0, 1.5);
        m.part.cmd = m.cmd * f;
        m.part.power = f;
        m.part.active = on;
      }
      for (const fan of fans) {
        const out = fan.cmd * f;
        fan.part.cmd = out;
        fan.part.power = f;
        fan.part.active = out > 0.01;
        if (out <= 0.01) continue;
        const wp = this.partWorldPose(fan.part.uid)!;
        const force = v3(fan.b.axis).applyQuaternion(wp.q).multiplyScalar(fan.b.force * out);
        fan.part.body.rb.addForceAtPoint({ x: force.x, y: force.y, z: force.z }, { x: wp.p.x, y: wp.p.y, z: wp.p.z }, true);
        fan.part.extForce += fan.b.force * out;
        const air = fan.part.def.behaviors.find((b) => b.type === 'airflow');
        if (air && air.type === 'airflow') this.blow(wp, air, out);
      }
      for (const s of suckers) {
        s.part.active = f > 0.05;
        s.part.power = f;
        if (f > 0.05) this.suck(s.part, s.b, f);
      }
      // Suction grabs only live while their vacuum is on.
      this.grabs = this.grabs.filter((g) => {
        if (g.source !== 'suction' || !comp.uids.includes(g.part)) return true;
        const keep = suckers.some((s) => s.part.uid === g.part) && f > 0.05;
        if (!keep) this.host.emit({ type: 'unstick', pos: toV(g.other.translation()), machine: this.id });
        return keep;
      });
      for (const w of winches) {
        w.part.power = f;
        for (const l of this.links) {
          if (l.broken) continue;
          const reelsHere = (l.a.reel && l.a.part === w.part.uid) || (l.b.reel && l.b.part === w.part.uid);
          if (!reelsHere) continue;
          if (l.tension < w.b.force && l.length > 0.2) {
            l.length = Math.max(0.2, l.length - w.b.speed * f * dt);
            l.rope?.setLength(l.length);
            w.part.active = f > 0.05;
          }
        }
      }
    }
  }

  private blow(nozzle: Pose, air: Extract<BehaviorDef, { type: 'airflow' }>, strength: number) {
    const origin = transformPoint(nozzle, v3(air.at));
    const axis = v3(air.axis).applyQuaternion(nozzle.q).normalize();
    const tanCone = Math.tan((air.cone * Math.PI) / 180);
    for (const t of this.host.dynamicTargets()) {
      if (this.ownsBody(t.rb)) continue;
      const p = toV(t.rb.worldCom());
      const d = p.clone().sub(origin);
      const along = d.dot(axis);
      if (along <= 0 || along > air.range) continue;
      const lateral = d.clone().sub(axis.clone().multiplyScalar(along)).length();
      if (lateral > tanCone * along + 0.3) continue;
      if (this.host.physics.blockedByStatic(origin, p)) continue;
      const f = air.pressure * (1 - along / air.range) * Math.min(t.area, 0.4) * strength;
      t.rb.addForce({ x: axis.x * f, y: axis.y * f, z: axis.z * f }, true);
    }
  }

  private suck(part: PartRt, s: Extract<BehaviorDef, { type: 'suction' }>, f: number) {
    const wp = this.partWorldPose(part.uid)!;
    const origin = transformPoint(wp, v3(s.at));
    const axis = v3(s.axis).applyQuaternion(wp.q).normalize();
    const tanCone = Math.tan((s.cone * Math.PI) / 180);
    for (const t of this.host.dynamicTargets()) {
      if (this.ownsBody(t.rb)) continue;
      if (this.grabs.some((g) => g.other.handle === t.rb.handle)) continue;
      const p = toV(t.rb.worldCom());
      const d = p.clone().sub(origin);
      const dist = d.length();
      const along = d.dot(axis);
      if (dist > s.range || along < -0.1) continue;
      const lateral = d.clone().sub(axis.clone().multiplyScalar(along)).length();
      if (lateral > tanCone * Math.max(0, along) + 0.25) continue;
      if (this.host.physics.blockedByStatic(origin, p)) continue;
      const exposure = Math.min(1, t.area / 0.04);
      const mag = s.force * (1 - dist / s.range) * exposure * f;
      const dir = d.clone().normalize().negate();
      t.rb.addForce({ x: dir.x * mag, y: dir.y * mag, z: dir.z * mag }, true);
      part.body.rb.addForceAtPoint({ x: -dir.x * mag, y: -dir.y * mag, z: -dir.z * mag }, { x: origin.x, y: origin.y, z: origin.z }, true);
      if (dist < 0.24) {
        const hold = transformPoint(invertPose(wp), origin.clone().add(axis.clone().multiplyScalar(0.12)));
        const otherPose = { p: toV(t.rb.translation()), q: toQ(t.rb.rotation()) };
        this.grabs.push({
          part: part.uid,
          partLocal: hold,
          other: t.rb,
          otherLocal: transformPoint(invertPose(otherPose), p),
          hold: s.hold * f,
          source: 'suction',
          over: 0,
        });
        this.host.emit({ type: 'suck', pos: origin, machine: this.id });
      }
    }
  }

  private applyAero() {
    for (const part of this.parts.values()) {
      const rb = part.body.rb;
      const b = part.def.behaviors.find((x) => x.type === 'buoyancy');
      const wp = this.partWorldPose(part.uid)!;
      if (b && b.type === 'buoyancy') {
        rb.addForceAtPoint({ x: 0, y: b.lift, z: 0 }, { x: wp.p.x, y: wp.p.y, z: wp.p.z }, true);
        part.active = true;
      }
      const cda = part.def.drag ?? 0.01;
      const v = toV(rb.velocityAtPoint({ x: wp.p.x, y: wp.p.y, z: wp.p.z }));
      const sp = v.length();
      if (sp < 0.3) continue;
      const f = v.multiplyScalar(-0.6 * cda * sp);
      rb.addForceAtPoint({ x: f.x, y: f.y, z: f.z }, { x: wp.p.x, y: wp.p.y, z: wp.p.z }, true);
    }
  }

  private applyLinks(dt: number) {
    const { physics } = this.host;
    for (const l of this.links) {
      if (l.broken) continue;
      const pa = this.parts.get(l.a.part);
      const pb = this.parts.get(l.b.part);
      if (!pa || !pb) continue;
      const a = this.linkEndWorld(l.a);
      const b = this.linkEndWorld(l.b);
      let dirA: Vector3;
      let dirB: Vector3;
      let len: number;
      if (l.rope) {
        l.rope.step(a, b, dt, (p, r) => physics.pushOutOfStatic(p, r));
        len = l.rope.pathLength();
        dirA = l.rope.pullDirA();
        dirB = l.rope.pullDirB();
      } else {
        const d = b.clone().sub(a);
        len = d.length();
        dirA = len > 1e-6 ? d.clone().divideScalar(len) : new Vector3(0, 1, 0);
        dirB = dirA.clone().negate();
      }
      // Stretch rate from the end points' relative velocity along the pull, not
      // from the path length (a rope going taut would otherwise register a jolt).
      const va = toV(pa.body.rb.velocityAtPoint({ x: a.x, y: a.y, z: a.z }));
      const vb = toV(pb.body.rb.velocityAtPoint({ x: b.x, y: b.y, z: b.z }));
      const rate = -(va.dot(dirA) + vb.dot(dirB));
      l.prevLen = len;
      if (pa.body === pb.body) {
        l.tension = 0;
        continue;
      }
      const ma = pa.body.rb.mass();
      const mb = pb.body.rb.mass();
      const mr = reducedMass(ma, mb);
      const k = stableStiffness(l.link.stiffness, mr, dt);
      const c = criticalDamping(k, mr, l.link.damping);
      let t = linkTension(l.link.kind, l.length, len, rate, k, c);
      if (l.link.kind === 'spring' && l.link.minLength && len < l.link.minLength) t -= k * 4 * (l.link.minLength - len);
      l.tension = t;
      if (Math.abs(t) > l.link.breakForce) {
        l.broken = true;
        l.tension = 0;
        if (l.fromTether !== undefined) this.intact.delete(l.fromTether);
        this.host.emit({ type: 'snap', pos: a.clone().lerp(b, 0.5), machine: this.id, part: l.def.id });
        continue;
      }
      if (t === 0) continue;
      const fa = dirA.multiplyScalar(t);
      const fb = dirB.multiplyScalar(t);
      pa.body.rb.addForceAtPoint({ x: fa.x, y: fa.y, z: fa.z }, { x: a.x, y: a.y, z: a.z }, true);
      pb.body.rb.addForceAtPoint({ x: fb.x, y: fb.y, z: fb.z }, { x: b.x, y: b.y, z: b.z }, true);
      pa.extForce += Math.abs(t);
      pb.extForce += Math.abs(t);
    }
  }

  private applyGrabs(dt: number) {
    this.grabs = this.grabs.filter((g) => {
      const part = this.parts.get(g.part);
      if (!part || !g.other.isValid()) return false;
      const wp = this.partWorldPose(g.part)!;
      const pa = transformPoint(wp, g.partLocal);
      const op = { p: toV(g.other.translation()), q: toQ(g.other.rotation()) };
      const pb = transformPoint(op, g.otherLocal);
      const rbA = part.body.rb;
      const va = toV(rbA.velocityAtPoint({ x: pa.x, y: pa.y, z: pa.z }));
      const vb = toV(g.other.velocityAtPoint({ x: pb.x, y: pb.y, z: pb.z }));
      const mr = reducedMass(rbA.mass(), g.other.isDynamic() ? g.other.mass() : Infinity);
      const k = stableStiffness(4000, mr, dt);
      const c = criticalDamping(k, mr, 0.8);
      const F = pa.clone().sub(pb).multiplyScalar(k).add(va.sub(vb).multiplyScalar(c));
      const mag = F.length();
      if (mag > g.hold) {
        g.over += dt;
        if (g.over > 0.12) {
          this.host.emit({ type: 'unstick', pos: pb, machine: this.id });
          return false;
        }
        F.multiplyScalar(g.hold / mag);
      } else g.over = Math.max(0, g.over - dt);
      g.other.addForceAtPoint({ x: F.x, y: F.y, z: F.z }, { x: pb.x, y: pb.y, z: pb.z }, true);
      rbA.addForceAtPoint({ x: -F.x, y: -F.y, z: -F.z }, { x: pa.x, y: pa.y, z: pa.z }, true);
      part.extForce += Math.min(mag, g.hold);
      return true;
    });
  }

  /** After the physics step: stress, breakage, sticky tape, pressure plates. */
  postStep(dt: number) {
    if (this.state !== 'running') return;
    const { physics } = this.host;
    const g = new Vector3(0, -9.81, 0);
    // Stress on each part: contact + rope/thrust + what it takes to accelerate it.
    for (const b of this.bodies) {
      const lin = toV(b.rb.linvel());
      const ang = toV(b.rb.angvel());
      const acc = lin.clone().sub(b.prevLin).divideScalar(dt);
      const alpha = ang.clone().sub(b.prevAng).divideScalar(dt);
      const com = toV(b.rb.worldCom());
      for (const uid of b.parts) {
        const part = this.parts.get(uid)!;
        const wp = this.partWorldPose(uid)!;
        const r = wp.p.clone().sub(com);
        const aPart = acc.clone().add(new Vector3().crossVectors(alpha, r)).add(new Vector3().crossVectors(ang, new Vector3().crossVectors(ang, r)));
        const inertial = part.def.mass * aPart.sub(g).length();
        let contact = 0;
        for (const h of part.colliders) contact += physics.contactSum.get(h) ?? 0;
        const raw = contact + part.extForce + inertial;
        part.stress += (raw - part.stress) * Math.min(1, dt / 0.05);
      }
      b.prevLin.copy(lin);
      b.prevAng.copy(ang);
    }
    let needRebuild = false;
    if (this.runTime > BREAK_GRACE) {
      for (const i of [...this.intact]) {
        const c = this.bp.connections[i];
        if (c.kind === 'tether') continue;
        const pa = this.parts.get(c.a);
        const pb = this.parts.get(c.b);
        if (!pa || !pb) continue;
        const strength = Math.min(pa.def.strength, pb.def.strength) * (c.kind === 'weld' ? 1 : 0.85);
        const load = Math.max(pa.stress, pb.stress);
        if (load > strength) {
          this.intact.delete(i);
          const pos = transformPoint(this.partWorldPose(c.a)!, this.connLocal.get(i)!.aAnchor);
          this.host.emit({ type: 'break', pos, machine: this.id, part: pb.def.id, other: pa.def.id, joint: c.kind });
          pa.stress *= 0.3;
          pb.stress *= 0.3;
          if (c.kind === 'weld') needRebuild = true;
          else {
            const j = this.joints.find((x) => x.idx === i);
            if (j) {
              physics.world.removeImpulseJoint(j.joint, true);
              this.joints = this.joints.filter((x) => x !== j);
            }
            this.recomputeComps();
          }
        }
      }
    }
    if (needRebuild) this.rebuild();

    // Sticky tape grabs whatever it touches.
    for (const part of this.parts.values()) {
      const sticky = part.def.behaviors.find((b) => b.type === 'sticky');
      if (sticky && sticky.type === 'sticky') {
        const mine = this.grabs.filter((gr) => gr.part === part.uid && gr.source === 'sticky').length;
        if (mine >= 2) continue;
        for (const h of part.colliders) {
          const partners = physics.partners.get(h);
          if (!partners) continue;
          for (const oh of partners.keys()) {
            const tag = physics.tags.get(oh);
            if (!tag || tag.owner.kind === 'static' || tag.owner.kind === 'player') continue;
            if (tag.owner.kind === 'machine' && tag.owner.id === this.id) continue;
            const col = physics.world.getCollider(oh);
            const other = col?.parent();
            if (!other || !other.isDynamic()) continue;
            if (this.grabs.some((gr) => gr.other.handle === other.handle && gr.part === part.uid)) continue;
            const wp = this.partWorldPose(part.uid)!;
            const op = { p: toV(other.translation()), q: toQ(other.rotation()) };
            this.grabs.push({
              part: part.uid,
              partLocal: new Vector3(),
              other,
              otherLocal: transformPoint(invertPose(op), wp.p),
              hold: sticky.hold,
              source: 'sticky',
              over: 0,
            });
            this.host.emit({ type: 'stick', pos: wp.p, machine: this.id });
            break;
          }
        }
      }
      const plate = part.def.behaviors.find((b) => b.type === 'pressure');
      if (plate && plate.type === 'pressure' && !part.pressed) {
        let f = 0;
        for (const h of part.colliders) {
          const partners = physics.partners.get(h);
          if (!partners) continue;
          for (const [oh, force] of partners) {
            const tag = physics.tags.get(oh);
            if (!tag || tag.owner.kind === 'static') continue;
            if (tag.owner.kind === 'machine' && tag.owner.id === this.id) continue;
            f += force;
          }
        }
        if (f > plate.threshold) {
          part.pressed = true;
          this.host.emit({ type: 'click', pos: this.partWorldPose(part.uid)!.p, machine: this.id });
        }
      }
    }
  }

  // ------------------------------------------------------------ HUD info

  powerSummary(): { factor: number; charge: number; demand: number } | null {
    let energy = 0;
    let cap = 0;
    let demand = 0;
    let factor = 1;
    let any = false;
    for (const p of this.parts.values()) {
      const b = p.def.behaviors.find((x) => x.type === 'battery');
      if (b && b.type === 'battery') {
        any = true;
        energy += p.energy;
        cap += b.energy;
      }
    }
    for (const c of this.comps) {
      demand += c.demand;
      if (c.demand > 0) factor = Math.min(factor, c.factor);
    }
    if (!any && demand === 0) return null;
    return { factor, charge: cap > 0 ? energy / cap : 0, demand };
  }

  hasReceiver(): boolean {
    return this.comps.some((c) => c.receiver !== undefined);
  }

  /** Area for other machines' fans / vacuums. */
  bodyArea(rb: RigidBody): number {
    const b = this.bodies.find((x) => x.rb.handle === rb.handle);
    if (!b) return 0;
    return b.parts.reduce((s, u) => s + partArea(this.parts.get(u)!.def), 0);
  }
}
