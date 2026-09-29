import { Vector3 } from 'three';
import { MATERIALS, type MaterialId } from '../data/materials';

/**
 * Fully procedural physical audio. No samples: every clunk, whirr and boing is
 * synthesised from the material involved, so new parts sound right for free.
 */
export class Audio {
  ctx: AudioContext | null = null;
  master!: GainNode;
  private noise!: AudioBuffer;
  private listener = new Vector3();
  private listenerRight = new Vector3(1, 0, 0);
  private loops = new Map<string, { nodes: AudioNode[]; gain: GainNode; osc?: OscillatorNode; filter?: BiquadFilterNode; pan: StereoPannerNode; last: number }>();
  enabled = true;
  private ambientTimer = 0;

  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.enabled ? 0.8 : 0;
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(this.ctx.destination);
    const len = this.ctx.sampleRate;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.startAmbience();
  }

  setEnabled(on: boolean) {
    this.enabled = on;
    if (this.ctx) this.master.gain.setTargetAtTime(on ? 0.8 : 0, this.ctx.currentTime, 0.05);
  }

  setListener(pos: Vector3, right: Vector3) {
    this.listener.copy(pos);
    this.listenerRight.copy(right);
  }

  private spatial(pos?: Vector3): { gain: number; pan: number } {
    if (!pos) return { gain: 1, pan: 0 };
    const d = pos.clone().sub(this.listener);
    const dist = d.length();
    const gain = 1 / (1 + dist * 0.18);
    const pan = dist > 0.01 ? Math.max(-1, Math.min(1, d.normalize().dot(this.listenerRight))) * 0.8 : 0;
    return { gain, pan };
  }

  private out(pos?: Vector3, vol = 1): { node: AudioNode; t: number } | null {
    if (!this.ctx || !this.enabled) return null;
    const s = this.spatial(pos);
    if (s.gain * vol < 0.01) return null;
    const g = this.ctx.createGain();
    g.gain.value = s.gain * vol;
    const p = this.ctx.createStereoPanner();
    p.pan.value = s.pan;
    g.connect(p).connect(this.master);
    return { node: g, t: this.ctx.currentTime };
  }

  private noiseBurst(dest: AudioNode, t: number, dur: number, freq: number, q: number, vol: number, type: BiquadFilterType = 'bandpass') {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    src.connect(f).connect(g).connect(dest);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  }

  private tone(dest: AudioNode, t: number, freq: number, dur: number, vol: number, type: OscillatorType = 'sine', endFreq?: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (endFreq) o.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  /** Two materials hitting each other. */
  impact(a: MaterialId, b: MaterialId, impulse: number, pos?: Vector3) {
    const vol = Math.min(1, Math.log10(1 + impulse * 4) * 0.6);
    const o = this.out(pos, vol);
    if (!o) return;
    for (const m of [a, b]) {
      if (m === 'grass' || m === 'player') continue;
      const s = MATERIALS[m].sound;
      const pitch = s.pitch * (0.85 + Math.random() * 0.3) * (1 + 0.3 / (1 + impulse));
      this.noiseBurst(o.node, o.t, s.decay, pitch * 3, 1.2, 0.6 * s.noise);
      if (s.ring > 0) this.tone(o.node, o.t, pitch, s.decay * (1 + s.ring), 0.35 * s.ring, s.ring > 0.6 ? 'triangle' : 'sine', pitch * 0.9);
      this.tone(o.node, o.t, pitch * 0.5, s.decay * 0.6, 0.3, 'sine', pitch * 0.3);
    }
    if (a === 'grass' || b === 'grass') this.noiseBurst(o.node, o.t, 0.08, 500, 0.7, 0.35, 'lowpass');
  }

  play(name: string, pos?: Vector3, vol = 1) {
    const o = this.out(pos, vol);
    if (!o) return;
    const { node: d, t } = o;
    switch (name) {
      case 'pickup':
        this.tone(d, t, 520, 0.08, 0.2, 'sine', 780);
        this.noiseBurst(d, t, 0.05, 2000, 1, 0.15);
        break;
      case 'drop':
        this.tone(d, t, 300, 0.1, 0.15, 'sine', 180);
        break;
      case 'throw':
        this.noiseBurst(d, t, 0.25, 900, 0.8, 0.3);
        break;
      case 'attach':
        // CLUNK: a woody knock plus a metallic tick.
        this.tone(d, t, 140, 0.15, 0.6, 'sine', 70);
        this.noiseBurst(d, t, 0.06, 1800, 2, 0.5);
        this.tone(d, t + 0.03, 1400, 0.05, 0.12, 'triangle');
        break;
      case 'detach':
        this.tone(d, t, 200, 0.1, 0.3, 'sine', 400);
        this.noiseBurst(d, t, 0.08, 1200, 1, 0.3);
        break;
      case 'tie':
        this.noiseBurst(d, t, 0.18, 700, 0.6, 0.35);
        this.tone(d, t + 0.1, 220, 0.08, 0.2);
        break;
      case 'error':
        this.tone(d, t, 180, 0.12, 0.25, 'square', 150);
        this.tone(d, t + 0.13, 150, 0.15, 0.2, 'square', 120);
        break;
      case 'click':
        this.noiseBurst(d, t, 0.02, 4000, 3, 0.6);
        this.tone(d, t, 2400, 0.02, 0.15, 'square');
        break;
      case 'ui':
        this.tone(d, t, 660, 0.05, 0.12, 'triangle');
        break;
      case 'go':
        this.tone(d, t, 440, 0.08, 0.25, 'triangle');
        this.tone(d, t + 0.09, 660, 0.08, 0.25, 'triangle');
        this.tone(d, t + 0.18, 880, 0.14, 0.3, 'triangle');
        break;
      case 'ding':
        this.tone(d, t, 1760, 1.2, 0.35, 'sine');
        this.tone(d, t, 2640, 0.8, 0.12, 'sine');
        break;
      case 'squeak':
        this.tone(d, t, 900, 0.12, 0.3, 'triangle', 1500);
        this.tone(d, t + 0.1, 1400, 0.1, 0.2, 'triangle', 800);
        break;
      case 'snap':
        this.noiseBurst(d, t, 0.12, 3000, 0.8, 1.0, 'highpass');
        this.tone(d, t, 900, 0.3, 0.25, 'sawtooth', 120);
        break;
      case 'break':
        this.noiseBurst(d, t, 0.25, 600, 0.6, 1.0);
        this.noiseBurst(d, t + 0.02, 0.15, 2500, 1.2, 0.6);
        this.tone(d, t, 90, 0.3, 0.6, 'sine', 40);
        break;
      case 'stick':
        // Duct tape rrrip
        for (let i = 0; i < 6; i++) this.noiseBurst(d, t + i * 0.025, 0.03, 1800 + i * 200, 2, 0.4);
        break;
      case 'unstick':
        this.noiseBurst(d, t, 0.12, 2500, 1.5, 0.5);
        break;
      case 'suck':
        this.tone(d, t, 300, 0.25, 0.3, 'sawtooth', 900);
        this.noiseBurst(d, t, 0.2, 3000, 0.5, 0.4, 'highpass');
        break;
      case 'ignite':
        this.noiseBurst(d, t, 1.0, 1200, 0.3, 1.0, 'lowpass');
        this.noiseBurst(d, t, 0.6, 5000, 0.4, 0.6, 'highpass');
        this.tone(d, t, 120, 0.6, 0.5, 'sawtooth', 60);
        break;
      case 'boing':
        this.tone(d, t, 180, 0.4, 0.5, 'sine', 520);
        this.tone(d, t, 90, 0.3, 0.3, 'triangle', 260);
        break;
      case 'jump':
        this.noiseBurst(d, t, 0.06, 600, 1, 0.2);
        break;
      case 'land':
        this.noiseBurst(d, t, 0.1, 300, 0.8, 0.5, 'lowpass');
        this.tone(d, t, 80, 0.12, 0.4, 'sine', 50);
        break;
      case 'step':
        this.noiseBurst(d, t, 0.05, 700 + Math.random() * 300, 0.9, 0.12, 'lowpass');
        break;
      case 'brownout':
        this.tone(d, t, 200, 0.6, 0.3, 'sawtooth', 50);
        break;
      case 'whoosh':
        this.noiseBurst(d, t, 0.5, 800, 0.5, 0.4);
        break;
      case 'success': {
        const notes = [523, 659, 784, 1046, 784, 1046, 1318];
        notes.forEach((f, i) => this.tone(d, t + i * 0.09, f, 0.3, 0.25, 'triangle'));
        this.noiseBurst(d, t + 0.6, 0.6, 6000, 0.5, 0.2, 'highpass');
        break;
      }
      case 'fail':
        this.tone(d, t, 392, 0.25, 0.25, 'triangle');
        this.tone(d, t + 0.25, 370, 0.25, 0.25, 'triangle');
        this.tone(d, t + 0.5, 349, 0.25, 0.25, 'triangle');
        this.tone(d, t + 0.75, 330, 0.6, 0.25, 'triangle', 300);
        break;
      case 'ratchet':
        // A joint engaging: three quick metallic clicks and a settle.
        for (let i = 0; i < 3; i++) {
          this.noiseBurst(d, t + i * 0.035, 0.02, 3200 + i * 300, 3, 0.5);
          this.tone(d, t + i * 0.035, 1900 + i * 150, 0.02, 0.1, 'square');
        }
        this.tone(d, t + 0.1, 150, 0.12, 0.45, 'sine', 80);
        break;
      case 'hmm':
        // Curious, not sad: "huh... interesting."
        this.tone(d, t, 392, 0.16, 0.18, 'triangle', 370);
        this.tone(d, t + 0.18, 440, 0.28, 0.18, 'triangle', 494);
        break;
      case 'results':
        this.tone(d, t, 660, 0.06, 0.12, 'triangle');
        this.noiseBurst(d, t, 0.08, 2500, 1.5, 0.15);
        break;
      case 'discover':
        this.tone(d, t, 784, 0.12, 0.2, 'triangle');
        this.tone(d, t + 0.1, 1175, 0.25, 0.2, 'triangle');
        break;
      case 'gate':
        this.tone(d, t, 300, 0.5, 0.3, 'sawtooth', 250);
        this.noiseBurst(d, t, 0.3, 900, 3, 0.4);
        break;
    }
  }

  /**
   * Continuous machine sounds (motors, fans, vacuums, winches). Call every
   * frame with the current intensity; loops fade out when not refreshed.
   */
  loop(key: string, kind: 'motor' | 'fan' | 'vacuum' | 'winch' | 'rocket', intensity: number, pos: Vector3) {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx;
    let l = this.loops.get(key);
    if (!l) {
      const gain = ctx.createGain();
      gain.gain.value = 0;
      const pan = ctx.createStereoPanner();
      gain.connect(pan).connect(this.master);
      const nodes: AudioNode[] = [];
      let osc: OscillatorNode | undefined;
      let filter: BiquadFilterNode | undefined;
      if (kind === 'motor' || kind === 'winch' || kind === 'vacuum') {
        osc = ctx.createOscillator();
        osc.type = kind === 'vacuum' ? 'sawtooth' : 'sawtooth';
        filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = kind === 'vacuum' ? 2500 : 900;
        osc.connect(filter).connect(gain);
        osc.start();
        nodes.push(osc, filter);
      }
      if (kind === 'fan' || kind === 'vacuum' || kind === 'rocket') {
        const src = ctx.createBufferSource();
        src.buffer = this.noise;
        src.loop = true;
        const f = ctx.createBiquadFilter();
        f.type = kind === 'rocket' ? 'lowpass' : 'bandpass';
        f.frequency.value = kind === 'fan' ? 500 : kind === 'vacuum' ? 3000 : 900;
        f.Q.value = 0.6;
        const ng = ctx.createGain();
        ng.gain.value = kind === 'rocket' ? 1.2 : 0.6;
        src.connect(f).connect(ng).connect(gain);
        src.start();
        nodes.push(src, f, ng);
        if (!filter) filter = f;
      }
      l = { nodes, gain, osc, filter, pan, last: 0 };
      this.loops.set(key, l);
    }
    const s = this.spatial(pos);
    const t = ctx.currentTime;
    const vol = { motor: 0.18, fan: 0.35, vacuum: 0.28, winch: 0.2, rocket: 0.9 }[kind] * intensity * s.gain;
    l.gain.gain.setTargetAtTime(vol, t, 0.05);
    l.pan.pan.setTargetAtTime(s.pan, t, 0.05);
    if (l.osc) {
      const base = { motor: 70, fan: 50, vacuum: 180, winch: 40, rocket: 40 }[kind];
      l.osc.frequency.setTargetAtTime(base + intensity * base * 2.2, t, 0.08);
    }
    l.last = t;
  }

  /** Fade and dispose loops that stopped being refreshed. */
  tick(dt: number, ambientPos?: Vector3) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    for (const [k, l] of this.loops) {
      if (t - l.last > 0.15) {
        l.gain.gain.setTargetAtTime(0, t, 0.08);
        if (t - l.last > 1.5) {
          for (const n of l.nodes) {
            if (n instanceof OscillatorNode || n instanceof AudioBufferSourceNode) n.stop();
            n.disconnect();
          }
          l.gain.disconnect();
          this.loops.delete(k);
        }
      }
    }
    this.ambientTimer -= dt;
    if (this.ambientTimer <= 0) {
      this.ambientTimer = 3 + Math.random() * 6;
      this.bird(ambientPos);
    }
  }

  private bird(near?: Vector3) {
    const pos = near ? near.clone().add(new Vector3((Math.random() - 0.5) * 30, 6, (Math.random() - 0.5) * 30)) : undefined;
    const o = this.out(pos, 0.25);
    if (!o) return;
    const base = 2200 + Math.random() * 1500;
    const n = 2 + Math.floor(Math.random() * 4);
    for (let i = 0; i < n; i++) this.tone(o.node, o.t + i * 0.13, base, 0.09, 0.2, 'sine', base * (1.3 + Math.random() * 0.4));
  }

  private startAmbience() {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 400;
    const g = ctx.createGain();
    g.gain.value = 0.025;
    src.connect(f).connect(g).connect(this.master);
    src.start();
  }
}
