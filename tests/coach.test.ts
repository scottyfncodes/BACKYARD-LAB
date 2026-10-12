import { describe, expect, it } from 'vitest';
import { coachStep, WAGON_STEPS, type CoachSnapshot } from '../src/game/coach';
import { defaultSave, parseSave } from '../src/game/save';
import { Builder } from '../src/sim/blueprint';
import { wagonCheck } from '../src/sim/wagonbuild';
import { wagonBlueprint } from './helpers';

const fresh = (o: Partial<CoachSnapshot> = {}): CoachSnapshot => ({
  mode: 'explore',
  touch: true,
  check: null,
  benchParts: 0,
  holding: null,
  pushing: false,
  pushes: 0,
  pushReset: false,
  lastPush: null,
  wagonOut: false,
  everHitched: false,
  hitched: false,
  carrying: false,
  load: 0,
  solved: false,
  ...o,
});
const id = (s: CoachSnapshot) => coachStep(s)?.step.id ?? null;

describe('the first-build coach follows the real game, step by step', () => {
  it('walks the whole mission in order: bench → body → wheels → handle → push → roll out → pull → load → haul', () => {
    const plank = new Builder();
    const pl = plank.free('plank');
    const wheels = new Builder();
    const w = wheels.free('plank');
    wheels.on('lawn_wheel', 'hub', w, [0.45, 0, 0.075], [0, 0, 1]);
    wheels.on('lawn_wheel', 'hub', w, [-0.45, 0, 0.075], [0, 0, 1]);
    wheels.on('lawn_wheel', 'hub', w, [0.45, 0, -0.075], [0, 0, -1]);
    wheels.on('lawn_wheel', 'hub', w, [-0.45, 0, -0.075], [0, 0, -1]);
    void pl;
    const seq: [Partial<CoachSnapshot>, string | null][] = [
      [{}, 'bench'],
      [{ mode: 'build' }, 'body'],
      [{ mode: 'build', benchParts: 1, check: wagonCheck(plank.bp) }, 'wheels'],
      [{ mode: 'build', benchParts: 5, check: wagonCheck(wheels.bp) }, 'handle'],
      [{ mode: 'build', benchParts: 6, check: wagonCheck(wagonBlueprint()) }, 'push'],
      [{ mode: 'build', benchParts: 6, check: wagonCheck(wagonBlueprint()), pushes: 1, pushing: true }, 'watch'],
      [{ mode: 'build', benchParts: 6, check: wagonCheck(wagonBlueprint()), pushes: 1, pushReset: true, lastPush: 'rolled' }, 'rollout'],
      [{ wagonOut: true }, 'pull'],
      [{ wagonOut: true, everHitched: true, hitched: true }, 'load'],
      [{ wagonOut: true, everHitched: true, hitched: true, load: 3 }, 'haul'],
      [{ wagonOut: true, everHitched: true, load: 3, solved: true }, null],
    ];
    for (const [s, want] of seq) expect(id(fresh(s)), JSON.stringify(s)).toBe(want);
  });

  it('steps back when the kid undoes something, and keeps up when they skip ahead', () => {
    // Took the wheels back off: the coach asks for wheels again.
    const plank = new Builder();
    plank.free('plank');
    expect(id(fresh({ mode: 'build', benchParts: 1, check: wagonCheck(plank.bp), pushes: 2 }))).toBe('wheels');
    // Left the bench halfway: back to the bench first.
    expect(id(fresh({ mode: 'explore', benchParts: 3, check: wagonCheck(plank.bp) }))).toBe('bench');
    expect(coachStep(fresh({ benchParts: 3 }))!.title).toMatch(/Back to/);
    // Already rolled the wagon out without pushing: no going back to push it.
    expect(id(fresh({ wagonOut: true }))).toBe('pull');
  });

  it('a push that did not roll asks for one change, then another push', () => {
    const bp = wagonBlueprint();
    const s = fresh({ mode: 'build', benchParts: 6, check: wagonCheck(bp), pushes: 1, pushReset: true, lastPush: 'tipped' });
    expect(id(s)).toBe('change');
    expect(coachStep(s)!.target.ui).toContain('push');
    expect(id({ ...s, lastPush: 'rolled' })).toBe('rollout');
  });

  it('while a part is in hand, it points at PLACE instead of the parts bin', () => {
    const v = coachStep(fresh({ mode: 'build', holding: 'plank' }))!;
    expect(v.step.id).toBe('body');
    expect(v.target.ui).toContain('place-bar');
    expect(v.tip).toMatch(/PLACE/);
    expect(coachStep(fresh({ mode: 'build' }))!.target.demo).toBe('drag');
  });

  it('every step teaches a real control: touch and desktop wording both name a button that exists', () => {
    const states = [fresh(), fresh({ mode: 'build' }), fresh({ wagonOut: true }), fresh({ wagonOut: true, everHitched: true })];
    for (const s of states) {
      for (const touch of [true, false]) {
        const v = coachStep({ ...s, touch })!;
        expect(v.tip.length).toBeGreaterThan(10);
        expect(v.tip.length, 'one short line, not a wall of text').toBeLessThan(110);
        if (v.target.ui) expect(v.target.ui).toMatch(/data-act|data-part|place-bar/);
      }
    }
    expect(coachStep(fresh({ touch: false }))!.tip).toMatch(/Press B/);
  });

  it('counts only the steps everyone goes through', () => {
    const v = coachStep(fresh())!;
    expect(v.n).toBe(1);
    expect(v.of).toBe(WAGON_STEPS.filter((s) => !s.when).length);
    const watch = coachStep(fresh({ mode: 'build', pushing: true, pushes: 1, check: wagonCheck(wagonBlueprint()), benchParts: 6 }))!;
    expect(watch.step.id).toBe('watch');
    expect(watch.n).toBeGreaterThan(1);
    expect(watch.n).toBeLessThanOrEqual(watch.of);
  });
});

describe('tutorial progress in the save', () => {
  it('a new player gets the tutorial; it stays done once finished or skipped', () => {
    expect(defaultSave().tutorial.done).toBe(false);
    const s = defaultSave();
    s.tutorial.done = true;
    expect(parseSave(JSON.stringify(s)).tutorial.done).toBe(true);
  });

  it('players who already got past Mission 0 are never walked through it again', () => {
    const old = parseSave(JSON.stringify({ v: 1, completed: { ball_over_fence: { bestTime: 30, bonuses: [] } } }));
    expect(old.tutorial.done).toBe(true);
    // Halfway through Mission 0 (wagon already rolled out): still coached.
    const mid = parseSave(JSON.stringify({ v: 1, wagon: wagonBlueprint() }));
    expect(mid.tutorial.done).toBe(false);
    expect(parseSave(JSON.stringify({ v: 1, tutorial: 'yes' })).tutorial.done).toBe(false);
  });
});
