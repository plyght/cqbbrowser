import type { ActionFrame, ButtonAction, InputSource, PollInfo } from './actions';
import { buildKeyLookup, DEFAULT_KEY_BINDINGS, type KeyAction, type KeyBindings } from './bindings';
import { FlipButton, HoldGate, ModalButton } from './buttons';
import { keySettings, mouseSettings } from './config';
import type { Trackpad } from './Trackpad';

/** Radians per mouse count for a cm/360 sensitivity at a given DPI. */
export function radPerCount(cm360: number, dpi: number): number {
  const countsPer360 = (cm360 / 2.54) * dpi;
  return (Math.PI * 2) / Math.max(1, countsPer360);
}

/** Modal actions handled specially (not copied straight into `down`). */
const SPECIAL = new Set<KeyAction>([
  'aim',
  'sprint',
  'crouch',
  'restart',
  'moveForward',
  'moveBack',
  'moveLeft',
  'moveRight',
  'snapLeft',
  'snapRight',
]);

/**
 * Mouse + keyboard source (PRD §7.2). Pointer-locked look accumulating every coalesced pointer event, cm/360
 * sensitivity with an ADS multiplier, rebindable keys (persisted in `input.keys`), and hold/toggle modes for
 * aim/crouch/sprint. When the trackpad preset is active, look deltas are routed through `Trackpad.processLook`.
 */
export class KeyboardMouse implements InputSource {
  private codes = new Set<string>();
  /**
   * Codes pressed since the last poll. A press released before the next frame (trackpad tap-to-click sends
   * mousedown + mouseup within a millisecond; quick key taps at low frame rates) still counts as held for one
   * poll instead of vanishing.
   */
  private tapped = new Set<string>();
  private wheelCodes = new Set<string>();
  private dx = 0;
  private dy = 0;
  private dirty = false;
  private aim = new ModalButton();
  private sprint = new ModalButton();
  private crouch = new FlipButton();
  private restart = new HoldGate(0.5);
  private lookup = new Map<string, KeyAction[]>();
  private lookupKey: unknown[] = [];
  private held = new Set<KeyAction>();

  constructor(
    private el: HTMLElement,
    public trackpad?: Trackpad,
  ) {
    addEventListener('keydown', this.onKey);
    addEventListener('keyup', this.onKey);
    addEventListener('blur', () => {
      this.codes.clear();
      this.tapped.clear();
      this.dirty = true;
    });
    el.addEventListener('mousedown', this.onMouse);
    addEventListener('mouseup', this.onMouse);
    if ('onpointermove' in window) addEventListener('pointermove', this.onMove as EventListener);
    else addEventListener('mousemove', this.onMove);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('wheel', this.onWheel, { passive: false });
  }

  /** Current bindings (persisted overrides on top of defaults, so new actions get their default keys). */
  get bindings(): KeyBindings {
    return { ...DEFAULT_KEY_BINDINGS, ...keySettings.get().bindings };
  }

  private onKey = (e: KeyboardEvent) => {
    if (e.code === 'Tab' || e.code.startsWith('Alt') || e.code === 'Backspace') e.preventDefault();
    if (e.type === 'keydown') {
      this.codes.add(e.code);
      this.tapped.add(e.code);
    } else this.codes.delete(e.code);
    this.dirty = true;
  };

  private onMouse = (e: MouseEvent) => {
    const code = `Mouse${e.button}`;
    if (e.type === 'mousedown') {
      this.codes.add(code);
      this.tapped.add(code);
    } else this.codes.delete(code);
    if (e.button === 1) e.preventDefault();
    this.dirty = true;
  };

  private onMove = (e: MouseEvent) => {
    if (document.pointerLockElement !== this.el) return;
    let mx = e.movementX,
      my = e.movementY;
    // High-polling mice: sum every coalesced sample (some engines report only the last one on the parent).
    const pe = e as PointerEvent;
    if (typeof pe.getCoalescedEvents === 'function') {
      const list = pe.getCoalescedEvents();
      if (list.length > 1) {
        let sx = 0,
          sy = 0;
        for (const c of list) {
          sx += c.movementX;
          sy += c.movementY;
        }
        // Guard against engines whose coalesced entries carry zero movement.
        if (sx !== 0 || sy !== 0) {
          mx = sx;
          my = sy;
        }
      }
    }
    this.dx += mx;
    this.dy += my;
    if (mx || my) this.dirty = true;
  };

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    // Pinch (ctrl+wheel) and trackpad scrolling are owned by Trackpad.
    if (e.ctrlKey || this.trackpad?.active) return;
    if (e.deltaY) this.wheelCodes.add(e.deltaY < 0 ? 'WheelUp' : 'WheelDown');
    this.dirty = true;
  };

  private resolve(): Map<string, KeyAction[]> {
    const b = keySettings.get().bindings;
    const snap = !!this.trackpad?.snapTurns;
    if (this.lookupKey[0] !== b || this.lookupKey[1] !== snap) {
      this.lookup = buildKeyLookup(this.bindings, snap);
      this.lookupKey = [b, snap];
    }
    return this.lookup;
  }

  poll(frame: ActionFrame, dt: number, info?: PollInfo): void {
    const lookup = this.resolve();
    const ms = mouseSettings.get();
    const tp = this.trackpad?.active ? this.trackpad : undefined;
    const held = this.held;
    held.clear();
    for (const code of this.codes) for (const a of lookup.get(code) ?? []) held.add(a);
    for (const code of this.tapped) for (const a of lookup.get(code) ?? []) held.add(a);
    this.tapped.clear();

    const x = (held.has('moveRight') ? 1 : 0) - (held.has('moveLeft') ? 1 : 0);
    const y = (held.has('moveForward') ? 1 : 0) - (held.has('moveBack') ? 1 : 0);
    if (x || y) {
      const len = Math.hypot(x, y);
      frame.move.x += x / len;
      frame.move.y += y / len;
    }

    const aiming = info?.aiming ?? false;
    if (tp) {
      const look = tp.processLook(this.dx, this.dy, dt, aiming, x !== 0 || y !== 0);
      frame.look.yaw += look.yaw;
      frame.look.pitch += look.pitch;
    } else {
      const k = radPerCount(ms.cm360, ms.dpi) * (aiming ? ms.adsMultiplier : 1);
      frame.look.yaw += this.dx * k;
      frame.look.pitch -= this.dy * k * (ms.invertY ? -1 : 1);
    }
    this.dx = this.dy = 0;

    for (const a of held) if (!SPECIAL.has(a)) frame.down.add(a as ButtonAction);
    this.aim.mode = tp ? tp.adsMode : ms.aimMode;
    if (this.aim.update(held.has('aim'), dt)) frame.down.add('aim');
    this.sprint.mode = ms.sprintMode;
    if (this.sprint.update(held.has('sprint'), dt)) frame.down.add('sprint');
    this.crouch.mode = ms.crouchMode;
    if (this.crouch.update(held.has('crouch'), dt)) frame.pressed.add('crouch');
    this.restart.threshold = ms.restartHold;
    if (this.restart.update(held.has('restart'), dt)) frame.down.add('restart');

    for (const code of this.wheelCodes)
      for (const a of lookup.get(code) ?? []) if (!SPECIAL.has(a)) frame.pressed.add(a as ButtonAction);
    this.wheelCodes.clear();

    if (this.dirty) frame.activeDevice = tp ? 'trackpad' : 'keyboardMouse';
    this.dirty = false;
  }
}
