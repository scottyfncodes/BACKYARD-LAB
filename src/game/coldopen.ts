import type { RigidBody } from '@dimforge/rapier3d-compat';
import { EAST_FENCE_X } from '../data/world';
import { Builder, blueprintBounds, type Blueprint } from '../sim/blueprint';
import type { MachinePlacement } from '../sim/machine';

/**
 * The cold open: before any menus or cards, the kid's last invention is already
 * on the lawn. A plank cart with two soda bottle rockets and a bucket, aimed at
 * the fence. It is a real machine in the real simulation: the wheels and the
 * bucket really do tear off when it hits.
 */
export const COLD_OPEN = {
  /** Where the cart starts, facing east (+x) at the fence. */
  cart: { x: 9, z: 4.8 },
  /** Where Biscuit sits and watches (across the cart from the camera). */
  dog: [12.4, 0, 2.4] as [number, number, number],
  /** Where the kid stands, out of shot. */
  kid: [-9.5, 0, -3] as [number, number, number],
  /** Real seconds from the start to ignition. */
  igniteAt: 4.4,
};

export function rocketCart(): Blueprint {
  const b = new Builder('Rocket Cart');
  const pl = b.free('plank');
  b.on('lawn_wheel', 'hub', pl, [0.45, 0, 0.075], [0, 0, 1]);
  b.on('lawn_wheel', 'hub', pl, [-0.45, 0, 0.075], [0, 0, 1]);
  b.on('lawn_wheel', 'hub', pl, [0.45, 0, -0.075], [0, 0, -1]);
  b.on('lawn_wheel', 'hub', pl, [-0.45, 0, -0.075], [0, 0, -1]);
  b.on('bottle_rocket', 'side', pl, [-0.35, 0.015, 0.052], [0, 1, 0]);
  b.on('bottle_rocket', 'side', pl, [-0.35, 0.015, -0.052], [0, 1, 0]);
  b.on('bucket', 'bottom', pl, [0.1, 0.015, 0], [0, 1, 0]);
  return b.bp;
}

/** The cart sitting on the lawn, nose at the fence. */
export function cartPlacement(bp: Blueprint): MachinePlacement {
  const bb = blueprintBounds(bp);
  return { pos: [COLD_OPEN.cart.x, -bb.min.y + 0.005, COLD_OPEN.cart.z], yaw: Math.PI / 2 };
}

/** The ball rides in the bucket. */
export const ballSpot = (): [number, number, number] => [COLD_OPEN.cart.x + 0.1, 0.6, COLD_OPEN.cart.z];

/**
 * The crash: the ball keeps going and sails over the fence. The one scripted
 * moment in the opening (a bucket stopping dead doesn't reliably throw a ball 2 m up).
 */
export function flingBall(ball: RigidBody) {
  const p = ball.translation();
  ball.setTranslation({ x: Math.min(p.x, EAST_FENCE_X - 0.8), y: Math.max(p.y, 0.9), z: p.z }, true);
  ball.setLinvel({ x: 3.2, y: 9, z: 0.4 }, true);
  ball.setAngvel({ x: 0, y: 0, z: -14 }, true);
}
