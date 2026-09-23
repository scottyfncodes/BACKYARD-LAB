/**
 * Unified desktop + touch input. Left side of a touchscreen is a floating
 * joystick, right side drags to look. Desktop uses WASD + mouse (pointer lock).
 */
export class Input {
  move = { x: 0, y: 0 };
  private keyMove = { x: 0, y: 0 };
  private stick = { x: 0, y: 0 };
  lookDX = 0;
  lookDY = 0;
  jump = false;
  sprint = false;
  keys = new Set<string>();
  enabled = true;
  /** Shortcut callback (e.g. 'e', 'g', 'r'). */
  onKey: (key: string) => void = () => {};
  onFirstGesture: () => void = () => {};
  sensitivity = 1;
  private stickId: number | null = null;
  private stickOrigin = { x: 0, y: 0 };
  private lookId: number | null = null;
  private lookLast = { x: 0, y: 0 };
  private stickEl: HTMLElement;
  private knobEl: HTMLElement;
  private gestured = false;
  touchMode = false;

  constructor(private surface: HTMLElement) {
    this.stickEl = document.createElement('div');
    this.stickEl.className = 'stick';
    this.knobEl = document.createElement('div');
    this.knobEl.className = 'knob';
    this.stickEl.appendChild(this.knobEl);
    document.body.appendChild(this.stickEl);

    window.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      this.gesture();
      const k = e.key.toLowerCase();
      if (!this.keys.has(k)) this.onKey(k);
      this.keys.add(k);
      if (k === ' ' || k === 'tab') e.preventDefault();
      this.updateKeys();
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.key.toLowerCase());
      this.updateKeys();
    });
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.updateKeys();
    });
    surface.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement === surface && this.enabled) {
        this.lookDX += e.movementX * 0.0022 * this.sensitivity;
        this.lookDY += e.movementY * 0.0022 * this.sensitivity;
      }
    });
    surface.addEventListener('touchstart', (e) => this.touchStart(e), { passive: false });
    surface.addEventListener('touchmove', (e) => this.touchMove(e), { passive: false });
    surface.addEventListener('touchend', (e) => this.touchEnd(e));
    surface.addEventListener('touchcancel', (e) => this.touchEnd(e));
    surface.addEventListener('mousedown', () => this.gesture());
  }

  private gesture() {
    if (!this.gestured) {
      this.gestured = true;
      this.onFirstGesture();
    }
  }

  lockPointer() {
    if (this.touchMode || !this.enabled) return;
    if (document.pointerLockElement !== this.surface) this.surface.requestPointerLock?.();
  }

  unlockPointer() {
    if (document.pointerLockElement) document.exitPointerLock?.();
  }

  get pointerLocked() {
    return document.pointerLockElement === this.surface;
  }

  private updateKeys() {
    const k = this.keys;
    this.keyMove.x = (k.has('d') || k.has('arrowright') ? 1 : 0) - (k.has('a') || k.has('arrowleft') ? 1 : 0);
    this.keyMove.y = (k.has('w') || k.has('arrowup') ? 1 : 0) - (k.has('s') || k.has('arrowdown') ? 1 : 0);
    this.jump = k.has(' ');
    this.sprint = k.has('shift');
    this.combine();
  }

  private combine() {
    this.move.x = Math.max(-1, Math.min(1, this.keyMove.x + this.stick.x));
    this.move.y = Math.max(-1, Math.min(1, this.keyMove.y + this.stick.y));
  }

  private touchStart(e: TouchEvent) {
    this.touchMode = true;
    this.gesture();
    if (!this.enabled) return;
    e.preventDefault();
    for (const t of Array.from(e.changedTouches)) {
      const left = t.clientX < window.innerWidth * 0.42;
      if (left && this.stickId === null) {
        this.stickId = t.identifier;
        this.stickOrigin = { x: t.clientX, y: t.clientY };
        this.stickEl.style.display = 'block';
        this.stickEl.style.left = `${t.clientX}px`;
        this.stickEl.style.top = `${t.clientY}px`;
        this.knobEl.style.transform = 'translate(-50%, -50%)';
      } else if (this.lookId === null) {
        this.lookId = t.identifier;
        this.lookLast = { x: t.clientX, y: t.clientY };
      }
    }
  }

  private touchMove(e: TouchEvent) {
    if (!this.enabled) return;
    e.preventDefault();
    for (const t of Array.from(e.changedTouches)) {
      if (t.identifier === this.stickId) {
        const R = 55;
        let dx = t.clientX - this.stickOrigin.x;
        let dy = t.clientY - this.stickOrigin.y;
        const len = Math.hypot(dx, dy);
        if (len > R) {
          dx = (dx / len) * R;
          dy = (dy / len) * R;
        }
        this.stick.x = dx / R;
        this.stick.y = -dy / R;
        // Push far to sprint.
        this.sprint = len > R * 1.6;
        this.knobEl.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
        this.combine();
      } else if (t.identifier === this.lookId) {
        this.lookDX += (t.clientX - this.lookLast.x) * 0.0055 * this.sensitivity;
        this.lookDY += (t.clientY - this.lookLast.y) * 0.0055 * this.sensitivity;
        this.lookLast = { x: t.clientX, y: t.clientY };
      }
    }
  }

  private touchEnd(e: TouchEvent) {
    for (const t of Array.from(e.changedTouches)) {
      if (t.identifier === this.stickId) {
        this.stickId = null;
        this.stick.x = this.stick.y = 0;
        this.sprint = false;
        this.stickEl.style.display = 'none';
        this.combine();
      }
      if (t.identifier === this.lookId) this.lookId = null;
    }
  }

  consumeLook(): [number, number] {
    const r: [number, number] = [this.lookDX, this.lookDY];
    this.lookDX = this.lookDY = 0;
    return r;
  }

  reset() {
    this.stickId = this.lookId = null;
    this.stick.x = this.stick.y = 0;
    this.stickEl.style.display = 'none';
    this.lookDX = this.lookDY = 0;
    this.combine();
  }
}
