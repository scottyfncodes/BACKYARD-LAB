import { describe, expect, it } from 'vitest';
import { completeProject, defaultSave } from '../src/game/save';
import { sandboxLock, titleAction, titleContraption } from '../src/game/title';
import { findPart } from '../src/sim/blueprint';
import { wagonCheck } from '../src/sim/wagonbuild';

describe('title screen', () => {
  it('first run: one button, named for the first thing to build', () => {
    const a = titleAction(defaultSave());
    expect(a).toMatchObject({ verb: 'Build the wagon', resume: false, project: 'build_wagon' });
    expect(a.sub).toContain('THE WAGON');
  });

  it('returning: the same button keeps building the saved session', () => {
    const s = defaultSave();
    s.session = { mode: 'project', project: 'build_wagon', bench: null, machines: [], stash: {} };
    expect(titleAction(s)).toMatchObject({ verb: 'Keep building', sub: 'THE WAGON', resume: true });
    s.session = { mode: 'sandbox', project: null, bench: null, machines: [], stash: {} };
    expect(titleAction(s)).toMatchObject({ verb: 'Keep building', resume: true });
    expect(titleAction(s).sub).toContain('Sandbox');
  });

  it('after the wagon, it points at the next unsolved project', () => {
    const s = defaultSave();
    completeProject(s, 'build_wagon', 100, []);
    expect(titleAction(s)).toMatchObject({ verb: 'Start building', resume: false, project: 'ball_over_fence' });
  });

  it('teases the locked sandbox until the project that opens it is solved', () => {
    const s = defaultSave();
    expect(sandboxLock(s)).toBe('THE BALL');
    completeProject(s, 'build_wagon', 100, []);
    expect(sandboxLock(s)).toBe('THE BALL');
    completeProject(s, 'ball_over_fence', 100, []);
    expect(sandboxLock(s)).toBeNull();
  });

  it('the hero is a real, half-built wagon: it rolls on four wheels but has no handle yet', () => {
    const { bp, spinner } = titleContraption();
    const w = wagonCheck(bp);
    expect(w.wheels).toBe(4);
    expect(w.rolls).toBe(true);
    expect(w.handle).toBeNull();
    expect(w.ok).toBe(false);
    expect(findPart(bp, spinner)?.def).toBe('lawn_wheel');
  });
});
