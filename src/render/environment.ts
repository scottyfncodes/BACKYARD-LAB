import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { EAST_FENCE_X, FENCE_H, GAP, WORLD, type SolidDef } from '../data/world';
import { labelTexture, M, mat, noiseTexture, rand, sidingTexture, woodTexture, grassTexture } from './materials';

/**
 * Dresses the physical backyard (data/world.ts) with visuals. Static geometry
 * is merged per material to keep draw calls low on phones.
 */
export interface Environment {
  root: THREE.Group;
  gate: THREE.Object3D;
  grass: THREE.InstancedMesh | null;
  clouds: THREE.Group;
  update(t: number, dt: number): void;
}

class Batcher {
  private buckets = new Map<THREE.Material, THREE.BufferGeometry[]>();
  add(geo: THREE.BufferGeometry, m: THREE.Material, pos?: THREE.Vector3, rot?: THREE.Euler, scale?: THREE.Vector3) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    const mtx = new THREE.Matrix4().compose(pos ?? new THREE.Vector3(), new THREE.Quaternion().setFromEuler(rot ?? new THREE.Euler()), scale ?? new THREE.Vector3(1, 1, 1));
    g.applyMatrix4(mtx);
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    if (!this.buckets.has(m)) this.buckets.set(m, []);
    this.buckets.get(m)!.push(g);
  }
  box(w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number, ry = 0) {
    this.add(new THREE.BoxGeometry(w, h, d), m, new THREE.Vector3(x, y, z), new THREE.Euler(0, ry, 0));
  }
  flush(parent: THREE.Object3D, shadows = true) {
    for (const [m, geos] of this.buckets) {
      const merged = mergeGeometries(geos, false);
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, m);
      mesh.castShadow = shadows;
      mesh.receiveShadow = true;
      parent.add(mesh);
    }
    this.buckets.clear();
  }
}

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

export function buildEnvironment(opts: { grassBlades: number }): Environment {
  const root = new THREE.Group();
  const B = new Batcher();
  const woodM = M.wood();
  const fenceM = mat('fence', () => new THREE.MeshStandardMaterial({ map: woodTexture('#d9c3a0', '#a58a63', 128, 64), roughness: 0.95 }));
  const fenceFarM = mat('fenceFar', () => new THREE.MeshStandardMaterial({ map: woodTexture('#b39a78', '#7d6a50', 128, 64), roughness: 0.95 }));

  // Ground
  const grassT = grassTexture();
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), new THREE.MeshStandardMaterial({ map: grassT, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(7, 0, 1);
  ground.receiveShadow = true;
  root.add(ground);
  // Mowing stripes next door, dirt under the fence gap, a worn path.
  const stripeM = M.basic(0x9fd06a, 0.12);
  for (let i = 0; i < 6; i++) {
    const s = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 23.8), stripeM);
    s.rotation.x = -Math.PI / 2;
    s.position.set(16 + i * 2.2, 0.004, 2);
    root.add(s);
  }
  const dirtM = mat('dirt', () => new THREE.MeshStandardMaterial({ map: noiseTexture('#6b4a2b', ['#4f341c', '#8a6a44'], 2), roughness: 1 }));
  const hole = new THREE.Mesh(new THREE.CircleGeometry(0.75, 20), dirtM);
  hole.rotation.x = -Math.PI / 2;
  hole.scale.set(1.3, 0.8, 1);
  hole.position.set(EAST_FENCE_X, 0.006, (GAP.z0 + GAP.z1) / 2);
  root.add(hole);
  const pathM = M.basic(0xb9a47a, 0.35);
  for (let i = 0; i < 14; i++) {
    const stone = new THREE.Mesh(new THREE.CircleGeometry(0.26 + rand() * 0.08, 10), mat('stone', () => new THREE.MeshStandardMaterial({ color: 0xbdb3a2, roughness: 1 })));
    stone.rotation.x = -Math.PI / 2;
    stone.position.set(-2 - i * 0.55 + rand() * 0.15, 0.007, -6 + i * 0.3 + rand() * 0.2);
    stone.receiveShadow = true;
    root.add(stone);
  }
  void pathM;

  let gate: THREE.Object3D = new THREE.Group();

  for (const s of WORLD.solids) dress(s);

  function pickets(x: number, z0: number, z1: number, y0: number, m: THREE.Material, alongX = false, fixed = 0) {
    const n = Math.floor((z1 - z0) / 0.15);
    for (let i = 0; i < n; i++) {
      const c = z0 + 0.075 + i * ((z1 - z0) / n);
      const h = FENCE_H - y0 + (i % 2) * 0.03;
      if (alongX) B.box(0.14, h, 0.03, m, c, y0 + h / 2, fixed);
      else B.box(0.03, h, 0.14, m, x, y0 + h / 2, c);
    }
  }

  function dress(s: SolidDef) {
    const [x, y, z] = s.pos;
    const h = s.half ?? [0, 0, 0];
    switch (s.vis) {
      case 'fence':
      case 'fence_far': {
        const m = s.vis === 'fence' ? fenceM : fenceFarM;
        if (h[0] < h[2]) {
          pickets(x, z - h[2], z + h[2], 0, m);
          const side = x > 0 && x < 20 ? -1 : 1;
          for (const ry of [0.4, 1.6]) B.box(0.05, 0.09, h[2] * 2, M.woodDark(), x + side * 0.04, ry, z);
          for (let pz = z - h[2]; pz <= z + h[2] + 0.01; pz += 2.4) B.box(0.1, FENCE_H + 0.1, 0.1, M.woodDark(), x + side * 0.05, (FENCE_H + 0.1) / 2, pz);
        } else {
          pickets(0, x - h[0], x + h[0], 0, m, true, z);
          for (const ry of [0.4, 1.6]) B.box(h[0] * 2, 0.09, 0.05, M.woodDark(), x, ry, z - 0.04);
        }
        break;
      }
      case 'fence_gap': {
        pickets(x, z - h[2], z + h[2], GAP.height, fenceM);
        for (const ry of [0.4, 1.6]) B.box(0.05, 0.09, h[2] * 2, M.woodDark(), x - 0.04, ry, z);
        // A broken picket lying in the grass tells the story.
        B.add(new THREE.BoxGeometry(0.03, 0.3, 0.14), fenceM, V(x - 0.5, 0.02, z + 0.1), new THREE.Euler(Math.PI / 2, 0.4, 0));
        break;
      }
      case 'gate': {
        const g = new THREE.Group();
        const hinge = new THREE.Group();
        hinge.position.set(x, 0, z - h[2]);
        const gb = new Batcher();
        const w = h[2] * 2;
        const n = 8;
        for (let i = 0; i < n; i++) gb.box(0.03, FENCE_H - 0.05, w / n - 0.01, fenceM, 0, FENCE_H / 2, (i + 0.5) * (w / n));
        gb.box(0.05, 0.1, w, M.woodDark(), -0.04, 0.4, w / 2);
        gb.box(0.05, 0.1, w, M.woodDark(), -0.04, 1.6, w / 2);
        const brace = new THREE.BoxGeometry(0.05, 0.08, Math.hypot(w, 1.2));
        gb.add(brace, M.woodDark(), V(-0.04, 1.0, w / 2), new THREE.Euler(Math.atan2(1.2, w), 0, 0));
        gb.flush(hinge);
        const lock = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, 0.04), M.plastic(0xd4a017));
        lock.position.set(0.06, 1.0, w - 0.08);
        const shackle = new THREE.Mesh(new THREE.TorusGeometry(0.022, 0.006, 6, 12, Math.PI), M.metal());
        shackle.position.set(0.06, 1.04, w - 0.08);
        shackle.rotation.y = Math.PI / 2;
        hinge.add(lock, shackle);
        g.add(hinge);
        root.add(g);
        gate = hinge;
        break;
      }
      case 'house':
      case 'house2': {
        const col = s.vis === 'house' ? '#efe4cf' : '#b9d0e0';
        const wallM = mat(`siding${s.vis}`, () => new THREE.MeshStandardMaterial({ map: sidingTexture(col), roughness: 0.9 }));
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(h[0] * 2, h[1] * 2, h[2] * 2), wallM);
        mesh.position.set(x, y, z);
        mesh.castShadow = mesh.receiveShadow = true;
        (mesh.material as THREE.MeshStandardMaterial).map!.repeat.set(h[0] / 2, h[1] / 2);
        root.add(mesh);
        // Gable roof
        const roofM = M.matte(s.vis === 'house' ? 0x7a3b2e : 0x4a4f5a);
        const rh = 2.2;
        const shape = new THREE.Shape([new THREE.Vector2(-h[2] - 0.5, 0), new THREE.Vector2(h[2] + 0.5, 0), new THREE.Vector2(0, rh)]);
        const roof = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: h[0] * 2 + 0.6, bevelEnabled: false }), roofM);
        roof.rotation.y = Math.PI / 2;
        roof.position.set(x - h[0] - 0.3, y + h[1], z);
        roof.castShadow = true;
        root.add(roof);
        const face = z + h[2] + 0.01;
        const winM = mat('window', () => new THREE.MeshStandardMaterial({ color: 0x9cc7e6, roughness: 0.1, metalness: 0.3, emissive: 0x223344, emissiveIntensity: 0.3 }));
        const frameM = M.plastic(0xffffff);
        const wins = s.vis === 'house' ? [-6, -3.5, 3, 5.8] : [-3, 2];
        for (const wx of wins) {
          for (const wy of [1.6, 4.0]) {
            B.box(1.3, 1.1, 0.06, frameM, x + wx, wy, face);
            B.box(1.1, 0.9, 0.08, winM, x + wx, wy, face);
            B.box(0.05, 0.9, 0.1, frameM, x + wx, wy, face);
          }
        }
        if (s.vis === 'house') {
          B.box(1.0, 2.1, 0.08, M.plastic(0x5a3a22), x, 1.05 + 0.18, face);
          B.box(0.08, 0.08, 0.1, M.metal(), x + 0.35, 1.2, face + 0.05);
          B.box(h[0] * 2, 0.12, 0.15, M.plastic(0xffffff), x, h[1] * 2 - 0.05, face + 0.05);
        }
        break;
      }
      case 'deck': {
        const deckM = mat('deckwood', () => new THREE.MeshStandardMaterial({ map: woodTexture('#a8744a', '#6e4a2c', 256, 32), roughness: 0.85 }));
        for (let i = 0; i < Math.floor((h[2] * 2) / 0.16); i++) B.box(h[0] * 2, h[1] * 2, 0.15, deckM, x, y, z - h[2] + 0.08 + i * 0.16);
        B.box(1.6, 0.09, 0.4, deckM, x, 0.045, z + h[2] + 0.2);
        break;
      }
      case 'garage_wall':
        B.box(h[0] * 2, h[1] * 2, h[2] * 2, M.woodGrey(), x, y, z);
        break;
      case 'garage_roof':
        B.box(h[0] * 2, h[1] * 2, h[2] * 2, M.matte(0x5b5f66), x, y, z);
        break;
      case 'garage_floor':
        B.box(h[0] * 2, h[1] * 2, h[2] * 2, mat('concrete', () => new THREE.MeshStandardMaterial({ map: noiseTexture('#a9a59c', ['#8f8b82', '#bdb9af'], 3), roughness: 1 })), x, y, z);
        break;
      case 'workbench': {
        const top = y + h[1];
        B.box(h[0] * 2 + 0.1, 0.06, h[2] * 2 + 0.1, M.woodDark(), x, top - 0.03, z);
        for (const dx of [-1, 1]) for (const dz of [-1, 1]) B.box(0.08, top - 0.06, 0.08, M.woodDark(), x + dx * (h[0] - 0.05), (top - 0.06) / 2, z + dz * (h[2] - 0.05));
        B.box(h[0] * 2 - 0.1, 0.03, h[2] * 2 - 0.1, woodM, x, 0.2, z);
        B.box(0.12, 0.1, 0.1, M.plastic(0x1f4fb0), x - h[0] + 0.1, top + 0.05, z + h[2] - 0.05);
        break;
      }
      case 'shelf':
        B.box(h[0] * 2, h[1] * 2, h[2] * 2, woodM, x, y, z);
        B.box(h[0] * 2, 0.04, h[2] * 2, woodM, x, 1.6, z);
        B.box(0.03, 1.7, 0.03, M.darkMetal(), x + h[0] - 0.02, 0.85, z - h[2] + 0.02);
        B.box(0.03, 1.7, 0.03, M.darkMetal(), x + h[0] - 0.02, 0.85, z + h[2] - 0.02);
        break;
      case 'doghouse': {
        B.box(h[0] * 2, h[1] * 2, h[2] * 2, M.plastic(0xb03a2e), x, y, z);
        const shape = new THREE.Shape([new THREE.Vector2(-h[2] - 0.1, 0), new THREE.Vector2(h[2] + 0.1, 0), new THREE.Vector2(0, 0.45)]);
        B.add(new THREE.ExtrudeGeometry(shape, { depth: h[0] * 2 + 0.2, bevelEnabled: false }), M.matte(0x3d3d3d), V(x - h[0] - 0.1, y + h[1], z), new THREE.Euler(0, Math.PI / 2, 0));
        B.box(0.02, 0.45, 0.4, M.matte(0x1a1010), x - h[0] - 0.005, 0.25, z);
        break;
      }
      case 'trunk': {
        const barkM = mat('bark', () => new THREE.MeshStandardMaterial({ map: noiseTexture('#6b4b33', ['#4a3322', '#7f5d42', '#3b281a'], 1, 128, 3000), roughness: 1 }));
        const t = new THREE.Mesh(new THREE.CylinderGeometry(s.r! * 0.8, s.r! * 1.15, s.h!, 14), barkM);
        t.position.set(x, s.h! / 2, z);
        t.castShadow = t.receiveShadow = true;
        root.add(t);
        const leafM = mat('leaves', () => new THREE.MeshStandardMaterial({ color: 0x4f8a36, roughness: 0.9, flatShading: true }));
        const leafM2 = mat('leaves2', () => new THREE.MeshStandardMaterial({ color: 0x6aa345, roughness: 0.9, flatShading: true }));
        const blobs: [number, number, number, number][] = [
          [0, 5.6, 0, 2.2], [1.6, 5.0, 1.0, 1.6], [-1.6, 5.1, 0.6, 1.5], [0.6, 5.2, -1.6, 1.6], [-0.8, 6.4, -0.6, 1.4], [1.4, 4.4, 1.9, 1.1], [-1.9, 4.6, -1.2, 1.1], [2.1, 4.9, -0.5, 1.2],
        ];
        blobs.forEach(([bx, by, bz, r], i) => {
          const geo = new THREE.IcosahedronGeometry(r, 1);
          const p = geo.attributes.position;
          for (let k = 0; k < p.count; k++) p.setXYZ(k, p.getX(k) * (0.85 + rand() * 0.3), p.getY(k) * (0.75 + rand() * 0.25), p.getZ(k) * (0.85 + rand() * 0.3));
          geo.computeVertexNormals();
          const blob = new THREE.Mesh(geo, i % 2 ? leafM2 : leafM);
          blob.position.set(x + bx, by, z + bz);
          blob.castShadow = true;
          blob.receiveShadow = true;
          root.add(blob);
        });
        // Ladder up the trunk
        for (let i = 0; i < 9; i++) B.box(0.4, 0.04, 0.05, M.woodDark(), x - 0.2, 0.3 + i * 0.3, z - s.r! - 0.03);
        break;
      }
      case 'treehouse': {
        B.box(h[0] * 2, h[1] * 2, h[2] * 2, woodM, x, y, z);
        for (const [dx, dz, w, d] of [[0, -h[2], h[0] * 2, 0.05], [-h[0], 0, 0.05, h[2] * 2], [h[0], 0, 0.05, h[2] * 2]] as const) B.box(w, 0.9, d, M.woodGrey(), x + dx, y + 0.5, z + dz);
        for (const dx of [-h[0], h[0]]) for (const dz of [-h[2], h[2]]) B.box(0.08, 1.6, 0.08, M.woodDark(), x + dx, y + 0.8, z + dz);
        const shape = new THREE.Shape([new THREE.Vector2(-h[2] - 0.2, 0), new THREE.Vector2(h[2] + 0.2, 0), new THREE.Vector2(0, 0.8)]);
        B.add(new THREE.ExtrudeGeometry(shape, { depth: h[0] * 2 + 0.3, bevelEnabled: false }), M.matte(0x2e7a4a), V(x - h[0] - 0.15, y + 1.6, z), new THREE.Euler(0, Math.PI / 2, 0));
        const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.3), new THREE.MeshStandardMaterial({ map: labelTexture('NO GROWNUPS', '#f4e3b5', '#b03a2e', 256, 96) }));
        sign.position.set(x, y + 0.6, z + h[2] + 0.03);
        root.add(sign);
        break;
      }
      case 'branch': {
        const len = h[0] * 2;
        B.add(new THREE.CylinderGeometry(0.06, 0.09, len, 8), mat('bark', () => M.woodDark()), V(x, y, z), new THREE.Euler(0, ((s.rotY ?? 0) * Math.PI) / 180, Math.PI / 2, 'YXZ'));
        break;
      }
      case 'shed': {
        const shedM = mat('shed', () => new THREE.MeshStandardMaterial({ map: woodTexture('#b0463a', '#7a2a22', 128, 64), roughness: 0.9 }));
        B.box(h[0] * 2, h[1] * 2, h[2] * 2, shedM, x, y, z);
        const shape = new THREE.Shape([new THREE.Vector2(-h[2] - 0.25, 0), new THREE.Vector2(h[2] + 0.25, 0), new THREE.Vector2(0, 1.1)]);
        B.add(new THREE.ExtrudeGeometry(shape, { depth: h[0] * 2 + 0.3, bevelEnabled: false }), M.matte(0x3d3d3d), V(x - h[0] - 0.15, y + h[1], z), new THREE.Euler(0, Math.PI / 2, 0));
        B.box(0.05, 1.8, 1.4, M.plastic(0xf2efe6), x + h[0] + 0.02, 1.1, z);
        B.box(0.06, 0.1, 1.5, M.plastic(0xf2efe6), x + h[0] + 0.03, 1.1, z);
        // skirt shadow under the shed to sell the gap
        const dark = new THREE.Mesh(new THREE.PlaneGeometry(h[0] * 2, h[2] * 2), M.basic(0x1a130c, 0.55));
        dark.rotation.x = -Math.PI / 2;
        dark.position.set(x, 0.008, z);
        root.add(dark);
        for (const hx of [-0.6, 0.6]) B.box(0.3, 0.3, 0.01, M.woodDark(), x + hx, 1.2, z - h[2] - 0.01);
        B.box(0.4, 0.05, 0.02, M.metal(), x + 0.1, 0.55, z - h[2] - 0.02);
        break;
      }
      case 'block':
        B.box(h[0] * 2, h[1] * 2, h[2] * 2, M.matte(0x9a968c), x, y, z);
        break;
      case 'sandbox_edge':
        B.box(h[0] * 2, h[1] * 2, h[2] * 2, woodM, x, y, z);
        break;
      case 'sand':
        B.box(h[0] * 2, h[1] * 2, h[2] * 2, mat('sand', () => new THREE.MeshStandardMaterial({ map: noiseTexture('#e8d19a', ['#d4b979', '#f3e2b5'], 2), roughness: 1 })), x, y, z);
        B.add(new THREE.ConeGeometry(0.4, 0.25, 12), mat('sand', () => M.matte(0xe8d19a)), V(x + 0.4, 0.1, z - 0.3));
        B.box(0.05, 0.25, 0.05, M.plastic(0xe0332b), x - 0.5, 0.15, z + 0.4, 0.3);
        B.box(0.12, 0.02, 0.1, M.plastic(0xe0332b), x - 0.5, 0.03, z + 0.52);
        break;
      case 'garden': {
        B.box(h[0] * 2, h[1] * 2, h[2] * 2, dirtM, x, y, z);
        B.box(h[0] * 2 + 0.1, h[1] * 2 + 0.04, 0.06, woodM, x, y, z - h[2]);
        for (let i = 0; i < 26; i++) {
          const px = x - h[0] + 0.3 + (i / 26) * (h[0] * 2 - 0.6);
          const pz = z + (rand() - 0.5) * h[2];
          const hh = 0.3 + rand() * 0.4;
          B.add(new THREE.ConeGeometry(0.16 + rand() * 0.1, hh, 6), mat('plant', () => new THREE.MeshStandardMaterial({ color: 0x3f7f2e, flatShading: true })), V(px, y + h[1] + hh / 2, pz));
          if (i % 3 === 0) B.add(new THREE.SphereGeometry(0.04, 8, 6), M.plastic(i % 2 ? 0xe0332b : 0xf2c230), V(px + 0.08, y + h[1] + hh * 0.5, pz + 0.05));
        }
        break;
      }
      case 'patio_table': {
        B.box(1.2, 0.05, 1.2, M.plastic(0xf2efe6), x, y + h[1] - 0.02, z);
        B.box(0.08, h[1] * 2, 0.08, M.darkMetal(), x, y, z);
        B.add(new THREE.CylinderGeometry(0.02, 0.02, 1.6, 6), M.darkMetal(), V(x, y + h[1] + 0.8, z));
        B.add(new THREE.ConeGeometry(1.3, 0.5, 8), M.plastic(0x2a8fe0), V(x, y + h[1] + 1.55, z));
        break;
      }
      default:
        break;
    }
  }

  // Lab details: pegboard, sign, cardboard boxes, string lights.
  {
    const wb = WORLD.workbench.pos;
    const peg = mat('peg', () => new THREE.MeshStandardMaterial({ map: noiseTexture('#b8905c', ['#6d4f2c'], 4, 64, 200), roughness: 1 }));
    B.box(0.03, 1.2, 3.0, peg, -13.97, 1.6, -5);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 0.5), new THREE.MeshStandardMaterial({ map: labelTexture('★ BACKYARD LAB ★', '#f4e3b5', '#b03a2e', 512, 128) }));
    sign.position.set(-13.95, 2.5, -5);
    sign.rotation.y = Math.PI / 2;
    root.add(sign);
    const tools: [number, number, number, number][] = [[-5.8, 1.9, 0.5, 0.06], [-5.4, 1.7, 0.08, 0.35], [-4.6, 1.8, 0.3, 0.05], [-4.2, 1.5, 0.05, 0.4]];
    for (const [tz, ty, w, hh] of tools) B.box(0.03, hh, w, M.darkMetal(), -13.94, ty, tz);
    B.box(0.5, 0.35, 0.4, M.matte(0xb88a52), -13.5, 0.175, -7.9);
    B.box(0.4, 0.3, 0.35, M.matte(0xc29a62), -13.5, 0.5, -7.9);
    const bulbM = M.emissive(0xffd27a);
    for (let i = 0; i < 9; i++) {
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.03, 6, 5), bulbM);
      b.position.set(-8.1, 2.7 - Math.sin((i / 8) * Math.PI) * 0.25, -8.6 + i * 0.95);
      root.add(b);
    }
    void wb;
  }

  // Distant suburb: trees and roofs on the horizon.
  {
    const far = mat('farTree', () => new THREE.MeshStandardMaterial({ color: 0x5d8a4a, flatShading: true, roughness: 1 }));
    const farRoof = M.matte(0x6a5a55);
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2;
      const r = 38 + rand() * 8;
      const px = 7 + Math.cos(a) * r;
      const pz = 1 + Math.sin(a) * r;
      if (i % 3 === 0) {
        B.box(6, 4, 6, M.matte(0xd9cfbd), px, 2, pz, a);
        B.add(new THREE.ConeGeometry(4.6, 2.2, 4), farRoof, V(px, 5.1, pz), new THREE.Euler(0, a + Math.PI / 4, 0));
      } else {
        const hh = 5 + rand() * 5;
        B.add(new THREE.ConeGeometry(2 + rand(), hh, 7), far, V(px, hh / 2 + 1, pz));
        B.add(new THREE.CylinderGeometry(0.2, 0.3, 1.5, 6), M.woodDark(), V(px, 0.75, pz));
      }
    }
    // Street beyond the neighbour's yard
    const street = new THREE.Mesh(new THREE.PlaneGeometry(8, 80), M.matte(0x55585c));
    street.rotation.x = -Math.PI / 2;
    street.position.set(33, 0.01, 1);
    street.receiveShadow = true;
    root.add(street);
    B.box(0.3, 0.1, 80, M.matte(0xb5b2aa), 29, 0.05, 1);
  }

  // A garden gnome next door, obviously judging you.
  {
    B.add(new THREE.ConeGeometry(0.08, 0.2, 8), M.plastic(0xd33a2c), V(21, 0.38, 8));
    B.add(new THREE.SphereGeometry(0.07, 8, 6), M.plastic(0xf2d2b0), V(21, 0.25, 8));
    B.add(new THREE.CylinderGeometry(0.07, 0.09, 0.2, 8), M.plastic(0x2a6fd8), V(21, 0.1, 8));
    B.add(new THREE.ConeGeometry(0.06, 0.12, 6), M.plastic(0xffffff), V(21, 0.18, 8.06), new THREE.Euler(Math.PI, 0, 0));
  }

  B.flush(root);

  // Grass blades with a little wind.
  let grass: THREE.InstancedMesh | null = null;
  if (opts.grassBlades > 0) {
    const blade = new THREE.BufferGeometry();
    blade.setAttribute('position', new THREE.Float32BufferAttribute([-0.018, 0, 0, 0.018, 0, 0, 0, 0.1, 0.01, 0.011, 0.05, 0.004, -0.011, 0.05, 0.004], 3));
    blade.setIndex([0, 1, 3, 0, 3, 4, 4, 3, 2]);
    blade.computeVertexNormals();
    const gm = new THREE.MeshStandardMaterial({ color: 0x7aa84a, roughness: 1, side: THREE.DoubleSide });
    const uniforms = { uTime: { value: 0 } };
    gm.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = uniforms.uTime;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
           vec4 wp = instanceMatrix * vec4(0.0,0.0,0.0,1.0);
           float sway = sin(uTime * 1.7 + wp.x * 0.6 + wp.z * 0.4) * 0.03 + sin(uTime * 3.1 + wp.z) * 0.01;
           transformed.x += sway * position.y * 6.0;
           transformed.z += sway * position.y * 3.0;`,
        );
    };
    grass = new THREE.InstancedMesh(blade, gm, opts.grassBlades);
    grass.userData.uniforms = uniforms;
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const col = new THREE.Color();
    let n = 0;
    let guard = 0;
    while (n < opts.grassBlades && guard++ < opts.grassBlades * 4) {
      const px = -13.5 + rand() * 41;
      const pz = -9.5 + rand() * 23.3;
      if (blocked(px, pz)) continue;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() * Math.PI * 2);
      const s = 0.7 + rand() * 0.7;
      m4.compose(new THREE.Vector3(px, 0, pz), q, new THREE.Vector3(s, s * (0.8 + rand() * 0.6), s));
      grass.setMatrixAt(n, m4);
      col.setHSL(0.22 + rand() * 0.06, 0.45 + rand() * 0.2, 0.38 + rand() * 0.14);
      grass.setColorAt(n, col);
      n++;
    }
    grass.count = n;
    grass.receiveShadow = true;
    root.add(grass);
  }

  function blocked(px: number, pz: number): boolean {
    if (px > -14.2 && px < -7.8 && pz > -9.2 && pz < -0.8) return true; // garage
    if (px > -6.2 && px < 4.2 && pz > -10.2 && pz < -6.2) return true; // deck
    if (px > -4.1 && px < -0.9 && pz > 7.9 && pz < 11.1) return true; // sandbox
    if (px > -12.1 && px < -7.9 && pz > 8.9 && pz < 13.1) return true; // shed
    if (px > 1.9 && px < 12.1 && pz > 12.4) return true; // garden
    if (Math.abs(px - EAST_FENCE_X) < 0.1 || Math.abs(px - 28) < 0.1 || pz > 13.9) return true;
    if (px > 23.3 && px < 24.7 && pz > -2.6 && pz < -1.4) return true; // doghouse
    return Math.hypot(px - 6, pz - 6) < 0.45;
  }

  // Clouds
  const clouds = new THREE.Group();
  const cloudM = mat('cloud', () => new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, emissive: 0xfff4e0, emissiveIntensity: 0.35, flatShading: true }));
  for (let i = 0; i < 9; i++) {
    const c = new THREE.Group();
    for (let k = 0; k < 5; k++) {
      const puff = new THREE.Mesh(new THREE.IcosahedronGeometry(2 + rand() * 2.5, 1), cloudM);
      puff.position.set(k * 2.6 - 5, rand() * 1.2, rand() * 2);
      puff.scale.y = 0.6;
      c.add(puff);
    }
    c.position.set(-60 + rand() * 120, 38 + rand() * 18, -70 + rand() * 90);
    clouds.add(c);
  }
  root.add(clouds);

  return {
    root,
    gate,
    grass,
    clouds,
    update(t: number, dt: number) {
      if (grass) (grass.userData.uniforms as { uTime: { value: number } }).uTime.value = t;
      clouds.children.forEach((c, i) => {
        c.position.x += dt * (0.4 + (i % 3) * 0.15);
        if (c.position.x > 80) c.position.x = -80;
      });
    },
  };
}
