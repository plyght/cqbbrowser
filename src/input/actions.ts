/**
 * Device-agnostic action layer. Gameplay code reads only this.
 * Devices (mouse/keyboard, trackpad, gamepad) write into it each frame.
 */
export type ButtonAction =
  | 'fire'
  | 'aim'
  | 'reload' // raw button; tap/double/hold interpretation is in ReloadGesture
  | 'sprint'
  | 'crouch'
  | 'leanLeft'
  | 'leanRight'
  | 'readyUp'
  | 'readyDown'
  | 'interact'
  | 'light'
  | 'switchWeapon'
  | 'aimMode'
  | 'magnifier'
  | 'fireMode'
  | 'fixCam'
  | 'slowWalk'
  | 'restart'
  | 'pause';

export type DeviceKind = 'keyboardMouse' | 'trackpad' | 'gamepad';

export interface ActionFrame {
  /** Movement intent, x = strafe right, y = forward. Magnitude 0..1 (analog on sticks). */
  move: { x: number; y: number };
  /** Look delta this frame, in radians (yaw right +, pitch up +). Already sensitivity-scaled. */
  look: { yaw: number; pitch: number };
  /** Analog lean -1..1 (optional devices); combined with leanLeft/leanRight buttons. */
  leanAxis: number;
  /** Analog trigger 0..1 for aim/fire where available. */
  fireAxis: number;
  aimAxis: number;
  down: Set<ButtonAction>;
  pressed: Set<ButtonAction>;
  released: Set<ButtonAction>;
  /** Device that produced input most recently (drives glyphs and per-device tuning). */
  activeDevice: DeviceKind;
}

export function emptyFrame(): ActionFrame {
  return {
    move: { x: 0, y: 0 },
    look: { yaw: 0, pitch: 0 },
    leanAxis: 0,
    fireAxis: 0,
    aimAxis: 0,
    down: new Set(),
    pressed: new Set(),
    released: new Set(),
    activeDevice: 'keyboardMouse',
  };
}

/** Haptics sink; gamepad implements it, others ignore. */
export interface Haptics {
  rumble(strong: number, weak: number, durationMs: number): void;
  triggerRumble?(left: number, right: number, durationMs: number): void;
}

export interface InputSource {
  /** Called once per render frame before gameplay reads the frame. */
  poll(frame: ActionFrame, dt: number): void;
  dispose?(): void;
}
