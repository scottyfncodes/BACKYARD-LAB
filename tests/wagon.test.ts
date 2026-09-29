import { beforeAll, describe, expect, it } from 'vitest';
import { WORLD } from '../src/data/world';
import { initPhysics, toV } from '../src/sim/physics';
import { emptyInput, Simulation, WAGON, type Item } from '../src/sim/simulation';

beforeAll(async () => {
  await initPhysics();
});

const yard = () => new Simulation({ junk: false });
const item = (sim: Simulation, part: string, x = 0, z = 0): Item => sim.spawnItem({ part, pos: [x, 0.3, z] });

describe('the wagon', () => {
  it('is parked outside the lab and only exists when there is a kid', () => {
    const sim = yard();
    const p = toV(sim.wagon!.rb.translation());
    expect(p.x).toBeCloseTo(WORLD.wagon.pos[0], 1);
    expect(new Simulation({ junk: false, player: false }).wagon).toBeNull();
  });

  it('follows the kid at handle length when pulled, and rolls to a stop when let go', () => {
    const sim = yard();
    sim.teleportPlayer([WORLD.wagon.pos[0] + 1, 0, WORLD.wagon.pos[2]]);
    sim.hitchWagon(true);
    const inp = emptyInput();
    inp.yaw = Math.PI; // walk south (+Z)
    inp.moveZ = 1;
    sim.run(3, inp);
    expect(sim.wagon!.hitched).toBe(true);
    const kid = toV(sim.player!.translation());
    const w = toV(sim.wagon!.rb.translation());
    expect(kid.z).toBeGreaterThan(WORLD.wagon.pos[2] + 5);
    expect(Math.hypot(kid.x - w.x, kid.z - w.z)).toBeCloseTo(WAGON.tow, 0);
    // Wagon is behind the kid.
    expect(w.z).toBeLessThan(kid.z);

    sim.hitchWagon(false);
    const parked = toV(sim.wagon!.rb.translation());
    sim.run(3, inp);
    expect(toV(sim.wagon!.rb.translation()).distanceTo(parked)).toBeLessThan(1);
    expect(toV(sim.wagon!.rb.linvel()).length()).toBeLessThan(0.05);
  });

  it('loads junk out of the world, and takes it back out into your hands', () => {
    const sim = yard();
    const crate = item(sim, 'crate', 0, 0);
    const brick = item(sim, 'brick', 1, 0);
    expect(sim.loadWagon(crate).ok).toBe(true);
    expect(sim.loadWagon(brick).ok).toBe(true);
    expect(sim.items.has(crate.id)).toBe(false);
    expect(sim.wagon!.load.map((s) => s.part)).toEqual(['crate', 'brick']);
    expect(sim.drainEvents().filter((e) => e.type === 'load')).toHaveLength(2);

    expect(sim.takeFromWagon().ok).toBe(true);
    expect(sim.carried?.item.def.id).toBe('brick');
    expect(sim.wagon!.load).toHaveLength(1);
  });

  it('refuses project props, and anything past its capacity', () => {
    const sim = yard();
    const ball = sim.spawnItem({ part: 'playground_ball', pos: [0, 0.3, 0], tag: 'target' });
    expect(sim.loadWagon(ball).ok).toBe(false);
    for (let i = 0; i < WAGON.capacity; i++) expect(sim.loadWagon(item(sim, 'duct_tape', i * 0.3, 2)).ok).toBe(true);
    const r = sim.loadWagon(item(sim, 'duct_tape', 0, 3));
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/full/);
  });

  it('tips everything back out onto the ground', () => {
    const sim = yard();
    sim.loadWagon(item(sim, 'crate'));
    sim.loadWagon(item(sim, 'plank', 1));
    expect(sim.tipWagon()).toBe(2);
    expect(sim.wagon!.load).toHaveLength(0);
    sim.run(2);
    const parts = [...sim.items.values()].map((i) => i.def.id).sort();
    expect(parts).toEqual(['crate', 'plank']);
    for (const it of sim.items.values()) expect(it.rb.translation().y).toBeLessThan(0.5);
  });

  it('hauling something heavy slows the kid down less than lugging it', () => {
    const speed = (setup: (sim: Simulation) => void) => {
      const sim = yard();
      sim.teleportPlayer([WORLD.wagon.pos[0] + 1, 0, WORLD.wagon.pos[2]]);
      setup(sim);
      const inp = emptyInput();
      inp.yaw = Math.PI;
      inp.moveZ = 1;
      sim.run(1, inp);
      return toV(sim.player!.linvel()).setY(0).length();
    };
    const lugging = speed((sim) => sim.pickUp(item(sim, 'battery_car', WORLD.wagon.pos[0] + 1, WORLD.wagon.pos[2] - 0.8)));
    const hauling = speed((sim) => {
      sim.loadWagon(item(sim, 'battery_car', 5, 5));
      sim.hitchWagon(true);
    });
    expect(hauling).toBeGreaterThan(lugging);
  });
});
