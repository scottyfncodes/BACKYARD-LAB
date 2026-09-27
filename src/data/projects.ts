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
  /** never: fails the moment cond is ever true. atEnd: checked on success. ever: earned if cond was ever true. */
  kind: 'never' | 'atEnd' | 'ever';
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

export interface ProjectDef {
  id: string;
  title: string;
  /** Two short lines. That is the whole briefing. */
  pitch: [string, string];
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
  /** A hand-placed intro shot; without one the camera stands back from `focus`. */
  introCam?: { pos: V3; look: V3 };
  /** Start the kid somewhere else, or facing their problem (yaw in degrees, 0 = facing the house). */
  spawn?: { pos?: V3; yaw?: number };
  intro?: 'ballOverFence';
  /** One new piece of junk that turns up in the yard once this is solved, with the kid's one line about it. */
  reward?: SpawnDef & { story: string };
}

const outOfBounds = (tag: string, message: string): FailRule => ({
  cond: { type: 'outOfBounds', tag },
  message,
  action: 'respawnTarget',
});

/** The opening shot: the ball bounces once on the lawn here, then sails over the fence to where the project put it. */
export const BALL_INTRO = { from: [10.2, 0.2, 4.4] as V3, kick: [0.12, -1, 0.04] as V3, cam: { pos: [7.5, 1.3, 1.2] as V3, look: [11.5, 1.2, 4.6] as V3 } };

const ballHome: Cond = {
  type: 'any',
  of: [
    { type: 'all', of: [{ type: 'inZone', tag: 'target', zone: 'home_yard' }, { type: 'not', cond: { type: 'held', tag: 'target' } }] },
    { type: 'all', of: [{ type: 'held', tag: 'target' }, { type: 'inZone', tag: 'player', zone: 'home_yard' }] },
  ],
};

export const PROJECTS: ProjectDef[] = [
  {
    id: 'ball_over_fence',
    title: 'THE BALL',
    pitch: ['Your ball went over the fence.', 'Get it back.'],
    stage: 1,
    // Lands a couple of metres past the fence, a little off the line of the gap.
    props: [{ part: 'playground_ball', pos: [16.5, 0.11, 5.6], tag: 'target' }],
    gateLocked: true,
    success: ballHome,
    holdFor: 0.6,
    fails: [outOfBounds('target', 'The ball bounced into the street. Mrs. Okafor tossed it back over.')],
    bonuses: [
      { id: 'stayed_home', label: 'Never set foot next door', kind: 'never', cond: { type: 'inZone', tag: 'player', zone: 'neighbor_yard' } },
      { id: 'hands_off', label: 'Hands off: a machine did it', kind: 'never', cond: { type: 'touchedByPlayer', tag: 'target' } },
      { id: 'quick', label: 'Under 5 minutes', kind: 'atEnd', cond: { type: 'timeUnder', seconds: 300 } },
      { id: 'airmail', label: 'Airmail: it came back OVER the fence', kind: 'ever', cond: { type: 'all', of: [{ type: 'above', tag: 'target', y: 2.3 }, { type: 'inZone', tag: 'target', zone: 'home_yard' }] } },
    ],
    unlocks: ['ball_again'],
    reward: { part: 'rc_receiver', pos: [1.6, 0.24, -7.6], rotY: 40, story: 'Another RC brain, at the bottom of the toy box. The truck it came from is long gone.' },
    focus: [16.5, 0.5, 5.6],
    introCam: BALL_INTRO.cam,
    intro: 'ballOverFence',
  },
  {
    id: 'ball_again',
    title: 'THE BALL. AGAIN.',
    pitch: ['It went over the fence again. WAY over this time.', 'Get it back.'],
    stage: 1,
    // Too far from the gap for anything that just reaches. Something has to go and get it.
    props: [{ part: 'playground_ball', pos: [22.5, 0.11, 2.6], tag: 'target' }],
    gateLocked: true,
    success: ballHome,
    holdFor: 0.6,
    fails: [outOfBounds('target', 'The ball bounced into the street. Mrs. Okafor tossed it back over. Again.')],
    bonuses: [
      { id: 'stayed_home', label: 'Never set foot next door', kind: 'never', cond: { type: 'inZone', tag: 'player', zone: 'neighbor_yard' } },
      { id: 'hands_off', label: 'Hands off: a machine did it', kind: 'never', cond: { type: 'touchedByPlayer', tag: 'target' } },
      { id: 'quick', label: 'Under 5 minutes', kind: 'atEnd', cond: { type: 'timeUnder', seconds: 300 } },
      { id: 'biscuit', label: 'Biscuit got involved', kind: 'ever', cond: { type: 'near', a: 'dog', b: 'target', dist: 0.55 } },
    ],
    unlocks: ['kite_in_tree', 'dog_ball'],
    reward: { part: 'battery_car', pos: [-6.2, 0.12, -0.6], rotY: 25, story: 'Dad said this one was dead. It is not dead.' },
    focus: [22.5, 0.5, 2.6],
    introCam: BALL_INTRO.cam,
    intro: 'ballOverFence',
  },
  {
    id: 'kite_in_tree',
    title: 'THE KITE',
    pitch: ['Your kite is stuck in the big tree.', 'Get it down.'],
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
      { id: 'airlift', label: 'Airlift: it went UP first', kind: 'ever', cond: { type: 'above', tag: 'target', y: 3.6 } },
    ],
    unlocks: [],
    reward: { part: 'balloons', pos: [11.6, 1.6, 10.6], tie: [11.4, 0.6, 10.8], story: 'Left over from somebody\'s party. They came over the fence on their own.' },
    focus: [8.1, 3.1, 7.7],
    // From the lawn beside the tree, looking up at the kite hanging under the branch.
    introCam: { pos: [10.6, 0.9, 10.4], look: [8.05, 3.0, 7.66] },
  },
  {
    id: 'dog_ball',
    title: "BISCUIT'S BALL",
    pitch: ["The dog's ball rolled under the shed.", 'Get it out.'],
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
      { id: 'popup', label: 'Popped it up into the air', kind: 'ever', cond: { type: 'above', tag: 'target', y: 1.0 } },
    ],
    unlocks: [],
    reward: { part: 'trampoline', pos: [-4.8, 0, 5.4], story: 'Mrs. Okafor\'s old trampoline. She said we could have it if we carried it.' },
    focus: [-10, 0.5, 11],
    // Dog's-eye view: flat on the lawn, looking under the shed at the ball.
    // Cheek on the grass at the shed's edge, looking straight under it at the ball.
    introCam: { pos: [-7.7, 0.09, 11.55], look: [-9.3, 0.04, 11.2] },
    spawn: { yaw: 155 },
  },
];

export const PROJECT_MAP: Record<string, ProjectDef> = Object.fromEntries(PROJECTS.map((p) => [p.id, p]));

export interface StageDef {
  n: number;
  name: string;
  tagline: string;
  teasers: string[];
}

/** The long road. Only stage 1 is playable in this slice. */
export const STAGES: StageDef[] = [
  { n: 1, name: 'JUNK', tagline: 'Household stuff. Backyard problems.', teasers: [] },
  { n: 2, name: 'CONTRAPTIONS', tagline: 'Ropes, pulleys, springs, motors.', teasers: ['Package on the roof', 'Water the far tomatoes'] },
  { n: 3, name: 'MACHINES', tagline: 'Gears, winches, hydraulics.', teasers: ['Move the big rock', 'Fix the bike'] },
  { n: 4, name: 'VEHICLES', tagline: 'Carts, karts, RC everything.', teasers: ['Deliver the lemonade', 'Cross the creek'] },
  { n: 5, name: 'FLIGHT', tagline: 'Fans, wings, balloons, gliders.', teasers: ['See over the whole street'] },
  { n: 6, name: 'HIGH ALTITUDE', tagline: 'Lighter. Stronger. Higher.', teasers: ['Touch a cloud'] },
  { n: 7, name: 'SPACE', tagline: 'You just kept asking "a little farther?"', teasers: ['???'] },
];
