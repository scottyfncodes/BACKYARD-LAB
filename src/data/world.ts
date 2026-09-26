import type { MaterialId } from './materials';
import type { V3 } from './parts';

/**
 * The backyard, as data. The simulation turns `solids` into static colliders;
 * the renderer dresses each solid according to its `vis` tag. Zones are named
 * volumes that objectives use.
 *
 * Axes: +X east (towards the neighbour), +Z south (towards the back fence),
 * the house is to the north.
 */
export interface SolidDef {
  id?: string;
  kind: 'box' | 'cyl';
  /** box: centre + half extents; cyl: base centre (y = bottom) + r/h. */
  pos: V3;
  half?: V3;
  r?: number;
  h?: number;
  rotY?: number; // degrees
  mat: MaterialId;
  vis: string;
  /** Solids can be removed at runtime (the gate). */
  removable?: boolean;
}

export interface ZoneDef {
  id: string;
  min: V3;
  max: V3;
}

export interface SpawnDef {
  part: string;
  pos: V3;
  rotY?: number;
  rot?: V3; // euler degrees
  tag?: string;
  /** Tied down to a fixed point (untied when picked up). */
  tie?: V3;
}

export const FENCE_H = 2.1;
export const EAST_FENCE_X = 15;
export const GAP = { z0: 4.35, z1: 5.25, height: 0.3 };

const fenceX = (x: number, z0: number, z1: number, y0 = 0, y1 = FENCE_H, id?: string, vis = 'fence'): SolidDef => ({
  id,
  kind: 'box',
  pos: [x, (y0 + y1) / 2, (z0 + z1) / 2],
  half: [0.06, (y1 - y0) / 2, (z1 - z0) / 2],
  mat: 'wood',
  vis,
});
const fenceZ = (z: number, x0: number, x1: number, h = FENCE_H, vis = 'fence'): SolidDef => ({
  kind: 'box',
  pos: [(x0 + x1) / 2, h / 2, z],
  half: [(x1 - x0) / 2, h / 2, 0.06],
  mat: 'wood',
  vis,
});

export const WORLD = {
  bounds: { min: [-22, -6, -22] as V3, max: [36, 60, 24] as V3 },
  playerSpawn: { pos: [-1.5, 0, -6.2] as V3, yaw: 200 },
  zones: [
    { id: 'home_yard', min: [-14, -1, -10], max: [15, 30, 14] },
    { id: 'neighbor_yard', min: [15, -1, -10], max: [28, 30, 14] },
    { id: 'under_shed', min: [-11.9, -1, 9.1], max: [-8.1, 0.14, 12.9] },
    { id: 'in_tree', min: [3, 1.2, 3], max: [10, 12, 10] },
  ] as ZoneDef[],
  solids: [
    // ground
    { kind: 'box', pos: [7, -0.5, 1], half: [40, 0.5, 40], mat: 'grass', vis: 'ground' },
    // house (north)
    { id: 'house', kind: 'box', pos: [-1, 2.75, -14], half: [9, 2.75, 4], mat: 'concrete', vis: 'house' },
    { kind: 'box', pos: [-1, 0.09, -8.25], half: [5, 0.09, 1.75], mat: 'wood', vis: 'deck' },
    // garage / workshop (north-west, open to the east)
    { id: 'garage_back', kind: 'box', pos: [-14.1, 1.5, -5], half: [0.1, 1.5, 4.1], mat: 'wood', vis: 'garage_wall' },
    { id: 'garage_n', kind: 'box', pos: [-11, 1.5, -9.1], half: [3.2, 1.5, 0.1], mat: 'wood', vis: 'garage_wall' },
    { id: 'garage_s', kind: 'box', pos: [-11, 1.5, -0.9], half: [3.2, 1.5, 0.1], mat: 'wood', vis: 'garage_wall' },
    { kind: 'box', pos: [-11, 3.05, -5], half: [3.4, 0.08, 4.3], mat: 'wood', vis: 'garage_roof' },
    { kind: 'box', pos: [-11, 0.01, -5], half: [3, 0.01, 4], mat: 'concrete', vis: 'garage_floor' },
    { id: 'workbench', kind: 'box', pos: [-11, 0.39, -5], half: [0.75, 0.39, 0.4], mat: 'wood', vis: 'workbench' },
    { kind: 'box', pos: [-13.75, 0.9, -5], half: [0.25, 0.02, 1.6], mat: 'wood', vis: 'shelf' },
    // fences
    fenceX(EAST_FENCE_X, -10, -4.2),
    { ...fenceX(EAST_FENCE_X, -4.2, -3.0, 0, FENCE_H, 'gate', 'gate'), removable: true },
    fenceX(EAST_FENCE_X, -3.0, GAP.z0),
    fenceX(EAST_FENCE_X, GAP.z0, GAP.z1, GAP.height, FENCE_H, 'fence_gap', 'fence_gap'),
    fenceX(EAST_FENCE_X, GAP.z1, 14),
    fenceZ(14, -14.1, 28),
    fenceX(-14.1, -0.8, 14),
    fenceZ(-10, 8, 15),
    fenceZ(-9.6, -9.9, -7.9, FENCE_H),
    // neighbour side
    fenceX(28, -10, 14, 0, FENCE_H, undefined, 'fence_far'),
    fenceZ(-10, 15, 28, FENCE_H, 'fence_far'),
    { kind: 'box', pos: [22, 2.5, -14], half: [6, 2.5, 4], mat: 'concrete', vis: 'house2' },
    { kind: 'box', pos: [24, 0.45, -2], half: [0.6, 0.45, 0.5], mat: 'wood', vis: 'doghouse' },
    // big tree + treehouse
    { id: 'trunk', kind: 'cyl', pos: [6, 0, 6], r: 0.36, h: 5.2, mat: 'wood', vis: 'trunk' },
    { kind: 'box', pos: [6, 2.8, 6], half: [1.2, 0.06, 1.2], mat: 'wood', vis: 'treehouse' },
    { kind: 'box', pos: [7.3, 3.5, 7.1], half: [0.9, 0.07, 0.07], rotY: -35, mat: 'wood', vis: 'branch' },
    { kind: 'box', pos: [4.8, 3.9, 6.6], half: [1.0, 0.07, 0.07], rotY: 25, mat: 'wood', vis: 'branch' },
    // shed on blocks (south-west): gap underneath
    { id: 'shed', kind: 'box', pos: [-10, 1.28, 11], half: [2, 1.16, 2], mat: 'wood', vis: 'shed' },
    { kind: 'box', pos: [-11.9, 0.06, 9.1], half: [0.1, 0.06, 0.1], mat: 'concrete', vis: 'block' },
    { kind: 'box', pos: [-8.1, 0.06, 9.1], half: [0.1, 0.06, 0.1], mat: 'concrete', vis: 'block' },
    { kind: 'box', pos: [-11.9, 0.06, 12.9], half: [0.1, 0.06, 0.1], mat: 'concrete', vis: 'block' },
    { kind: 'box', pos: [-8.1, 0.06, 12.9], half: [0.1, 0.06, 0.1], mat: 'concrete', vis: 'block' },
    // sandbox
    { kind: 'box', pos: [-2.5, 0.08, 8], half: [1.5, 0.08, 0.06], mat: 'wood', vis: 'sandbox_edge' },
    { kind: 'box', pos: [-2.5, 0.08, 11], half: [1.5, 0.08, 0.06], mat: 'wood', vis: 'sandbox_edge' },
    { kind: 'box', pos: [-4, 0.08, 9.5], half: [0.06, 0.08, 1.5], mat: 'wood', vis: 'sandbox_edge' },
    { kind: 'box', pos: [-1, 0.08, 9.5], half: [0.06, 0.08, 1.5], mat: 'wood', vis: 'sandbox_edge' },
    { kind: 'box', pos: [-2.5, 0.02, 9.5], half: [1.44, 0.02, 1.44], mat: 'dirt', vis: 'sand' },
    // garden bed along the back fence
    { kind: 'box', pos: [7, 0.12, 13.2], half: [5, 0.12, 0.7], mat: 'dirt', vis: 'garden' },
    // patio table on the deck
    { kind: 'box', pos: [2.4, 0.55, -8.4], half: [0.55, 0.37, 0.55], mat: 'wood', vis: 'patio_table' },
  ] as SolidDef[],
  /**
   * Junk that is always lying around the yard, whatever the project. It is
   * not part of any kit: if the kid thinks "wait, I could use THAT", they can
   * pick it up and add it to the mat.
   */
  junk: [
    // junk pile by the garage
    { part: 'crate', pos: [-6.5, 0.2, 2.5], rotY: 12 },
    { part: 'crate', pos: [-7.2, 0.2, 3.3], rotY: -20 },
    { part: 'plank', pos: [-5.6, 0.03, 3.4], rotY: 70 },
    { part: 'plank', pos: [-5.8, 0.07, 3.6], rotY: 80 },
    { part: 'bucket', pos: [-5.9, 0.16, 1.7] },
    // garden
    { part: 'brick', pos: [11.8, 0.3, 12.4] },
    { part: 'brick', pos: [11.5, 0.3, 12.5] },
    // lawn
    { part: 'skateboard', pos: [0.2, 0.02, 7.8], rotY: 30 },
  ] as SpawnDef[],
};

/** What the kid thinks when looking at bits of the world (by solid id). */
export const LOOK_HINTS: Record<string, string> = {
  workbench: 'The old workbench. I do not need it: the whole yard is my lab now.',
  fence_gap: 'Something dug under the fence here. There is a little gap at the bottom...',
  gate: 'Locked. The latch is on THEIR side.',
  shed: 'The shed sits up on blocks. There is a skinny gap underneath.',
  trunk: 'The big tree. The treehouse is up there.',
  house: 'Home. Mom said no building stuff inside.',
  garage_back: 'The garage. Everything useful ends up in here eventually.',
};

export function zone(id: string): ZoneDef {
  const z = WORLD.zones.find((z) => z.id === id);
  if (!z) throw new Error(`Unknown zone ${id}`);
  return z;
}

export function inZone(p: { x: number; y: number; z: number }, zoneId: string): boolean {
  const z = zone(zoneId);
  return p.x >= z.min[0] && p.x <= z.max[0] && p.y >= z.min[1] && p.y <= z.max[1] && p.z >= z.min[2] && p.z <= z.max[2];
}
