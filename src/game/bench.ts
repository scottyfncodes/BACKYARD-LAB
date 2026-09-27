import { WORLD } from '../data/world';

/**
 * Is the kid deliberately interacting with the workbench? True when they are
 * within reach of it and looking at the bench itself, or at junk lying on it.
 * Junk on the bench top belongs to the lab, so it must not steal the BUILD
 * action; junk anywhere else is picked up as usual.
 */
export interface BenchLook {
  kind: 'static' | 'item' | 'machine';
  id?: string;
  /** Where the look ray hit (items: the item's position works too). */
  point: { x: number; y: number; z: number };
}

export const BENCH_REACH = 2.3;

export function nearBench(player: { x: number; z: number }, bench = WORLD.workbench): boolean {
  return Math.hypot(player.x - bench.pos[0], player.z - bench.pos[2]) < BENCH_REACH;
}

/** Is a point sitting on the bench top (within its footprint, a little above it)? */
export function onBenchTop(p: { x: number; y: number; z: number }, bench = WORLD.workbench): boolean {
  const [bx, , bz] = bench.pos;
  const [hx, hz] = bench.half;
  const pad = 0.15;
  return Math.abs(p.x - bx) <= hx + pad && Math.abs(p.z - bz) <= hz + pad && p.y >= bench.top - 0.1 && p.y <= bench.top + 0.6;
}

export function benchTargeted(player: { x: number; z: number }, look: BenchLook | null, bench = WORLD.workbench): boolean {
  if (!look || !nearBench(player, bench)) return false;
  if (look.kind === 'static') return look.id === 'workbench';
  if (look.kind === 'item') return onBenchTop(look.point, bench);
  return false;
}
