import * as THREE from 'three';
import { getPart, PARTS, type PartDef } from '../data/parts';
import {
  addLink,
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
}

interface Holding {
  def: string;
  socket?: string;
  spin: number;
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
  private pointers = new Map<number, { x: number; y: number; sx: number; sy: number; t: number }>();
  private pinch: { d: number; a: number } | null = null;
  private dragFromTray = false;
  private hover: { x: number; y: number } | null = null;
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
    for (const el of [this.tray, this.panel, this.tools]) {
      el.addEventListener('pointerdown', (e) => e.stopPropagation());
    }
    this.root.append(top, this.tray, this.status, this.panel, this.tools);
    this.host.ui.appendChild(this.root);
  }

  private refresh() {
    const bp = this.bp;
    const mass = blueprintMass(bp);
    const n = bp.parts.length;
    this.stats.innerHTML = n ? `${this.escape(nameMachine(bp))}<small>${n} part${n === 1 ? '' : 's'} · ${mass.toFixed(1)} kg</small>` : `The Bench<small>empty</small>`;
    this.renderTop();
    this.renderTray();
    this.renderTools();
    this.renderPanel();
    this.renderMarkers();
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
          { class: `slot ${this.holding?.def === id ? 'active' : ''} ${count <= 0 ? 'empty' : ''}` },
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
    const t: HTMLElement[] = [];
    if (this.holding && !this.testing) {
      const def = getPart(this.holding.def);
      if (!def.link) {
        t.push(btn('↻ Turn', () => this.spin(45), 'small'));
        if (def.sockets.length > 1) {
          const s = def.sockets.find((x) => x.id === this.holding!.socket) ?? def.sockets[0];
          t.push(btn(`⇅ ${s.label}`, () => this.cycleSocket(), 'small'));
        }
      }
      t.push(btn('✕ Put back', () => this.clearHolding(), 'small'));
    }
    this.tools.replaceChildren(...t);
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

  private startHolding(def: string) {
    if (!this.host.stash.infinite && this.host.stash.count(def) <= 0) {
      this.host.audio.play('error');
      return;
    }
    this.clearHolding(false);
    this.select(null);
    const d = getPart(def);
    this.holding = { def, spin: 0, socket: d.sockets[0]?.id };
    if (!d.link) {
      this.ghost = partMesh(def);
      const str = this.ghost.getObjectByName('string');
      if (str) str.visible = false;
      this.ghost.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.material = M.basic(0x40ff80, 0.5);
          m.castShadow = false;
        }
      });
      this.ghost.visible = false;
      this.host.r.scene.add(this.ghost);
      this.setStatus(this.bp.parts.length ? `Tap or drag onto the machine or the bench` : `Tap the bench to put it down`);
    } else {
      this.setStatus(`Tap where to tie one end of the ${d.name.toLowerCase()}`);
    }
    this.host.audio.play('pickup');
    this.refresh();
  }

  private clearHolding(refresh = true) {
    this.holding = null;
    this.linkStart = null;
    this.ghost?.removeFromParent();
    this.ghost = null;
    this.linkLine?.removeFromParent();
    this.linkLine = null;
    this.setStatus(null);
    if (refresh) this.refresh();
  }

  private spin(deg: number) {
    if (!this.holding) return;
    this.holding.spin = (this.holding.spin + deg) % 360;
    this.host.audio.play('ui');
    if (this.hover) this.preview(this.hover.x, this.hover.y);
  }

  private cycleSocket() {
    if (!this.holding) return;
    const def = getPart(this.holding.def);
    const i = def.sockets.findIndex((s) => s.id === this.holding!.socket);
    this.holding.socket = def.sockets[(i + 1) % def.sockets.length].id;
    this.host.audio.play('ui');
    this.renderTools();
    if (this.hover) this.preview(this.hover.x, this.hover.y);
  }

  private placementAt(x: number, y: number): Placement | null {
    const h = this.holding!;
    const hit = this.pick(x, y);
    if (!hit) return null;
    if (hit.uid !== null && !('link' in hit && hit.link)) {
      return computeAttach(this.bp, h.def, h.socket, { part: hit.uid, point: hit.point, normal: hit.normal }, h.spin);
    }
    const free = this.pick(x, y, false);
    if (!free) return null;
    return placeFree(this.bp, h.def, free.point.x, free.point.z, h.spin, h.socket);
  }

  private preview(x: number, y: number) {
    if (!this.holding) return;
    const def = getPart(this.holding.def);
    if (def.link) {
      this.previewLink(x, y, def);
      return;
    }
    const pl = this.placementAt(x, y);
    if (!pl || !this.ghost) {
      if (this.ghost) this.ghost.visible = false;
      return;
    }
    this.ghost.visible = true;
    this.ghost.position.copy(pl.pose.p).add(this.host.benchOrigin);
    this.ghost.quaternion.copy(pl.pose.q);
    const color = pl.valid ? (pl.conn && pl.conn.kind !== 'weld' ? 0x40c0ff : 0x40ff80) : 0xff4030;
    this.ghost.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.material = M.basic(color, 0.5);
    });
    if (!pl.valid) this.setStatus(pl.reason ?? 'Nope', 'bad');
    else if (pl.conn) {
      const target = getPart(findPart(this.bp, pl.conn.target)!.def).name.toLowerCase();
      const how = { weld: 'Stick it to', axle: 'Spins freely on', hinge: 'Swings on', driven: 'Driven by', tether: 'Tie it to' }[pl.conn.kind];
      this.setStatus(`${how} the ${target}`, 'good');
    } else this.setStatus('Put it on the bench', 'good');
  }

  private previewLink(x: number, y: number, def: PartDef) {
    const hit = this.pick(x, y);
    if (!this.linkStart || !hit || hit.uid === null) {
      this.linkLine?.removeFromParent();
      this.linkLine = null;
      return;
    }
    const a = this.linkStart.point;
    const b = hit.point;
    const d = b.clone().sub(a);
    const len = d.length();
    const ok = len <= def.link!.maxSpan && len >= (def.link!.minLength ?? 0) && hit.uid !== this.linkStart.part;
    if (!this.linkLine) {
      this.linkLine = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 1, 6), M.basic(0x40ff80, 0.8));
      this.host.r.scene.add(this.linkLine);
    }
    this.linkLine.material = M.basic(ok ? 0x40ff80 : 0xff4030, 0.8);
    this.linkLine.position.copy(a).add(b).multiplyScalar(0.5).add(this.host.benchOrigin);
    this.linkLine.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize());
    this.linkLine.scale.set(1, Math.max(0.01, len), 1);
    this.setStatus(ok ? `${len.toFixed(2)} m — tap to tie it` : len > def.link!.maxSpan ? 'Too far apart' : 'Pick something else', ok ? 'good' : 'bad');
  }

  private commitAt(x: number, y: number) {
    if (!this.holding) return;
    const def = getPart(this.holding.def);
    if (def.link) {
      const hit = this.pick(x, y);
      if (!hit || hit.uid === null || ('link' in hit && hit.link)) {
        this.host.audio.play('error');
        this.setStatus('Tie it to a part of the machine', 'bad');
        return;
      }
      if (!this.linkStart) {
        this.linkStart = { part: hit.uid, point: hit.point };
        this.host.audio.play('tie');
        this.setStatus('Now tap where the other end goes');
        return;
      }
      const res = addLink(this.bp, def.id, this.linkStart, { part: hit.uid, point: hit.point });
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
    const pl = this.placementAt(x, y);
    if (!pl || !pl.valid) {
      this.host.audio.play('error');
      if (pl?.reason) this.setStatus(pl.reason, 'bad');
      return;
    }
    commitPlacement(this.bp, pl);
    this.host.stash.take(def.id);
    this.host.audio.play('attach');
    this.pop(pl.pose.p.clone().add(this.host.benchOrigin));
    this.afterChange();
    this.continueOrStop(def.id);
  }

  private continueOrStop(def: string) {
    if (this.host.stash.infinite || this.host.stash.count(def) > 0) {
      this.refresh();
      return;
    }
    this.clearHolding();
  }

  private pop(at: THREE.Vector3) {
    const uid = this.bp.parts[this.bp.parts.length - 1]?.uid;
    const g = uid !== undefined ? this.view.parts.get(uid) : null;
    if (g) {
      g.scale.setScalar(1.25);
      g.userData.popT = 0.18;
    }
    void at;
  }

  private afterChange() {
    this.view.rebuild();
    this.rebuildProxies();
    this.host.onChange(this.bp);
    if (this.host.hints) {
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
    if (this.holding?.def === id) {
      this.clearHolding();
      return;
    }
    this.startHolding(id);
    if (!this.holding) return;
    this.dragFromTray = true;
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now() });
  }

  private pDown(e: PointerEvent) {
    if (this.testing && e.pointerType !== 'mouse') {
      // allow orbiting while testing
    }
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now() });
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
    return e.pointerType === 'touch' && this.dragFromTray ? -70 : 0;
  }

  private pMove(e: PointerEvent) {
    if (!this.active) return;
    const p = this.pointers.get(e.pointerId);
    if (e.pointerType === 'mouse' && !p) {
      this.hover = { x: e.clientX, y: e.clientY };
      if (this.holding && (e.target as HTMLElement) === this.host.r.canvas) this.preview(e.clientX, e.clientY);
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
      if (this.holding) {
        const da = ((ang - this.pinch.a) * 180) / Math.PI;
        if (Math.abs(da) > 12) {
          this.spin(Math.sign(da) * 45);
          this.pinch.a = ang;
        }
      }
      this.pinch.d = d;
      return;
    }
    const oy = this.touchOffset(e);
    if (this.holding && (this.dragFromTray || e.pointerType === 'mouse')) {
      this.hover = { x: e.clientX, y: e.clientY + oy };
      if (!this.overTray(e.clientY)) this.preview(e.clientX, e.clientY + oy);
      else if (this.ghost) this.ghost.visible = false;
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
    const p = this.pointers.get(e.pointerId);
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.pinch = null;
    if (!p) return;
    const moved = Math.hypot(e.clientX - p.sx, e.clientY - p.sy);
    const tap = moved < 10 && performance.now() - p.t < 450;
    if (this.dragFromTray) {
      this.dragFromTray = false;
      if (!tap && this.holding) {
        if (this.overTray(e.clientY)) this.clearHolding();
        else this.commitAt(e.clientX, e.clientY + (e.pointerType === 'touch' ? -70 : 0));
      }
      return;
    }
    if (this.testing || !tap) return;
    if ((e.target as HTMLElement) !== this.host.r.canvas) return;
    if (this.holding) {
      this.commitAt(e.clientX, e.clientY);
      return;
    }
    const hit = this.pick(e.clientX, e.clientY);
    this.select(hit && hit.uid !== null ? hit.uid : null);
  }

  private key(k: string) {
    if (!this.active) return;
    if (k === 'escape') {
      if (this.holding) this.clearHolding();
      else this.select(null);
    }
    if (k === 'r') this.spin(45);
    if (k === 'f') this.cycleSocket();
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

  update(dt: number) {
    this.time += dt;
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
