import * as THREE from 'three';
import { getPart } from '../data/parts';
import { findPart, linkWorldEnds, partPose, type Blueprint } from '../sim/blueprint';
import type { MachineInstance, LinkRt } from '../sim/machine';
import { toQ, toV } from '../sim/physics';
import { WAGON, type Simulation } from '../sim/simulation';
import type { WagonFrame } from '../sim/wagonbuild';
import { M } from './materials';
import { animatePart, partMesh, springGeometry } from './parts';

const UP = new THREE.Vector3(0, 1, 0);

/** Visual for a rope / bungee / spring between two points. */
export class LinkVisual {
  obj: THREE.Object3D;
  private segs?: THREE.InstancedMesh;
  private body?: THREE.Mesh;
  constructor(
    public kind: 'rope' | 'elastic' | 'spring',
    public segments: number,
    radius: number,
    color: number,
  ) {
    if (kind === 'rope') {
      this.segs = new THREE.InstancedMesh(new THREE.CylinderGeometry(radius, radius, 1, 5), M.matte(color), segments);
      this.segs.castShadow = true;
      this.segs.frustumCulled = false;
      this.obj = this.segs;
    } else if (kind === 'spring') {
      this.body = new THREE.Mesh(springGeometry(1, radius, 9), M.metal());
      this.body.castShadow = true;
      this.obj = this.body;
    } else {
      this.body = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, 1, 6), M.plastic(color));
      this.body.castShadow = true;
      this.obj = this.body;
    }
  }

  setPoints(pts: THREE.Vector3[]) {
    if (this.segs) {
      const m = new THREE.Matrix4();
      const n = Math.min(this.segments, pts.length - 1);
      for (let i = 0; i < n; i++) {
        const a = pts[i];
        const b = pts[i + 1];
        const d = b.clone().sub(a);
        const len = d.length();
        const q = new THREE.Quaternion().setFromUnitVectors(UP, len > 1e-6 ? d.divideScalar(len) : UP);
        m.compose(a.clone().add(b).multiplyScalar(0.5), q, new THREE.Vector3(1, Math.max(len, 0.001), 1));
        this.segs.setMatrixAt(i, m);
      }
      this.segs.count = n;
      this.segs.instanceMatrix.needsUpdate = true;
    } else if (this.body) {
      const a = pts[0];
      const b = pts[pts.length - 1];
      const d = b.clone().sub(a);
      const len = Math.max(0.01, d.length());
      this.body.position.copy(a).add(b).multiplyScalar(0.5);
      this.body.quaternion.setFromUnitVectors(UP, d.divideScalar(len));
      const thin = this.kind === 'elastic' ? Math.max(0.5, Math.min(1.4, 0.6 / len)) : 1;
      this.body.scale.set(thin, len, thin);
    }
  }

  dispose() {
    this.obj.removeFromParent();
  }
}

function sagPoints(a: THREE.Vector3, b: THREE.Vector3, length: number, n = 12): THREE.Vector3[] {
  const span = a.distanceTo(b);
  const sag = span < length ? Math.sqrt(Math.max(0, length * length - span * span)) * 0.45 : 0;
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const p = a.clone().lerp(b, t);
    p.y -= sag * 4 * t * (1 - t);
    pts.push(p);
  }
  return pts;
}

const linkColor = (id: string) => (id === 'bungee' ? 0x8a2be2 : id === 'rope' ? 0xc9a66b : 0xf5f5f5);

/** A live machine in the world. */
export class MachineView {
  group = new THREE.Group();
  parts = new Map<number, THREE.Group>();
  links = new Map<number, LinkVisual>();
  constructor(public m: MachineInstance) {
    for (const p of m.bp.parts) {
      const def = getPart(p.def);
      if (def.link) continue;
      const g = partMesh(p.def);
      const str = g.getObjectByName('string');
      if (str) str.visible = false;
      g.userData.uid = p.uid;
      this.parts.set(p.uid, g);
      this.group.add(g);
    }
  }

  update(dt: number) {
    const m = this.m;
    for (const [uid, g] of this.parts) {
      const wp = m.partWorldPose(uid);
      if (!wp) continue;
      g.position.copy(wp.p);
      g.quaternion.copy(wp.q);
      const rt = m.parts.get(uid);
      if (rt) animatePart(g, dt, rt);
    }
    const alive = new Set<number>();
    for (const l of m.links) {
      if (l.broken) continue;
      alive.add(l.id);
      let v = this.links.get(l.id);
      if (!v) {
        v = new LinkVisual(l.link.kind, l.rope ? l.rope.segments : 1, l.link.radius, linkColor(l.def.id));
        this.links.set(l.id, v);
        this.group.add(v.obj);
      }
      v.setPoints(this.linkPoints(l));
    }
    for (const [id, v] of this.links) if (!alive.has(id)) {
      v.dispose();
      this.links.delete(id);
    }
  }

  linkPoints(l: LinkRt): THREE.Vector3[] {
    if (l.rope) return l.rope.pts;
    return [this.m.linkEndWorld(l.a), this.m.linkEndWorld(l.b)];
  }

  dispose() {
    this.group.removeFromParent();
  }
}

/** A blueprint drawn at an arbitrary transform (workbench, carried ghost). */
export class BlueprintView {
  group = new THREE.Group();
  parts = new Map<number, THREE.Group>();
  private links: LinkVisual[] = [];
  constructor(public bp: Blueprint) {
    this.rebuild();
  }

  rebuild() {
    this.group.clear();
    this.parts.clear();
    this.links = [];
    for (const p of this.bp.parts) {
      const def = getPart(p.def);
      if (def.link) continue;
      const g = partMesh(p.def);
      const str = g.getObjectByName('string');
      if (str) str.visible = false;
      const pp = partPose(p);
      g.position.copy(pp.p);
      g.quaternion.copy(pp.q);
      g.userData.uid = p.uid;
      this.parts.set(p.uid, g);
      this.group.add(g);
    }
    for (const l of this.bp.links) {
      const part = findPart(this.bp, l.part);
      if (!part) continue;
      const def = getPart(part.def);
      const v = new LinkVisual(def.link!.kind, 12, def.link!.radius, linkColor(def.id));
      const [a, b] = linkWorldEnds(this.bp, l);
      v.setPoints(def.link!.kind === 'rope' ? sagPoints(a, b, part.settings?.length ?? def.link!.length) : [a, b]);
      this.links.push(v);
      this.group.add(v.obj);
    }
    // Balloon strings
    for (const c of this.bp.connections) {
      if (c.kind !== 'tether') continue;
      const b = findPart(this.bp, c.b);
      if (!b) continue;
      const bp = partPose(b);
      const bottom = new THREE.Vector3(0, -0.26, 0).applyQuaternion(bp.q).add(bp.p);
      const v = new LinkVisual('rope', 1, 0.003, 0xffffff);
      v.setPoints([new THREE.Vector3(...c.anchor), bottom]);
      this.group.add(v.obj);
    }
  }

  setGhost(color: number | null) {
    this.group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh && !(o as THREE.InstancedMesh).isInstancedMesh) return;
      if (color === null) {
        if (mesh.userData.orig) mesh.material = mesh.userData.orig;
      } else {
        if (!mesh.userData.orig) mesh.userData.orig = mesh.material;
        mesh.material = M.basic(color, 0.45);
      }
    });
  }

  /** Glow one part: orange when selected, blue-green for "this is what it will connect to". */
  highlight(uid: number | null, color = 0xffa020) {
    for (const [u, g] of this.parts) {
      g.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const sel = u === uid;
        if (sel) {
          if (!mesh.userData.orig) {
            mesh.userData.orig = mesh.material;
            mesh.material = (mesh.material as THREE.MeshStandardMaterial).clone();
          }
          const m = mesh.material as THREE.MeshStandardMaterial;
          if ('emissive' in m) {
            m.emissive = new THREE.Color(color);
            m.emissiveIntensity = 0.45;
          }
        } else if (!sel && mesh.userData.orig) {
          (mesh.material as THREE.Material).dispose();
          mesh.material = mesh.userData.orig;
          delete mesh.userData.orig;
        }
      });
    }
  }
}

/** The little red wagon (or the one the kid built), its handle, and whatever is riding in it. */
export class WagonView {
  group = new THREE.Group();
  /** The stock red wagon model. Hidden when the kid's own design is in use. */
  private stock = new THREE.Group();
  private handle = new THREE.Group();
  private cargo = new THREE.Group();
  private wheels: THREE.Mesh[] = [];
  private loadKey = '';
  private roll = 0;
  private handlePitch = 1.62;
  /** The kid's own wagon: their blueprint, turned so the handle points to -Z, wheels bottoms on the ground. */
  private own: { bp: Blueprint; frame: WagonFrame; view: BlueprintView; wheels: { g: THREE.Group; axis: THREE.Vector3; q0: THREE.Quaternion }[] } | null = null;
  constructor() {
    const [hx, hy, hz] = WAGON.half;
    const red = M.plastic(0xc8261e);
    const floorY = 0.15;
    const top = hy * 2;
    const slab = (w: number, h: number, d: number, x: number, y: number, z: number, m: THREE.Material) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
      mesh.position.set(x, y, z);
      mesh.castShadow = mesh.receiveShadow = true;
      this.stock.add(mesh);
      return mesh;
    };
    const t = 0.025;
    slab(hx * 2, t, hz * 2, 0, floorY, 0, red);
    const wallH = top - floorY;
    slab(t, wallH, hz * 2, hx - t / 2, floorY + wallH / 2, 0, red);
    slab(t, wallH, hz * 2, -hx + t / 2, floorY + wallH / 2, 0, red);
    slab(hx * 2, wallH, t, 0, floorY + wallH / 2, hz - t / 2, red);
    slab(hx * 2, wallH, t, 0, floorY + wallH / 2, -hz + t / 2, red);
    // White rim, like the real thing.
    slab(hx * 2 + 0.01, 0.02, t, 0, top, hz - t / 2, M.plastic(0xf2efe8));
    slab(hx * 2 + 0.01, 0.02, t, 0, top, -hz + t / 2, M.plastic(0xf2efe8));
    const axleM = M.metal();
    const r = 0.085;
    for (const z of [-hz + 0.1, hz - 0.1]) {
      slab(hx * 2 + 0.08, 0.02, 0.02, 0, r, z, axleM);
      for (const x of [-hx - 0.03, hx + 0.03]) {
        const w = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.045, 14), M.rubber());
        w.rotation.z = Math.PI / 2;
        w.position.set(x, r, z);
        w.castShadow = true;
        const hub = new THREE.Mesh(new THREE.BoxGeometry(0.047, r * 1.1, 0.03), M.plastic(0xf2efe8));
        w.add(hub);
        this.wheels.push(w);
        this.stock.add(w);
      }
    }
    // Handle: a bar hinged at the front with a T grip.
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.9, 6), axleM);
    bar.position.y = 0.45;
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.16, 8), M.rubber());
    grip.rotation.z = Math.PI / 2;
    grip.position.y = 0.9;
    this.handle.add(bar, grip);
    this.handle.position.set(0, 0.16, -hz - 0.02);
    this.stock.add(this.handle);
    this.group.add(this.stock, this.cargo);
  }

  /** Swap in (or out) the kid's own design. */
  private setOwn(bp: Blueprint | null, frame: WagonFrame | null) {
    if (this.own) {
      this.own.view.group.parent?.removeFromParent();
      this.own = null;
    }
    this.stock.visible = !bp;
    if (!bp || !frame) return;
    const view = new BlueprintView(bp);
    const turn = new THREE.Group();
    turn.rotation.y = frame.yaw;
    view.group.position.set(-frame.center[0], -frame.minY, -frame.center[2]);
    turn.add(view.group);
    this.group.add(turn);
    const wheels = frame.wheels
      .map((w) => {
        const g = view.parts.get(w.uid);
        return g ? { g, axis: new THREE.Vector3(...w.axis), q0: g.quaternion.clone() } : null;
      })
      .filter((x): x is NonNullable<typeof x> => !!x);
    this.own = { bp, frame, view, wheels };
    this.loadKey = '';
  }

  update(sim: Simulation, dt: number) {
    const w = sim.wagon;
    this.group.visible = !!w;
    if (!w) return;
    if ((this.own?.bp ?? null) !== w.bp) this.setOwn(w.bp, w.frame);
    const p = toV(w.rb.translation());
    const q = toQ(w.rb.rotation());
    const moved = p.distanceTo(this.group.position);
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
    const sign = p.clone().sub(this.group.position).dot(fwd) >= 0 ? 1 : -1;
    this.group.position.copy(p);
    this.group.quaternion.copy(q);
    const wheelR = this.own ? Math.max(0.05, ...this.own.frame.wheels.map((x) => x.r)) : 0.085;
    this.roll += (sign * Math.min(moved, 1)) / wheelR;
    for (const wh of this.wheels) wh.rotation.x = -this.roll;
    if (this.own) {
      // Each wheel spins about its own hub axis; which way depends on which side it is on.
      for (const wh of this.own.wheels) {
        const worldAxis = wh.axis.clone().applyQuaternion(wh.q0).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.own.frame.yaw);
        const side = worldAxis.x >= 0 ? 1 : -1;
        wh.g.quaternion.copy(wh.q0).multiply(new THREE.Quaternion().setFromAxisAngle(wh.axis, -side * this.roll));
      }
      const key = w.load.map((s) => s.part).join(',');
      if (key !== this.loadKey) {
        this.loadKey = key;
        this.fillCargo(w.load.map((s) => s.part), this.own.frame.bedHalf[0], this.own.frame.bedHalf[1], this.own.frame.bedTop);
      }
      return;
    }
    // Handle: up to the kid's hand when pulling, resting on the ground otherwise.
    let pitch = 1.62;
    let yaw = 0;
    if (w.hitched && sim.player) {
      const hand = toV(sim.player.translation()).add(new THREE.Vector3(0, -0.05, 0));
      const pivot = this.handle.position.clone().applyQuaternion(q).add(p);
      const local = hand.sub(pivot).applyQuaternion(q.clone().invert());
      yaw = Math.atan2(-local.x, -local.z);
      pitch = Math.atan2(Math.hypot(local.x, local.z), local.y);
    }
    this.handlePitch = THREE.MathUtils.lerp(this.handlePitch, pitch, Math.min(1, dt * 12));
    this.handle.rotation.set(0, 0, 0);
    this.handle.rotateY(yaw);
    this.handle.rotateX(-this.handlePitch);
    const key = w.load.map((s) => s.part).join(',');
    if (key !== this.loadKey) {
      this.loadKey = key;
      this.fillCargo(w.load.map((s) => s.part));
    }
  }

  /** Shrink each part to fit a slot in the bed: two across, four along. */
  private fillCargo(parts: string[], hx = WAGON.half[0], hz = WAGON.half[2], floor = 0.165) {
    this.cargo.clear();
    const cellX = hx;
    const cellZ = (hz * 2) / 4;
    parts.forEach((id, i) => {
      const g = partMesh(id);
      const box = new THREE.Box3().setFromObject(g);
      const size = box.getSize(new THREE.Vector3());
      const s = Math.min(1, (cellX * 0.95) / Math.max(size.x, size.z, 1e-3), 0.28 / Math.max(size.y, 1e-3));
      g.scale.setScalar(s);
      const col = i % 2;
      const row = Math.floor(i / 2) % 4;
      const layer = Math.floor(i / 8);
      const x = (col - 0.5) * cellX;
      const z = -hz + cellZ * (row + 0.5);
      const c = box.getCenter(new THREE.Vector3()).multiplyScalar(s);
      g.position.set(x - c.x, floor - box.min.y * s + layer * 0.1, z - c.z);
      this.cargo.add(g);
    });
  }
}

/** Keeps meshes in sync with the simulation. */
export class WorldView {
  root = new THREE.Group();
  items = new Map<number, THREE.Group>();
  machines = new Map<number, MachineView>();
  wagon = new WagonView();
  constructor(public sim: Simulation) {
    this.root.add(this.wagon.group);
  }

  sync(dt: number) {
    const sim = this.sim;
    this.wagon.update(sim, dt);
    for (const [id, it] of sim.items) {
      let g = this.items.get(id);
      if (!g) {
        g = partMesh(it.def.id);
        g.userData.itemId = id;
        this.items.set(id, g);
        this.root.add(g);
      }
      g.position.copy(toV(it.rb.translation()));
      g.quaternion.copy(toQ(it.rb.rotation()));
    }
    for (const [id, g] of this.items) if (!sim.items.has(id)) {
      g.removeFromParent();
      this.items.delete(id);
    }
    for (const [id, m] of sim.machines) {
      let v = this.machines.get(id);
      if (v && v.m !== m) {
        v.dispose();
        v = undefined;
      }
      if (!v) {
        v = new MachineView(m);
        this.machines.set(id, v);
        this.root.add(v.group);
      }
      v.update(dt);
    }
    for (const [id, v] of this.machines) if (!sim.machines.has(id)) {
      v.dispose();
      this.machines.delete(id);
    }
  }

  // ---- replay support: every moving thing, keyed so a reset machine still matches

  transforms(cb: (key: string, o: THREE.Object3D) => void) {
    cb('wagon', this.wagon.group);
    for (const [id, g] of this.items) cb(`i${id}`, g);
    for (const [mid, v] of this.machines) for (const [uid, g] of v.parts) cb(`m${mid}:${uid}`, g);
  }

  ropes(cb: (key: string, vis: LinkVisual, pts: THREE.Vector3[]) => void) {
    for (const [mid, v] of this.machines) {
      for (const l of v.m.links) {
        const vis = v.links.get(l.id);
        if (vis) cb(`m${mid}:L${l.partUid}:${l.fromTether ?? ''}`, vis, v.linkPoints(l));
      }
    }
  }
}
