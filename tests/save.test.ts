import { describe, expect, it } from 'vitest';
import { Builder } from '../src/sim/blueprint';
import { PARTS } from '../src/data/parts';
import { completeProject, defaultSave, discover, findBook, isUnlocked, keepWagon, loadSave, parseSave, revealHint, sandboxParts, SAVE_KEY, writeSave } from '../src/game/save';
import { wagonBlueprint } from './helpers';

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
    completeProject(s, 'build_wagon', 90, []);
    completeProject(s, 'ball_over_fence', 123, ['hands_off']);
    s.wagon = wagonBlueprint();
    s.book = { found: true, read: ['motion', 'projectile'] };
    const b = new Builder('Zoomer');
    const c = b.free('crate');
    b.on('motor', 'base', c, [0, 0.2, 0], [0, 1, 0]);
    s.creations.push({ name: 'Zoomer', bp: b.bp, savedAt: 1 });
    revealHint(s, 'kite_in_tree');
    s.session = {
      mode: 'project',
      project: 'kite_in_tree',
      bench: b.bp,
      machines: [{ bp: b.bp, placement: { pos: [1, 0.2, 3], yaw: 0.5 } }],
      stash: { rope: 2, plank: 1 },
      wagon: ['brick', 'brick', 'rope'],
      hasWagon: true,
      spot: { placement: { pos: [9, 0.3, 8], yaw: 1 }, player: [10, 0, 9], yaw: 2 },
    };
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
        hintsSeen: { ball_over_fence: 99, moon: 2, kite_in_tree: 'lots' },
        creations: [{ name: 'x', bp: { parts: 'lol' } }],
      }),
    );
    expect(evil.discovered).toEqual(['motor']);
    // A finished project unlocks what it unlocks, and (for saves from before Mission 0) counts as having built the wagon.
    expect([...evil.unlocked].sort()).toEqual(['ball_over_fence', 'build_wagon', 'dog_ball', 'kite_in_tree']);
    expect(evil.completed.build_wagon).toEqual({ bestTime: 0, bonuses: [] });
    expect(evil.completed.ball_over_fence.bestTime).toBe(0);
    expect(evil.completed.fake).toBeUndefined();
    expect(evil.settings.sensitivity).toBe(1);
    expect(evil.session).toBeNull();
    expect(evil.creations).toHaveLength(0);
    expect(evil.hintsSeen).toEqual({ ball_over_fence: 4 });
    expect(evil.wagon).toBeNull();
    expect(evil.book).toEqual({ found: false, read: [] });
    const junkBook = parseSave(JSON.stringify({ v: 1, book: { found: 'yes', read: ['motion', 'astrology', 7] }, wagon: { parts: [{ uid: 1, def: 'death_ray', p: [0, 0, 0], q: [0, 0, 0, 1] }] } }));
    expect(junkBook.book).toEqual({ found: true, read: ['motion'] });
    expect(junkBook.wagon).toBeNull();
    const badSpot = parseSave(JSON.stringify({ v: 1, session: { mode: 'sandbox', machines: [], spot: { placement: { pos: [1, 'x', 2] }, player: [0, 0, 0] } } }));
    expect(badSpot.session?.spot).toBeNull();
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
  it('starts with the wagon; building it opens THE BALL; solving THE BALL opens the rest and the sandbox', () => {
    const s = defaultSave();
    expect(s.unlocked).toEqual(['build_wagon']);
    expect(isUnlocked(s, 'ball_over_fence')).toBe(false);
    expect(s.sandbox).toBe(false);
    const w = completeProject(s, 'build_wagon', 100, []);
    expect(w.projects).toEqual(['ball_over_fence']);
    // Guided competence first: the open sandbox waits for the first real engineering problem.
    expect(w.sandbox).toBe(false);
    expect(s.sandbox).toBe(false);
    expect(isUnlocked(s, 'kite_in_tree')).toBe(false);
    const u = completeProject(s, 'ball_over_fence', 200, []);
    expect(u.projects).toEqual(['dog_ball', 'kite_in_tree']);
    expect(u.sandbox).toBe(true);
    expect(isUnlocked(s, 'kite_in_tree')).toBe(true);
    // Replaying keeps the best time and accumulates bonuses.
    completeProject(s, 'ball_over_fence', 150, ['quick']);
    completeProject(s, 'ball_over_fence', 300, ['hands_off']);
    expect(s.completed.ball_over_fence.bestTime).toBe(150);
    expect(s.completed.ball_over_fence.bonuses.sort()).toEqual(['hands_off', 'quick']);
  });

  it('the sandbox offers the whole library; props are never building material', () => {
    const s = defaultSave();
    expect(discover(s, 'rope')).toBe(true);
    expect(discover(s, 'rope')).toBe(false);
    expect(discover(s, 'playground_ball')).toBe(false);
    expect(sandboxParts().sort()).toEqual(PARTS.filter((p) => p.buildable).map((p) => p.id).sort());
    expect(sandboxParts()).not.toContain('playground_ball');
  });

  it('PHYSICS 101 is found once, and the wagon the kid built is kept as its own copy', () => {
    const s = defaultSave();
    expect(s.book.found).toBe(false);
    expect(findBook(s)).toBe(true);
    expect(findBook(s)).toBe(false);
    expect(s.book.found).toBe(true);
    const bp = wagonBlueprint();
    keepWagon(s, bp);
    expect(s.wagon).toEqual(bp);
    expect(s.wagon).not.toBe(bp);
    bp.name = 'changed later';
    expect(s.wagon!.name).toBe('My Wagon');
  });

  it('hints are revealed one at a time, only when asked, and stop at four', () => {
    const s = defaultSave();
    expect(s.hintsSeen.ball_over_fence ?? 0).toBe(0);
    expect(revealHint(s, 'ball_over_fence')).toBe(1);
    expect(revealHint(s, 'ball_over_fence')).toBe(2);
    for (let i = 0; i < 5; i++) revealHint(s, 'ball_over_fence');
    expect(s.hintsSeen.ball_over_fence).toBe(4);
    expect(s.hintsSeen.kite_in_tree).toBeUndefined();
  });
});
