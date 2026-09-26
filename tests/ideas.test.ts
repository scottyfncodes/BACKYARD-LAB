import { beforeAll, describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { IDEAS, ideaFor } from '../src/data/ideas';
import { getPart } from '../src/data/parts';
import { PROJECT_MAP, PROJECTS } from '../src/data/projects';
import { Builder, type Blueprint } from '../src/sim/blueprint';
import { initPhysics } from '../src/sim/physics';
import { emptyInput, Simulation } from '../src/sim/simulation';
import { place } from './helpers';

beforeAll(async () => {
  await initPhysics();
});

/** Follow an idea's steps exactly the way the guided build does. */
export function follow(idea: (typeof IDEAS)[number]): Blueprint {
  const b = new Builder(idea.title);
  const uids: number[] = [];
  for (const st of idea.steps) {
    if (st.free) uids.push(b.free(st.part, st.free[0], st.free[1], st.spin ?? 0, st.socket));
    else if (st.into) uids.push(b.into(st.part, st.socket, uids[st.into.step], st.into.target, st.spin ?? 0));
    else if (st.tie) uids.push(b.link(st.part, uids[st.tie.a], st.tie.aLocal, uids[st.tie.b], st.tie.bLocal, st.tie.length));
    else uids.push(b.on(st.part, st.socket, uids[st.on!], st.local!, st.normal!, st.spin ?? 0));
  }
  return b.bp;
}

/** Everything a project can hand out: the kit plus whatever is lying in the yard. */
export function available(projectId: string): Map<string, number> {
  const p = PROJECT_MAP[projectId];
  const m = new Map<string, number>(Object.entries(p.kit));
  for (const y of p.yard) m.set(y.part, (m.get(y.part) ?? 0) + 1);
  return m;
}

describe('ideas (guided builds)', () => {
  it('every problem has exactly one idea, and every step of it is a legal placement', () => {
    for (const p of PROJECTS) {
      const idea = ideaFor(p.id);
      expect(idea, `${p.id} has an idea`).toBeTruthy();
      expect(() => follow(idea!)).not.toThrow();
    }
    expect(IDEAS.every((i) => PROJECT_MAP[i.project])).toBe(true);
  });

  it('an idea never needs more junk than the problem hands out (kit + yard)', () => {
    for (const idea of IDEAS) {
      const need = new Map<string, number>();
      for (const st of idea.steps) need.set(st.part, (need.get(st.part) ?? 0) + 1);
      const have = available(idea.project);
      for (const [id, n] of need) {
        expect(have.get(id) ?? 0, `${idea.id} needs ${n} ${id}`).toBeGreaterThanOrEqual(n);
        expect(getPart(id).buildable).toBe(true);
      }
    }
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
});
