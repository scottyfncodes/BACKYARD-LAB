import { describe, expect, it } from 'vitest';
import { Builder, computeAttach, newBlueprint } from '../src/sim/blueprint';
import { generateStuds, rankInDirection } from '../src/game/studs';

const BENCH = { x: 0.72, z: 0.38 };

describe('invisible Lego lock points', () => {
  it('an empty bench offers a coarse grid of spots, not a continuum', () => {
    const studs = generateStuds(newBlueprint(), { forLink: false, bench: BENCH });
    expect(studs.length).toBeGreaterThan(50);
    expect(studs.length).toBeLessThan(200);
    for (const s of studs) {
      expect(s.part).toBeNull();
      expect(Math.abs(Math.round(s.point.x * 100) % 10)).toBe(0);
    }
  });

  it('motor shafts and hinge leaves are lock points, and the face pressed on the bench is not', () => {
    const b = new Builder();
    const crate = b.free('crate');
    const m = b.on('motor', 'base', crate, [0.1, 0.2, 0], [0, 1, 0]);
    b.on('hinge', 'base', crate, [-0.1, 0.2, 0], [0, 1, 0]);
    const studs = generateStuds(b.bp, { forLink: false, bench: BENCH });
    expect(studs.some((s) => s.part === m && s.special === 'shaft')).toBe(true);
    expect(studs.some((s) => s.special === 'swing')).toBe(true);
    expect(studs.some((s) => s.part === crate && s.normal.y < -0.5)).toBe(false);
    // Every lock point on a part really is on it: a wheel pressed there attaches.
    const onCrate = studs.filter((s) => s.part === crate && s.normal.y > 0.9);
    expect(onCrate.length).toBeGreaterThan(0);
    const pl = computeAttach(b.bp, 'battery_small', 'bottom', { part: crate, point: onCrate[0].point, normal: onCrate[0].normal });
    expect(pl.conn?.kind).toBe('weld');
  });

  it('ropes only get part lock points plus winch drums', () => {
    const b = new Builder();
    const crate = b.free('crate');
    b.on('winch', 'bottom', crate, [0, 0.2, 0], [0, 1, 0]);
    const studs = generateStuds(b.bp, { forLink: true, bench: BENCH });
    expect(studs.every((s) => s.part !== null)).toBe(true);
    expect(studs.some((s) => s.special === 'drum')).toBe(true);
  });

  it('the d-pad jumps to the nearest spot in the pressed direction', () => {
    const cands = [
      { i: 1, x: 150, y: 100 },
      { i: 2, x: 300, y: 100 },
      { i: 3, x: 100, y: 40 },
      { i: 4, x: 60, y: 100 },
      { i: 5, x: 160, y: 190 },
    ];
    expect(rankInDirection({ x: 100, y: 100 }, { x: 1, y: 0 }, cands)[0]).toBe(1);
    expect(rankInDirection({ x: 100, y: 100 }, { x: 0, y: -1 }, cands)[0]).toBe(3);
    expect(rankInDirection({ x: 100, y: 100 }, { x: -1, y: 0 }, cands)).toEqual([4]);
    // Something mostly sideways does not count as "down".
    expect(rankInDirection({ x: 100, y: 100 }, { x: 0, y: 1 }, [{ i: 9, x: 400, y: 110 }])).toEqual([]);
  });
});
