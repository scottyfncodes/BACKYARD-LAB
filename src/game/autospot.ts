import { Matrix4, Quaternion, Vector3 } from 'three';
import { getPart } from '../data/parts';
import { inZone } from '../data/world';
import { blueprintBounds, partPose, type Blueprint } from '../sim/blueprint';
import { partOBBs } from '../sim/geom';
import type { MachinePlacement } from '../sim/machine';
import { GROUP, groups, RAPIER } from '../sim/physics';
import type { Simulation } from '../sim/simulation';

/**
 * GO FOR IT: set the machine down at the problem by itself, so the step from
 * "built it" to "let's see" is one tap. Nobody has to carry it there.
 */
export interface Area {
  /** Where the machine should work from: in front of the gap, under the kite... */
  approach: Vector3;
  /** Where the kid stands to watch. */
  site: Vector3;
  /** What it is after, if anything. */
  target: Vector3 | null;
  /** The machine has to stay in here (our own yard). */
  zone?: string;
}

/** Does the machine overlap walls, fences, trees...? */
export function machineFits(sim: Simulation, bp: Blueprint, pl: MachinePlacement): boolean {
  const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), pl.yaw);
  const base = new Vector3(...pl.pos);
  for (const p of bp.parts) {
    const def = getPart(p.def);
    if (def.link) continue;
    const pp = partPose(p);
    const wp = { p: pp.p.clone().applyQuaternion(q).add(base), q: q.clone().multiply(pp.q) };
    for (const o of partOBBs(def, wp, 0.015)) {
      const rot = new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(o.axes[0], o.axes[1], o.axes[2]));
      let hit = false;
      sim.physics.world.intersectionsWithShape(
        { x: o.c.x, y: o.c.y + 0.02, z: o.c.z },
        { x: rot.x, y: rot.y, z: rot.z, w: rot.w },
        new RAPIER.Cuboid(o.h[0], o.h[1], o.h[2]),
        () => {
          hit = true;
          return false;
        },
        undefined,
        groups(0xffff, GROUP.STATIC),
      );
      if (hit) return false;
    }
  }
  return true;
}

/** Which way the machine "faces": where its vacuum / fan blows, or its RC brain points; else +z. */
export function machineFront(bp: Blueprint): Vector3 {
  for (const p of bp.parts) {
    const def = getPart(p.def);
    const air = def.behaviors.find((b) => b.type === 'suction' || b.type === 'airflow');
    if (air && (air.type === 'suction' || air.type === 'airflow')) {
      const v = new Vector3(...air.axis).applyQuaternion(partPose(p).q).setY(0);
      if (v.length() > 0.3) return v.normalize();
    }
  }
  const rx = bp.parts.find((p) => getPart(p.def).behaviors.some((b) => b.type === 'receiver'));
  if (rx) {
    const v = new Vector3(0, 0, 1).applyQuaternion(partPose(rx).q).setY(0);
    if (v.length() > 0.3) return v.normalize();
  }
  return new Vector3(0, 0, 1);
}

const flat = (v: Vector3) => v.clone().setY(0);

/** How far the machine's furthest corner gets past the approach point, toward the target (m). */
function reach(bp: Blueprint, pl: MachinePlacement, approach: Vector3, away: Vector3): number {
  const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), pl.yaw);
  const base = new Vector3(...pl.pos);
  let most = -Infinity;
  for (const p of bp.parts) {
    const def = getPart(p.def);
    if (def.link) continue;
    const pp = partPose(p);
    const wp = { p: pp.p.clone().applyQuaternion(q).add(base), q: q.clone().multiply(pp.q) };
    for (const o of partOBBs(def, wp)) {
      for (let i = 0; i < 8; i++) {
        const c = o.c.clone();
        for (let k = 0; k < 3; k++) c.addScaledVector(o.axes[k], (i >> k) & 1 ? o.h[k] : -o.h[k]);
        most = Math.max(most, -c.sub(approach).dot(away));
      }
    }
  }
  return most;
}

/**
 * Face the target and sit as close to the approach point as the machine fits,
 * backing off along the line away from the target until it does.
 */
export function autoSpot(sim: Simulation, bp: Blueprint, area: Area): MachinePlacement | null {
  let away = flat(area.approach.clone().sub(area.target ?? area.site));
  if (away.length() < 0.1) away = flat(area.site.clone().sub(area.approach));
  if (away.length() < 1e-3) away.set(0, 0, 1);
  away.normalize();
  const face = area.target ? flat(area.target.clone().sub(area.approach)) : away.clone().negate();
  if (face.length() < 0.1) face.copy(away).negate();
  const front = machineFront(bp);
  const yaw = Math.atan2(face.x, face.z) - Math.atan2(front.x, front.z);
  const b = blueprintBounds(bp);
  const mid = b.min.clone().add(b.max).multiplyScalar(0.5).setY(0).applyAxisAngle(new Vector3(0, 1, 0), yaw);
  for (let d = 0; d <= 4; d += 0.1) {
    const c = area.approach.clone().addScaledVector(away, d);
    if (area.zone && !inZone({ x: c.x, y: 0.5, z: c.z }, area.zone)) continue;
    const down = sim.physics.raycast(new Vector3(c.x, 3, c.z), new Vector3(0, -1, 0), 6, groups(0xffff, GROUP.STATIC), undefined, (col) => {
      const t = sim.physics.tags.get(col.handle);
      return !t || t.owner.kind === 'static';
    });
    const ground = down && down.point.y < 1 ? down.point.y : 0;
    const pl: MachinePlacement = { pos: [c.x - mid.x, ground - b.min.y + 0.01, c.z - mid.z], yaw };
    // All of it stays on our side: nothing poking through the gap or under the shed.
    if (reach(bp, pl, area.approach, away) > -0.1) continue;
    if (machineFits(sim, bp, pl)) return pl;
  }
  return null;
}
