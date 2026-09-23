import { describe, expect, it } from 'vitest';
import { linkTension, reducedMass, RopeSim, stableStiffness } from '../src/sim/links';
import { solvePower } from '../src/sim/power';
import { evalCond, ObjectiveTracker, type WorldQuery } from '../src/sim/objectives';
import { PROJECT_MAP } from '../src/data/projects';
import { Vector3 } from 'three';

describe('power', () => {
  it('delivers everything when the battery can keep up', () => {
    const bat = { energy: 1000, maxWatts: 300 };
    const r = solvePower([{ watts: 110, demand: 1 }, { watts: 110, demand: 1 }], [bat], 0.1);
    expect(r.factor).toBe(1);
    expect(bat.energy).toBeCloseTo(1000 - 220 * 0.1);
  });

  it('browns everything out together when asked for too much', () => {
    const r = solvePower([{ watts: 700, demand: 1 }], [{ energy: 1e5, maxWatts: 260 }], 0.01);
    expect(r.factor).toBeCloseTo(260 / 700);
  });

  it('a flat battery powers nothing', () => {
    const r = solvePower([{ watts: 100, demand: 1 }], [{ energy: 0, maxWatts: 300 }], 0.01);
    expect(r.factor).toBe(0);
  });

  it('parallel batteries share the load', () => {
    const a = { energy: 1000, maxWatts: 100 };
    const b = { energy: 1000, maxWatts: 300 };
    const r = solvePower([{ watts: 200, demand: 1 }], [a, b], 1);
    expect(r.factor).toBe(1);
    expect(1000 - a.energy).toBeCloseTo(50);
    expect(1000 - b.energy).toBeCloseTo(150);
  });

  it('never drains a battery below empty', () => {
    const bat = { energy: 5, maxWatts: 300 };
    solvePower([{ watts: 300, demand: 1 }], [bat], 1);
    expect(bat.energy).toBe(0);
  });
});

describe('ropes, bungees and springs', () => {
  it('ropes only pull, and only when taut', () => {
    expect(linkTension('rope', 2, 1.5, 0, 1000, 0)).toBe(0);
    expect(linkTension('rope', 2, 2.1, 0, 1000, 0)).toBeCloseTo(100);
    expect(linkTension('elastic', 0.4, 0.2, -5, 400, 10)).toBe(0);
  });

  it('springs push back when squashed', () => {
    expect(linkTension('spring', 0.35, 0.2, 0, 2000, 0)).toBeCloseTo(-300);
  });

  it('stiffness is capped so light objects do not explode', () => {
    const dt = 1 / 120;
    const k = stableStiffness(1e6, 0.4, dt);
    // the explicit-integration stability bound: k * dt^2 / m well under 1
    expect((k * dt * dt) / 0.4).toBeLessThan(0.5);
    expect(reducedMass(2, Infinity)).toBe(2);
    expect(reducedMass(2, 2)).toBe(1);
  });

  it('a rope drapes over a fence and pulls its ends toward the top of it', () => {
    // Fence: thin wall at x = 0 up to y = 2.
    const collide = (p: Vector3, r: number) => {
      const hx = 0.06 + r;
      const top = 2 + r;
      if (Math.abs(p.x) < hx && p.y < top) {
        if (top - p.y < hx - Math.abs(p.x)) p.y = top;
        else p.x = p.x < 0 ? -hx : hx;
      }
      if (p.y < r) p.y = r;
    };
    const a = new Vector3(-1.5, 3, 0);
    const b = new Vector3(1.5, 3, 0);
    // Thrown over: starts nearly straight above the fence, then the ends drop.
    const rope = new RopeSim(new Vector3(-1.5, 3, 0), new Vector3(1.5, 3, 0), 3.2);
    // The ends fall to the ground on either side (as if the rope was thrown over).
    for (let i = 0; i < 400; i++) {
      a.y = b.y = Math.max(0.2, 3 - i * 0.03);
      rope.step(a, b, 1 / 120, collide, 12);
    }
    const top = Math.max(...rope.pts.map((p) => p.y));
    expect(top).toBeGreaterThan(1.99);
    // Taut over the fence: path longer than the straight line.
    expect(rope.pathLength()).toBeGreaterThan(a.distanceTo(b) + 1);
    // End A is pulled up and toward the fence, not straight at end B.
    const d = rope.pullDirA();
    expect(d.y).toBeGreaterThan(0.5);
  });
});

describe('objectives are about the world, not the machine', () => {
  const q = (over: Partial<WorldQuery> = {}): WorldQuery => ({
    time: 10,
    pos: (t) => (t === 'target' ? { x: 16.5, y: 0.1, z: 5.6 } : { x: 0, y: 0.6, z: 0 }),
    speed: () => 0,
    held: () => false,
    touched: () => false,
    snagged: () => false,
    ...over,
  });
  const p = PROJECT_MAP.ball_over_fence;

  it('the ball next door is not a success', () => {
    expect(evalCond(p.success, q())).toBe(false);
  });

  it('the ball back in our yard is a success, however it got there', () => {
    const home = q({ pos: (t) => (t === 'target' ? { x: 10, y: 0.1, z: 5 } : { x: 0, y: 0.6, z: 0 }) });
    const tr = new ObjectiveTracker(p);
    const evs = [...tr.update(home, 0.3), ...tr.update(home, 0.4)];
    expect(evs.some((e) => e.type === 'success')).toBe(true);
  });

  it('it has to stay home for a moment (a bounce through the yard does not count)', () => {
    const tr = new ObjectiveTracker(p);
    const home = q({ pos: (t) => (t === 'target' ? { x: 10, y: 0.1, z: 5 } : { x: 0, y: 0.6, z: 0 }) });
    expect(tr.update(home, 0.3).some((e) => e.type === 'success')).toBe(false);
    tr.update(q(), 0.1);
    expect(tr.update(home, 0.3).some((e) => e.type === 'success')).toBe(false);
  });

  it('holding the ball while standing next door does not count yet', () => {
    const next = q({ held: () => true, pos: (t) => (t === 'target' ? { x: 17, y: 1, z: 5 } : { x: 17.5, y: 0.6, z: 5 }) });
    expect(evalCond(p.success, next)).toBe(false);
  });

  it('bonuses: stepping next door loses "never set foot next door" for good', () => {
    const tr = new ObjectiveTracker(p);
    tr.update(q({ pos: (t) => (t === 'player' ? { x: 18, y: 0.6, z: 0 } : { x: 16.5, y: 0.1, z: 5.6 }) }), 0.1);
    const home = q({ pos: (t) => (t === 'target' ? { x: 10, y: 0.1, z: 5 } : { x: 0, y: 0.6, z: 0 }) });
    tr.update(home, 0.3);
    const s = tr.update(home, 0.4).find((e) => e.type === 'success');
    expect(s && s.type === 'success' && s.bonuses.find((b) => b.def.id === 'stayed_home')!.earned).toBe(false);
  });

  it('a ball that leaves the world triggers the respawn rule', () => {
    const tr = new ObjectiveTracker(p);
    const lost = q({ pos: (t) => (t === 'target' ? { x: 60, y: 0, z: 0 } : { x: 0, y: 0.6, z: 0 }) });
    expect(tr.update(lost, 0.1).some((e) => e.type === 'fail')).toBe(true);
  });

  it('the kite only counts once it is free of the branch', () => {
    const k = PROJECT_MAP.kite_in_tree;
    const low = { x: 7, y: 0.3, z: 7 };
    expect(evalCond(k.success, q({ pos: () => low, snagged: () => true }))).toBe(false);
    expect(evalCond(k.success, q({ pos: () => low }))).toBe(true);
  });
});
