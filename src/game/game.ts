import * as THREE from 'three';
import { Audio } from '../audio/audio';
import { getPart, PART_MAP } from '../data/parts';
import { newKitParts, PROJECT_MAP, PROJECTS, type ProjectDef } from '../data/projects';
import { EAST_FENCE_X, inZone, LOOK_HINTS } from '../data/world';
import { buildEnvironment, type Environment } from '../render/environment';
import { ideaFor } from '../data/ideas';
import { Effects } from '../render/effects';
import { detectQuality, Renderer } from '../render/renderer';
import { partThumb } from '../render/thumbs';
import { BlueprintView, WorldView } from '../render/views';
import { blueprintBounds, blueprintMass, clone, newBlueprint, partPose, type Blueprint } from '../sim/blueprint';
import type { SimEvent } from '../sim/events';
import { partOBBs } from '../sim/geom';
import type { MachineInstance, MachinePlacement } from '../sim/machine';
import { GROUP, groups, RAPIER, toV } from '../sim/physics';
import { emptyInput, PLAYER, Simulation, type Item, type SimInput } from '../sim/simulation';
import { ActionBar, btn, h, Modal, Thought, Toasts, type ActionDef } from '../ui/dom';
import { BuildMode, type Stash } from './build';
import { CameraDirector } from './camera';
import { Input } from './input';
import { RunJournal } from './journal';
import { Replay } from './replay';
import { completeProject, discover, loadSave, sandboxParts, totalBonuses, writeSave, type SaveData } from './save';

type Mode = 'title' | 'intro' | 'explore' | 'build' | 'carry' | 'replay';

const fmtTime = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
const MAT_HALF = 0.9;

/**
 * The game loop. One idea: DISCOVER a problem, BUILD something from a small
 * kit right where you stand, TEST it, LEARN from what happened, IMPROVISE,
 * SOLVE. Everything here serves that loop.
 */
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
  /** The kit: part id -> how many are left to use. */
  stash = new Map<string, number>();
  /** Where the mat is while building, and which way it faces (machine +z). */
  buildOrigin = new THREE.Vector3();
  buildYaw = 0;
  carrying: { bp: Blueprint; view: BlueprintView; rot: number; placement: MachinePlacement | null; valid: boolean } | null = null;
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
  private hintIndex = 0;
  private failedRuns = 0;
  private lastLookKey = '';
  private ideaOffered = false;
  private spot: { origin: THREE.Vector3; ok: boolean } = { origin: new THREE.Vector3(), ok: false };

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
    this.newSim(this.nextProject(), false);
    this.showTitle();
    requestAnimationFrame((t) => this.frame(t));
  }

  private resize() {
    this.r.resize();
    this.fx.setScale(window.innerHeight);
  }

  // ================================================================== setup

  private nextProject(): ProjectDef {
    return PROJECTS.find((p) => this.save.unlocked.includes(p.id) && !this.save.completed[p.id]) ?? PROJECTS[0];
  }

  private newSim(project: ProjectDef | null, started = true) {
    this.leaveBuild();
    this.dropCarried();
    this.view?.root.removeFromParent();
    this.sim?.free();
    this.sim = new Simulation({ project: started ? project : null, gateOpen: !project });
    if (!started && project) {
      // Title-screen backdrop: the props sit where they will be.
      for (const s of [...project.yard, ...project.props]) this.sim.spawnItem(s);
    }
    this.view = new WorldView(this.sim);
    this.r.scene.add(this.view.root);
    this.env.gate.rotation.y = 0;
    this.gateAnim = 0;
    this.running = false;
    this.succeeded = false;
    this.testMachine = null;
    this.failedRuns = 0;
    this.hintIndex = 0;
    this.hintTimer = 0;
    this.ideaOffered = false;
    this.replay = new Replay();
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
      list: () => (this.sandbox ? sandboxParts(this.save).map((d) => [d, 99] as [string, number]) : [...this.stash.entries()].filter(([, n]) => n > 0)),
    };
    return {
      r: this.r,
      cam: this.cam,
      audio: this.audio,
      ui: this.ui,
      toasts: this.toasts,
      thought: this.thought,
      stash,
      get benchOrigin() {
        return self.buildOrigin;
      },
      get benchYaw() {
        return self.buildYaw;
      },
      get sandbox() {
        return self.sandbox;
      },
      get hints() {
        return self.save.settings.hints;
      },
      onDone: (bp: Blueprint) => this.leaveMat(bp),
      onTest: (bp: Blueprint) => this.startTest(bp),
      onStopTest: () => this.stopTest(),
      onChange: () => this.persistSoon(),
      creations: () => this.save.creations,
      idea: () => (this.sandbox ? null : ideaFor(this.projectId)),
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
    this.projectChip = h('div', { class: 'chip' });
    this.powerChip = h('div', { class: 'chip hidden' });
    this.menuBtn = btn('☰', () => this.showMenu(), 'small round');
    this.hudTop = h('div', { class: 'topbar' }, this.projectChip, this.powerChip, h('div', { class: 'spacer' }), this.menuBtn);
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

  private kitRow(kit: Record<string, number>, highlight: string[] = []): HTMLElement {
    const row = h('div', { class: 'kit' });
    for (const [id, n] of Object.entries(kit)) {
      const def = getPart(id);
      const isNew = highlight.includes(id);
      row.append(
        h(
          'div',
          { class: `kit-item ${isNew ? 'new' : ''}`, title: def.hint },
          h('img', { src: partThumb(this.r.renderer, id), alt: def.name }),
          h('div', { class: 'kit-name' }, def.name),
          n > 1 ? h('div', { class: 'count' }, String(n)) : null,
          isNew ? h('div', { class: 'badge' }, 'NEW') : null,
        ),
      );
    }
    return row;
  }

  // ================================================================== menus

  private showTitle() {
    this.leaveBuild();
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
    const next = this.nextProject();
    const solved = Object.keys(s.completed).length;
    const content: Node[] = [h('div', { class: 'logo' }, 'BACKYARD', h('span', {}, 'LAB'))];
    content.push(h('p', { class: 'muted' }, 'A kid. A problem. A handful of junk.'));
    const row = h('div', { class: 'row', style: 'flex-direction:column' });
    if (sess) {
      const label = sess.mode === 'sandbox' ? 'Sandbox' : PROJECT_MAP[sess.project!].title;
      row.append(btn(`▶ Continue — ${label}`, () => this.resume(), 'go'));
    } else if (solved < PROJECTS.length) {
      row.append(btn(`▶ Play — ${next.title}`, () => this.startProject(next.id), 'go'));
    } else {
      row.append(btn('🧪 Sandbox', () => this.startSandbox(), 'go'));
    }
    row.append(btn('📋 Problems', () => this.showProjects()));
    if (solved < PROJECTS.length) row.append(btn(s.sandbox ? '🧪 Sandbox' : '🔒 Sandbox (solve a problem first)', () => (s.sandbox ? this.startSandbox() : this.audio.play('error'))));
    row.append(btn('📓 Lab Notebook', () => this.showNotebook()));
    row.append(btn('⚙ Settings', () => this.showSettings(() => this.showTitle())));
    content.push(row);
    this.modal.show(content, 'title');
  }

  private showProjects(back: () => void = () => this.showTitle()) {
    const list = h('div', { class: 'projects' });
    PROJECTS.forEach((p, i) => {
      const unlocked = this.save.unlocked.includes(p.id);
      const done = this.save.completed[p.id];
      const b = btn(
        `<span>${unlocked ? '' : '🔒 '}${i + 1}. ${p.title}<br><small class="muted">${unlocked ? p.pitch[0] : 'Solve the one before it first'}</small></span><span>${done ? '⭐'.repeat(Math.max(1, done.bonuses.length)) : ''}</span>`,
        () => (unlocked ? this.startProject(p.id) : this.audio.play('error')),
        unlocked ? '' : 'ghost',
      );
      list.append(b);
    });
    this.modal.show([h('h2', {}, 'Problems'), list, h('div', { class: 'row' }, btn('Back', back))]);
  }

  private showNotebook(back: () => void = () => this.showTitle()) {
    const s = this.save;
    const tb = totalBonuses(s);
    const found = s.discovered.length;
    const total = Object.values(PART_MAP).filter((p) => p.buildable).length;
    const lessons = PROJECTS.filter((p) => s.completed[p.id]).map((p) => h('div', { class: 'lesson' }, h('b', {}, p.title), h('div', {}, p.lesson)));
    this.modal.show([
      h('h2', {}, '📓 Lab Notebook'),
      h('p', {}, `Problems solved: ${Object.keys(s.completed).length}/${PROJECTS.length} · Stars: ${tb.earned}/${tb.possible}`),
      h('p', {}, `Junk I have used: ${found}/${total}`),
      h('h3', {}, 'Things I have figured out'),
      ...(lessons.length ? lessons : [h('p', { class: 'muted' }, 'Nothing yet. Go solve something.')]),
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
        'Desktop: WASD move · mouse look · E use / build / tinker · F throw / pick up machine · Q drop · G go · R reset (or rotate while carrying) · C camera · Tab drive/walk · V replay · Space jump',
      ),
      h('p', { class: 'muted' }, 'Touch: left thumb moves (push far to run), right thumb looks. Buttons do the rest.'),
      h('div', { class: 'row' }, btn('Back', back)),
    ]);
  }

  private showMenu() {
    if (this.mode === 'title') return;
    this.input.unlockPointer();
    const proj = this.projectId ? PROJECT_MAP[this.projectId] : null;
    const title = this.sandbox ? 'Sandbox' : proj?.title ?? '';
    const rows = h('div', { class: 'row', style: 'flex-direction:column' });
    rows.append(btn('▶ Back to it', () => this.modal.hide(), 'go'));
    if (proj) rows.append(btn('📜 The problem again', () => this.showBrief(proj, () => this.modal.hide())));
    if (!this.sandbox && this.projectId) rows.append(btn('⟲ Restart this problem', () => this.startProject(this.projectId!, false)));
    rows.append(btn('📋 Problems', () => this.showProjects(() => this.showMenu())));
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
    for (const [k, n] of Object.entries(p.kit)) this.stash.set(k, n);
    for (const k of Object.keys(p.kit)) discover(this.save, k);
    if (keep) this.restoreSession(keep);
    this.persist();
    this.beginIntro(p, !keep);
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
    const s = this.save.session;
    if (s?.mode === 'sandbox') this.restoreSession(s);
    // Something to play with.
    this.sim.spawnItem({ part: 'playground_ball', pos: [4, 0.2, 0] });
    this.sim.spawnItem({ part: 'tennis_ball', pos: [3, 0.1, 1] });
    this.enterExplore();
    this.thought.say('Sandbox. Everything I have ever used, as much as I want. No rules.', 4500);
    this.persist();
  }

  private restoreSession(s: NonNullable<SaveData['session']>) {
    if (!this.sandbox) {
      this.stash.clear();
      for (const [k, v] of Object.entries(s.stash)) this.stash.set(k, v);
    }
    for (const m of s.machines) this.sim.addMachine(m.bp, m.placement);
    // Yard junk that was picked up and added to the kit is no longer lying around.
    if (!this.sandbox && this.projectId) {
      const kit = PROJECT_MAP[this.projectId].kit;
      const have = new Map<string, number>();
      for (const [k, v] of this.stash) have.set(k, (have.get(k) ?? 0) + v);
      for (const m of s.machines) for (const p of m.bp.parts) have.set(p.def, (have.get(p.def) ?? 0) + 1);
      for (const [d, n] of have) {
        for (let i = 0; i < n - (kit[d] ?? 0); i++) {
          const it = [...this.sim.items.values()].find((x) => x.def.id === d && !x.tag);
          if (it) this.sim.removeItem(it.id);
        }
      }
    }
  }

  private sessionData(): SaveData['session'] {
    if (this.mode === 'title' && !this.projectId && !this.sandbox) return this.save.session;
    const machines = [...this.sim.machines.values()].filter((m) => m.id !== this.testMachine).map((m) => ({ bp: m.bp, placement: m.placement }));
    if (this.carrying) machines.push({ bp: this.carrying.bp, placement: { pos: [this.buildOrigin.x, 0, this.buildOrigin.z], yaw: this.buildYaw } });
    if (this.mode === 'build' && this.build.bp.parts.length) machines.push({ bp: this.build.bp, placement: { pos: [this.buildOrigin.x, this.buildOrigin.y, this.buildOrigin.z], yaw: this.buildYaw } });
    return {
      mode: this.sandbox ? 'sandbox' : 'project',
      project: this.projectId,
      bench: null,
      machines,
      stash: Object.fromEntries(this.stash),
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

  private beginIntro(p: ProjectDef, cinematic: boolean) {
    this.mode = 'intro';
    this.sim.objectivesPaused = true;
    this.introT = cinematic ? 0 : 99;
    this.setHudVisible(false);
    this.input.unlockPointer();
    const f = new THREE.Vector3(...p.focus);
    if (p.intro === 'ballOverFence' && cinematic) {
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
        ball.rb.setLinvel({ x: 0.6, y: -1, z: 0.2 }, true);
        this.introBall = null;
      }
    }
    if (this.introT > (p.intro ? 2.6 : 1.6) && !this.modal.open) this.showBrief(p, () => this.afterBrief());
  }

  /** The briefing: the problem, where it is, and the kit. That is all a kid needs. */
  private showBrief(p: ProjectDef, go: () => void) {
    const idx = PROJECTS.indexOf(p) + 1;
    const fresh = newKitParts(p).filter((id) => !this.save.discovered.includes(id) || !Object.values(this.save.completed).length);
    this.modal.show(
      [
        h('div', { class: 'muted' }, `PROBLEM ${idx} of ${PROJECTS.length}`),
        h('h1', {}, p.title),
        h('p', {}, p.pitch[0]),
        h('p', {}, p.pitch[1]),
        h('p', { class: 'where' }, `📍 ${p.where}`),
        h('div', { class: 'muted', style: 'margin-top:10px' }, 'YOUR KIT'),
        this.kitRow(p.kit, fresh),
        h('p', { class: 'muted', style: 'margin-top:6px' }, 'Anything else lying around the yard is fair game too.'),
        h('div', { class: 'row' }, btn("Let's go!", go, 'go')),
      ],
      'brief',
    );
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
    const p = this.projectId ? PROJECT_MAP[this.projectId] : null;
    if (this.save.settings.hints && p && !this.save.completed[p.id] && !this.sim.machines.size) {
      const first = PROJECTS.indexOf(p) === 0;
      setTimeout(() => this.thought.say(first ? 'Right. Walk over there and see what we are dealing with.' : p.hints[0], 4500), 900);
      this.hintIndex = first ? 0 : 1;
      if (first) {
        setTimeout(() => this.input.touchMode && this.stickHint.classList.remove('hidden'), 100);
        setTimeout(() => this.stickHint.classList.add('hidden'), 9000);
      }
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
      if (this.cam.mode === 'eyes') {
        this.yaw -= dx;
        this.pitch = THREE.MathUtils.clamp(this.pitch - dy, -1.35, 1.35);
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

  private nearGateFromOutside(): boolean {
    const p = toV(this.sim.player!.translation());
    return !this.sim.gateOpen && p.x > EAST_FENCE_X + 0.1 && p.x < EAST_FENCE_X + 2.2 && p.z > -5.2 && p.z < -2;
  }

  /** Where a mat would go: a patch of open, flat ground just in front of the kid. */
  private updateSpot() {
    const eye = this.sim.eye();
    const flat = this.sim.look().setY(0);
    if (flat.lengthSq() < 1e-4) flat.set(0, 0, -1);
    flat.normalize();
    const ahead = eye.clone().addScaledVector(flat, 1.9).setY(eye.y);
    const down = this.sim.physics.raycast(ahead.clone().setY(eye.y + 0.5), new THREE.Vector3(0, -1, 0), 4, groups(0xffff, GROUP.STATIC));
    let ok = !!down && down.normal.y > 0.95 && down.point.y < eye.y;
    const origin = down ? down.point.clone() : ahead.setY(0);
    if (ok) {
      // Room for a mat: nothing solid in a low box over it (the ground itself sits just under).
      const world = this.sim.physics.world;
      const shape = new RAPIER.Cuboid(MAT_HALF, 0.35, MAT_HALF);
      world.intersectionsWithShape({ x: origin.x, y: origin.y + 0.4, z: origin.z }, { x: 0, y: 0, z: 0, w: 1 }, shape, () => {
        ok = false;
        return false;
      }, undefined, groups(0xffff, GROUP.STATIC));
      // Not on top of another machine either.
      for (const m of this.sim.machines.values()) {
        const c = m.center();
        if (Math.hypot(c.x - origin.x, c.z - origin.z) < MAT_HALF + 0.6) ok = false;
      }
      if (ok && !inZone(origin, 'home_yard')) ok = false;
    }
    this.spot = { origin, ok };
  }

  private exploreActions(): ActionDef[] {
    const a: ActionDef[] = [];
    const touch = this.input.touchMode;
    const k = (s: string) => (touch ? '' : ` <small>[${s}]</small>`);
    const sim = this.sim;
    const look = this.lookTarget();
    if (this.mode === 'carry' && this.carrying) {
      a.push({ id: 'place', label: `📍 PUT DOWN${k('E')}`, cls: this.carrying.valid ? 'primary' : '', onPress: () => this.placeCarried() });
      a.push({ id: 'rot', label: `↻${k('R')}`, onPress: () => this.rotateCarried() });
      if (touch) a.push({ id: 'jump', label: '⤒', onPress: () => this.tapJump() });
      return a;
    }
    if (sim.carried) {
      const it = sim.carried.item;
      if (it.def.buildable && !it.tag && !this.sandbox) a.push({ id: 'kit', label: `🧰 ADD TO KIT${k('E')}`, cls: 'primary', onPress: () => this.addCarriedToKit() });
      a.push({ id: 'throw', label: `🤾 THROW${k('F')}`, onPress: () => this.throwItem() });
      a.push({ id: 'drop', label: `✋ DROP${k('Q')}`, cls: it.def.buildable && !it.tag && !this.sandbox ? '' : 'primary', onPress: () => this.dropItem() });
    } else if (look?.kind === 'item') {
      a.push({ id: 'pick', label: `✊ PICK UP${k('E')}`, cls: 'primary', onPress: () => this.pickUp(look.item) });
    } else if (look?.kind === 'machine' && look.machine.state === 'frozen' && look.machine.id !== this.testMachine && !this.running) {
      a.push({ id: 'tinker', label: `🔧 TINKER${k('E')}`, cls: 'primary', onPress: () => this.tinker(look.machine) });
      a.push({ id: 'pickm', label: `✊ PICK UP${k('F')}`, onPress: () => this.pickUpMachine(look.machine) });
    } else if (this.nearGateFromOutside()) {
      a.push({ id: 'gate', label: `🔓 OPEN GATE${k('E')}`, cls: 'primary', onPress: () => this.openGate() });
    } else if (!this.running && this.spot.ok) {
      a.push({ id: 'build', label: `🔧 BUILD HERE${k('E')}`, cls: 'primary', onPress: () => this.enterBuild() });
    }
    if (touch && !(this.running && this.driving && this.anyReceiver())) a.push({ id: 'jump', label: '⤒', onPress: () => this.tapJump() });
    return a;
  }

  private runActions(): ActionDef[] {
    const a: ActionDef[] = [];
    const touch = this.input.touchMode;
    const k = (s: string) => (touch ? '' : ` <small>[${s}]</small>`);
    if (this.running) {
      a.push({ id: 'reset', label: `⟲ RESET${k('R')}`, cls: 'danger', onPress: () => this.resetRun() });
      const camLabel = { eyes: '👀', chase: '🎥', wide: '🗺', free: '✋', bench: '🎥', intro: '🎥' }[this.cam.mode];
      a.push({ id: 'cam', label: `${camLabel}${k('C')}`, onPress: () => this.cycleCamera() });
      if (this.anyReceiver()) {
        a.push({ id: 'drive', label: this.driving ? `🎮 DRIVING${k('Tab')}` : `🚶 WALKING${k('Tab')}`, onPress: () => this.toggleDrive() });
        a.push({ id: 'act', label: `⚡ SWITCH${k('X')}`, onPress: () => this.pressAction() });
      }
    } else if (this.frozenMachines().length && this.mode === 'explore') {
      a.push({ id: 'go', label: `▶ GO${k('G')}`, cls: 'go', onPress: () => this.go() });
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
      return;
    }
    if (it.def.buildable && !it.tag && !this.sandbox && this.save.settings.hints) this.thought.say('Hmm. I could use this.', 2200);
  }

  private dropItem() {
    this.sim.drop(0);
  }

  private dropCarried() {
    if (this.sim?.carried) this.sim.drop(0);
  }

  private throwItem() {
    this.sim.drop(8.5);
  }

  /** "Wait... I could use THAT." Junk from the yard joins the kit. */
  private addCarriedToKit() {
    const c = this.sim.carried;
    if (!c || !c.item.def.buildable || c.item.tag) return;
    const it = c.item;
    this.sim.drop(0);
    this.stash.set(it.def.id, (this.stash.get(it.def.id) ?? 0) + 1);
    const first = discover(this.save, it.def.id);
    this.sim.removeItem(it.id);
    this.audio.play('discover');
    this.toasts.show(`🧰 ${it.def.name} added to the kit${first ? ' — new!' : ''}`, 'new', 2600);
    this.persistSoon();
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

  /** Unroll the mat right here, facing the way the kid is looking, and start building from the kit. */
  enterBuild(bp: Blueprint = newBlueprint(), origin: THREE.Vector3 = this.spot.origin, yaw: number = this.facingYaw()) {
    if (this.running) return;
    this.dropCarried();
    this.buildOrigin.copy(origin);
    this.buildYaw = yaw;
    this.mode = 'build';
    this.input.unlockPointer();
    this.input.enabled = false;
    this.input.reset();
    this.setHudVisible(false);
    this.thought.hide();
    document.body.classList.add('building');
    this.build.enter(bp);
    // Been failing a while on a project with an idea? Offer it once.
    if (!this.sandbox && this.projectId && !this.save.completed[this.projectId] && !bp.parts.length && !this.ideaOffered && this.failedRuns >= 2 && ideaFor(this.projectId)) {
      this.ideaOffered = true;
      setTimeout(() => this.mode === 'build' && this.build.showIdea(true), 500);
    }
  }

  /** Machine "forward" (+z) pointing where the kid looks, snapped to 45 degrees. */
  private facingYaw(): number {
    const step = Math.PI / 4;
    return Math.round((this.yaw + Math.PI) / step) * step;
  }

  /** Re-open a frozen machine on its own spot. */
  private tinker(m: MachineInstance) {
    if (this.running) {
      this.toasts.show('Reset first!', 'bad');
      return;
    }
    const origin = new THREE.Vector3(m.placement.pos[0], m.placement.pos[1], m.placement.pos[2]);
    const yaw = m.placement.yaw;
    const bp = clone(m.bp);
    this.sim.removeMachine(m.id);
    this.audio.play('pickup');
    this.enterBuild(bp, origin, yaw);
  }

  private leaveBuild() {
    if (this.mode !== 'build') return;
    if (this.build.testing) this.build.stopTest();
    this.build.exit();
    document.body.classList.remove('building');
    this.input.enabled = true;
  }

  /** DONE: whatever is on the mat stays there, frozen, ready for GO. */
  private leaveMat(bp: Blueprint) {
    this.leaveBuild();
    if (bp.parts.length) {
      this.sim.addMachine(clone(bp), { pos: [this.buildOrigin.x, this.buildOrigin.y, this.buildOrigin.z], yaw: this.buildYaw });
      this.audio.play('attach', this.buildOrigin);
    }
    this.enterExplore();
    if (bp.parts.length && this.save.settings.hints && Object.keys(this.save.completed).length === 0) {
      this.thought.say(bp.parts.some((p) => getPart(p.def).behaviors.some((b) => b.type === 'receiver')) ? 'Hit GO, then drive with the stick.' : 'Hit GO and see what happens. Or pick it up and put it somewhere better.', 4000);
    }
    this.persist();
  }

  private startTest(bp: Blueprint) {
    if (bp.parts.some((p) => getPart(p.def).behaviors.some((b) => b.type === 'receiver'))) {
      // Driving needs the sticks: leave the mat and go for real.
      this.leaveMat(bp);
      this.go();
      return;
    }
    const m = this.sim.addMachine(clone(bp), { pos: [this.buildOrigin.x, this.buildOrigin.y, this.buildOrigin.z], yaw: this.buildYaw });
    this.testMachine = m.id;
    this.sim.goAll();
    this.running = true;
    this.verdictShown = false;
    this.journal.begin(this.sim);
    this.replay.start();
    this.audio.play('go');
    const o = this.cam.orbit;
    o.center.copy(this.buildOrigin).add(new THREE.Vector3(0, 0.3, 0));
    o.dist = Math.max(o.dist, 3.2);
    this.cam.set('free', false, 0.8);
  }

  private stopTest() {
    if (this.testMachine !== null) {
      this.resetRun(true);
      this.sim.removeMachine(this.testMachine);
    }
    this.testMachine = null;
    const o = this.cam.orbit;
    o.center.copy(this.buildOrigin).add(new THREE.Vector3(0, 0.15, 0));
    o.dist = Math.min(o.dist, 2.6);
    this.cam.set('bench', false, 0.7);
  }

  // ================================================================== carrying machines

  private startCarry(bp: Blueprint) {
    const view = new BlueprintView(bp);
    this.r.scene.add(view.group);
    this.carrying = { bp, view, rot: 0, placement: null, valid: false };
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
    c.valid = this.machineFits(c.bp, c.placement) && Math.hypot(target.x - eye.x, target.z - eye.z) > 0.5;
    c.view.group.position.set(...pos);
    c.view.group.rotation.set(0, yaw, 0);
    c.view.setGhost(c.valid ? null : 0xff4030);
  }

  /** Does the machine overlap walls, fences, trees...? */
  private machineFits(bp: Blueprint, pl: MachinePlacement): boolean {
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), pl.yaw);
    const base = { p: new THREE.Vector3(...pl.pos), q };
    const world = this.sim.physics.world;
    for (const p of bp.parts) {
      const def = getPart(p.def);
      if (def.link) continue;
      const pp = partPose(p);
      const wp = { p: pp.p.clone().applyQuaternion(q).add(base.p), q: q.clone().multiply(pp.q) };
      for (const o of partOBBs(def, wp, 0.015)) {
        const rot = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(o.axes[0], o.axes[1], o.axes[2]));
        const shape = new RAPIER.Cuboid(o.h[0], o.h[1], o.h[2]);
        let hitStatic = false;
        world.intersectionsWithShape(
          { x: o.c.x, y: o.c.y + 0.02, z: o.c.z },
          { x: rot.x, y: rot.y, z: rot.z, w: rot.w },
          shape,
          () => {
            hitStatic = true;
            return false;
          },
          undefined,
          groups(0xffff, GROUP.STATIC),
        );
        if (hitStatic) return false;
      }
    }
    return true;
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
    this.sim.addMachine(c.bp, c.placement);
    this.audio.play('attach', new THREE.Vector3(...c.placement.pos));
    this.fx.emit('dust', new THREE.Vector3(c.placement.pos[0], 0.05, c.placement.pos[2]), 14);
    this.carrying = null;
    this.mode = 'explore';
    this.persist();
  }

  private pickUpMachine(m: MachineInstance) {
    if (this.running) {
      this.toasts.show('Reset first!', 'bad');
      return;
    }
    const mass = blueprintMass(m.bp);
    this.sim.removeMachine(m.id);
    this.startCarry(m.bp);
    if (mass > 30) this.thought.say(`Oof. ${mass.toFixed(0)} kg. This is heavy.`, 2500);
    this.audio.play('pickup');
  }

  // ================================================================== running machines

  go() {
    if (this.running || !this.frozenMachines().length) return;
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
      o.yaw = Math.atan2(eye.x - s.x, eye.z - s.z);
      o.pitch = 0.42;
      o.dist = THREE.MathUtils.clamp(eye.distanceTo(s) + 2.5, 3.5, 8);
      this.cam.set('free', false, 1.0);
    }
    this.persistSoon();
  }

  resetRun(quiet = false) {
    if (!this.running) return;
    const verdict = !this.succeeded && this.journal.worthMentioning() && !this.verdictShown ? this.journal.verdict() : null;
    for (const m of [...this.sim.machines.values()]) if (m.id !== this.testMachine) this.sim.resetMachine(m.id);
    this.running = false;
    this.replay.stop();
    if (!this.succeeded) this.failedRuns++;
    if (this.mode !== 'build') this.cam.set('eyes', false, 0.8);
    if (verdict && !quiet) {
      this.thought.say(verdict, 4500);
      this.audio.play('fail');
    } else if (!this.succeeded) this.nudge();
  }

  /** After a failed run, one kid-thought that points at what to try next. */
  private nudge() {
    if (!this.save.settings.hints || !this.projectId || this.succeeded) return;
    const p = PROJECT_MAP[this.projectId];
    const line = p.nudges[Math.min(this.failedRuns - 1, p.nudges.length - 1)];
    if (line) setTimeout(() => !this.running && !this.succeeded && this.thought.say(line, 4500), 4800);
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
      if (this.running) this.journal.event(e);
      this.eventFx(e);
    }
    for (const oe of this.sim.objectiveEvents.splice(0)) {
      if (oe.type === 'success') this.onSuccess(oe.bonuses, oe.time);
      if (oe.type === 'fail') {
        this.toasts.show(oe.message, 'bad', 4000);
        this.audio.play('fail');
      }
      if (oe.type === 'bonusLost' && this.save.settings.hints) this.toasts.show(`✗ ${oe.def.label}`, '', 1800);
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
      case 'pickup':
        A.play('pickup', e.pos);
        break;
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
    const p = PROJECT_MAP[this.projectId];
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
        h('h1', {}, 'IT WORKED!'),
        ...bonuses.map((b) => h('div', { class: `bonus ${b.earned ? 'got' : 'miss'}` }, h('i', {}, b.earned ? '★' : ''), b.def.label)),
        h('div', { class: 'lesson' }, h('b', {}, '📓 Lab Notebook'), h('div', {}, p.lesson)),
      ];
      if (unlocked.sandbox) content.push(h('p', {}, '🧪 Sandbox unlocked: everything you have used, no limits.'));
      if (nextId) content.push(h('p', { class: 'muted' }, `Next problem: ${PROJECT_MAP[nextId].title}. New junk in the kit.`));
      else content.push(h('p', { class: 'muted' }, 'That was the last problem. For now. What ELSE could I build?'));
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
      case 'f': {
        if (this.sim.carried) this.throwItem();
        else {
          const look = this.lookTarget();
          if (look?.kind === 'machine' && look.machine.state === 'frozen' && !this.running) this.pickUpMachine(look.machine);
        }
        break;
      }
      case 'g':
        if (!this.running && this.mode === 'explore') this.go();
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
    if (this.mode === 'explore') this.updateSpot();
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
    if (this.running) {
      this.journal.sample(this.sim, dt, this.lastThrottle);
      if (this.journal.settled && !this.verdictShown && !this.succeeded && Math.abs(this.lastThrottle) < 0.1) {
        this.verdictShown = true;
        this.thought.say(this.journal.verdict() + (this.mode === 'build' ? '  (STOP & FIX to try again.)' : '  (RESET to try again.)'), 5500);
        this.audio.play('fail');
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
    const sub = this.sandbox ? 'No rules. Just junk.' : this.succeeded ? 'Solved! ★' : `${proj?.pitch[1] ?? ''} · ${fmtTime(this.sim.projectTime)}`;
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
    // Idle thoughts: nudge a kid who is standing around with nothing built.
    if (this.save.settings.hints && this.mode === 'explore' && !this.running && proj && !this.succeeded) {
      this.hintTimer += 1 / 60;
      if (this.hintTimer > 40 && !this.sim.machines.size && !this.sim.carried) {
        this.hintTimer = 0;
        const line = proj.hints[this.hintIndex % proj.hints.length];
        this.hintIndex++;
        if (line) this.thought.say(line, 4500);
      }
    }
  }
}
