import { beforeAll, describe, expect, it } from 'vitest';
import { ballSpot, cartPlacement, COLD_OPEN, flingBall, rocketCart } from '../src/game/coldopen';
import { EAST_FENCE_X } from '../src/data/world';
import { initPhysics, toV } from '../src/sim/physics';
import { Simulation } from '../src/sim/simulation';

beforeAll(async () => {
  await initPhysics();
});

/** The opening shot only works if the crash is real: it has to tear itself apart. */
describe('cold open: the rocket cart', () => {
  it('rockets across the lawn, hits the fence and comes apart', () => {
    const sim = new Simulation({ player: false, wagon: false });
    const bp = rocketCart();
    const m = sim.addMachine(bp, cartPlacement(bp));
    const ball = sim.spawnItem({ part: 'playground_ball', pos: ballSpot(), tag: 'ball' });
    sim.run(0.5);
    sim.drainEvents();
    sim.goAll();
    let top = 0;
    let crashed = -1;
    const breaks: string[] = [];
    for (let i = 0; i < 120 * 3; i++) {
      sim.step();
      for (const e of sim.drainEvents()) {
        if (e.type === 'break') {
          breaks.push(e.part);
          if (crashed < 0) {
            crashed = i / 120;
            flingBall(ball.rb);
          }
        }
      }
      for (const b of m.bodies) top = Math.max(top, toV(b.rb.linvel()).length());
    }
    expect(top).toBeGreaterThan(6);
    expect(crashed).toBeGreaterThan(0.5);
    expect(crashed).toBeLessThan(2);
    expect(breaks.filter((p) => p === 'lawn_wheel').length).toBeGreaterThanOrEqual(2);
    // It hit the fence, not anything on the way.
    expect(m.center().x).toBeGreaterThan(COLD_OPEN.cart.x + 2);
    // ...and the ball sailed clean over it into next door's yard.
    expect(toV(ball.rb.translation()).x).toBeGreaterThan(EAST_FENCE_X + 1);
  });
});
