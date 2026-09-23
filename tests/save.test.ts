import { describe, expect, it } from 'vitest';
import { Builder } from '../src/sim/blueprint';
import { completeProject, defaultSave, discover, isUnlocked, loadSave, parseSave, sandboxParts, SAVE_KEY, writeSave } from '../src/game/save';

class MemStore {
  data = new Map<string, string>();
  getItem(k: string) {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.data.set(k, v);
  }
}

describe('save / load', () => {
  it('round-trips progress, creations and the current session', () => {
    const store = new MemStore();
    const s = defaultSave();
    discover(s, 'motor');
    discover(s, 'box_fan');
    completeProject(s, 'ball_over_fence', 123, ['hands_off']);
    const b = new Builder('Zoomer');
    const c = b.free('crate');
    b.on('motor', 'base', c, [0, 0.2, 0], [0, 1, 0]);
    s.creations.push({ name: 'Zoomer', bp: b.bp, savedAt: 1 });
    s.session = { mode: 'project', project: 'kite_in_tree', bench: b.bp, machines: [{ bp: b.bp, placement: { pos: [1, 0.2, 3], yaw: 0.5 } }], stash: { rope: 2, plank: 1 } };
    expect(writeSave(s, store)).toBe(true);
    const back = loadSave(store);
    expect(back).toEqual(s);
  });

  it('survives corrupted or hostile data', () => {
    expect(parseSave('{not json')).toEqual(defaultSave());
    expect(parseSave(JSON.stringify({ v: 99 }))).toEqual(defaultSave());
    const evil = parseSave(
      JSON.stringify({
        v: 1,
        discovered: ['motor', 'death_ray', 42],
        unlocked: ['nope'],
        completed: { ball_over_fence: { bestTime: 'fast', bonuses: [1, 'x'] }, fake: {} },
        settings: { sound: 'loud', sensitivity: 900 },
        session: { mode: 'project', project: 'moon', machines: [] },
        creations: [{ name: 'x', bp: { parts: 'lol' } }],
      }),
    );
    expect(evil.discovered).toEqual(['motor']);
    expect(evil.unlocked).toEqual(['ball_over_fence']);
    expect(evil.completed.ball_over_fence.bestTime).toBe(0);
    expect(evil.completed.fake).toBeUndefined();
    expect(evil.settings.sensitivity).toBe(1);
    expect(evil.session).toBeNull();
    expect(evil.creations).toHaveLength(0);
  });

  it('keeps working when storage throws (private mode)', () => {
    const broken = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('quota');
      },
    };
    expect(loadSave(broken)).toEqual(defaultSave());
    expect(writeSave(defaultSave(), broken)).toBe(false);
    void SAVE_KEY;
  });
});

describe('progression', () => {
  it('starts with only the first project; solving it unlocks the next ones and the sandbox', () => {
    const s = defaultSave();
    expect(isUnlocked(s, 'ball_over_fence')).toBe(true);
    expect(isUnlocked(s, 'kite_in_tree')).toBe(false);
    expect(s.sandbox).toBe(false);
    const u = completeProject(s, 'ball_over_fence', 200, []);
    expect(u.projects).toEqual(['kite_in_tree', 'dog_ball']);
    expect(u.sandbox).toBe(true);
    expect(isUnlocked(s, 'kite_in_tree')).toBe(true);
    // Replaying keeps the best time and accumulates bonuses.
    completeProject(s, 'ball_over_fence', 150, ['quick']);
    completeProject(s, 'ball_over_fence', 300, ['hands_off']);
    expect(s.completed.ball_over_fence.bestTime).toBe(150);
    expect(s.completed.ball_over_fence.bonuses.sort()).toEqual(['hands_off', 'quick']);
  });

  it('the sandbox offers exactly the junk you have discovered', () => {
    const s = defaultSave();
    expect(discover(s, 'rope')).toBe(true);
    expect(discover(s, 'rope')).toBe(false);
    expect(discover(s, 'playground_ball')).toBe(false); // props are not building material
    discover(s, 'motor');
    expect(sandboxParts(s).sort()).toEqual(['motor', 'rope']);
  });
});
