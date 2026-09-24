/** Tiny DOM helpers + the persistent HUD pieces. */

type Child = Node | string | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, unknown> = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = String(v);
    else if (k === 'style') el.setAttribute('style', String(v));
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    else if (k === 'html') el.innerHTML = String(v);
    else el.setAttribute(k, String(v));
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

/** A tiny physical tick where the device supports it (Android; iOS Safari ignores it). */
export function buzz(ms = 12) {
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* not supported */
  }
}

/** A button that reacts on pointerdown (snappy on touch) but ignores drags. */
export function btn(label: string, onPress: () => void, cls = ''): HTMLButtonElement {
  const b = h('button', { class: `btn ${cls}` });
  b.innerHTML = label;
  let fired = false;
  b.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    fired = true;
    b.classList.add('pressed');
  });
  b.addEventListener('pointerup', (e) => {
    e.stopPropagation();
    b.classList.remove('pressed');
    if (fired) onPress();
    fired = false;
  });
  b.addEventListener('pointerleave', () => {
    b.classList.remove('pressed');
    fired = false;
  });
  b.addEventListener('click', (e) => e.stopPropagation());
  return b;
}

export interface ActionDef {
  id: string;
  label: string;
  cls?: string;
  onPress: () => void;
}

/** A column of context buttons that only touches the DOM when the set changes. */
export class ActionBar {
  el: HTMLElement;
  private key = '';
  private handlers = new Map<string, () => void>();
  constructor(parent: HTMLElement, cls: string) {
    this.el = h('div', { class: `actions ${cls}` });
    parent.appendChild(this.el);
  }
  set(actions: ActionDef[]) {
    for (const a of actions) this.handlers.set(a.id, a.onPress);
    const key = actions.map((a) => `${a.id}|${a.label}|${a.cls ?? ''}`).join(';');
    if (key === this.key) return;
    this.key = key;
    this.el.replaceChildren(...actions.map((a) => btn(a.label, () => this.handlers.get(a.id)?.(), a.cls ?? '')));
  }
}

export class Toasts {
  el: HTMLElement;
  constructor(parent: HTMLElement) {
    this.el = h('div', { class: 'toasts' });
    parent.appendChild(this.el);
  }
  show(html: string, cls = '', ms = 2600) {
    const t = h('div', { class: `toast ${cls}`, html });
    this.el.appendChild(t);
    while (this.el.children.length > 3) this.el.firstElementChild?.remove();
    setTimeout(() => t.classList.add('out'), ms);
    setTimeout(() => t.remove(), ms + 400);
  }
}

/** The kid's thought bubble. */
export class Thought {
  el: HTMLElement;
  private timer = 0;
  constructor(parent: HTMLElement) {
    this.el = h('div', { class: 'thought hidden' });
    parent.appendChild(this.el);
  }
  say(text: string, ms = 4200) {
    this.el.textContent = text;
    this.el.classList.remove('hidden');
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.el.classList.add('hidden'), ms);
  }
  hide() {
    this.el.classList.add('hidden');
  }
}

export class Modal {
  el: HTMLElement;
  private card: HTMLElement;
  open = false;
  constructor(parent: HTMLElement) {
    this.el = h('div', { class: 'modal hidden' });
    this.card = h('div', { class: 'card' });
    this.el.appendChild(this.card);
    this.el.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.el.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true });
    parent.appendChild(this.el);
  }
  show(content: Node[], cls = '') {
    this.card.className = `card ${cls}`;
    this.card.replaceChildren(...content);
    this.el.classList.remove('hidden');
    this.open = true;
  }
  hide() {
    this.el.classList.add('hidden');
    this.open = false;
  }
}
