import { btn, h } from './dom';

/**
 * The movie layer: letterbox bars, captions, a countdown, the rubber stamp and
 * a skip button. Used by the cold open and by instant replays.
 */
export class Cinema {
  el: HTMLElement;
  private tag: HTMLElement;
  private title: HTMLElement;
  private sub: HTMLElement;
  private cap: HTMLElement;
  private count: HTMLElement;
  private stampEl: HTMLElement;
  private flashEl: HTMLElement;
  private buttonsEl: HTMLElement;
  private skipBtn: HTMLButtonElement;
  private onSkip: (() => void) | null = null;

  constructor(parent: HTMLElement) {
    this.tag = h('span', { class: 'cine-tag' });
    this.title = h('span', { class: 'cine-title' });
    this.sub = h('span', { class: 'cine-sub' });
    this.cap = h('div', { class: 'cine-caption' });
    this.count = h('div', { class: 'cine-count' });
    this.stampEl = h('div', { class: 'cine-stamp' });
    this.flashEl = h('div', { class: 'cine-flash' });
    this.buttonsEl = h('div', { class: 'cine-buttons' });
    this.skipBtn = btn('Skip', () => this.onSkip?.(), 'small cine-skip');
    this.el = h(
      'div',
      { class: 'cinema hidden' },
      this.flashEl,
      h('div', { class: 'cine-bar top' }, h('span', { class: 'cine-logo' }, 'BACKYARD', h('b', {}, 'LAB')), this.tag),
      h('div', { class: 'cine-bar bottom' }, this.title, this.sub),
      this.cap,
      this.count,
      this.stampEl,
      this.buttonsEl,
      this.skipBtn,
    );
    this.el.addEventListener('pointerdown', (e) => e.stopPropagation());
    parent.append(this.el);
  }

  show(on: boolean) {
    this.el.classList.toggle('hidden', !on);
    document.body.classList.toggle('cinematic', on);
    if (!on) {
      this.caption(null);
      this.countdown(null);
      this.stamp(null);
      this.buttons([]);
      this.skip(null);
      this.setTag('');
      this.slowmo(false);
    }
  }

  setTag(text: string) {
    this.tag.textContent = text;
  }

  slowmo(on: boolean) {
    this.el.classList.toggle('slowmo', on);
  }

  bottom(title: string, sub = '') {
    this.title.textContent = title;
    this.sub.textContent = sub;
  }

  caption(text: string | null, sub?: string) {
    this.cap.classList.toggle('on', !!text);
    if (!text) return;
    this.cap.replaceChildren(h('div', {}, text), ...(sub ? [h('small', {}, sub)] : []));
    // Restart the type-on animation.
    this.cap.classList.remove('in');
    void this.cap.offsetWidth;
    this.cap.classList.add('in');
  }

  countdown(text: string | null) {
    this.count.classList.toggle('on', !!text);
    if (!text) return;
    this.count.textContent = text;
    this.count.classList.remove('pop');
    void this.count.offsetWidth;
    this.count.classList.add('pop');
  }

  stamp(text: string | null) {
    this.stampEl.classList.toggle('on', !!text);
    if (text) this.stampEl.textContent = text;
  }

  flash() {
    this.flashEl.classList.remove('go');
    void this.flashEl.offsetWidth;
    this.flashEl.classList.add('go');
  }

  /** The big title card at the end of the cold open. */
  logo(sub: string, button: HTMLElement) {
    this.buttonsEl.replaceChildren(h('div', { class: 'cine-logo-card' }, h('div', { class: 'logo' }, 'BACKYARD', h('span', {}, 'LAB')), h('p', {}, sub), button));
    this.buttonsEl.classList.add('on', 'center');
  }

  buttons(list: HTMLElement[]) {
    this.buttonsEl.classList.remove('center');
    this.buttonsEl.replaceChildren(...list);
    this.buttonsEl.classList.toggle('on', list.length > 0);
  }

  skip(fn: (() => void) | null, label = 'Skip') {
    this.onSkip = fn;
    this.skipBtn.innerHTML = label;
    this.skipBtn.classList.toggle('hidden', !fn);
  }
}
