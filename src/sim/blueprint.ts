import { Quaternion, Vector3 } from 'three';
import { getPart, PART_MAP, type JointKind, type PartDef, type V3 } from '../data/parts';
import {
  alignBasis,
  arr3,
  arr4,
  composePose,
  invertPose,
  obbBounds,
  obbPenetration,
  partOBBs,
  perpendicular,
  quat,
  transformPoint,
  v3,
  type Pose,
  type Q4,
} from './geom';

/**
 * A machine blueprint: what the kid built on the workbench. Machine space has
 * its origin on the bench top (y = 0 is the bench surface).
 */
export interface BPPart {
  uid: number;
  def: string;
  p: V3;
  q: Q4;
  settings?: PartSettings;
}

export interface PartSettings {
  reverse?: boolean;
  delay?: number;
  length?: number;
  /** How it was mounted, so moving it later starts from the same orientation. */
  mount?: string;
  spin?: number;
  tilt?: number;
}

export interface BPConnection {
  /** The part that was already there. */
  a: number;
  /** The part that was attached onto it. */
  b: number;
  kind: JointKind;
  anchor: V3; // machine space
  axis?: V3; // machine space
  tether?: number;
}

export interface BPLinkEnd {
  part: number;
  local: V3; // in the part's frame
  reel?: boolean;
}

export interface BPLink {
  part: number; // uid of the rope / bungee / spring part
  a: BPLinkEnd;
  b: BPLinkEnd;
}

export interface Blueprint {
  v: 1;
  name: string;
  nextUid: number;
  parts: BPPart[];
  connections: BPConnection[];
  links: BPLink[];
}

export interface Placement {
  def: string;
  pose: Pose;
  conn?: { target: number; kind: JointKind; anchor: Vector3; axis?: Vector3; tether?: number };
  valid: boolean;
  reason?: string;
  snapped?: string;
}

export interface AttachHit {
  part: number;
  point: Vector3; // machine space
  normal: Vector3; // machine space, out of the target surface
}

const GRID = 0.025;

/**
 * Tilt (second rotation axis): pitch the part about a line lying in the
 * contact surface, then lift it so it rests on its lowest edge instead of
 * sinking into what it sits on.
 */
function applyTilt(def: PartDef, q: Quaternion, p: Vector3, normal: Vector3, pivot: Vector3, spinDeg: number, tiltDeg: number): void {
  if (!tiltDeg) return;
  const ref = perpendicular(normal, new Vector3(0, 1, 0)).applyAxisAngle(normal, (spinDeg * Math.PI) / 180);
  const axis = new Vector3().crossVectors(normal, ref).normalize();
  const t = new Quaternion().setFromAxisAngle(axis, (tiltDeg * Math.PI) / 180);
  p.sub(pivot).applyQuaternion(t).add(pivot);
  q.premultiply(t);
  // Push back out along the normal until nothing is below the surface.
  let lowest = Infinity;
  for (const o of partOBBs(def, { p, q })) {
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
      const c = o.c.clone().addScaledVector(o.axes[0], sx * o.h[0]).addScaledVector(o.axes[1], sy * o.h[1]).addScaledVector(o.axes[2], sz * o.h[2]);
      lowest = Math.min(lowest, c.sub(pivot).dot(normal));
    }
  }
  if (lowest < 0.002) p.addScaledVector(normal, 0.002 - lowest);
}
const ALLOWED_TARGET_PEN = 0.03;
const ALLOWED_PEN = 0.012;

export function newBlueprint(name = 'Contraption'): Blueprint {
  return { v: 1, name, nextUid: 1, parts: [], connections: [], links: [] };
}

export function clone(bp: Blueprint): Blueprint {
  return JSON.parse(JSON.stringify(bp));
}

export function findPart(bp: Blueprint, uid: number): BPPart | undefined {
  return bp.parts.find((p) => p.uid === uid);
}

export function partPose(part: BPPart): Pose {
  return { p: v3(part.p), q: quat(part.q) };
}

export function socketUp(def: PartDef, socketId: string): Vector3 {
  const s = def.sockets.find((x) => x.id === socketId)!;
  if (s.up) return v3(s.up);
  return perpendicular(v3(s.normal));
}

function penetrationAgainst(bp: Blueprint, def: PartDef, at: Pose, skip: Set<number>): { uid: number; depth: number } {
  const mine = partOBBs(def, at, 0.004);
  const mb = obbBounds(mine);
  let worst = { uid: -1, depth: 0 };
  for (const other of bp.parts) {
    if (skip.has(other.uid)) continue;
    const odef = PART_MAP[other.def];
    if (!odef || odef.link) continue;
    const theirs = partOBBs(odef, partPose(other), 0.004);
    // Cheap box test first; most parts are nowhere near each other.
    const tb = obbBounds(theirs);
    if (tb.min.x > mb.max.x || tb.max.x < mb.min.x || tb.min.y > mb.max.y || tb.max.y < mb.min.y || tb.min.z > mb.max.z || tb.max.z < mb.min.z) continue;
    for (const a of mine) for (const b of theirs) {
      const d = obbPenetration(a, b);
      if (d > worst.depth) worst = { uid: other.uid, depth: d };
    }
  }
  return worst;
}

function checkOverlaps(bp: Blueprint, def: PartDef, at: Pose, target: number | null, ignoreTarget: boolean): string | undefined {
  const skip = new Set<number>();
  if (target !== null) skip.add(target);
  const others = penetrationAgainst(bp, def, at, skip);
  if (others.depth > ALLOWED_PEN) return 'Something is in the way';
  if (target !== null && !ignoreTarget) {
    const t = findPart(bp, target)!;
    const deep = penetrationAgainst({ ...bp, parts: [t] }, def, at, new Set());
    if (deep.depth > ALLOWED_TARGET_PEN) return 'That would go right through it';
  }
  return undefined;
}

/** Place a part loose on the bench (no attachment). */
export function placeFree(bp: Blueprint, defId: string, x: number, z: number, spinDeg = 0, socketId?: string, tiltDeg = 0): Placement {
  const def = getPart(defId);
  if (def.link) return { def: defId, pose: { p: new Vector3(x, 0, z), q: new Quaternion() }, valid: false, reason: 'Tie it between two things' };
  const socket = def.sockets.find((s) => s.id === socketId) ?? def.sockets[0];
  let q = new Quaternion();
  if (socket) {
    q = alignBasis(v3(socket.normal), socketUp(def, socket.id), new Vector3(0, -1, 0), new Vector3(0, 0, 1));
  }
  q.premultiply(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), (spinDeg * Math.PI) / 180));
  if (tiltDeg) applyTilt(def, q, new Vector3(), new Vector3(0, 1, 0), new Vector3(), spinDeg, tiltDeg);
  const b = obbBounds(partOBBs(def, { p: new Vector3(), q }));
  const p = new Vector3(x, -b.min.y + 0.001, z);
  const at = { p, q };
  const reason = checkOverlaps(bp, def, at, null, true);
  return { def: defId, pose: at, valid: !reason, reason };
}

function snapToGrid(localPoint: Vector3, localNormal: Vector3): Vector3 {
  const out = localPoint.clone();
  (['x', 'y', 'z'] as const).forEach((k) => {
    if (Math.abs(localNormal[k]) < 0.5) out[k] = Math.round(out[k] / GRID) * GRID;
  });
  return out;
}

/**
 * Work out where a part goes when pressed against `hit` using its socket.
 * Joint type falls out of the geometry: wheel hubs become axles, anything on
 * a motor shaft is driven, anything on a hinge leaf swings.
 */
export function computeAttach(bp: Blueprint, defId: string, socketId: string | undefined, hit: AttachHit, spinDeg = 0, tiltDeg = 0): Placement {
  const def = getPart(defId);
  const fail = (reason: string): Placement => ({ def: defId, pose: { p: hit.point.clone(), q: new Quaternion() }, valid: false, reason });
  if (def.link) return fail('Tie it between two things');
  const socket = def.sockets.find((s) => s.id === socketId) ?? def.sockets[0];
  if (!socket) return fail('It has nothing to attach with');
  const target = findPart(bp, hit.part);
  if (!target) return fail('Nothing there');
  const tdef = getPart(target.def);
  const tPose = partPose(target);

  let point = hit.point.clone();
  let normal = hit.normal.clone().normalize();
  let jointFromTarget: { kind: JointKind; pivot: Vector3; axis: Vector3; id: string } | undefined;

  for (const t of tdef.targets ?? []) {
    if (t.joint === 'reel') continue;
    const tp = transformPoint(tPose, v3(t.pos));
    if (tp.distanceTo(hit.point) <= (t.radius ?? 0.08)) {
      point = tp;
      normal = v3(t.normal).applyQuaternion(tPose.q).normalize();
      jointFromTarget = {
        kind: t.joint as JointKind,
        pivot: transformPoint(tPose, v3(t.pivot ?? t.pos)),
        axis: v3(t.axis ?? t.normal).applyQuaternion(tPose.q).normalize(),
        id: t.id,
      };
      break;
    }
  }
  if (!jointFromTarget) {
    const inv = invertPose(tPose);
    const lp = transformPoint(inv, point);
    const ln = normal.clone().applyQuaternion(inv.q);
    point = transformPoint(tPose, snapToGrid(lp, ln));
  }

  const ref = perpendicular(normal, new Vector3(0, 1, 0));
  let q = alignBasis(v3(socket.normal), socketUp(def, socket.id), normal.clone().negate(), ref);
  q.premultiply(new Quaternion().setFromAxisAngle(normal, (spinDeg * Math.PI) / 180));
  const p = point.clone().add(normal.clone().multiplyScalar(0.002)).sub(v3(socket.pos).applyQuaternion(q));
  // Parts on a special joint (shaft, hinge, axle) stay square to it.
  if (!jointFromTarget && socket.joint !== 'axle' && socket.joint !== 'tether') applyTilt(def, q, p, normal, point, spinDeg, tiltDeg);
  const at: Pose = { p, q };

  let conn: Placement['conn'];
  if (jointFromTarget) {
    conn = { target: target.uid, kind: jointFromTarget.kind, anchor: jointFromTarget.pivot, axis: jointFromTarget.axis };
  } else if (socket.joint === 'axle') {
    conn = { target: target.uid, kind: 'axle', anchor: point.clone(), axis: normal.clone() };
  } else if (socket.joint === 'tether') {
    conn = { target: target.uid, kind: 'tether', anchor: point.clone(), tether: socket.tether ?? 1 };
  } else {
    conn = { target: target.uid, kind: 'weld', anchor: point.clone() };
  }
  const reason = checkOverlaps(bp, def, at, target.uid, conn.kind === 'tether');
  return { def: defId, pose: at, conn, valid: !reason, reason, snapped: jointFromTarget?.id };
}

export function commitPlacement(bp: Blueprint, pl: Placement, settings?: PartSettings): number {
  if (!pl.valid) throw new Error(`Invalid placement: ${pl.reason}`);
  const uid = bp.nextUid++;
  const def = getPart(pl.def);
  const s: PartSettings = { ...settings };
  const timer = def.behaviors.find((b) => b.type === 'timer');
  if (timer && timer.type === 'timer' && s.delay === undefined) s.delay = timer.delay;
  bp.parts.push({ uid, def: pl.def, p: arr3(pl.pose.p), q: arr4(pl.pose.q), settings: Object.keys(s).length ? s : undefined });
  if (pl.conn) {
    bp.connections.push({
      a: pl.conn.target,
      b: uid,
      kind: pl.conn.kind,
      anchor: arr3(pl.conn.anchor),
      axis: pl.conn.axis ? arr3(pl.conn.axis) : undefined,
      tether: pl.conn.tether,
    });
  }
  return uid;
}

export interface LinkResult {
  ok: boolean;
  reason?: string;
  uid?: number;
}

function linkEnd(bp: Blueprint, end: { part: number; point: Vector3 }): BPLinkEnd {
  const part = findPart(bp, end.part)!;
  const def = getPart(part.def);
  const pp = partPose(part);
  let point = end.point.clone();
  let reel = false;
  for (const t of def.targets ?? []) {
    if (t.joint !== 'reel') continue;
    const tp = transformPoint(pp, v3(t.pos));
    if (tp.distanceTo(point) <= (t.radius ?? 0.1)) {
      point = tp;
      reel = true;
    }
  }
  const local = transformPoint(invertPose(pp), point);
  return { part: end.part, local: arr3(local), reel: reel || undefined };
}

export function linkWorldEnds(bp: Blueprint, link: BPLink): [Vector3, Vector3] {
  const pa = findPart(bp, link.a.part)!;
  const pb = findPart(bp, link.b.part)!;
  return [transformPoint(partPose(pa), v3(link.a.local)), transformPoint(partPose(pb), v3(link.b.local))];
}

/** Tie a rope / bungee / spring between two points on the machine. */
export function addLink(
  bp: Blueprint,
  defId: string,
  a: { part: number; point: Vector3 },
  b: { part: number; point: Vector3 },
): LinkResult {
  const def = getPart(defId);
  if (!def.link) return { ok: false, reason: 'That is not something you can tie' };
  if (!findPart(bp, a.part) || !findPart(bp, b.part)) return { ok: false, reason: 'Tie it to something' };
  if (a.part === b.part) return { ok: false, reason: 'Both ends on the same thing does nothing' };
  const ea = linkEnd(bp, a);
  const eb = linkEnd(bp, b);
  const tmp: BPLink = { part: -1, a: ea, b: eb };
  const [wa, wb] = linkWorldEnds(bp, tmp);
  const span = wa.distanceTo(wb);
  if (span > def.link.maxSpan) return { ok: false, reason: `Too far apart for a ${def.name.toLowerCase()}` };
  if (def.link.minLength && span < def.link.minLength) return { ok: false, reason: 'Too close together' };
  const uid = bp.nextUid++;
  const mid = wa.clone().add(wb).multiplyScalar(0.5);
  const settings: PartSettings = {};
  if (def.link.kind === 'rope') {
    const opts = def.link.lengthOptions ?? [def.link.length];
    settings.length = opts.find((o) => o >= span - 1e-6) ?? opts[opts.length - 1];
  }
  bp.parts.push({ uid, def: defId, p: arr3(mid), q: [0, 0, 0, 1], settings: Object.keys(settings).length ? settings : undefined });
  bp.links.push({ part: uid, a: ea, b: eb });
  return { ok: true, uid };
}

export function linkLength(bp: Blueprint, link: BPLink): number {
  const part = findPart(bp, link.part)!;
  const def = getPart(part.def);
  return part.settings?.length ?? def.link!.length;
}

/** Remove a part. Things attached to it stay where they are, loose. */
export function removePart(bp: Blueprint, uid: number): string[] {
  const removed: string[] = [];
  const p = findPart(bp, uid);
  if (!p) return removed;
  removed.push(p.def);
  bp.parts = bp.parts.filter((x) => x.uid !== uid);
  bp.connections = bp.connections.filter((c) => c.a !== uid && c.b !== uid);
  const dead = bp.links.filter((l) => l.part === uid || l.a.part === uid || l.b.part === uid);
  bp.links = bp.links.filter((l) => !dead.includes(l));
  for (const l of dead) {
    if (l.part !== uid) {
      const lp = findPart(bp, l.part);
      if (lp) {
        removed.push(lp.def);
        bp.parts = bp.parts.filter((x) => x.uid !== l.part);
      }
    }
  }
  return removed;
}

/** Groups of parts joined by connections (not by links). */
export function components(bp: Blueprint, connections: BPConnection[] = bp.connections): number[][] {
  const parent = new Map<number, number>();
  const solid = bp.parts.filter((p) => !getPart(p.def).link);
  for (const p of solid) parent.set(p.uid, p.uid);
  const find = (x: number): number => {
    while (parent.get(x) !== x) {
      const px = parent.get(x)!;
      parent.set(x, parent.get(px)!);
      x = px;
    }
    return x;
  };
  for (const c of connections) {
    if (!parent.has(c.a) || !parent.has(c.b)) continue;
    parent.set(find(c.a), find(c.b));
  }
  const groups = new Map<number, number[]>();
  for (const p of solid) {
    const r = find(p.uid);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r)!.push(p.uid);
  }
  return [...groups.values()];
}

export function blueprintMass(bp: Blueprint): number {
  return bp.parts.reduce((m, p) => m + getPart(p.def).mass, 0);
}

export function blueprintBounds(bp: Blueprint): { min: Vector3; max: Vector3 } {
  const obbs = bp.parts.filter((p) => !getPart(p.def).link).flatMap((p) => partOBBs(getPart(p.def), partPose(p)));
  if (!obbs.length) return { min: new Vector3(), max: new Vector3() };
  const b = obbBounds(obbs);
  for (const l of bp.links) {
    const [a, c] = linkWorldEnds(bp, l);
    b.min.min(a).min(c);
    b.max.max(a).max(c);
  }
  return b;
}

export interface Issue {
  severity: 'error' | 'warn';
  message: string;
  part?: number;
}

/** Sanity-check a whole blueprint (used before carrying it off the bench). */
export function validateBlueprint(bp: Blueprint): Issue[] {
  const issues: Issue[] = [];
  const uids = new Set(bp.parts.map((p) => p.uid));
  for (const p of bp.parts) if (!PART_MAP[p.def]) issues.push({ severity: 'error', message: `Unknown part ${p.def}`, part: p.uid });
  for (const c of bp.connections) {
    if (!uids.has(c.a) || !uids.has(c.b)) issues.push({ severity: 'error', message: 'Connection to a missing part' });
    if ((c.kind === 'hinge' || c.kind === 'axle' || c.kind === 'driven') && !c.axis) issues.push({ severity: 'error', message: 'Pivot without an axis' });
  }
  for (const l of bp.links) {
    if (!uids.has(l.a.part) || !uids.has(l.b.part) || !uids.has(l.part)) {
      issues.push({ severity: 'error', message: 'Loose rope end' });
      continue;
    }
    const def = getPart(findPart(bp, l.part)!.def);
    const [a, b] = linkWorldEnds(bp, l);
    if (def.link && a.distanceTo(b) > def.link.maxSpan + 1e-3) issues.push({ severity: 'error', message: `${def.name} stretched too far`, part: l.part });
  }
  // Powered parts with nothing to power them.
  for (const group of components(bp)) {
    const defs = group.map((u) => getPart(findPart(bp, u)!.def));
    const needs = defs.some((d) => d.behaviors.some((b) => b.type === 'motor' || b.type === 'winch' || b.type === 'suction' || (b.type === 'thrust' && b.watts)));
    const has = defs.some((d) => d.behaviors.some((b) => b.type === 'battery'));
    if (needs && !has) issues.push({ severity: 'warn', message: 'Something here needs a battery attached to it' });
  }
  return issues;
}

export function serialize(bp: Blueprint): string {
  return JSON.stringify(bp);
}

const isV3 = (x: unknown): x is V3 => Array.isArray(x) && x.length === 3 && x.every((n) => typeof n === 'number' && Number.isFinite(n));
const isQ4 = (x: unknown): x is Q4 => Array.isArray(x) && x.length === 4 && x.every((n) => typeof n === 'number' && Number.isFinite(n));

/** Parse untrusted JSON into a blueprint, dropping anything malformed. */
export function parseBlueprint(data: unknown): Blueprint | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  if (!Array.isArray(d.parts)) return null;
  const parts: BPPart[] = [];
  for (const raw of d.parts as unknown[]) {
    const p = raw as Record<string, unknown>;
    if (typeof p.uid !== 'number' || typeof p.def !== 'string' || !PART_MAP[p.def] || !isV3(p.p) || !isQ4(p.q)) continue;
    parts.push({ uid: p.uid, def: p.def, p: p.p, q: p.q, settings: typeof p.settings === 'object' && p.settings ? (p.settings as PartSettings) : undefined });
  }
  const uids = new Set(parts.map((p) => p.uid));
  const connections = (Array.isArray(d.connections) ? (d.connections as BPConnection[]) : []).filter(
    (c) => c && uids.has(c.a) && uids.has(c.b) && isV3(c.anchor) && ['weld', 'axle', 'hinge', 'driven', 'tether'].includes(c.kind),
  );
  const links = (Array.isArray(d.links) ? (d.links as BPLink[]) : []).filter(
    (l) => l && uids.has(l.part) && l.a && l.b && uids.has(l.a.part) && uids.has(l.b.part) && isV3(l.a.local) && isV3(l.b.local),
  );
  const maxUid = parts.reduce((m, p) => Math.max(m, p.uid), 0);
  return {
    v: 1,
    name: typeof d.name === 'string' ? d.name.slice(0, 40) : 'Contraption',
    nextUid: Math.max(typeof d.nextUid === 'number' ? d.nextUid : 1, maxUid + 1),
    parts,
    connections,
    links,
  };
}

/**
 * Convenience builder for scripted machines (tests, sandbox presets).
 * Uses exactly the same placement rules as the touch UI.
 */
export class Builder {
  bp: Blueprint;
  constructor(name = 'Contraption') {
    this.bp = newBlueprint(name);
  }
  free(def: string, x = 0, z = 0, spin = 0, socket?: string, settings?: PartSettings): number {
    const pl = placeFree(this.bp, def, x, z, spin, socket);
    if (!pl.valid) throw new Error(`${def}: ${pl.reason}`);
    return commitPlacement(this.bp, pl, settings);
  }
  /** Attach onto a point given in the target part's local frame. */
  on(def: string, socket: string | undefined, target: number, localPoint: V3, localNormal: V3, spin = 0, settings?: PartSettings): number {
    const t = findPart(this.bp, target)!;
    const tp = partPose(t);
    const hit: AttachHit = {
      part: target,
      point: transformPoint(tp, v3(localPoint)),
      normal: v3(localNormal).applyQuaternion(tp.q).normalize(),
    };
    const pl = computeAttach(this.bp, def, socket, hit, spin);
    if (!pl.valid) throw new Error(`${def}: ${pl.reason}`);
    return commitPlacement(this.bp, pl, settings);
  }
  /** Attach into a named target socket (motor shaft, hinge leaf...). */
  into(def: string, socket: string | undefined, target: number, targetId: string, spin = 0): number {
    const t = findPart(this.bp, target)!;
    const tdef = getPart(t.def);
    const ts = tdef.targets!.find((x) => x.id === targetId)!;
    return this.on(def, socket, target, ts.pos, ts.normal, spin);
  }
  link(def: string, a: number, aLocal: V3, b: number, bLocal: V3, length?: number): number {
    const pa = partPose(findPart(this.bp, a)!);
    const pb = partPose(findPart(this.bp, b)!);
    const r = addLink(this.bp, def, { part: a, point: transformPoint(pa, v3(aLocal)) }, { part: b, point: transformPoint(pb, v3(bLocal)) });
    if (!r.ok) throw new Error(`${def}: ${r.reason}`);
    if (length !== undefined) findPart(this.bp, r.uid!)!.settings = { length };
    return r.uid!;
  }
  set(uid: number, settings: PartSettings): this {
    const p = findPart(this.bp, uid)!;
    p.settings = { ...p.settings, ...settings };
    return this;
  }
  pose(uid: number): Pose {
    return partPose(findPart(this.bp, uid)!);
  }
}

export { composePose };
