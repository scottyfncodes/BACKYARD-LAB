import { Vector3 } from 'three';

/**
 * Tension in ropes, bungees and springs.
 * Positive = pulling the ends together, negative = pushing apart.
 */
export function linkTension(kind: 'rope' | 'elastic' | 'spring', restLength: number, length: number, rate: number, k: number, c: number): number {
  const stretch = length - restLength;
  if (kind !== 'spring' && stretch <= 0) return 0;
  const t = k * stretch + c * rate;
  // Ropes and bungees can only pull.
  return kind === 'spring' ? t : Math.max(0, t);
}

/**
 * Stiffness a force element can use without blowing up an explicit step.
 * Real rope is nearly rigid; a light object on a rigid spring would explode,
 * so we cap stiffness by what the attached masses can follow in one step.
 */
export function stableStiffness(k: number, reducedMass: number, dt: number): number {
  return Math.min(k, (0.2 * reducedMass) / (dt * dt));
}

export function reducedMass(ma: number, mb: number): number {
  if (!Number.isFinite(ma) || ma <= 0) return mb;
  if (!Number.isFinite(mb) || mb <= 0) return ma;
  return (ma * mb) / (ma + mb);
}

export function criticalDamping(k: number, m: number, ratio: number): number {
  return 2 * Math.sqrt(Math.max(0, k * m)) * ratio;
}

/**
 * A rope as a chain of verlet particles, so it can drape over fences and
 * branches. Only the ends touch rigid bodies; the chain decides which way
 * those ends get pulled.
 */
export class RopeSim {
  pts: Vector3[];
  prev: Vector3[];
  segLen: number;
  constructor(
    a: Vector3,
    b: Vector3,
    public length: number,
    public segments = Math.max(6, Math.min(40, Math.round(length / 0.1))),
  ) {
    this.pts = [];
    this.prev = [];
    this.segLen = length / this.segments;
    // Start with slack hanging below the straight line.
    const span = a.distanceTo(b);
    const sag = span < length ? Math.sqrt(Math.max(0, length * length - span * span)) * 0.45 : 0;
    for (let i = 0; i <= this.segments; i++) {
      const t = i / this.segments;
      const p = a.clone().lerp(b, t);
      p.y -= sag * 4 * t * (1 - t);
      // Never start inside the ground.
      p.y = Math.max(p.y, Math.min(a.y, b.y, 0.05));
      this.pts.push(p);
      this.prev.push(p.clone());
    }
  }

  setLength(len: number) {
    this.length = len;
    this.segLen = len / this.segments;
  }

  /**
   * Advance the chain with ends pinned at a and b.
   * `collide` pushes a point out of solid scenery.
   */
  /** Particles keep this far from scenery, so no segment can slip through a thin fence. */
  get radius(): number {
    return Math.max(0.03, this.segLen * 0.6);
  }

  step(a: Vector3, b: Vector3, dt: number, collide?: (p: Vector3, radius: number) => void, iterations = 10) {
    const n = this.segments;
    const g = -9.81 * dt * dt;
    for (let i = 1; i < n; i++) {
      const p = this.pts[i];
      const v = p.clone().sub(this.prev[i]).multiplyScalar(0.985);
      this.prev[i].copy(p);
      p.add(v);
      p.y += g;
    }
    this.pts[0].copy(a);
    this.pts[n].copy(b);
    const d = new Vector3();
    for (let it = 0; it < iterations; it++) {
      for (let i = 0; i < n; i++) {
        const p1 = this.pts[i];
        const p2 = this.pts[i + 1];
        d.subVectors(p2, p1);
        const len = d.length();
        if (len <= this.segLen || len < 1e-9) continue;
        const diff = (len - this.segLen) / len;
        const w1 = i === 0 ? 0 : 0.5;
        const w2 = i + 1 === n ? 0 : 0.5;
        const sum = w1 + w2;
        if (sum === 0) continue;
        p1.addScaledVector(d, (diff * w1) / sum);
        p2.addScaledVector(d, (-diff * w2) / sum);
      }
      // Scenery always wins over rope length: a taut rope stretches (and
      // pulls harder) rather than slicing through a fence.
      if (collide) {
        const r = this.radius;
        for (let i = 1; i < n; i++) collide(this.pts[i], r);
      }
    }
  }

  pathLength(): number {
    let s = 0;
    for (let i = 0; i < this.segments; i++) s += this.pts[i].distanceTo(this.pts[i + 1]);
    return s;
  }

  /** Direction the rope pulls end A (towards the next particle). */
  pullDirA(): Vector3 {
    for (let i = 1; i <= this.segments; i++) {
      const d = this.pts[i].clone().sub(this.pts[0]);
      if (d.lengthSq() > 1e-6) return d.normalize();
    }
    return new Vector3();
  }

  pullDirB(): Vector3 {
    const n = this.segments;
    for (let i = n - 1; i >= 0; i--) {
      const d = this.pts[i].clone().sub(this.pts[n]);
      if (d.lengthSq() > 1e-6) return d.normalize();
    }
    return new Vector3();
  }
}
