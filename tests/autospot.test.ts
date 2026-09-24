import { Vector3 } from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { PROJECT_MAP, type ProjectDef } from '../src/data/projects';
import { inZone } from '../src/data/world';
import { autoSpot, machineFits } from '../src/game/autospot';
import { Builder, type Blueprint } from '../src/sim/blueprint';
import { initPhysics, toV } from '../src/sim/physics';
import { Simulation } from '../src/sim/simulation';
import { runUntil, successOf } from './helpers';
import { emptyInput } from '../src/sim/simulation';

beforeAll(async () => {
  await initPhysics();
});

const area = (p: ProjectDef, sim: Simulation) => ({
  approach: new Vector3(...p.approach),
  site: new Vector3(...p.site.pos),
  target: toV(sim.itemByTag('target')!.rb.translation()),
  zone: 'home_yard',
});

/** The build a first-timer makes: vacuum on the bench, big battery stacked on top. */
const vacWithBatteryOnTop = () => {
  const b = new Builder();
  const v = b.free('vacuum');
  b.on('battery_car', 'bottom', v, [0, 0.18, 0], [0, 1, 0]);
  return b.bp;
};

function goForIt(p: ProjectDef, bp: Blueprint) {
  const sim = new Simulation({ project: p });
  const pl = autoSpot(sim, bp, area(p, sim));
  expect(pl, p.id).not.toBeNull();
  expect(machineFits(sim, bp, pl!)).toBe(true);
  expect(inZone({ x: pl!.pos[0], y: 0.5, z: pl!.pos[2] }, 'home_yard')).toBe(true);
  sim.addMachine(bp, pl!);
  sim.run(0.3);
  sim.goAll();
  return sim;
}

describe('GO FOR IT: the machine sets itself down at the problem, aimed, and just works', () => {
  it('THE BALL: vacuum ends up at the gap, pointed through it, and gets the ball', () => {
    const sim = goForIt(PROJECT_MAP.ball_over_fence, vacWithBatteryOnTop());
    expect(runUntil(sim, 20, emptyInput, () => !!successOf(sim))).toBe(true);
  });

  it("BISCUIT'S BALL: vacuum at the shed edge pulls the ball out", () => {
    const sim = goForIt(PROJECT_MAP.dog_ball, vacWithBatteryOnTop());
    expect(runUntil(sim, 20, emptyInput, () => !!successOf(sim))).toBe(true);
  });

  it('THE KITE: a fan on a crate lands under the kite and blows it loose', () => {
    const b = new Builder();
    const crate = b.free('crate');
    b.on('box_fan', 'back', crate, [0, 0.2, 0], [0, 1, 0]);
    b.on('battery_small', 'side', crate, [0, 0, 0.25], [0, 0, 1]);
    const sim = goForIt(PROJECT_MAP.kite_in_tree, b.bp);
    const kite = sim.itemByTag('target')!;
    expect(runUntil(sim, 10, emptyInput, () => !kite.snag)).toBe(true);
  });

  it('a big awkward machine still finds a spot, backing away from the fence rather than going through it', () => {
    const b = new Builder();
    const p1 = b.free('plank', 0, 0);
    b.on('crate', 'bottom', p1, [0.4, 0.015, 0], [0, 1, 0]);
    const sim = new Simulation({ project: PROJECT_MAP.ball_over_fence });
    const pl = autoSpot(sim, b.bp, area(PROJECT_MAP.ball_over_fence, sim))!;
    expect(pl).not.toBeNull();
    expect(pl.pos[0]).toBeLessThan(15);
  });
});
