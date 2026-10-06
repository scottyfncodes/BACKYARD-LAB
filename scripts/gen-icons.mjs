// Renders scripts/icon.svg to the PNG icons the PWA and iOS need, using the
// pre-installed Chromium. Run: npm i --no-save playwright-core && npm run icons
import { chromium } from 'playwright-core';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const svg = readFileSync('scripts/icon.svg', 'utf8');
const executablePath = process.env.PW_CHROMIUM_PATH || '/opt/pw-browsers/chromium';

// [file, size, pad, rounded]. Pad shrinks the art into the maskable safe zone
// over the icon's background colour; rounded clips the corners (favicons only).
const OUT = [
  ['public/icons/icon-512.png', 512, 0, false],
  ['public/icons/icon-192.png', 192, 0, false],
  ['public/icons/maskable-512.png', 512, 0, false],
  ['public/icons/apple-touch-icon.png', 180, 0, false],
  ['public/icons/favicon-32.png', 32, 0, true],
  ['public/apple-touch-icon.png', 180, 0, false],
];

mkdirSync('public/icons', { recursive: true });
const browser = await chromium.launch({ executablePath });
const page = await browser.newPage();
for (const [name, size, pad, rounded] of OUT) {
  const art = Math.round(size * (1 - pad * 2));
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<html><body style="margin:0;background:${rounded ? 'transparent' : '#f58a24'};display:grid;place-items:center;width:${size}px;height:${size}px;` +
      `${rounded ? `border-radius:${size * 0.22}px;overflow:hidden` : ''}">` +
      svg.replace(/width="512" height="512"/, `width="${art}" height="${art}"`) +
      '</body></html>',
  );
  writeFileSync(name, await page.screenshot({ type: 'png', omitBackground: true }));
}
await browser.close();
console.log('icons written:', OUT.map((o) => o[0]).join(', '));
