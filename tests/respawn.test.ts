import { Euler, Quaternion } from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { PROJECT_MAP } from '../src/data/projects';
import { initPhysics, toQ } from '../src/sim/physics';
import { Simulation } from '../src/sim/simulation';

beforeAll(async () => {
  await initPhysics();
});

describe('respawning a target', () => {
  it('puts it back the way it started, not just where (the kite re-snags at the right point)', () => {
    const p = PROJECT_MAP.kite_in_tree;
    const sim = new Simulation({ project: p });
    const kite = sim.itemByTag('target')!;
    const start = toQ(kite.rb.rotation());
    // Knocked loose and tumbled.
    kite.rb.setRotation(new Quaternion().setFromEuler(new Euler(1.1, -0.4, 2.3)), true);
    sim.respawnItem(kite);
    expect(toQ(kite.rb.rotation()).angleTo(start)).toBeLessThan(0.01);
    expect(kite.snag).toBeTruthy();
    sim.free();
  });
});
