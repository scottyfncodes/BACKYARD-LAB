import { beforeAll, describe, expect, it } from 'vitest';
import { PROJECT_MAP } from '../src/data/projects';
import { inZone } from '../src/data/world';
import { pushPlan, PushProbe, pushVerdict, rollDirection, shove, type PushResult } from '../src/game/pushtest';
import { Builder, type Blueprint } from '../src/sim/blueprint';
import { initPhysics } from '../src/sim/physics';
import { emptyInput, Simulation } from '../src/sim/simulation';
import { wagonCheck } from '../src/sim/wagonbuild';
import { wagonBlueprint } from './helpers';

beforeAll(async () => {
  await initPhysics();
});

/** Run a real push test, the way the game does: set it on the garage floor, shove, watch until it stops. */
function pushTest(bp: Blueprint) {
  const sim = new Simulation({ project: PROJECT_MAP.build_wagon, gateOpen: false, wagon: false });
  const plan = pushPlan(sim, bp);
  expect(plan, 'there is always room on the garage floor').not.toBeNull();
  const start = plan!.placement.pos;
  const m = sim.addMachine(bp, plan!.placement);
  m.go();
  shove(m, plan!.dir);
  const probe = new PushProbe();
  probe.begin(m, plan!.dir);
  let done = false;
  for (let i = 0; i < 120 * 8 && !done; i++) {
    sim.step(emptyInput());
    for (const e of sim.drainEvents()) probe.event(e);
    done = probe.sample(1 / 120);
  }
  expect(done, 'a push test always ends').toBe(true);
  const r = { result: probe.result, verdict: pushVerdict(probe.result, wagonCheck(bp)), start, path: probe.path };
  sim.free();
  return r;
}

const cart = () => {
  const b = new Builder();
  const pl = b.free('plank');
  b.on('lawn_wheel', 'hub', pl, [0.45, 0, 0.075], [0, 0, 1]);
  b.on('lawn_wheel', 'hub', pl, [-0.45, 0, 0.075], [0, 0, 1]);
  b.on('lawn_wheel', 'hub', pl, [0.45, 0, -0.075], [0, 0, -1]);
  b.on('lawn_wheel', 'hub', pl, [-0.45, 0, -0.075], [0, 0, -1]);
  return b.bp;
};

describe('PUSH TEST: the first experiment is real physics', () => {
  it('rolls square to the axles', () => {
    const d = rollDirection(cart())!;
    // Wheels on the plank's long sides: it rolls along the plank.
    const b = wagonCheck(cart());
    expect(b.wheels).toBe(4);
    expect(Math.abs(d.y)).toBe(0);
    expect(d.length()).toBeCloseTo(1, 5);
    const flat = new Builder();
    flat.on('lawn_wheel', undefined, flat.free('plank'), [0.3, 0.015, 0], [0, 1, 0]);
    expect(rollDirection(flat.bp)).toBeNull();
  });

  it('starts on the garage floor and pushes out of the open side', () => {
    const sim = new Simulation({ project: PROJECT_MAP.build_wagon, gateOpen: false, wagon: false });
    const plan = pushPlan(sim, wagonBlueprint())!;
    const [x, , z] = plan.placement.pos;
    expect(inZone({ x, y: 0.5, z }, 'lab')).toBe(true);
    expect(plan.dir.x).toBeGreaterThan(0.99);
    expect(plan.rolls).toBe(true);
    sim.free();
  });

  it('a real cart on four wheels rolls a long way and stays level', () => {
    const { result, verdict } = pushTest(cart());
    expect(result.distance).toBeGreaterThan(2);
    expect(result.tilt).toBeLessThan(12);
    expect(verdict.mood).toBe('rolled');
  });

  it('the finished wagon rolls, and the handle dragging on the floor is explained, not blamed', () => {
    const { result, verdict } = pushTest(wagonBlueprint());
    expect(result.distance).toBeGreaterThan(0.6);
    expect(verdict.mood).toBe('rolled');
    expect(verdict.next).toBeNull();
  });

  it('a wheel lying flat skids instead of rolling, and says why', () => {
    const b = new Builder();
    b.on('lawn_wheel', undefined, b.free('plank'), [0.3, 0.015, 0], [0, 1, 0]);
    const { result, verdict } = pushTest(b.bp);
    expect(result.distance).toBeLessThan(0.6);
    expect(verdict.mood).toBe('stuck');
    expect(verdict.line).toMatch(/flat/);
  });

  it('wheels down one side only: it scrapes along leaning over', () => {
    const b = new Builder();
    const pl = b.free('plank');
    b.on('lawn_wheel', 'hub', pl, [0.45, 0, 0.075], [0, 0, 1]);
    b.on('lawn_wheel', 'hub', pl, [-0.45, 0, 0.075], [0, 0, 1]);
    const { result, verdict } = pushTest(b.bp);
    expect(result.tilt).toBeGreaterThan(10);
    expect(verdict.mood).toBe('tipped');
    expect(verdict.next).toMatch(/side/);
  });

  it('a bare plank has nothing to roll on', () => {
    const b = new Builder();
    b.free('plank');
    const { verdict } = pushTest(b.bp);
    expect(verdict.mood).toBe('stuck');
    expect(verdict.line).toMatch(/Nothing on it can roll/);
  });

  it('verdicts are plain words: measured facts, never judgement', () => {
    const results: PushResult[] = [
      { distance: 3, tilt: 2, topSpeed: 2, breaks: 0, time: 4.5, stillRolling: true },
      { distance: 0.2, tilt: 1, topSpeed: 2, breaks: 0, time: 1, stillRolling: false },
      { distance: 1, tilt: 70, topSpeed: 2, breaks: 0, time: 1, stillRolling: false },
      { distance: 1, tilt: 4, topSpeed: 2, breaks: 2, time: 1, stillRolling: false },
    ];
    for (const r of results) {
      for (const bp of [cart(), wagonBlueprint(), new Builder().bp]) {
        const v = pushVerdict(r, wagonCheck(bp));
        const words = `${v.line} ${v.next ?? ''}`;
        expect(words).not.toMatch(/\b(fail|failed|wrong|bad|incorrect)\b/i);
        expect(v.facts.length).toBeGreaterThan(0);
      }
    }
  });
});
