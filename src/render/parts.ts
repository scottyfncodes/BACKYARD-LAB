import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { getPart } from '../data/parts';
import { M, brickTexture, labelTexture, matTexture, stripeBallTexture, tennisTexture, woodTexture, mat } from './materials';

/**
 * Procedural meshes for every part. Dimensions match the physics shapes in
 * data/parts.ts so what you see is what collides. Animated sub-objects are
 * named: `spin` (rotates about userData.axis when active), `flame`, `string`.
 */

type Builder = () => THREE.Group;

const box = (w: number, h: number, d: number, m: THREE.Material, x = 0, y = 0, z = 0) => {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  mesh.position.set(x, y, z);
  return mesh;
};

const cyl = (r: number, h: number, m: THREE.Material, axis: 'x' | 'y' | 'z' = 'y', segs = 20, r2 = r) => {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r2, r, h, segs), m);
  if (axis === 'x') mesh.rotation.z = Math.PI / 2;
  if (axis === 'z') mesh.rotation.x = Math.PI / 2;
  return mesh;
};

const group = (...children: THREE.Object3D[]) => {
  const g = new THREE.Group();
  children.forEach((c) => g.add(c));
  return g;
};

const spinner = (axis: [number, number, number], ...children: THREE.Object3D[]) => {
  const g = group(...children);
  g.name = 'spin';
  g.userData.axis = new THREE.Vector3(...axis);
  return g;
};

function wheel(r: number, w: number, rim: number, hubColor: number, spokes: number): THREE.Group {
  const g = new THREE.Group();
  const tire = new THREE.Mesh(new THREE.TorusGeometry(r - w * 0.5, w * 0.5, 10, 32), M.rubber());
  tire.scale.z = 1;
  g.add(tire);
  const hub = cyl(rim, w * 0.8, M.plastic(hubColor), 'z', 18);
  g.add(hub);
  for (let i = 0; i < spokes; i++) {
    const s = box(0.012, r - w * 0.9, 0.012, M.metal());
    s.position.y = (r - w * 0.9) / 2;
    const holder = group(s);
    holder.rotation.z = (i / spokes) * Math.PI * 2;
    g.add(holder);
  }
  return g;
}

const BUILDERS: Record<string, Builder> = {
  plank: () => {
    const m = mat('plankwood', () => new THREE.MeshStandardMaterial({ map: woodTexture('#d0a36b', '#9a6c3e'), roughness: 0.85 }));
    const g = group(box(1.2, 0.03, 0.15, m));
    for (const x of [-0.52, 0.52]) g.add(box(0.012, 0.004, 0.012, M.darkMetal(), x, 0.016, 0.03), box(0.012, 0.004, 0.012, M.darkMetal(), x, 0.016, -0.03));
    return g;
  },
  crate: () => {
    const g = new THREE.Group();
    g.add(box(0.46, 0.36, 0.46, M.matte(0x3a2a18)));
    const w = M.wood();
    for (let i = 0; i < 3; i++) {
      const y = -0.13 + i * 0.13;
      g.add(box(0.5, 0.09, 0.02, w, 0, y, 0.24), box(0.5, 0.09, 0.02, w, 0, y, -0.24));
      g.add(box(0.02, 0.09, 0.5, w, 0.24, y, 0), box(0.02, 0.09, 0.5, w, -0.24, y, 0));
    }
    for (const x of [-0.235, 0.235]) for (const z of [-0.235, 0.235]) g.add(box(0.035, 0.4, 0.035, M.woodDark(), x, 0, z));
    for (let i = 0; i < 4; i++) g.add(box(0.11, 0.02, 0.48, w, -0.18 + i * 0.12, 0.19, 0));
    return g;
  },
  broom: () => {
    const g = new THREE.Group();
    const handle = cyl(0.016, 1.24, M.plastic(0xd8452f), 'x', 10);
    handle.position.x = -0.08;
    g.add(handle);
    g.add(box(0.03, 0.08, 0.05, M.metal(), 0.55, 0, 0));
    const bristles = box(0.1, 0.26, 0.07, M.matte(0xd9b45a), 0.62, 0, 0);
    g.add(bristles);
    g.add(box(0.101, 0.03, 0.071, M.plastic(0x2b6fd8), 0.62, 0.115, 0));
    return g;
  },
  skateboard: () => {
    const g = new THREE.Group();
    const deckMat = M.plastic(0x2f7fc1);
    g.add(box(0.62, 0.024, 0.21, deckMat, 0, 0.1, 0));
    for (const s of [-1, 1]) {
      const end = cyl(0.105, 0.024, deckMat, 'y', 20);
      end.scale.x = 0.9;
      end.position.set(s * 0.31, 0.1 + s * 0.008, 0);
      end.rotation.z = s * -0.15;
      g.add(end);
    }
    g.add(box(0.6, 0.004, 0.19, M.matte(0x222222), 0, 0.113, 0));
    for (const x of [-0.27, 0.27]) {
      g.add(box(0.04, 0.05, 0.16, M.metal(), x, 0.06, 0));
      for (const z of [-0.075, 0.075]) {
        const w = cyl(0.028, 0.03, M.plastic(0xf3efe2), 'z', 14);
        w.position.set(x, 0.028, z);
        g.add(w);
      }
    }
    return g;
  },
  bucket: () => {
    const pts: THREE.Vector2[] = [];
    pts.push(new THREE.Vector2(0, -0.15), new THREE.Vector2(0.12, -0.15), new THREE.Vector2(0.14, 0.15), new THREE.Vector2(0.148, 0.15), new THREE.Vector2(0.148, 0.135));
    const geo = new THREE.LatheGeometry(pts, 28);
    const m = mat('bucket', () => new THREE.MeshStandardMaterial({ color: 0xe8b830, roughness: 0.5, side: THREE.DoubleSide }));
    const g = group(new THREE.Mesh(geo, m));
    const handle = new THREE.Mesh(new THREE.TorusGeometry(0.145, 0.005, 6, 24, Math.PI), M.metal());
    handle.position.y = 0.14;
    handle.rotation.y = Math.PI / 2;
    g.add(handle);
    return g;
  },
  lawn_wheel: () => group(spinner([0, 0, 1], wheel(0.1, 0.05, 0.05, 0xf2c230, 5))),
  bike_wheel: () => {
    const g = new THREE.Group();
    const tire = new THREE.Mesh(new THREE.TorusGeometry(0.285, 0.018, 8, 48), M.rubber());
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.265, 0.008, 6, 48), M.metal());
    const hub = cyl(0.025, 0.1, M.metal(), 'z', 12);
    const spokes = new THREE.Group();
    for (let i = 0; i < 18; i++) {
      const s = cyl(0.0018, 0.27, M.metal(), 'y', 4);
      s.position.y = 0.135;
      const h = group(s);
      h.rotation.z = (i / 18) * Math.PI * 2;
      h.position.z = (i % 2 ? 1 : -1) * 0.012;
      spokes.add(h);
    }
    const reflector = box(0.03, 0.05, 0.005, M.emissive(0xff7a1a), 0, 0.2, 0.01);
    g.add(spinner([0, 0, 1], tire, rim, hub, spokes, reflector));
    return g;
  },
  motor: () => {
    const g = new THREE.Group();
    const body = cyl(0.045, 0.14, M.plastic(0x2e9a4a), 'z', 20);
    body.position.z = -0.01;
    g.add(body);
    const cap = cyl(0.047, 0.03, M.matte(0x1a1a1a), 'z', 20);
    cap.position.z = -0.075;
    g.add(cap);
    const band = cyl(0.046, 0.02, M.plastic(0xf2c230), 'z', 20);
    band.position.z = 0.04;
    g.add(band);
    g.add(box(0.1, 0.02, 0.12, M.darkMetal(), 0, -0.055, 0));
    const shaft = cyl(0.008, 0.05, M.metal(), 'z', 8);
    shaft.position.z = 0.085;
    const flag = box(0.03, 0.008, 0.008, M.plastic(0xe0332b), 0.015, 0, 0.09);
    g.add(spinner([0, 0, 1], shaft, flag));
    for (let i = 0; i < 6; i++) {
      const v = box(0.004, 0.02, 0.03, M.matte(0x173f22), 0.045 * Math.cos(i), 0.045 * Math.sin(i), -0.03);
      g.add(v);
    }
    return g;
  },
  battery_small: () => {
    const g = new THREE.Group();
    const label = mat('lanternLabel', () => new THREE.MeshStandardMaterial({ map: labelTexture('6V', '#1f4fb0', '#ffffff', 128, 128), roughness: 0.5 }));
    g.add(box(0.11, 0.12, 0.11, label));
    g.add(box(0.112, 0.02, 0.112, M.plastic(0xf2f2f2), 0, 0.05, 0));
    for (const x of [-0.03, 0.03]) {
      const coil = new THREE.Mesh(new THREE.TorusGeometry(0.008, 0.002, 4, 10), M.metal());
      coil.position.set(x, 0.07, 0);
      coil.rotation.x = Math.PI / 2;
      g.add(coil);
    }
    return g;
  },
  battery_car: () => {
    const g = new THREE.Group();
    const label = mat('carbatLabel', () => new THREE.MeshStandardMaterial({ map: labelTexture('12V  HEAVY', '#1b1b1d', '#f2c230', 256, 96), roughness: 0.6 }));
    g.add(box(0.26, 0.2, 0.18, label));
    g.add(box(0.262, 0.02, 0.182, M.matte(0x2a2a2d), 0, 0.09, 0));
    const pos = cyl(0.014, 0.03, M.plastic(0xd33a2c), 'y', 10);
    pos.position.set(-0.09, 0.11, 0);
    const neg = cyl(0.014, 0.03, M.matte(0x111111), 'y', 10);
    neg.position.set(0.09, 0.11, 0);
    g.add(pos, neg);
    return g;
  },
  box_fan: () => {
    const g = new THREE.Group();
    const frame = M.plastic(0xefe7d6);
    g.add(box(0.46, 0.04, 0.12, frame, 0, 0.21, 0), box(0.46, 0.04, 0.12, frame, 0, -0.21, 0));
    g.add(box(0.04, 0.46, 0.12, frame, 0.21, 0, 0), box(0.04, 0.46, 0.12, frame, -0.21, 0, 0));
    for (let i = -3; i <= 3; i++) {
      g.add(box(0.004, 0.4, 0.004, M.darkMetal(), i * 0.055, 0, 0.055), box(0.4, 0.004, 0.004, M.darkMetal(), 0, i * 0.055, -0.055));
    }
    const blades = new THREE.Group();
    for (let i = 0; i < 5; i++) {
      const b = box(0.07, 0.17, 0.006, M.plastic(0x7fb8e0), 0, 0.095, 0);
      b.rotation.y = 0.35;
      const h = group(b);
      h.rotation.z = (i / 5) * Math.PI * 2;
      blades.add(h);
    }
    blades.add(cyl(0.03, 0.03, M.plastic(0x7fb8e0), 'z', 12));
    g.add(spinner([0, 0, 1], blades));
    g.add(box(0.06, 0.03, 0.03, M.plastic(0xd33a2c), 0.15, 0.24, 0.03));
    return g;
  },
  vacuum: () => {
    const g = new THREE.Group();
    const can = cyl(0.16, 0.3, M.plastic(0xf2c230), 'y', 24);
    can.position.y = -0.03;
    g.add(can);
    const lid = cyl(0.165, 0.07, M.matte(0x1f1f1f), 'y', 24);
    lid.position.y = 0.145;
    g.add(lid);
    g.add(box(0.12, 0.03, 0.04, M.matte(0x1f1f1f), 0, 0.195, 0));
    const hose = new THREE.Mesh(
      new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0.08, 0.14), new THREE.Vector3(0, 0.1, 0.24), new THREE.Vector3(0, -0.03, 0.22), new THREE.Vector3(0, -0.08, 0.2)]), 16, 0.025, 8),
      M.matte(0x2a2a2a),
    );
    g.add(hose);
    const nozzle = box(0.07, 0.07, 0.34, M.plastic(0x3a3a3a), 0, -0.08, 0.33);
    g.add(nozzle);
    g.add(box(0.1, 0.04, 0.02, M.plastic(0x3a3a3a), 0, -0.08, 0.5));
    for (const a of [0, 2.1, 4.2]) {
      const w = cyl(0.025, 0.02, M.matte(0x111111), 'x', 10);
      w.position.set(Math.cos(a) * 0.13, -0.165, Math.sin(a) * 0.13);
      g.add(w);
    }
    return g;
  },
  balloons: () => {
    const g = new THREE.Group();
    const colors = [0xe83a3a, 0x3a7ae8, 0xf2c230];
    const offs: [number, number, number][] = [[-0.09, 0.02, 0], [0.09, 0.04, 0.03], [0, -0.03, -0.1]];
    offs.forEach((o, i) => {
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.15, 18, 14), mat(`balloon${i}`, () => new THREE.MeshStandardMaterial({ color: colors[i], roughness: 0.25, metalness: 0.05 })));
      b.scale.y = 1.15;
      b.position.set(...o);
      g.add(b);
      const knot = new THREE.Mesh(new THREE.ConeGeometry(0.02, 0.03, 6), b.material);
      knot.position.set(o[0], o[1] - 0.18, o[2]);
      g.add(knot);
    });
    const s = cyl(0.002, 0.84, M.basic(0xffffff), 'y', 3);
    s.position.y = -0.26 - 0.42;
    const str = group(s);
    str.name = 'string';
    g.add(str);
    return g;
  },
  rope: () => {
    const g = new THREE.Group();
    const m = M.matte(0xc9a66b);
    for (let i = 0; i < 4; i++) {
      const t = new THREE.Mesh(new THREE.TorusGeometry(0.065 - i * 0.004, 0.012, 6, 20), m);
      t.rotation.x = Math.PI / 2;
      t.position.y = -0.025 + i * 0.016;
      g.add(t);
    }
    return g;
  },
  bungee: () => {
    const g = new THREE.Group();
    const t = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.01, 6, 20), M.plastic(0x8a2be2));
    t.rotation.x = Math.PI / 2;
    g.add(t);
    const t2 = new THREE.Mesh(new THREE.TorusGeometry(0.04, 0.01, 6, 20), M.plastic(0x2bb673));
    t2.rotation.x = Math.PI / 2;
    t2.position.y = 0.02;
    g.add(t2);
    for (const x of [-0.07, 0.07]) {
      const hook = new THREE.Mesh(new THREE.TorusGeometry(0.015, 0.003, 4, 10, Math.PI * 1.4), M.metal());
      hook.position.set(x, 0.01, 0);
      g.add(hook);
    }
    return g;
  },
  spring: () => group(new THREE.Mesh(springGeometry(0.1, 0.035, 7), M.metal())),
  hinge: () => {
    const g = new THREE.Group();
    g.add(box(0.12, 0.004, 0.1, M.metal(), 0, -0.006, 0));
    g.add(box(0.12, 0.004, 0.1, M.metal(), 0, 0.006, 0));
    const barrel = cyl(0.008, 0.12, M.metal(), 'x', 10);
    barrel.position.set(0, 0, 0.05);
    g.add(barrel);
    for (const x of [-0.035, 0.035]) for (const z of [-0.02, 0.02]) g.add(box(0.01, 0.002, 0.01, M.darkMetal(), x, 0.009, z));
    return g;
  },
  duct_tape: () => {
    const m = mat('tape', () => new THREE.MeshStandardMaterial({ color: 0xaab0b8, metalness: 0.4, roughness: 0.5 }));
    const g = group(box(0.11, 0.02, 0.11, m));
    for (let i = 0; i < 4; i++) {
      const w = box(0.1, 0.004, 0.02, m, 0, 0.011, -0.04 + i * 0.027);
      w.rotation.y = (i - 1.5) * 0.12;
      g.add(w);
    }
    return g;
  },
  bottle_rocket: () => {
    const g = new THREE.Group();
    const pts = [
      new THREE.Vector2(0.012, -0.17),
      new THREE.Vector2(0.015, -0.15),
      new THREE.Vector2(0.05, -0.12),
      new THREE.Vector2(0.05, 0.08),
      new THREE.Vector2(0.03, 0.14),
      new THREE.Vector2(0.001, 0.17),
    ];
    const bottle = new THREE.Mesh(
      new THREE.LatheGeometry(pts, 20),
      mat('bottle', () => new THREE.MeshStandardMaterial({ color: 0x6fcf7a, roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.8 })),
    );
    g.add(bottle);
    g.add(box(0.101, 0.05, 0.101, mat('bottleLabel', () => new THREE.MeshStandardMaterial({ map: labelTexture('FIZZ', '#e0332b', '#fff', 128, 64) })), 0, 0, 0));
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.08, 16), M.plastic(0xff8a1a));
    nose.position.y = 0.19;
    g.add(nose);
    for (let i = 0; i < 3; i++) {
      const fin = box(0.003, 0.08, 0.05, M.matte(0xc9a66b), 0, -0.12, 0.07);
      const h = group(fin);
      h.rotation.y = (i / 3) * Math.PI * 2;
      g.add(h);
    }
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.3, 10), M.basic(0xfff1a8, 0.85));
    flame.rotation.x = Math.PI;
    flame.position.y = -0.33;
    flame.name = 'flame';
    flame.visible = false;
    g.add(flame);
    return g;
  },
  timer: () => {
    const g = new THREE.Group();
    const t = new THREE.Mesh(new THREE.SphereGeometry(0.052, 18, 12), M.plastic(0xe0332b));
    t.scale.y = 0.72;
    g.add(t);
    const stem = cyl(0.006, 0.02, M.plastic(0x2e9a4a), 'y', 6);
    stem.position.y = 0.045;
    g.add(stem);
    const dial = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.005, 6, 24), M.plastic(0xffffff));
    dial.rotation.x = Math.PI / 2;
    dial.position.y = 0.005;
    g.add(dial);
    const knob = spinner([0, 1, 0], box(0.05, 0.008, 0.01, M.matte(0x111111), 0.025, 0.035, 0));
    g.add(knob);
    return g;
  },
  pressure_plate: () => {
    const g = new THREE.Group();
    g.add(box(0.5, 0.04, 0.36, mat('mat', () => new THREE.MeshStandardMaterial({ map: matTexture(), roughness: 1 }))));
    const btn = cyl(0.03, 0.012, M.plastic(0xe0332b), 'y', 12);
    btn.position.set(0.2, 0.025, 0.13);
    btn.name = 'button';
    g.add(btn);
    return g;
  },
  rc_receiver: () => {
    const g = new THREE.Group();
    g.add(box(0.1, 0.05, 0.14, M.matte(0x1b1b1d)));
    g.add(box(0.09, 0.004, 0.12, M.plastic(0x1f8a3a), 0, 0.027, 0));
    const ant = cyl(0.003, 0.28, M.matte(0x111111), 'y', 5);
    ant.position.set(-0.035, 0.16, -0.05);
    g.add(ant);
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.009, 8, 6), M.emissive(0xff3322));
    tip.position.set(-0.035, 0.3, -0.05);
    tip.name = 'led';
    g.add(tip);
    // Arrow shows which way is "forward".
    const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.05, 3), M.plastic(0xf2c230));
    arrow.rotation.x = Math.PI / 2;
    arrow.position.set(0.01, 0.034, 0.03);
    arrow.scale.y = 1;
    arrow.scale.z = 0.2;
    g.add(arrow);
    return g;
  },
  winch: () => {
    const g = new THREE.Group();
    g.add(box(0.18, 0.03, 0.14, M.darkMetal(), 0, -0.065, 0));
    for (const x of [-0.075, 0.075]) g.add(box(0.012, 0.13, 0.12, M.plastic(0x1f4fb0), x, -0.005, 0));
    const drum = cyl(0.05, 0.14, M.metal(), 'x', 16);
    const rope = cyl(0.056, 0.1, M.matte(0xc9a66b), 'x', 16);
    const crank = box(0.01, 0.08, 0.01, M.darkMetal(), 0.1, 0.04, 0);
    g.add(spinner([1, 0, 0], drum, rope, crank));
    return g;
  },
  trampoline: () => {
    const g = new THREE.Group();
    const matT = cyl(0.44, 0.01, M.matte(0x151515), 'y', 32);
    matT.position.y = 0.24;
    g.add(matT);
    const pad = new THREE.Mesh(new THREE.TorusGeometry(0.47, 0.04, 8, 36), M.plastic(0x2a8fe0));
    pad.rotation.x = Math.PI / 2;
    pad.position.y = 0.245;
    g.add(pad);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const leg = cyl(0.012, 0.24, M.metal(), 'y', 6);
      leg.position.set(Math.cos(a) * 0.46, 0.12, Math.sin(a) * 0.46);
      g.add(leg);
    }
    return g;
  },
  brick: () => group(box(0.2, 0.064, 0.096, mat('brick', () => new THREE.MeshStandardMaterial({ map: brickTexture(), color: 0xc05a3c, roughness: 0.95 })))),
  playground_ball: () => {
    const g = group(new THREE.Mesh(new THREE.SphereGeometry(0.11, 24, 16), mat('ball', () => new THREE.MeshStandardMaterial({ map: stripeBallTexture(), roughness: 0.4 }))));
    return g;
  },
  kite: () => {
    const g = new THREE.Group();
    const colors = [0xe0332b, 0xf2c230, 0x2a8fe0, 0x2e9a4a];
    const P = [new THREE.Vector3(0, 0, -0.42), new THREE.Vector3(0.32, 0, -0.08), new THREE.Vector3(0, 0, 0.42), new THREE.Vector3(-0.32, 0, -0.08)];
    const c = new THREE.Vector3(0, 0, -0.08);
    for (let i = 0; i < 4; i++) {
      const geo = new THREE.BufferGeometry().setFromPoints([c, P[i], P[(i + 1) % 4]]);
      geo.computeVertexNormals();
      g.add(new THREE.Mesh(geo, mat(`kite${i}`, () => new THREE.MeshStandardMaterial({ color: colors[i], side: THREE.DoubleSide, roughness: 0.7 }))));
    }
    g.add(box(0.006, 0.006, 0.84, M.woodDark()), box(0.64, 0.006, 0.006, M.woodDark(), 0, 0, -0.08));
    for (let i = 0; i < 5; i++) {
      const bow = box(0.06, 0.004, 0.03, M.plastic(colors[i % 4]), (i % 2 ? 0.03 : -0.03), 0, 0.5 + i * 0.12);
      g.add(bow);
    }
    return g;
  },
  newspaper: () => {
    const paper = mat('newspaper', () => new THREE.MeshStandardMaterial({ color: 0xe9e4d6, roughness: 0.95 }));
    const g = group(cyl(0.035, 0.3, paper, 'x', 12));
    g.add(cyl(0.037, 0.02, M.plastic(0xd8433a), 'x', 10));
    g.add(box(0.3, 0.004, 0.02, M.plastic(0x444444), 0, 0.03, 0.01));
    return g;
  },
  lunchbox: () => {
    const g = group(box(0.16, 0.1, 0.12, M.plastic(0x2a8fe0)));
    g.add(box(0.17, 0.02, 0.13, M.plastic(0xf2c230), 0, 0.045, 0));
    g.add(box(0.06, 0.02, 0.02, M.plastic(0xf2c230), 0, 0.065, 0));
    g.add(box(0.05, 0.05, 0.001, M.plastic(0xd8433a), 0, -0.01, 0.061));
    return g;
  },
  tennis_ball: () => group(new THREE.Mesh(new THREE.SphereGeometry(0.034, 16, 12), mat('tennis', () => new THREE.MeshStandardMaterial({ map: tennisTexture(), roughness: 0.9 })))),
};

export function springGeometry(length: number, radius: number, turns: number): THREE.BufferGeometry {
  const pts: THREE.Vector3[] = [];
  const n = turns * 16;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const a = t * turns * Math.PI * 2;
    pts.push(new THREE.Vector3(Math.cos(a) * radius, t * length - length / 2, Math.sin(a) * radius));
  }
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), n, 0.005, 5);
}

const templates = new Map<string, THREE.Group>();
const ANIMATED = new Set(['spin', 'flame', 'string', 'button', 'led']);

/** Merge every static sub-mesh of a part by material: far fewer draw calls. */
function compact(g: THREE.Group): THREE.Group {
  g.updateMatrixWorld(true);
  const buckets = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const keep: THREE.Object3D[] = [];
  const walk = (o: THREE.Object3D, animated: boolean) => {
    const anim = animated || ANIMATED.has(o.name);
    if (anim && ANIMATED.has(o.name)) {
      keep.push(o);
      return;
    }
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh && !Array.isArray(mesh.material)) {
      let geo = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
      geo.applyMatrix4(mesh.matrixWorld);
      for (const k of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv'].includes(k)) geo.deleteAttribute(k);
      if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2));
      const list = buckets.get(mesh.material) ?? [];
      list.push(geo);
      buckets.set(mesh.material, list);
    }
    for (const c of o.children) walk(c, anim);
  };
  for (const c of g.children) walk(c, false);
  const out = new THREE.Group();
  for (const [m, geos] of buckets) {
    const merged = mergeGeometries(geos, false);
    if (merged) out.add(new THREE.Mesh(merged, m));
  }
  for (const k of keep) {
    const parentMatrix = k.parent!.matrixWorld.clone();
    k.removeFromParent();
    k.applyMatrix4(parentMatrix);
    out.add(k);
  }
  return out;
}

/** A fresh, shadow-casting mesh group for a part. Geometry is shared. */
export function partMesh(defId: string): THREE.Group {
  let t = templates.get(defId);
  if (!t) {
    const b = BUILDERS[getPart(defId).visual];
    t = compact(b ? b() : group(box(0.1, 0.1, 0.1, M.plastic(0xff00ff))));
    t.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    templates.set(defId, t);
  }
  const clone = t.clone(true);
  clone.userData.def = defId;
  return clone;
}

/** Animate a part mesh from its runtime state. */
export function animatePart(g: THREE.Object3D, dt: number, s: { active: boolean; cmd: number; power: number; pressed?: boolean }) {
  const spin = g.getObjectByName('spin');
  if (spin && s.active) {
    const speed = (s.cmd || 1) * 20 * Math.max(0.2, s.power);
    spin.rotateOnAxis(spin.userData.axis as THREE.Vector3, speed * dt);
  }
  const flame = g.getObjectByName('flame');
  if (flame) {
    flame.visible = s.active;
    if (s.active) flame.scale.setScalar(0.8 + Math.random() * 0.5);
  }
  const btn = g.getObjectByName('button');
  if (btn) btn.position.y = s.pressed ? 0.018 : 0.025;
}
