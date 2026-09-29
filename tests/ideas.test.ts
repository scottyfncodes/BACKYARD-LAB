import { beforeAll, describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { IDEAS } from '../src/data/ideas';
import { getPart } from '../src/data/parts';
import { Builder } from '../src/sim/blueprint';
import { initPhysics } from '../src/sim/physics';
import { emptyInput, Simulation } from '../src/sim/simulation';
import { place } from './helpers';

beforeAll(async () => {
  await initPhysics();
});

/** Follow an idea's steps exactly the way the guided build does. */
function follow(idea: (typeof IDEAS)[number]) {
  const b = new Builder(idea.title);
  const uids: number[] = [];
  for (const st of idea.steps) {
    if (st.free) uids.push(b.free(st.part, st.free[0], st.free[1], st.spin ?? 0, st.socket));
    else if (st.into) uids.push(b.into(st.part, st.socket, uids[st.into.step], st.into.target, st.spin ?? 0));
    else uids.push(b.on(st.part, st.socket, uids[st.on!], st.local!, st.normal!, st.spin ?? 0));
  }
  return b.bp;
}

describe('ideas (guided builds)', () => {
  it('every step of every idea is a legal placement', () => {
    for (const idea of IDEAS) expect(() => follow(idea)).not.toThrow();
  });

  it('the Sticky RC Car idea really drives', () => {
    const bp = follow(IDEAS.find((i) => i.id === 'sticky_rc_car')!);
    const sim = new Simulation({ junk: false, player: false });
    const m = place(sim, bp, 0, 0, 0);
    sim.goAll();
    const inp = emptyInput();
    inp.rc.throttle = 1;
    sim.run(2, inp);
    expect(m.center().distanceTo(new Vector3(0, m.center().y, 0))).toBeGreaterThan(2);
  });

  it('every part an idea needs is real building material (the bins are checked in projects.test)', () => {
    for (const idea of IDEAS) for (const st of idea.steps) expect(getPart(st.part).buildable).toBe(true);
  });
});
