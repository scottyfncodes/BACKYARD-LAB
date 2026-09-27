import { beforeAll, describe, expect, it } from 'vitest';
import { IDEAS, ideasFor } from '../src/data/ideas';
import { BALL_INTRO, PROJECT_MAP } from '../src/data/projects';
import { WORLD } from '../src/data/world';
import { RunJournal } from '../src/game/journal';
import { facingYaw, groundedPlacement } from '../src/game/placement';
import { Builder } from '../src/sim/blueprint';
import { initPhysics, toV } from '../src/sim/physics';
import { emptyInput, Simulation } from '../src/sim/simulation';
import { ballFetcher, fetchBallHome, followIdea, place, rcCar, runUntil, successOf } from './helpers';

beforeAll(async () => {
  await initPhysics();
});

/** A project the way the game starts it: the ball has done its intro bounce and rolled to rest. */
function afterIntro(projectId: string, dog = false): Simulation {
  const sim = new Simulation({ project: PROJECT_MAP[projectId], dog });
  const ball = sim.itemByTag('target')!;
  const [kx, ky, kz] = BALL_INTRO.kick;
  ball.rb.setLinvel({ x: kx, y: ky, z: kz }, true);
  sim.objectivesPaused = true;
  sim.run(6);
  sim.objectivesPaused = false;
  return sim;
}

/** The Suck-o-Matic as the guide builds it, optionally with the battery swapped. */
function suckOMatic(battery = 'battery_small') {
  const idea = IDEAS.find((i) => i.id === 'suck_o_matic')!;
  const b = new Builder(idea.title);
  const v = b.free('vacuum', 0, 0, 0, 'bottom');
  b.on(battery, 'bottom', v, [0, 0.18, 0], [0, 1, 0]);
  return b.bp;
}

/** Set a machine down at the gap the way the kid does: standing in the yard, looking east at the fence. */
const atTheGap = (sim: Simulation, bp: ReturnType<typeof suckOMatic>, x = 14.3) => {
  const m = sim.addMachine(bp, groundedPlacement(bp, x, 0, 4.8, facingYaw(-Math.PI / 2)));
  sim.run(0.3);
  return m;
};

describe('THE BALL, first project: the shop vac and the battery it needs', () => {
  it('the first idea offered is the Suck-o-Matic, and the RC car waits for the second project', () => {
    expect(ideasFor('ball_over_fence')[0].id).toBe('suck_o_matic');
    expect(ideasFor('ball_again').map((i) => i.id)).toEqual(['sticky_rc_car']);
    expect(PROJECT_MAP.ball_over_fence.unlocks).toEqual(['ball_again']);
  });

  it('the guided build uses only what is on the lab shelf; the car battery is not in the garage', () => {
    const idea = IDEAS.find((i) => i.id === 'suck_o_matic')!;
    const sim = new Simulation({ project: PROJECT_MAP.ball_over_fence });
    const onShelf = sim.itemsInZone('lab').map((i) => i.def.id);
    for (const st of idea.steps) expect(onShelf).toContain(st.part);
    expect(onShelf).not.toContain('battery_car');
    const bat = [...sim.items.values()].find((i) => i.def.id === 'battery_car')!;
    const p = toV(bat.rb.translation());
    // Round the back of the shed: behind it, between the shed and the back fence.
    expect(p.z).toBeGreaterThan(13);
    expect(p.x).toBeGreaterThan(-12);
    expect(p.x).toBeLessThan(-8);
  });

  it('on the lantern battery it browns out and the ball stays next door', () => {
    const sim = afterIntro('ball_over_fence');
    const ball = sim.itemByTag('target')!;
    const rest = toV(ball.rb.translation());
    expect(rest.x).toBeGreaterThan(15.5);
    // Within reach of a vac at the gap. If it rolls further than this the first project cannot be solved.
    expect(rest.x).toBeLessThan(17);
    expect(toV(ball.rb.linvel()).length()).toBeLessThan(0.05);
    const m = atTheGap(sim, suckOMatic('battery_small'));
    sim.goAll();
    sim.run(12);
    expect(m.powerSummary()!.factor).toBeLessThan(0.4);
    expect(sim.drainEvents().some((e) => e.type === 'brownout')).toBe(true);
    expect(successOf(sim)).toBeUndefined();
    expect(toV(ball.rb.translation()).x).toBeGreaterThan(15.5);
  });

  it('with the car battery swapped in, the same machine in the same spot brings it home hands-free', () => {
    const sim = afterIntro('ball_over_fence');
    atTheGap(sim, suckOMatic('battery_car'));
    sim.goAll();
    const ok = runUntil(sim, 15, emptyInput, () => !!successOf(sim));
    expect(ok).toBe(true);
    const s = successOf(sim) as any;
    expect(s.bonuses.find((b: any) => b.def.id === 'hands_off').earned).toBe(true);
    expect(s.bonuses.find((b: any) => b.def.id === 'stayed_home').earned).toBe(true);
  });

  it('a browned-out vacuum is feeble, not merely weaker (fan law), and a lawn resists a feeble pull', () => {
    const pulled = (battery: string) => {
      const b = new Builder('vac');
      const crate = b.free('crate');
      b.on(battery, 'bottom', crate, [0, 0.2, 0], [0, 1, 0]);
      b.on('vacuum', 'back', crate, [0, 0, 0.25], [0, 0, 1]);
      const sim = new Simulation({ junk: false, player: false });
      const ball = sim.spawnItem({ part: 'playground_ball', pos: [0, 0.11, 3.0] });
      place(sim, b.bp, 0, 0, 0);
      sim.run(0.3);
      sim.goAll();
      sim.run(4);
      return 3.0 - toV(ball.rb.translation()).z;
    };
    expect(pulled('battery_car')).toBeGreaterThan(0.5);
    expect(pulled('battery_small')).toBeLessThan(0.05);
  });
});

describe('THE BALL. AGAIN.: the second project needs something that goes and gets it', () => {
  it('the vac at the gap cannot reach a ball that far away', () => {
    const sim = afterIntro('ball_again');
    atTheGap(sim, suckOMatic('battery_car'));
    sim.goAll();
    sim.run(10);
    expect(successOf(sim)).toBeUndefined();
  });

  it('DRIVE: the guided sticky RC car fetches it and drags it home', () => {
    const sim = afterIntro('ball_again');
    const { bp, uids } = followIdea(IDEAS.find((i) => i.id === 'sticky_rc_car')!);
    const receiver = uids[8];
    const m = sim.addMachine(bp, groundedPlacement(bp, 13.0, 0, 4.8, facingYaw(-Math.PI / 2)));
    sim.run(0.3);
    sim.goAll();
    const ok = fetchBallHome(sim, m, receiver, 90, 'tow');
    expect(ok).toBe(true);
    const s = successOf(sim) as any;
    expect(s.bonuses.find((b: any) => b.def.id === 'hands_off').earned).toBe(true);
  });

  it('Biscuit comes to see what the fuss is about, and still cannot stop the tow', () => {
    // The dog is in the game's sim but not in most tests. He must never be the reason a project fails.
    const sim = afterIntro('ball_again', true);
    const { bp, uids } = followIdea(IDEAS.find((i) => i.id === 'sticky_rc_car')!);
    const receiver = uids[8];
    const m = sim.addMachine(bp, groundedPlacement(bp, 13.0, 0, 4.8, facingYaw(-Math.PI / 2)));
    sim.run(0.3);
    sim.goAll();
    let closest = Infinity;
    const ball = sim.itemByTag('target')!;
    const drive = ballFetcher(sim, m, receiver, 'tow');
    const ok = runUntil(
      sim,
      90,
      () => {
        closest = Math.min(closest, sim.dog!.position().distanceTo(toV(ball.rb.translation())));
        return drive();
      },
      () => !!successOf(sim),
    );
    expect(ok).toBe(true);
    expect(closest).toBeLessThan(5); // he did get involved
  });
});

describe('the run journal explains the two new dead ends', () => {
  it('an RC machine nobody drove is "waiting", not broken', () => {
    const sim = new Simulation({ junk: false, player: false });
    const car = rcCar();
    place(sim, car.bp, 0, 0, 0);
    sim.goAll();
    const j = new RunJournal();
    j.begin(sim);
    for (let i = 0; i < 120 * 4; i++) {
      sim.step();
      for (const e of sim.drainEvents()) j.event(e);
      j.sample(sim, 1 / 120, 0);
    }
    expect(j.settled).toBe(true);
    expect(j.verdict()).toMatch(/drive it/);
  });

  it('a vacuum that never caught anything says so', () => {
    const sim = new Simulation({ junk: false, player: false });
    place(sim, suckOMatic('battery_car'), 0, 0, 0);
    sim.goAll();
    const j = new RunJournal();
    j.begin(sim);
    for (let i = 0; i < 120 * 4; i++) {
      sim.step();
      for (const e of sim.drainEvents()) j.event(e);
      j.sample(sim, 1 / 120, 0);
    }
    expect(j.verdict()).toMatch(/Closer/);
  });

  it('a switch is only offered when the remote has something to switch', () => {
    const sim = new Simulation({ junk: false, player: false });
    const car = place(sim, rcCar().bp, 0, 0, 0);
    expect(car.hasReceiver()).toBe(true);
    expect(car.hasSwitch()).toBe(false);
    const b = new Builder('rc vac');
    const bat = b.free('battery_car');
    const v = b.on('vacuum', 'back', bat, [0, 0.08, 0.09], [0, 0, 1]);
    b.on('rc_receiver', 'bottom', v, [0, 0.18, 0], [0, 1, 0]);
    const rcVac = place(sim, b.bp, 3, 0, 0);
    expect(rcVac.hasSwitch()).toBe(true);
  });
});

describe('the intro leaves the ball where the first machine can reach it', () => {
  it('THE BALL rests a little past the fence, in line with the gap', () => {
    const sim = afterIntro('ball_over_fence');
    const p = toV(sim.itemByTag('target')!.rb.translation());
    expect(p.x).toBeGreaterThan(16.5);
    expect(p.x).toBeLessThan(17.4);
    // A little to one side of the gap's centre line (z = 4.8), still inside a vacuum's cone.
    expect(Math.abs(p.z - 4.8)).toBeLessThan(1.0);
    void WORLD;
  });
});
