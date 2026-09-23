// Generates the app icons as PNGs with no dependencies (pure pixel math + zlib).
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4);
  c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
}
function png(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
const mix = (a, b, t) => a.map((x, i) => x + (b[i] - x) * t);

// Scene in unit coordinates (0..1, y down).
function shade(x, y, maskable) {
  const inset = maskable ? 0.1 : 0;
  // background: sky gradient to warm horizon
  let c = mix([95, 159, 224], [255, 214, 160], Math.min(1, Math.max(0, (y - 0.1) / 0.6)));
  // sun
  const sd = Math.hypot(x - 0.78, y - 0.22);
  if (sd < 0.09) c = [255, 236, 170];
  // grass
  if (y > 0.74) c = mix([106, 163, 69], [70, 120, 45], (y - 0.74) / 0.26);
  // fence pickets
  const fx = x * 7;
  const inPicket = fx % 1 < 0.78;
  const top = 0.44 + Math.abs((fx % 1) - 0.39) * 0.18;
  if (x > 0.46 && inPicket && y > top && y < 0.8) c = [232, 214, 180];
  if (x > 0.46 && y > 0.54 && y < 0.58) c = [150, 110, 70];
  // dotted arc
  const t = (x - 0.12) / 0.62;
  if (t > 0 && t < 1) {
    const ay = 0.62 - Math.sin(t * Math.PI) * 0.42;
    if (Math.abs(y - ay) < 0.012 && Math.floor(t * 18) % 2 === 0) c = [255, 255, 255];
  }
  // ball
  const bx = 0.66, by = 0.24, br = 0.13;
  const bd = Math.hypot(x - bx, y - by);
  if (bd < br) {
    c = [228, 58, 43];
    const stripe = Math.abs(y - by + (x - bx) * 0.4) < 0.03;
    if (stripe) c = [255, 244, 221];
    const hl = Math.hypot(x - bx + 0.05, y - by + 0.05);
    if (hl < 0.035) c = mix(c, [255, 255, 255], 0.6);
    if (bd > br - 0.012) c = [47, 36, 24];
  }
  // wrench-ish badge
  const wx = 0.2, wy = 0.82;
  if (Math.hypot(x - wx, y - wy) < 0.1) c = [255, 138, 26];
  if (Math.hypot(x - wx, y - wy) < 0.1 && Math.hypot(x - wx, y - wy) > 0.085) c = [47, 36, 24];
  if (Math.abs(x - wx) < 0.018 && Math.abs(y - wy) < 0.06) c = [255, 246, 227];
  if (Math.abs(y - wy + 0.05) < 0.02 && Math.abs(x - wx) < 0.045) c = [255, 246, 227];
  void inset;
  return c;
}

function render(size, { rounded = false, maskable = false } = {}) {
  const buf = Buffer.alloc(size * size * 4);
  const ss = 3;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < ss; sy++) for (let sx = 0; sx < ss; sx++) {
        let x = (px + (sx + 0.5) / ss) / size;
        let y = (py + (sy + 0.5) / ss) / size;
        let alpha = 1;
        if (rounded) {
          const rr = 0.2;
          const dx = Math.max(rr - x, x - (1 - rr), 0);
          const dy = Math.max(rr - y, y - (1 - rr), 0);
          if (Math.hypot(dx, dy) > rr) alpha = 0;
        }
        if (maskable) {
          x = 0.1 + x * 0.8;
          y = 0.1 + y * 0.8;
        }
        const c = shade(x, y, maskable);
        r += c[0] * alpha; g += c[1] * alpha; b += c[2] * alpha; a += 255 * alpha;
      }
      const n = ss * ss;
      const i = (py * size + px) * 4;
      const aa = a / n;
      buf[i] = aa ? r / (a / 255) : 0;
      buf[i + 1] = aa ? g / (a / 255) : 0;
      buf[i + 2] = aa ? b / (a / 255) : 0;
      buf[i + 3] = aa;
    }
  }
  return png(size, size, buf);
}

mkdirSync('public/icons', { recursive: true });
writeFileSync('public/icons/icon-512.png', render(512, { rounded: false }));
writeFileSync('public/icons/icon-192.png', render(192, { rounded: false }));
writeFileSync('public/icons/maskable-512.png', render(512, { maskable: true }));
writeFileSync('public/icons/apple-touch-icon.png', render(180));
writeFileSync('public/icons/favicon-32.png', render(32, { rounded: true }));
console.log('icons written');
