import { describe, expect, it } from 'vitest';
import { CHAPTER_MAP, CHAPTERS, chaptersForParts, distanceTravelled, GRAVITY, heightAt, heightFromEnergy, kineticEnergy, LATER_CHAPTERS, lever, projectilePeak, projectileRange, slide, speedAfter, speedFromEnergy, springEnergy, torque, trajectory } from '../src/data/physics101';
import { analyze, emptyStats } from '../src/game/diagnostics';
import { PROJECT_MAP } from '../src/data/projects';
import { PART_MAP } from '../src/data/parts';

describe('PHYSICS 101: the chapters', () => {
  it('starts with the five early chapters, each with an idea, words, a note from Mom and optional math', () => {
    expect(CHAPTERS.map((c) => c.id)).toEqual(['motion', 'forces', 'levers', 'projectile', 'energy']);
    CHAPTERS.forEach((c, i) => {
      expect(c.n).toBe(i + 1);
      expect(c.idea.length).toBeGreaterThan(40);
      expect(c.words.length).toBeGreaterThanOrEqual(3);
      expect(c.momsNote.length).toBeGreaterThan(10);
      expect(c.tryIt.length).toBeGreaterThan(10);
      expect(c.math.length).toBeGreaterThanOrEqual(1);
      expect(CHAPTER_MAP[c.id]).toBe(c);
    });
    // The later chapters are only teasers for now.
    expect(LATER_CHAPTERS.map((c) => c.title)).toContain('Momentum');
    expect(LATER_CHAPTERS.length).toBeGreaterThanOrEqual(5);
  });

  it('pages come unstuck as the kid meets each idea: the first two with the book, the rest from parts on the bench', () => {
    expect(CHAPTERS.filter((c) => c.unlock.withBook).map((c) => c.id)).toEqual(['motion', 'forces']);
    for (const c of CHAPTERS) {
      if (c.unlock.withBook) continue;
      expect(c.unlock.parts.length).toBeGreaterThan(0);
      for (const id of c.unlock.parts) expect(PART_MAP[id], `${c.id}: ${id}`).toBeTruthy();
      expect(c.unlock.tease.length).toBeGreaterThan(10);
    }
    expect(chaptersForParts(['plank', 'lawn_wheel'])).toEqual([]);
    expect(chaptersForParts(['plank', 'hinge'])).toEqual(['levers']);
    expect(chaptersForParts(['crate', 'bungee'])).toEqual(['projectile', 'energy']);
    expect(chaptersForParts(['battery_small'])).toEqual(['energy']);
    expect(chaptersForParts(['bottle_rocket'])).toEqual(['projectile']);
  });

  it('is a tool, not homework: no quizzes, grades or "correct answers" anywhere in it', () => {
    const banned = /\b(quiz|test your|grade|score|correct answer|homework|lesson|exam|wrong)\b/i;
    for (const c of CHAPTERS) {
      for (const t of [c.title, c.useFor, c.idea, c.momsNote, c.tryIt, ...c.words.map((w) => `${w.term} ${w.plain}`), ...c.math.map((m) => m.plain)]) expect(t).not.toMatch(banned);
    }
    // Equations are optional extras, never in the idea itself.
    for (const c of CHAPTERS) expect(c.idea).not.toMatch(/[=×²]/);
  });
});

describe('PHYSICS 101: the experiments compute real physics', () => {
  it('motion: steady speed adds up; acceleration grows the gaps', () => {
    expect(distanceTravelled(3, 0, 4)).toBeCloseTo(12);
    expect(distanceTravelled(0, 2, 3)).toBeCloseTo(9);
    expect(speedAfter(1, 2, 3)).toBe(7);
    expect(distanceTravelled(3, 0, 8)).toBeCloseTo(2 * distanceTravelled(3, 0, 4));
  });

  it('forces: a push has to beat friction, and heavier things pick up speed more slowly', () => {
    const stuck = slide(20, 5, 0.6);
    expect(stuck.moves).toBe(false);
    expect(stuck.friction).toBeCloseTo(20); // friction matches the push exactly
    const goes = slide(40, 5, 0.6);
    expect(goes.moves).toBe(true);
    expect(goes.friction).toBeCloseTo(0.6 * 5 * GRAVITY);
    expect(goes.accel).toBeGreaterThan(0);
    expect(slide(40, 10, 0.6).moves).toBe(false);
    expect(slide(40, 10, 0.05).accel).toBeGreaterThan(goes.accel * 0.4);
  });

  it('levers: push farther from the pivot and the same push makes more turn', () => {
    expect(torque(20, 0.5)).toBe(10);
    const near = lever(30, 0.3, 5, 0.3);
    const far = lever(30, 0.9, 5, 0.3);
    expect(far.pushTorque).toBeGreaterThan(near.pushTorque);
    expect(near.lifts).toBe(false);
    expect(far.lifts).toBe(true);
    expect(far.advantage).toBeCloseTo(3);
    expect(far.pushNeeded).toBeCloseTo((5 * GRAVITY * 0.3) / 0.9);
  });

  it('projectiles: 45° goes farthest, steeper goes higher, more gravity pulls it down sooner', () => {
    const r45 = projectileRange(8, 45);
    expect(r45).toBeCloseTo((64 * Math.sin(Math.PI / 2)) / GRAVITY, 3);
    expect(projectileRange(8, 30)).toBeLessThan(r45);
    expect(projectileRange(8, 60)).toBeLessThan(r45);
    expect(projectileRange(8, 30)).toBeCloseTo(projectileRange(8, 60), 6);
    expect(projectilePeak(8, 60)).toBeGreaterThan(projectilePeak(8, 30));
    expect(projectileRange(8, 45, 20)).toBeLessThan(projectileRange(8, 45, 9.81));
    expect(projectileRange(12, 45)).toBeGreaterThan(projectileRange(8, 45));
    // The drawn path agrees with the formula and ends on the ground.
    const pts = trajectory(8, 45);
    expect(pts[0]).toEqual({ x: 0, y: 0 });
    expect(pts[pts.length - 1].y).toBe(0);
    expect(pts[pts.length - 1].x).toBeCloseTo(r45, 2);
    expect(Math.max(...pts.map((p) => p.y))).toBeCloseTo(projectilePeak(8, 45), 1);
    // Height at the fence: short throws never get there; a good one clears it.
    expect(heightAt(5, 45, 9.1)).toBeNull();
    expect(heightAt(12, 45, 9.1)!).toBeGreaterThan(2.1);
    expect(heightAt(14, 20, 9.1)!).toBeLessThan(2.1);
  });

  it('energy moves house: spring → moving → height, and stretching twice as far stores four times as much', () => {
    expect(springEnergy(400, 0.3)).toBeCloseTo(18);
    expect(springEnergy(400, 0.6)).toBeCloseTo(4 * springEnergy(400, 0.3));
    const v = speedFromEnergy(18, 0.4);
    expect(v).toBeCloseTo(Math.sqrt(90));
    expect(kineticEnergy(0.4, v)).toBeCloseTo(18);
    expect(heightFromEnergy(18, 0.4)).toBeCloseTo(18 / (0.4 * GRAVITY));
    expect(speedFromEnergy(0, 1)).toBe(0);
  });
});

describe('PHYSICS 101 connects to the test results', () => {
  const ball = PROJECT_MAP.ball_over_fence;
  it('a launch that comes up short reports the flight in metres and points at Projectile Motion', () => {
    const r = analyze({ ...emptyStats(), hasTarget: true, goalStart: 1.5, goalEnd: 0.8, flew: true, flightRange: 2.3, targetPeak: 1.1, landedGap: 0.8, targetMoved: 2.3, targetTopSpeed: 4.2 }, ball);
    expect(r.chapter).toBe('projectile');
    expect(r.observation).toMatch(/flew/i);
    expect(r.observation).toMatch(/2\.3 m/);
    expect(r.observation).toMatch(/0\.8 m short/);
    expect(r.facts.some((f) => /flew 2\.3 m/.test(f))).toBe(true);
    expect(r.mood).toBe('close');
  });

  it('the machine itself flying (a rocket, a flung arm) that misses is a launch to aim: Projectile Motion', () => {
    const r = analyze({ ...emptyStats(), hasTarget: true, snagged: true, closest: 1.4, machineMoved: 6, launched: true, launchPeak: 5.8, launchRange: 3.1, maxTilt: 160 }, PROJECT_MAP.kite_in_tree);
    expect(r.chapter).toBe('projectile');
    expect(r.observation).toMatch(/flew.*5\.8 m.*3\.1 m.*1\.4 m/);
    const tore = analyze({ ...emptyStats(), hasTarget: true, closest: 0.1, launched: true, launchPeak: 8.2, launchRange: 0.1, breaks: 1, lastBreak: { part: 'bottle_rocket', other: 'brick' } }, PROJECT_MAP.kite_in_tree);
    expect(tore.chapter).toBe('projectile');
    expect(tore.observation).toMatch(/tore off the brick.*Straight up 8\.2 m/);
    expect(r.observation).not.toMatch(/flipped/);
    expect(r.facts).toContain('The machine flew 5.8 m high, 3.1 m across');
  });

  it('every kind of result hands over the clues it has, in plain units, never more than four', () => {
    const r = analyze({ ...emptyStats(), hasTarget: true, closest: 0.6, goalStart: 1.5, goalEnd: 1.5, machineMoved: 1.2, maxTilt: 38, powered: true, factorSum: 50, factorSamples: 100 }, ball);
    expect(r.facts).toContain('Closest: 0.6 m from the ball');
    expect(r.facts).toContain('Still 1.5 m from home');
    expect(r.facts.length).toBeLessThanOrEqual(4);
    expect(r.facts.every((f) => /\d/.test(f))).toBe(true);
    expect(analyze({ ...emptyStats(), success: true }, ball).chapter).toBeNull();
  });

  it('each failure points at the chapter that explains it', () => {
    const chapterOf = (over: Parameters<typeof analyze>[0] extends infer S ? Partial<S> : never) => analyze({ ...emptyStats(), ...over }, ball).chapter;
    expect(chapterOf({ noBattery: true })).toBe('energy');
    expect(chapterOf({ powered: true, dead: true })).toBe('energy');
    expect(chapterOf({ breaks: 1, lastBreak: { part: 'lawn_wheel', other: 'plank' } })).toBe('forces');
    expect(chapterOf({ maxTilt: 150 })).toBe('levers');
    expect(chapterOf({ maxTilt: 60 })).toBe('levers');
    expect(chapterOf({ hasTarget: true, closest: 2.2, machineMoved: 1 })).toBe('motion');
    expect(chapterOf({ hasTarget: true, closest: 2.2 })).toBe('forces');
    expect(chapterOf({ hasTarget: true, goalStart: 1, goalEnd: 2 })).toBe('forces');
  });
});
