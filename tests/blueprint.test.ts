import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import {
  addLink,
  Builder,
  components,
  computeAttach,
  findPart,
  newBlueprint,
  parseBlueprint,
  partPose,
  placeFree,
  removePart,
  serialize,
  validateBlueprint,
} from '../src/sim/blueprint';
import { obbBounds, partOBBs, transformPoint } from '../src/sim/geom';
import { getPart } from '../src/data/parts';

describe('placing parts', () => {
  it('rests a free part on the bench surface', () => {
    const bp = newBlueprint();
    const pl = placeFree(bp, 'crate', 0, 0);
    expect(pl.valid).toBe(true);
    const b = obbBounds(partOBBs(getPart('crate'), pl.pose));
    expect(b.min.y).toBeCloseTo(0, 2);
  });

  it('refuses to put a part inside another one', () => {
    const b = new Builder();
    b.free('crate', 0, 0);
    const pl = placeFree(b.bp, 'crate', 0.1, 0);
    expect(pl.valid).toBe(false);
  });

  it('presses the chosen socket flat against the surface it touches', () => {
    const b = new Builder();
    const crate = b.free('crate');
    const bat = b.on('battery_small', 'bottom', crate, [0.1, 0.2, 0], [0, 1, 0]);
    const p = b.pose(bat);
    // Battery bottom (y -0.06 in its frame) sits on the crate top (y 0.4 on the bench).
    const bottom = transformPoint(p, new Vector3(0, -0.06, 0));
    expect(bottom.y).toBeCloseTo(0.4, 2);
    expect(b.bp.connections[0].kind).toBe('weld');
  });
});

describe('connections fall out of geometry, not recipes', () => {
  it('a wheel hub on a flat surface becomes a free axle along the surface normal', () => {
    const b = new Builder();
    const plank = b.free('plank');
    b.on('lawn_wheel', 'hub', plank, [0.4, 0, 0.075], [0, 0, 1]);
    const c = b.bp.connections[0];
    expect(c.kind).toBe('axle');
    const axis = new Vector3(...c.axis!);
    const normal = new Vector3(0, 0, 1).applyQuaternion(partPose(findPart(b.bp, plank)!).q);
    expect(Math.abs(axis.dot(normal))).toBeCloseTo(1, 4);
  });

  it('anything on a motor shaft is driven about the shaft', () => {
    const b = new Builder();
    const crate = b.free('crate');
    const m = b.on('motor', 'base', crate, [0, 0.2, 0], [0, 1, 0]);
    b.into('plank', 'end', m, 'shaft');
    const c = b.bp.connections[1];
    expect(c.kind).toBe('driven');
    expect(c.a).toBe(m);
  });

  it('things on a hinge leaf swing around the hinge axis', () => {
    const b = new Builder();
    const crate = b.free('crate');
    const hg = b.on('hinge', 'base', crate, [0, 0.2, 0], [0, 1, 0]);
    b.into('plank', 'flat', hg, 'swing');
    expect(b.bp.connections[1].kind).toBe('hinge');
  });

  it('balloons tie on with a string', () => {
    const b = new Builder();
    const crate = b.free('crate');
    b.on('balloons', 'string', crate, [0, 0.2, 0], [0, 1, 0]);
    const c = b.bp.connections[1] ?? b.bp.connections[0];
    expect(c.kind).toBe('tether');
    const bal = partPose(findPart(b.bp, c.b)!);
    expect(bal.p.y).toBeGreaterThan(1.2);
  });

  it('rope ends snap onto a winch drum as a reel', () => {
    const b = new Builder();
    const crate = b.free('crate');
    const w = b.on('winch', 'bottom', crate, [0, 0.2, 0], [0, 1, 0]);
    const bucket = b.free('bucket', 0.5, 0);
    const wp = partPose(findPart(b.bp, w)!);
    const drum = transformPoint(wp, new Vector3(0, 0.05, 0));
    const r = addLink(b.bp, 'rope', { part: w, point: drum }, { part: bucket, point: transformPoint(b.pose(bucket), new Vector3(0, 0.15, 0)) });
    expect(r.ok).toBe(true);
    expect(b.bp.links[0].a.reel).toBe(true);
  });

  it('refuses links that cannot reach', () => {
    const b = new Builder();
    const a = b.free('crate', -0.4, 0);
    const c = b.free('brick', 0.6, 0);
    const r = addLink(b.bp, 'bungee', { part: a, point: new Vector3(-0.4, 0.2, 0) }, { part: c, point: new Vector3(0.6, 0, 0) });
    expect(r.ok).toBe(true);
    const far = addLink(b.bp, 'spring', { part: a, point: new Vector3(-0.4, 0.2, 0) }, { part: c, point: new Vector3(0.6, 0, 0) });
    expect(far.ok).toBe(false);
  });

  it('an unknown socket falls back to the first one instead of crashing', () => {
    const b = new Builder();
    const crate = b.free('crate');
    const pl = computeAttach(b.bp, 'brick', 'nope', { part: crate, point: new Vector3(0, 0.4, 0), normal: new Vector3(0, 1, 0) });
    expect(pl.valid).toBe(true);
  });
});

describe('blueprint bookkeeping', () => {
  it('removing a part drops its connections and any ropes tied to it', () => {
    const b = new Builder();
    const crate = b.free('crate', -0.3, 0);
    const brick = b.free('brick', 0.5, 0);
    b.on('battery_small', 'bottom', crate, [0, 0.2, 0], [0, 1, 0]);
    b.link('rope', crate, [0.25, 0, 0], brick, [0, 0.03, 0]);
    const removed = removePart(b.bp, crate);
    expect(removed).toContain('crate');
    expect(removed).toContain('rope');
    expect(b.bp.connections).toHaveLength(0);
    expect(b.bp.links).toHaveLength(0);
  });

  it('groups parts into connected components', () => {
    const b = new Builder();
    const c1 = b.free('crate', -0.4, 0);
    b.on('battery_small', 'bottom', c1, [0, 0.2, 0], [0, 1, 0]);
    b.free('brick', 0.5, 0);
    expect(components(b.bp).map((g) => g.length).sort()).toEqual([1, 2]);
  });

  it('warns when a motor has no battery on its machine', () => {
    const b = new Builder();
    const c = b.free('crate');
    b.on('motor', 'base', c, [0, 0.2, 0], [0, 1, 0]);
    expect(validateBlueprint(b.bp).some((i) => i.severity === 'warn')).toBe(true);
  });

  it('round-trips through JSON and rejects garbage', () => {
    const b = new Builder('Thing');
    const c = b.free('crate');
    b.on('motor', 'base', c, [0, 0.2, 0], [0, 1, 0]);
    const back = parseBlueprint(JSON.parse(serialize(b.bp)));
    expect(back).toEqual(b.bp);
    expect(parseBlueprint({ parts: [{ uid: 1, def: 'nuclear_reactor', p: [0, 0, 0], q: [0, 0, 0, 1] }] })!.parts).toHaveLength(0);
    expect(parseBlueprint('lol')).toBeNull();
    expect(parseBlueprint({ parts: [{ uid: 1, def: 'crate', p: [0, NaN, 0], q: [0, 0, 0, 1] }] })!.parts).toHaveLength(0);
  });
});

describe('two rotation axes: spin and tilt', () => {
  it('tilting a plank on a crate tips it up and rests it on its edge, still stuck on', () => {
    const b = new Builder();
    const crate = b.free('crate');
    const flat = computeAttach(b.bp, 'plank', 'flat', { part: crate, point: new Vector3(0, 0.4, 0), normal: new Vector3(0, 1, 0) }, 0, 0);
    const tilted = computeAttach(b.bp, 'plank', 'flat', { part: crate, point: new Vector3(0, 0.4, 0), normal: new Vector3(0, 1, 0) }, 0, 30);
    expect(tilted.valid).toBe(true);
    expect(tilted.conn?.kind).toBe('weld');
    // The plank's long axis now climbs at 30 degrees.
    const along = new Vector3(1, 0, 0).applyQuaternion(tilted.pose.q);
    expect(Math.abs(Math.asin(Math.abs(along.y)) * (180 / Math.PI) - 30)).toBeLessThan(0.5);
    expect(tilted.pose.q.angleTo(flat.pose.q)).toBeGreaterThan(0.5);
    // Nothing of it pokes down into the crate.
    const low = obbBounds(partOBBs(getPart('plank'), tilted.pose)).min.y;
    expect(low).toBeGreaterThan(0.399);
  });

  it('spin and tilt are independent axes', () => {
    const b = new Builder();
    const crate = b.free('crate');
    const hit = { part: crate, point: new Vector3(0, 0.4, 0), normal: new Vector3(0, 1, 0) };
    const a = computeAttach(b.bp, 'plank', 'flat', hit, 90, 20).pose.q;
    const c = computeAttach(b.bp, 'plank', 'flat', hit, 0, 20).pose.q;
    const d = computeAttach(b.bp, 'plank', 'flat', hit, 90, 0).pose.q;
    expect(a.angleTo(c)).toBeGreaterThan(0.5);
    expect(a.angleTo(d)).toBeGreaterThan(0.2);
  });

  it('a tilted part set loose on the bench sits on the bench, not in it', () => {
    const bp = newBlueprint();
    const pl = placeFree(bp, 'crate', 0, 0, 0, undefined, 45);
    expect(pl.valid).toBe(true);
    expect(obbBounds(partOBBs(getPart('crate'), pl.pose)).min.y).toBeCloseTo(0, 2);
    const up = new Vector3(0, 1, 0).applyQuaternion(pl.pose.q);
    expect(up.y).toBeCloseTo(Math.cos(Math.PI / 4), 2);
  });

  it('wheels on axles and things on motor shafts stay square even when tilt is asked for', () => {
    const b = new Builder();
    const crate = b.free('crate');
    const m = b.on('motor', 'base', crate, [0, 0.2, 0], [0, 1, 0]);
    const t = getPart('motor').targets![0];
    const mp = b.pose(m);
    const hit = { part: m, point: new Vector3(...t.pos).applyQuaternion(mp.q).add(mp.p), normal: new Vector3(...t.normal).applyQuaternion(mp.q) };
    const square = computeAttach(b.bp, 'lawn_wheel', 'hub', hit, 0, 0);
    const asked = computeAttach(b.bp, 'lawn_wheel', 'hub', hit, 0, 45);
    expect(asked.conn?.kind).toBe('driven');
    expect(asked.pose.q.angleTo(square.pose.q)).toBeLessThan(1e-6);
  });
});
