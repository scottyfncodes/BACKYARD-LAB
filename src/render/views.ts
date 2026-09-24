import * as THREE from 'three';
import { getPart } from '../data/parts';
import { findPart, linkWorldEnds, partPose, type Blueprint } from '../sim/blueprint';
import type { MachineInstance, LinkRt } from '../sim/machine';
import { toQ, toV } from '../sim/physics';
import type { Simulation } from '../sim/simulation';
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

/** Keeps meshes in sync with the simulation. */
export class WorldView {
  root = new THREE.Group();
  items = new Map<number, THREE.Group>();
  machines = new Map<number, MachineView>();
  constructor(public sim: Simulation) {}

  sync(dt: number) {
    const sim = this.sim;
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
