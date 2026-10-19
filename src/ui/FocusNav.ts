import { padTypeFromId, type PadType } from '../input/bindings';
import { pickNext, Repeater, stickDir, type Box, type Dir } from './nav';

/** A menu screen: a DOM root plus optional handlers for Back, tab switching (LB/RB, Q/E) and Start. */
export interface Screen {
  root: HTMLElement;
  /** B / Esc / Backspace. */
  back?(): void;
  /** LB/RB, Q/E, PageUp/PageDown. */
  tab?(dir: -1 | 1): void;
  /** Start button / Enter-equivalent shortcut for the whole screen (e.g. GO on the drill list). */
  start?(): void;
  /** Element to focus when the screen is shown. */
  initialFocus?(): HTMLElement | null;
  /** Called every time the screen becomes the top of the stack. */
  enter?(): void;
}

export type MenuDevice = 'kbm' | 'gamepad';

const SEL = '[data-nav]:not([disabled])';

/**
 * Focus manager for the DOM menus: spatial D-pad/stick/arrow navigation, A/Enter activate, B/Esc back,
 * LB/RB tab switching, hover-to-focus for mouse/trackpad. Reads the Gamepad API directly (menus run while
 * gameplay input is disabled).
 */
export class FocusNav {
  screen: Screen | null = null;
  device: MenuDevice = 'kbm';
  padType: PadType = 'xbox';
  onDevice: (d: MenuDevice) => void = () => {};
  onPadType: (t: PadType) => void = () => {};
  private active = false;
  private held = new Set<string>();
  /** Keys whose keydown happened while the menu was active (a keyup alone, e.g. the Esc that paused, is ignored). */
  private armed = new Set<string>();
  private releaseWaiters: (() => void)[] = [];
  private prevPad = new Map<number, boolean[]>();
  private rep: Record<Dir, Repeater> = {
    up: new Repeater(),
    down: new Repeater(),
    left: new Repeater(),
    right: new Repeater(),
  };
  private last = 0;
  private raf = 0;

  constructor(host: HTMLElement) {
    addEventListener('keydown', this.onKeyDown, true);
    addEventListener('keyup', this.onKeyUp, true);
    addEventListener('blur', () => this.held.clear());
    // Hover-to-focus only on real pointer movement (re-rendered nodes under a still cursor must not steal focus).
    let lx = -1;
    let ly = -1;
    host.addEventListener('mousemove', (e) => {
      if (!this.active || (e.clientX === lx && e.clientY === ly)) return;
      lx = e.clientX;
      ly = e.clientY;
      const el = (e.target as HTMLElement).closest?.(SEL) as HTMLElement | null;
      if (el && this.screen?.root.contains(el) && document.activeElement !== el)
        el.focus({ preventScroll: true });
    });
    host.addEventListener('pointerdown', () => this.setDevice('kbm'));
  }

  setActive(v: boolean) {
    this.active = v;
    cancelAnimationFrame(this.raf);
    if (v) {
      this.last = performance.now();
      // Seed pad state so a button already held (e.g. Start that opened the pause menu) doesn't fire on entry.
      this.prevPad.clear();
      for (const p of this.pads())
        this.prevPad.set(
          p.index,
          p.buttons.map((b) => b.pressed),
        );
      this.raf = requestAnimationFrame(this.poll);
    }
  }

  setScreen(s: Screen | null) {
    this.screen = s;
    if (!s) return;
    const el = s.initialFocus?.() ?? this.focusables()[0];
    el?.focus({ preventScroll: true });
  }

  /** Run `fn` once no key or pad button is held (avoids the resume press leaking into gameplay). */
  afterRelease(fn: () => void) {
    if (this.held.size === 0 && !this.anyPadButton()) fn();
    else this.releaseWaiters.push(fn);
  }

  focusables(): HTMLElement[] {
    if (!this.screen) return [];
    return [...this.screen.root.querySelectorAll<HTMLElement>(SEL)].filter((e) => e.offsetParent !== null);
  }

  move(dir: Dir) {
    const cur = document.activeElement as HTMLElement | null;
    const list = this.focusables();
    if (!list.length) return;
    if (!cur || !list.includes(cur)) {
      list[0].focus({ preventScroll: true });
      return;
    }
    if ((dir === 'left' || dir === 'right') && cur.dataset.axis === 'x') {
      cur.dispatchEvent(new CustomEvent('nav-adjust', { detail: dir === 'right' ? 1 : -1 }));
      return;
    }
    const boxes: Box[] = list.map((e) => {
      const r = e.getBoundingClientRect();
      return { x: r.left, y: r.top, w: r.width, h: r.height };
    });
    const i = list.indexOf(cur);
    let j = pickNext(boxes[i], boxes, dir);
    // Wrap vertically within single-column lists.
    if (j < 0 && (dir === 'down' || dir === 'up') && cur.dataset.wrap !== undefined) {
      const col = list.filter((e) => e.parentElement === cur.parentElement);
      j = list.indexOf(dir === 'down' ? col[0] : col[col.length - 1]);
    }
    if (j >= 0) {
      list[j].focus({ preventScroll: true });
      list[j].scrollIntoView({ block: 'nearest' });
    }
  }

  activate() {
    const cur = document.activeElement as HTMLElement | null;
    if (cur && this.screen?.root.contains(cur) && cur.matches(SEL)) cur.click();
  }

  private setDevice(d: MenuDevice) {
    if (d === this.device) return;
    this.device = d;
    this.onDevice(d);
  }

  private onKeyDown = (e: KeyboardEvent) => {
    this.held.add(e.code);
    if (!this.active || !this.screen) return;
    this.armed.add(e.code);
    this.setDevice('kbm');
    const dirs: Record<string, Dir> = {
      ArrowUp: 'up',
      ArrowDown: 'down',
      ArrowLeft: 'left',
      ArrowRight: 'right',
      KeyW: 'up',
      KeyS: 'down',
      KeyA: 'left',
      KeyD: 'right',
    };
    let handled = true;
    if (dirs[e.code]) this.move(dirs[e.code]);
    else if (e.code === 'Tab') this.move(e.shiftKey ? 'up' : 'down');
    else if (e.code === 'Enter' || e.code === 'Space' || e.code === 'NumpadEnter') {
      if (!e.repeat) this.activate();
    } else if (e.code === 'KeyQ' || e.code === 'PageUp') this.screen.tab?.(-1);
    else if (e.code === 'KeyE' || e.code === 'PageDown') this.screen.tab?.(1);
    else if (e.code === 'Escape' || e.code === 'Backspace') {
      /* handled on keyup so the key isn't still down when gameplay resumes */
    } else handled = false;
    if (handled) e.preventDefault();
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.held.delete(e.code);
    const armed = this.armed.delete(e.code);
    if (armed && this.active && this.screen && (e.code === 'Escape' || e.code === 'Backspace'))
      this.screen.back?.();
    this.flushRelease();
  };

  private pads(): Gamepad[] {
    const list = navigator.getGamepads?.() ?? [];
    return [...list].filter((p): p is Gamepad => !!p && p.connected);
  }

  private anyPadButton() {
    return this.pads().some((p) => p.buttons.some((b) => b.pressed));
  }

  private flushRelease() {
    if (!this.releaseWaiters.length || this.held.size || this.anyPadButton()) return;
    const w = this.releaseWaiters;
    this.releaseWaiters = [];
    for (const fn of w) fn();
  }

  private poll = (now: number) => {
    if (!this.active) return;
    this.raf = requestAnimationFrame(this.poll);
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    const pads = this.pads();
    const want: Record<Dir, boolean> = { up: false, down: false, left: false, right: false };
    for (const p of pads) {
      const b = p.buttons.map((x) => x.pressed);
      const prev = this.prevPad.get(p.index) ?? [];
      const edge = (i: number) => b[i] && !prev[i];
      if (b.some(Boolean) || Math.hypot(p.axes[0] ?? 0, p.axes[1] ?? 0) > 0.5) {
        this.setDevice('gamepad');
        const t = padTypeFromId(p.id ?? '');
        if (t !== this.padType) this.onPadType((this.padType = t));
      }
      if (b[12]) want.up = true;
      if (b[13]) want.down = true;
      if (b[14]) want.left = true;
      if (b[15]) want.right = true;
      const sd = stickDir(p.axes[0] ?? 0, p.axes[1] ?? 0);
      if (sd) want[sd] = true;
      if (this.screen) {
        if (edge(0)) this.activate();
        if (edge(1)) this.screen.back?.();
        if (edge(4)) this.screen.tab?.(-1);
        if (edge(5)) this.screen.tab?.(1);
        if (edge(9)) (this.screen.start ?? this.screen.back)?.call(this.screen);
      }
      this.prevPad.set(p.index, b);
    }
    for (const d of Object.keys(want) as Dir[]) if (this.rep[d].update(want[d], dt)) this.move(d);
    this.flushRelease();
  };
}
