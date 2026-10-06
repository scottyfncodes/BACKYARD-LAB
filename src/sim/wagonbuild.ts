import { Vector3 } from 'three';
import { getPart, type V3 } from '../data/parts';
import { findPart, partPose, type Blueprint } from './blueprint';
import { obbBounds, partOBBs } from './geom';

/**
 * MISSION 0: is what's on the bench a wagon yet?
 *
 * A wagon is read off the geometry, never off a recipe: something to carry
 * stuff on, wheels that spin on axles, spread out so it doesn't tip, holding
 * the body up off the ground, and something long to pull it by. Each of those
 * becomes a plain-words note on the bench, so the kid discovers the parts of a
 * wagon by building one rather than by reading instructions.
 */
export interface WagonNote {
  id: 'body' | 'wheels' | 'spread' | 'rolls' | 'handle';
  done: boolean;
  text: string;
}

export interface WagonCheck {
  body: number | null;
  /** Wheels spinning on an axle (or a motor shaft). */
  wheels: number;
  /** Wheel parts stuck on flat, so they can't spin. */
  stuckWheels: number;
  spread: boolean;
  rolls: boolean;
  handle: number | null;
  ok: boolean;
  notes: WagonNote[];
}

/** How a finished wagon blueprint maps onto the pull-along wagon the simulation knows how to tow. */
export interface WagonFrame {
  /** Rotate the blueprint by this (about Y) so the handle points to local -Z. */
  yaw: number;
  /** Horizontal centre of the bed, in blueprint space. */
  center: V3;
  /** Lowest point of the blueprint (the wheels' bottoms). */
  minY: number;
  /** Collider half extents (bed only, no handle), wagon space. */
  half: V3;
  /** Top of the bed above the ground, and its half footprint, for stacking cargo. */
  bedTop: number;
  bedHalf: [number, number];
  /** Kid-centre to wagon-centre distance that keeps the handle in hand. */
  tow: number;
  /** Wheel parts and the axis they spin about, in each part's own frame. */
  wheels: { uid: number; axis: V3; r: number }[];
}

const MIN_WHEELS = 3;

export const isWheel = (defId: string) => getPart(defId).sockets.some((s) => s.joint === 'axle');

/** On an axle (or a motor shaft) that lies flat enough to roll on. A vertical axle is a turntable, not a wheel. */
function rollsOnAxle(bp: Blueprint, uid: number): boolean {
  return bp.connections.some((c) => (c.b === uid || c.a === uid) && (c.kind === 'axle' || c.kind === 'driven') && !!c.axis && Math.abs(c.axis[1]) < 0.5);
}

interface PartGeo {
  uid: number;
  def: string;
  bottom: number;
  center: Vector3;
  corners: Vector3[];
}

function geo(bp: Blueprint): PartGeo[] {
  const out: PartGeo[] = [];
  for (const p of bp.parts) {
    const def = getPart(p.def);
    if (def.link) continue;
    const obbs = partOBBs(def, partPose(p));
    const b = obbBounds(obbs);
    const corners: Vector3[] = [];
    for (const o of obbs) {
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
        corners.push(o.c.clone().addScaledVector(o.axes[0], sx * o.h[0]).addScaledVector(o.axes[1], sy * o.h[1]).addScaledVector(o.axes[2], sz * o.h[2]));
      }
    }
    out.push({ uid: p.uid, def: p.def, bottom: b.min.y, center: b.min.clone().add(b.max).multiplyScalar(0.5), corners });
  }
  return out;
}

/** The axis a wheel spins about, in blueprint space. */
function wheelAxis(bp: Blueprint, uid: number): Vector3 {
  const c = bp.connections.find((x) => (x.b === uid || x.a === uid) && x.axis);
  if (c?.axis) return new Vector3(...c.axis).setY(0).normalize();
  const p = findPart(bp, uid)!;
  const hub = getPart(p.def).sockets.find((s) => s.joint === 'axle')!;
  return new Vector3(...hub.normal).applyQuaternion(partPose(p).q).setY(0).normalize();
}

function horizontalRadius(g: PartGeo, from: Vector3): number {
  let r = 0;
  for (const c of g.corners) r = Math.max(r, Math.hypot(c.x - from.x, c.z - from.z));
  return r;
}

export function wagonCheck(bp: Blueprint): WagonCheck {
  const parts = geo(bp);
  const notes: WagonNote[] = [];
  const name = (uid: number) => getPart(findPart(bp, uid)!.def).name;
  const wheelParts = parts.filter((g) => isWheel(g.def));
  const spinning = wheelParts.filter((g) => rollsOnAxle(bp, g.uid));
  const stuckWheels = wheelParts.length - spinning.length;
  const bodies = parts.filter((g) => !isWheel(g.def));

  // The body: whatever the most wheels hang off (a wheel on a motor on a plank still counts for the plank).
  let body: PartGeo | null = null;
  if (bodies.length) {
    const score = new Map<number, number>();
    for (const w of spinning) {
      let host: number | null = null;
      // Walk up from the wheel to the first non-wheel, non-motor part it hangs off.
      let cur = w.uid;
      for (let hops = 0; hops < 4 && host === null; hops++) {
        const c = bp.connections.find((x) => x.b === cur);
        if (!c) break;
        const d = getPart(findPart(bp, c.a)!.def);
        if (!isWheel(d.id) && !d.behaviors.some((b) => b.type === 'motor')) host = c.a;
        else cur = c.a;
      }
      if (host !== null) score.set(host, (score.get(host) ?? 0) + 1);
    }
    const byMass = (g: PartGeo) => getPart(g.def).mass;
    body = bodies.reduce((best, g) => {
      const s = score.get(g.uid) ?? 0;
      const bs = best ? score.get(best.uid) ?? 0 : -1;
      return !best || s > bs || (s === bs && byMass(g) > byMass(best)) ? g : best;
    }, null as PartGeo | null);
  }
  notes.push({ id: 'body', done: !!body, text: body ? `Something to carry stuff on: the ${name(body.uid).toLowerCase()}.` : 'It needs something to carry stuff on. A plank, a crate…' });

  // Wheels.
  const n = spinning.length;
  notes.push({
    id: 'wheels',
    done: n >= MIN_WHEELS,
    text:
      n >= MIN_WHEELS
        ? `${n} wheels, spinning on axles.`
        : stuckWheels && !n
          ? 'That wheel is lying flat, like a record. It can spin, but it can’t roll. Press its hub against the SIDE of something.'
          : n
            ? `${n} wheel${n === 1 ? '' : 's'} spinning so far. It wants at least ${MIN_WHEELS}, probably 4.`
            : 'Wheels spin on axles. A wheel’s hub pressed onto the side of something becomes an axle.',
  });

  // Spread: wheels on both sides and at both ends, so it doesn't tip.
  let spread = false;
  if (body && n >= 2) {
    const side = wheelAxis(bp, spinning[0].uid);
    const fwd = new Vector3(-side.z, 0, side.x);
    let l = 0;
    let r = 0;
    let f = 0;
    let b = 0;
    for (const w of spinning) {
      const rel = w.center.clone().sub(body.center);
      const s = rel.dot(side);
      const t = rel.dot(fwd);
      if (s > 0.03) r++;
      if (s < -0.03) l++;
      if (t > 0.06) f++;
      if (t < -0.06) b++;
    }
    spread = l > 0 && r > 0 && f > 0 && b > 0;
    notes.push({
      id: 'spread',
      done: spread,
      text: spread ? 'Wheels at both ends and both sides: it won’t tip.' : !l || !r ? 'All the wheels are on one side. It’ll tip right over.' : 'The wheels are all at one end. Spread them out: some at the front, some at the back.',
    });
  }

  // Handle: something long sticking out past the body to pull it by.
  let handle: PartGeo | null = null;
  if (body) {
    const bodyR = horizontalRadius(body, body.center);
    for (const g of bodies) {
      if (g.uid === body.uid) continue;
      const reach = horizontalRadius(g, body.center);
      if (reach >= bodyR + 0.35 && (!handle || reach > horizontalRadius(handle, body.center))) handle = g;
    }
  }

  // Rolls: the wheels are the lowest thing, holding everything else up.
  let rolls = false;
  if (n >= 1) {
    const wheelBottom = Math.min(...spinning.map((g) => g.bottom));
    // The handle may rest on the ground when parked, like a real wagon's; everything else rides on the wheels.
    const lowestOther = Math.min(Infinity, ...parts.filter((g) => !isWheel(g.def) && g !== handle).map((g) => g.bottom));
    rolls = lowestOther >= wheelBottom + 0.015;
    if (!rolls && n >= 2) notes.push({ id: 'rolls', done: false, text: 'The body is dragging on the ground. The wheels have to hold it up: mount them lower down.' });
    else if (rolls && n >= 2) notes.push({ id: 'rolls', done: true, text: 'The body sits up on its wheels.' });
  }

  notes.push({ id: 'handle', done: !!handle, text: handle ? `A handle to pull it by: the ${name(handle.uid).toLowerCase()}.` : 'A handle gives me something to pull. Something long, stuck on one end.' });

  const ok = !!body && n >= MIN_WHEELS && spread && rolls && !!handle;
  return { body: body?.uid ?? null, wheels: n, stuckWheels, spread, rolls, handle: handle?.uid ?? null, ok, notes };
}

/** Where everything sits on a finished wagon, so the simulation can tow it and stack cargo on it. */
export function wagonFrame(bp: Blueprint): WagonFrame {
  const check = wagonCheck(bp);
  const parts = geo(bp);

  const handle = parts.find((g) => g.uid === check.handle) ?? null;
  // Wheels' bottoms sit on the ground (the handle may hang a little lower when parked).
  const wheelParts = parts.filter((g) => isWheel(g.def) && check.wheels > 0);
  const minY = Math.min(...(wheelParts.length ? wheelParts : parts).map((g) => g.bottom));
  // The bed: everything except the handle.
  const bed = parts.filter((g) => g !== handle).flatMap((g) => g.corners);
  const bmin = new Vector3(Infinity, Infinity, Infinity);
  const bmax = new Vector3(-Infinity, -Infinity, -Infinity);
  for (const c of bed) {
    bmin.min(c);
    bmax.max(c);
  }
  const center = bmin.clone().add(bmax).multiplyScalar(0.5);
  center.y = 0;
  // Handle direction, so it ends up at local -Z (the end the kid holds).
  let h = handle ? handle.center.clone().sub(center).setY(0) : new Vector3(0, 0, -1);
  if (handle) {
    for (const c of handle.corners) {
      const d = c.clone().sub(center).setY(0);
      if (d.length() > h.length()) h = d;
    }
  }
  if (h.lengthSq() < 1e-6) h = new Vector3(0, 0, -1);
  h.normalize();
  const yaw = Math.atan2(h.x, -h.z);
  // Bed extents in wagon space (rotated by yaw).
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  let hx = 0;
  let hz = 0;
  for (const c of bed) {
    const dx = c.x - center.x;
    const dz = c.z - center.z;
    hx = Math.max(hx, Math.abs(dx * cos + dz * sin));
    hz = Math.max(hz, Math.abs(-dx * sin + dz * cos));
  }
  const bedTop = bmax.y - minY;

  let reach = 0;
  if (handle) for (const c of handle.corners) reach = Math.max(reach, Math.hypot(c.x - center.x, c.z - center.z));
  const wheels = bp.parts
    .filter((p) => isWheel(p.def))
    .map((p) => {
      const hub = getPart(p.def).sockets.find((s) => s.joint === 'axle')!;
      const r = Math.max(...getPart(p.def).shapes.map((s) => s.r ?? 0.1));
      return { uid: p.uid, axis: hub.normal, r };
    });
  return {
    yaw,
    center: [center.x, 0, center.z],
    minY,
    half: [Math.max(0.12, hx), Math.max(0.08, bedTop / 2), Math.max(0.12, hz)],
    bedTop,
    bedHalf: [Math.max(0.12, hx * 0.9), Math.max(0.12, hz * 0.9)],
    tow: Math.max(1.3, reach + 0.3),
    wheels,
  };
}
