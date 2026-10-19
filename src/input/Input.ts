import {
  emptyFrame,
  type ActionFrame,
  type ButtonAction,
  type Haptics,
  type InputSource,
  type PollInfo,
} from './actions';

const NO_HAPTICS: Haptics = { rumble() {} };

/** Merges all sources into one ActionFrame per render frame and derives pressed/released edges. */
export class Input {
  frame: ActionFrame = emptyFrame();
  private prevDown = new Set<ButtonAction>();
  sources: InputSource[] = [];
  /** Active haptics sink: the gamepad's while a pad is the active device, otherwise a no-op. */
  haptics: Haptics = NO_HAPTICS;
  /** Set by the gamepad source; swapped in whenever the pad is the active device. */
  padHaptics: Haptics | null = null;
  enabled = true;
  /** Previous-frame state handed to sources. `ready` mirrors the player's ready-position transitions. */
  readonly info: PollInfo = { aiming: false, ready: 'high' };

  add(src: InputSource) {
    this.sources.push(src);
  }

  poll(dt: number): ActionFrame {
    const f = this.frame;
    const device = f.activeDevice;
    const pressedExtra = new Set<ButtonAction>();
    f.move.x = f.move.y = f.look.yaw = f.look.pitch = f.leanAxis = f.fireAxis = f.aimAxis = 0;
    f.down.clear();
    f.pressed.clear();
    f.released.clear();
    f.activeDevice = device;
    for (const s of this.sources) s.poll(f, dt, this.info);
    // Sources may push direct presses (e.g. wheel ticks); keep them.
    for (const p of f.pressed) pressedExtra.add(p);
    if (!this.enabled) {
      f.down.clear();
      f.move.x = f.move.y = f.look.yaw = f.look.pitch = 0;
      f.fireAxis = f.aimAxis = f.leanAxis = 0;
    }
    const m = Math.hypot(f.move.x, f.move.y);
    if (m > 1) {
      f.move.x /= m;
      f.move.y /= m;
    }
    if (f.fireAxis > 0.5) f.down.add('fire');
    if (f.aimAxis > 0.5) f.down.add('aim');
    for (const a of f.down) if (!this.prevDown.has(a)) f.pressed.add(a);
    for (const a of this.prevDown) if (!f.down.has(a)) f.released.add(a);
    for (const p of pressedExtra) f.pressed.add(p);
    this.prevDown = new Set(f.down);

    this.info.aiming = f.down.has('aim') || f.aimAxis > 0.3;
    // Mirror of Player's ready transitions (readyUp then readyDown), so a single pad button can cycle.
    const r = this.info;
    if (f.pressed.has('readyUp')) r.ready = r.ready === 'low' ? 'high' : 'compressed';
    if (f.pressed.has('readyDown')) r.ready = r.ready === 'compressed' ? 'high' : 'low';
    this.haptics = f.activeDevice === 'gamepad' && this.padHaptics ? this.padHaptics : NO_HAPTICS;
    return f;
  }
}
