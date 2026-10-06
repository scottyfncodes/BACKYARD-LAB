import { beforeAll, describe, expect, it } from 'vitest';
import { PROJECT_MAP } from '../src/data/projects';
import { WORLD } from '../src/data/world';
import { Builder } from '../src/sim/blueprint';
import { initPhysics, toV } from '../src/sim/physics';
import { emptyInput, Simulation, WAGON } from '../src/sim/simulation';
import { wagonCheck, wagonFrame } from '../src/sim/wagonbuild';
import { expectFromBin, runUntil, successOf, wagonBlueprint } from './helpers';

beforeAll(async () => {
  await initPhysics();
});

const note = (bp: Parameters<typeof wagonCheck>[0], id: string) => wagonCheck(bp).notes.find((n) => n.id === id);

describe('MISSION 0: is it a wagon yet? (read off the bench, never off a recipe)', () => {
  it('the obvious wagon is a wagon, and it can be built from the mission bin', () => {
    const bp = wagonBlueprint();
    expectFromBin(PROJECT_MAP.build_wagon, bp);
    const c = wagonCheck(bp);
    expect(c.ok).toBe(true);
    expect(c.wheels).toBe(4);
    expect(c.notes.every((n) => n.done)).toBe(true);
    expect(c.notes.map((n) => n.id)).toEqual(['body', 'wheels', 'spread', 'rolls', 'handle']);
  });

  it('an empty bench and a lone plank say what is missing, in order', () => {
    const b = new Builder();
    expect(wagonCheck(b.bp).ok).toBe(false);
    expect(note(b.bp, 'body')!.done).toBe(false);
    b.free('plank');
    expect(note(b.bp, 'body')!.done).toBe(true);
    expect(note(b.bp, 'wheels')!.done).toBe(false);
    expect(note(b.bp, 'wheels')!.text).toMatch(/axle/i);
    expect(note(b.bp, 'handle')!.done).toBe(false);
  });

  it('a wheel lying flat on top spins like a record: it does not count as rolling', () => {
    const b = new Builder();
    const pl = b.free('plank');
    b.on('lawn_wheel', undefined, pl, [0.3, 0.015, 0], [0, 1, 0]);
    const c = wagonCheck(b.bp);
    expect(c.wheels).toBe(0);
    expect(c.stuckWheels).toBe(1);
    expect(note(b.bp, 'wheels')!.text).toMatch(/SIDE/);
  });

  it('wheels all down one side will tip; spread out, they will not', () => {
    const b = new Builder();
    const pl = b.free('plank');
    b.on('lawn_wheel', 'hub', pl, [0.45, 0, 0.075], [0, 0, 1]);
    b.on('lawn_wheel', 'hub', pl, [-0.45, 0, 0.075], [0, 0, 1]);
    b.on('lawn_wheel', 'hub', pl, [0, 0, 0.075], [0, 0, 1]);
    expect(note(b.bp, 'spread')!.done).toBe(false);
    expect(note(b.bp, 'spread')!.text).toMatch(/one side/);
    b.on('lawn_wheel', 'hub', pl, [0.45, 0, -0.075], [0, 0, -1]);
    b.on('lawn_wheel', 'hub', pl, [-0.45, 0, -0.075], [0, 0, -1]);
    expect(note(b.bp, 'spread')!.done).toBe(true);
  });

  it('a crate with the wheels mounted too high drags on the ground; lower them and it rides', () => {
    const high = new Builder();
    let cr = high.free('crate');
    for (const [x, z] of [[0.25, 0.15], [0.25, -0.15], [-0.25, 0.15], [-0.25, -0.15]] as const) high.on('lawn_wheel', 'hub', cr, [x, 0, z], [Math.sign(x), 0, 0]);
    expect(wagonCheck(high.bp).rolls).toBe(false);
    expect(note(high.bp, 'rolls')!.text).toMatch(/dragging/);
    const low = new Builder();
    cr = low.free('crate');
    for (const [x, z] of [[0.25, 0.15], [0.25, -0.15], [-0.25, 0.15], [-0.25, -0.15]] as const) low.on('lawn_wheel', 'hub', cr, [x, -0.15, z], [Math.sign(x), 0, 0]);
    expect(wagonCheck(low.bp).rolls).toBe(true);
  });

  it('a handle is anything long sticking out past the body: a broom, or another plank', () => {
    const b = new Builder();
    const pl = b.free('plank');
    for (const [x, z] of [[0.45, 0.075], [-0.45, 0.075], [0.45, -0.075], [-0.45, -0.075]] as const) b.on('lawn_wheel', 'hub', pl, [x, 0, z], [0, 0, Math.sign(z)]);
    expect(wagonCheck(b.bp).handle).toBeNull();
    expect(wagonCheck(b.bp).ok).toBe(false);
    const h = b.on('plank', 'end', pl, [0.6, 0, 0], [1, 0, 0]);
    expect(wagonCheck(b.bp).handle).toBe(h);
    expect(wagonCheck(b.bp).ok).toBe(true);
  });

  it('no note ever grades the builder', () => {
    const banned = /\b(fail(ed|ure)?|wrong|incorrect|invalid|bad|error)\b/i;
    const builds = [new Builder().bp, wagonBlueprint()];
    const b = new Builder();
    const pl = b.free('plank');
    b.on('lawn_wheel', 'hub', pl, [0.45, 0, 0.075], [0, 0, 1]);
    builds.push(b.bp);
    for (const bp of builds) for (const n of wagonCheck(bp).notes) expect(n.text).not.toMatch(banned);
  });
});

describe('the wagon the kid built rolls like the real thing', () => {
  it('the frame turns the handle to the back and puts the wheels on the ground', () => {
    const f = wagonFrame(wagonBlueprint());
    expect(f.wheels).toHaveLength(4);
    expect(f.half[2]).toBeGreaterThan(0.5); // a plank is 1.2 m long
    expect(f.tow).toBeGreaterThan(WAGON.tow); // the broom is long
    expect(f.bedTop).toBeGreaterThan(0.15);
    expect(f.bedTop).toBeLessThan(0.35);
  });

  it('is towed at its own handle length, loads junk, and persists its design', () => {
    const bp = wagonBlueprint();
    const sim = new Simulation({ junk: false, wagonBp: bp });
    const w = sim.wagon!;
    expect(w.bp).toBe(bp);
    sim.teleportPlayer([WORLD.wagon.pos[0] + 1, 0, WORLD.wagon.pos[2]]);
    sim.hitchWagon(true);
    const inp = emptyInput();
    inp.yaw = Math.PI;
    inp.moveZ = 1;
    sim.run(3, inp);
    const kid = toV(sim.player!.translation());
    const at = toV(w.rb.translation());
    expect(kid.z).toBeGreaterThan(WORLD.wagon.pos[2] + 5);
    expect(Math.hypot(kid.x - at.x, kid.z - at.z)).toBeCloseTo(w.tow, 0);
    const crate = sim.spawnItem({ part: 'crate', pos: [kid.x, 0.3, kid.z + 0.8] });
    expect(sim.loadWagon(crate).ok).toBe(true);
  });

  it('MISSION 0 is solved by hauling three things into the lab on a wagon you rolled out yourself', () => {
    const p = PROJECT_MAP.build_wagon;
    const sim = new Simulation({ project: p, wagon: false });
    expect(sim.wagon).toBeNull();
    sim.run(0.5);
    expect(successOf(sim)).toBeUndefined();
    // Roll it out of the lab.
    sim.addWagon(wagonBlueprint(), { pos: WORLD.wagon.pos, yaw: -90 });
    sim.teleportPlayer([WORLD.wagon.pos[0] + 2.2, 0, WORLD.wagon.pos[2]], Math.PI / 2);
    for (let i = 0; i < 3; i++) expect(sim.loadWagon(sim.spawnItem({ part: 'brick', pos: [WORLD.wagon.pos[0] + 1, 0.3, WORLD.wagon.pos[2] + 0.5 + i * 0.3] })).ok).toBe(true);
    sim.run(0.5);
    expect(successOf(sim)).toBeUndefined();
    sim.hitchWagon(true);
    // Step round it, then walk west into the lab with it trailing behind (over the lip of the garage floor).
    const south = { ...emptyInput(), yaw: Math.PI, moveZ: 1 };
    const west = { ...emptyInput(), yaw: Math.PI / 2, moveZ: 1 };
    expect(runUntil(sim, 12, () => (sim.time < 0.7 ? south : west), () => !!successOf(sim))).toBe(true);
    expect(sim.wagon!.hitched).toBe(true);
    expect(toV(sim.wagon!.rb.translation()).x).toBeLessThan(-8);
  });

  it('walking into the wagon on the handle shoves it along; the kid never climbs onto it', () => {
    const sim = new Simulation({ project: PROJECT_MAP.build_wagon, wagon: false, junk: false });
    sim.addWagon(wagonBlueprint(), { pos: [0, 0, 0], yaw: -90 });
    sim.teleportPlayer([2.2, 0, 0], Math.PI / 2);
    sim.hitchWagon(true);
    const west = { ...emptyInput(), yaw: Math.PI / 2, moveZ: 1 };
    let highest = 0;
    for (let i = 0; i < 360; i++) {
      sim.step(west);
      highest = Math.max(highest, toV(sim.player!.translation()).y);
    }
    expect(highest).toBeLessThan(0.75);
    expect(toV(sim.wagon!.rb.translation()).x).toBeLessThan(-3);
    expect(sim.wagon!.hitched).toBe(true);
  });

  it('two things in the wagon is not enough; neither is three things in the stock wagon parked outside', () => {
    const p = PROJECT_MAP.build_wagon;
    const sim = new Simulation({ project: p, junk: false });
    for (let i = 0; i < 3; i++) sim.loadWagon(sim.spawnItem({ part: 'brick', pos: [1, 0.3, 1 + i * 0.3] }));
    sim.run(1);
    expect(successOf(sim)).toBeUndefined();
    sim.takeFromWagon();
    sim.wagon!.rb.setTranslation({ x: -11, y: 0.01, z: -3 }, true);
    sim.run(1);
    expect(successOf(sim)).toBeUndefined();
  });
});
