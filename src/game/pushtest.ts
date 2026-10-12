import { Quaternion, Vector3 } from 'three';
import { blueprintBounds, findPart, partPose, type Blueprint } from '../sim/blueprint';
import type { SimEvent } from '../sim/events';
import type { MachineInstance, MachinePlacement } from '../sim/machine';
import { toQ, toV } from '../sim/physics';
import type { Simulation } from '../sim/simulation';
import { isWheel, wagonCheck, type WagonCheck } from '../sim/wagonbuild';
import { machineFits } from './autospot';

/**
 * MISSION 0's first experiment: the PUSH TEST.
 *
 * Before the wagon rolls out of the lab, the kid can set it on the garage
 * floor and give it a shove toward the open door. Real physics decides what
 * happens (wheels on axles roll, flat wheels skid, a lopsided cart tips, a
 * handle dragging on the floor slows it down), and a probe measures it so the
 * bench can say what happened in plain words. Then STOP puts it back.
 */
export const PUSH = {
  /** The shove, m/s. A good push from a kid. */
  speed: 2.2,
  /** Stop measuring after this long, even if it is still rolling. */
  maxTime: 4.5,
  /** Below this it counts as stopped. */
  restSpeed: 0.06,
  /** Where the push starts: on the garage floor, beside the bench, pointing out of the open east side. */
  lane: [
    [-11.1, -3.3],
    [-11.1, -2.7],
    [-11.4, -6.9],
  ] as [number, number][],
  floorY: 0.02,
} as const;

/** Rolled this far, it rolls. */
const ROLLED = 0.6;
/** Tipped past this, it fell over. */
const TIPPED = 45;
/** Leaning past this, it is scraping along on its side. */
const LEANED = 18;

/** The way the machine rolls, in blueprint space: square to its wheels' axles. Null if nothing rolls. */
export function rollDirection(bp: Blueprint): Vector3 | null {
  const sum = new Vector3();
  let ref: Vector3 | null = null;
  for (const c of bp.connections) {
    if ((c.kind !== 'axle' && c.kind !== 'driven') || !c.axis || Math.abs(c.axis[1]) > 0.5) continue;
    const wheel = [c.a, c.b].map((u) => findPart(bp, u)).find((p) => p && isWheel(p.def));
    if (!wheel) continue;
    const a = new Vector3(c.axis[0], 0, c.axis[2]).normalize();
    // Axles on opposite sides point opposite ways: line them up before adding.
    if (!ref) ref = a.clone();
    sum.add(a.dot(ref) < 0 ? a.negate() : a);
  }
  if (!ref || sum.lengthSq() < 1e-6) return null;
  const axle = sum.normalize();
  return new Vector3(-axle.z, 0, axle.x);
}

export interface PushPlan {
  placement: MachinePlacement;
  /** World direction of the shove. */
  dir: Vector3;
  /** Whether anything on it can roll at all. */
  rolls: boolean;
}

/**
 * Where to set it down and which way to shove it: rolling direction pointed
 * out of the garage, handle leading (the way it goes when pulled).
 */
export function pushPlan(sim: Simulation, bp: Blueprint): PushPlan | null {
  const rd = rollDirection(bp);
  const check = wagonCheck(bp);
  // Nothing rolls: shove it along its longest side anyway, and let it skid.
  const b = blueprintBounds(bp);
  let d = rd ?? (b.max.x - b.min.x >= b.max.z - b.min.z ? new Vector3(1, 0, 0) : new Vector3(0, 0, 1));
  if (check.handle !== null && check.body !== null) {
    const hp = partPose(findPart(bp, check.handle)!).p;
    const bc = partPose(findPart(bp, check.body)!).p;
    if (hp.sub(bc).dot(d) < 0) d = d.clone().negate();
  }
  // Turn the machine so d points along world +x.
  const yaw = Math.atan2(d.z, d.x);
  const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw);
  const mid = b.min.clone().add(b.max).multiplyScalar(0.5).setY(0).applyQuaternion(q);
  for (const [x, z] of PUSH.lane) {
    const placement: MachinePlacement = { pos: [x - mid.x, PUSH.floorY - b.min.y + 0.01, z - mid.z], yaw };
    if (machineFits(sim, bp, placement)) return { placement, dir: new Vector3(1, 0, 0), rolls: !!rd };
  }
  return null;
}

/** The shove itself: every body of the machine starts moving together. */
export function shove(m: MachineInstance, dir: Vector3, speed = PUSH.speed) {
  for (const b of m.bodies) b.rb.setLinvel({ x: dir.x * speed, y: 0, z: dir.z * speed }, true);
}

export interface PushResult {
  /** How far it went along the push, metres. */
  distance: number;
  /** Most it leaned, degrees. */
  tilt: number;
  topSpeed: number;
  /** Connections that let go. */
  breaks: number;
  /** Seconds it took to stop (or the cut-off). */
  time: number;
  stillRolling: boolean;
}

export interface PushVerdict {
  mood: 'rolled' | 'stuck' | 'tipped' | 'broke';
  /** One plain sentence: what happened. */
  line: string;
  /** What to try, if anything. */
  next: string | null;
  facts: string[];
}

/** Watches a push test. Pure measurement: no rendering, no DOM. */
export class PushProbe {
  private m: MachineInstance | null = null;
  private dir = new Vector3(1, 0, 0);
  private start = new Vector3();
  private t = 0;
  private restT = 0;
  done = false;
  result: PushResult = { distance: 0, tilt: 0, topSpeed: 0, breaks: 0, time: 0, stillRolling: false };
  /** Where the machine has been, for the trail. */
  path: Vector3[] = [];

  begin(m: MachineInstance, dir: Vector3) {
    this.m = m;
    this.dir.copy(dir);
    this.start.copy(m.center());
    this.t = 0;
    this.restT = 0;
    this.done = false;
    this.result = { distance: 0, tilt: 0, topSpeed: 0, breaks: 0, time: 0, stillRolling: false };
    this.path = [this.start.clone()];
  }

  event(e: SimEvent) {
    if (this.m && !this.done && e.type === 'break') this.result.breaks++;
  }

  /** Returns true the moment the test is over. */
  sample(dt: number): boolean {
    const m = this.m;
    if (!m || this.done) return false;
    this.t += dt;
    const c = m.center();
    const r = this.result;
    r.distance = Math.max(r.distance, c.clone().sub(this.start).dot(this.dir));
    // The heaviest body is the body of the cart; how far has its "up" leaned?
    let main = m.bodies[0];
    for (const b of m.bodies) if (b.rb.mass() > main.rb.mass()) main = b;
    if (main) {
      const up = new Vector3(0, 1, 0).applyQuaternion(toQ(main.rb.rotation()));
      r.tilt = Math.max(r.tilt, (Math.acos(Math.min(1, Math.max(-1, up.y))) * 180) / Math.PI);
    }
    const speed = main ? toV(main.rb.linvel()).setY(0).length() : 0;
    r.topSpeed = Math.max(r.topSpeed, speed);
    if (c.distanceTo(this.path[this.path.length - 1]) > 0.08) this.path.push(c.clone());
    this.restT = speed < PUSH.restSpeed && this.t > 0.4 ? this.restT + dt : 0;
    if (this.restT > 0.5 || this.t >= PUSH.maxTime) {
      r.time = this.t;
      r.stillRolling = this.restT <= 0.5;
      this.done = true;
      return true;
    }
    return false;
  }
}

const m1 = (n: number) => `${n.toFixed(n < 10 ? 1 : 0)} m`;

/** What the push showed, in the kid's words, plus the one thing worth changing. */
export function pushVerdict(r: PushResult, check: WagonCheck): PushVerdict {
  const facts = [`Rolled ${m1(Math.max(0, r.distance))}${r.stillRolling ? ' (and still going)' : ''}`, `Leaned ${Math.round(r.tilt)}°`, `Top speed ${r.topSpeed.toFixed(1)} m/s`];
  const todo = check.notes.find((n) => !n.done);
  if (r.breaks > 0) {
    return {
      mood: 'broke',
      line: `Something came loose when it got shoved${r.breaks > 1 ? `: ${r.breaks} connections let go` : ''}.`,
      next: 'Stick the loose part back on, closer to the middle, and push it again.',
      facts,
    };
  }
  if (r.tilt > TIPPED) {
    return {
      mood: 'tipped',
      line: 'It tipped right over.',
      next: check.spread ? 'Wider is steadier. Spread the wheels further apart.' : 'All the weight was on one side. Put wheels on both sides and both ends.',
      facts,
    };
  }
  if (r.tilt > LEANED) {
    return {
      mood: 'tipped',
      line: `It leaned over ${Math.round(r.tilt)}° and scraped along on its side.`,
      next: check.spread ? 'Wider is steadier. Spread the wheels further apart.' : 'It needs wheels on both sides to sit level.',
      facts,
    };
  }
  // Wheels down one side only: the other side scrapes along the floor even if it doesn't fall over.
  if (check.wheels >= 2 && !check.spread && r.distance >= ROLLED) {
    return {
      mood: 'tipped',
      line: `It went ${m1(r.distance)}, but leaning ${Math.round(r.tilt)}°: the side with no wheels scraped along the floor.`,
      next: todo?.text ?? 'Put wheels on both sides.',
      facts,
    };
  }
  if (r.distance < ROLLED) {
    const why = check.stuckWheels && !check.wheels
      ? 'The wheels are lying flat, so it skidded instead of rolling.'
      : !check.wheels
        ? 'Nothing on it can roll, so it just skidded.'
        : !check.rolls
          ? 'The body was dragging on the floor, like a brake.'
          : 'Something was dragging on the floor and stopped it.';
    return { mood: 'stuck', line: `It only went ${Math.round(Math.max(0, r.distance) * 100)} cm. ${why}`, next: todo?.text ?? 'Find what is touching the floor besides the wheels.', facts };
  }
  // A handle lying on the floor drags like a brake. That's fine: pulling it lifts it.
  if (check.handle !== null && !r.stillRolling && r.distance < 2.5) {
    return {
      mood: 'rolled',
      line: `It rolled ${m1(r.distance)}, then the handle dragging on the floor slowed it down. When I pull it, I'll be holding the handle up.`,
      next: check.ok ? null : (todo?.text ?? null),
      facts,
    };
  }
  const how = r.stillRolling ? 'right out of the garage' : `${m1(r.distance)} across the floor`;
  return {
    mood: 'rolled',
    line: `It rolled ${how}${r.tilt < 12 ? ' and stayed level' : ''}!`,
    next: check.ok ? null : (todo?.text ?? null),
    facts,
  };
}
