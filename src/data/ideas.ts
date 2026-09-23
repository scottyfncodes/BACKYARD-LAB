import type { V3 } from './parts';

/**
 * "Ideas": optional guided builds, like a page of Lego instructions. They are
 * never the only answer; they just get a first-time builder unstuck. Each step
 * says what goes where, relative to earlier steps.
 */
export interface IdeaStep {
  part: string;
  say: string;
  socket?: string;
  spin?: number;
  /** Put it loose on the bench at (x, z). */
  free?: [number, number];
  /** Stick it onto the part placed in an earlier step, at a point in that part's frame. */
  on?: number;
  local?: V3;
  normal?: V3;
  /** Plug it into a named joint (motor shaft, hinge leaf) of an earlier step's part. */
  into?: { step: number; target: string };
}

export interface Idea {
  id: string;
  projects: string[];
  title: string;
  pitch: string;
  steps: IdeaStep[];
  after: string;
}

export const IDEAS: Idea[] = [
  {
    id: 'sticky_rc_car',
    projects: ['ball_over_fence', 'dog_ball'],
    title: 'Sticky RC Car',
    pitch: 'A little car low enough to drive under the gap in the fence, with duct tape on the nose to grab the ball.',
    steps: [
      { part: 'plank', say: 'Lay the plank on the bench. That is the body of the car.', free: [0, 0], socket: 'flat' },
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
    after: 'Carry it out to the gap under the fence, point it at the ball, hit GO and drive it through!',
  },
];

export function ideasFor(projectId: string | null): Idea[] {
  return IDEAS.filter((i) => (projectId ? i.projects.includes(projectId) : true));
}

/** Where a first-timer can find each piece of junk in the yard. */
export const WHERE: Record<string, string> = {
  plank: 'the junk pile by the garage',
  crate: 'the junk pile by the garage',
  broom: 'the garage',
  skateboard: 'the lawn near the sandbox',
  bucket: 'the junk pile or the garden',
  lawn_wheel: 'the junk pile by the garage',
  bike_wheel: 'next to the shed',
  motor: 'the lab bench',
  battery_small: 'the lab bench',
  battery_car: 'the back of the garage',
  box_fan: 'the deck',
  vacuum: 'the garage',
  balloons: 'the deck (tied to the table)',
  rope: 'next to the shed',
  bungee: 'next to the shed',
  spring: 'the junk pile by the garage',
  hinge: 'the lab bench and shelf',
  duct_tape: 'the lab bench',
  bottle_rocket: 'the end of the deck',
  timer: 'the lab shelf',
  pressure_plate: 'the back door (it is the doormat)',
  rc_receiver: 'the toy box on the deck',
  winch: 'the back of the garage',
  trampoline: 'the lawn',
  brick: 'the garden bed',
};
