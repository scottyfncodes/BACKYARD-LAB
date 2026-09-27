import { Vector3 } from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { getPart } from '../src/data/parts';
import { PROJECT_MAP, PROJECTS } from '../src/data/projects';
import { inZone, WORLD } from '../src/data/world';
import { groundedPlacement } from '../src/game/placement';
import { completeProject, defaultSave, loadSave, parseSave, rememberSolvers, rewardSpawns, writeSave, YARD_LIMIT } from '../src/game/save';
import { Builder } from '../src/sim/blueprint';
import { ObjectiveTracker, type WorldQuery } from '../src/sim/objectives';
import { initPhysics, toV } from '../src/sim/physics';
import { emptyInput, Simulation } from '../src/sim/simulation';
import { place, rcCar, runUntil } from './helpers';

beforeAll(async () => {
  await initPhysics();
});

class MemStore {
  data = new Map<string, string>();
  getItem(k: string) {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.data.set(k, v);
  }
}

describe('the yard remembers solved machines', () => {
  it('solvers are parked per project, replaced when the project is solved again, capped', () => {
    const s = defaultSave();
    const b = new Builder('Suck-o-Matic');
    b.free('vacuum');
    const solver = { name: 'Suck-o-Matic', bp: b.bp, placement: { pos: [14, 0.2, 4.8] as [number, number, number], yaw: 1.57 } };
    rememberSolvers(s, [solver], 'ball_over_fence');
    rememberSolvers(s, [solver, solver], 'ball_again');
    expect(s.yard.map((y) => y.project)).toEqual(['ball_again', 'ball_again', 'ball_over_fence']);
    rememberSolvers(s, [solver], 'ball_over_fence');
    expect(s.yard.filter((y) => y.project === 'ball_over_fence')).toHaveLength(1);
    rememberSolvers(s, Array(20).fill(solver), 'kite_in_tree');
    expect(s.yard).toHaveLength(YARD_LIMIT);
  });

  it('parked machines survive a save and a reload, and hostile yard data is dropped', () => {
    const store = new MemStore();
    const s = defaultSave();
    const b = new Builder('Cart');
    b.free('crate');
    rememberSolvers(s, [{ name: 'Cart', bp: b.bp, placement: { pos: [1, 0.2, 3], yaw: 0.5 } }], 'ball_over_fence');
    writeSave(s, store);
    expect(loadSave(store)).toEqual(s);
    const evil = parseSave(JSON.stringify({ v: 1, yard: [{ name: 'x', project: 'nope', bp: b.bp, placement: { pos: [0, 0, 0], yaw: 0 } }, { project: 'ball_over_fence', bp: 'lol' }, 42] }));
    expect(evil.yard).toHaveLength(0);
  });

  it('parking spots are in our yard, spaced out, clear of the fence gap, and a machine parked there stays put', () => {
    const gap = new Vector3(14.5, 0, 4.8);
    const spots = WORLD.parking;
    expect(spots.length).toBeGreaterThanOrEqual(YARD_LIMIT);
    for (let i = 0; i < spots.length; i++) {
      const a = new Vector3(spots[i].pos[0], 0.3, spots[i].pos[1]);
      expect(inZone(a, 'home_yard'), `spot ${i} in the yard`).toBe(true);
      expect(inZone(a, 'lab'), `spot ${i} not in the lab`).toBe(false);
      expect(a.distanceTo(gap), `spot ${i} clear of the gap`).toBeGreaterThan(4);
      for (let j = i + 1; j < spots.length; j++) expect(a.distanceTo(new Vector3(spots[j].pos[0], 0.3, spots[j].pos[1])), `spots ${i}/${j} apart`).toBeGreaterThan(1.4);
    }
    // Nothing solid in the way: the two guided builds sit still on every spot.
    const sim = new Simulation({ junk: false, player: false });
    const vac = new Builder('vac');
    vac.on('battery_car', 'bottom', vac.free('vacuum', 0, 0, 0, 'bottom'), [0, 0.18, 0], [0, 1, 0]);
    for (const [i, s] of spots.entries()) {
      const bp = i % 2 ? rcCar().bp : vac.bp;
      const m = sim.addMachine(bp, groundedPlacement(bp, s.pos[0], 0, s.pos[1], s.yaw));
      const before = m.center();
      sim.run(1.0);
      expect(m.center().distanceTo(before), `spot ${i} settles`).toBeLessThan(0.08);
    }
  });

  it('a machine cannot be set down on top of another machine, parked or not', () => {
    const sim = new Simulation({ junk: false, player: false });
    const bp = rcCar().bp;
    const parked = sim.addMachine(bp, groundedPlacement(bp, 0, 0, 0, 0));
    parked.parked = true;
    sim.run(0.2);
    expect(sim.overlapsMachine(bp, groundedPlacement(bp, 0.1, 0, 0.05, 1.2))).toBe(true);
    expect(sim.overlapsMachine(bp, groundedPlacement(bp, 3, 0, 0, 0))).toBe(false);
    expect(sim.overlapsMachine(bp, groundedPlacement(bp, 0.1, 0, 0.05, 1.2), parked.id)).toBe(false);
    // Loose junk in the footprint is not a machine, so it does not count.
    sim.spawnItem({ part: 'playground_ball', pos: [3, 0.2, 0] });
    sim.run(0.2);
    expect(sim.overlapsMachine(bp, groundedPlacement(bp, 3, 0, 0, 0))).toBe(false);
  });

  it('a parked machine sits out GO until it is picked up and placed again', () => {
    const sim = new Simulation({ junk: false, player: false });
    const parked = place(sim, rcCar().bp, 0, 0, 0);
    parked.parked = true;
    const fresh = place(sim, rcCar().bp, 3, 0, 0);
    sim.goAll();
    expect(parked.state).toBe('frozen');
    expect(fresh.state).toBe('running');
  });
});

describe('new junk turns up after each solve', () => {
  it('every project leaves one real, buildable piece of junk with a line about it', () => {
    for (const p of PROJECTS) {
      expect(p.reward, p.id).toBeDefined();
      expect(getPart(p.reward!.part).buildable).toBe(true);
      expect(p.reward!.story.length).toBeGreaterThan(10);
      expect(p.reward!.story.length).toBeLessThan(110);
    }
  });

  it('rewards appear only for solved projects, and can be picked up in the yard', () => {
    const s = defaultSave();
    expect(rewardSpawns(s)).toHaveLength(0);
    completeProject(s, 'ball_over_fence', 100, []);
    const spawns = rewardSpawns(s);
    expect(spawns.map((x) => x.part)).toEqual([PROJECT_MAP.ball_over_fence.reward!.part]);
    const sim = new Simulation({ project: PROJECT_MAP.ball_again });
    const it = sim.spawnItem(spawns[0]);
    expect(it.spawn.story).toBeTruthy();
    sim.run(0.5);
    expect(sim.inZone(toV(it.rb.translation()), 'home_yard')).toBe(true);
  });
});

describe('one weird star per project', () => {
  const q = (target: { x: number; y: number; z: number }): WorldQuery => ({
    time: 10,
    pos: (t) => (t === 'target' ? target : t === 'player' ? { x: 0, y: 0.6, z: 0 } : null),
    speed: () => 0,
    held: () => false,
    touched: () => false,
    snagged: () => false,
  });

  it('every project has exactly one "ever" bonus', () => {
    for (const p of PROJECTS) expect(p.bonuses.filter((b) => b.kind === 'ever'), p.id).toHaveLength(1);
  });

  it('"Airmail" is earned when the ball sailed high over our yard on its way home, even though it has landed by then', () => {
    const p = PROJECT_MAP.ball_over_fence;
    const tr = new ObjectiveTracker(p);
    tr.update(q({ x: 12, y: 3.0, z: 5 }), 0.1); // over the fence, high
    const home = q({ x: 10, y: 0.11, z: 5 });
    const evs = [...tr.update(home, 0.3), ...tr.update(home, 0.4)];
    const s = evs.find((e) => e.type === 'success');
    expect(s && s.type === 'success' && s.bonuses.find((b) => b.def.id === 'airmail')!.earned).toBe(true);
    // ...and not when it came through the gap along the ground.
    const tr2 = new ObjectiveTracker(p);
    tr2.update(q({ x: 16, y: 0.11, z: 5 }), 0.1);
    const evs2 = [...tr2.update(home, 0.3), ...tr2.update(home, 0.4)];
    const s2 = evs2.find((e) => e.type === 'success');
    expect(s2 && s2.type === 'success' && s2.bonuses.find((b) => b.def.id === 'airmail')!.earned).toBe(false);
  });

  it('"Biscuit got involved" needs the dog, and is simply not earned without him', () => {
    const p = PROJECT_MAP.ball_again;
    const tr = new ObjectiveTracker(p);
    const home = q({ x: 10, y: 0.11, z: 5 });
    const evs = [...tr.update(home, 0.3), ...tr.update(home, 0.4)];
    const s = evs.find((e) => e.type === 'success');
    expect(s && s.type === 'success' && s.bonuses.find((b) => b.def.id === 'biscuit')!.earned).toBe(false);
  });
});

describe('the treehouse ladder', () => {
  it('the kid climbs it by walking into the rungs, and ends up on the platform', () => {
    const sim = new Simulation({ junk: false });
    const L = WORLD.ladders[0];
    sim.teleportPlayer([6, 0, 8.4], 0); // south of the tree, facing north (into the ladder)
    sim.run(0.3);
    const up = runUntil(sim, 8, () => ({ ...emptyInput(), yaw: 0, moveZ: 1 }), () => {
      const p = toV(sim.player!.translation());
      return p.y - 0.62 > L.top && p.z < L.min[2];
    });
    expect(up).toBe(true);
    // Standing there, not falling through.
    sim.run(1, { ...emptyInput(), yaw: 0 });
    expect(toV(sim.player!.translation()).y - 0.62).toBeGreaterThan(L.top - 0.05);
  });

  it('walking past the foot of the ladder does not launch the kid', () => {
    const sim = new Simulation({ junk: false });
    sim.teleportPlayer([4.5, 0, 7.6], 0);
    sim.run(0.3);
    sim.run(2, { ...emptyInput(), yaw: Math.PI / 2 + Math.PI, moveZ: 1 }); // walking east along the foot
    expect(toV(sim.player!.translation()).y).toBeLessThan(1);
  });
});

describe('Biscuit', () => {
  it('is deterministic', () => {
    const run = () => {
      const sim = new Simulation({ junk: false, player: false, dog: true });
      sim.run(12);
      return sim.dog!.position().toArray();
    };
    expect(run()).toEqual(run());
  });

  it('stays in his own yard while the gate is shut, and mostly minds his own business', () => {
    const sim = new Simulation({ junk: false, player: false, dog: true });
    let minX = 99;
    let moved = 0;
    let last = sim.dog!.position();
    for (let i = 0; i < 120 * 40; i++) {
      sim.step();
      const p = sim.dog!.position();
      minX = Math.min(minX, p.x);
      moved += p.distanceTo(last);
      last = p;
    }
    expect(minX).toBeGreaterThan(15);
    expect(moved).toBeGreaterThan(5); // he does get up and wander
  });

  it('chases a ball rolling through his yard and barks about it', () => {
    const sim = new Simulation({ junk: false, player: false, dog: true });
    const ball = sim.spawnItem({ part: 'playground_ball', pos: [20, 0.11, 2] });
    sim.run(0.5);
    ball.rb.setLinvel({ x: 2.5, y: 0, z: 1.5 }, true);
    let closest = 99;
    runUntil(sim, 8, emptyInput, () => {
      closest = Math.min(closest, sim.dog!.position().distanceTo(toV(ball.rb.translation())));
      return closest < 0.8;
    });
    expect(closest).toBeLessThan(0.8);
    expect(sim.drainEvents().some((e) => e.type === 'bark')).toBe(true);
    expect(sim.dog!.state === 'chase' || sim.dog!.state === 'sniff').toBe(true);
  });

  it('is where the objectives can see him', () => {
    const sim = new Simulation({ junk: false, player: false, dog: true });
    const p = sim.query().pos('dog');
    expect(p).not.toBeNull();
    expect(new Vector3(p!.x, 0, p!.z).distanceTo(new Vector3(23.1, 0, -2))).toBeLessThan(1);
  });
});
