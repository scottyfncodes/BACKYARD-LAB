import { Vector3 } from 'three';
import { getPart } from '../data/parts';
import { partPose, type Blueprint } from '../sim/blueprint';
import { composePose, shapeLocalPose, transformPoint, v3 } from '../sim/geom';

/**
 * "Invisible Lego": a finite set of places a part can click onto. Aiming
 * jumps between these instead of sliding around freely.
 */
export interface Stud {
  /** Part it sits on, or null for the bench top. */
  part: number | null;
  point: Vector3; // machine space
  normal: Vector3; // out of the surface
  /** Named joint point (motor shaft, hinge leaf, winch drum). */
  special?: string;
}

const STEP = 0.15;

function spread(half: number, max: number): number[] {
  const n = Math.max(1, Math.min(max, Math.round((half * 2) / STEP)));
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(-half + (half * 2 * (i + 0.5)) / n);
  return out;
}

export function generateStuds(bp: Blueprint, opts: { forLink: boolean; bench: { x: number; z: number; step?: number } }): Stud[] {
  const studs: Stud[] = [];
  // Special joint points first, so they win when de-duplicating.
  for (const p of bp.parts) {
    const def = getPart(p.def);
    if (def.link) continue;
    const pose = partPose(p);
    for (const t of def.targets ?? []) {
      if ((t.joint === 'reel') !== opts.forLink) continue;
      studs.push({ part: p.uid, point: transformPoint(pose, v3(t.pos)), normal: v3(t.normal).applyQuaternion(pose.q).normalize(), special: t.id });
    }
  }
  for (const p of bp.parts) {
    const def = getPart(p.def);
    if (def.link) continue;
    const pose = partPose(p);
    for (const s of def.shapes) {
      const sp = composePose(pose, shapeLocalPose(s));
      const add = (local: Vector3, n: Vector3) => {
        const point = transformPoint(sp, local);
        const normal = n.clone().applyQuaternion(sp.q).normalize();
        // Faces pressed flat against the bench are not reachable.
        if (point.y < 0.01 && normal.y < -0.5) return;
        studs.push({ part: p.uid, point, normal });
      };
      if (s.kind === 'box') {
        const h = s.half!;
        for (let ax = 0; ax < 3; ax++) {
          const [j, k] = [(ax + 1) % 3, (ax + 2) % 3];
          for (const sign of [-1, 1]) {
            for (const a of spread(h[j], 5)) {
              for (const b of spread(h[k], 5)) {
                const local = new Vector3();
                local.setComponent(ax, sign * h[ax]);
                local.setComponent(j, a);
                local.setComponent(k, b);
                const n = new Vector3();
                n.setComponent(ax, sign);
                add(local, n);
              }
            }
          }
        }
      } else if (s.kind === 'cyl') {
        const ax = s.axis === 'x' ? 0 : s.axis === 'z' ? 2 : 1;
        const [j, k] = [(ax + 1) % 3, (ax + 2) % 3];
        for (const sign of [-1, 1]) {
          const local = new Vector3();
          local.setComponent(ax, sign * s.halfH!);
          const n = new Vector3();
          n.setComponent(ax, sign);
          add(local, n);
        }
        for (const along of spread(s.halfH!, 5)) {
          for (let i = 0; i < 4; i++) {
            const ang = (i / 4) * Math.PI * 2;
            const n = new Vector3();
            n.setComponent(j, Math.cos(ang));
            n.setComponent(k, Math.sin(ang));
            const local = n.clone().multiplyScalar(s.r!);
            local.setComponent(ax, along);
            add(local, n);
          }
        }
      } else {
        for (let ax = 0; ax < 3; ax++) {
          for (const sign of [-1, 1]) {
            const n = new Vector3();
            n.setComponent(ax, sign);
            add(n.clone().multiplyScalar(s.r!), n);
          }
        }
      }
    }
  }
  if (!opts.forLink) {
    // A grid centred on the mat, like the studs on a baseplate.
    const step = opts.bench.step ?? 0.1;
    const nx = Math.floor(opts.bench.x / step + 1e-6);
    const nz = Math.floor(opts.bench.z / step + 1e-6);
    for (let ix = -nx; ix <= nx; ix++) {
      for (let iz = -nz; iz <= nz; iz++) {
        studs.push({ part: null, point: new Vector3(ix * step, 0, iz * step), normal: new Vector3(0, 1, 0) });
      }
    }
  }
  // Drop near-duplicates on the same part (keeps the special points).
  const out: Stud[] = [];
  for (const s of studs) {
    if (out.some((o) => o.part === s.part && o.point.distanceTo(s.point) < 0.03 && o.normal.dot(s.normal) > 0.7)) continue;
    out.push(s);
  }
  return out;
}

/**
 * Pick the stud to jump to from `from` (screen space) when pushing the d-pad
 * in `dir`: roughly that way, nearest first.
 */
export function rankInDirection(from: { x: number; y: number }, dir: { x: number; y: number }, candidates: { i: number; x: number; y: number }[]): number[] {
  const len = Math.hypot(dir.x, dir.y) || 1;
  const dx = dir.x / len;
  const dy = dir.y / len;
  return candidates
    .map((c) => {
      const vx = c.x - from.x;
      const vy = c.y - from.y;
      const along = vx * dx + vy * dy;
      const perp = Math.abs(vx * dy - vy * dx);
      return { i: c.i, along, score: along + perp * 2.2 };
    })
    .filter((c) => c.along > 6 && c.score < c.along * 3.5 + 40)
    .sort((a, b) => a.score - b.score)
    .map((c) => c.i);
}
