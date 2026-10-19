import { emptyFrame, type ActionFrame, type ButtonAction, type Haptics, type InputSource } from './actions';

/** Merges all sources into one ActionFrame per render frame and derives pressed/released edges. */
export class Input {
  frame: ActionFrame = emptyFrame();
  private prevDown = new Set<ButtonAction>();
  sources: InputSource[] = [];
  haptics: Haptics = { rumble() {} };
  enabled = true;

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
    for (const s of this.sources) s.poll(f, dt);
    // Sources may push direct presses (e.g. wheel ticks); keep them.
    for (const p of f.pressed) pressedExtra.add(p);
    if (!this.enabled) {
      f.down.clear();
      f.move.x = f.move.y = f.look.yaw = f.look.pitch = 0;
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
    return f;
  }
}
