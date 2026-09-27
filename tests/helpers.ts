import { Vector3 } from 'three';
import type { Idea } from '../src/data/ideas';
import { Builder, blueprintBounds, type Blueprint } from '../src/sim/blueprint';
import type { MachineInstance } from '../src/sim/machine';
import { toV } from '../src/sim/physics';
import { emptyInput, Simulation, type SimInput } from '../src/sim/simulation';

/** Build an idea exactly the way the guided build does, step by step. */
export function followIdea(idea: Idea): { bp: Blueprint; uids: number[] } {
  const b = new Builder(idea.title);
  const uids: number[] = [];
  for (const st of idea.steps) {
    if (st.free) uids.push(b.free(st.part, st.free[0], st.free[1], st.spin ?? 0, st.socket));
    else if (st.into) uids.push(b.into(st.part, st.socket, uids[st.into.step], st.into.target, st.spin ?? 0));
    else uids.push(b.on(st.part, st.socket, uids[st.on!], st.local!, st.normal!, st.spin ?? 0));
  }
  return { bp: b.bp, uids };
}

/** Low RC car: plank chassis, two motor-driven rear wheels, two free front wheels. */
export function rcCar(opts: { tape?: boolean; battery?: 'battery_small' | 'battery_car' } = {}) {
  const b = new Builder('RC car');
  const pl = b.free('plank');
  const m1 = b.on('motor', 'back', pl, [-0.45, 0, 0.075], [0, 0, 1]);
  const m2 = b.on('motor', 'back', pl, [-0.45, 0, -0.075], [0, 0, -1]);
  b.into('lawn_wheel', 'hub', m1, 'shaft');
  b.into('lawn_wheel', 'hub', m2, 'shaft');
  b.on('lawn_wheel', 'hub', pl, [0.1, 0, 0.075], [0, 0, 1]);
  b.on('lawn_wheel', 'hub', pl, [0.1, 0, -0.075], [0, 0, -1]);
  b.on(opts.battery ?? 'battery_small', 'bottom', pl, [-0.2, 0.015, 0], [0, 1, 0]);
  const rx = b.on('rc_receiver', 'bottom', pl, [0.2, 0.015, 0], [0, 1, 0]);
  if (opts.tape) b.on('duct_tape', 'back', pl, [0.6, 0, 0], [1, 0, 0]);
  return { bp: b.bp, chassis: pl, receiver: rx };
}

/** Place a blueprint so its lowest point sits on the ground at (x, z). */
export function place(sim: Simulation, bp: Blueprint, x: number, z: number, yaw: number, ground = 0): MachineInstance {
  const bb = blueprintBounds(bp);
  return sim.addMachine(bp, { pos: [x, ground - bb.min.y + 0.005, z], yaw });
}

/**
 * Steering inputs that point the RC receiver's nose at a target. A skid-steer car
 * with a long wheelbase barely turns while rolling, so this drives like a person
 * does: stop and pivot when far off, then roll with small corrections
 * (maxSteer caps the corrections while dragging something fragile).
 */
export function steerTo(m: MachineInstance, receiver: number, target: Vector3, speed = 1, maxSteer = 1): SimInput {
  const p = m.partWorldPose(receiver)!;
  const fwd = new Vector3(0, 0, 1).applyQuaternion(p.q).setY(0).normalize();
  const right = new Vector3().crossVectors(fwd, new Vector3(0, 1, 0));
  const to = target.clone().sub(p.p).setY(0);
  const angle = Math.atan2(to.dot(right), to.dot(fwd));
  const inp = emptyInput();
  if (Math.abs(angle) > 0.6) {
    inp.rc.steer = Math.sign(angle) * Math.min(1, maxSteer * 2);
    inp.rc.throttle = 0;
  } else {
    inp.rc.steer = Math.max(-maxSteer, Math.min(maxSteer, angle * 2.5));
    inp.rc.throttle = speed;
  }
  return inp;
}

export function runUntil(sim: Simulation, maxSeconds: number, input: () => SimInput, done: () => boolean): boolean {
  const steps = Math.round(maxSeconds * 120);
  for (let i = 0; i < steps; i++) {
    sim.step(input());
    if (done()) return true;
  }
  return false;
}

export function successOf(sim: Simulation) {
  return sim.objectiveEvents.find((e) => e.type === 'success');
}

/**
 * Reversing inputs that tow something on the nose toward a target behind the car:
 * pivot on the spot until the tail points the right way, then back up straight.
 */
export function reverseTo(m: MachineInstance, receiver: number, target: Vector3, speed = 0.6): SimInput {
  const p = m.partWorldPose(receiver)!;
  const fwd = new Vector3(0, 0, 1).applyQuaternion(p.q).setY(0).normalize();
  const right = new Vector3().crossVectors(fwd, new Vector3(0, 1, 0));
  const to = target.clone().sub(p.p).setY(0);
  const angle = Math.atan2(to.dot(right), -to.dot(fwd)); // + : target is to the right of the tail
  const inp = emptyInput();
  if (Math.abs(angle) > 0.3) {
    inp.rc.throttle = 0;
    inp.rc.steer = -Math.sign(angle) * 0.7; // swing the nose left to bring the tail right
  } else {
    inp.rc.throttle = -speed;
    inp.rc.steer = Math.max(-0.5, Math.min(0.5, angle * 2.5));
  }
  return inp;
}

/**
 * Drive a sticky RC car out through the fence gap and bring the ball home, the two
 * ways a player does it with the thumbstick:
 *  - 'push': loop round behind the ball, stick to it nose-first and drive it home ahead of you;
 *  - 'tow': stick to it from the gap side, pivot, and back up through the gap with it in tow.
 */
export function fetchBallHome(sim: Simulation, m: MachineInstance, receiver: number, maxSeconds = 60, plan: 'push' | 'tow' = 'push'): boolean {
  return runUntil(sim, maxSeconds, ballFetcher(sim, m, receiver, plan), () => !!successOf(sim));
}

/** The per-step driver behind fetchBallHome, for tests that want to watch something else while it drives. */
export function ballFetcher(sim: Simulation, m: MachineInstance, receiver: number, plan: 'push' | 'tow' = 'push'): () => SimInput {
  const ball = sim.itemByTag('target')!;
  let stage = 0;
  return () => {
    const bp = toV(ball.rb.translation());
    const nose = m.partWorldPose(receiver)!.p;
    const stuck = m.grabs.some((g) => g.other.handle === ball.rb.handle);
    const near = nose.distanceTo(bp);
    if (plan === 'tow') {
      if (stage === 0 && nose.x > 15.9) stage = 1;
      if (stage === 1 && stuck) stage = 2;
      if (stage === 2 && !stuck && nose.x > 15.3) stage = 1;
      if (stage === 0) return steerTo(m, receiver, new Vector3(16.3, 0, 4.8));
      if (stage === 1) return steerTo(m, receiver, bp, near < 1.5 ? 0.4 : 0.8);
      return reverseTo(m, receiver, new Vector3(nose.x > 16.2 ? 15.4 : 12, 0, 4.8), 0.6);
    }
    // push
    if (stage === 0 && nose.x > 15.9) stage = 1;
    if (stage === 1 && nose.x > bp.x + 1.4) stage = 2;
    if (stage === 2 && Math.abs(nose.z - bp.z) < 0.4 && nose.x > bp.x + 1.0) stage = 3;
    if (stage === 3 && stuck) stage = 4;
    if (stage === 4 && !stuck && nose.x > 15.3) stage = 1;
    if (stage === 0) return steerTo(m, receiver, new Vector3(16.3, 0, 4.8));
    if (stage === 1) return steerTo(m, receiver, new Vector3(bp.x + 2.0, 0, bp.z + 1.4), 0.8);
    if (stage === 2) return steerTo(m, receiver, new Vector3(bp.x + 1.8, 0, bp.z), 0.5);
    if (stage === 3) return steerTo(m, receiver, bp, near < 1.2 ? 0.4 : 0.6);
    // Stuck to it, facing home: ease onto the line of the gap, then straight through.
    return steerTo(m, receiver, new Vector3(nose.x > 16.4 ? 15.4 : 12, 0, 4.8), 0.6, 0.6);
  };
}
