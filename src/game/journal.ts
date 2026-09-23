import { Vector3 } from 'three';
import { getPart } from '../data/parts';
import { inZone } from '../data/world';
import type { SimEvent } from '../sim/events';
import { toQ, toV } from '../sim/physics';
import type { Simulation } from '../sim/simulation';

/**
 * Watches a run and explains what happened in one kid-voice line.
 * Failure is content: "Okay. I know what went wrong."
 */
type Finding = { key: string; weight: number; line: string };

export class RunJournal {
  private findings = new Map<string, Finding>();
  private start = new Map<number, Vector3>();
  private flipTime = 0;
  private stuckTime = 0;
  private spinTime = 0;
  private maxY = 0;
  private maxMove = 0;
  time = 0;
  private stillTime = 0;
  settled = false;
  private anyPowered = false;

  begin(sim: Simulation) {
    this.findings.clear();
    this.start.clear();
    for (const m of sim.machines.values()) this.start.set(m.id, m.center());
    this.flipTime = this.stuckTime = this.spinTime = this.maxY = this.maxMove = this.time = this.stillTime = 0;
    this.settled = false;
    this.anyPowered = false;
  }

  private add(key: string, weight: number, line: string) {
    const f = this.findings.get(key);
    if (!f || f.weight < weight) this.findings.set(key, { key, weight, line });
  }

  event(e: SimEvent) {
    switch (e.type) {
      case 'break': {
        const part = getPart(e.part);
        const other = getPart(e.other);
        if (e.joint === 'axle' || e.joint === 'driven') {
          if (part.sockets.some((s) => s.joint === 'axle')) this.add('wheel', 9, `The ${part.name.toLowerCase()} fell off. Too much load on that axle?`);
          else this.add('break', 7, `The ${part.name.toLowerCase()} ripped off the ${other.name.toLowerCase()}.`);
        } else if (e.joint === 'hinge') this.add('hinge', 8, 'The hinge gave up. That swing was too violent for it.');
        else this.add('break', 7, `CLUNK. The ${part.name.toLowerCase()} came off the ${other.name.toLowerCase()}.`);
        break;
      }
      case 'snap':
        if (e.part === 'balloons') this.add('balloon', 6, 'The balloons got away. Bye, balloons.');
        else this.add('snap', 9, `SNAP. The ${getPart(e.part).name.toLowerCase()} couldn't take it.`);
        break;
      case 'batteryDead':
        this.add('dead', 8, "Nothing's happening. Does it even have power? Is the battery attached to it?");
        break;
      case 'brownout':
        this.add('brownout', 6, "It's trying... but that battery can't keep up.");
        break;
      case 'unstick':
        this.add('unstick', 5, 'It grabbed it... and dropped it. Needs a better grip.');
        break;
      case 'live':
        this.anyPowered = true;
        break;
    }
  }

  sample(sim: Simulation, dt: number, throttle: number) {
    this.time += dt;
    let moving = false;
    for (const m of sim.machines.values()) {
      if (m.state !== 'running') continue;
      const c = m.center();
      const s = this.start.get(m.id) ?? c;
      this.maxMove = Math.max(this.maxMove, c.distanceTo(s));
      this.maxY = Math.max(this.maxY, c.y);
      let fast = false;
      let biggest = m.bodies[0];
      for (const b of m.bodies) {
        if (toV(b.rb.linvel()).length() > 0.08 || toV(b.rb.angvel()).length() > 0.3) fast = true;
        if (b.rb.mass() > (biggest?.rb.mass() ?? 0)) biggest = b;
      }
      if (fast) moving = true;
      if (biggest) {
        const upY = new Vector3(0, 1, 0).applyQuaternion(toQ(biggest.rb.rotation())).y;
        if (upY < -0.3) this.flipTime += dt;
        const w = toV(biggest.rb.angvel());
        const v = toV(biggest.rb.linvel());
        if (Math.abs(w.y) > 2.5 && v.length() < 1.2) this.spinTime += dt;
        if (Math.abs(throttle) > 0.5 && v.length() < 0.12 && m.hasReceiver()) this.stuckTime += dt;
      }
      if (inZone(c, 'neighbor_yard') && !inZone(s, 'neighbor_yard')) this.add('neighbor', 5, "Aaaand it's in the neighbor's yard now.");
      if (inZone(c, 'in_tree') && c.y > 1.6) this.add('tree', 6, "It's in the tree. Great. Now there are TWO things in the tree.");
    }
    if (this.flipTime > 0.8) this.add('flip', 8, 'It flipped over. Too top-heavy? Wider wheels?');
    if (this.spinTime > 1.5) this.add('spin', 6, 'It just spins in circles. Something is pushing harder on one side.');
    if (this.stuckTime > 1.5) this.add('stuck', 7, "It's stuck. Wheels spinning, going nowhere.");
    if (this.maxY > 7) this.add('high', 4, 'WHOA. That went HIGH.');
    if (this.time > 2 && !moving) this.stillTime += dt;
    else this.stillTime = 0;
    if (this.stillTime > 1.5) this.settled = true;
  }

  verdict(): string {
    const list = [...this.findings.values()].sort((a, b) => b.weight - a.weight);
    if (list.length) return list[0].line;
    if (this.maxMove < 0.05) return this.anyPowered ? 'Huh. It just sat there.' : 'Nothing happened. Maybe it needs something to make it go?';
    if (this.maxMove < 1) return 'It did... a little something. Not enough.';
    return "Well, that didn't work.";
  }

  worthMentioning(): boolean {
    return this.findings.size > 0 || this.time > 1.5;
  }
}
