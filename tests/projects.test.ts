import { beforeAll, describe, expect, it } from 'vitest';
import { IDEAS } from '../src/data/ideas';
import { getPart, PART_MAP } from '../src/data/parts';
import { PROJECT_MAP, PROJECTS, type Cond } from '../src/data/projects';
import { inZone } from '../src/data/world';
import { initPhysics, toV } from '../src/sim/physics';
import { emptyInput, Simulation } from '../src/sim/simulation';

beforeAll(async () => {
  await initPhysics();
});

describe('projects: a problem, a goal and a box of parts', () => {
  it('each project states the problem, what the machine must do, and one new idea', () => {
    for (const p of PROJECTS) {
      expect(p.pitch[0].length, p.id).toBeGreaterThan(10);
      expect(p.goals.length, p.id).toBeGreaterThanOrEqual(2);
      expect(p.goals.length, p.id).toBeLessThanOrEqual(4);
      expect(p.concept.name).toMatch(/^[A-Z]+$/);
    }
    // One new idea per project: no two projects teach the same thing.
    expect(new Set(PROJECTS.map((p) => p.concept.name)).size).toBe(PROJECTS.length);
  });

  it('parts bins are curated: a manageable handful of real building parts', () => {
    for (const p of PROJECTS) {
      const kinds = Object.keys(p.bin);
      expect(kinds.length, p.id).toBeGreaterThanOrEqual(6);
      expect(kinds.length, p.id).toBeLessThanOrEqual(12);
      for (const [id, n] of Object.entries(p.bin)) {
        expect(PART_MAP[id], `${p.id}: ${id}`).toBeTruthy();
        expect(getPart(id).buildable, `${p.id}: ${id}`).toBe(true);
        expect(n).toBeGreaterThan(0);
      }
      // Never the whole library: that is what the sandbox is for.
      expect(kinds.length).toBeLessThan(Object.values(PART_MAP).filter((d) => d.buildable).length);
    }
  });

  it('hints go from a broad nudge to specific help, four of them, never shown unasked', () => {
    for (const p of PROJECTS) {
      expect(p.hints).toHaveLength(4);
      // The last hint is the most specific: it names actual parts from the bin.
      const last = p.hints[3].toLowerCase();
      expect(Object.keys(p.bin).some((id) => last.includes(getPart(id).name.toLowerCase())), p.id).toBe(true);
      // The first hint names no parts at all: it is about the problem, not the answer.
      const first = p.hints[0].toLowerCase();
      expect(Object.keys(p.bin).some((id) => first.includes(getPart(id).name.toLowerCase())), p.id).toBe(false);
      expect(p.nudges.length).toBeGreaterThanOrEqual(3);
      expect(p.nudges.length).toBeLessThanOrEqual(4);
    }
  });

  it('nothing in a briefing talks down to the player', () => {
    const banned = /\b(fail(ed|ure)?|wrong|incorrect|invalid|bad)\b/i;
    for (const p of PROJECTS) {
      for (const t of [...p.pitch, ...p.goals, ...p.hints, ...p.nudges.map((n) => n.line), p.concept.blurb]) expect(t, p.id).not.toMatch(banned);
    }
  });

  it('success is about the world, never about which parts were used', () => {
    const tags = (c: Cond): string[] => ('tag' in c ? [c.tag] : 'of' in c ? c.of.flatMap(tags) : 'cond' in c ? tags(c.cond) : []);
    for (const p of PROJECTS) for (const t of tags(p.success)) expect(['target', 'player']).toContain(t);
  });

  it('every project can be reached from the first one', () => {
    const seen = new Set([PROJECTS[0].id]);
    const queue = [PROJECTS[0].id];
    while (queue.length) for (const u of PROJECT_MAP[queue.shift()!].unlocks) if (!seen.has(u)) seen.add(u), queue.push(u);
    expect(seen.size).toBe(PROJECTS.length);
  });

  it('the "go to the problem" spot is somewhere you can actually stand, facing the target', () => {
    for (const p of PROJECTS) {
      const sim = new Simulation({ project: p });
      sim.teleportPlayer(p.site.pos, p.site.yaw);
      sim.run(0.5, { ...emptyInput(), yaw: p.site.yaw });
      const at = toV(sim.player!.translation());
      expect(Math.hypot(at.x - p.site.pos[0], at.z - p.site.pos[2]), p.id).toBeLessThan(0.3);
      expect(inZone(at, 'home_yard'), p.id).toBe(true);
      const target = toV(sim.itemByTag('target')!.rb.translation());
      const face = { x: -Math.sin(p.site.yaw), z: -Math.cos(p.site.yaw) };
      const to = { x: target.x - at.x, z: target.z - at.z };
      const cos = (face.x * to.x + face.z * to.z) / Math.hypot(to.x, to.z);
      expect(cos, p.id).toBeGreaterThan(0.8);
      expect(Math.hypot(to.x, to.z), p.id).toBeLessThan(7);
    }
  });

  it('step-by-step ideas only use parts from the bin of each project that offers them', () => {
    for (const idea of IDEAS) {
      const need = new Map<string, number>();
      for (const st of idea.steps) need.set(st.part, (need.get(st.part) ?? 0) + 1);
      for (const pid of idea.projects) for (const [id, n] of need) expect(PROJECT_MAP[pid].bin[id] ?? 0, `${idea.id} in ${pid}: ${id}`).toBeGreaterThanOrEqual(n);
    }
  });
});
