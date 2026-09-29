import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Paths are relative to the repo root, where the test runner starts.
const join = (...p: string[]) => p.filter(Boolean).join('/');
const read = (p: string) => readFileSync(p);
/** Width and height straight out of a PNG header. */
const pngSize = (p: string) => {
  const b = read(p);
  expect(b.subarray(1, 4).toString()).toBe('PNG');
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
};

describe('Home Screen / PWA', () => {
  const html = read('index.html').toString();
  const manifest = JSON.parse(read('public/manifest.webmanifest').toString());

  it('installs standalone with a real app icon at every size it asks for', () => {
    expect(manifest.display).toBe('standalone');
    expect(manifest.start_url).toBe('./');
    expect(manifest.short_name).toBe('Backyard Lab');
    for (const icon of manifest.icons) {
      const [w, h] = pngSize(join('public', icon.src));
      expect(`${w}x${h}`).toBe(icon.sizes);
    }
    expect(manifest.icons.some((i: { purpose: string }) => i.purpose === 'maskable')).toBe(true);
  });

  it('has the iOS web-app tags and an apple-touch-icon', () => {
    expect(html).toMatch(/name="apple-mobile-web-app-capable" content="yes"/);
    expect(html).toMatch(/name="apple-mobile-web-app-title" content="Backyard Lab"/);
    expect(html).toMatch(/viewport-fit=cover/);
    const touch = [...html.matchAll(/rel="apple-touch-icon"[^>]*href="\.\/([^"]+)"/g)].map((m) => m[1]);
    expect(touch.length).toBeGreaterThan(0);
    for (const t of touch) {
      expect(existsSync(join('public', t)), t).toBe(true);
      expect(pngSize(join('public', t))).toEqual([180, 180]);
    }
  });

  it('the service worker precaches only files that exist', () => {
    const sw = read('public/sw.js').toString();
    const list = [...sw.matchAll(/'\.\/([^']+)'/g)].map((m) => m[1]).filter((f) => f && f !== 'index.html');
    for (const f of list) expect(existsSync(join('public', f)), f).toBe(true);
  });
});
