import { inZone, WORLD } from '../data/world';
import type { BonusDef, Cond, ProjectDef } from '../data/projects';

/** What objectives are allowed to ask about the world. */
export interface WorldQuery {
  time: number;
  pos(tag: string): { x: number; y: number; z: number } | null;
  speed(tag: string): number;
  held(tag: string): boolean;
  touched(tag: string): boolean;
  snagged(tag: string): boolean;
}

export function outOfBounds(p: { x: number; y: number; z: number }): boolean {
  const b = WORLD.bounds;
  return p.x < b.min[0] || p.x > b.max[0] || p.y < b.min[1] || p.y > b.max[1] || p.z < b.min[2] || p.z > b.max[2];
}

export function evalCond(c: Cond, q: WorldQuery): boolean {
  switch (c.type) {
    case 'inZone': {
      const p = q.pos(c.tag);
      return !!p && inZone(p, c.zone);
    }
    case 'held':
      return q.held(c.tag);
    case 'touchedByPlayer':
      return q.touched(c.tag);
    case 'resting':
      return q.speed(c.tag) < (c.speed ?? 0.15);
    case 'below': {
      const p = q.pos(c.tag);
      return !!p && p.y < c.y;
    }
    case 'above': {
      const p = q.pos(c.tag);
      return !!p && p.y > c.y;
    }
    case 'snagged':
      return q.snagged(c.tag);
    case 'outOfBounds': {
      const p = q.pos(c.tag);
      return !!p && outOfBounds(p);
    }
    case 'near': {
      const a = q.pos(c.a);
      const b = q.pos(c.b);
      if (!a || !b) return false;
      return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) <= c.dist;
    }
    case 'timeUnder':
      return q.time < c.seconds;
    case 'all':
      return c.of.every((x) => evalCond(x, q));
    case 'any':
      return c.of.some((x) => evalCond(x, q));
    case 'not':
      return !evalCond(c.cond, q);
  }
}

export type ObjectiveEvent =
  | { type: 'success'; bonuses: { def: BonusDef; earned: boolean }[]; time: number }
  | { type: 'fail'; message: string; action: 'respawnTarget' }
  | { type: 'bonusLost'; def: BonusDef };

/** Tracks one project's success / failure / bonus state over time. */
export class ObjectiveTracker {
  done = false;
  private hold = 0;
  lost = new Set<string>();
  constructor(public project: ProjectDef) {}

  update(q: WorldQuery, dt: number): ObjectiveEvent[] {
    const out: ObjectiveEvent[] = [];
    if (this.done) return out;
    for (const b of this.project.bonuses) {
      if (b.kind === 'never' && !this.lost.has(b.id) && evalCond(b.cond, q)) {
        this.lost.add(b.id);
        out.push({ type: 'bonusLost', def: b });
      }
    }
    for (const f of this.project.fails) {
      if (evalCond(f.cond, q)) out.push({ type: 'fail', message: f.message, action: f.action });
    }
    if (evalCond(this.project.success, q)) {
      this.hold += dt;
      if (this.hold >= this.project.holdFor) {
        this.done = true;
        const bonuses = this.project.bonuses.map((def) => ({
          def,
          earned: def.kind === 'never' ? !this.lost.has(def.id) : evalCond(def.cond, q),
        }));
        out.push({ type: 'success', bonuses, time: q.time });
      }
    } else {
      this.hold = 0;
    }
    return out;
  }
}
