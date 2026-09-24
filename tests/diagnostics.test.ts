import { beforeAll, describe, expect, it } from 'vitest';
import { PROJECT_MAP, PROJECTS, type ProjectDef } from '../src/data/projects';
import { analyze, emptyStats, goalGap, TestProbe, type RunStats } from '../src/game/diagnostics';
import { Builder, type Blueprint } from '../src/sim/blueprint';
import { initPhysics } from '../src/sim/physics';
import { Simulation } from '../src/sim/simulation';
import { place, successOf } from './helpers';

beforeAll(async () => {
  await initPhysics();
});

/** Run a machine the way the game does and hand back the test report. */
function trial(project: ProjectDef, bp: Blueprint, x: number, z: number, yaw: number, seconds = 8) {
  const sim = new Simulation({ project });
  place(sim, bp, x, z, yaw);
  sim.run(0.3);
  sim.drainEvents();
  const probe = new TestProbe();
  probe.begin(sim, project);
  sim.goAll();
  for (let i = 0; i < seconds * 120 && !successOf(sim); i++) {
    sim.step();
    for (const e of sim.drainEvents()) probe.event(e);
    probe.sample(sim, 1 / 120);
  }
  const stats = probe.finish(!!successOf(sim));
  return { stats, report: analyze(stats, project) };
}

const vac = () => {
  const b = new Builder('vac');
  const bat = b.free('battery_car');
  b.on('vacuum', 'back', bat, [0, 0.08, 0.09], [0, 0, 1]);
  return b.bp;
};
const g = (r: { gauges: { id: string; value: number | null }[] }, id: string) => r.gauges.find((x) => x.id === id)!.value;

describe('test results come from what the physics did', () => {
  it('a vacuum on the car battery gets the ball: it worked, full reach', () => {
    const { report, stats } = trial(PROJECT_MAP.ball_over_fence, vac(), 13.9, 4.85, Math.PI / 2, 30);
    expect(stats.success).toBe(true);
    expect(report.mood).toBe('worked');
    expect(g(report, 'reach')).toBe(1);
    expect(g(report, 'power')!).toBeGreaterThan(0.9);
  });

  it('a vacuum on a crate with the little battery: the power gauge says why', () => {
    const b = new Builder('weak vac');
    const crate = b.free('crate');
    b.on('battery_small', 'bottom', crate, [0, 0.2, 0], [0, 1, 0]);
    b.on('vacuum', 'back', crate, [0, 0.0, 0.25], [0, 0, 1]);
    // Close to the gap it still works, just weakly: the gauge shows the struggle anyway.
    const near = trial(PROJECT_MAP.ball_over_fence, b.bp, 13.6, 4.85, Math.PI / 2, 10);
    expect(near.stats.success).toBe(true);
    expect(g(near.report, 'power')!).toBeLessThan(0.55);
    // A step further back it runs out of reach; the report leads with that and mentions the battery.
    const far = trial(PROJECT_MAP.ball_over_fence, b.bp, 13.0, 4.85, Math.PI / 2, 8);
    expect(far.stats.success).toBe(false);
    expect(g(far.report, 'power')!).toBeLessThan(0.55);
    expect(far.report.observation).toMatch(/didn’t reach/);
    expect(far.report.observation).toMatch(/battery/i);
  });

  it('pointed the other way, it does not reach, and says how far off it was', () => {
    const { report } = trial(PROJECT_MAP.ball_over_fence, vac(), 13.2, 4.85, -Math.PI / 2, 5);
    expect(g(report, 'reach')!).toBeLessThan(0.5);
    expect(report.observation).toMatch(/didn’t reach.*\d\.\d m/);
  });

  it('motors with no battery: nothing happens, and it says a battery is missing', () => {
    const b = new Builder();
    const pl = b.free('plank');
    const mo = b.on('motor', 'back', pl, [-0.45, 0, 0.075], [0, 0, 1]);
    b.into('lawn_wheel', 'hub', mo, 'shaft');
    const { report } = trial(PROJECT_MAP.ball_over_fence, b.bp, 11, 4.8, Math.PI / 2, 2);
    expect(g(report, 'power')).toBe(0);
    expect(report.observation).toMatch(/battery/);
  });

  it('a fan updraft knocks the kite loose: the push gauge fills', () => {
    const b = new Builder('updraft');
    const crate = b.free('crate');
    b.on('box_fan', 'back', crate, [0, 0.2, 0], [0, 1, 0]);
    b.on('battery_small', 'side', crate, [0, 0, 0.25], [0, 0, 1]);
    const { report, stats } = trial(PROJECT_MAP.kite_in_tree, b.bp, 8.3, 7.9, 0, 10);
    expect(stats.unsnagged).toBe(true);
    expect(g(report, 'push')).toBe(1);
    expect(g(report, 'reach')).toBe(1);
  });

  it('goal distance is zero inside the goal zone and grows outside it', () => {
    const ball = PROJECT_MAP.ball_over_fence;
    expect(goalGap(ball, { x: 0, y: 0, z: 0 })).toBe(0);
    expect(goalGap(ball, { x: 16.5, y: 0.1, z: 5.6 })).toBeCloseTo(1.5, 5);
    // The kite also has to come down.
    expect(goalGap(PROJECT_MAP.kite_in_tree, { x: 8, y: 2.7, z: 7.6 })).toBeCloseTo(2, 5);
  });
});

describe('results never grade the player', () => {
  const banned = /\b(fail(ed|ure)?|wrong|incorrect|invalid|bad|error|mistake)\b/i;
  const variants: Partial<RunStats>[] = [
    {},
    { success: true },
    { noBattery: true },
    { powered: true, dead: true },
    { powered: true, minFactor: 0.2, factorSum: 20, factorSamples: 100 },
    { breaks: 1, lastBreak: { part: 'lawn_wheel', other: 'plank' } },
    { snaps: 1, lastSnap: 'rope' },
    { maxTilt: 150 },
    { maxTilt: 60 },
    { hasTarget: true, snagged: true, unsnagged: true, goalEnd: 2 },
    { hasTarget: true, snagged: true, pushPeak: 0.7 },
    { hasTarget: true, grabbed: true, lostGrip: 1 },
    { hasTarget: true, goalStart: 2, goalEnd: 1 },
    { hasTarget: true, goalStart: 1, goalEnd: 2 },
    { hasTarget: true, targetMoved: 1 },
    { hasTarget: true, closest: 0 },
    { hasTarget: true, closest: 2.2, machineMoved: 1 },
    { hasTarget: true, closest: 2.2 },
  ];
  it('every observation, tip and gauge note is curious, not judgmental', () => {
    for (const p of [...PROJECTS, null]) {
      for (const v of variants) {
        const r = analyze({ ...emptyStats(), ...v }, p);
        for (const text of [r.observation, r.tryNext ?? '', ...r.gauges.map((x) => `${x.label} ${x.note}`)]) expect(text).not.toMatch(banned);
        for (const x of r.gauges) if (x.value !== null) expect(x.value).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('each project shows its own handful of gauges', () => {
    for (const p of PROJECTS) {
      const r = analyze(emptyStats(), p);
      expect(r.gauges.map((x) => x.id)).toEqual(p.metrics);
      expect(r.gauges.length).toBeLessThanOrEqual(4);
    }
  });
});
