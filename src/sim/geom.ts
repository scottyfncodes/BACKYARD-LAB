import { Euler, Matrix4, Quaternion, Vector3 } from 'three';
import type { PartDef, ShapeDef, V3 } from '../data/parts';

export type Q4 = [number, number, number, number];

export const v3 = (a: V3 | Vector3): Vector3 => (a instanceof Vector3 ? a.clone() : new Vector3(a[0], a[1], a[2]));
export const arr3 = (v: Vector3): V3 => [v.x, v.y, v.z];
export const arr4 = (q: Quaternion): Q4 => [q.x, q.y, q.z, q.w];
export const quat = (q: Q4): Quaternion => new Quaternion(q[0], q[1], q[2], q[3]);
export const DEG = Math.PI / 180;

export function eulerDeg(e: V3 | undefined): Quaternion {
  if (!e) return new Quaternion();
  return new Quaternion().setFromEuler(new Euler(e[0] * DEG, e[1] * DEG, e[2] * DEG));
}

export interface Pose {
  p: Vector3;
  q: Quaternion;
}

export const pose = (p: Vector3 = new Vector3(), q: Quaternion = new Quaternion()): Pose => ({ p, q });

export function composePose(a: Pose, b: Pose): Pose {
  return { p: b.p.clone().applyQuaternion(a.q).add(a.p), q: a.q.clone().multiply(b.q) };
}

export function invertPose(a: Pose): Pose {
  const qi = a.q.clone().invert();
  return { p: a.p.clone().negate().applyQuaternion(qi), q: qi };
}

export function transformPoint(a: Pose, p: Vector3): Vector3 {
  return p.clone().applyQuaternion(a.q).add(a.p);
}

export function poseMatrix(a: Pose): Matrix4 {
  return new Matrix4().compose(a.p, a.q, new Vector3(1, 1, 1));
}

/** Oriented box used for overlap tests and bounds. */
export interface OBB {
  c: Vector3;
  axes: [Vector3, Vector3, Vector3];
  h: V3;
}

export function shapeLocalPose(s: ShapeDef): Pose {
  return { p: v3(s.pos ?? [0, 0, 0]), q: eulerDeg(s.rot) };
}

/** Half extents of a shape in its own frame. */
export function shapeHalf(s: ShapeDef): V3 {
  if (s.kind === 'box') return s.half!;
  if (s.kind === 'ball') return [s.r!, s.r!, s.r!];
  const r = s.r!;
  const h = s.halfH!;
  const ax = s.axis ?? 'y';
  return ax === 'x' ? [h, r, r] : ax === 'z' ? [r, r, h] : [r, h, r];
}

export function shapeVolume(s: ShapeDef): number {
  if (s.kind === 'box') return 8 * s.half![0] * s.half![1] * s.half![2];
  if (s.kind === 'ball') return (4 / 3) * Math.PI * s.r! ** 3;
  return Math.PI * s.r! ** 2 * 2 * s.halfH!;
}

export function partOBBs(def: PartDef, at: Pose, shrink = 0): OBB[] {
  return def.shapes.map((s) => {
    const sp = composePose(at, shapeLocalPose(s));
    const h = shapeHalf(s);
    const axes: [Vector3, Vector3, Vector3] = [
      new Vector3(1, 0, 0).applyQuaternion(sp.q),
      new Vector3(0, 1, 0).applyQuaternion(sp.q),
      new Vector3(0, 0, 1).applyQuaternion(sp.q),
    ];
    return { c: sp.p, axes, h: [Math.max(0.001, h[0] - shrink), Math.max(0.001, h[1] - shrink), Math.max(0.001, h[2] - shrink)] };
  });
}

/** Penetration depth between two OBBs (0 when separated), via SAT. */
export function obbPenetration(a: OBB, b: OBB): number {
  const d = b.c.clone().sub(a.c);
  const axes: Vector3[] = [...a.axes, ...b.axes];
  for (const x of a.axes) for (const y of b.axes) {
    const c = new Vector3().crossVectors(x, y);
    if (c.lengthSq() > 1e-8) axes.push(c.normalize());
  }
  let min = Infinity;
  for (const L of axes) {
    const ra = a.h[0] * Math.abs(a.axes[0].dot(L)) + a.h[1] * Math.abs(a.axes[1].dot(L)) + a.h[2] * Math.abs(a.axes[2].dot(L));
    const rb = b.h[0] * Math.abs(b.axes[0].dot(L)) + b.h[1] * Math.abs(b.axes[1].dot(L)) + b.h[2] * Math.abs(b.axes[2].dot(L));
    const overlap = ra + rb - Math.abs(d.dot(L));
    if (overlap <= 0) return 0;
    if (overlap < min) min = overlap;
  }
  return min;
}

export function obbBounds(obbs: OBB[]): { min: Vector3; max: Vector3 } {
  const min = new Vector3(Infinity, Infinity, Infinity);
  const max = new Vector3(-Infinity, -Infinity, -Infinity);
  for (const o of obbs) {
    const ext = new Vector3();
    for (let i = 0; i < 3; i++) {
      ext.x += Math.abs(o.axes[i].x) * o.h[i];
      ext.y += Math.abs(o.axes[i].y) * o.h[i];
      ext.z += Math.abs(o.axes[i].z) * o.h[i];
    }
    min.min(o.c.clone().sub(ext));
    max.max(o.c.clone().add(ext));
  }
  return { min, max };
}

/** Rough frontal area of a part (used for airflow / suction exposure). */
export function partArea(def: PartDef): number {
  const b = obbBounds(partOBBs(def, pose()));
  const s = b.max.clone().sub(b.min).toArray().sort((x, y) => y - x);
  return s[0] * s[1] * 0.7;
}

/** A quaternion that rotates unit vector `from` onto unit vector `to`. */
export function rotateOnto(from: Vector3, to: Vector3): Quaternion {
  return new Quaternion().setFromUnitVectors(from.clone().normalize(), to.clone().normalize());
}

/** Build a rotation mapping local basis (n, u) onto world basis (N, U). */
export function alignBasis(nLocal: Vector3, uLocal: Vector3, nWorld: Vector3, uWorld: Vector3): Quaternion {
  const n1 = nLocal.clone().normalize();
  const u1 = uLocal.clone().sub(n1.clone().multiplyScalar(uLocal.dot(n1))).normalize();
  const w1 = new Vector3().crossVectors(n1, u1);
  const n2 = nWorld.clone().normalize();
  const u2 = uWorld.clone().sub(n2.clone().multiplyScalar(uWorld.dot(n2))).normalize();
  const w2 = new Vector3().crossVectors(n2, u2);
  const m1 = new Matrix4().makeBasis(n1, u1, w1);
  const m2 = new Matrix4().makeBasis(n2, u2, w2);
  const r = m2.multiply(m1.transpose());
  return new Quaternion().setFromRotationMatrix(r);
}

/** Any unit vector perpendicular to n, preferring `pref` projected. */
export function perpendicular(n: Vector3, pref = new Vector3(0, 1, 0)): Vector3 {
  const p = pref.clone().sub(n.clone().multiplyScalar(pref.dot(n)));
  if (p.lengthSq() < 1e-4) {
    const alt = Math.abs(n.z) < 0.9 ? new Vector3(0, 0, 1) : new Vector3(1, 0, 0);
    p.copy(alt).sub(n.clone().multiplyScalar(alt.dot(n)));
  }
  return p.normalize();
}
