import type { SpawnDef } from './world';
import type { V3 } from './parts';

/**
 * Objectives are conditions over the physical state of the world. They never
 * name a machine or a solution: "the ball is back in our yard" is true no
 * matter how it got there.
 */
export type Cond =
  | { type: 'inZone'; tag: string; zone: string }
  | { type: 'held'; tag: string }
  | { type: 'touchedByPlayer'; tag: string }
  | { type: 'resting'; tag: string; speed?: number }
  | { type: 'below'; tag: string; y: number }
  | { type: 'above'; tag: string; y: number }
  | { type: 'snagged'; tag: string }
  | { type: 'outOfBounds'; tag: string }
  | { type: 'near'; a: string; b: string; dist: number }
  | { type: 'timeUnder'; seconds: number }
  | { type: 'all'; of: Cond[] }
  | { type: 'any'; of: Cond[] }
  | { type: 'not'; cond: Cond };

export interface BonusDef {
  id: string;
  label: string;
  /** never: fails the moment cond is ever true. atEnd: checked on success. */
  kind: 'never' | 'atEnd';
  cond: Cond;
}

export interface FailRule {
  cond: Cond;
  message: string;
  action: 'respawnTarget';
}

export interface SnagDef {
  tag: string;
  anchor: V3;
  /** Pull (N) needed to rip it free. */
  breakForce: number;
}

/** Which gauges the test results panel shows for a project. */
export type MetricId = 'reach' | 'grip' | 'push' | 'stability' | 'power';

/** A mental handle for a stuck player: a word and a question, never an answer. */
export interface Nudge {
  word: string;
  line: string;
}

export interface ProjectDef {
  id: string;
  title: string;
  /** Two short lines: the real-world problem. */
  pitch: [string, string];
  /** The one new engineering idea this project is about. */
  concept: { name: string; blurb: string };
  /** What the machine has to do, in broad strokes. Never how. */
  goals: string[];
  /** The curated parts bin: what is on the lab shelf for this project. */
  bin: Record<string, number>;
  /** Progressively more specific, only ever shown when asked for. */
  hints: [string, string, string, string];
  /** "What are you thinking?" prompts. */
  nudges: Nudge[];
  metrics: MetricId[];
  /** What the kid calls the thing they are after ("ball", "kite"). */
  target: string;
  /** Where the target has to end up, for the "how close did it get" readout. */
  goalZone: string;
  /** ...and how low it has to be, for things stuck up high. */
  goalBelow?: number;
  /** A good place to stand and set a machine down near the problem. */
  site: { label: string; pos: V3; yaw: number };
  /** Where GO FOR IT sets a machine down to work: in front of the gap, under the kite... */
  approach: V3;
  stage: number;
  props: SpawnDef[];
  snags?: SnagDef[];
  gateLocked: boolean;
  success: Cond;
  holdFor: number;
  fails: FailRule[];
  bonuses: BonusDef[];
  unlocks: string[];
  /** Where the camera looks during the intro. */
  focus: V3;
  intro?: 'ballOverFence';
}

const outOfBounds = (tag: string, message: string): FailRule => ({
  cond: { type: 'outOfBounds', tag },
  message,
  action: 'respawnTarget',
});

export const PROJECTS: ProjectDef[] = [
  {
    id: 'ball_over_fence',
    title: 'THE BALL',
    pitch: ['Your ball landed over the fence.', 'Get it back without climbing the fence.'],
    concept: { name: 'REACH', blurb: 'Getting at something you can’t get to.' },
    goals: ['Reach the ball on the other side', 'Get it past the fence: over, under or through', 'End with the ball back in your yard'],
    bin: { vacuum: 1, battery_car: 1, battery_small: 1, motor: 2, lawn_wheel: 4, plank: 2, crate: 1, rc_receiver: 1, duct_tape: 2, hinge: 1, bucket: 1 },
    hints: [
      'You can’t climb the fence. But does the ball have to come back OVER it?',
      'Look along the bottom of the fence. There’s a little gap. Something could reach through it, or pull the ball through it.',
      'The Shop Vac pulls light things toward it. It’s really hungry for power, though.',
      'Stick the Shop Vac onto the big Car Battery. Set it right in front of the gap, nozzle facing the ball, and TEST.',
    ],
    nudges: [
      { word: 'Reach', line: 'What could get close enough to touch the ball?' },
      { word: 'Pull', line: 'What if the ball came to me, instead of me going to it?' },
      { word: 'Drive', line: 'A little machine could go over there… and come back.' },
      { word: 'Grab', line: 'Once something reaches the ball, how does it hang on?' },
    ],
    metrics: ['reach', 'grip', 'stability', 'power'],
    target: 'ball',
    goalZone: 'home_yard',
    site: { label: 'TO THE FENCE', pos: [12.2, 0, 4.8], yaw: -Math.PI / 2 },
    approach: [15, 0, 4.8],
    stage: 1,
    props: [{ part: 'playground_ball', pos: [16.5, 0.11, 5.6], tag: 'target' }],
    gateLocked: true,
    success: {
      type: 'any',
      of: [
        { type: 'all', of: [{ type: 'inZone', tag: 'target', zone: 'home_yard' }, { type: 'not', cond: { type: 'held', tag: 'target' } }] },
        { type: 'all', of: [{ type: 'held', tag: 'target' }, { type: 'inZone', tag: 'player', zone: 'home_yard' }] },
      ],
    },
    holdFor: 0.6,
    fails: [outOfBounds('target', 'The ball bounced into the street. Mrs. Okafor tossed it back over.')],
    bonuses: [
      { id: 'stayed_home', label: 'Never set foot next door', kind: 'never', cond: { type: 'inZone', tag: 'player', zone: 'neighbor_yard' } },
      { id: 'hands_off', label: 'Hands off: a machine did it', kind: 'never', cond: { type: 'touchedByPlayer', tag: 'target' } },
      { id: 'quick', label: 'Under 5 minutes', kind: 'atEnd', cond: { type: 'timeUnder', seconds: 300 } },
    ],
    unlocks: ['dog_ball', 'kite_in_tree'],
    focus: [16.5, 0.5, 5.6],
    intro: 'ballOverFence',
  },
  {
    id: 'dog_ball',
    title: "BISCUIT'S BALL",
    pitch: ['The dog’s ball rolled under the shed.', 'Get it out. You can’t fit under there.'],
    concept: { name: 'AIM', blurb: 'Pointing a machine at exactly the right spot.' },
    goals: ['Get at the ball under the shed', 'Work through a really low gap', 'End with the ball out in the yard'],
    bin: { vacuum: 1, battery_car: 1, battery_small: 1, crate: 1, plank: 2, brick: 2, motor: 2, lawn_wheel: 4, rc_receiver: 1, duct_tape: 2, broom: 1 },
    hints: [
      'The gap under the shed is really skinny. Nothing tall is getting in there.',
      'You don’t have to go in after it. Could you make the ball come out to you?',
      'Whatever pulls it out has to be low, right at ground level, pointing straight under the shed.',
      'Put the Shop Vac on the Car Battery. Set it on the ground at the edge of the shed, nozzle pointing at the ball, and TEST.',
    ],
    nudges: [
      { word: 'Low', line: 'What’s short enough to work under the shed?' },
      { word: 'Pull', line: 'Could something pull it out without going in?' },
      { word: 'Aim', line: 'Where exactly does my machine need to point?' },
      { word: 'Poke', line: 'Could something long reach in and nudge it?' },
    ],
    metrics: ['reach', 'grip', 'stability', 'power'],
    target: 'ball',
    goalZone: 'home_yard',
    site: { label: 'TO THE SHED', pos: [-5.2, 0, 10.4], yaw: Math.PI / 2 },
    approach: [-7.9, 0, 11.2],
    stage: 1,
    props: [{ part: 'tennis_ball', pos: [-9.3, 0.034, 11.2], tag: 'target' }],
    gateLocked: true,
    success: {
      type: 'any',
      of: [
        { type: 'all', of: [{ type: 'not', cond: { type: 'inZone', tag: 'target', zone: 'under_shed' } }, { type: 'inZone', tag: 'target', zone: 'home_yard' }] },
        { type: 'held', tag: 'target' },
      ],
    },
    holdFor: 0.6,
    fails: [outOfBounds('target', 'The ball vanished. Biscuit found it and put it back under the shed. Of course.')],
    bonuses: [
      { id: 'hands_off', label: 'Hands off: a machine did it', kind: 'never', cond: { type: 'touchedByPlayer', tag: 'target' } },
      { id: 'quick', label: 'Under 3 minutes', kind: 'atEnd', cond: { type: 'timeUnder', seconds: 180 } },
    ],
    unlocks: [],
    focus: [-10, 0.5, 11],
  },
  {
    id: 'kite_in_tree',
    title: 'THE KITE',
    pitch: ['Your kite is stuck in the big tree.', 'Get it down without climbing the tree.'],
    concept: { name: 'PUSH', blurb: 'Wind, bumps and flying things push from far away.' },
    goals: ['Push the kite from down here, or get something up to it', 'Knock it free of the branch', 'Let it come down in your yard'],
    bin: { box_fan: 1, battery_small: 1, battery_car: 1, crate: 2, plank: 2, hinge: 2, bungee: 2, bottle_rocket: 2, balloons: 2, duct_tape: 2, brick: 2 },
    hints: [
      'The kite is only snagged. It won’t take much to knock it loose.',
      'You can’t reach it, but you can push it from far away. Wind, a bump, something flying…',
      'A Box Fan makes wind. What if it blew UP instead of sideways?',
      'Lay the Box Fan on its back on top of a crate, right under the kite, with a battery on the crate. TEST it, then RESET so the kite drops.',
    ],
    nudges: [
      { word: 'Bump', line: 'Something just needs to bump it off the branch.' },
      { word: 'Wind', line: 'Air pushes things. Can air go UP?' },
      { word: 'Launch', line: 'What if something flew up there?' },
      { word: 'Float', line: 'What goes up all by itself?' },
    ],
    metrics: ['reach', 'push', 'stability', 'power'],
    target: 'kite',
    goalZone: 'home_yard',
    goalBelow: 0.7,
    site: { label: 'TO THE TREE', pos: [9.6, 0, 9.4], yaw: Math.atan2(1.55, 1.74) },
    approach: [8.05, 0, 7.66],
    stage: 1,
    props: [{ part: 'kite', pos: [8.05, 2.93, 7.66], rot: [90, 0, 35], tag: 'target' }],
    snags: [{ tag: 'target', anchor: [8.05, 3.35, 7.66], breakForce: 12 }],
    gateLocked: true,
    success: {
      type: 'any',
      of: [
        {
          type: 'all',
          of: [
            { type: 'not', cond: { type: 'snagged', tag: 'target' } },
            { type: 'below', tag: 'target', y: 0.7 },
            { type: 'inZone', tag: 'target', zone: 'home_yard' },
          ],
        },
        { type: 'held', tag: 'target' },
      ],
    },
    holdFor: 0.8,
    fails: [outOfBounds('target', 'The kite blew into the street. A kind stranger brought it back to the tree. Somehow.')],
    bonuses: [
      { id: 'hands_off', label: 'Hands off: a machine did it', kind: 'never', cond: { type: 'touchedByPlayer', tag: 'target' } },
      { id: 'quick', label: 'Under 5 minutes', kind: 'atEnd', cond: { type: 'timeUnder', seconds: 300 } },
    ],
    unlocks: [],
    focus: [8.1, 3.1, 7.7],
  },
];

export const PROJECT_MAP: Record<string, ProjectDef> = Object.fromEntries(PROJECTS.map((p) => [p.id, p]));

export interface StageDef {
  n: number;
  name: string;
  tagline: string;
  teasers: string[];
  ideas?: string[];
}

/**
 * The long road. Only stage 1 is playable in this slice. Each project adds one
 * new idea; `ideas` are the ones waiting further down the road.
 */
export const STAGES: StageDef[] = [
  { n: 1, name: 'JUNK', tagline: 'Household stuff. Backyard problems.', teasers: [] },
  { n: 2, name: 'CONTRAPTIONS', tagline: 'Ropes, pulleys, springs, motors.', teasers: ['Package on the roof', 'Water the far tomatoes'], ideas: ['LEVERAGE', 'PULLEYS'] },
  { n: 3, name: 'MACHINES', tagline: 'Gears, winches, hydraulics.', teasers: ['Move the big rock', 'Fix the bike'], ideas: ['POWER', 'STABILITY'] },
  { n: 4, name: 'VEHICLES', tagline: 'Carts, karts, RC everything.', teasers: ['Deliver the lemonade', 'Cross the creek'], ideas: ['MOVEMENT', 'MOMENTUM'] },
  { n: 5, name: 'FLIGHT', tagline: 'Fans, wings, balloons, gliders.', teasers: ['See over the whole street'] },
  { n: 6, name: 'HIGH ALTITUDE', tagline: 'Lighter. Stronger. Higher.', teasers: ['Touch a cloud'] },
  { n: 7, name: 'SPACE', tagline: 'You just kept asking "a little farther?"', teasers: ['???'] },
];
