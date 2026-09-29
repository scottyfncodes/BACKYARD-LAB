import type { SimEvent } from '../sim/events';
import { toV } from '../sim/physics';
import type { Simulation } from '../sim/simulation';

/**
 * Watches a run and notices when it has played out (everything has come to
 * rest) and whether anything happened worth reporting. Explaining *what*
 * happened is the job of the test results (./diagnostics).
 */
export class RunJournal {
  time = 0;
  settled = false;
  private stillTime = 0;
  private notable = false;

  begin(_sim: Simulation) {
    this.time = this.stillTime = 0;
    this.settled = false;
    this.notable = false;
  }

  event(e: SimEvent) {
    if (e.type === 'break' || e.type === 'snap' || e.type === 'batteryDead' || e.type === 'brownout' || e.type === 'unstick') this.notable = true;
  }

  sample(sim: Simulation, dt: number) {
    this.time += dt;
    let moving = false;
    for (const m of sim.machines.values()) {
      if (m.state !== 'running') continue;
      for (const b of m.bodies) if (toV(b.rb.linvel()).length() > 0.08 || toV(b.rb.angvel()).length() > 0.3) moving = true;
    }
    if (this.time > 2 && !moving) this.stillTime += dt;
    else this.stillTime = 0;
    if (this.stillTime > 1.5) this.settled = true;
  }

  worthMentioning(): boolean {
    return this.notable || this.time > 1.5;
  }
}
