import { Vector3 } from 'three';
import { getPart } from '../data/parts';
import type { MetricId, ProjectDef } from '../data/projects';
import { zone } from '../data/world';
import { components } from '../sim/blueprint';
import type { SimEvent } from '../sim/events';
import { partOBBs } from '../sim/geom';
import type { MachineInstance } from '../sim/machine';
import { toQ, toV } from '../sim/physics';
import type { Item, Simulation } from '../sim/simulation';

/**
 * Test results: what a run actually did, measured from the physics, turned
 * into a few gauges and one plain observation. Never a score, never a verdict:
 * the point is to show *why* something happened so the next change is obvious.
 */

/** Everything the probe measured during one run. Plain numbers, so it is easy to test. */
export interface RunStats {
  time: number;
  hasTarget: boolean;
  /** Gap between the nearest bit of machine (or its suction / airflow) and the target, m. */
  startGap: number;
  closest: number;
  /** How far the target got from where it started while the machine ran, m. */
  targetMoved: number;
  /** How far the target is from where it needs to be, m. */
  goalStart: number;
  goalBest: number;
  goalEnd: number;
  /** How far the machine itself travelled, m. */
  machineMoved: number;
  grabbed: boolean;
  grabTime: number;
  firstGrab: number | null;
  lostGrip: number;
  heldAtEnd: boolean;
  snagged: boolean;
  unsnagged: boolean;
  /** Peak tug on a snagged target as a fraction of what it takes to tear it loose. */
  pushPeak: number;
  targetTopSpeed: number;
  /** A vacuum or fan on the machine: how close to the target its air ever pointed (degrees, while in range). */
  airPart: string | null;
  aimOff: number | null;
  /** Its air pointed at the target, in range, but something solid was in between. */
  airBlocked: boolean;
  maxTilt: number; // degrees
  breaks: number;
  lastBreak: { part: string; other: string } | null;
  snaps: number;
  lastSnap: string | null;
  /** Something on the machine wanted power. */
  powered: boolean;
  /** A motor / fan / vacuum sits on a part of the machine with no battery. */
  noBattery: boolean;
  minFactor: number;
  factorSum: number;
  factorSamples: number;
  dead: boolean;
  playerHandled: boolean;
  success: boolean;
}

export interface Gauge {
  id: MetricId;
  label: string;
  /** 0..1, or null when it does not apply to this machine. */
  value: number | null;
  note: string;
}

export interface TestReport {
  gauges: Gauge[];
  observation: string;
  tryNext: string | null;
  mood: 'worked' | 'close' | 'learned';
  /** A one-tap next step the results card can offer, when the fix is that obvious. */
  fix?: 'turn';
}

export function emptyStats(): RunStats {
  return {
    time: 0,
    hasTarget: false,
    startGap: Infinity,
    closest: Infinity,
    targetMoved: 0,
    goalStart: 0,
    goalBest: 0,
    goalEnd: 0,
    machineMoved: 0,
    grabbed: false,
    grabTime: 0,
    firstGrab: null,
    lostGrip: 0,
    heldAtEnd: false,
    snagged: false,
    unsnagged: false,
    pushPeak: 0,
    targetTopSpeed: 0,
    airPart: null,
    aimOff: null,
    airBlocked: false,
    maxTilt: 0,
    breaks: 0,
    lastBreak: null,
    snaps: 0,
    lastSnap: null,
    powered: false,
    noBattery: false,
    minFactor: 1,
    factorSum: 0,
    factorSamples: 0,
    dead: false,
    playerHandled: false,
    success: false,
  };
}

/** Horizontal distance from a point to a zone (0 inside it), plus height above `below`. */
export function goalGap(project: ProjectDef, p: { x: number; y: number; z: number }): number {
  const z = zone(project.goalZone);
  const dx = Math.max(z.min[0] - p.x, 0, p.x - z.max[0]);
  const dz = Math.max(z.min[2] - p.z, 0, p.z - z.max[2]);
  const up = project.goalBelow !== undefined ? Math.max(0, p.y - project.goalBelow) : 0;
  return Math.hypot(dx, dz) + up;
}

const POWERED = new Set(['motor', 'winch', 'suction']);
const needsPower = (id: string) => getPart(id).behaviors.some((b) => POWERED.has(b.type) || (b.type === 'thrust' && !!b.watts));
const hasBattery = (id: string) => getPart(id).behaviors.some((b) => b.type === 'battery');

/** Watches one run of the machines in the yard. */
export class TestProbe {
  stats = emptyStats();
  private project: ProjectDef | null = null;
  private machines: MachineInstance[] = [];
  private startCenter = new Map<number, Vector3>();
  private startUp = new Map<number, Vector3>();
  private targetStart: Vector3 | null = null;
  private wasGrabbed = false;

  begin(sim: Simulation, project: ProjectDef | null, exclude: number | null = null) {
    this.stats = emptyStats();
    this.project = project;
    this.machines = [...sim.machines.values()].filter((m) => m.id !== exclude);
    this.startCenter.clear();
    this.startUp.clear();
    this.wasGrabbed = false;
    for (const m of this.machines) {
      this.startCenter.set(m.id, m.center());
      const b = mainBody(m);
      if (b) this.startUp.set(m.id, new Vector3(0, 1, 0).applyQuaternion(toQ(b.rotation())));
      for (const group of components(m.bp)) {
        const defs = group.map((u) => m.bp.parts.find((p) => p.uid === u)!.def);
        if (defs.some(needsPower) && !defs.some(hasBattery)) this.stats.noBattery = true;
      }
    }
    const t = project ? sim.itemByTag('target') : undefined;
    this.stats.hasTarget = !!t;
    if (t && project) {
      this.targetStart = toV(t.rb.translation());
      const g = goalGap(project, this.targetStart);
      this.stats.goalStart = this.stats.goalBest = this.stats.goalEnd = g;
      this.stats.snagged = !!t.snag;
      this.stats.startGap = this.stats.closest = this.gapTo(sim, t);
    } else this.targetStart = null;
  }

  event(e: SimEvent) {
    const s = this.stats;
    if ('machine' in e && !this.machines.some((m) => m.id === e.machine)) return;
    switch (e.type) {
      case 'break':
        s.breaks++;
        s.lastBreak = { part: e.part, other: e.other };
        break;
      case 'snap':
        s.snaps++;
        s.lastSnap = e.part;
        break;
      case 'batteryDead':
        s.dead = true;
        break;
      case 'unsnag':
        if (e.tag === 'target') s.unsnagged = true;
        break;
    }
  }

  sample(sim: Simulation, dt: number) {
    const s = this.stats;
    s.time += dt;
    for (const m of this.machines) {
      if (!sim.machines.has(m.id) || m.state !== 'running') continue;
      const c0 = this.startCenter.get(m.id);
      if (c0) s.machineMoved = Math.max(s.machineMoved, m.center().distanceTo(c0));
      const b = mainBody(m);
      const up0 = this.startUp.get(m.id);
      if (b && up0) {
        const up = new Vector3(0, 1, 0).applyQuaternion(toQ(b.rotation()));
        s.maxTilt = Math.max(s.maxTilt, (up.angleTo(up0) * 180) / Math.PI);
      }
      const pw = m.powerSummary();
      if (pw && pw.demand > 0) {
        s.powered = true;
        s.minFactor = Math.min(s.minFactor, pw.factor);
        s.factorSum += pw.factor;
        s.factorSamples++;
      }
    }
    const t = this.project ? sim.itemByTag('target') : undefined;
    if (!t || !this.project || !this.targetStart) return;
    const p = toV(t.rb.translation());
    if (sim.carried?.item === t) s.playerHandled = true;
    s.targetMoved = Math.max(s.targetMoved, p.distanceTo(this.targetStart));
    s.targetTopSpeed = Math.max(s.targetTopSpeed, toV(t.rb.linvel()).length());
    const g = goalGap(this.project, p);
    s.goalBest = Math.min(s.goalBest, g);
    s.goalEnd = g;
    if (t.snag) s.pushPeak = Math.max(s.pushPeak, t.snag.peak ?? 0);
    s.closest = Math.min(s.closest, this.gapTo(sim, t));
    const grabbed = this.machines.some((m) => sim.machines.has(m.id) && m.grabs.some((gr) => gr.other.handle === t.rb.handle));
    if (grabbed) {
      s.grabbed = true;
      s.grabTime += dt;
      if (s.firstGrab === null) s.firstGrab = s.time;
    } else if (this.wasGrabbed) s.lostGrip++;
    this.wasGrabbed = grabbed;
    s.heldAtEnd = grabbed;
  }

  finish(success: boolean): RunStats {
    this.stats.success = success;
    // Letting go at the finish line is not "losing grip".
    if (success && this.stats.lostGrip > 0) this.stats.lostGrip--;
    return this.stats;
  }

  /** Closest gap between any machine part (or what it blows / sucks) and the target. */
  private gapTo(sim: Simulation, t: Item): number {
    const tp = toV(t.rb.translation());
    const tr = Math.max(...t.def.shapes.map((sh) => sh.r ?? Math.max(...(sh.half ?? [0.05, 0.05, 0.05]))));
    let best = Infinity;
    for (const m of this.machines) {
      if (!sim.machines.has(m.id)) continue;
      for (const part of m.parts.values()) {
        const wp = m.partWorldPose(part.uid);
        if (!wp) continue;
        for (const o of partOBBs(part.def, wp)) {
          const d = tp.clone().sub(o.c);
          const q = o.c.clone();
          for (let i = 0; i < 3; i++) q.addScaledVector(o.axes[i], Math.max(-o.h[i], Math.min(o.h[i], d.dot(o.axes[i]))));
          best = Math.min(best, Math.max(0, q.distanceTo(tp) - tr));
        }
        // A vacuum or fan "reaches" as far as its air does, if it points the right way and nothing is in between.
        for (const b of part.def.behaviors) {
          if (b.type !== 'suction' && b.type !== 'airflow') continue;
          const origin = new Vector3(...b.at).applyQuaternion(wp.q).add(wp.p);
          const axis = new Vector3(...b.axis).applyQuaternion(wp.q).normalize();
          const d = tp.clone().sub(origin);
          const dist = d.length();
          const along = d.dot(axis);
          const inRange = dist <= b.range;
          // Aim is judged from the tool itself, so facing right away still counts as "close enough, wrong way".
          const fromBody = tp.clone().sub(wp.p);
          if (fromBody.length() <= b.range + 0.3 && fromBody.length() > 1e-3) {
            this.stats.airPart = part.def.id;
            const off = (fromBody.angleTo(axis) * 180) / Math.PI;
            this.stats.aimOff = Math.min(this.stats.aimOff ?? Infinity, off);
          }
          if (along < 0) continue;
          const lateral = d.clone().addScaledVector(axis, -along).length();
          if (lateral > Math.tan((b.cone * Math.PI) / 180) * along + 0.3) continue;
          if (sim.physics.blockedByStatic(origin, tp)) {
            if (inRange) {
              this.stats.airBlocked = true;
              this.stats.airPart = part.def.id;
            }
            continue;
          }
          best = Math.min(best, Math.max(0, dist - b.range * 0.85));
        }
      }
    }
    return best;
  }
}

function mainBody(m: MachineInstance) {
  let best = m.bodies[0];
  for (const b of m.bodies) if (b.rb.mass() > (best?.rb.mass() ?? 0)) best = b;
  return best?.rb ?? null;
}

// ----------------------------------------------------------------- analysis

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const m1 = (x: number) => `${x.toFixed(1)} m`;

export function gauge(id: MetricId, s: RunStats): Gauge {
  switch (id) {
    case 'reach': {
      if (!s.hasTarget) return { id, label: 'Reach', value: null, note: 'nothing to reach' };
      const moved = s.targetMoved > 0.25 && !s.playerHandled;
      const v = moved || s.closest <= 0.02 ? 1 : clamp01(1 - s.closest / 2.5) * 0.95;
      return { id, label: 'Reach', value: v, note: v >= 0.95 ? 'reached it' : v >= 0.5 ? 'got close' : 'didn’t reach' };
    }
    case 'grip': {
      if (!s.hasTarget) return { id, label: 'Grip', value: null, note: 'nothing to grab' };
      if (!s.grabbed) return { id, label: 'Grip', value: 0, note: 'never grabbed it' };
      const span = Math.max(0.1, s.time - (s.firstGrab ?? 0));
      const v = s.lostGrip === 0 ? 1 : clamp01(s.grabTime / span) * 0.8;
      return { id, label: 'Grip', value: v, note: v >= 0.95 ? 'held on' : 'couldn’t keep hold' };
    }
    case 'push': {
      if (!s.hasTarget) return { id, label: 'Push', value: null, note: 'nothing to push' };
      const v = s.unsnagged || (!s.snagged && s.targetMoved > 0.3) ? 1 : s.snagged ? clamp01(s.pushPeak) * 0.95 : clamp01(s.targetTopSpeed / 3) * 0.95;
      return { id, label: 'Push', value: v, note: v >= 0.95 ? (s.snagged ? 'knocked it loose' : 'moved it') : v >= 0.5 ? 'almost!' : v > 0.05 ? 'a little nudge' : 'didn’t budge it' };
    }
    case 'stability': {
      const v = clamp01(1 - s.maxTilt / 110 - s.breaks * 0.2 - s.snaps * 0.1);
      return { id, label: 'Stability', value: v, note: s.breaks ? 'came apart' : s.maxTilt > 100 ? 'flipped over' : v >= 0.75 ? 'steady' : v >= 0.45 ? 'wobbly' : 'lost balance' };
    }
    case 'power': {
      if (s.noBattery) return { id, label: 'Power', value: 0, note: 'no battery on it' };
      if (!s.powered) return { id, label: 'Power', value: null, note: 'not needed' };
      if (s.dead) return { id, label: 'Power', value: 0.05, note: 'battery ran flat' };
      const avg = s.factorSamples ? s.factorSum / s.factorSamples : 1;
      const v = clamp01(Math.min(avg, s.minFactor + 0.25));
      return { id, label: 'Power', value: v, note: v >= 0.9 ? 'plenty' : v >= 0.55 ? 'struggling' : 'not enough power' };
    }
  }
}

/** Turn a run into gauges, one observation and one "what if" to try. */
export function analyze(s: RunStats, project: ProjectDef | null): TestReport {
  const metrics: MetricId[] = project?.metrics ?? ['stability', 'power'];
  const gauges = metrics.map((id) => gauge(id, s));
  const what = project?.target ?? 'target';
  const say = (observation: string, tryNext: string | null, mood: TestReport['mood'] = 'learned'): TestReport => ({ gauges, observation, tryNext, mood });
  const closer = s.goalStart - s.goalEnd;
  const power = gauge('power', s);

  if (s.success) return say(`It worked! The ${what} is back where it belongs.`, 'Wait. What ELSE could you build?', 'worked');
  if (s.noBattery) return say('Nothing happened. The motors (or fan, or vacuum) need a battery stuck onto the same machine.', 'Try sticking a battery anywhere on it.');
  if (s.dead) return say('It started… then the battery ran flat.', 'What happens with a bigger battery?');
  const reached = (gauge('reach', s).value ?? 1) >= 0.95;
  const weak = s.powered && power.value !== null && power.value < 0.55;
  const alsoWeak = weak ? ` The battery was struggling too (about ${Math.round((power.value ?? 0) * 100)}% power).` : '';
  if (weak && reached && closer < Math.max(0.3, s.goalStart * 0.9))
    return say(`It was trying, but the battery couldn’t keep up. It only got about ${Math.round((power.value ?? 0) * 100)}% of the power it wanted.`, 'What happens with a bigger battery?');
  if (s.breaks && s.lastBreak) {
    const a = getPart(s.lastBreak.part).name.toLowerCase();
    const b = getPart(s.lastBreak.other).name.toLowerCase();
    return say(`CLUNK. The ${a} came off the ${b}. That joint had more load than it could take.`, 'Less weight on it? Or attach it somewhere sturdier?');
  }
  if (s.snaps && s.lastSnap) return say(`SNAP. The ${getPart(s.lastSnap).name.toLowerCase()} couldn’t take the pull.`, 'Something lighter, or a shorter pull?');
  if (s.maxTilt > 100) return say('It flipped right over. Interesting!', 'Try a wider base, or something heavy down low.');
  if (s.snagged && s.unsnagged && s.goalEnd > 0.3) return say(`The ${what} is free! Now it just has to come down.`, 'What happens when the push stops? (■ STOP)', 'close');
  if (s.snagged && !s.unsnagged && s.pushPeak >= 0.45) return say(`The ${what} shook, but it’s still snagged. Almost!`, 'A bit more push? Closer, or stronger?', 'close');
  if (s.grabbed && s.lostGrip > 0 && !s.heldAtEnd) return say(`It grabbed the ${what}… and then lost its grip.`, 'Hold it tighter, or pull more gently?', 'close');
  if (s.hasTarget && closer > 0.3) return say(`The ${what} came ${m1(closer)} closer, but not all the way.`, s.goalEnd < 1 ? 'SO close. One small change?' : 'More power, or start closer?', 'close');
  if (s.hasTarget && closer < -0.3 && !s.playerHandled) return say(`The ${what} went the other way!`, 'What if it pointed the other way?');
  if (s.maxTilt > 45) return say('The machine lost its balance and tipped.', 'Try a wider base, or something heavy down low.');
  if (s.hasTarget && s.targetMoved > 0.25 && !s.playerHandled) return say(`The ${what} moved, but not toward home.`, 'Change the angle and try again?');
  if (s.hasTarget && s.closest <= 0.05) return say(`It reached the ${what}, but didn’t move it.`, 'It needs a way to grab, pull or push it.', 'close');
  // Air tools: close enough, but aimed off, or blocked by something solid.
  if (s.hasTarget && s.airPart && s.targetMoved < 0.25) {
    const tool = getPart(s.airPart).name.toLowerCase();
    if (s.aimOff !== null && s.aimOff > 35) return { ...say(`The ${tool} was close enough, but it was pointing away from the ${what}.`, `Turn it to point right at the ${what}?`, 'close'), fix: 'turn' };
    if (s.airBlocked) return say(`The ${tool} was pointed at the ${what}, but something solid was in the way.`, 'Find a clear path to it?', 'close');
  }
  if (s.hasTarget && Number.isFinite(s.closest)) {
    if (s.machineMoved < 0.05 && !s.powered) return say('Nothing moved. Machines need something to make them go: a motor, a fan, a spring, a rocket…', 'What would make it move?');
    return say(`It didn’t reach. The closest it got was ${m1(s.closest)} from the ${what}.${alsoWeak}`, s.closest > 1.5 ? 'Start closer, or build something longer?' : 'A little more reach?');
  }
  if (s.machineMoved < 0.05 && !s.powered) return say('Nothing moved. Machines need something to make them go: a motor, a fan, a spring, a rocket…', 'What would make it move?');
  return say('Interesting result!', 'Change one thing and test again.');
}
