import type { ActionFrame, ButtonAction, InputSource } from './actions';

const DEFAULT_KEYS: Record<string, ButtonAction> = {
  ShiftLeft: 'sprint',
  KeyC: 'crouch',
  ControlLeft: 'crouch',
  KeyQ: 'leanLeft',
  KeyE: 'leanRight',
  KeyR: 'reload',
  KeyF: 'interact',
  KeyT: 'light',
  Digit1: 'switchWeapon',
  Digit2: 'switchWeapon',
  KeyV: 'aimMode',
  KeyB: 'magnifier',
  KeyN: 'fireMode',
  KeyH: 'fixCam',
  KeyX: 'readyDown',
  AltLeft: 'slowWalk',
  Backspace: 'restart',
  Escape: 'pause',
};

/**
 * Baseline mouse + keyboard source. Pointer-locked raw mouse look.
 * Sensitivity is expressed as cm/360 assuming 800 dpi-equivalent counts (tunable in settings).
 */
export class KeyboardMouse implements InputSource {
  keyMap: Record<string, ButtonAction> = { ...DEFAULT_KEYS };
  /** Radians per mouse count. */
  radPerCount = 0.0022;
  private keys = new Set<string>();
  private buttons = new Set<ButtonAction>();
  private dx = 0;
  private dy = 0;
  private wheel = 0;
  private dirty = false;

  constructor(private el: HTMLElement) {
    addEventListener('keydown', this.onKey);
    addEventListener('keyup', this.onKey);
    addEventListener('blur', () => this.keys.clear());
    el.addEventListener('mousedown', this.onMouse);
    addEventListener('mouseup', this.onMouse);
    addEventListener('mousemove', this.onMove);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('wheel', this.onWheel, { passive: false });
  }

  private onKey = (e: KeyboardEvent) => {
    if (e.code === 'Tab' || e.code.startsWith('Alt') || e.code === 'Backspace') e.preventDefault();
    if (e.type === 'keydown') this.keys.add(e.code);
    else this.keys.delete(e.code);
    this.dirty = true;
  };

  private onMouse = (e: MouseEvent) => {
    const a: ButtonAction | null = e.button === 0 ? 'fire' : e.button === 2 ? 'aim' : null;
    if (!a) return;
    if (e.type === 'mousedown') this.buttons.add(a);
    else this.buttons.delete(a);
    this.dirty = true;
  };

  private onMove = (e: MouseEvent) => {
    if (document.pointerLockElement !== this.el) return;
    this.dx += e.movementX;
    this.dy += e.movementY;
    if (e.movementX || e.movementY) this.dirty = true;
  };

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    this.wheel += Math.sign(e.deltaY);
  };

  poll(frame: ActionFrame): void {
    const k = this.keys;
    const x = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0);
    const y = (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0);
    if (x || y) {
      const len = Math.hypot(x, y);
      frame.move.x += x / len;
      frame.move.y += y / len;
    }
    frame.look.yaw += this.dx * this.radPerCount;
    frame.look.pitch -= this.dy * this.radPerCount;
    this.dx = this.dy = 0;
    for (const code of k) {
      const a = this.keyMap[code];
      if (a) frame.down.add(a);
    }
    for (const b of this.buttons) frame.down.add(b);
    if (this.wheel < 0) frame.pressed.add('readyUp');
    if (this.wheel > 0) frame.pressed.add('readyDown');
    this.wheel = 0;
    if (this.dirty) frame.activeDevice = 'keyboardMouse';
    this.dirty = false;
  }
}
