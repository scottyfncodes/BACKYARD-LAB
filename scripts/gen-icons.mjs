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

// Scene in unit coordinates (0..1, y down): a homemade machine in the backyard
// reaching its arm over the fence, with the runaway ball in its bucket.
const segDist = (px, py, ax, ay, bx, by) => {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
};
const INK = [47, 36, 24];
function shade(x, y) {
  // sky: blue to a warm afternoon horizon
  let c = mix([88, 152, 222], [255, 212, 158], Math.min(1, Math.max(0, (y - 0.05) / 0.7)));
  // sun
  const sd = Math.hypot(x - 0.2, y - 0.2);
  if (sd < 0.085) c = [255, 238, 176];
  else if (sd < 0.12) c = mix(c, [255, 238, 176], 0.35);
  // fence: pointed pickets on the right, with a rail
  const fx = (x - 0.5) * 8;
  const inPicket = x > 0.5 && fx % 1 < 0.8;
  const top = 0.5 + Math.abs((fx % 1) - 0.4) * 0.14;
  if (inPicket && y > top && y < 0.84) c = [236, 219, 186];
  if (x > 0.5 && y > 0.6 && y < 0.64) c = [150, 108, 66];
  // grass
  if (y > 0.8) c = mix([112, 170, 72], [72, 124, 46], (y - 0.8) / 0.2);
  // the machine: a crate on wheels with a hinged arm reaching over the fence
  const pivot = [0.3, 0.52];
  const tip = [0.7, 0.3];
  if (x > 0.13 && x < 0.45 && y > 0.6 && y < 0.8) {
    c = [214, 142, 62];
    if (Math.abs(y - 0.7) < 0.012 || Math.abs(x - 0.29) < 0.012) c = [168, 102, 40];
  }
  if (Math.abs(x - 0.3) < 0.025 && y > pivot[1] && y < 0.62) c = [168, 102, 40]; // post
  for (const wx of [0.2, 0.39]) {
    const wd = Math.hypot(x - wx, y - 0.82);
    if (wd < 0.075) c = wd < 0.03 ? [255, 196, 40] : [40, 34, 30];
  }
  const armD = segDist(x, y, pivot[0], pivot[1], tip[0], tip[1]);
  if (armD < 0.028) c = armD > 0.018 ? INK : [255, 176, 40];
  const hd = Math.hypot(x - pivot[0], y - pivot[1]);
  if (hd < 0.04) c = hd < 0.018 ? [255, 246, 227] : [90, 98, 110];
  // bucket hanging off the end of the arm, holding the ball
  const bx = 0.74, by = 0.34;
  const ballD = Math.hypot(x - bx, y - (by - 0.045));
  if (ballD < 0.085) {
    c = [226, 60, 44];
    if (Math.abs(y - (by - 0.045) + (x - bx) * 0.5) < 0.022) c = [255, 244, 221];
    if (Math.hypot(x - bx + 0.03, y - by + 0.085) < 0.022) c = mix(c, [255, 255, 255], 0.6);
    if (ballD > 0.073) c = INK;
  }
  const inBucket = y > by - 0.02 && y < by + 0.09 && Math.abs(x - bx) < 0.1 - (y - by) * 0.3;
  if (inBucket) {
    const edge = y > by + 0.075 || Math.abs(x - bx) > 0.085 - (y - by) * 0.3 || y < by - 0.005;
    c = edge ? INK : [52, 132, 214];
  }
  // motion ticks: it's working
  for (const [ax, ay, bx2, by2] of [[0.83, 0.2, 0.9, 0.15], [0.86, 0.3, 0.94, 0.29]]) if (segDist(x, y, ax, ay, bx2, by2) < 0.01) c = [255, 255, 255];
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
          // Shrink the scene into the central safe zone; the sky and grass carry on to the edges.
          x = -0.125 + x * 1.25;
          y = -0.125 + y * 1.25;
        }
        const c = shade(x, y);
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
writeFileSync('public/apple-touch-icon.png', render(180));
console.log('icons written');
