import * as THREE from 'three';
import { Audio } from '../audio/audio';
import { getPart, PART_MAP, PARTS } from '../data/parts';
import { PROJECT_MAP, PROJECTS, STAGES, type ProjectDef } from '../data/projects';
import { EAST_FENCE_X, inZone, LOOK_HINTS, WORLD } from '../data/world';
import { buildEnvironment, type Environment } from '../render/environment';
import { ideasFor } from '../data/ideas';
import { Effects } from '../render/effects';
import { detectQuality, Renderer } from '../render/renderer';
import { BlueprintView, WorldView } from '../render/views';
import { blueprintBounds, blueprintMass, clone, newBlueprint, type Blueprint } from '../sim/blueprint';
import type { SimEvent } from '../sim/events';
import type { MachineInstance, MachinePlacement } from '../sim/machine';
import { GROUP, groups, toV } from '../sim/physics';
import { emptyInput, PLAYER, Simulation, type Item, type SimInput } from '../sim/simulation';
import { partThumb } from '../render/thumbs';
import { ActionBar, btn, h, Modal, Thought, Toasts, type ActionDef } from '../ui/dom';
import { BuildMode, type Stash } from './build';
import { CameraDirector } from './camera';
import { autoSpot, machineFits, type Area } from './autospot';
import { analyze, TestProbe, type TestReport } from './diagnostics';
import { Input } from './input';
import { RunJournal } from './journal';
import { Replay } from './replay';
import { completeProject, discover, loadSave, revealHint, sandboxParts, totalBonuses, writeSave, type SaveData, type TestSpot } from './save';

type Mode = 'title' | 'intro' | 'explore' | 'build' | 'carry' | 'replay';

const BENCH_ORIGIN = new THREE.Vector3(WORLD.workbench.pos[0], WORLD.workbench.top, WORLD.workbench.pos[2]);
const fmtTime = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

export class Game {
  r: Renderer;
  env: Environment;
  fx: Effects;
  audio = new Audio();
  input: Input;
  cam: CameraDirector;
  sim!: Simulation;
  view!: WorldView;
  replay = new Replay();
  journal = new RunJournal();
  build: BuildMode;
  save: SaveData;
  mode: Mode = 'title';
  projectId: string | null = null;
  sandbox = false;
  stash = new Map<string, number>();
  bench: Blueprint = newBlueprint();
  carrying: { bp: Blueprint; view: BlueprintView; rot: number; placement: MachinePlacement | null; valid: boolean; spot?: TestSpot } | null = null;
  running = false;
  driving = true;
  succeeded = false;
  private verdictShown = false;
  private lastThrottle = 0;
  private acc = 0;
  private last = performance.now();
  private time = 0;
  private yaw = 0;
  private pitch = 0;
  private stepT = 0;
  private introT = 0;
  private introBall: { from: THREE.Vector3; to: THREE.Vector3 } | null = null;
  private gateAnim = 0;
  private testMachine: number | null = null;
  private actionEdge = false;
  private saveTimer = 0;
  private hintTimer = 0;
  private lastLookKey = '';
  private absorbedOnce = new Set<number>();
  /** Measures each test run for the results card. */
  private probe = new TestProbe();
  private resultsEl!: HTMLElement;
  private hintBtn!: HTMLElement;
  /** Where each machine in the yard was set down, and where the kid stood. */
  private spots = new Map<number, TestSpot>();
  /** Where the machine on the bench was last tested. */
  private benchSpot: TestSpot | null = null;
  private idleNudged = false;
  private nudgePick: string | null = null;

  // UI
  ui: HTMLElement;
  private hudTop!: HTMLElement;
  private projectChip!: HTMLElement;
  private powerChip!: HTMLElement;
  private menuBtn!: HTMLElement;
  private reticle!: HTMLElement;
  private prompt!: HTMLElement;
  private actions!: ActionBar;
  private leftActions!: ActionBar;
  private toasts: Toasts;
  private thought: Thought;
  private modal: Modal;
  private stickHint!: HTMLElement;

  constructor(canvas: HTMLCanvasElement, ui: HTMLElement) {
    this.ui = ui;
    this.save = loadSave();
    this.audio.enabled = this.save.settings.sound;
    const q = detectQuality();
    this.r = new Renderer(canvas, q);
    this.env = buildEnvironment({ grassBlades: q.grass });
    this.r.scene.add(this.env.root);
    this.fx = new Effects(this.r.scene);
    this.cam = new CameraDirector(this.r.camera);
    this.input = new Input(canvas);
    this.input.sensitivity = this.save.settings.sensitivity;
    this.input.onFirstGesture = () => this.audio.unlock();
    this.input.onKey = (k) => this.key(k);
    canvas.addEventListener('click', () => {
      this.audio.unlock();
      if ((this.mode === 'explore' || this.mode === 'carry') && !this.modal.open) this.input.lockPointer();
    });
    this.toasts = new Toasts(ui);
    this.thought = new Thought(ui);
    this.modal = new Modal(ui);
    this.buildHud();
    this.build = new BuildMode(this.buildHost());
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('orientationchange', () => setTimeout(() => this.resize(), 200));
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.persist();
    });
    this.resize();
    this.newSim(PROJECT_MAP.ball_over_fence, false);
    this.showTitle();
    requestAnimationFrame((t) => this.frame(t));
  }

  private resize() {
    this.r.resize();
    this.fx.setScale(window.innerHeight);
  }

  // ================================================================== setup

  private newSim(project: ProjectDef | null, started = true) {
    this.view?.root.removeFromParent();
    this.sim?.free();
    this.sim = new Simulation({ project: started ? project : null, gateOpen: !project });
    if (!started && project) {
      // Title-screen backdrop: the prop sits where it will be.
      for (const s of project.props) this.sim.spawnItem(s);
    }
    // The lab bench starts clear: the parts bin is on the shelf beside it.
    if (started) for (const it of this.benchTopItems()) this.sim.removeItem(it.id);
    this.view = new WorldView(this.sim);
    this.r.scene.add(this.view.root);
    this.env.gate.rotation.y = 0;
    this.gateAnim = 0;
    this.running = false;
    this.succeeded = false;
    this.replay = new Replay();
    this.absorbedOnce.clear();
  }

  private buildHost() {
    const self = this;
    const stash: Stash = {
      get infinite() {
        return self.sandbox;
      },
      count: (d) => (this.sandbox ? 99 : (this.stash.get(d) ?? 0)),
      take: (d) => {
        if (this.sandbox) return true;
        const n = this.stash.get(d) ?? 0;
        if (n <= 0) return false;
        this.stash.set(d, n - 1);
        return true;
      },
      give: (d) => {
        if (this.sandbox) return;
        this.stash.set(d, (this.stash.get(d) ?? 0) + 1);
      },
      list: () => (this.sandbox ? sandboxParts().map((d) => [d, 99] as [string, number]) : [...this.stash.entries()].filter(([, n]) => n > 0)),
    };
    return {
      r: this.r,
      cam: this.cam,
      audio: this.audio,
      ui: this.ui,
      toasts: this.toasts,
      thought: this.thought,
      stash,
      benchOrigin: BENCH_ORIGIN,
      get sandbox() {
        return self.sandbox;
      },
      get hints() {
        return self.save.settings.hints;
      },
      onDone: (bp: Blueprint) => this.benchDone(bp),
      onTestOut: (bp: Blueprint) => this.goForIt(bp),
      get onHints() {
        return self.projectId && !self.sandbox ? () => self.showHints() : null;
      },
      onExit: (bp: Blueprint) => this.exitBuild(bp),
      onTest: (bp: Blueprint) => this.startTest(bp),
      onStopTest: () => this.stopTest(),
      onChange: () => this.persistSoon(),
      creations: () => this.save.creations,
      ideas: () => ideasFor(this.sandbox ? null : this.projectId),
      onBench: (d: string) => (this.stash.get(d) ?? 0) + this.build.bp.parts.filter((p) => p.def === d).length,
      saveCreation: (bp: Blueprint) => {
        this.save.creations.unshift({ name: bp.name, bp: clone(bp), savedAt: Date.now() });
        this.save.creations = this.save.creations.slice(0, 24);
        this.persist();
      },
    };
  }

  // ================================================================== HUD

  private buildHud() {
    // Tap the project card any time to see the problem and the goals again.
    this.projectChip = h('div', { class: 'chip project-chip', role: 'button' });
    this.projectChip.addEventListener('pointerup', (e) => {
      e.stopPropagation();
      const p = this.projectId ? PROJECT_MAP[this.projectId] : null;
      if (p && !this.sandbox && (this.mode === 'explore' || this.mode === 'carry')) this.showBrief(p, true);
    });
    this.projectChip.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.powerChip = h('div', { class: 'chip hidden' });
    this.menuBtn = btn('☰', () => this.showMenu(), 'small round');
    this.hintBtn = btn('💡', () => this.showHints(), 'small round hint-btn');
    this.hudTop = h('div', { class: 'topbar' }, this.projectChip, this.powerChip, h('div', { class: 'spacer' }), this.hintBtn, this.menuBtn);
    this.resultsEl = h('div', { class: 'results hidden' });
    this.resultsEl.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.ui.append(this.resultsEl);
    this.reticle = h('div', { class: 'reticle' });
    this.prompt = h('div', { class: 'prompt' });
    this.stickHint = h('div', { class: 'hint-stick hidden' }, '◀ drag to move · drag right side to look ▶');
    this.ui.append(this.hudTop, this.reticle, this.prompt, this.stickHint);
    this.actions = new ActionBar(this.ui, 'right');
    this.leftActions = new ActionBar(this.ui, 'lefttop');
  }

  private setHudVisible(on: boolean) {
    for (const el of [this.hudTop, this.reticle, this.prompt, this.actions.el, this.leftActions.el]) el.classList.toggle('hidden', !on);
  }

  // ================================================================== menus

  private showTitle() {
    this.mode = 'title';
    this.setHudVisible(false);
    this.input.unlockPointer();
    const o = this.cam.orbit;
    o.center.set(4, 1, 1);
    o.dist = 19;
    o.pitch = 0.36;
    o.yaw = 0.35;
    this.cam.set('free', true);
    const s = this.save;
    const sess = s.session;
    const next = PROJECTS.find((p) => s.unlocked.includes(p.id) && !s.completed[p.id]) ?? PROJECTS[0];
    const content: Node[] = [h('div', { class: 'logo' }, 'BACKYARD', h('span', {}, 'LAB'))];
    content.push(h('p', { class: 'muted' }, 'A kid. A problem. A yard full of junk.'));
    const row = h('div', { class: 'row', style: 'flex-direction:column' });
    if (sess) {
      const label = sess.mode === 'sandbox' ? 'Sandbox' : PROJECT_MAP[sess.project!].title;
      row.append(btn(`▶ Continue — ${label}`, () => this.resume(), 'go'));
    } else {
      row.append(btn(`▶ Play — ${next.title}`, () => this.startProject(next.id), 'go'));
    }
    row.append(btn('📋 Projects', () => this.showProjects()));
    row.append(btn(s.sandbox ? '🧪 Sandbox' : '🔒 Sandbox (finish a project)', () => (s.sandbox ? this.startSandbox() : this.audio.play('error'))));
    row.append(btn('📓 Lab Notebook', () => this.showNotebook()));
    row.append(btn('⚙ Settings', () => this.showSettings(() => this.showTitle())));
    content.push(row);
    this.modal.show(content, 'title');
  }

  private showProjects(back: () => void = () => this.showTitle()) {
    const list = h('div', { class: 'projects' });
    for (const p of PROJECTS) {
      const unlocked = this.save.unlocked.includes(p.id);
      const done = this.save.completed[p.id];
      const b = btn(
        `<span>${unlocked ? '' : '🔒 '}${p.title}<br><small class="muted">${unlocked ? p.pitch[0] : 'Solve other projects first'}</small></span><span>${done ? '⭐'.repeat(Math.max(1, done.bonuses.length)) : ''}</span>`,
        () => (unlocked ? this.startProject(p.id) : this.audio.play('error')),
        unlocked ? '' : 'ghost',
      );
      list.append(b);
    }
    this.modal.show([h('h2', {}, 'Projects'), list, h('div', { class: 'row' }, btn('Back', back))]);
  }

  private showNotebook(back: () => void = () => this.showTitle()) {
    const s = this.save;
    const tb = totalBonuses(s);
    const found = s.discovered.length;
    const total = Object.values(PART_MAP).filter((p) => p.buildable).length;
    const stages = STAGES.map((st) => {
      const projects = PROJECTS.filter((p) => p.stage === st.n);
      const done = projects.filter((p) => s.completed[p.id]).length;
      // The ideas each stage teaches, one per project: learned, and still to come.
      const ideas = projects.length ? projects.map((p) => (s.completed[p.id] ? `✓ ${p.concept.name}` : p.concept.name)) : (st.ideas ?? []);
      return h(
        'div',
        { class: `stage ${projects.length ? '' : 'locked'}` },
        h('b', {}, `Stage ${st.n}: ${st.name}`),
        h('div', { class: 'muted' }, st.tagline),
        projects.length ? h('div', {}, `${done}/${projects.length} projects solved`) : h('div', { class: 'muted' }, `Coming later: ${st.teasers.join(' · ')}`),
        ideas.length ? h('div', { class: 'stage-ideas' }, ...ideas.map((i) => h('span', { class: 'concept' }, i))) : null,
      );
    });
    this.modal.show([
      h('h2', {}, '📓 Lab Notebook'),
      h('p', {}, `Junk discovered: ${found}/${total}`),
      h('p', {}, `Bonus stars: ${tb.earned}/${tb.possible}`),
      ...stages,
      h('div', { class: 'row' }, btn('Back', back)),
    ]);
  }

  private showSettings(back: () => void) {
    const sens = h('input', { type: 'range', min: '0.3', max: '2.5', step: '0.1', value: String(this.save.settings.sensitivity) }) as HTMLInputElement;
    sens.addEventListener('input', () => {
      this.save.settings.sensitivity = Number(sens.value);
      this.input.sensitivity = this.save.settings.sensitivity;
      this.persist();
    });
    const sound = btn(this.save.settings.sound ? '🔊 On' : '🔇 Off', () => {
      this.save.settings.sound = !this.save.settings.sound;
      this.audio.setEnabled(this.save.settings.sound);
      this.persist();
      this.showSettings(back);
    }, 'small');
    const hints = btn(this.save.settings.hints ? '💭 On' : '💭 Off', () => {
      this.save.settings.hints = !this.save.settings.hints;
      this.persist();
      this.showSettings(back);
    }, 'small');
    this.modal.show([
      h('h2', {}, 'Settings'),
      h('div', { class: 'setting' }, 'Sound', sound),
      h('div', { class: 'setting' }, 'Thoughts & hints', hints),
      h('div', { class: 'setting' }, 'Look speed', sens),
      h(
        'p',
        { class: 'muted' },
        'Desktop: WASD move · mouse look · E use · B bench · G test · T tweak · H hints · Q drop · F throw · R reset/turn · C camera · Tab drive/walk · V replay · Space jump',
      ),
      h('p', { class: 'muted' }, 'Touch: left thumb moves (push far to run), right thumb looks. Buttons do the rest.'),
      h('div', { class: 'row' }, btn('Back', back)),
    ]);
  }

  private showMenu() {
    if (this.mode === 'title') return;
    this.input.unlockPointer();
    const title = this.sandbox ? 'Sandbox' : PROJECT_MAP[this.projectId!]?.title ?? '';
    const rows = h('div', { class: 'row', style: 'flex-direction:column' });
    rows.append(btn('▶ Resume', () => this.modal.hide(), 'go'));
    if (!this.sandbox && this.projectId) rows.append(btn('⟲ Restart project', () => this.startProject(this.projectId!, false)));
    rows.append(btn('📋 Projects', () => this.showProjects(() => this.showMenu())));
    if (this.save.sandbox && !this.sandbox) rows.append(btn('🧪 Sandbox', () => this.startSandbox()));
    rows.append(btn('📓 Lab Notebook', () => this.showNotebook(() => this.showMenu())));
    rows.append(btn('⚙ Settings', () => this.showSettings(() => this.showMenu())));
    rows.append(btn('🏠 Title', () => {
      this.persist();
      this.showTitle();
    }));
    this.modal.show([h('h2', {}, title), rows]);
  }

  // ================================================================== sessions

  startProject(id: string, fresh = true) {
    const p = PROJECT_MAP[id];
    if (!p) return;
    this.modal.hide();
    this.sandbox = false;
    this.projectId = id;
    const keep = !fresh ? null : this.save.session?.mode === 'project' && this.save.session.project === id ? this.save.session : null;
    this.newSim(p, true);
    this.stash.clear();
    this.bench = newBlueprint();
    this.benchSpot = null;
    this.spots.clear();
    this.hideResults();
    // The curated parts bin is waiting on the lab shelf. No fetch quest.
    for (const [id, n] of Object.entries(p.bin)) {
      this.stash.set(id, n);
      discover(this.save, id);
    }
    if (keep) this.restoreSession(keep);
    this.persist();
    this.beginIntro(p);
  }

  private resume() {
    const s = this.save.session;
    if (!s) return;
    if (s.mode === 'sandbox') this.startSandbox();
    else this.startProject(s.project!);
  }

  startSandbox() {
    this.modal.hide();
    this.sandbox = true;
    this.projectId = null;
    this.newSim(null, true);
    this.stash.clear();
    this.bench = newBlueprint();
    this.benchSpot = null;
    this.spots.clear();
    this.hideResults();
    const s = this.save.session;
    if (s?.mode === 'sandbox') this.restoreSession(s);
    // Something to play with.
    this.sim.spawnItem({ part: 'playground_ball', pos: [4, 0.2, 0] });
    this.enterExplore();
    this.thought.say('Sandbox! Every part there is, as many as I want. No rules.', 4500);
    this.persist();
  }

  private restoreSession(s: NonNullable<SaveData['session']>) {
    const bin = this.projectId && !this.sandbox ? PROJECT_MAP[this.projectId].bin : {};
    this.stash.clear();
    for (const [k, v] of Object.entries(s.stash)) this.stash.set(k, v);
    if (s.bench) this.bench = s.bench;
    this.benchSpot = s.spot ?? null;
    for (const m of s.machines) this.sim.addMachine(m.bp, m.placement);
    if (this.sandbox) return;
    const have = new Map<string, number>(this.stash);
    for (const p of this.bench.parts) have.set(p.def, (have.get(p.def) ?? 0) + 1);
    for (const m of s.machines) for (const p of m.bp.parts) have.set(p.def, (have.get(p.def) ?? 0) + 1);
    // The bin is always at least what the project hands out (older saves started empty).
    for (const [id, n] of Object.entries(bin)) {
      const short = n - (have.get(id) ?? 0);
      if (short > 0) {
        this.stash.set(id, (this.stash.get(id) ?? 0) + short);
        have.set(id, n);
      }
    }
    // Anything beyond the bin was junk carried in from the yard: it is not lying out there any more.
    for (const [d, n] of have) {
      for (let extra = n - (bin[d] ?? 0); extra > 0; extra--) {
        const it = [...this.sim.items.values()].find((i) => i.def.id === d && !i.tag);
        if (it) this.sim.removeItem(it.id);
      }
    }
  }

  private sessionData(): SaveData['session'] {
    if (this.mode === 'title' && !this.projectId && !this.sandbox) return this.save.session;
    const machines = [...this.sim.machines.values()].filter((m) => m.id !== this.testMachine).map((m) => ({ bp: m.bp, placement: m.placement }));
    if (this.carrying) machines.push({ bp: this.carrying.bp, placement: { pos: [BENCH_ORIGIN.x + 2, 0, BENCH_ORIGIN.z], yaw: 0 } });
    return {
      mode: this.sandbox ? 'sandbox' : 'project',
      project: this.projectId,
      bench: this.bench.parts.length ? this.bench : null,
      machines,
      stash: Object.fromEntries(this.stash),
      spot: this.benchSpot,
    };
  }

  persist() {
    if (this.projectId || this.sandbox) this.save.session = this.sessionData();
    writeSave(this.save);
  }

  private persistSoon() {
    this.saveTimer = 1.0;
  }

  // ================================================================== intro

  private beginIntro(p: ProjectDef) {
    this.mode = 'intro';
    this.sim.objectivesPaused = true;
    this.introT = 0;
    this.setHudVisible(false);
    this.input.unlockPointer();
    const f = new THREE.Vector3(...p.focus);
    if (p.intro === 'ballOverFence') {
      const ball = this.sim.itemByTag('target')!;
      this.introBall = { from: new THREE.Vector3(10.2, 0.2, 4.4), to: toV(ball.rb.translation()) };
      ball.rb.setTranslation({ x: 10.2, y: 0.2, z: 4.4 }, true);
      this.cam.intro.p.set(7.5, 1.3, 1.2);
      this.cam.intro.look.set(11.5, 1.2, 4.6);
    } else {
      this.introBall = null;
      const dir = new THREE.Vector3(-1, 0, -1).normalize();
      this.cam.intro.p.copy(f).addScaledVector(dir, 5).setY(Math.max(1.3, f.y * 0.6));
      this.cam.intro.look.copy(f);
    }
    this.cam.set('intro', true);
  }

  private updateIntro(dt: number) {
    this.introT += dt;
    const p = PROJECT_MAP[this.projectId!];
    if (this.introBall) {
      const ball = this.sim.itemByTag('target')!;
      const T0 = 0.5;
      const T = 1.5;
      const u = (this.introT - T0) / T;
      if (u < 0) {
        ball.rb.setTranslation({ x: this.introBall.from.x, y: 0.2, z: this.introBall.from.z }, true);
        ball.rb.setLinvel({ x: 0, y: 0, z: 0 }, true);
      } else if (u <= 1) {
        const pos = this.introBall.from.clone().lerp(this.introBall.to, u);
        pos.y = THREE.MathUtils.lerp(this.introBall.from.y, this.introBall.to.y + 0.3, u) + Math.sin(u * Math.PI) * 3.4;
        ball.rb.setTranslation(pos, true);
        ball.rb.setLinvel({ x: 0, y: 0, z: 0 }, true);
        ball.rb.setAngvel({ x: 0, y: 0, z: -12 }, true);
        if (this.introT - dt < T0) {
          this.audio.impact('rubber', 'rubber', 3, pos);
          this.fx.emit('dust', this.introBall.from, 8);
        }
        this.cam.intro.look.lerp(pos, 1 - Math.exp(-dt * 5));
      } else if (this.introBall) {
        // Drop straight down onto its spot. (It used to keep rolling and ended up metres
        // further away than the project is designed around.)
        ball.rb.setTranslation(this.introBall.to.clone().setY(this.introBall.to.y + 0.3), true);
        ball.rb.setLinvel({ x: 0, y: -1, z: 0 }, true);
        ball.rb.setAngvel({ x: 0, y: 0, z: 0 }, true);
        this.introBall = null;
      }
    }
    if (this.introT > (p.intro ? 2.6 : 1.6) && !this.modal.open) this.showBrief(p);
  }

  /**
   * UNDERSTAND: the problem, what the machine has to do (never how), and the
   * box of parts. That's the whole briefing.
   */
  private showBrief(p: ProjectDef, reopen = false) {
    this.input.unlockPointer();
    const n = PROJECTS.indexOf(p) + 1;
    // Catalogue order, so the list never hints at an intended answer.
    const order = new Map(PARTS.map((d, i) => [d.id, i]));
    const bin = Object.entries(p.bin).sort((a, b) => (order.get(a[0]) ?? 0) - (order.get(b[0]) ?? 0));
    const parts = h(
      'div',
      { class: 'bin-strip' },
      ...bin.map(([id, count]) =>
        h('div', { class: 'bin-part', title: getPart(id).name }, h('img', { src: partThumb(this.r.renderer, id), alt: '' }), h('span', {}, count > 1 ? `${getPart(id).name} ×${count}` : getPart(id).name)),
      ),
    );
    const buttons = reopen
      ? [btn('Back to it', () => this.modal.hide(), 'go'), btn('💡 Hints', () => this.showHints(), 'small')]
      : [btn('Let’s go!', () => this.afterBrief(), 'go')];
    this.modal.show(
      [
        h('div', { class: 'brief-head' }, h('span', { class: 'muted' }, `PROJECT ${n}`), h('span', { class: 'concept', title: p.concept.blurb }, `NEW IDEA: ${p.concept.name}`)),
        h('h1', {}, p.title),
        h('p', {}, p.pitch[0]),
        h('p', {}, p.pitch[1]),
        h('div', { class: 'label' }, 'YOUR MACHINE NEEDS TO:'),
        h('ul', { class: 'goals' }, ...p.goals.map((g) => h('li', {}, g))),
        h('div', { class: 'label' }, `PARTS BIN · ${bin.length} AVAILABLE`),
        parts,
        h('p', { class: 'loop' }, 'There’s no single right answer. Build something → TEST → look → change one thing → test again.'),
        h('div', { class: 'row' }, ...buttons),
      ],
      'brief',
    );
  }

  /**
   * Optional help, only ever when asked: first a few mental handles, then
   * hints that get more specific one tap at a time.
   */
  private showHints() {
    const p = this.projectId && !this.sandbox ? PROJECT_MAP[this.projectId] : null;
    if (!p) return;
    this.input.unlockPointer();
    const seen = this.save.hintsSeen[p.id] ?? 0;
    const nudges = h(
      'div',
      { class: 'nudges' },
      ...p.nudges.map((n) =>
        btn(n.word, () => {
          this.nudgePick = n.word;
          this.audio.play('ui');
          this.showHints();
        }, `small nudge ${this.nudgePick === n.word ? 'on' : ''}`),
      ),
    );
    const picked = p.nudges.find((n) => n.word === this.nudgePick);
    const list = h('ol', { class: 'hint-list' }, ...p.hints.slice(0, seen).map((t) => h('li', {}, t)));
    const labels = ['Give me a hint', 'A bit more help', 'More specific, please', 'Just tell me one way'];
    const more: HTMLElement[] = [];
    if (seen < 4) {
      more.push(
        btn(`💡 ${labels[seen]}`, () => {
          revealHint(this.save, p.id);
          this.persist();
          this.audio.play('discover');
          this.showHints();
        }, 'small blue'),
      );
    } else if (ideasFor(p.id).length) {
      more.push(btn('📐 Show me a whole machine, step by step', () => this.guideMe(), 'small'));
    }
    const back = this.mode === 'build' ? 'Back to the bench' : 'Back to it';
    this.modal.show(
      [
        h('div', { class: 'label' }, '💭 WHAT ARE YOU THINKING?'),
        nudges,
        picked ? h('p', { class: 'nudge-line' }, `“${picked.line}”`) : h('p', { class: 'muted' }, 'Pick a word. It’s just a thought to chew on.'),
        h('div', { class: 'label' }, `💡 HINTS${seen ? ` · ${seen} of 4` : ''}`),
        seen ? list : h('p', { class: 'muted' }, 'Hints start vague and get more specific. Only if you want them!'),
        h('div', { class: 'row' }, ...more, btn(back, () => this.modal.hide(), 'go')),
      ],
      'hints',
    );
  }

  /** The last-resort hint: a step-by-step build at the bench. */
  private guideMe() {
    this.modal.hide();
    if (this.mode !== 'build') this.goToBench();
    setTimeout(() => this.mode === 'build' && this.build.showIdea(), 300);
  }

  private afterBrief() {
    this.modal.hide();
    if (this.introBall) {
      // Skipped the intro: put the ball where it was going to land.
      const ball = this.sim.itemByTag('target');
      ball?.rb.setTranslation(this.introBall.to, true);
      ball?.rb.setLinvel({ x: 0, y: 0, z: 0 }, true);
      this.introBall = null;
    }
    this.sim.objectivesPaused = false;
    this.audio.unlock();
    this.enterExplore();
    this.idleNudged = false;
    if (this.save.settings.hints && this.projectId && !Object.keys(this.save.completed).length) {
      setTimeout(() => this.mode === 'explore' && this.thought.say('My parts bin is in the lab. Tap 🔧 BENCH to start building.', 5000), 900);
      setTimeout(() => this.input.touchMode && this.stickHint.classList.remove('hidden'), 100);
      setTimeout(() => this.stickHint.classList.add('hidden'), 9000);
    }
  }

  // ================================================================== explore

  private enterExplore() {
    this.mode = 'explore';
    this.setHudVisible(true);
    this.yaw = this.sim.yaw;
    this.pitch = 0;
    this.cam.set('eyes', false, 0.8);
    this.driving = true;
  }

  private buildInput(dt: number): SimInput {
    const inp = emptyInput();
    const [dx, dy] = this.input.consumeLook();
    const fp = this.mode === 'explore' || this.mode === 'carry';
    const rcActive = this.running && this.driving && this.anyReceiver();
    if (fp && !this.modal.open) {
      if (this.cam.mode === 'eyes' || this.cam.mode === 'chase' || this.cam.mode === 'wide') {
        if (this.cam.mode === 'eyes') {
          this.yaw -= dx;
          this.pitch = THREE.MathUtils.clamp(this.pitch - dy, -1.35, 1.35);
        }
      }
      if (this.cam.mode === 'free') {
        this.cam.orbit.yaw -= dx;
        this.cam.orbit.pitch = THREE.MathUtils.clamp(this.cam.orbit.pitch + dy * 0.8, 0.05, 1.4);
      }
      if (rcActive) {
        inp.rc.throttle = this.input.move.y;
        inp.rc.steer = this.input.move.x;
      } else if (this.cam.mode === 'eyes') {
        inp.moveX = this.input.move.x;
        inp.moveZ = this.input.move.y;
        inp.sprint = this.input.sprint;
        inp.jump = this.input.jump;
      }
    }
    inp.yaw = this.yaw;
    inp.pitch = this.pitch;
    inp.rc.action = this.actionEdge;
    this.actionEdge = false;
    this.lastThrottle = inp.rc.throttle;
    void dt;
    return inp;
  }

  private anyReceiver(): boolean {
    for (const m of this.sim.machines.values()) if (m.state === 'running' && m.hasReceiver()) return true;
    return false;
  }

  private frozenMachines(): MachineInstance[] {
    return [...this.sim.machines.values()].filter((m) => m.state === 'frozen' && m.id !== this.testMachine);
  }

  private nearBench(): boolean {
    const p = toV(this.sim.player!.translation());
    return Math.hypot(p.x - BENCH_ORIGIN.x, p.z - BENCH_ORIGIN.z) < 2.3;
  }

  private nearGateFromOutside(): boolean {
    const p = toV(this.sim.player!.translation());
    return !this.sim.gateOpen && p.x > EAST_FENCE_X + 0.1 && p.x < EAST_FENCE_X + 2.2 && p.z > -5.2 && p.z < -2;
  }

  private exploreActions(): ActionDef[] {
    const a: ActionDef[] = [];
    const touch = this.input.touchMode;
    const k = (s: string) => (touch ? '' : ` <small>[${s}]</small>`);
    const sim = this.sim;
    const look = this.lookTarget();
    if (this.mode === 'carry' && this.carrying) {
      a.push({ id: 'place', label: `📍 PLACE${k('E')}`, cls: this.carrying.valid ? 'primary' : '', onPress: () => this.placeCarried() });
      a.push({ id: 'rot', label: `↻ TURN${k('R')}`, onPress: () => this.rotateCarried() });
      const site = this.projectId && !this.sandbox ? PROJECT_MAP[this.projectId].site : null;
      if (site && this.distTo(site.pos) > 3) a.push({ id: 'site', label: `🏃 ${site.label}`, onPress: () => this.goToSite() });
      if (this.nearBench() && !this.bench.parts.length) a.push({ id: 'tobench', label: '🔧 ON BENCH', onPress: () => this.carriedToBench() });
      if (touch) a.push({ id: 'jump', label: '⤒', onPress: () => this.tapJump() });
      return a;
    }
    if (sim.carried) {
      a.push({ id: 'throw', label: `🤾 THROW${k('F')}`, onPress: () => this.throwItem() });
      a.push({ id: 'drop', label: `✋ DROP${k('Q')}`, cls: 'primary', onPress: () => this.dropItem() });
    } else if (look?.kind === 'item') {
      a.push({ id: 'pick', label: `✊ PICK UP${k('E')}`, cls: 'primary', onPress: () => this.pickUp(look.item) });
    } else if (look?.kind === 'machine' && look.machine.state === 'frozen' && look.machine.id !== this.testMachine) {
      a.push({ id: 'pickm', label: `✊ PICK UP MACHINE${k('E')}`, cls: 'primary', onPress: () => this.pickUpMachine(look.machine) });
    } else if (this.nearBench()) {
      a.push({ id: 'build', label: `🔧 BUILD${k('E')}`, cls: 'primary', onPress: () => this.enterBuild() });
    } else if (this.nearGateFromOutside()) {
      a.push({ id: 'gate', label: `🔓 OPEN GATE${k('E')}`, cls: 'primary', onPress: () => this.openGate() });
    } else if (!this.running) {
      // The bench is one tap away from anywhere: ideas should not wait on a long walk.
      a.push({ id: 'bench', label: `🔧 BENCH${k('B')}`, onPress: () => this.goToBench() });
    }
    if (touch && !(this.running && this.driving && this.anyReceiver())) a.push({ id: 'jump', label: '⤒', onPress: () => this.tapJump() });
    return a;
  }

  private runActions(): ActionDef[] {
    const a: ActionDef[] = [];
    const touch = this.input.touchMode;
    const k = (s: string) => (touch ? '' : ` <small>[${s}]</small>`);
    if (this.running) {
      a.push({ id: 'stop', label: `■ STOP${k('R')}`, cls: 'danger', onPress: () => this.resetRun() });
      if (this.projectId && !this.sandbox) a.push({ id: 'retry', label: `↺ RETRY${k('G')}`, onPress: () => this.retry() });
      a.push({ id: 'build', label: `🔧 BUILD${k('T')}`, onPress: () => this.tweakMachine() });
      const camLabel = { eyes: '👀', chase: '🎥', wide: '🗺', free: '✋', bench: '🎥', intro: '🎥' }[this.cam.mode];
      a.push({ id: 'cam', label: `${camLabel}${k('C')}`, onPress: () => this.cycleCamera() });
      if (this.anyReceiver()) {
        a.push({ id: 'drive', label: this.driving ? `🎮 DRIVING${k('Tab')}` : `🚶 WALKING${k('Tab')}`, onPress: () => this.toggleDrive() });
        a.push({ id: 'act', label: `⚡ SWITCH${k('X')}`, onPress: () => this.pressAction() });
      }
    } else if (this.frozenMachines().length && this.mode === 'explore') {
      a.push({ id: 'go', label: `▶ TEST${k('G')}`, cls: 'go test-btn', onPress: () => this.go() });
      a.push({ id: 'tweak', label: `🔧 BUILD${k('T')}`, onPress: () => this.tweakMachine() });
      a.push({ id: 'turn', label: `↻ TURN${k('Y')}`, onPress: () => this.turnMachine() });
    }
    if (!this.running && this.replay.available && this.mode === 'explore') a.push({ id: 'replay', label: `⏺ REPLAY${k('V')}`, onPress: () => this.startReplay() });
    return a;
  }

  private lookTarget() {
    if (this.cam.mode !== 'eyes' || !this.sim.player) return null;
    return this.sim.lookTarget();
  }

  private updatePrompt() {
    const look = this.mode === 'explore' ? this.lookTarget() : null;
    let html = '';
    let key = '';
    if (look?.kind === 'item') {
      const d = look.item.def;
      key = `i${look.item.id}`;
      const heavy = d.mass > PLAYER.carryLimit ? ' (too heavy!)' : '';
      html = `<b>${d.name}${heavy}</b><span>${d.hint}</span><div class="traits">${d.traits.map((t) => `<span class="trait">${t}</span>`).join('')}<span class="trait">${d.mass < 1 ? `${Math.round(d.mass * 1000)} g` : `${d.mass} kg`}</span></div>`;
    } else if (look?.kind === 'machine') {
      key = `m${look.machine.id}`;
      html = `<b>${look.machine.bp.name}</b><span>${blueprintMass(look.machine.bp).toFixed(1)} kg of pure genius</span>`;
    } else if (look?.kind === 'static' && look.id && LOOK_HINTS[look.id] && look.point.distanceTo(this.sim.eye()) < 3.2) {
      key = `s${look.id}`;
      html = `<span>${LOOK_HINTS[look.id]}</span>`;
    }
    if (key !== this.lastLookKey) {
      this.lastLookKey = key;
      this.prompt.innerHTML = html;
    }
    this.reticle.classList.toggle('on', look?.kind === 'item' || look?.kind === 'machine');
  }

  // ---- item actions

  private pickUp(it: Item) {
    const r = this.sim.pickUp(it);
    if (!r.ok) {
      this.toasts.show(r.reason ?? "Can't", 'bad');
      this.audio.play('error');
    }
  }

  private dropItem() {
    this.sim.drop(0);
  }

  private throwItem() {
    this.sim.drop(8.5);
  }

  private tapJump() {
    this.input.jump = true;
    setTimeout(() => (this.input.jump = this.input.keys.has(' ')), 180);
  }

  private openGate() {
    this.sim.openGate();
    this.gateAnim = 0.001;
    this.audio.play('gate', new THREE.Vector3(EAST_FENCE_X, 1, -3.6));
    this.thought.say('Ha. It only locks from this side.', 3000);
  }

  // ================================================================== building

  /** Junk lying on the workbench top (the kid put it there). */
  private benchTopItems(): Item[] {
    const wb = WORLD.workbench;
    return [...this.sim.items.values()].filter((it) => {
      const p = it.rb.translation();
      return !it.tag && Math.abs(p.x - wb.pos[0]) < wb.half[0] + 0.1 && Math.abs(p.z - wb.pos[2]) < wb.half[1] + 0.1 && p.y > wb.top - 0.05 && p.y < wb.top + 1;
    });
  }

  /** Extra junk the kid found and put on the bench goes into the parts bin. */
  private absorbBench() {
    if (this.sandbox) return;
    for (const it of this.benchTopItems()) this.addToBin(it);
  }

  private addToBin(it: Item) {
    if (!it.def.buildable || it.tag) return;
    this.stash.set(it.def.id, (this.stash.get(it.def.id) ?? 0) + 1);
    if (discover(this.save, it.def.id)) this.persistSoon();
    this.sim.removeItem(it.id);
    this.toasts.show(`📦 Found a <b>${it.def.name}</b>. It’s in the parts bin now.`, 'new', 2600);
  }

  enterBuild() {
    if (this.sim.carried) {
      const it = this.sim.carried.item;
      this.sim.drop(0);
      if (!this.sandbox) this.addToBin(it);
    }
    this.absorbBench();
    this.hideResults();
    this.mode = 'build';
    this.input.unlockPointer();
    this.input.enabled = false;
    this.input.reset();
    this.setHudVisible(false);
    this.thought.hide();
    document.body.classList.add('building');
    this.build.enter(this.bench);
  }

  private exitBuild(bp: Blueprint) {
    this.bench = bp;
    document.body.classList.remove('building');
    this.build.exit();
    this.input.enabled = true;
    this.enterExplore();
    this.persist();
  }

  private benchDone(bp: Blueprint) {
    this.leaveBench();
    this.bench = newBlueprint();
    this.benchSpot = null;
    this.startCarry(bp);
    this.thought.say(`Where should the ${bp.name} go? Set it down, then hit ▶ TEST.`, 4000);
    this.persist();
  }

  private leaveBench() {
    document.body.classList.remove('building');
    this.build.exit();
    this.input.enabled = true;
  }

  /** Where GO FOR IT works: at the project's problem, or out on the lawn in the sandbox. */
  private area(): Area & { stand: TestSpot['player']; yaw: number } {
    const p = this.projectId && !this.sandbox ? PROJECT_MAP[this.projectId] : null;
    if (!p) return { approach: new THREE.Vector3(0, 0, -1.5), site: new THREE.Vector3(0, 0, -4.5), target: null, zone: 'home_yard', stand: [0, 0, -4.5], yaw: Math.PI };
    const t = this.sim.itemByTag('target');
    return { approach: new THREE.Vector3(...p.approach), site: new THREE.Vector3(...p.site.pos), target: t ? toV(t.rb.translation()) : null, zone: 'home_yard', stand: p.site.pos, yaw: p.site.yaw };
  }

  /**
   * 🚀 GO FOR IT: straight from the bench to a running test. The machine sets itself
   * down at the problem (or wherever it was tested last), facing it, and starts.
   */
  private goForIt(bp: Blueprint) {
    const a = this.area();
    const last = this.benchSpot && machineFits(this.sim, bp, this.benchSpot.placement) ? this.benchSpot : null;
    const placement = last?.placement ?? autoSpot(this.sim, bp, a);
    if (!placement) {
      this.toasts.show('Couldn’t find a spot for it. Set it down yourself!', '', 2600);
      this.benchDone(bp);
      return;
    }
    const spot: TestSpot = last ?? { placement, player: a.stand, yaw: a.yaw };
    this.leaveBench();
    this.bench = newBlueprint();
    this.benchSpot = null;
    const m = this.sim.addMachine(bp, placement);
    this.spots.set(m.id, spot);
    this.sim.teleportPlayer(spot.player, spot.yaw);
    this.enterExplore();
    this.audio.play('attach', new THREE.Vector3(...placement.pos));
    this.fx.emit('dust', new THREE.Vector3(placement.pos[0], 0.05, placement.pos[2]), 14);
    this.go();
    this.persist();
  }

  /** ↺ RETRY: stop, put everything back where it started, and run it again. */
  private retry() {
    this.startOver();
    this.go();
  }

  /** Walk-free trip to the workbench. */
  private goToBench() {
    if (this.running) this.resetRun();
    const wb = WORLD.workbench;
    this.sim.teleportPlayer([wb.pos[0] + 1.4, 0, wb.pos[2]], Math.PI / 2);
    this.yaw = this.sim.yaw;
    this.enterBuild();
  }

  /** Carrying a machine: jump to a good spot next to the problem. */
  private goToSite() {
    const p = this.projectId ? PROJECT_MAP[this.projectId] : null;
    if (!p) return;
    this.sim.teleportPlayer(p.site.pos, p.site.yaw);
    this.yaw = this.sim.yaw;
    this.pitch = -0.25;
    this.audio.play('whoosh');
  }

  private distTo(v: [number, number, number]) {
    const p = this.sim.player!.translation();
    return Math.hypot(p.x - v[0], p.z - v[2]);
  }

  /** Where the kid's feet are, for "stand here to watch it again". */
  private feet(): [number, number, number] {
    const p = this.sim.player!.translation();
    return [p.x, Math.max(0, p.y - PLAYER.halfHeight - PLAYER.radius - 0.02), p.z];
  }

  /** 🔧 TWEAK: take the machine you're testing back to the bench, remembering where it stood. */
  private tweakMachine(target?: MachineInstance) {
    if (this.running) this.resetRun();
    const look = this.lookTarget();
    const candidates = this.frozenMachines();
    const m = target ?? (look?.kind === 'machine' && candidates.includes(look.machine) ? look.machine : candidates[candidates.length - 1]);
    if (!m) return;
    this.hideResults();
    // Something already on the bench gets set down on the garage floor, not thrown away.
    if (this.bench.parts.length) this.parkBench();
    this.benchSpot = this.spots.get(m.id) ?? { placement: m.placement, player: this.feet(), yaw: this.yaw };
    this.spots.delete(m.id);
    this.sim.removeMachine(m.id);
    this.bench = m.bp;
    this.audio.play('pickup');
    this.goToBench();
    this.persist();
  }

  /** ↻ TURN: spin a machine standing in the yard 45° on the spot, so aiming never needs a trip to the bench. */
  private turnMachine(towardTarget = false) {
    if (this.running) this.resetRun();
    const look = this.lookTarget();
    const candidates = this.frozenMachines();
    const m = look?.kind === 'machine' && candidates.includes(look.machine) ? look.machine : candidates[candidates.length - 1];
    if (!m) return;
    this.hideResults();
    const b = blueprintBounds(m.bp);
    const mid = b.min.clone().add(b.max).multiplyScalar(0.5).setY(0);
    const up = new THREE.Vector3(0, 1, 0);
    const pos = new THREE.Vector3(...m.placement.pos);
    const c = mid.clone().applyAxisAngle(up, m.placement.yaw).add(pos);
    // Toward the target: the nearest 45° step that points its vacuum / fan at it. Otherwise one step round.
    let steps = [1, 2, 3];
    const target = this.sim.itemByTag('target');
    const air = m.bp.parts.find((p) => getPart(p.def).behaviors.some((x) => x.type === 'suction' || x.type === 'airflow'));
    if (towardTarget && target && air) {
      const beh = getPart(air.def).behaviors.find((x) => x.type === 'suction' || x.type === 'airflow')!;
      const wp = m.partWorldPose(air.uid)!;
      const axis = new THREE.Vector3(...(beh as { axis: [number, number, number] }).axis).applyQuaternion(wp.q).setY(0);
      const to = toV(target.rb.translation()).sub(wp.p).setY(0);
      const ang = Math.atan2(axis.clone().cross(to).y, axis.dot(to));
      const n = Math.round(ang / (Math.PI / 4)) || Math.sign(ang) || 1;
      steps = [n, n + Math.sign(n), n - Math.sign(n)].filter((x) => x !== 0);
    }
    for (const step of steps) {
      const turn = (Math.PI / 4) * step;
      const np = pos.clone().sub(c).applyAxisAngle(up, turn).add(c);
      const pl: MachinePlacement = { pos: [np.x, np.y, np.z], yaw: m.placement.yaw + turn };
      if (!machineFits(this.sim, m.bp, pl)) continue;
      const spot = this.spots.get(m.id);
      this.sim.removeMachine(m.id);
      const fresh = this.sim.addMachine(m.bp, pl);
      this.spots.set(fresh.id, { placement: pl, player: spot?.player ?? this.feet(), yaw: spot?.yaw ?? this.yaw });
      this.spots.delete(m.id);
      this.audio.play('ratchet', c);
      this.persistSoon();
      return;
    }
    this.toasts.show('No room to turn it here.', '', 2000);
    this.audio.play('error');
  }

  private parkBench() {
    const wb = WORLD.workbench;
    const b = blueprintBounds(this.bench);
    for (const [x, z] of [[wb.pos[0] + 0.3, wb.pos[2] + 2.2], [wb.pos[0] + 0.3, wb.pos[2] - 2.2], [wb.pos[0] + 2.2, wb.pos[2] + 2.5]]) {
      const pl: MachinePlacement = { pos: [x, -b.min.y + 0.03, z], yaw: 0 };
      if (machineFits(this.sim, this.bench, pl)) {
        this.sim.addMachine(this.bench, pl);
        this.toasts.show('I set the bench machine down on the garage floor.', '', 2600);
        this.bench = newBlueprint();
        return;
      }
    }
    for (const p of this.bench.parts) this.stash.set(p.def, (this.stash.get(p.def) ?? 0) + 1);
    this.toasts.show('The bench parts went back in the bin.', '', 2600);
    this.bench = newBlueprint();
  }

  private startTest(bp: Blueprint) {
    const m = this.sim.addMachine(clone(bp), { pos: [BENCH_ORIGIN.x, BENCH_ORIGIN.y + 0.002, BENCH_ORIGIN.z], yaw: 0 });
    this.testMachine = m.id;
    m.go();
    this.audio.play('go');
    this.journal.begin(this.sim);
  }

  private stopTest() {
    if (this.testMachine !== null) this.sim.removeMachine(this.testMachine);
    this.testMachine = null;
  }

  // ================================================================== carrying machines

  private startCarry(bp: Blueprint, spot?: TestSpot) {
    const view = new BlueprintView(bp);
    this.r.scene.add(view.group);
    this.carrying = { bp, view, rot: 0, placement: null, valid: false, spot };
    this.mode = 'carry';
    this.setHudVisible(true);
    this.yaw = this.sim.yaw;
    this.cam.set('eyes', false, 0.8);
  }

  private rotateCarried() {
    if (!this.carrying) return;
    this.carrying.rot += Math.PI / 4;
    this.audio.play('ui');
  }

  private updateCarry() {
    const c = this.carrying;
    if (!c) return;
    const eye = this.sim.eye();
    const look = this.sim.look();
    const b = blueprintBounds(c.bp);
    const size = b.max.clone().sub(b.min);
    const reach = 1.4 + Math.max(size.x, size.z) * 0.6;
    const flat = look.clone().setY(0).normalize();
    let target = eye.clone().addScaledVector(flat, reach);
    const hit = this.sim.physics.raycast(eye, look, reach + 2.5, groups(0xffff, GROUP.STATIC));
    if (hit && hit.normal.y > 0.7) target = hit.point;
    const down = this.sim.physics.raycast(new THREE.Vector3(target.x, Math.min(eye.y + 0.9, target.y + 1.5), target.z), new THREE.Vector3(0, -1, 0), 6, groups(0xffff, GROUP.STATIC), undefined, (col) => {
      const t = this.sim.physics.tags.get(col.handle);
      return !t || t.owner.kind === 'static';
    });
    const groundY = down ? down.point.y : 0;
    const yaw = this.yaw + c.rot;
    // Centre the machine's footprint on the target point.
    const mid = b.min.clone().add(b.max).multiplyScalar(0.5).setY(0).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    const pos: [number, number, number] = [target.x - mid.x, groundY - b.min.y + 0.01, target.z - mid.z];
    c.placement = { pos, yaw };
    c.valid = machineFits(this.sim, c.bp, c.placement) && Math.hypot(target.x - eye.x, target.z - eye.z) > 0.5;
    c.view.group.position.set(...pos);
    c.view.group.rotation.set(0, yaw, 0);
    c.view.setGhost(c.valid ? null : 0xff4030);
  }

  private placeCarried() {
    const c = this.carrying;
    if (!c || !c.placement) return;
    if (!c.valid) {
      this.audio.play('error');
      this.toasts.show("It won't fit there", 'bad');
      return;
    }
    c.view.group.removeFromParent();
    const m = this.sim.addMachine(c.bp, c.placement);
    this.spots.set(m.id, { placement: c.placement, player: this.feet(), yaw: this.yaw });
    this.audio.play('attach', new THREE.Vector3(...c.placement.pos));
    this.fx.emit('dust', new THREE.Vector3(c.placement.pos[0], 0.05, c.placement.pos[2]), 14);
    this.carrying = null;
    this.mode = 'explore';
    if (this.save.settings.hints && !Object.keys(this.save.completed).length) this.thought.say('Ready? Hit ▶ TEST and see what happens.', 3000);
    this.persist();
  }

  private carriedToBench() {
    const c = this.carrying;
    if (!c) return;
    c.view.group.removeFromParent();
    this.bench = c.bp;
    this.benchSpot = c.spot ?? null;
    this.carrying = null;
    this.enterBuild();
  }

  private pickUpMachine(m: MachineInstance) {
    if (this.running) {
      this.toasts.show('Reset first!', 'bad');
      return;
    }
    const mass = blueprintMass(m.bp);
    const spot = this.spots.get(m.id);
    this.spots.delete(m.id);
    this.sim.removeMachine(m.id);
    this.startCarry(m.bp, spot);
    if (mass > 30) this.thought.say(`Oof. ${mass.toFixed(0)} kg. This is heavy.`, 2500);
    this.audio.play('pickup');
  }

  // ================================================================== running machines

  go() {
    if (this.running || !this.frozenMachines().length) return;
    this.hideResults();
    this.probe.begin(this.sim, this.projectId && !this.sandbox ? PROJECT_MAP[this.projectId] : null, this.testMachine);
    this.sim.goAll();
    this.running = true;
    this.verdictShown = false;
    this.journal.begin(this.sim);
    this.replay.start();
    this.audio.play('go');
    this.thought.hide();
    this.driving = true;
    this.input.unlockPointer();
    // Watch it work: pull back behind the kid's shoulder and orbit the action.
    if (this.anyReceiver()) this.cam.set('chase', false, 1.0);
    else {
      const s = this.subject() ?? this.sim.eye();
      const o = this.cam.orbit;
      const eye = this.sim.eye();
      o.center.copy(s);
      o.pitch = 0.42;
      o.dist = THREE.MathUtils.clamp(eye.distanceTo(s) + 2.5, 3.5, 8);
      // Watch the machine AND what it is after, from high enough to see over fences.
      const t = this.projectId ? this.sim.itemByTag('target') : undefined;
      if (t) {
        const tp = toV(t.rb.translation());
        const d = tp.distanceTo(s);
        if (d < 10) {
          o.center.copy(s).lerp(tp, 0.5);
          o.dist = THREE.MathUtils.clamp(d * 1.1 + 3, 4, 10);
          o.pitch = 0.62;
        }
      }
      o.yaw = Math.atan2(eye.x - o.center.x, eye.z - o.center.z);
      this.cam.set('free', false, 1.0);
    }
    this.persistSoon();
  }

  resetRun() {
    if (!this.running) return;
    const report = !this.succeeded && !this.verdictShown && this.journal.worthMentioning() ? this.report() : null;
    for (const m of [...this.sim.machines.values()]) if (m.id !== this.testMachine) this.sim.resetMachine(m.id);
    this.running = false;
    this.verdictShown = true;
    this.replay.stop();
    this.cam.set('eyes', false, 0.8);
    if (report) this.showResults(report);
  }

  /** Start over: machines back where they were set down, and the target back where it started. */
  private startOver() {
    if (this.running) this.resetRun();
    const t = this.sim.itemByTag('target');
    if (t && !this.succeeded && this.sim.carried?.item !== t) this.sim.respawnItem(t);
    this.hideResults();
    this.audio.play('ui');
  }

  private report(): TestReport {
    const p = this.projectId && !this.sandbox ? PROJECT_MAP[this.projectId] : null;
    return analyze(this.probe.finish(this.succeeded), p);
  }

  /**
   * LEARN: what the test showed, as a few gauges and one plain observation,
   * with the next step (reset, start over, tweak) one tap away.
   */
  private showResults(r: TestReport) {
    if (this.sandbox && r.mood === 'learned' && r.observation === 'Interesting result!') return;
    this.audio.play('hmm');
    const seg = (v: number | null) => {
      const n = v === null ? 0 : Math.round(v * 10);
      return h('div', { class: `gauge-bar ${v === null ? 'na' : v < 0.45 ? 'low' : v < 0.8 ? 'mid' : 'high'}` }, ...Array.from({ length: 10 }, (_, i) => h('i', { class: i < n ? 'on' : '' })));
    };
    const rows = r.gauges.map((g) => h('div', { class: 'gauge' }, h('b', {}, g.label), seg(g.value), h('small', {}, g.value === null ? `— ${g.note}` : g.note)));
    const canTweak = [...this.sim.machines.values()].some((m) => m.id !== this.testMachine);
    const parts: Node[] = [
      h('div', { class: 'results-head' }, h('span', {}, '🔬 TEST RESULTS'), btn('✕', () => this.hideResults(), 'small round close')),
      h('div', { class: 'gauges' }, ...rows),
      h('div', { class: 'label' }, '👀 WHAT HAPPENED'),
      h('p', { class: 'obs' }, r.observation),
    ];
    if (r.tryNext) parts.push(h('p', { class: 'try' }, `💭 ${r.tryNext}`));
    this.resultsEl.replaceChildren(
      ...parts,
      h(
        'div',
        { class: 'row' },
        this.running ? btn('■ Stop', () => {
          this.resetRun();
          this.hideResults();
        }, 'small') : null,
        canTweak ? btn('↺ Retry', () => this.retry(), 'small') : null,
        r.fix === 'turn' && canTweak ? btn(`↻ Turn it toward the ${this.projectId ? PROJECT_MAP[this.projectId].target : 'target'}`, () => this.turnMachine(true), 'small primary') : null,
        canTweak ? btn('🔧 Back to build', () => this.tweakMachine(), r.fix ? 'small' : 'small primary') : null,
      ),
    );
    this.resultsEl.classList.remove('hidden');
    document.body.classList.add('has-results');
  }

  private hideResults() {
    this.resultsEl?.classList.add('hidden');
    document.body.classList.remove('has-results');
  }

  private cycleCamera() {
    const order = ['eyes', 'chase', 'wide', 'free'] as const;
    const i = order.indexOf(this.cam.mode as (typeof order)[number]);
    const next = order[(i + 1) % order.length];
    if (next === 'free') {
      const s = this.subject();
      this.cam.orbit.center.copy(s ?? this.sim.eye());
      this.cam.orbit.dist = 5;
      this.cam.orbit.pitch = 0.5;
    }
    this.cam.set(next);
    this.audio.play('ui');
  }

  private toggleDrive() {
    this.driving = !this.driving;
    if (!this.driving) this.cam.set('eyes');
    else this.cam.set('chase');
    this.audio.play('ui');
  }

  private pressAction() {
    this.actionEdge = true;
  }

  /** The thing most worth watching right now. */
  private subject(): THREE.Vector3 | null {
    let best: { v: THREE.Vector3; s: number } | null = null;
    for (const m of this.sim.machines.values()) {
      if (m.id === this.testMachine && this.mode !== 'build') continue;
      if (m.state !== 'running' && this.running) continue;
      let speed = 0;
      for (const b of m.bodies) speed = Math.max(speed, toV(b.rb.linvel()).length());
      const s = speed + (m.hasReceiver() ? 5 : 0);
      if (!best || s > best.s) best = { v: m.center(), s };
    }
    const t = this.sim.itemByTag('target');
    if (t) {
      const sp = toV(t.rb.linvel()).length();
      if (sp > 1.5 && (!best || sp > best.s)) best = { v: toV(t.rb.translation()), s: sp };
    }
    return best?.v ?? null;
  }

  private startReplay() {
    if (this.running) this.resetRun();
    if (!this.replay.play(1)) return;
    this.mode = 'replay';
    this.input.unlockPointer();
    const s = this.subject() ?? this.sim.eye();
    this.cam.orbit.center.copy(s);
    this.cam.orbit.dist = 6;
    this.cam.orbit.pitch = 0.45;
    this.cam.set('free');
    this.actions.set([
      { id: 'stopreplay', label: '■ STOP', cls: 'danger', onPress: () => this.stopReplay() },
      { id: 'slow', label: '🐢 SLOW-MO', onPress: () => (this.replay.speed = this.replay.speed === 1 ? 0.3 : 1) },
    ]);
    this.leftActions.set([]);
  }

  private stopReplay() {
    this.replay.stopPlay();
    this.mode = 'explore';
    this.cam.set('eyes');
  }

  // ================================================================== events

  private handleEvents() {
    const evs = this.sim.drainEvents();
    for (const e of evs) {
      if (this.running || this.testMachine !== null) this.journal.event(e);
      if (this.running) this.probe.event(e);
      this.eventFx(e);
    }
    for (const oe of this.sim.objectiveEvents.splice(0)) {
      if (oe.type === 'success') this.onSuccess(oe.bonuses, oe.time);
      if (oe.type === 'fail') {
        this.toasts.show(oe.message, '', 4000);
        this.audio.play('hmm');
      }
      if (oe.type === 'bonusLost' && this.save.settings.hints) this.toasts.show(`☆ ${oe.def.label}: not this time`, '', 1800);
    }
  }

  private eventFx(e: SimEvent) {
    const A = this.audio;
    switch (e.type) {
      case 'impact': {
        if (e.impulse > 0.35) A.impact(e.mat, e.other, e.impulse, e.pos);
        const ground = e.mat === 'grass' || e.other === 'grass' || e.mat === 'dirt' || e.other === 'dirt';
        if (e.impulse > 2 && ground) this.fx.emit('dust', e.pos.clone().setY(0.05), Math.min(14, Math.floor(e.impulse)), { speed: Math.min(3, e.impulse / 4) });
        if (e.impulse > 3 && (e.mat === 'metal' || e.other === 'metal')) this.fx.emit('spark', e.pos, 8);
        break;
      }
      case 'break':
        A.play('break', e.pos);
        this.fx.emit('chip', e.pos, 16);
        this.fx.emit('dust', e.pos, 8);
        break;
      case 'snap':
        A.play('snap', e.pos);
        this.fx.emit('chip', e.pos, 6, { color: 0xc9a66b });
        break;
      case 'stick':
        A.play('stick', e.pos);
        break;
      case 'unstick':
        A.play('unstick', e.pos);
        break;
      case 'suck':
        A.play('suck', e.pos);
        break;
      case 'unsnag':
        A.play('snap', e.pos, 0.6);
        this.fx.emit('chip', e.pos, 10, { color: 0x4f8a36 });
        break;
      case 'ignite':
        A.play('ignite', e.pos);
        this.fx.emit('smoke', e.pos, 20, { dir: new THREE.Vector3(0, -1, 0), speed: 2 });
        break;
      case 'click':
        A.play('squeak', e.pos);
        break;
      case 'ding':
        A.play('ding', e.pos);
        break;
      case 'toggle':
        A.play('click', e.pos);
        break;
      case 'live':
        A.play('click', e.pos, 0.6);
        break;
      case 'brownout':
        A.play('brownout', e.pos);
        break;
      case 'batteryDead':
        A.play('brownout', e.pos, 0.5);
        break;
      case 'bounce':
        A.play('boing', e.pos);
        break;
      case 'jump':
        A.play('jump', e.pos, 0.6);
        break;
      case 'land':
        A.play('land', e.pos, Math.min(1, e.speed / 6));
        if (e.speed > 4) this.fx.emit('dust', e.pos, 8);
        break;
      case 'pickup': {
        A.play('pickup', e.pos);
        if (discover(this.save, e.part)) {
          const d = getPart(e.part);
          this.toasts.show(`✨ Found: <b>${d.name}</b> — ${d.traits.join(', ')}`, 'new', 3200);
          A.play('discover');
          this.persistSoon();
        }
        break;
      }
      case 'drop':
        A.play('drop', e.pos);
        break;
      case 'throw':
        A.play('throw', e.pos);
        break;
    }
  }

  private onSuccess(bonuses: { def: { id: string; label: string }; earned: boolean }[], time: number) {
    if (this.succeeded || !this.projectId) return;
    this.succeeded = true;
    this.hideResults();
    const p = PROJECT_MAP[this.projectId];
    const byMachine = this.running && bonuses.some((b) => b.def.id === 'hands_off' && b.earned);
    const unlocked = completeProject(this.save, this.projectId, time, bonuses.filter((b) => b.earned).map((b) => b.def.id));
    this.save.session = null;
    writeSave(this.save);
    this.audio.play('success');
    const focus = this.sim.itemByTag('target');
    const at = focus ? toV(focus.rb.translation()) : this.sim.eye();
    for (let i = 0; i < 4; i++) setTimeout(() => this.fx.emit('confetti', at.clone().add(new THREE.Vector3(0, 0.5, 0)), 40), i * 180);
    this.input.unlockPointer();
    setTimeout(() => {
      const nextId = PROJECTS.find((x) => this.save.unlocked.includes(x.id) && !this.save.completed[x.id])?.id;
      const content: Node[] = [
        h('div', { class: 'muted' }, `${p.title} · solved in ${fmtTime(time)}`),
        h('h1', {}, byMachine ? 'I BUILT THAT.' : 'GOT IT!'),
        h('p', {}, byMachine ? `The ${p.target} is back, and a machine you made did it.` : `The ${p.target} is back. However you did it, it counts.`),
        ...bonuses.map((b) => h('div', { class: `bonus ${b.earned ? 'got' : 'miss'}` }, h('i', {}, b.earned ? '★' : ''), b.def.label)),
      ];
      if (unlocked.sandbox) content.push(h('p', {}, '🧪 Sandbox unlocked! Every part there is, as many as you want.'));
      if (unlocked.projects.length) content.push(h('p', {}, `New: ${unlocked.projects.map((id) => PROJECT_MAP[id].title).join(', ')}`));
      content.push(h('p', { class: 'muted' }, 'Wait. What ELSE can I build?'));
      const row = h('div', { class: 'row' });
      if (nextId) row.append(btn(`▶ ${PROJECT_MAP[nextId].title}`, () => this.startProject(nextId), 'go'));
      row.append(btn('🧪 Sandbox', () => this.startSandbox(), nextId ? '' : 'go'));
      row.append(btn('Keep tinkering', () => this.modal.hide()));
      content.push(row);
      this.modal.show(content, 'brief');
    }, 1400);
  }

  // ================================================================== keys

  private key(k: string) {
    if (this.modal.open) {
      if (k === 'escape' && this.mode !== 'title') this.modal.hide();
      return;
    }
    if (this.mode === 'build') return;
    if (this.mode === 'replay') {
      if (k === 'escape' || k === 'v') this.stopReplay();
      return;
    }
    if (this.mode !== 'explore' && this.mode !== 'carry') return;
    switch (k) {
      case 'e': {
        const acts = this.exploreActions();
        const primary = acts.find((a) => a.cls?.includes('primary')) ?? acts.find((a) => a.id !== 'jump');
        primary?.onPress();
        break;
      }
      case 'q':
        if (this.sim.carried) this.dropItem();
        break;
      case 'f':
        if (this.sim.carried) this.throwItem();
        break;
      case 'g':
        if (this.mode !== 'explore') break;
        if (!this.running) this.go();
        else if (this.projectId && !this.sandbox) this.retry();
        break;
      case 'r':
        if (this.mode === 'carry') this.rotateCarried();
        else if (this.running) this.resetRun();
        break;
      case 'c':
        if (this.running) this.cycleCamera();
        break;
      case 'tab':
        if (this.running && this.anyReceiver()) this.toggleDrive();
        break;
      case 'x':
        this.pressAction();
        break;
      case 'b':
        if (!this.running && this.mode === 'explore') this.goToBench();
        break;
      case 't':
        if (this.mode === 'explore') this.tweakMachine();
        break;
      case 'y':
        if (!this.running && this.mode === 'explore') this.turnMachine();
        break;
      case 'h':
        this.showHints();
        break;
      case 'v':
        if (!this.running && this.replay.available) this.startReplay();
        break;
      case 'escape':
        this.showMenu();
        break;
    }
  }

  // ================================================================== loop

  private frame(now: number) {
    requestAnimationFrame((t) => this.frame(t));
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.time += dt;
    if (this.mode === 'replay') {
      if (!this.replay.update(this.view, dt)) {
        // loop the replay until stopped
        this.replay.play(this.replay.speed);
      }
      const f = this.subject();
      if (f) this.cam.orbit.center.lerp(f, 0.05);
    } else {
      const paused = this.modal.open && this.mode !== 'title';
      if (!paused) this.stepSim(dt);
      this.view.sync(dt);
      this.replay.record(this.view, dt);
    }
    if (this.mode === 'intro') this.updateIntro(dt);
    if (this.mode === 'carry') this.updateCarry();
    if (this.mode === 'build') this.build.update(dt);
    if (this.mode === 'title') this.cam.orbit.yaw = 0.35 + Math.sin(this.time * 0.06) * 0.35;
    this.updateGate(dt);
    this.updateHud();
    this.updateAudio(dt);
    this.updateEffects(dt);
    this.updateCamera(dt);
    this.env.update(this.time, dt);
    this.fx.update(dt);
    this.r.followShadows(this.cam.mode === 'eyes' ? this.sim.eye() : this.r.camera.position.clone().lerp(this.subject() ?? this.sim.eye(), 0.7));
    this.r.render();
    if (this.saveTimer > 0) {
      this.saveTimer -= dt;
      if (this.saveTimer <= 0) this.persist();
    }
  }

  private stepSim(dt: number) {
    this.acc += dt;
    let steps = 0;
    const inp = this.buildInput(dt);
    this.sim.yaw = this.yaw;
    while (this.acc >= 1 / 120 && steps < 6) {
      this.sim.step(inp);
      inp.rc.action = false;
      this.acc -= 1 / 120;
      steps++;
    }
    if (steps === 6) this.acc = 0;
    this.handleEvents();
    if (this.running || this.testMachine !== null) {
      this.journal.sample(this.sim, dt);
      if (this.running) this.probe.sample(this.sim, dt);
      // Everything has come to rest: show what the test found (the machine stays as it ended up).
      if (this.running && this.journal.settled && !this.verdictShown && !this.succeeded && Math.abs(this.lastThrottle) < 0.1) {
        this.verdictShown = true;
        this.showResults(this.report());
      }
    }
    // Footsteps
    if (this.mode === 'explore' && this.sim.grounded && this.sim.player) {
      const v = toV(this.sim.player.linvel()).setY(0).length();
      if (v > 1) {
        this.stepT -= dt * v;
        if (this.stepT <= 0) {
          this.stepT = 1.5;
          this.audio.play('step', undefined, 0.8);
        }
      }
    }
  }

  private updateGate(dt: number) {
    if (this.gateAnim > 0 && this.gateAnim < 1) {
      this.gateAnim = Math.min(1, this.gateAnim + dt * 1.2);
      this.env.gate.rotation.y = -this.gateAnim * 1.7;
    }
  }

  private updateCamera(dt: number) {
    const subj = this.subject();
    const eye = this.sim.eye();
    if (this.mode === 'explore' || this.mode === 'carry') {
      // no-op: first person uses yaw/pitch
    }
    let heading: THREE.Vector3 | null = null;
    let vel = new THREE.Vector3();
    for (const m of this.sim.machines.values()) {
      if (m.state !== 'running' || !m.hasReceiver()) continue;
      const rx = m.bp.parts.find((p) => getPart(p.def).behaviors.some((b) => b.type === 'receiver'));
      const wp = rx ? m.partWorldPose(rx.uid) : null;
      if (wp) heading = new THREE.Vector3(0, 0, 1).applyQuaternion(wp.q).setY(0).normalize();
      vel = toV(m.bodies[0].rb.linvel());
    }
    const target = this.sim.itemByTag('target');
    this.cam.update(dt, {
      eye,
      yaw: this.yaw,
      pitch: this.pitch,
      subject: subj,
      subjectVel: vel,
      heading,
      clip: (look, cam) => {
        const d = cam.clone().sub(look);
        const len = d.length();
        if (len < 0.3) return cam;
        d.divideScalar(len);
        const hit = this.sim.physics.raycast(look, d, len, groups(0xffff, GROUP.STATIC));
        return hit ? look.clone().addScaledVector(d, Math.max(0.3, hit.dist - 0.25)) : cam;
      },
      focus: target ? toV(target.rb.translation()) : this.projectId ? new THREE.Vector3(...PROJECT_MAP[this.projectId].focus) : null,
    });
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.r.camera.quaternion);
    this.audio.setListener(this.r.camera.position, right);
  }

  private updateAudio(dt: number) {
    for (const m of this.sim.machines.values()) {
      if (m.state !== 'running') continue;
      for (const p of m.parts.values()) {
        if (!p.active) continue;
        const pos = m.partWorldPose(p.uid)!.p;
        for (const b of p.def.behaviors) {
          const key = `${m.id}:${p.uid}`;
          if (b.type === 'motor') this.audio.loop(key, 'motor', Math.min(1, Math.abs(p.cmd) + 0.2) * p.power, pos);
          if (b.type === 'thrust' && b.watts) this.audio.loop(key, 'fan', p.cmd * p.power, pos);
          if (b.type === 'thrust' && b.burn) this.audio.loop(key, 'rocket', 1, pos);
          if (b.type === 'suction') this.audio.loop(key, 'vacuum', p.power, pos);
          if (b.type === 'winch') this.audio.loop(key, 'winch', p.power, pos);
        }
      }
    }
    this.audio.tick(dt, this.sim.eye());
  }

  private updateEffects(dt: number) {
    for (const m of this.sim.machines.values()) {
      if (m.state !== 'running') continue;
      for (const p of m.parts.values()) {
        if (!p.active) continue;
        const wp = m.partWorldPose(p.uid)!;
        for (const b of p.def.behaviors) {
          if (b.type === 'airflow' && Math.random() < 0.6) {
            const dir = new THREE.Vector3(...b.axis).applyQuaternion(wp.q);
            this.fx.emit('air', new THREE.Vector3(...b.at).applyQuaternion(wp.q).add(wp.p), 1, { dir, speed: p.cmd });
          }
          if (b.type === 'thrust' && b.burn) {
            const dir = new THREE.Vector3(...b.axis).applyQuaternion(wp.q).negate();
            const at = wp.p.clone().addScaledVector(dir, 0.2);
            this.fx.emit('flame', at, 2, { dir, speed: 1 });
            this.fx.emit('smoke', at, 1, { dir, speed: 1 });
          }
          if (b.type === 'suction' && Math.random() < 0.5) {
            const axis = new THREE.Vector3(...b.axis).applyQuaternion(wp.q);
            const nozzle = new THREE.Vector3(...b.at).applyQuaternion(wp.q).add(wp.p);
            const from = nozzle.clone().addScaledVector(axis, 0.6 + Math.random() * 0.8).add(new THREE.Vector3((Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 0.5));
            this.fx.emit('air', from, 1, { dir: nozzle.clone().sub(from).normalize(), speed: 0.8 });
          }
        }
        // Tire marks from wheels rolling fast on the ground.
        if (p.def.sockets.some((s) => s.joint === 'axle')) {
          const r = p.def.shapes[0].r ?? 0.1;
          if (wp.p.y < r + 0.04) {
            const v = toV(p.body.rb.linvel()).setY(0);
            if (v.length() > 0.8 && Math.random() < dt * 25) this.fx.mark(wp.p, v.normalize());
          }
        }
      }
    }
  }

  private updateHud() {
    if (this.mode === 'title' || this.mode === 'intro' || this.mode === 'build') return;
    if (this.mode === 'replay') return;
    const proj = this.projectId ? PROJECT_MAP[this.projectId] : null;
    const title = this.sandbox ? '🧪 SANDBOX' : proj?.title ?? '';
    const sub = this.sandbox ? 'No rules. Every part.' : this.succeeded ? 'Solved! ★' : `tap for the goal · ${fmtTime(this.sim.projectTime)}`;
    const html = `${title}<small>${sub}</small>`;
    if (this.projectChip.innerHTML !== html) this.projectChip.innerHTML = html;
    // Power readout while things run.
    let pw: ReturnType<MachineInstance['powerSummary']> = null;
    if (this.running) for (const m of this.sim.machines.values()) pw = pw ?? m.powerSummary();
    this.powerChip.classList.toggle('hidden', !pw);
    if (pw) {
      const pct = Math.round(pw.charge * 100);
      const low = pw.factor < 0.6 || pct < 10;
      this.powerChip.innerHTML = `⚡ ${pct}%${pw.factor < 0.99 ? ` <small>only ${Math.round(pw.factor * 100)}% power!</small>` : '<small>battery</small>'}<div class="meter ${low ? 'low' : ''}"><div style="width:${pct}%"></div></div>`;
    }
    this.updatePrompt();
    const explore = this.mode === 'explore' || this.mode === 'carry';
    this.actions.set(explore ? this.exploreActions() : []);
    this.leftActions.set(explore ? this.runActions() : []);
    this.reticle.classList.toggle('hidden', this.cam.mode !== 'eyes');
    this.prompt.classList.toggle('hidden', this.cam.mode !== 'eyes');
    // Never hand out hints unasked. After a long quiet spell, just point at where help lives, once.
    if (this.save.settings.hints && this.mode === 'explore' && !this.running && this.projectId && !this.sandbox) {
      this.hintTimer += 1 / 60;
      if (this.hintTimer > 120 && !this.idleNudged && !this.sim.machines.size && !this.succeeded && !(this.save.hintsSeen[this.projectId] ?? 0)) {
        this.idleNudged = true;
        this.thought.say('Stuck? The 💡 up top has hints, if I want them.', 4500);
      }
    }
    this.hintBtn.classList.toggle('hidden', !this.projectId || this.sandbox);
    void inZone;
  }
}
