import { describe, expect, it } from 'vitest';

// Read the stylesheet as text (vitest processes CSS imports, so go via the file system;
// the computed specifier keeps the project free of Node type declarations).
const fs = (await import('node:' + 'fs')) as { readFileSync: (p: URL, enc: string) => string };
const css = fs.readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

/**
 * The HUD is plain DOM + CSS, so the regression guard reads the stylesheet: the
 * thought bubble's anchoring transform and its pop animation must live on
 * different elements, or the keyframes' `transform` clobbers the anchor and the
 * bubble pops in off-centre.
 */

function rule(selector: string): string {
  const re = new RegExp(`(^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`);
  const m = css.match(re);
  if (!m) throw new Error(`no rule for ${selector}`);
  return m[2];
}

describe('thought bubble CSS', () => {
  it('anchors on the outer element and animates the inner one', () => {
    const outer = rule('.thought');
    const inner = rule('.thought-inner');
    expect(outer).toMatch(/transform:\s*translateX\(-50%\)/);
    expect(outer).not.toMatch(/animation/);
    expect(inner).toMatch(/animation:\s*pop/);
    expect(inner).not.toMatch(/transform:/);
  });

  it('the pop keyframes only ever touch transform and opacity (nothing positional)', () => {
    const m = css.match(/@keyframes pop\s*\{([^\n]*)\}/);
    expect(m).toBeTruthy();
    expect(m![1]).not.toMatch(/left|top|bottom|right|margin/);
    expect(m![1]).toMatch(/transform/);
  });
});
