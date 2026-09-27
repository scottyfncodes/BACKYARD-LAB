import { Vector3 } from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { IDEAS } from '../src/data/ideas';
import { PROJECT_MAP } from '../src/data/projects';
import { WORLD } from '../src/data/world';
import { benchTargeted, nearBench, onBenchTop } from '../src/game/bench';
import { benchTestPlacement, facingYaw, groundedPlacement, lookDirection, machineForward } from '../src/game/placement';
import { Builder, blueprintBounds } from '../src/sim/blueprint';
import { DEG } from '../src/sim/geom';
import { initPhysics, toV } from '../src/sim/physics';
import { emptyInput, Simulation } from '../src/sim/simulation';
import { followIdea } from './helpers';

beforeAll(async () => {
  await initPhysics();
});

/**
 * The four defects the first playtest hit: spawning into a wall, machines placed
 * facing the wrong way, TEST launching machines off the bench, and the bench
 * losing the E key to the junk lying on it.
 */

describe('spawn yaw', () => {
  it('the kid starts facing the way the world says, not the house', () => {
    const sim = new Simulation({ project: PROJECT_MAP.ball_over_fence });
    expect(sim.yaw).toBeCloseTo(WORLD.playerSpawn.yaw * DEG, 6);
    const look = sim.look();
    // The house is north (-Z); the yard, the tree and the east fence are the other way.
    expect(look.z).toBeGreaterThan(0.3);
    expect(look.x).toBeGreaterThan(0.3);
  });

  it('stepping the world without look input (intros, menus) keeps that facing', () => {
    const sim = new Simulation({ project: PROJECT_MAP.ball_over_fence });
    const yaw0 = sim.yaw;
    sim.run(2, emptyInput()); // what the intro does: physics ticks, nobody is steering the head
    expect(sim.yaw).toBeCloseTo(yaw0, 6);
    sim.step({ ...emptyInput(), yaw: 1.0 }); // the player looks around: that wins
    expect(sim.yaw).toBeCloseTo(1.0, 6);
  });

  it('a project can start the kid facing its own problem', () => {
    const p = PROJECT_MAP.dog_ball;
    expect(p.spawn?.yaw).toBeDefined();
    const sim = new Simulation({ project: p });
    const eye = sim.eye();
    const to = new Vector3(...p.focus).sub(eye).setY(0).normalize();
    expect(sim.look().setY(0).normalize().dot(to)).toBeGreaterThan(0.85);
  });
});

describe('placement yaw', () => {
  it('a machine faces the way the kid is looking, for every direction', () => {
    for (const yaw of [0, 0.7, Math.PI / 2, -Math.PI / 2, 2.5, -3]) {
      const fwd = machineForward(facingYaw(yaw));
      expect(fwd.dot(lookDirection(yaw))).toBeCloseTo(1, 6);
    }
    // A manual quarter turn turns it a quarter turn.
    expect(machineForward(facingYaw(0, Math.PI / 2)).dot(lookDirection(0))).toBeCloseTo(0, 6);
  });

  it('the guided RC car points its nose and its RC arrow at the fence when placed looking at the fence', () => {
    const { bp, uids } = followIdea(IDEAS.find((i) => i.id === 'sticky_rc_car')!);
    const sim = new Simulation({ junk: false, player: false });
    const lookEast = -Math.PI / 2; // yaw that looks toward +X (the neighbour's fence)
    const m = sim.addMachine(bp, groundedPlacement(bp, 13, 0, 4.8, facingYaw(lookEast)));
    const rx = m.partWorldPose(uids[8])!; // RC brain
    const tape = m.partWorldPose(uids[9])!.p; // sticky nose
    const heading = new Vector3(0, 0, 1).applyQuaternion(rx.q);
    expect(heading.x).toBeGreaterThan(0.99);
    expect(tape.x).toBeGreaterThan(m.center().x + 0.4);
    // and it rests on the ground, footprint centred where it was aimed
    const c = m.center();
    expect(Math.abs(c.x - 13)).toBeLessThan(0.3);
    expect(Math.abs(c.z - 4.8)).toBeLessThan(0.1);
    sim.goAll();
    sim.run(0.5);
    expect(Math.abs(m.center().y - c.y)).toBeLessThan(0.02);
  });
});

describe('TEST on the bench', () => {
  it('a wheeled machine starts its test resting on the bench top instead of inside it', () => {
    const { bp } = followIdea(IDEAS.find((i) => i.id === 'sticky_rc_car')!);
    const B = WORLD.workbench;
    expect(blueprintBounds(bp).min.y).toBeLessThan(-0.05); // its wheels hang below the plank
    const sim = new Simulation({ junk: false, player: false });
    const pl = benchTestPlacement(bp, B);
    expect(pl.yaw).toBeCloseTo(Math.PI / 2, 6); // longer than the bench is deep: lies along the bench
    const m = sim.addMachine(bp, pl);
    m.go();
    const c0 = m.center();
    let maxSpeed = 0;
    for (let i = 0; i < 60; i++) {
      sim.step();
      for (const b of m.bodies) maxSpeed = Math.max(maxSpeed, toV(b.rb.linvel()).length());
    }
    expect(maxSpeed).toBeLessThan(0.6);
    expect(m.center().distanceTo(c0)).toBeLessThan(0.05);
    sim.run(2);
    expect(m.center().y).toBeGreaterThan(B.top); // still on the bench
    expect(Math.hypot(m.center().x - B.pos[0], m.center().z - B.pos[2])).toBeLessThan(0.3);
  });

  it('a vacuum stands on the bench for its test', () => {
    const b = new Builder('vac');
    const v = b.free('vacuum', 0, 0, 0, 'bottom');
    b.on('battery_small', 'bottom', v, [0, 0.18, 0], [0, 1, 0]);
    const B = WORLD.workbench;
    const sim = new Simulation({ junk: false, player: false });
    const m = sim.addMachine(b.bp, benchTestPlacement(b.bp, B));
    m.go();
    const c0 = m.center();
    sim.run(1);
    expect(m.center().distanceTo(c0)).toBeLessThan(0.03);
  });
});

describe('the bench has priority over the junk on it', () => {
  /** Point the kid's eyes at a world point and let the sim update its look ray. */
  const aim = (sim: Simulation, at: Vector3) => {
    const e = sim.eye();
    const d = at.clone().sub(e);
    sim.step({ ...emptyInput(), yaw: Math.atan2(-d.x, -d.z), pitch: Math.atan2(d.y, Math.hypot(d.x, d.z)) });
  };
  const bench = WORLD.workbench;
  const benchTop = new Vector3(bench.pos[0] + 0.5, bench.top, bench.pos[2] + 0.1);
  const standing = [bench.pos[0] + 1.5, 0, bench.pos[2]] as [number, number, number];
  const lookOf = (sim: Simulation) => {
    const l = sim.lookTarget();
    if (!l) return null;
    if (l.kind === 'item') return { kind: 'item' as const, point: toV(l.item.rb.translation()) };
    if (l.kind === 'static') return { kind: 'static' as const, id: l.id, point: l.point };
    return { kind: 'machine' as const, point: l.point };
  };

  it('1. empty bench: looking at the bench top means BUILD', () => {
    const sim = new Simulation({ junk: false });
    sim.teleportPlayer(standing, Math.PI / 2);
    aim(sim, benchTop);
    const look = lookOf(sim);
    expect(look?.kind).toBe('static');
    expect(benchTargeted(toV(sim.player!.translation()), look)).toBe(true);
  });

  it('2. bench covered in junk: looking at a motor lying on it still means BUILD', () => {
    const sim = new Simulation({ project: PROJECT_MAP.ball_over_fence });
    sim.teleportPlayer(standing, Math.PI / 2);
    sim.run(0.5); // let the junk settle on the bench
    const motor = [...sim.items.values()].find((i) => i.def.id === 'motor' && onBenchTop(toV(i.rb.translation())))!;
    expect(motor).toBeDefined();
    aim(sim, toV(motor.rb.translation()));
    const look = lookOf(sim);
    expect(look?.kind).toBe('item');
    expect(benchTargeted(toV(sim.player!.translation()), look)).toBe(true);
  });

  it('3. near the bench but looking elsewhere is not BUILD', () => {
    const sim = new Simulation({ project: PROJECT_MAP.ball_over_fence });
    sim.teleportPlayer(standing, Math.PI / 2);
    sim.run(0.5);
    const p = toV(sim.player!.translation());
    expect(nearBench(p)).toBe(true);
    aim(sim, new Vector3(bench.pos[0] + 1.5, 0, bench.pos[2] + 2)); // the garage floor beside it
    expect(benchTargeted(p, lookOf(sim))).toBe(false);
    // The vacuum on the garage floor is junk near the bench, not on it: ordinary pickup.
    const vac = [...sim.items.values()].find((i) => i.def.id === 'vacuum')!;
    sim.teleportPlayer([vac.rb.translation().x + 1.2, 0, vac.rb.translation().z], Math.PI / 2);
    aim(sim, toV(vac.rb.translation()));
    const look = lookOf(sim);
    expect(look?.kind).toBe('item');
    expect(benchTargeted(toV(sim.player!.translation()), look)).toBe(false);
  });

  it('4. junk anywhere else is picked up as usual', () => {
    const sim = new Simulation({ project: PROJECT_MAP.ball_over_fence });
    const crate = [...sim.items.values()].find((i) => i.def.id === 'crate')!;
    const cp = toV(crate.rb.translation());
    sim.teleportPlayer([cp.x + 1.5, 0, cp.z], Math.PI / 2);
    sim.run(0.2);
    aim(sim, cp);
    const look = lookOf(sim);
    expect(look?.kind).toBe('item');
    expect(nearBench(toV(sim.player!.translation()))).toBe(false);
    expect(benchTargeted(toV(sim.player!.translation()), look)).toBe(false);
    expect(sim.pickUp(crate).ok).toBe(true);
  });
});
