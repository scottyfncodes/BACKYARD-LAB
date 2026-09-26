import type { SpawnDef } from './world';
import type { V3 } from './parts';

/**
 * A project is one backyard problem, a small curated kit of junk, and a
 * condition over the physical world. The engine never checks which machine
 * or method was used: "the ball is back in our yard" is true no matter how
 * it got there.
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
  /** One line telling the kid where to look. */
  where: string;
  /** The curated junk for this problem: part id -> how many. */
  kit: Record<string, number>;
  /** Extra junk lying around the yard for this project. Not in the kit until you pick it up. */
  yard: SpawnDef[];
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
  /** What the kid writes in the notebook after solving it. */
  lesson: string;
  /** Idle thoughts while the kid stands around with no machine out. */
  hints: string[];
  /** Thoughts after a failed run, in order (the last one repeats). */
  nudges: string[];
}

const outOfBounds = (tag: string, message: string): FailRule => ({
  cond: { type: 'outOfBounds', tag },
  message,
  action: 'respawnTarget',
});

const handsOff: BonusDef = { id: 'hands_off', label: 'Hands off: a machine did it', kind: 'never', cond: { type: 'touchedByPlayer', tag: 'target' } };
const stayedHome: BonusDef = { id: 'stayed_home', label: 'Never set foot next door', kind: 'never', cond: { type: 'inZone', tag: 'player', zone: 'neighbor_yard' } };
const quick = (seconds: number): BonusDef => ({ id: 'quick', label: `Under ${Math.round(seconds / 60)} minutes`, kind: 'atEnd', cond: { type: 'timeUnder', seconds } });

export const PROJECTS: ProjectDef[] = [
  {
    id: 'dog_ball',
    title: "BISCUIT'S BALL",
    pitch: ["The dog's ball rolled under the shed.", 'Get it out.'],
    where: 'The shed, back-left corner of the yard. There is a skinny gap underneath.',
    kit: { vacuum: 1, battery_car: 1 },
    yard: [],
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
    bonuses: [handsOff, quick(180)],
    unlocks: ['kite_in_tree'],
    focus: [-10, 0.5, 11],
    lesson: 'A shop vac grabs anything light that it can see. Nothing works without a battery stuck to it.',
    hints: ['I cannot reach under there. My arms are not long enough.', 'Wait. They gave me a VACUUM?', 'The vac needs the battery stuck to the same machine.'],
    nudges: ['Is the nozzle actually pointing at the ball? Pick it up and turn it.', 'Closer. It has to be close enough to feel the suction.', 'Does it have the battery stuck on? It does nothing without power.'],
  },
  {
    id: 'kite_in_tree',
    title: 'THE KITE',
    pitch: ['Your kite is stuck in the big tree.', 'Get it down.'],
    where: 'The big tree in the middle of the yard. Look up.',
    kit: { box_fan: 1, crate: 2, battery_small: 1 },
    yard: [{ part: 'duct_tape', pos: [9.4, 0.03, 8.9] }],
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
    bonuses: [handsOff, quick(300)],
    unlocks: ['treehouse_lunch'],
    focus: [8.1, 3.1, 7.7],
    lesson: 'A fan pushes air, and air pushes things. Aim the WIND, not the fan.',
    hints: ['It is only snagged on one branch. A good push would do it.', 'A box fan makes a LOT of wind. Which way should it blow?', 'Crates stack. Higher is closer.'],
    nudges: ['The wind has to actually hit the kite. Look at where the fan is pointing.', 'Is the fan even on? It needs a battery stuck to the same machine.', 'Get it closer. Wind runs out of puff after a few metres.'],
  },
  {
    id: 'treehouse_lunch',
    title: 'TREEHOUSE LUNCH',
    pitch: ['Treehouse rules: no climbing with food.', 'Get the lunchbox up to the treehouse anyway.'],
    where: 'The treehouse platform, halfway up the big tree. The lunchbox is on the patio table.',
    kit: { bucket: 1, balloons: 2, rope: 1, brick: 1, duct_tape: 1 },
    yard: [{ part: 'balloons', pos: [3.4, 1.6, -7.8], tie: [3.0, 0.6, -7.9] }],
    props: [{ part: 'lunchbox', pos: [2.4, 0.98, -8.4], tag: 'target' }],
    gateLocked: true,
    success: { type: 'all', of: [{ type: 'above', tag: 'target', y: 2.3 }, { type: 'inZone', tag: 'target', zone: 'in_tree' }, { type: 'not', cond: { type: 'held', tag: 'target' } }] },
    holdFor: 1.2,
    fails: [outOfBounds('target', 'The lunch floated away over the roof. Mom is NOT going to like that.')],
    bonuses: [quick(300)],
    unlocks: ['ball_over_fence'],
    focus: [6, 2.9, 6],
    lesson: 'Balloons pull up. Weight pulls down. A rope decides how far it goes.',
    hints: ['Balloons pull UP. How much can they carry?', 'Something has to hold the lunch. Something light.', 'Are there any more balloons around here?', 'If it floats away I am in trouble. A rope, maybe?'],
    nudges: ['Not enough lift. Fewer heavy things, or more balloons.', 'It floated off! Tie it to something heavy so it can only go so far.', 'The rope has to be long enough to reach the treehouse. Tap the rope to change its length.'],
  },
  {
    id: 'ball_over_fence',
    title: 'THE BALL',
    pitch: ['Your ball went over the fence.', 'Get it back.'],
    where: "Mrs. Okafor's yard, through the fence on the right. The gate is locked from her side.",
    kit: { plank: 1, motor: 2, lawn_wheel: 4, battery_small: 1, rc_receiver: 1, duct_tape: 2 },
    yard: [{ part: 'trampoline', pos: [2.5, 0.0, 1.5] }],
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
    bonuses: [stayedHome, handsOff, quick(300)],
    unlocks: ['newspaper'],
    focus: [16.5, 0.5, 5.6],
    intro: 'ballOverFence',
    lesson: 'Motors spin whatever is on their shaft. An RC brain steers whatever the motors move.',
    hints: ['Something dug under the fence. There is a little gap at the bottom.', 'That gap is small. But something small and low could fit.', 'Wheels on motor shafts. The RC brain drives them. Duct tape to grab.'],
    nudges: ['Too tall for the gap? Keep it low and flat.', 'The RC brain points the way the car thinks is forward. The arrow on it matters.', 'Sticky side out! Tape on the nose grabs the ball, then reverse.'],
  },
  {
    id: 'newspaper',
    title: 'SPECIAL DELIVERY',
    pitch: ["Mrs. Okafor's newspaper landed in OUR yard.", 'Get it back over the fence.'],
    where: 'The newspaper is by the fence on the right. Her yard is on the other side.',
    kit: { plank: 1, hinge: 1, crate: 2, bungee: 2, brick: 1, timer: 1 },
    yard: [
      { part: 'bottle_rocket', pos: [5.5, 0.18, -9.4] },
      { part: 'duct_tape', pos: [5.9, 0.03, -9.3] },
      { part: 'spring', pos: [-6.2, 0.06, 4.2] },
    ],
    props: [{ part: 'newspaper', pos: [12.2, 0.04, 1.2], rotY: 20, tag: 'target' }],
    gateLocked: true,
    success: { type: 'all', of: [{ type: 'inZone', tag: 'target', zone: 'neighbor_yard' }, { type: 'below', tag: 'target', y: 0.6 }, { type: 'not', cond: { type: 'held', tag: 'target' } }] },
    holdFor: 1.0,
    fails: [outOfBounds('target', 'It went clean over her house and into the street. A jogger tossed it back.')],
    bonuses: [stayedHome, quick(360)],
    unlocks: [],
    focus: [13, 0.5, 1.2],
    lesson: 'A hinge makes a lever. Stretched rubber stores energy. Height and a long arm make a throw.',
    hints: ['I could just walk it round. But the gate is locked, and where is the fun in that.', 'A plank on a hinge is a lever. Pull one end down hard enough and the other end FLIES.', 'Bungee cords store energy. Stretch one and let go.'],
    nudges: ['Not enough oomph. A second bungee? A taller stand?', 'Was the paper on the arm? It has to sit on the end that goes UP.', 'Point the throwing end at the fence, and get closer to it.'],
  },
];

export const PROJECT_MAP: Record<string, ProjectDef> = Object.fromEntries(PROJECTS.map((p) => [p.id, p]));

/** Parts in this project's kit that no earlier project ever handed out. */
export function newKitParts(p: ProjectDef): string[] {
  const seen = new Set<string>();
  for (const q of PROJECTS) {
    if (q === p) break;
    for (const id of Object.keys(q.kit)) seen.add(id);
    for (const y of q.yard) seen.add(y.part);
  }
  return Object.keys(p.kit).filter((id) => !seen.has(id));
}
