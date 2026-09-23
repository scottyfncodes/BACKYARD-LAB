import { beforeAll, describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { Builder } from '../src/sim/blueprint';
import { initPhysics, toV } from '../src/sim/physics';
import { emptyInput, Simulation } from '../src/sim/simulation';
import { place, rcCar } from './helpers';

beforeAll(async () => {
  await initPhysics();
});

const flat = () => new Simulation({ junk: false, player: false });
const events = (sim: Simulation) => sim.drainEvents().map((e) => e.type);

describe('frozen until GO', () => {
  it('a placed machine does not move until GO, then physics takes over', () => {
    const sim = flat();
    const b = new Builder();
    const c = b.free('crate');
    b.on('balloons', 'string', c, [0, 0.2, 0], [0, 1, 0]);
    const m = place(sim, b.bp, 0, 0, 0, 2); // floating 2 m up
    const y0 = m.center().y;
    sim.run(1);
    expect(m.center().y).toBeCloseTo(y0, 5);
    sim.goAll();
    sim.run(1);
    expect(m.center().y).toBeLessThan(y0 - 0.5);
  });
});

describe('motors, wheels and power', () => {
  it('motor-driven wheels move a cart; with a dead battery nothing happens', () => {
    const sim = flat();
    const car = rcCar();
    const m = place(sim, car.bp, 0, 0, 0);
    sim.goAll();
    const inp = emptyInput();
    inp.rc.throttle = 1;
    sim.run(2, inp);
    expect(m.center().distanceTo(new Vector3(0, m.center().y, 0))).toBeGreaterThan(2);

    const sim2 = flat();
    const m2 = place(sim2, rcCar().bp, 0, 0, 0);
    for (const p of m2.parts.values()) if (p.def.id === 'battery_small') p.energy = 0;
    sim2.goAll();
    sim2.run(2, inp);
    expect(Math.hypot(m2.center().x, m2.center().z)).toBeLessThan(0.3);
    expect(events(sim2)).toContain('batteryDead');
  });

  it('a motor with no battery on its machine does nothing', () => {
    const sim = flat();
    const b = new Builder();
    const pl = b.free('plank');
    const mo = b.on('motor', 'back', pl, [-0.45, 0, 0.075], [0, 0, 1]);
    b.into('lawn_wheel', 'hub', mo, 'shaft');
    b.on('lawn_wheel', 'hub', pl, [0.45, 0, 0.075], [0, 0, 1]);
    b.on('lawn_wheel', 'hub', pl, [0.45, 0, -0.075], [0, 0, -1]);
    b.on('lawn_wheel', 'hub', pl, [-0.45, 0, -0.075], [0, 0, -1]);
    const m = place(sim, b.bp, 0, 0, 0);
    sim.goAll();
    sim.run(2);
    expect(Math.hypot(m.center().x, m.center().z)).toBeLessThan(0.3);
  });

  it('steering is differential: one side forward, one back spins it on the spot', () => {
    const sim = flat();
    const car = rcCar();
    const m = place(sim, car.bp, 0, 0, 0);
    sim.goAll();
    const inp = emptyInput();
    inp.rc.steer = 1;
    sim.run(1.5, inp);
    const heading = new Vector3(0, 0, 1).applyQuaternion(m.partWorldPose(car.receiver)!.q);
    expect(Math.abs(Math.atan2(heading.x, heading.z))).toBeGreaterThan(0.5);
    expect(Math.hypot(m.center().x, m.center().z)).toBeLessThan(1.0);
  });
});

describe('structural failure', () => {
  it('overloading lawnmower wheels with bricks makes a wheel pop off', () => {
    const sim = flat();
    const b = new Builder();
    const pl = b.free('plank');
    for (const [x, z, nz] of [[0.5, 0.075, 1], [0.5, -0.075, -1], [-0.5, 0.075, 1], [-0.5, -0.075, -1]] as const) b.on('lawn_wheel', 'hub', pl, [x, 0, z], [0, 0, nz]);
    // A car battery on a plank on little wheels... dropped from a height.
    b.on('battery_car', 'bottom', pl, [0, 0.015, 0], [0, 1, 0]);
    place(sim, b.bp, 0, 0, 0, 1.2);
    sim.goAll();
    sim.run(2);
    const ev = sim.drainEvents().filter((e) => e.type === 'break');
    expect(ev.length).toBeGreaterThan(0);
    expect(ev.some((e) => e.type === 'break' && e.part === 'lawn_wheel')).toBe(true);
  });

  it('the same cart set down gently holds together', () => {
    const sim = flat();
    const b = new Builder();
    const pl = b.free('plank');
    for (const [x, z, nz] of [[0.5, 0.075, 1], [0.5, -0.075, -1], [-0.5, 0.075, 1], [-0.5, -0.075, -1]] as const) b.on('lawn_wheel', 'hub', pl, [x, 0, z], [0, 0, nz]);
    b.on('brick', 'flat', pl, [0, 0.015, 0], [0, 1, 0]);
    place(sim, b.bp, 0, 0, 0);
    sim.goAll();
    sim.run(2);
    expect(sim.drainEvents().some((e) => e.type === 'break')).toBe(false);
  });

  it('a rope holding too much weight snaps', () => {
    const sim = flat();
    const b = new Builder();
    // Balloons can't hold a car battery up, but a rope can't hold a battery that is falling fast either.
    const top = b.free('crate', 0, 0);
    const bat = b.free('battery_car', 0.6, 0);
    b.link('rope', top, [0, 0.2, 0], bat, [0, 0.1, 0], 0.5);
    // Place the crate high on nothing and let the battery drop on the rope from above the crate.
    const m = place(sim, b.bp, 0, 0, 0, 0);
    // Pin the crate: make it very heavy by sitting it on the ground; lift the battery up so it falls.
    const batPart = m.parts.get(bat)!;
    batPart.body.rb.setTranslation({ x: 0, y: 3.5, z: 0.0 }, true);
    sim.goAll();
    sim.run(3);
    const evs = sim.drainEvents();
    expect(evs.some((e) => e.type === 'snap')).toBe(true);
  });
});

describe('forces from junk', () => {
  it('enough balloons lift a small load; one bunch cannot lift a brick', () => {
    const sim = flat();
    const b = new Builder();
    const tape = b.free('duct_tape');
    b.on('balloons', 'string', tape, [0, 0.015, 0], [0, 1, 0]);
    const m = place(sim, b.bp, 0, 0, 0);
    sim.goAll();
    sim.run(3);
    expect(m.center().y).toBeGreaterThan(1.5);

    const sim2 = flat();
    const b2 = new Builder();
    const brick = b2.free('brick');
    b2.on('balloons', 'string', brick, [0, 0.032, 0], [0, 1, 0]);
    const m2 = place(sim2, b2.bp, 0, 0, 0);
    sim2.goAll();
    sim2.run(3);
    const brickY = m2.partWorldPose(brick)!.p.y;
    expect(brickY).toBeLessThan(0.1);
  });

  it('a box fan on a skateboard pushes it the opposite way to the wind', () => {
    const sim = flat();
    const b = new Builder();
    const sk = b.free('skateboard');
    const fan = b.on('box_fan', 'bottom', sk, [0, 0.112, 0], [0, 1, 0], 90);
    b.on('battery_small', 'bottom', sk, [0.3, 0.112, 0], [0, 1, 0]);
    const m = place(sim, b.bp, 0, 0, 0);
    const windDir = new Vector3(0, 0, 1).applyQuaternion(m.partWorldPose(fan)!.q);
    const start = m.center();
    sim.goAll();
    sim.run(2);
    const moved = m.center().sub(start);
    expect(moved.length()).toBeGreaterThan(0.3);
    expect(moved.dot(windDir)).toBeLessThan(0);
  });

  it('a pre-stretched bungee flings a hinged arm (catapult)', () => {
    const sim = flat();
    const b = new Builder();
    const base = b.free('crate');
    const hinge = b.on('hinge', 'base', base, [0, 0.2, -0.15], [0, 1, 0]);
    const arm = b.into('plank', 'flat', hinge, 'swing', 90);
    b.link('bungee', arm, [0.55, 0.015, 0], base, [0, -0.1, 0.25]);
    const m = place(sim, b.bp, 0, 0, 0);
    const q0 = m.partWorldPose(arm)!.q.clone();
    sim.goAll();
    let maxAngVel = 0;
    for (let i = 0; i < 60; i++) {
      sim.step();
      maxAngVel = Math.max(maxAngVel, toV(m.parts.get(arm)!.body.rb.angvel()).length());
    }
    expect(maxAngVel).toBeGreaterThan(5);
    // The arm swung through a real angle, not just a twitch.
    expect(m.partWorldPose(arm)!.q.angleTo(q0)).toBeGreaterThan(0.5);
  });

  it('a bottle rocket really flies', () => {
    const sim = flat();
    const b = new Builder();
    const r = b.free('bottle_rocket', 0, 0, 0, 'base');
    const m = place(sim, b.bp, 0, 0, 0);
    sim.goAll();
    let maxY = 0;
    for (let i = 0; i < 240; i++) {
      sim.step();
      maxY = Math.max(maxY, m.partWorldPose(r)!.p.y);
    }
    expect(maxY).toBeGreaterThan(5);
    expect(sim.drainEvents().some((e) => e.type === 'ignite')).toBe(true);
  });
});

describe('triggers and chain reactions', () => {
  it('an egg timer holds everything until it dings', () => {
    const sim = flat();
    const b = new Builder();
    const r = b.free('bottle_rocket', 0, 0, 0, 'base');
    const bp = b.bp;
    // timer stuck to the rocket
    const t = b.on('timer', 'bottom', r, [0.05, 0, 0], [1, 0, 0]);
    b.set(t, { delay: 2 });
    const m = place(sim, bp, 0, 0, 0);
    sim.goAll();
    sim.run(1.5);
    expect(m.partWorldPose(r)!.p.y).toBeLessThan(0.5);
    sim.run(1.5);
    expect(m.partWorldPose(r)!.p.y).toBeGreaterThan(1);
    expect(sim.drainEvents().some((e) => e.type === 'ding')).toBe(true);
  });

  it('a doormat switch fires its machine when something lands on it (Rube Goldberg)', () => {
    const sim = flat();
    // Machine A: a rocket gated by a doormat.
    const a = new Builder();
    const mat = a.free('pressure_plate');
    const r = a.on('bottle_rocket', 'side', mat, [0.25, 0, 0], [1, 0, 0]);
    const ma = place(sim, a.bp, 0, 0, 0);
    // Machine B: a brick held up by balloons? Simpler: a brick placed above the mat.
    const bb = new Builder();
    bb.free('brick');
    place(sim, bb.bp, 0, 0, 0, 0.6);
    sim.goAll();
    sim.run(0.2);
    expect(ma.partWorldPose(r)!.p.y).toBeLessThan(0.5);
    sim.run(2);
    expect(sim.drainEvents().some((e) => e.type === 'click')).toBe(true);
    expect(ma.center().distanceTo(new Vector3(0, 0, 0))).toBeGreaterThan(0.5);
  });

  it('duct tape grabs what it touches, and lets go if yanked too hard', () => {
    const sim = new Simulation({ junk: false, player: false });
    const ball = sim.spawnItem({ part: 'playground_ball', pos: [0.7, 0.11, 0] });
    const car = rcCar({ tape: true });
    const m = place(sim, car.bp, -0.6, 0, Math.PI / 2);
    sim.goAll();
    const inp = emptyInput();
    inp.rc.throttle = 0.6;
    sim.run(1.5, inp);
    expect(m.grabs.some((g) => g.other.handle === ball.rb.handle)).toBe(true);
    // Reverse: the ball comes along.
    inp.rc.throttle = -0.6;
    const before = toV(ball.rb.translation()).x;
    sim.run(1.5, inp);
    expect(toV(ball.rb.translation()).x).toBeLessThan(before - 0.5);
  });
});

describe('determinism', () => {
  it('the same machine and inputs give the same result', () => {
    const run = () => {
      const sim = flat();
      const car = rcCar();
      const m = place(sim, car.bp, 0, 0, 0.3);
      sim.goAll();
      const inp = emptyInput();
      inp.rc.throttle = 1;
      inp.rc.steer = 0.4;
      sim.run(3, inp);
      return m.center().toArray();
    };
    expect(run()).toEqual(run());
  });
});
