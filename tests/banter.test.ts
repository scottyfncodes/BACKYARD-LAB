import { describe, expect, it } from 'vitest';
import { KID_LINES, LinePicker, MOM_LINES } from '../src/data/banter';
import { highlightSpeed } from '../src/game/replay';

describe('the kid and Mom talking', () => {
  it('never call a test a failure, and never hand out answers', () => {
    const all = [...Object.values(KID_LINES), ...Object.values(MOM_LINES)].flat();
    expect(all.length).toBeGreaterThan(30);
    for (const line of all) {
      expect(line).not.toMatch(/\b(fail|failed|failure|wrong|bad|stupid|dumb|lose|lost the)\b/i);
      expect(line.length).toBeLessThan(70);
    }
  });

  it('never says the same thing twice in a row', () => {
    const p = new LinePicker(KID_LINES);
    let last = '';
    for (let i = 0; i < 50; i++) {
      const l = p.pick('go');
      expect(l).not.toBe(last);
      last = l;
    }
  });
});

describe('highlight replays', () => {
  it('play at full speed, easing into slow motion at the big moment', () => {
    expect(highlightSpeed(5, 5)).toBeCloseTo(0.3);
    expect(highlightSpeed(2, 5)).toBe(1);
    const mid = highlightSpeed(5.4, 5);
    expect(mid).toBeGreaterThan(0.3);
    expect(mid).toBeLessThan(1);
  });
});
