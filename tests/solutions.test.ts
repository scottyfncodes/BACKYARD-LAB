import { Vector3 } from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { PROJECT_MAP } from '../src/data/projects';
import { Builder } from '../src/sim/blueprint';
import { initPhysics, toV } from '../src/sim/physics';
import { emptyInput, Simulation } from '../src/sim/simulation';
import { expectFromBin, place, rcCar, runUntil, steerTo, successOf } from './helpers';

beforeAll(async () => {
  await initPhysics();
});

/**
 * The vertical-slice promise: radically different machines solve THE BALL,
 * in the real backyard, judged only by where the ball ends up.
 */
describe('THE BALL: different solutions all work', () => {
  it('DRIVE: an RC car with duct tape goes under the fence gap and drags the ball home', () => {
    const sim = new Simulation({ project: PROJECT_MAP.ball_over_fence });
    const car = rcCar({ tape: true });
    expectFromBin(PROJECT_MAP.ball_over_fence, car.bp);
    const m = place(sim, car.bp, 12.8, 4.8, Math.PI / 2);
    sim.run(0.3);
    sim.goAll();
    const ball = sim.itemByTag('target')!;
    const waypoints = [new Vector3(16.3, 0, 4.8)];
    let stage = 0;
    const ok = runUntil(
      sim,
      40,
      () => {
        const bp = toV(ball.rb.translation());
        const stuck = m.grabs.some((g) => g.other.handle === ball.rb.handle);
        if (stage === 0 && toV(m.partWorldPose(car.receiver)!.p).x > 15.9) stage = 1;
        if (stage === 1 && stuck) stage = 2;
        if (stage === 2 && m.partWorldPose(car.receiver)!.p.x > 16.8) stage = 3;
        if (stage === 0) return steerTo(m, car.receiver, waypoints[0]);
        if (stage === 1) return steerTo(m, car.receiver, bp, 0.6);
        // Swing wide, then line up with the gap and drive home.
        if (stage === 2) return steerTo(m, car.receiver, new Vector3(17.6, 0, 4.8), 0.7);
        const nose = m.partWorldPose(car.receiver)!.p;
        return steerTo(m, car.receiver, nose.x > 15.8 ? new Vector3(15.6, 0, 4.8) : new Vector3(12, 0, 4.8), 0.7);
      },
      () => !!successOf(sim),
    );
    expect(ok).toBe(true);
    const bonuses = successOf(sim)!.type === 'success' ? (successOf(sim) as any).bonuses : [];
    expect(bonuses.find((b: any) => b.def.id === 'hands_off').earned).toBe(true);
  });

  it('SUCK: a shop vac on a car battery pulls the ball through the gap', () => {
    const sim = new Simulation({ project: PROJECT_MAP.ball_over_fence });
    const b = new Builder('vac');
    const bat = b.free('battery_car');
    b.on('vacuum', 'back', bat, [0, 0.08, 0.09], [0, 0, 1]);
    expectFromBin(PROJECT_MAP.ball_over_fence, b.bp);
    // Machine +z is the nozzle direction; yaw it to face the gap (+x).
    place(sim, b.bp, 13.9, 4.85, Math.PI / 2);
    sim.run(0.3);
    sim.goAll();
    const ok = runUntil(sim, 30, emptyInput, () => !!successOf(sim));
    expect(ok).toBe(true);
  });

  it('SUCK (brownout): the same vacuum on a lantern battery is too weak to do it', () => {
    const sim = new Simulation({ project: PROJECT_MAP.ball_over_fence });
    const b = new Builder('weak vac');
    const crate = b.free('crate');
    b.on('battery_small', 'bottom', crate, [0, 0.2, 0], [0, 1, 0]);
    b.on('vacuum', 'back', crate, [0, 0.0, 0.25], [0, 0, 1]);
    expectFromBin(PROJECT_MAP.ball_over_fence, b.bp);
    const m = place(sim, b.bp, 13.6, 4.85, Math.PI / 2);
    sim.run(0.3);
    sim.goAll();
    sim.run(3);
    expect(m.powerSummary()!.factor).toBeLessThan(0.5);
    const events = sim.drainEvents();
    expect(events.some((e) => e.type === 'brownout')).toBe(true);
  });

  it('LAUNCH: the kid pumps a trampoline by the fence, flies over, and throws the ball back', () => {
    const sim = new Simulation({ project: PROJECT_MAP.ball_over_fence });
    const tramp = [...sim.items.values()].find((i) => i.def.id === 'trampoline')!;
    tramp.rb.setTranslation({ x: 14.1, y: 0.02, z: 1.5 }, true);
    sim.teleportPlayer([14.1, 0.3, 1.5], -Math.PI / 2);
    const player = sim.player!;
    let maxFeet = 0;
    // Pump: hold jump while bouncing, then drift east over the fence.
    const flew = runUntil(
      sim,
      20,
      () => {
        const inp = emptyInput();
        inp.yaw = -Math.PI / 2; // facing +x
        inp.jump = true;
        const p = toV(player.translation());
        maxFeet = Math.max(maxFeet, p.y - 0.62);
        if (p.y - 0.62 > 1.6 && toV(player.linvel()).y > 0) inp.moveZ = 1;
        return inp;
      },
      () => toV(player.translation()).x > 15.5 && toV(player.translation()).y < 1,
    );
    expect(maxFeet).toBeGreaterThan(2.1);
    expect(flew).toBe(true);
    const ball = sim.itemByTag('target')!;
    // Walk to the ball, pick it up, turn around, throw it over.
    const got = runUntil(
      sim,
      15,
      () => {
        const inp = emptyInput();
        const p = toV(player.translation());
        const to = toV(ball.rb.translation()).sub(p);
        inp.yaw = Math.atan2(-to.x, -to.z);
        inp.pitch = -0.6;
        inp.moveZ = to.setY(0).length() > 0.9 ? 1 : 0;
        return inp;
      },
      () => {
        const t = sim.lookTarget();
        if (t?.kind === 'item' && t.item === ball) return sim.pickUp(ball).ok;
        return false;
      },
    );
    expect(got).toBe(true);
    const yawHome = Math.PI / 2; // facing -x
    // Back up to get a run at it, then aim high.
    runUntil(sim, 5, () => ({ ...emptyInput(), yaw: yawHome, moveZ: -1 }), () => toV(player.translation()).x > 17.5);
    for (let i = 0; i < 60; i++) sim.step({ ...emptyInput(), yaw: yawHome, pitch: 0.7 });
    sim.drop(9);
    const ok = runUntil(sim, 6, () => ({ ...emptyInput(), yaw: yawHome }), () => !!successOf(sim));
    expect(ok).toBe(true);
    const s = successOf(sim) as any;
    expect(s.bonuses.find((b: any) => b.def.id === 'stayed_home').earned).toBe(false);
  });
});

describe('THE KITE is solvable', () => {
  it('THROW: the kid chucks a wad of duct tape at the kite and knocks it loose', () => {
    const sim = new Simulation({ project: PROJECT_MAP.kite_in_tree, junk: false });
    const tape = sim.spawnItem({ part: 'duct_tape', pos: [9.2, 0.1, 7.3] });
    sim.teleportPlayer([9.2, 0, 7.8], 0);
    sim.run(0.3);
    expect(sim.pickUp(tape).ok).toBe(true);
    const kite = sim.itemByTag('target')!;
    const aim = () => {
      const to = toV(kite.rb.translation()).sub(sim.eye());
      return { ...emptyInput(), yaw: Math.atan2(-to.x, -to.z), pitch: Math.atan2(to.y, Math.hypot(to.x, to.z)) + 0.1 };
    };
    for (let i = 0; i < 40; i++) sim.step(aim());
    sim.drop(8.5);
    const ok = runUntil(sim, 12, emptyInput, () => !!successOf(sim));
    expect(sim.drainEvents().some((e) => e.type === 'unsnag')).toBe(true);
    expect(ok).toBe(true);
  });
});

describe('THE KITE, machine version', () => {
  it('BLOW: a box fan lying on its back under the kite blows it off the branch', () => {
    const sim = new Simulation({ project: PROJECT_MAP.kite_in_tree });
    const b = new Builder('updraft');
    const crate = b.free('crate');
    // Fan on its back on top of a crate, blowing straight up; battery beside it.
    b.on('box_fan', 'back', crate, [0, 0.2, 0], [0, 1, 0]);
    b.on('battery_small', 'side', crate, [0, 0, 0.25], [0, 0, 1]);
    expectFromBin(PROJECT_MAP.kite_in_tree, b.bp);
    const m = place(sim, b.bp, 8.3, 7.9, 0);
    sim.run(1.2);
    sim.goAll();
    const kite = sim.itemByTag('target')!;
    expect(runUntil(sim, 10, emptyInput, () => !kite.snag)).toBe(true);
    // It works so well the kite floats in the updraft. Switch the fan off (reset) and it drops.
    sim.run(1);
    expect(toV(kite.rb.translation()).y).toBeGreaterThan(3);
    sim.resetMachine(m.id);
    const ok = runUntil(sim, 20, emptyInput, () => !!successOf(sim));
    expect(ok).toBe(true);
    const s = successOf(sim) as any;
    expect(s.bonuses.find((x: any) => x.def.id === 'hands_off').earned).toBe(true);
  });
});

describe("BISCUIT'S BALL is solvable", () => {
  it('SUCK: a vacuum aimed under the shed pulls the tennis ball out', () => {
    const sim = new Simulation({ project: PROJECT_MAP.dog_ball });
    const b = new Builder('vac');
    const bat = b.free('battery_car');
    b.on('vacuum', 'back', bat, [0, 0.08, 0.09], [0, 0, 1]);
    expectFromBin(PROJECT_MAP.dog_ball, b.bp);
    // Nozzle faces machine +z; yaw -90deg points it at -x (under the shed).
    place(sim, b.bp, -6.55, 11.1, -Math.PI / 2);
    sim.run(0.3);
    sim.goAll();
    const ok = runUntil(sim, 20, emptyInput, () => !!successOf(sim));
    expect(ok).toBe(true);
  });
});
