import * as THREE from 'three';
import { getPart, PARTS, type PartDef } from '../data/parts';
import {
  addLink,
  clone,
  blueprintBounds,
  blueprintMass,
  commitPlacement,
  computeAttach,
  findPart,
  linkWorldEnds,
  partPose,
  placeFree,
  removePart,
  validateBlueprint,
  type Blueprint,
  type Placement,
} from '../sim/blueprint';
import { shapeHalf, shapeLocalPose, v3 } from '../sim/geom';
import type { Audio } from '../audio/audio';
import { M } from '../render/materials';
import { partMesh } from '../render/parts';
import type { Renderer } from '../render/renderer';
import { partThumb } from '../render/thumbs';
import { BlueprintView } from '../render/views';
import { btn, h, type Thought, type Toasts } from '../ui/dom';
import type { CameraDirector } from './camera';
import { generateStuds, rankInDirection, type Stud } from './studs';
import { WHERE, type Idea } from '../data/ideas';
import { transformPoint } from '../sim/geom';

export interface Stash {
  infinite: boolean;
  count(def: string): number;
  take(def: string): boolean;
  give(def: string): void;
  list(): [string, number][];
}

export interface BuildHost {
  r: Renderer;
  cam: CameraDirector;
  audio: Audio;
  ui: HTMLElement;
  toasts: Toasts;
  thought: Thought;
  stash: Stash;
  benchOrigin: THREE.Vector3;
  sandbox: boolean;
  hints: boolean;
  onDone(bp: Blueprint): void;
  onExit(bp: Blueprint): void;
  onTest(bp: Blueprint): void;
  onStopTest(): void;
  onChange(bp: Blueprint): void;
  creations(): { name: string; bp: Blueprint }[];
  saveCreation(bp: Blueprint): void;
  ideas(): Idea[];
  /** Parts on the bench plus parts on the shelf, for the idea checklist. */
  onBench(def: string): number;
}

interface MoveState {
  uid: number;
  snapshot: Blueprint;
  oldRoot: { p: THREE.Vector3; q: THREE.Quaternion };
  parts: Blueprint['parts'];
  connections: Blueprint['connections'];
  links: Blueprint['links'];
}

interface Holding {
  def: string;
  socket?: string;
  spin: number;
  tilt: number;
  /** The player turned / flipped it themselves: stop auto-orienting. */
  manual: boolean;
  moving?: MoveState;
}

/** A button that fires on press and keeps firing while held. */
function holdBtn(label: string, fire: () => void, cls = '', every = 60): HTMLButtonElement {
  const b = h('button', { class: `btn ${cls}` });
  b.innerHTML = label;
  let timer = 0;
  let delay = 0;
  const stop = () => {
    clearTimeout(delay);
    clearInterval(timer);
    b.classList.remove('pressed');
  };
  b.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    e.preventDefault();
    b.classList.add('pressed');
    fire();
    delay = window.setTimeout(() => (timer = window.setInterval(fire, every)), 320);
  });
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) b.addEventListener(ev, stop);
  b.addEventListener('click', (e) => e.stopPropagation());
  return b;
}

const BENCH = { x: 0.72, z: 0.38 };

export function nameMachine(bp: Blueprint): string {
  const has = (id: string) => bp.parts.some((p) => p.def === id);
  const count = (id: string) => bp.parts.filter((p) => p.def === id).length;
  const wheels = count('lawn_wheel') + count('bike_wheel') + (has('skateboard') ? 4 : 0);
  let noun = 'Contraption';
  if (has('bottle_rocket')) noun = 'Rocket';
  else if (has('balloons') && has('box_fan')) noun = 'Blimp';
  else if (has('balloons')) noun = 'Floater';
  else if (has('vacuum')) noun = 'Suck-o-Matic';
  else if (has('winch')) noun = 'Reel-o-Tron';
  else if (wheels >= 3 && has('rc_receiver')) noun = 'RC Rover';
  else if (wheels >= 3) noun = 'Cart';
  else if (has('hinge') && (has('bungee') || has('spring'))) noun = 'Catapult';
  else if (has('box_fan')) noun = 'Wind Machine';
  else if (has('trampoline')) noun = 'Launch Pad';
  const adj = has('duct_tape') ? 'Sticky ' : has('motor') && noun !== 'RC Rover' ? 'Motorized ' : count('brick') > 1 ? 'Heavy ' : '';
  return `${adj}${noun}`;
}

export class BuildMode {
  bp!: Blueprint;
  view!: BlueprintView;
  active = false;
  testing = false;
  private proxies = new THREE.Group();
  private markers = new THREE.Group();
  private ghost: THREE.Group | null = null;
  private linkLine: THREE.Mesh | null = null;
  private holding: Holding | null = null;
  private linkStart: { part: number; point: THREE.Vector3 } | null = null;
  private selected: number | null = null;
  private root!: HTMLElement;
  private tray!: HTMLElement;
  private status!: HTMLElement;
  private panel!: HTMLElement;
  private tools!: HTMLElement;
  private stats!: HTMLElement;
  private topBtns!: HTMLElement;
  private pointers = new Map<number, { x: number; y: number; sx: number; sy: number; t: number; grab?: boolean; gx?: number; gy?: number }>();
  /** A finger down on a tray slot: a tap picks the part, a swipe up drags it out, sideways scrolls. */
  private trayPress: { id: string; pointerId: number; sx: number; sy: number; x: number; t: number; scroll0: number; scrolling: boolean; v: number } | null = null;
  private trayFling = 0;
  private pinch: { d: number; a: number } | null = null;
  private dragFromTray = false;
  /** Screen point the held part is aimed at (moved by d-pad, taps, drags, mouse). */
  private cursor: { x: number; y: number } | null = null;
  private cursorEl!: HTMLElement;
  private dpad!: HTMLElement;
  private placeBar!: HTMLElement;
  private hoverLift = new THREE.Vector3();
  /** Lock points the held part can click onto, and which one it is aimed at. */
  private studs: Stud[] = [];
  private aim = -1;
  private placeCache = new Map<number, Placement | null>();
  private studMesh: THREE.InstancedMesh | null = null;
  private fineTune = false;
  /** Following an idea's instructions. */
  guide: { idea: Idea; step: number; uids: number[] } | null = null;
  private guideEl!: HTMLElement;
  private guideFinished = false;
  private raycaster = new THREE.Raycaster();
  private listeners: [EventTarget, string, EventListener][] = [];
  private time = 0;

  constructor(private host: BuildHost) {}

  // ------------------------------------------------------------------ lifecycle

  enter(bp: Blueprint) {
    this.active = true;
    this.bp = bp;
    this.view = new BlueprintView(bp);
    this.view.group.position.copy(this.host.benchOrigin);
    this.proxies.position.copy(this.host.benchOrigin);
    this.markers.position.copy(this.host.benchOrigin);
    const scene = this.host.r.scene;
    scene.add(this.view.group, this.proxies, this.markers);
    this.rebuildProxies();
    const o = this.host.cam.orbit;
    o.center.copy(this.host.benchOrigin).add(new THREE.Vector3(0, 0.12, 0));
    o.yaw = Math.PI / 2 + 0.35;
    o.pitch = 0.6;
    o.dist = 1.7;
    this.host.cam.set('bench');
    this.buildUI();
    const canvas = this.host.r.canvas;
    this.on(canvas, 'pointerdown', (e) => this.pDown(e as PointerEvent));
    this.on(window, 'pointermove', (e) => this.pMove(e as PointerEvent));
    this.on(window, 'pointerup', (e) => this.pUp(e as PointerEvent));
    this.on(window, 'pointercancel', (e) => this.pUp(e as PointerEvent));
    this.on(canvas, 'wheel', (e) => {
      const we = e as WheelEvent;
      o.dist = THREE.MathUtils.clamp(o.dist * (1 + Math.sign(we.deltaY) * 0.1), 0.7, 6);
      we.preventDefault();
    });
    this.on(window, 'keydown', (e) => this.key((e as KeyboardEvent).key.toLowerCase()));
    this.on(canvas, 'contextmenu', (e) => e.preventDefault());
    if (this.host.hints && bp.parts.length === 0) {
      setTimeout(() => this.active && this.bp.parts.length === 0 && this.host.thought.say('My lab! Drag something from the shelf onto the bench.', 5000), 700);
    }
    this.refresh();
  }

  exit() {
    this.active = false;
    this.clearHolding();
    this.select(null);
    for (const [t, n, f] of this.listeners) t.removeEventListener(n, f);
    this.listeners = [];
    this.view.group.removeFromParent();
    this.proxies.removeFromParent();
    this.markers.removeFromParent();
    this.root?.remove();
  }

  private on(t: EventTarget, n: string, f: EventListener) {
    t.addEventListener(n, f, { passive: false } as AddEventListenerOptions);
    this.listeners.push([t, n, f]);
  }

  // ------------------------------------------------------------------ UI

  private buildUI() {
    this.root = h('div', { class: 'build-ui' });
    this.stats = h('div', { class: 'chip' });
    this.topBtns = h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end' });
    const top = h('div', { class: 'build-top' }, this.stats, h('div', { class: 'spacer' }), this.topBtns);
    this.tray = h('div', { class: 'tray' });
    this.status = h('div', { class: 'build-status hidden' });
    this.panel = h('div', { class: 'build-panel hidden' });
    this.tools = h('div', { class: 'build-tools' });
    this.dpad = h('div', { class: 'dpad hidden' });
    this.placeBar = h('div', { class: 'place-bar hidden' });
    this.cursorEl = h('div', { class: 'build-cursor hidden' });
    this.guideEl = h('div', { class: 'guide-card hidden' });
    this.guideEl.addEventListener('pointerdown', (e) => e.stopPropagation());
    for (const el of [this.tray, this.panel, this.tools, this.dpad, this.placeBar]) {
      el.addEventListener('pointerdown', (e) => e.stopPropagation());
    }
    this.root.append(top, this.tray, this.status, this.panel, this.tools, this.dpad, this.placeBar, this.cursorEl, this.guideEl);
    this.host.ui.appendChild(this.root);
  }

  private refresh() {
    const bp = this.bp;
    const mass = blueprintMass(bp);
    const n = bp.parts.length;
    const mv = this.holding?.moving;
    if (mv) {
      this.stats.innerHTML = `Moving: ${this.escape(getPart(this.holding!.def).name)}<small>${mv.parts.length > 1 ? `with ${mv.parts.length - 1} attached` : 'arrows to move, ✔ to drop'}</small>`;
      this.renderTop();
      this.renderTray();
      this.renderTools();
      this.renderPanel();
      this.renderMarkers();
      return;
    }
    this.stats.innerHTML = n ? `${this.escape(nameMachine(bp))}<small>${n} part${n === 1 ? '' : 's'} · ${mass.toFixed(1)} kg</small>` : `The Bench<small>empty</small>`;
    this.renderTop();
    this.renderTray();
    this.renderTools();
    this.renderPanel();
    this.renderMarkers();
    this.renderGuide();
  }

  private escape(s: string) {
    return s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);
  }

  private renderTop() {
    const b: HTMLElement[] = [];
    if (this.testing) {
      b.push(btn('■ STOP TEST', () => this.stopTest(), 'danger'));
    } else {
      if (this.host.sandbox) {
        b.push(btn('💾', () => this.saveCreation(), 'small'));
        b.push(btn('📂', () => this.loadMenu(), 'small'));
      }
      if (this.host.ideas().length && !this.guide) b.push(btn('💡 Idea', () => this.showIdea(), 'small'));
      if (this.bp.parts.length) b.push(btn('▶ TEST', () => this.test(), 'blue'));
      if (this.bp.parts.length) b.push(btn('✔ DONE', () => this.done(), 'primary'));
      b.push(btn('✕', () => this.leave(), 'small'));
    }
    this.topBtns.replaceChildren(...b);
  }

  private renderTray() {
    if (this.testing) {
      this.tray.classList.add('hidden');
      return;
    }
    this.tray.classList.remove('hidden');
    const list = this.host.stash.list();
    if (!list.length) {
      this.tray.replaceChildren(h('div', { class: 'empty-msg' }, 'The shelf is empty. Go find some junk and bring it here!'));
      return;
    }
    const order = new Map(PARTS.map((p, i) => [p.id, i]));
    list.sort((a, b) => (order.get(a[0]) ?? 0) - (order.get(b[0]) ?? 0));
    this.tray.replaceChildren(
      ...list.map(([id, count]) => {
        const def = getPart(id);
        const slot = h(
          'div',
          { class: `slot ${this.holding?.def === id ? 'active' : ''} ${count <= 0 ? 'empty' : ''} ${!this.holding && this.guideStep()?.part === id ? 'wanted' : ''}` },
          h('img', { src: partThumb(this.host.r.renderer, id), alt: def.name, draggable: 'false' }),
          h('div', { class: 'name' }, def.name),
          h('div', { class: 'count' }, this.host.stash.infinite ? '∞' : String(count)),
        );
        slot.addEventListener('pointerdown', (e) => this.trayDown(e, id));
        return slot;
      }),
    );
  }

  private renderTools() {
    this.tools.replaceChildren();
    const holding = this.holding && !this.testing;
    this.dpad.classList.toggle('hidden', !holding || !this.fineTune);
    this.placeBar.classList.toggle('hidden', !holding);
    this.cursorEl.classList.toggle('hidden', !holding);
    if (!holding) return;
    const def = getPart(this.holding!.def);
    const step = (dx: number, dy: number) => () => this.nudge(dx, dy);
    const hb = (l: string, f: () => void) => holdBtn(l, f, 'small', 200);
    const cell = (el: HTMLElement | null) => el ?? h('div');
    // Two rotation axes: spin (flat on the surface) and tilt (tip it up).
    const turnL = def.link ? null : btn('↺<small>spin</small>', () => this.spin(-45), 'small rot');
    const turnR = def.link ? null : btn('↻<small>spin</small>', () => this.spin(45), 'small rot');
    const tiltF = def.link ? null : btn('⤵<small>tilt</small>', () => this.tilt(-45), 'small rot');
    const tiltB = def.link ? null : btn('⤴<small>tilt</small>', () => this.tilt(45), 'small rot');
    this.dpad.replaceChildren(
      cell(turnL), hb('▲', step(0, -1)), cell(turnR),
      hb('◀', step(-1, 0)), h('div', { class: 'dpad-mid' }, '✥'), hb('▶', step(1, 0)),
      cell(tiltF), hb('▼', step(0, 1)), cell(tiltB),
    );
    const bar: HTMLElement[] = [];
    const moving = !!this.holding!.moving;
    if (def.link) bar.push(btn(this.linkStart ? '✔ TIE HERE' : '✔ TIE END', () => this.lockIn(), 'go'));
    else bar.push(btn('✔ PLACE', () => this.lockIn(), 'go'));
    if (this.fineTune && !def.link && def.sockets.length > 1) {
      const sk = def.sockets.find((x) => x.id === this.holding!.socket) ?? def.sockets[0];
      bar.push(btn(`⇅ ${sk.label}`, () => this.cycleSocket(), 'small'));
    }
    if (!def.link) bar.push(btn(this.fineTune ? '✓ Auto fit' : '🎯 Fine tune', () => this.toggleFineTune(), 'small'));
    bar.push(btn(moving ? '✕ Undo move' : '✕ Put back', () => this.clearHolding(), 'small'));
    this.placeBar.replaceChildren(...bar);
  }

  private renderPanel() {
    if (this.selected === null || this.testing) {
      this.panel.classList.add('hidden');
      return;
    }
    const part = findPart(this.bp, this.selected);
    if (!part) {
      this.panel.classList.add('hidden');
      return;
    }
    const def = getPart(part.def);
    const row = h('div', { class: 'row' });
    const motor = def.behaviors.find((b) => b.type === 'motor');
    if (motor) row.append(btn(part.settings?.reverse ? 'Spin ⟲' : 'Spin ⟳', () => this.setting(part.uid, { reverse: !part.settings?.reverse }), 'small'));
    const timer = def.behaviors.find((b) => b.type === 'timer');
    if (timer && timer.type === 'timer') {
      const cur = part.settings?.delay ?? timer.delay;
      const next = timer.options[(timer.options.indexOf(cur) + 1) % timer.options.length];
      row.append(btn(`⏱ ${cur}s`, () => this.setting(part.uid, { delay: next }), 'small'));
    }
    if (def.link?.kind === 'rope') {
      const l = this.bp.links.find((x) => x.part === part.uid);
      const [a, b] = l ? linkWorldEnds(this.bp, l) : [new THREE.Vector3(), new THREE.Vector3()];
      const span = a.distanceTo(b);
      const opts = (def.link.lengthOptions ?? [def.link.length]).filter((o) => o >= span - 1e-6);
      const cur = part.settings?.length ?? def.link.length;
      const next = opts[(opts.indexOf(cur) + 1) % opts.length] ?? cur;
      row.append(btn(`📏 ${cur} m`, () => this.setting(part.uid, { length: next }), 'small'));
    }
    if (!def.link) row.append(btn('✥ Move', () => this.startMove(part.uid), 'small blue'));
    row.append(btn('🗑 Remove', () => this.remove(part.uid), 'small danger'));
    this.panel.replaceChildren(
      h('h3', {}, def.name),
      h('div', {}, ...def.traits.map((t) => h('span', { class: 'trait' }, t))),
      h('p', {}, def.hint),
      row,
    );
    this.panel.classList.remove('hidden');
  }

  private setStatus(text: string | null, kind: '' | 'bad' | 'good' = '') {
    if (text && this.guide && kind !== 'bad') text = null;
    if (!text) {
      this.status.classList.add('hidden');
      return;
    }
    this.status.textContent = text;
    this.status.className = `build-status ${kind}`;
  }

  // ------------------------------------------------------------------ scene helpers

  private rebuildProxies() {
    this.proxies.clear();
    const inv = new THREE.MeshBasicMaterial({ visible: false });
    for (const p of this.bp.parts) {
      const def = getPart(p.def);
      if (def.link) continue;
      const pp = partPose(p);
      for (const s of def.shapes) {
        let geo: THREE.BufferGeometry;
        const hh = shapeHalf(s);
        if (s.kind === 'box') geo = new THREE.BoxGeometry(hh[0] * 2, hh[1] * 2, hh[2] * 2);
        else if (s.kind === 'ball') geo = new THREE.SphereGeometry(s.r!, 12, 8);
        else {
          geo = new THREE.CylinderGeometry(s.r!, s.r!, s.halfH! * 2, 16);
          if (s.axis === 'x') geo.rotateZ(Math.PI / 2);
          if (s.axis === 'z') geo.rotateX(Math.PI / 2);
        }
        const mesh = new THREE.Mesh(geo, inv);
        const lp = shapeLocalPose(s);
        mesh.position.copy(lp.p.clone().applyQuaternion(pp.q).add(pp.p));
        mesh.quaternion.copy(pp.q.clone().multiply(lp.q));
        mesh.userData.uid = p.uid;
        this.proxies.add(mesh);
      }
    }
    for (const l of this.bp.links) {
      const [a, b] = linkWorldEnds(this.bp, l);
      const d = b.clone().sub(a);
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, Math.max(0.01, d.length()), 6), inv);
      mesh.position.copy(a).add(b).multiplyScalar(0.5);
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
      mesh.userData.uid = l.part;
      mesh.userData.link = true;
      this.proxies.add(mesh);
    }
    this.proxies.updateMatrixWorld(true);
  }

  private renderMarkers() {
    this.markers.clear();
    if (!this.holding) return;
    const def = getPart(this.holding.def);
    for (const p of this.bp.parts) {
      const pdef = getPart(p.def);
      for (const t of pdef.targets ?? []) {
        const wantReel = !!def.link;
        if ((t.joint === 'reel') !== wantReel) continue;
        const pp = partPose(p);
        const m = new THREE.Mesh(new THREE.SphereGeometry(0.025, 10, 8), M.emissive(t.joint === 'driven' ? 0x40ff80 : t.joint === 'hinge' ? 0x40c0ff : 0xffc040));
        m.position.copy(v3(t.pos).applyQuaternion(pp.q).add(pp.p));
        m.userData.pulse = true;
        this.markers.add(m);
      }
    }
  }

  private rayFrom(clientX: number, clientY: number) {
    const rect = this.host.r.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.host.r.camera);
    return this.raycaster;
  }

  /** What's under the pointer, in machine space. */
  private pick(clientX: number, clientY: number, parts = true): { uid: number; point: THREE.Vector3; normal: THREE.Vector3; link: boolean } | { uid: null; point: THREE.Vector3 } | null {
    const rc = this.rayFrom(clientX, clientY);
    if (parts) {
      const hits = rc.intersectObjects(this.proxies.children, false);
      const hit = hits[0];
      if (hit && hit.face) {
        const n = hit.face.normal.clone().transformDirection(hit.object.matrixWorld).normalize();
        return { uid: hit.object.userData.uid, point: hit.point.clone().sub(this.host.benchOrigin), normal: n, link: !!hit.object.userData.link };
      }
    }
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -this.host.benchOrigin.y);
    const p = new THREE.Vector3();
    if (!rc.ray.intersectPlane(plane, p)) return null;
    const m = p.sub(this.host.benchOrigin);
    if (Math.abs(m.x) > BENCH.x + 0.3 || Math.abs(m.z) > BENCH.z + 0.3) return null;
    m.x = THREE.MathUtils.clamp(m.x, -BENCH.x, BENCH.x);
    m.z = THREE.MathUtils.clamp(m.z, -BENCH.z, BENCH.z);
    return { uid: null, point: m };
  }

  // ------------------------------------------------------------------ holding / placing

  private startHolding(def: string, moving?: MoveState, at?: { x: number; y: number }) {
    if (!moving && !this.host.stash.infinite && this.host.stash.count(def) <= 0) {
      this.host.audio.play('error');
      return;
    }
    this.clearHolding(false);
    this.select(null);
    const d = getPart(def);
    const settings = moving ? moving.parts.find((p) => p.uid === moving.uid)?.settings : undefined;
    this.holding = { def, spin: settings?.spin ?? 0, tilt: settings?.tilt ?? 0, socket: settings?.mount ?? d.sockets[0]?.id, manual: false, moving };
    if (!d.link) {
      this.ghost = new THREE.Group();
      // The ghost carries everything attached to the part being moved.
      const rootInv = moving ? { p: moving.oldRoot.p.clone(), q: moving.oldRoot.q.clone().invert() } : null;
      const members = moving ? moving.parts.filter((p) => !getPart(p.def).link) : [{ uid: -1, def, p: [0, 0, 0], q: [0, 0, 0, 1] } as Blueprint['parts'][number]];
      for (const m of members) {
        const g = partMesh(m.def);
        const str = g.getObjectByName('string');
        if (str) str.visible = false;
        if (rootInv) {
          const pp = partPose(m);
          g.position.copy(pp.p.sub(moving!.oldRoot.p).applyQuaternion(rootInv.q));
          g.quaternion.copy(rootInv.q.clone().multiply(pp.q));
        }
        this.ghost.add(g);
      }
      this.tintGhost(0x40ff80);
      this.ghost.visible = false;
      this.host.r.scene.add(this.ghost);
    }
    this.host.audio.play('pickup');
    this.regenStuds();
    this.refresh();
    if (this.aimGuide()) return;
    const start = at ?? this.defaultCursor(moving);
    if (!this.snapNear(start.x, start.y, Infinity)) this.firstValidStud();
    if (d.link) this.setStatus(`Tap where one end of the ${d.name.toLowerCase()} goes`);
    else if (this.host.hints) this.setStatus('Drag the ghost where you want it and let go, or tap a spot then tap the ghost.', 'good');
  }

  private tintGhost(color: number) {
    this.ghost?.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.material = M.basic(color, 0.5);
        m.castShadow = false;
      }
    });
  }

  /** Where the aim starts: over the moved part, on top of the machine, or mid-bench. */
  private defaultCursor(moving?: MoveState): { x: number; y: number } {
    let at: THREE.Vector3;
    if (moving) at = moving.oldRoot.p.clone();
    else if (this.bp.parts.length) {
      const b = blueprintBounds(this.bp);
      // Aim at the middle of the last thing placed: always somewhere solid.
      const last = this.bp.parts.filter((p) => !getPart(p.def).link).pop();
      at = last ? partPose(last).p : new THREE.Vector3((b.min.x + b.max.x) / 2, (b.min.y + b.max.y) / 2, (b.min.z + b.max.z) / 2);
    } else at = new THREE.Vector3(0, 0, 0);
    return this.toScreen(at);
  }

  private toScreen(machinePoint: THREE.Vector3): { x: number; y: number } {
    const p = machinePoint.clone().add(this.host.benchOrigin).project(this.host.r.camera);
    const rect = this.host.r.canvas.getBoundingClientRect();
    return { x: rect.left + ((p.x + 1) / 2) * rect.width, y: rect.top + ((1 - p.y) / 2) * rect.height };
  }

  // ------------------------------------------------------------------ lock points

  private regenStuds() {
    const def = this.holding ? getPart(this.holding.def) : null;
    this.studs = def ? generateStuds(this.bp, { forLink: !!def.link, bench: BENCH }) : [];
    this.placeCache.clear();
    this.aim = -1;
    this.studMesh?.removeFromParent();
    this.studMesh = null;
    if (!this.studs.length) return;
    const m = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.016, 0.016, 0.006, 10), M.basic(0xffffff, 0.55), this.studs.length);
    const mtx = new THREE.Matrix4();
    const up = new THREE.Vector3(0, 1, 0);
    this.studs.forEach((st, i) => {
      mtx.compose(st.point.clone().addScaledVector(st.normal, 0.004), new THREE.Quaternion().setFromUnitVectors(up, st.normal), new THREE.Vector3(1, 1, 1));
      m.setMatrixAt(i, mtx);
    });
    m.position.copy(this.host.benchOrigin);
    m.renderOrder = 2;
    this.studMesh = m;
    this.host.r.scene.add(m);
  }

  /** Hide a stud that turned out not to fit, so the dots only show real options. */
  private hideStud(i: number) {
    if (!this.studMesh) return;
    this.studMesh.setMatrixAt(i, new THREE.Matrix4().makeScale(0, 0, 0));
    this.studMesh.instanceMatrix.needsUpdate = true;
  }

  private placeWith(st: Stud, socket: string | undefined, spin: number, tilt: number): Placement {
    const h = this.holding!;
    if (st.part === null) return placeFree(this.bp, h.def, st.point.x, st.point.z, spin, socket, tilt);
    return computeAttach(this.bp, h.def, socket, { part: st.part, point: st.point, normal: st.normal }, spin, tilt);
  }

  /**
   * Auto-fit: try every way of holding the part against this spot and keep
   * the most natural one. Wheels go on as axles, things sit flat and low,
   * motor shafts point outward, long things line up with what they sit on.
   */
  private autoPlacement(st: Stud): Placement | null {
    const h = this.holding!;
    const def = getPart(h.def);
    const up = new THREE.Vector3(0, 1, 0);
    let best: { pl: Placement; score: number; socket?: string; spin: number } | null = null;
    const target = st.part !== null ? findPart(this.bp, st.part) : null;
    const tq = target ? partPose(target).q : null;
    const longAxis = (d: typeof def, q: THREE.Quaternion) => {
      const b = blueprintBounds({ ...this.bp, parts: [{ uid: -1, def: d.id, p: [0, 0, 0], q: [0, 0, 0, 1] }], links: [] });
      const size = b.max.clone().sub(b.min);
      const ax = size.x >= size.y && size.x >= size.z ? new THREE.Vector3(1, 0, 0) : size.z >= size.y ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
      return { dir: ax.applyQuaternion(q), long: Math.max(size.x, size.y, size.z) / Math.max(1e-3, Math.min(size.x, size.y, size.z)) };
    };
    const sockets = def.sockets.length ? def.sockets : [undefined];
    for (const sk of sockets) {
      for (const spin of [0, 90, 180, 270]) {
        const pl = this.placeWith(st, sk?.id, spin, 0);
        if (!pl.valid) continue;
        let score = 0;
        const n = st.normal;
        const sideFace = Math.abs(n.y) < 0.5;
        if (pl.conn && pl.conn.kind !== 'weld') score += 5; // real joints are what special spots are for
        if (sk?.joint === 'axle') score += sideFace ? 4 : -2; // wheels on the sides, not lying flat
        // Sit low and snug: centre of the part close to the surface.
        const rise = pl.pose.p.clone().sub(st.point);
        score -= (sideFace ? rise.length() : Math.max(0, rise.dot(up))) * 6;
        // Motor shafts (and any output) point away from what they are stuck to.
        for (const t of def.targets ?? []) {
          const out = new THREE.Vector3(...t.normal).applyQuaternion(pl.pose.q);
          if (sideFace) score += out.dot(n) * 3;
          else score += Math.abs(out.y) < 0.3 ? 1 : 0;
        }
        // Long things line up with long things.
        const mine = longAxis(def, pl.pose.q);
        if (tq && target && mine.long > 2) {
          const theirs = longAxis(getPart(target.def), tq);
          if (theirs.long > 2) score += Math.abs(mine.dir.dot(theirs.dir)) * 2;
        }
        if (sk?.id === def.sockets[0]?.id) score += 0.3;
        if (spin === 0) score += 0.1;
        if (!best || score > best.score) best = { pl, score, socket: sk?.id, spin };
      }
    }
    if (!best) return this.placeWith(st, h.socket, h.spin, h.tilt);
    best.pl.snapped = best.pl.snapped;
    (best.pl as Placement & { auto?: { socket?: string; spin: number } }).auto = { socket: best.socket, spin: best.spin };
    return best.pl;
  }

  private placementFor(i: number): Placement | null {
    if (this.placeCache.has(i)) return this.placeCache.get(i)!;
    const h = this.holding!;
    const st = this.studs[i];
    let pl: Placement | null = null;
    if (getPart(h.def).link) pl = null;
    else if (h.manual) pl = this.placeWith(st, h.socket, h.spin, h.tilt);
    else pl = this.autoPlacement(st);
    // Nothing is allowed to sink through the bench top.
    if (pl && pl.valid && !getPart(h.def).link) {
      const low = blueprintBounds({ ...this.bp, parts: [{ uid: -1, def: h.def, p: [pl.pose.p.x, pl.pose.p.y, pl.pose.p.z], q: [pl.pose.q.x, pl.pose.q.y, pl.pose.q.z, pl.pose.q.w] }], links: [] }).min.y;
      if (low < -0.01) pl = { ...pl, valid: false, reason: 'That would go through the bench' };
    }
    this.placeCache.set(i, pl);
    return pl;
  }

  private studUsable(i: number): boolean {
    const def = getPart(this.holding!.def);
    if (def.link) return this.studs[i].part !== null;
    const ok = !!this.placementFor(i)?.valid;
    if (!ok) this.hideStud(i);
    return ok;
  }

  /** Studs on the side of things facing the camera, with their screen spots. */
  private visibleStuds(): { i: number; x: number; y: number }[] {
    const cam = this.host.r.camera.position.clone().sub(this.host.benchOrigin);
    const out: { i: number; x: number; y: number }[] = [];
    this.studs.forEach((st, i) => {
      if (st.normal.dot(cam.clone().sub(st.point)) <= 0) return;
      const s = this.toScreen(st.point);
      out.push({ i, x: s.x, y: s.y });
    });
    return out;
  }

  private aimAt(i: number, sound = true) {
    this.aim = i;
    if (sound) this.host.audio.play('click');
    this.previewCursor();
  }

  /** Jump to the next lock point that way on screen. */
  private nudge(dx: number, dy: number) {
    if (this.aim < 0) {
      this.firstValidStud();
      return;
    }
    const here = this.toScreen(this.studs[this.aim].point);
    const order = rankInDirection(here, { x: dx, y: dy }, this.visibleStuds().filter((c) => c.i !== this.aim));
    for (const i of order.slice(0, 40)) {
      if (this.studUsable(i)) {
        this.aimAt(i);
        return;
      }
    }
    this.host.audio.play('error');
  }

  /** Snap to the usable lock point nearest a screen position. */
  private snapNear(x: number, y: number, maxPx = 90): boolean {
    const near = this.visibleStuds()
      .map((c) => ({ i: c.i, d: Math.hypot(c.x - x, c.y - y) }))
      .filter((c) => c.d <= maxPx)
      .sort((a, b) => a.d - b.d);
    for (const c of near.slice(0, 30)) {
      if (this.studUsable(c.i)) {
        if (c.i !== this.aim) this.aimAt(c.i);
        return true;
      }
    }
    return false;
  }

  private firstValidStud() {
    for (let i = 0; i < this.studs.length; i++) if (this.studUsable(i)) return this.aimAt(i, false);
    this.aim = -1;
    this.previewCursor();
  }

  private previewCursor() {
    if (this.aim < 0 || !this.studs[this.aim]) {
      this.cursorEl.classList.add('hidden');
      if (this.ghost) this.ghost.visible = false;
      this.setStatus('Nowhere for it to go. Try turning it or flipping it', 'bad');
      return;
    }
    const s = this.toScreen(this.studs[this.aim].point);
    this.cursor = s;
    this.cursorEl.classList.remove('hidden');
    this.cursorEl.classList.toggle('gold', this.studs[this.aim].special === 'guide');
    this.cursorEl.style.left = `${s.x}px`;
    this.cursorEl.style.top = `${s.y}px`;
    this.preview();
    if (this.guide) this.renderGuide();
  }

  /** After spinning / flipping: stay on this lock point if it still fits, else find a nearby one. */
  private reaim() {
    this.placeCache.clear();
    this.regenStuds();
    const prev = this.cursor;
    if (prev && this.snapNear(prev.x, prev.y, 140)) return this.previewCursor();
    this.firstValidStud();
  }

  private clearHolding(refresh = true) {
    const mv = this.holding?.moving;
    if (mv) {
      // Abandoned a move: put everything back exactly as it was.
      Object.assign(this.bp, clone(mv.snapshot));
      this.holding = null;
      this.view.rebuild();
      this.rebuildProxies();
    }
    this.holding = null;
    this.linkStart = null;
    this.cursor = null;
    this.studs = [];
    this.aim = -1;
    this.studMesh?.removeFromParent();
    this.studMesh = null;
    this.ghost?.removeFromParent();
    this.ghost = null;
    this.linkLine?.removeFromParent();
    this.linkLine = null;
    this.setStatus(null);
    if (refresh) this.refresh();
  }

  /** Switching to manual turning starts from whatever auto-fit had chosen. */
  private takeOverOrientation() {
    const h = this.holding!;
    if (h.manual) return;
    const pl = this.aim >= 0 ? (this.placementFor(this.aim) as (Placement & { auto?: { socket?: string; spin: number } }) | null) : null;
    if (pl?.auto) {
      h.socket = pl.auto.socket;
      h.spin = pl.auto.spin;
    }
    h.manual = true;
    this.fineTune = true;
    this.placeCache.clear();
  }

  private toggleFineTune() {
    if (!this.holding) return;
    if (this.fineTune) {
      this.fineTune = false;
      this.holding.manual = false;
      this.holding.tilt = 0;
      this.placeCache.clear();
      this.regenStuds();
      this.aimGuide() || this.firstValidStud();
    } else this.fineTune = true;
    this.host.audio.play('ui');
    this.renderTools();
    this.previewCursor();
  }

  private spin(deg: number) {
    if (!this.holding) return;
    this.takeOverOrientation();
    this.holding.spin = (((this.holding.spin + deg) % 360) + 360) % 360;
    this.host.audio.play('ui');
    this.reaim();
  }

  private tilt(deg: number) {
    if (!this.holding) return;
    this.takeOverOrientation();
    const t = this.holding.tilt + deg;
    this.holding.tilt = Math.max(-90, Math.min(90, t));
    this.host.audio.play('ui');
    this.reaim();
  }

  private cycleSocket() {
    if (!this.holding) return;
    this.takeOverOrientation();
    const def = getPart(this.holding.def);
    const i = def.sockets.findIndex((s) => s.id === this.holding!.socket);
    this.holding.socket = def.sockets[(i + 1) % def.sockets.length].id;
    this.host.audio.play('ui');
    this.renderTools();
    this.reaim();
  }

  // ------------------------------------------------------------------ moving placed parts

  /** Everything attached (directly or through others) onto this part. */
  private descendants(uid: number): Set<number> {
    const set = new Set([uid]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const c of this.bp.connections) {
        if (set.has(c.a) && !set.has(c.b)) {
          set.add(c.b);
          grew = true;
        }
      }
    }
    return set;
  }

  private startMove(uid: number) {
    const root = findPart(this.bp, uid);
    if (!root) return;
    const snapshot = clone(this.bp);
    const set = this.descendants(uid);
    const parts = this.bp.parts.filter((p) => set.has(p.uid));
    const connections = this.bp.connections.filter((c) => set.has(c.a) && set.has(c.b));
    const links = this.bp.links.filter((l) => set.has(l.a.part) || set.has(l.b.part));
    for (const l of links) {
      const lp = findPart(this.bp, l.part);
      if (lp) parts.push(lp);
    }
    const linkParts = new Set(links.map((l) => l.part));
    this.bp.parts = this.bp.parts.filter((p) => !set.has(p.uid) && !linkParts.has(p.uid));
    this.bp.connections = this.bp.connections.filter((c) => !set.has(c.a) && !set.has(c.b));
    this.bp.links = this.bp.links.filter((l) => !links.includes(l));
    const rp = partPose(root);
    const at = this.toScreen(rp.p);
    this.view.rebuild();
    this.rebuildProxies();
    this.startHolding(root.def, { uid, snapshot, oldRoot: { p: rp.p, q: rp.q }, parts, connections, links }, at);
  }

  /** Drop a moved part (and everything riding on it) at a new placement. */
  private commitMove(pl: Placement) {
    const mv = this.holding!.moving!;
    const inv = mv.oldRoot.q.clone().invert();
    const dq = pl.pose.q.clone().multiply(inv);
    const move = (v: THREE.Vector3) => v.sub(mv.oldRoot.p).applyQuaternion(dq).add(pl.pose.p);
    for (const p of mv.parts) {
      const pp = partPose(p);
      const np = move(pp.p);
      const nq = dq.clone().multiply(pp.q);
      p.p = [np.x, np.y, np.z];
      p.q = [nq.x, nq.y, nq.z, nq.w];
      const auto = (pl as Placement & { auto?: { socket?: string; spin: number } }).auto;
      if (p.uid === mv.uid) p.settings = { ...p.settings, mount: auto?.socket ?? this.holding!.socket, spin: auto?.spin ?? this.holding!.spin, tilt: auto ? 0 : this.holding!.tilt };
    }
    for (const c of mv.connections) {
      const a = move(v3(c.anchor));
      c.anchor = [a.x, a.y, a.z];
      if (c.axis) {
        const ax = v3(c.axis).applyQuaternion(dq);
        c.axis = [ax.x, ax.y, ax.z];
      }
    }
    this.bp.parts.push(...mv.parts);
    this.bp.connections.push(...mv.connections);
    if (pl.conn) {
      this.bp.connections.push({
        a: pl.conn.target,
        b: mv.uid,
        kind: pl.conn.kind,
        anchor: [pl.conn.anchor.x, pl.conn.anchor.y, pl.conn.anchor.z],
        axis: pl.conn.axis ? [pl.conn.axis.x, pl.conn.axis.y, pl.conn.axis.z] : undefined,
        tether: pl.conn.tether,
      });
    }
    // Ropes that can no longer reach come off and go back on the shelf.
    for (const l of mv.links) {
      this.bp.links.push(l);
      const def = getPart(findPart(this.bp, l.part)!.def);
      const [a, b] = linkWorldEnds(this.bp, l);
      if (def.link && a.distanceTo(b) > def.link.maxSpan) {
        for (const d of removePart(this.bp, l.part)) this.host.stash.give(d);
        this.host.toasts.show(`The ${def.name.toLowerCase()} couldn't reach any more`, 'bad');
      }
    }
    this.holding!.moving = undefined;
  }

  private preview() {
    if (!this.holding || this.aim < 0) return;
    const def = getPart(this.holding.def);
    if (def.link) {
      this.previewLink(def);
      return;
    }
    const pl = this.placementFor(this.aim);
    if (!pl || !this.ghost) return;
    this.ghost.visible = true;
    this.ghost.position.copy(pl.pose.p).add(this.host.benchOrigin);
    this.ghost.userData.base = this.ghost.position.clone();
    this.ghost.quaternion.copy(pl.pose.q);
    // Hover just off the spot it will land on.
    this.hoverLift.copy(pl.conn && pl.conn.kind !== 'tether' ? pl.pose.p.clone().sub(pl.conn.anchor).normalize() : new THREE.Vector3(0, 1, 0));
    const color = pl.valid ? (pl.conn && pl.conn.kind !== 'weld' ? 0x40c0ff : 0x40ff80) : 0xff4030;
    this.tintGhost(color);
    if (!pl.valid) this.setStatus(pl.reason ?? 'Nope', 'bad');
    else if (pl.conn) {
      const target = getPart(findPart(this.bp, pl.conn.target)!.def).name.toLowerCase();
      const how = { weld: 'Stick it to', axle: 'Spins freely on', hinge: 'Swings on', driven: 'Driven by', tether: 'Tie it to' }[pl.conn.kind];
      const tilt = this.holding.tilt;
      const note = tilt && pl.conn.kind !== 'weld' ? ' (stays square on it)' : tilt ? ` · tilted ${tilt}°` : '';
      this.setStatus(`${how} the ${target}${note}`, 'good');
    } else this.setStatus(`Put it on the bench${this.holding.tilt ? ` · tilted ${this.holding.tilt}°` : ''}`, 'good');
  }

  private previewLink(def: PartDef) {
    const st = this.studs[this.aim];
    if (!this.linkStart || st.part === null) {
      this.linkLine?.removeFromParent();
      this.linkLine = null;
      this.setStatus(this.linkStart ? 'Pick where the other end goes' : `Tie one end here? ✔`, 'good');
      return;
    }
    const a = this.linkStart.point;
    const b = st.point;
    const d = b.clone().sub(a);
    const len = d.length();
    const ok = len <= def.link!.maxSpan && len >= (def.link!.minLength ?? 0) && st.part !== this.linkStart.part;
    if (!this.linkLine) {
      this.linkLine = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 1, 6), M.basic(0x40ff80, 0.8));
      this.host.r.scene.add(this.linkLine);
    }
    this.linkLine.material = M.basic(ok ? 0x40ff80 : 0xff4030, 0.8);
    this.linkLine.position.copy(a).add(b).multiplyScalar(0.5).add(this.host.benchOrigin);
    this.linkLine.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize());
    this.linkLine.scale.set(1, Math.max(0.01, len), 1);
    this.setStatus(ok ? `${len.toFixed(2)} m — ✔ to tie it` : len > def.link!.maxSpan ? 'Too far apart' : 'Pick something else', ok ? 'good' : 'bad');
  }

  /** ✔: click the held part onto the lock point it is aimed at. */
  private lockIn() {
    if (!this.holding) return;
    if (this.aim < 0) {
      this.host.audio.play('error');
      return;
    }
    const def = getPart(this.holding.def);
    const st = this.studs[this.aim];
    if (def.link) {
      if (st.part === null) {
        this.host.audio.play('error');
        return;
      }
      if (!this.linkStart) {
        this.linkStart = { part: st.part, point: st.point.clone() };
        this.host.audio.play('tie');
        this.setStatus('Now pick where the other end goes, then ✔');
        this.renderTools();
        return;
      }
      const res = addLink(this.bp, def.id, this.linkStart, { part: st.part, point: st.point.clone() });
      if (!res.ok) {
        this.host.audio.play('error');
        this.setStatus(res.reason ?? 'Nope', 'bad');
        return;
      }
      this.host.stash.take(def.id);
      this.host.audio.play('tie');
      this.afterChange();
      this.linkStart = null;
      this.linkLine?.removeFromParent();
      this.linkLine = null;
      this.continueOrStop(def.id);
      return;
    }
    const pl = this.placementFor(this.aim);
    if (!pl || !pl.valid) {
      this.host.audio.play('error');
      this.setStatus(pl?.reason ?? 'That spot does not fit', 'bad');
      return;
    }
    if (this.holding.moving) {
      const uid = this.holding.moving.uid;
      this.commitMove(pl);
      this.host.audio.play('attach');
      this.afterChange();
      this.popUid(uid);
      this.clearHolding();
      return;
    }
    const auto = (pl as Placement & { auto?: { socket?: string; spin: number } }).auto;
    const atGuide = this.isGuideSpot(this.aim);
    const uid = commitPlacement(this.bp, pl, { mount: auto?.socket ?? this.holding.socket, spin: auto?.spin ?? this.holding.spin, tilt: auto ? 0 : this.holding.tilt });
    this.guideAdvance(uid, atGuide);
    this.host.stash.take(def.id);
    this.host.audio.play('attach');
    this.afterChange();
    this.popUid(uid);
    this.continueOrStop(def.id);
  }

  private continueOrStop(def: string) {
    // Following an idea that wants another of the same part: hand it straight over, already on the gold ring.
    const next = this.guideStep();
    if (next && next.part === def && !this.guideFinished && (this.host.stash.infinite || this.host.stash.count(def) > 0)) {
      this.regenStuds();
      this.refresh();
      if (this.aimGuide()) return;
    }
    // Otherwise empty hands: nothing lands on the bench by accident.
    this.guideFinished = false;
    this.clearHolding();
  }

  private popUid(uid: number) {
    const g = this.view.parts.get(uid);
    if (g) {
      g.scale.setScalar(1.25);
      g.userData.popT = 0.18;
    }
  }

  private afterChange() {
    this.view.rebuild();
    this.rebuildProxies();
    this.host.onChange(this.bp);
    if (this.host.hints && !this.guide) {
      const n = this.bp.parts.length;
      if (n === 1) this.host.thought.say('Now stick more stuff onto it. Wheels spin on axles. Motors spin whatever is on their shaft.', 5500);
      if (n === 3 && this.bp.parts.some((p) => getPart(p.def).behaviors.some((b) => b.type === 'motor')) && !this.bp.parts.some((p) => p.def.startsWith('battery')))
        this.host.thought.say("Motors won't do anything without a battery stuck to the same machine.", 5000);
    }
    this.refresh();
  }

  private select(uid: number | null) {
    this.selected = uid;
    this.view?.highlight(uid);
    if (uid !== null) this.host.audio.play('ui');
    this.renderPanel();
  }

  private setting(uid: number, s: Record<string, unknown>) {
    const p = findPart(this.bp, uid);
    if (!p) return;
    p.settings = { ...p.settings, ...s };
    this.host.audio.play('click');
    this.afterChange();
  }

  private remove(uid: number) {
    const removed = removePart(this.bp, uid);
    for (const d of removed) this.host.stash.give(d);
    this.host.audio.play('detach');
    this.selected = null;
    this.afterChange();
  }

  // ------------------------------------------------------------------ input

  private trayDown(e: PointerEvent, id: string) {
    e.stopPropagation();
    if (this.testing) return;
    // Nothing happens yet: wait to see if this is a tap, a drag out, or a scroll.
    cancelAnimationFrame(this.trayFling);
    this.trayPress = { id, pointerId: e.pointerId, sx: e.clientX, sy: e.clientY, x: e.clientX, t: performance.now(), scroll0: this.tray.scrollLeft, scrolling: false, v: 0 };
  }

  /** Let go of a tray scroll: keep gliding for a moment. */
  private flingTray(v: number) {
    const step = () => {
      if (Math.abs(v) < 0.02) return;
      this.tray.scrollLeft -= v * 16;
      v *= 0.94;
      this.trayFling = requestAnimationFrame(step);
    };
    this.trayFling = requestAnimationFrame(step);
  }

  private trayTap(id: string) {
    if (this.holding?.def === id && !this.holding.moving) this.clearHolding();
    else this.startHolding(id);
  }

  /** Is this screen point on (or right next to) the held ghost? */
  private onGhost(x: number, y: number): boolean {
    if (!this.holding) return false;
    if (this.cursor && Math.hypot(x - this.cursor.x, y - this.cursor.y) < 60) return true;
    if (!this.ghost?.visible) return false;
    const box = new THREE.Box3().setFromObject(this.ghost);
    const rect = this.host.r.canvas.getBoundingClientRect();
    let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
    for (let i = 0; i < 8; i++) {
      const c = new THREE.Vector3(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).project(this.host.r.camera);
      const sx = rect.left + ((c.x + 1) / 2) * rect.width;
      const sy = rect.top + ((1 - c.y) / 2) * rect.height;
      [x0, y0, x1, y1] = [Math.min(x0, sx), Math.min(y0, sy), Math.max(x1, sx), Math.max(y1, sy)];
    }
    const pad = 24;
    return x >= x0 - pad && x <= x1 + pad && y >= y0 - pad && y <= y1 + pad;
  }

  /**
   * Snap to the lock point under the finger: whatever part (or bench spot)
   * the finger is actually over, the closest click-on point on that face.
   * While following an idea, the gold ring pulls the part in from a distance.
   */
  private snapAt(x: number, y: number): boolean {
    const hit = this.pick(x, y);
    if (this.isGuideSpot(0) && this.studUsable(0)) {
      const g = this.toScreen(this.studs[0].point);
      const onTarget = hit && hit.uid !== null && hit.uid === this.studs[0].part;
      if (Math.hypot(g.x - x, g.y - y) < 120 || onTarget) {
        if (this.aim !== 0) this.aimAt(0);
        return true;
      }
    }
    if (hit && !(hit.uid !== null && hit.link)) {
      const cands: { i: number; d: number }[] = [];
      this.studs.forEach((st, i) => {
        if (hit.uid === null ? st.part !== null : st.part !== hit.uid) return;
        const d = st.point.distanceTo(hit.point);
        if (st.special && st.special !== 'guide') {
          if (d < 0.12) cands.push({ i, d: d - 0.08 }); // joint points (motor shafts, hinges) are sticky
        } else if (hit.uid === null || st.normal.dot(hit.normal) > 0.5) cands.push({ i, d });
      });
      cands.sort((a, b) => a.d - b.d);
      for (const c of cands.slice(0, 12)) {
        if (c.d > 0.3) break;
        if (this.studUsable(c.i)) {
          if (c.i !== this.aim) this.aimAt(c.i);
          return true;
        }
      }
    }
    return this.snapNear(x, y, 110);
  }

  private pDown(e: PointerEvent) {
    if (this.testing && e.pointerType !== 'mouse') {
      // allow orbiting while testing
    }
    // With a part in hand, a finger on the ghost drags it; anywhere else turns the view.
    const grab = !!this.holding && e.pointerType !== 'mouse' && this.pointers.size === 0 && this.onGhost(e.clientX, e.clientY);
    const c = this.cursor ?? { x: e.clientX, y: e.clientY };
    // Keep the part where it was relative to the finger (lifted a little so the finger does not hide it).
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now(), grab, gx: c.x - e.clientX, gy: Math.min(c.y - e.clientY, 0) - 40 });
    if (this.pointers.size === 2) for (const q of this.pointers.values()) q.grab = false;
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), a: Math.atan2(b.y - a.y, b.x - a.x) };
    }
    e.preventDefault();
  }

  private overTray(y: number) {
    const r = this.tray.getBoundingClientRect();
    return !this.tray.classList.contains('hidden') && y >= r.top;
  }

  private touchOffset(e: PointerEvent) {
    // Keep the part above the finger so you can see where it is going.
    return e.pointerType === 'touch' && this.holding ? -70 : 0;
  }

  private pMove(e: PointerEvent) {
    if (!this.active) return;
    const tp = this.trayPress;
    if (tp && tp.pointerId === e.pointerId) {
      const tdx = e.clientX - tp.sx;
      const tdy = e.clientY - tp.sy;
      if (!tp.scrolling && Math.abs(tdx) > 10 && Math.abs(tdx) > Math.abs(tdy) * 1.2) tp.scrolling = true;
      if (tp.scrolling) {
        // Sideways: scroll the tray.
        const now = performance.now();
        tp.v = (e.clientX - tp.x) / Math.max(1, now - tp.t);
        tp.x = e.clientX;
        tp.t = now;
        this.tray.scrollLeft = tp.scroll0 - tdx;
        return;
      }
      if (-tdy < 16 || -tdy < Math.abs(tdx) * 0.8) return;
      // Swiped up out of the tray: pick it up and drag it.
      this.trayPress = null;
      if (this.holding?.def !== tp.id || this.holding.moving) this.startHolding(tp.id);
      if (!this.holding) return;
      this.dragFromTray = true;
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: tp.sx, sy: tp.sy, t: 0 });
    }
    const p = this.pointers.get(e.pointerId);
    if (e.pointerType === 'mouse' && !p) {
      if (this.holding && (e.target as HTMLElement) === this.host.r.canvas) this.snapAt(e.clientX, e.clientY);
      return;
    }
    if (!p) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    if (this.pointers.size === 2 && this.pinch) {
      const [a, b] = [...this.pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      const o = this.host.cam.orbit;
      o.dist = THREE.MathUtils.clamp((o.dist * this.pinch.d) / Math.max(20, d), 0.7, 6);
      // Two fingers moving together orbit the view.
      o.yaw -= (dx / 2) * 0.008;
      o.pitch = THREE.MathUtils.clamp(o.pitch + (dy / 2) * 0.006, 0.05, 1.45);
      this.pinch.d = d;
      this.pinch.a = ang;
      return;
    }
    // Dragging the ghost itself (out of the tray, or grabbed on the bench) moves it.
    if (this.holding && (this.dragFromTray || e.pointerType === 'mouse' || p.grab)) {
      const ox = p.grab ? p.gx ?? 0 : 0;
      const oy = p.grab ? p.gy ?? 0 : this.touchOffset(e);
      if (!this.overTray(e.clientY)) this.snapAt(e.clientX + ox, e.clientY + oy);
      return;
    }
    // Orbit
    const moved = Math.hypot(e.clientX - p.sx, e.clientY - p.sy);
    if (moved > 6) {
      const o = this.host.cam.orbit;
      o.yaw -= dx * 0.008;
      o.pitch = THREE.MathUtils.clamp(o.pitch + dy * 0.006, 0.05, 1.45);
    }
  }

  private pUp(e: PointerEvent) {
    if (!this.active) return;
    const tp = this.trayPress;
    if (tp && tp.pointerId === e.pointerId) {
      this.trayPress = null;
      if (tp.scrolling) this.flingTray(performance.now() - tp.t < 80 ? tp.v : 0);
      else if (e.type !== 'pointercancel' && Math.hypot(e.clientX - tp.sx, e.clientY - tp.sy) < 12) this.trayTap(tp.id);
      return;
    }
    const p = this.pointers.get(e.pointerId);
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.pinch = null;
    if (!p) return;
    const moved = Math.hypot(e.clientX - p.sx, e.clientY - p.sy);
    const tap = moved < 10 && performance.now() - p.t < 450;
    if (this.dragFromTray) {
      this.dragFromTray = false;
      // Dropped back on the tray: never mind. Anywhere else: it clicks on.
      if (this.holding) {
        if (this.overTray(e.clientY)) this.clearHolding();
        else this.lockIn();
      }
      return;
    }
    // Let go after dragging a part: it clicks into place.
    if (p.grab && !tap && this.holding && !this.fineTune) {
      this.lockIn();
      return;
    }
    if (this.testing || !tap) return;
    if ((e.target as HTMLElement) !== this.host.r.canvas) return;
    if (this.holding) {
      const link = !!getPart(this.holding.def).link;
      // Tap the ghost (or click, with a mouse) to lock it in.
      if (e.pointerType === 'mouse' || (!link && this.onGhost(e.clientX, e.clientY))) this.lockIn();
      // Tap somewhere else: the ghost moves there and waits. Ropes tie on where you tap.
      else if (this.snapAt(e.clientX, e.clientY)) {
        if (link) this.lockIn();
        else if (!this.guide) this.setStatus('Looks good? Tap the ghost or ✔ PLACE', 'good');
      } else this.host.audio.play('error');
      return;
    }
    const hit = this.pick(e.clientX, e.clientY);
    const uid = hit && hit.uid !== null ? hit.uid : null;
    // Tapping the part that is already selected picks it back up to move it.
    const part = uid !== null ? findPart(this.bp, uid) : null;
    if (uid !== null && uid === this.selected && part && !getPart(part.def).link) this.startMove(uid);
    else this.select(uid);
  }

  private key(k: string) {
    if (!this.active) return;
    if (k === 'escape') {
      if (this.holding) this.clearHolding();
      else this.select(null);
    }
    if (k === 'r') this.spin(45);
    if (k === 'f') this.cycleSocket();
    if (this.holding) {
      if (k === 'arrowup') this.nudge(0, -1);
      if (k === 'arrowdown') this.nudge(0, 1);
      if (k === 'arrowleft') this.nudge(-1, 0);
      if (k === 'arrowright') this.nudge(1, 0);
      if (k === 'q') this.spin(-45);
      if (k === 'e') this.spin(45);
      if (k === 'z') this.tilt(-45);
      if (k === 'x') this.tilt(45);
      if (k === 'enter' || k === ' ') this.lockIn();
    }
    if (k === 'm' && this.selected !== null) this.startMove(this.selected);
    if ((k === 'delete' || k === 'backspace') && this.selected !== null) this.remove(this.selected);
  }

  // ------------------------------------------------------------------ actions

  private test() {
    if (!this.bp.parts.length) return;
    this.clearHolding(false);
    this.select(null);
    this.testing = true;
    this.view.group.visible = false;
    this.host.onTest(this.bp);
    this.refresh();
  }

  stopTest() {
    if (!this.testing) return;
    this.testing = false;
    this.view.group.visible = true;
    this.host.onStopTest();
    this.refresh();
  }

  private done() {
    const issues = validateBlueprint(this.bp);
    const err = issues.find((i) => i.severity === 'error');
    if (err) {
      this.host.toasts.show(err.message, 'bad');
      this.host.audio.play('error');
      return;
    }
    const warn = issues.find((i) => i.severity === 'warn');
    if (warn) this.host.thought.say(warn.message + '. Taking it anyway!', 3500);
    this.bp.name = nameMachine(this.bp);
    this.host.onDone(this.bp);
  }

  private leave() {
    this.host.onExit(this.bp);
  }

  private saveCreation() {
    if (!this.bp.parts.length) return;
    this.bp.name = nameMachine(this.bp);
    this.host.saveCreation(this.bp);
    this.host.toasts.show(`Saved "${this.escape(this.bp.name)}" to your notebook`, 'new');
  }

  private loadMenu() {
    const list = this.host.creations();
    if (!list.length) {
      this.host.toasts.show('No saved machines yet. Build one and tap 💾', '');
      return;
    }
    const wrap = h('div', { class: 'build-panel', style: 'max-height:50vh;overflow:auto' });
    wrap.addEventListener('pointerdown', (e) => e.stopPropagation());
    wrap.append(h('h3', {}, 'Saved machines'));
    list.forEach((c) => {
      wrap.append(
        btn(this.escape(c.name), () => {
          for (const p of [...this.bp.parts]) removePart(this.bp, p.uid);
          const copy = JSON.parse(JSON.stringify(c.bp)) as Blueprint;
          Object.assign(this.bp, copy);
          this.afterChange();
          wrap.remove();
        }, 'small'),
      );
    });
    wrap.append(btn('Close', () => wrap.remove(), 'small'));
    this.root.append(wrap);
  }

  // ------------------------------------------------------------------ ideas (guided builds)

  private guideStep() {
    return this.guide ? this.guide.idea.steps[this.guide.step] ?? null : null;
  }

  private guidePlacement(): Placement | null {
    const g = this.guide;
    const step = this.guideStep();
    if (!g || !step || !this.holding || this.holding.def !== step.part) return null;
    if (step.free) return placeFree(this.bp, step.part, step.free[0], step.free[1], step.spin ?? 0, step.socket);
    if (step.into) {
      const uid = g.uids[step.into.step];
      const t = findPart(this.bp, uid);
      if (!t) return null;
      const tdef = getPart(t.def).targets?.find((x) => x.id === step.into!.target);
      if (!tdef) return null;
      const tp = partPose(t);
      return computeAttach(this.bp, step.part, step.socket, { part: uid, point: transformPoint(tp, v3(tdef.pos)), normal: v3(tdef.normal).applyQuaternion(tp.q) }, step.spin ?? 0);
    }
    if (step.on !== undefined) {
      const uid = g.uids[step.on];
      const t = findPart(this.bp, uid);
      if (!t) return null;
      const tp = partPose(t);
      return computeAttach(this.bp, step.part, step.socket, { part: uid, point: transformPoint(tp, v3(step.local!)), normal: v3(step.normal!).applyQuaternion(tp.q) }, step.spin ?? 0);
    }
    return null;
  }

  /** If following an idea, add its exact spot as a lock point and aim there. */
  private aimGuide(): boolean {
    const pl = this.guidePlacement();
    if (!pl || !pl.valid) return false;
    const anchor = pl.conn ? pl.conn.anchor.clone() : new THREE.Vector3(pl.pose.p.x, 0, pl.pose.p.z);
    this.studs.unshift({ part: pl.conn?.target ?? null, point: anchor, normal: new THREE.Vector3(0, 1, 0), special: 'guide' });
    this.placeCache.clear();
    this.placeCache.set(0, pl);
    this.aim = 0;
    this.regenStudMesh();
    this.previewCursor();
    this.setStatus(`${this.guideStep()!.say} Drop it on the gold ring.`, 'good');
    return true;
  }

  private isGuideSpot(i: number): boolean {
    return !!this.guide && this.studs[i]?.special === 'guide';
  }

  private guideAdvance(uid: number, atGuide: boolean) {
    const g = this.guide;
    const step = this.guideStep();
    if (!g || !step) return;
    if (!atGuide) {
      this.guide = null;
      this.host.thought.say('Going my own way. Nice.', 2500);
      return;
    }
    g.uids[g.step] = uid;
    g.step++;
    if (g.step >= g.idea.steps.length) {
      this.host.thought.say(`Done! ${g.idea.after} (Tap ✔ DONE up top.)`, 8000);
      this.host.audio.play('discover');
      this.guide = null;
      this.guideFinished = true;
    }
  }

  private regenStudMesh() {
    // Rebuild the dot mesh after the guide spot was prepended.
    const studs = this.studs;
    this.studMesh?.removeFromParent();
    const m = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.016, 0.016, 0.006, 10), M.basic(0xffffff, 0.55), studs.length);
    const mtx = new THREE.Matrix4();
    studs.forEach((st, i) => {
      // Following an idea: only the gold ring shows, so there is one obvious place to go.
      const scale = st.special === 'guide' ? 3 : studs[0]?.special === 'guide' ? 0 : 1;
      mtx.compose(st.point.clone().addScaledVector(st.normal, 0.004), new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), st.normal), new THREE.Vector3(scale, 1, scale));
      m.setMatrixAt(i, mtx);
    });
    m.position.copy(this.host.benchOrigin);
    this.studMesh = m;
    this.host.r.scene.add(m);
  }

  private renderGuide() {
    const step = this.guideStep();
    const show = !!this.guide && !!step && !this.testing;
    this.root.classList.toggle('guiding', show);
    if (!show || !step || !this.guide) {
      this.guideEl.classList.add('hidden');
      return;
    }
    const g = this.guide;
    const have = this.host.stash.infinite || this.host.stash.count(step.part) > 0;
    const def = getPart(step.part);
    this.guideEl.replaceChildren(
      h('div', { class: 'guide-head' }, `💡 ${g.idea.title} · step ${g.step + 1} of ${g.idea.steps.length}`),
      h('div', { class: 'guide-say' }, step.say),
      have
        ? h('div', { class: 'guide-part' }, !this.holding ? `Tap the ${def.name} in the tray below 👇` : this.isGuideSpot(this.aim) ? 'It is on the gold ring. Tap ✔ PLACE ✨' : 'Drag it back to the gold ring ✨')
        : h('div', { class: 'guide-part missing' }, `You need a ${def.name}. Look in ${WHERE[step.part] ?? 'the yard'}, then bring it to the lab.`),
      btn('Stop guide', () => {
        this.guide = null;
        this.refresh();
      }, 'small'),
    );
    this.guideEl.classList.remove('hidden');
  }

  /** The idea card: what to build, what you have, where to find the rest. */
  showIdea(first = false) {
    const ideas = this.host.ideas();
    const idea = ideas[0];
    if (!idea) return;
    const need = new Map<string, number>();
    for (const st of idea.steps) need.set(st.part, (need.get(st.part) ?? 0) + 1);
    const rows = [...need.entries()].map(([id, n]) => {
      const have = this.host.stash.infinite ? n : Math.min(n, this.host.onBench(id));
      const ok = have >= n;
      return h(
        'div',
        { class: `idea-row ${ok ? 'ok' : ''}` },
        h('img', { src: partThumb(this.host.r.renderer, id), alt: '' }),
        h('span', {}, `${getPart(id).name} ${have}/${n}`),
        h('small', {}, ok ? '✓' : `in ${WHERE[id] ?? 'the yard'}`),
      );
    });
    const wrap = h('div', { class: 'idea-card' });
    wrap.addEventListener('pointerdown', (e) => e.stopPropagation());
    const close = () => wrap.remove();
    const start = () => {
      close();
      // Start from a clean bench so the steps line up.
      for (const p of [...this.bp.parts]) for (const d of removePart(this.bp, p.uid)) this.host.stash.give(d);
      this.guide = { idea, step: 0, uids: [] };
      this.afterChange();
    };
    wrap.append(
      h('div', { class: 'muted' }, first ? 'First time in the lab? Here is one idea. You can build anything, though!' : 'An idea'),
      h('h2', {}, `💡 ${idea.title}`),
      h('p', {}, idea.pitch),
      h('div', { class: 'idea-list' }, ...rows),
      h(
        'div',
        { class: 'row' },
        btn(this.bp.parts.length ? 'Clear bench & guide me' : 'Guide me', start, 'go'),
        btn('I will figure it out', close, 'small'),
      ),
    );
    this.root.append(wrap);
  }

  update(dt: number) {
    this.time += dt;
    if (this.aim >= 0 && this.studs[this.aim]) {
      const sc = this.toScreen(this.studs[this.aim].point);
      this.cursor = sc;
      this.cursorEl.style.left = `${sc.x}px`;
      this.cursorEl.style.top = `${sc.y}px`;
    }
    if (this.ghost?.visible) {
      const lift = 0.05 + Math.sin(this.time * 4) * 0.012;
      const base = this.ghost.userData.base as THREE.Vector3 | undefined;
      if (base) this.ghost.position.copy(base).addScaledVector(this.hoverLift, lift);
    }
    for (const m of this.markers.children) m.scale.setScalar(1 + Math.sin(this.time * 6) * 0.25);
    for (const g of this.view.parts.values()) {
      if (g.userData.popT > 0) {
        g.userData.popT -= dt;
        g.scale.setScalar(1 + Math.max(0, g.userData.popT) * 1.4);
      }
    }
  }

  benchBounds() {
    return blueprintBounds(this.bp);
  }
}
