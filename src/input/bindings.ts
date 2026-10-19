import type { ButtonAction, DeviceKind } from './actions';

/**
 * Binding tables + glyph labels (PRD §6.1, §7.1). Pure data/functions so the rebinding UI and prompts can use them.
 *
 * Keyboard/mouse bindings are action → list of codes. Codes are `KeyboardEvent.code` values plus the pseudo-codes
 * `Mouse0..Mouse4` (buttons) and `WheelUp` / `WheelDown`.
 */
export type MoveAction = 'moveForward' | 'moveBack' | 'moveLeft' | 'moveRight';
export type KeyAction = ButtonAction | MoveAction | 'snapLeft' | 'snapRight';
export type KeyBindings = Partial<Record<KeyAction, string[]>>;

export const DEFAULT_KEY_BINDINGS: KeyBindings = {
  moveForward: ['KeyW'],
  moveBack: ['KeyS'],
  moveLeft: ['KeyA'],
  moveRight: ['KeyD'],
  fire: ['Mouse0'],
  aim: ['Mouse2'],
  sprint: ['ShiftLeft'],
  crouch: ['KeyC', 'ControlLeft'],
  leanLeft: ['KeyQ'],
  leanRight: ['KeyE'],
  reload: ['KeyR'],
  interact: ['KeyF'],
  light: ['KeyT'],
  switchWeapon: ['Digit1', 'Digit2', 'Mouse1'],
  aimMode: ['KeyV'],
  magnifier: ['KeyB'],
  fireMode: ['KeyN'],
  fixCam: ['KeyH'],
  readyUp: ['WheelUp'],
  readyDown: ['WheelDown', 'KeyX'],
  slowWalk: ['AltLeft'],
  restart: ['Backspace'],
  pause: ['Escape'],
  // Gear: G flips the helmet NVG, 4 / mouse side button throws (hold to wind up, tap to roll), Y = IR laser.
  nvg: ['KeyG'],
  throw: ['Digit4', 'Mouse3'],
  ir: ['KeyY'],
  // Snap turns (trackpad helper, §7.3) — only active when enabled; they take precedence over other uses of the key.
  snapLeft: ['KeyZ'],
  snapRight: ['KeyX'],
};

const SNAP: KeyAction[] = ['snapLeft', 'snapRight'];

/** Builds a code → actions lookup. When snap turns are off, the snap bindings are ignored; when on, they shadow. */
export function buildKeyLookup(b: KeyBindings, snapTurns: boolean): Map<string, KeyAction[]> {
  const out = new Map<string, KeyAction[]>();
  const snapCodes = new Set<string>();
  if (snapTurns) for (const a of SNAP) for (const c of b[a] ?? []) snapCodes.add(c);
  for (const [action, codes] of Object.entries(b) as [KeyAction, string[]][]) {
    const isSnap = SNAP.includes(action);
    if (isSnap && !snapTurns) continue;
    for (const c of codes) {
      if (!isSnap && snapCodes.has(c)) continue;
      const list = out.get(c) ?? [];
      list.push(action);
      out.set(c, list);
    }
  }
  return out;
}

/** Returns a new binding table with `code` bound to `action` (replacing slot `slot`) and removed from others. */
export function rebindKey(b: KeyBindings, action: KeyAction, code: string, slot = 0): KeyBindings {
  const out: KeyBindings = {};
  for (const [a, codes] of Object.entries(b) as [KeyAction, string[]][]) {
    out[a] = codes.filter((c) => c !== code);
  }
  const list = [...(out[action] ?? [])];
  list.splice(Math.min(slot, list.length), slot < list.length ? 1 : 0, code);
  out[action] = list;
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Gamepad (W3C "standard" mapping indices)

export const PAD = {
  A: 0,
  B: 1,
  X: 2,
  Y: 3,
  LB: 4,
  RB: 5,
  LT: 6,
  RT: 7,
  View: 8,
  Menu: 9,
  LS: 10,
  RS: 11,
  Up: 12,
  Down: 13,
  Left: 14,
  Right: 15,
  Home: 16,
} as const;

/**
 * Controller "logical buttons". Most map 1:1 to ButtonActions; a few are gestures interpreted by Gamepad.ts:
 * dpadUp (tap = aimMode, hold = magnifier), dpadDown (tap = ready cycle, hold = fixCam),
 * light (D-pad left: tap = weapon light, hold = flip NVG), fireMode (D-pad right: tap = fire mode, hold = IR
 * laser), sprint (LS click latches sprint), restart (hold View). throw = RS click (hold to wind up / cook).
 */
export type PadAction =
  | 'interact'
  | 'crouch'
  | 'reload'
  | 'switchWeapon'
  | 'leanLeft'
  | 'leanRight'
  | 'aim'
  | 'fire'
  | 'restart'
  | 'pause'
  | 'sprint'
  | 'fixCamOrReady'
  | 'aimModeOrMagnifier'
  | 'light'
  | 'fireMode'
  | 'throw';

export type PadBindings = Record<PadAction, number>;

export const DEFAULT_PAD_BINDINGS: PadBindings = {
  interact: PAD.A,
  crouch: PAD.B,
  reload: PAD.X,
  switchWeapon: PAD.Y,
  leanLeft: PAD.LB,
  leanRight: PAD.RB,
  aim: PAD.LT,
  fire: PAD.RT,
  restart: PAD.View,
  pause: PAD.Menu,
  sprint: PAD.LS,
  aimModeOrMagnifier: PAD.Up,
  fixCamOrReady: PAD.Down,
  light: PAD.Left,
  fireMode: PAD.Right,
  throw: PAD.RS,
};

export type PadType = 'xbox' | 'playstation' | 'switch' | 'generic';

/** Guesses the controller family from `Gamepad.id` (vendor IDs: 045e Microsoft, 054c Sony, 057e Nintendo). */
export function padTypeFromId(id: string): PadType {
  const s = id.toLowerCase();
  if (/045e|xbox|xinput/.test(s)) return 'xbox';
  if (/054c|playstation|dualsense|dualshock|^wireless controller|ps[345]/.test(s)) return 'playstation';
  if (/057e|nintendo|pro controller|joy-?con/.test(s)) return 'switch';
  return 'generic';
}

const PAD_LABELS: Record<PadType, string[]> = {
  xbox: ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'View', 'Menu', 'LS', 'RS', '↑', '↓', '←', '→', 'Xbox'],
  playstation: [
    '✕',
    '○',
    '□',
    '△',
    'L1',
    'R1',
    'L2',
    'R2',
    'Share',
    'Options',
    'L3',
    'R3',
    '↑',
    '↓',
    '←',
    '→',
    'PS',
  ],
  // Standard mapping is positional: index 0 is the bottom face button, which Nintendo labels B.
  switch: ['B', 'A', 'Y', 'X', 'L', 'R', 'ZL', 'ZR', '−', '+', 'LS', 'RS', '↑', '↓', '←', '→', 'Home'],
  generic: [
    'A',
    'B',
    'X',
    'Y',
    'LB',
    'RB',
    'LT',
    'RT',
    'Select',
    'Start',
    'LS',
    'RS',
    '↑',
    '↓',
    '←',
    '→',
    'Home',
  ],
};

export function padButtonLabel(index: number, type: PadType): string {
  return PAD_LABELS[type][index] ?? `B${index}`;
}

/** Which pad logical action produces a given ButtonAction (for glyphs). */
const ACTION_TO_PAD: Partial<Record<ButtonAction, PadAction>> = {
  interact: 'interact',
  crouch: 'crouch',
  reload: 'reload',
  switchWeapon: 'switchWeapon',
  leanLeft: 'leanLeft',
  leanRight: 'leanRight',
  aim: 'aim',
  fire: 'fire',
  restart: 'restart',
  pause: 'pause',
  sprint: 'sprint',
  fixCam: 'fixCamOrReady',
  readyDown: 'fixCamOrReady',
  readyUp: 'fixCamOrReady',
  aimMode: 'aimModeOrMagnifier',
  magnifier: 'aimModeOrMagnifier',
  light: 'light',
  fireMode: 'fireMode',
  nvg: 'light',
  ir: 'fireMode',
  throw: 'throw',
};

const KEY_NAMES: Record<string, string> = {
  Mouse0: 'LMB',
  Mouse1: 'MMB',
  Mouse2: 'RMB',
  Mouse3: 'M4',
  Mouse4: 'M5',
  WheelUp: 'Wheel ↑',
  WheelDown: 'Wheel ↓',
  ShiftLeft: 'Shift',
  ShiftRight: 'R-Shift',
  ControlLeft: 'Ctrl',
  ControlRight: 'R-Ctrl',
  AltLeft: 'Alt',
  AltRight: 'R-Alt',
  Space: 'Space',
  Escape: 'Esc',
  Backspace: 'Backspace',
  Enter: 'Enter',
  Tab: 'Tab',
  CapsLock: 'Caps',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
};

/** Human label for a key/mouse code: 'KeyR' → 'R', 'Digit1' → '1', 'Mouse0' → 'LMB'. */
export function keyLabel(code: string): string {
  if (KEY_NAMES[code]) return KEY_NAMES[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `Num ${code.slice(6)}`;
  return code;
}

/** Trackpad preset overrides (§7.3); everything else falls back to the keyboard binding. */
const TRACKPAD_LABELS: Partial<Record<KeyAction, string>> = {
  fire: 'Click',
  aim: '2-Finger Click',
  readyUp: '2-Finger Scroll ↑',
  readyDown: '2-Finger Scroll ↓',
  magnifier: 'Pinch Out',
  aimMode: 'Pinch In',
};

/**
 * Text glyph for an action on a device, for live-swapping UI prompts. Kenney CC0 prompt images can replace these
 * later; the labels double as alt text.
 */
export function glyphFor(
  action: KeyAction,
  device: DeviceKind,
  padType: PadType = 'xbox',
  keys: KeyBindings = DEFAULT_KEY_BINDINGS,
  pad: PadBindings = DEFAULT_PAD_BINDINGS,
): string {
  if (device === 'gamepad') {
    const pa = ACTION_TO_PAD[action as ButtonAction];
    if (pa !== undefined) return padButtonLabel(pad[pa], padType);
    if (action.startsWith('move')) return padType === 'playstation' ? 'L' : 'LS';
    return '';
  }
  if (device === 'trackpad' && TRACKPAD_LABELS[action]) return TRACKPAD_LABELS[action]!;
  const code = keys[action]?.[0];
  return code ? keyLabel(code) : '';
}
