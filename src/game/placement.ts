import { Vector3 } from 'three';
import { blueprintBounds, type Blueprint } from '../sim/blueprint';
import type { MachinePlacement } from '../sim/machine';

/**
 * Where machines go when they leave the bench. Pure geometry, shared by
 * carrying / placing, the bench TEST button and the tests.
 *
 * Conventions: the kid looking along yaw θ faces (-sin θ, 0, -cos θ). Parts are
 * built with +Z forward (the RC brain's arrow, a vacuum nozzle, the sticky
 * nose of a car), and a machine placed with yaw φ has forward (sin φ, 0, cos φ).
 */
const UP = new Vector3(0, 1, 0);

export function lookDirection(yaw: number): Vector3 {
  return new Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
}

export function machineForward(yaw: number): Vector3 {
  return new Vector3(Math.sin(yaw), 0, Math.cos(yaw));
}

/** The machine yaw that points its forward axis the way the kid is looking, plus any manual turn. */
export function facingYaw(lookYaw: number, turn = 0): number {
  return lookYaw + Math.PI + turn;
}

/**
 * Where a bench TEST spawns: resting on the bench top, centred, and turned to lie
 * along the bench's long side when it would otherwise hang off the front and back
 * (a car longer than the bench is deep would drop its wheels over both edges).
 */
export function benchTestPlacement(bp: Blueprint, bench: { pos: [number, number, number]; top: number; half: [number, number] }): MachinePlacement {
  const b = blueprintBounds(bp);
  const sx = b.max.x - b.min.x;
  const sz = b.max.z - b.min.z;
  const yaw = sz > bench.half[1] * 2 && sz > sx ? Math.PI / 2 : 0;
  return groundedPlacement(bp, bench.pos[0], bench.top, bench.pos[2], yaw, 0.005);
}

/** Rest the machine's lowest point on `groundY`, with its footprint centred on (x, z). */
export function groundedPlacement(bp: Blueprint, x: number, groundY: number, z: number, yaw: number, clearance = 0.01): MachinePlacement {
  const b = blueprintBounds(bp);
  const mid = b.min.clone().add(b.max).multiplyScalar(0.5).setY(0).applyAxisAngle(UP, yaw);
  return { pos: [x - mid.x, groundY - b.min.y + clearance, z - mid.z], yaw };
}
