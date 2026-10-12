import type { WagonCheck } from '../sim/wagonbuild';
import type { PushVerdict } from './pushtest';

/**
 * The first-play coach for MISSION 0.
 *
 * Every step is a question about the real game state ("is there a body on the
 * bench yet?", "has the wagon been pulled?"), never a timer or a button that
 * only exists for the tutorial. The coach shows the first step that isn't true
 * yet, so it keeps up when the kid skips ahead and steps back when they undo
 * something (take a wheel off and it asks for wheels again).
 */
export interface CoachSnapshot {
  mode: string;
  touch: boolean;
  /** What the bench thinks of the machine on it (null: nothing on the bench, or the wagon is already out). */
  check: WagonCheck | null;
  benchParts: number;
  /** Close enough to the bench that its button says BUILD. */
  nearBench: boolean;
  /** The part in hand at the bench, if any. */
  holding: string | null;
  /** A push test is running or showing its result. */
  pushing: boolean;
  /** How many push tests have been started on the machine as it is now (a change starts the count over). */
  pushes: number;
  /** Any push test at all this mission, for "push it AGAIN". */
  pushedBefore: boolean;
  /** A push test has been reset at least once. */
  pushReset: boolean;
  /** How the last push of the machine as it is now went. */
  lastPush: PushVerdict['mood'] | null;
  wagonOut: boolean;
  everHitched: boolean;
  hitched: boolean;
  carrying: boolean;
  load: number;
  solved: boolean;
}

/** What the coach points at: a piece of UI (CSS selector), and/or a place in the yard. */
export interface CoachTarget {
  ui?: string;
  world?: 'junk' | 'lab' | 'wagon';
  /** Animated finger: from the UI target to the middle of the bench. */
  demo?: 'drag';
}

export interface CoachStep {
  id: string;
  /** Which beat of the loop this step teaches. */
  beat: 'build' | 'test' | 'watch' | 'change' | 'use';
  done(s: CoachSnapshot): boolean;
  /** Only shown when this is true (default: always). */
  when?(s: CoachSnapshot): boolean;
  title(s: CoachSnapshot): string;
  tip(s: CoachSnapshot): string;
  target(s: CoachSnapshot): CoachTarget;
}

const slot = (...ids: string[]) => ids.map((id) => `.tray .slot[data-part="${id}"]`).join(', ');
const PLACE = '.place-bar .btn.go';
const note = (s: CoachSnapshot, ...ids: string[]) => s.check?.notes.find((n) => ids.includes(n.id as string) && !n.done)?.text ?? null;
const atBench = (s: CoachSnapshot) => s.mode === 'build';
/** With a part in hand, the next move is always the same: put it where it goes. */
const LINKS = new Set(['rope', 'bungee', 'spring']);
const placing = (s: CoachSnapshot, what: string): { tip: string; target: CoachTarget } | null => {
  if (!s.holding) return null;
  // Ropes and the like are tied end to end, and their button says so.
  if (LINKS.has(s.holding)) return { tip: 'Tap where one end goes, then ✔ TIE END; then the other end and ✔ TIE HERE.', target: { ui: PLACE } };
  return { tip: s.touch ? `Drag the glowing ${what} where it should join, then tap ✔ PLACE.` : `Move the glowing ${what} where it should join, then click (or ✔ PLACE).`, target: { ui: PLACE } };
};

export const WAGON_STEPS: CoachStep[] = [
  // While a push test is on, watching it is the only thing that matters.
  {
    id: 'watch',
    beat: 'watch',
    when: (s) => s.pushing,
    done: (s) => s.wagonOut || !s.pushing,
    title: () => 'Watch what happens',
    tip: () => 'Read what it did, then tap ↺ RESET to put it back on the bench.',
    target: () => ({ ui: '[data-act="pushreset"]' }),
  },
  {
    id: 'bench',
    beat: 'build',
    done: (s) => atBench(s) || s.wagonOut,
    title: (s) => (s.benchParts ? 'Back to the workbench' : 'Head to the workbench'),
    tip: (s) => {
      const label = s.nearBench ? '🔧 BUILD' : '🔧 BENCH';
      return s.touch ? `Tap ${label}. Your parts bin is waiting there.` : `Press ${s.nearBench ? 'E' : 'B'} (or click ${label}). Your parts bin is waiting there.`;
    },
    // The button takes you there in one tap; the beacon shows where "there" is.
    target: () => ({ ui: '.actions [data-act="bench"], .actions [data-act="build"]', world: 'lab' }),
  },
  {
    id: 'body',
    beat: 'build',
    done: (s) => s.wagonOut || s.check?.body != null,
    title: () => 'Lay down something to carry stuff on',
    tip: (s) => placing(s, 'part')?.tip ?? (s.touch ? 'Tap the Wooden Plank in your parts bin, then tap the bench.' : 'Click the Wooden Plank in your parts bin, then click the bench.'),
    target: (s) => placing(s, 'part')?.target ?? { ui: slot('plank', 'crate'), demo: 'drag' },
  },
  {
    id: 'wheels',
    beat: 'build',
    done: (s) => s.wagonOut || (!!s.check && s.check.wheels >= 3 && s.check.spread && s.check.rolls),
    title: (s) => `Add wheels on its sides${s.check ? ` · ${Math.min(s.check.wheels, 4)}/4` : ''}`,
    tip: (s) => placing(s, 'wheel')?.tip ?? note(s, 'wheels', 'spread', 'rolls') ?? 'A wheel’s hub pressed onto the SIDE of something becomes an axle.',
    target: (s) => placing(s, 'wheel')?.target ?? { ui: slot('lawn_wheel', 'bike_wheel'), demo: 'drag' },
  },
  {
    id: 'handle',
    beat: 'build',
    done: (s) => s.wagonOut || s.check?.handle != null,
    title: () => 'Give it a handle to pull',
    tip: (s) => placing(s, 'handle')?.tip ?? 'Something long, stuck onto one end. The Broom would do.',
    target: (s) => placing(s, 'handle')?.target ?? { ui: slot('broom'), demo: 'drag' },
  },
  {
    id: 'push',
    beat: 'test',
    done: (s) => s.wagonOut || s.pushes > 0,
    title: (s) => (s.pushedBefore ? 'Changed it? Test it again' : 'Experiment: does it roll?'),
    tip: (s) => (s.pushedBefore ? 'Tap 👉 PUSH TEST and see what the change did.' : 'Tap 👉 PUSH TEST. It goes on the floor and gets a real shove.'),
    target: () => ({ ui: '[data-act="push"]' }),
  },
  {
    id: 'change',
    beat: 'change',
    when: (s) => s.pushes > 0 && s.lastPush !== null && s.lastPush !== 'rolled',
    done: (s) => s.wagonOut || s.lastPush === 'rolled',
    title: () => 'Change one thing, then push again',
    tip: (s) => note(s, 'wheels', 'spread', 'rolls', 'handle') ?? 'Look at what went wrong on the last push. Fix that one thing.',
    target: () => ({ ui: '[data-act="push"]' }),
  },
  {
    id: 'rollout',
    beat: 'use',
    done: (s) => s.wagonOut,
    title: () => 'It rolls! Take it outside',
    tip: () => 'Tap 🛒 ROLL IT OUT.',
    target: () => ({ ui: '[data-act="go"]' }),
  },
  {
    id: 'pull',
    beat: 'use',
    done: (s) => s.everHitched || s.solved,
    title: () => 'Grab the handle',
    tip: (s) => (s.touch ? 'Look at your wagon and tap 🛒 PULL.' : 'Look at your wagon and press P (or click 🛒 PULL).'),
    target: () => ({ ui: '.actions [data-act="hitch"]', world: 'wagon' }),
  },
  {
    id: 'load',
    beat: 'use',
    done: (s) => s.load >= 3 || s.solved,
    title: (s) => `Load 3 things from the junk pile · ${Math.min(3, s.load)}/3`,
    tip: (s) => {
      const key = s.touch ? '' : ' (or press L)';
      return s.carrying
        ? `Tap 🛒 IN WAGON${key} while it’s close.`
        : s.hitched
          ? `Pull it to the glowing pile by the garage, look at a part and tap 🛒 TO WAGON${key}.`
          : `Bring the wagon close, look at a part and tap 🛒 TO WAGON${key}.`;
    },
    target: (s) => ({ ui: '.actions [data-act="load"]', world: s.carrying ? 'wagon' : 'junk' }),
  },
  {
    id: 'haul',
    beat: 'use',
    done: (s) => s.solved,
    title: () => 'Haul it into the lab',
    tip: (s) => (s.hitched ? 'Pull it through the open side of the garage.' : 'Grab the handle (🛒 PULL) and walk it into the garage.'),
    target: (s) => ({ ui: s.hitched ? undefined : '.actions [data-act="hitch"]', world: s.hitched ? 'lab' : 'wagon' }),
  },
];

export interface CoachView {
  step: CoachStep;
  /** 1-based, counting only the steps every player goes through. */
  n: number;
  of: number;
  title: string;
  tip: string;
  target: CoachTarget;
}

/** Steps everyone sees (the conditional ones, like "change one thing", don't count toward the total). */
const MAIN = WAGON_STEPS.filter((s) => !s.when);

/** The first step that isn't true yet, or null when the mission is done. */
export function coachStep(s: CoachSnapshot, steps: CoachStep[] = WAGON_STEPS): CoachView | null {
  for (const step of steps) {
    if (step.when && !step.when(s)) continue;
    if (step.done(s)) continue;
    const main = MAIN.indexOf(step);
    const n = main >= 0 ? main + 1 : MAIN.findIndex((m) => !m.done(s)) + 1 || MAIN.length;
    return { step, n, of: MAIN.length, title: step.title(s), tip: step.tip(s), target: step.target(s) };
  }
  return null;
}
