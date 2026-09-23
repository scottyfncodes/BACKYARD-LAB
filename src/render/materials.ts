import * as THREE from 'three';

/** Procedural textures + shared materials. Everything is generated; no image assets. */

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

let seed = 1337;
export function rand(): number {
  seed = (seed * 16807) % 2147483647;
  return (seed - 1) / 2147483646;
}

function tex(c: HTMLCanvasElement, repeat = 1): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 4;
  return t;
}

export function woodTexture(base = '#c89a62', dark = '#8a6238', w = 256, h = 64): THREE.CanvasTexture {
  const [c, g] = canvas(w, h);
  g.fillStyle = base;
  g.fillRect(0, 0, w, h);
  for (let i = 0; i < 40; i++) {
    g.strokeStyle = dark;
    g.globalAlpha = 0.08 + rand() * 0.18;
    g.lineWidth = 0.5 + rand() * 1.5;
    g.beginPath();
    const y = rand() * h;
    g.moveTo(0, y);
    for (let x = 0; x <= w; x += 16) g.lineTo(x, y + Math.sin(x * 0.05 + i) * 2 + (rand() - 0.5) * 2);
    g.stroke();
  }
  for (let i = 0; i < 3; i++) {
    g.globalAlpha = 0.35;
    g.fillStyle = dark;
    g.beginPath();
    g.ellipse(rand() * w, rand() * h, 4 + rand() * 4, 2 + rand() * 2, 0, 0, Math.PI * 2);
    g.fill();
  }
  g.globalAlpha = 1;
  return tex(c);
}

export function grassTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(512, 512);
  g.fillStyle = '#5f8f3a';
  g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 9000; i++) {
    const x = rand() * 512;
    const y = rand() * 512;
    const l = 40 + rand() * 30;
    g.fillStyle = `hsl(${85 + rand() * 25}, ${35 + rand() * 25}%, ${l * 0.8}%)`;
    g.globalAlpha = 0.35;
    g.fillRect(x, y, 1.5, 3 + rand() * 4);
  }
  for (let i = 0; i < 60; i++) {
    g.globalAlpha = 0.08;
    g.fillStyle = rand() > 0.5 ? '#3f6a22' : '#8fb050';
    g.beginPath();
    g.arc(rand() * 512, rand() * 512, 20 + rand() * 50, 0, Math.PI * 2);
    g.fill();
  }
  g.globalAlpha = 1;
  return tex(c, 18);
}

export function noiseTexture(base: string, spots: string[], repeat = 1, size = 128, n = 1200): THREE.CanvasTexture {
  const [c, g] = canvas(size, size);
  g.fillStyle = base;
  g.fillRect(0, 0, size, size);
  for (let i = 0; i < n; i++) {
    g.fillStyle = spots[Math.floor(rand() * spots.length)];
    g.globalAlpha = 0.25 + rand() * 0.3;
    g.fillRect(rand() * size, rand() * size, 1 + rand() * 2, 1 + rand() * 2);
  }
  g.globalAlpha = 1;
  return tex(c, repeat);
}

export function brickTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(256, 256);
  g.fillStyle = '#c9b8a0';
  g.fillRect(0, 0, 256, 256);
  const bh = 16;
  for (let row = 0; row < 256 / bh; row++) {
    const off = row % 2 ? 16 : 0;
    for (let x = -32; x < 256; x += 32) {
      g.fillStyle = `hsl(${10 + rand() * 12}, ${40 + rand() * 20}%, ${36 + rand() * 12}%)`;
      g.fillRect(x + off + 1, row * bh + 1, 30, bh - 2);
    }
  }
  return tex(c);
}

export function sidingTexture(color = '#e8e0cf'): THREE.CanvasTexture {
  const [c, g] = canvas(128, 128);
  g.fillStyle = color;
  g.fillRect(0, 0, 128, 128);
  for (let y = 0; y < 128; y += 16) {
    g.fillStyle = 'rgba(0,0,0,0.12)';
    g.fillRect(0, y + 13, 128, 3);
    g.fillStyle = 'rgba(255,255,255,0.18)';
    g.fillRect(0, y, 128, 2);
  }
  return tex(c);
}

export function stripeBallTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(256, 128);
  g.fillStyle = '#e8352b';
  g.fillRect(0, 0, 256, 128);
  g.fillStyle = '#fff4dd';
  g.fillRect(0, 52, 256, 24);
  g.fillStyle = '#1f5fbf';
  g.fillRect(0, 0, 256, 10);
  g.fillRect(0, 118, 256, 10);
  return tex(c);
}

export function tennisTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(128, 64);
  g.fillStyle = '#d6ea3a';
  g.fillRect(0, 0, 128, 64);
  g.strokeStyle = '#ffffff';
  g.lineWidth = 3;
  g.beginPath();
  for (let x = 0; x <= 128; x += 2) g.lineTo(x, 32 + Math.sin((x / 128) * Math.PI * 4) * 16);
  g.stroke();
  return tex(c);
}

export function matTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(256, 180);
  g.fillStyle = '#7a4f2a';
  g.fillRect(0, 0, 256, 180);
  for (let i = 0; i < 3000; i++) {
    g.fillStyle = rand() > 0.5 ? '#8f6236' : '#5e3b1d';
    g.fillRect(rand() * 256, rand() * 180, 2, 2);
  }
  g.fillStyle = '#f2d9a0';
  g.font = 'bold 44px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('WELCOME', 128, 90);
  const t = tex(c);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

export function labelTexture(text: string, bg: string, fg: string, w = 256, h = 128): THREE.CanvasTexture {
  const [c, g] = canvas(w, h);
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  g.fillStyle = fg;
  g.font = `bold ${Math.floor(h * 0.32)}px system-ui, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, w / 2, h / 2);
  const t = tex(c);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

const cache = new Map<string, THREE.Material>();

export function mat(key: string, make: () => THREE.Material): THREE.Material {
  let m = cache.get(key);
  if (!m) {
    m = make();
    cache.set(key, m);
  }
  return m;
}

export const M = {
  wood: () => mat('wood', () => new THREE.MeshStandardMaterial({ map: woodTexture(), roughness: 0.85 })),
  woodDark: () => mat('woodDark', () => new THREE.MeshStandardMaterial({ map: woodTexture('#8d6139', '#5b3b1f'), roughness: 0.9 })),
  woodGrey: () => mat('woodGrey', () => new THREE.MeshStandardMaterial({ map: woodTexture('#b9ab95', '#7d705f'), roughness: 0.95 })),
  metal: () => mat('metal', () => new THREE.MeshStandardMaterial({ color: 0xb8bcc2, metalness: 0.7, roughness: 0.35 })),
  darkMetal: () => mat('darkMetal', () => new THREE.MeshStandardMaterial({ color: 0x4a4d52, metalness: 0.6, roughness: 0.45 })),
  rubber: () => mat('rubber', () => new THREE.MeshStandardMaterial({ color: 0x1f1f22, roughness: 0.95 })),
  plastic: (color: number) => mat(`plastic${color}`, () => new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.02 })),
  matte: (color: number) => mat(`matte${color}`, () => new THREE.MeshStandardMaterial({ color, roughness: 0.9 })),
  emissive: (color: number) => mat(`emi${color}`, () => new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.5 })),
  basic: (color: number, opacity = 1) =>
    mat(`basic${color}_${opacity}`, () => new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity, depthWrite: opacity >= 1 })),
};
