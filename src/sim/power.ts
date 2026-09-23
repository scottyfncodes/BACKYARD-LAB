/**
 * Electrical power for one connected group of parts. Batteries can only push
 * so many watts; if the parts ask for more, everything browns out together.
 */
export interface Consumer {
  watts: number;
  /** 0..1 how hard it is being driven right now. */
  demand: number;
}

export interface BatteryState {
  energy: number; // joules left
  maxWatts: number;
}

export interface PowerResult {
  /** Fraction of requested power actually delivered (0..1). */
  factor: number;
  demandWatts: number;
  deliveredWatts: number;
}

export function solvePower(consumers: Consumer[], batteries: BatteryState[], dt: number): PowerResult {
  const demandWatts = consumers.reduce((s, c) => s + c.watts * Math.max(0, Math.min(1, c.demand)), 0);
  const supply = batteries.map((b) => (b.energy > 0 ? Math.min(b.maxWatts, b.energy / dt) : 0));
  const supplyWatts = supply.reduce((a, b) => a + b, 0);
  if (demandWatts <= 1e-9) return { factor: supplyWatts > 0 ? 1 : 0, demandWatts: 0, deliveredWatts: 0 };
  const deliveredWatts = Math.min(demandWatts, supplyWatts);
  const factor = deliveredWatts / demandWatts;
  // Drain batteries in proportion to what each can supply.
  if (supplyWatts > 0) {
    batteries.forEach((b, i) => {
      b.energy = Math.max(0, b.energy - (deliveredWatts * (supply[i] / supplyWatts)) * dt);
    });
  }
  return { factor, demandWatts, deliveredWatts };
}
