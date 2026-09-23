import { Vector3 } from 'three';
import { Builder, blueprintBounds, type Blueprint } from '../src/sim/blueprint';
import type { MachineInstance } from '../src/sim/machine';
import { emptyInput, Simulation, type SimInput } from '../src/sim/simulation';

/** Low RC car: plank chassis, two motor-driven rear wheels, two free front wheels. */
export function rcCar(opts: { tape?: boolean; battery?: 'battery_small' | 'battery_car' } = {}) {
  const b = new Builder('RC car');
  const pl = b.free('plank');
  const m1 = b.on('motor', 'back', pl, [-0.45, 0, 0.075], [0, 0, 1]);
  const m2 = b.on('motor', 'back', pl, [-0.45, 0, -0.075], [0, 0, -1]);
  b.into('lawn_wheel', 'hub', m1, 'shaft');
  b.into('lawn_wheel', 'hub', m2, 'shaft');
  b.on('lawn_wheel', 'hub', pl, [0.45, 0, 0.075], [0, 0, 1]);
  b.on('lawn_wheel', 'hub', pl, [0.45, 0, -0.075], [0, 0, -1]);
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

/** Steering inputs that point the RC receiver's nose at a target. */
export function steerTo(m: MachineInstance, receiver: number, target: Vector3, speed = 1): SimInput {
  const p = m.partWorldPose(receiver)!;
  const fwd = new Vector3(0, 0, 1).applyQuaternion(p.q).setY(0).normalize();
  const right = new Vector3().crossVectors(fwd, new Vector3(0, 1, 0));
  const to = target.clone().sub(p.p).setY(0);
  const angle = Math.atan2(to.dot(right), to.dot(fwd));
  const inp = emptyInput();
  inp.rc.steer = Math.max(-1, Math.min(1, angle * 2.5));
  inp.rc.throttle = Math.abs(angle) > 0.9 ? 0.25 : speed;
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
