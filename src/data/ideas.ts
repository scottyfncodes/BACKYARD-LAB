import type { V3 } from './parts';

/**
 * "Ideas": optional guided builds, like a page of Lego instructions. They are
 * never the only answer; they just get a stuck builder moving. Each step says
 * what goes where, relative to earlier steps.
 */
export interface IdeaStep {
  part: string;
  say: string;
  socket?: string;
  spin?: number;
  /** Put it loose on the mat at (x, z). */
  free?: [number, number];
  /** Stick it onto the part placed in an earlier step, at a point in that part's frame. */
  on?: number;
  local?: V3;
  normal?: V3;
  /** Plug it into a named joint (motor shaft, hinge leaf) of an earlier step's part. */
  into?: { step: number; target: string };
  /** Tie a rope / bungee between two earlier steps' parts (any two points on them will do). */
  tie?: { a: number; aLocal: V3; b: number; bLocal: V3; length?: number };
}

export interface Idea {
  id: string;
  project: string;
  title: string;
  pitch: string;
  steps: IdeaStep[];
  after: string;
}

export const IDEAS: Idea[] = [
  {
    id: 'big_vac',
    project: 'dog_ball',
    title: 'The Big Vac',
    pitch: 'A shop vac strapped to the car battery, nozzle pointing into the gap under the shed.',
    steps: [
      { part: 'battery_car', say: 'The car battery goes down first. It is the heavy bit, so it is the base.', free: [0, 0], socket: 'bottom' },
      { part: 'vacuum', say: 'Press the back of the vac against the side of the battery. The nozzle points away.', on: 0, local: [0, 0.08, 0.09], normal: [0, 0, 1], socket: 'back' },
    ],
    after: 'Set it down right in front of the gap under the shed, nozzle pointing in, and hit GO.',
  },
  {
    id: 'updraft',
    project: 'kite_in_tree',
    title: 'Updraft',
    pitch: 'A box fan lying on its back on a crate, blowing straight up at the kite.',
    steps: [
      { part: 'crate', say: 'A crate on the mat. Something to get the fan off the ground.', free: [0, 0], socket: 'bottom' },
      { part: 'box_fan', say: 'The fan on its back on top of the crate, so it blows UP.', on: 0, local: [0, 0.2, 0], normal: [0, 1, 0], socket: 'back' },
      { part: 'battery_small', say: 'Battery on the side of the crate. The fan does nothing without it.', on: 0, local: [0, 0, 0.25], normal: [0, 0, 1], socket: 'side' },
    ],
    after: 'Carry it right under the kite, put it down, and hit GO.',
  },
  {
    id: 'balloon_lift',
    project: 'treehouse_lunch',
    title: 'Balloon Lift',
    pitch: 'Balloons tied to a bucket, and a rope from the bucket to a brick so it cannot float away.',
    steps: [
      { part: 'bucket', say: 'Bucket on the mat. The lunch rides in this.', free: [0, 0], socket: 'bottom' },
      { part: 'brick', say: 'A brick next to it. This is the anchor.', free: [0.6, 0], socket: 'flat' },
      { part: 'balloons', say: 'Tie balloons to the rim of the bucket.', on: 0, local: [0.12, 0.15, 0], normal: [0, 1, 0], socket: 'string' },
      { part: 'balloons', say: 'More balloons. Two bunches is not enough for a bucket.', on: 0, local: [-0.06, 0.15, 0.1], normal: [0, 1, 0], socket: 'string' },
      { part: 'balloons', say: 'A third bunch. Check the deck if you are out.', on: 0, local: [-0.06, 0.15, -0.1], normal: [0, 1, 0], socket: 'string' },
      { part: 'rope', say: 'Now tie the rope from the bucket to the brick, so the bucket can only go so high.', tie: { a: 0, aLocal: [0, -0.15, 0], b: 1, bLocal: [0, 0.032, 0], length: 3 } },
    ],
    after: 'Put it down next to the treehouse, drop the lunchbox in the bucket, and hit GO. Tap the rope if it needs to be longer.',
  },
  {
    id: 'sticky_rc_car',
    project: 'ball_over_fence',
    title: 'Sticky RC Car',
    pitch: 'A little car low enough to drive under the gap in the fence, with duct tape on the nose to grab the ball.',
    steps: [
      { part: 'plank', say: 'Lay the plank on the mat. That is the body of the car.', free: [0, 0], socket: 'flat' },
      { part: 'motor', say: 'Stick a motor on the side, near the back.', on: 0, local: [-0.45, 0, 0.075], normal: [0, 0, 1], socket: 'back' },
      { part: 'motor', say: 'And another motor on the other side.', on: 0, local: [-0.45, 0, -0.075], normal: [0, 0, -1], socket: 'back' },
      { part: 'lawn_wheel', say: 'A wheel on the motor shaft. The motor will spin it.', into: { step: 1, target: 'shaft' }, socket: 'hub' },
      { part: 'lawn_wheel', say: 'Same on the other motor.', into: { step: 2, target: 'shaft' }, socket: 'hub' },
      { part: 'lawn_wheel', say: 'A free-spinning wheel at the front.', on: 0, local: [0.45, 0, 0.075], normal: [0, 0, 1], socket: 'hub' },
      { part: 'lawn_wheel', say: 'And the last wheel.', on: 0, local: [0.45, 0, -0.075], normal: [0, 0, -1], socket: 'hub' },
      { part: 'battery_small', say: 'Battery on top. Motors do nothing without it.', on: 0, local: [-0.2, 0.015, 0], normal: [0, 1, 0], socket: 'bottom' },
      { part: 'rc_receiver', say: 'The RC brain, so you can drive it. The arrow points forward.', on: 0, local: [0.2, 0.015, 0], normal: [0, 1, 0], socket: 'bottom' },
      { part: 'duct_tape', say: 'Duct tape on the nose. Sticky side out!', on: 0, local: [0.6, 0, 0], normal: [1, 0, 0], socket: 'back' },
    ],
    after: 'Point it at the gap under the fence, hit GO and drive it through. Bump the ball, then back up!',
  },
  {
    id: 'fence_flinger',
    project: 'newspaper',
    title: 'Fence Flinger',
    pitch: 'Two crates, a hinge, a plank for an arm and two bungees to yank it. A backyard catapult.',
    steps: [
      { part: 'crate', say: 'One crate on the mat.', free: [0, 0], socket: 'bottom' },
      { part: 'crate', say: 'Another crate on top. Height makes a better throw.', on: 0, local: [0, 0.2, 0], normal: [0, 1, 0], socket: 'bottom' },
      { part: 'hinge', say: 'The hinge on top, towards one edge.', on: 1, local: [0, 0.2, -0.15], normal: [0, 1, 0], socket: 'base' },
      { part: 'plank', say: 'The plank on the hinge. It should swing like a seesaw.', into: { step: 2, target: 'swing' }, socket: 'flat', spin: 90 },
      { part: 'bungee', say: 'Tie a bungee from one end of the plank down to the bottom crate.', tie: { a: 3, aLocal: [0.55, 0.015, 0], b: 0, bLocal: [0, -0.1, 0.25] } },
      { part: 'bungee', say: 'And a second bungee next to it. Twice the yank.', tie: { a: 3, aLocal: [0.5, 0.015, 0.05], b: 0, bLocal: [0.2, -0.1, 0.25] } },
    ],
    after: 'Set it near the fence with the free end of the arm pointing AWAY from the fence. Put the newspaper on that end, stand back, hit GO.',
  },
];

export function ideaFor(projectId: string | null): Idea | null {
  return IDEAS.find((i) => i.project === projectId) ?? null;
}
