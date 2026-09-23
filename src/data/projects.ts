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
    pitch: ['Your ball went over the fence.', 'Get it back.'],
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
    unlocks: ['kite_in_tree', 'dog_ball'],
    focus: [16.5, 0.5, 5.6],
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
    ],
    unlocks: [],
    focus: [8.1, 3.1, 7.7],
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
    ],
    unlocks: [],
    focus: [-10, 0.5, 11],
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
