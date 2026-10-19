/**
 * Settings schema registry. The Settings screen renders generic controls (slider / toggle / select) from these
 * entries and reads/writes them through `src/settings/Settings.ts` namespaces.
 *
 * Other systems append their own entries at module load:
 *   registerSettings([{ tab: 'audio', group: 'Mix', ns: 'audio', key: 'brass', label: 'Brass', kind: 'slider',
 *                       min: 0, max: 1, step: 0.05, default: 0.8, format: pct }]);
 * Registering the same ns+key again replaces the earlier entry (so an owner can refine labels/ranges).
 */
import {
  aimAssistSettings,
  gamepadSettings,
  gyroSettings,
  mouseSettings,
  trackpadSettings,
} from '../input/config';
import { settings } from '../settings/Settings';

export type SettingsTab = 'controls' | 'gameplay' | 'video' | 'audio' | 'accessibility';
export const TABS: { id: SettingsTab; label: string }[] = [
  { id: 'controls', label: 'Controls' },
  { id: 'gameplay', label: 'Gameplay' },
  { id: 'video', label: 'Video' },
  { id: 'audio', label: 'Audio' },
  { id: 'accessibility', label: 'Accessibility' },
];

interface Base {
  tab: SettingsTab;
  /** Sub-heading inside the tab (e.g. "Mouse", "Controller"). */
  group?: string;
  /** Settings namespace + key the value lives under (for action/notice rows: just a unique id). */
  ns: string;
  key: string;
  label: string;
  hint?: string;
  /** Sort order inside the group (default: registration order). */
  order?: number;
  /** Hide the row when this returns false (e.g. gyro rows without WebHID). Re-evaluated on every render. */
  visible?: () => boolean;
}
export interface SliderDef extends Base {
  kind: 'slider';
  min: number;
  max: number;
  step: number;
  default: number;
  format?: (v: number) => string;
}
export interface ToggleDef extends Base {
  kind: 'toggle';
  default: boolean;
}
export interface SelectDef extends Base {
  kind: 'select';
  options: { value: string; label: string }[];
  default: string;
}
/** A button row (e.g. "Connect gyro"). `run` is called from the click/A press, i.e. inside a user gesture. */
export interface ActionDef extends Base {
  kind: 'action';
  button: string;
  run: () => unknown;
  /** Status text shown next to the button (e.g. "Connected"). */
  status?: () => string;
  default?: undefined;
}
/** A non-interactive tip/banner row (label is the text). */
export interface NoticeDef extends Base {
  kind: 'notice';
  default?: undefined;
}
export type SettingDef = SliderDef | ToggleDef | SelectDef | ActionDef | NoticeDef;
export type ValueDef = SliderDef | ToggleDef | SelectDef;

const registry: SettingDef[] = [];

export function registerSettings(defs: SettingDef[]) {
  for (const d of defs) {
    const i = registry.findIndex((r) => r.ns === d.ns && r.key === d.key);
    if (i >= 0) registry[i] = d;
    else registry.push(d);
  }
}

/** An `order` value that sorts a new entry just before an existing one (e.g. a button at the top of a group). */
export function orderBefore(ns: string, key: string): number {
  const i = registry.findIndex((r) => r.ns === ns && r.key === key);
  return i < 0 ? registry.length : (registry[i].order ?? i) - 0.5;
}

export function settingsFor(tab: SettingsTab): SettingDef[] {
  return registry
    .map((d, i) => ({ d, i }))
    .filter(({ d }) => d.tab === tab && (d.visible?.() ?? true))
    .sort((a, b) => (a.d.order ?? a.i) - (b.d.order ?? b.i))
    .map(({ d }) => d);
}

/** Group entries preserving first-seen group order. */
export function groupDefs(defs: SettingDef[]): { group: string; defs: SettingDef[] }[] {
  const out: { group: string; defs: SettingDef[] }[] = [];
  for (const d of defs) {
    const g = d.group ?? '';
    let bucket = out.find((o) => o.group === g);
    if (!bucket) out.push((bucket = { group: g, defs: [] }));
    bucket.defs.push(d);
  }
  return out;
}

/** Namespace handle seeded with the defaults of every registered key in it. */
export function nsFor(ns: string) {
  const defaults: Record<string, unknown> = {};
  for (const d of registry) if (d.ns === ns && d.default !== undefined) defaults[d.key] = d.default;
  return settings.ns(ns, defaults);
}

export function readSetting(d: ValueDef): number | boolean | string {
  const v = nsFor(d.ns).get()[d.key];
  return (v ?? d.default) as number | boolean | string;
}

export function writeSetting(d: ValueDef, v: number | boolean | string) {
  nsFor(d.ns).set({ [d.key]: v });
}

export const pct = (v: number) => `${Math.round(v * 100)}%`;
const fixed =
  (n: number, unit = '') =>
  (v: number) =>
    `${v.toFixed(n)}${unit}`;
const opts = (...pairs: [string, string][]) => pairs.map(([value, label]) => ({ value, label }));
const HOLD = opts(['hold', 'Hold'], ['toggle', 'Toggle'], ['hybrid', 'Hybrid (tap / hold)']);
const hid = () => typeof navigator !== 'undefined' && 'hid' in navigator;
const M = mouseSettings.defaults;
const T = trackpadSettings.defaults;
const G = gamepadSettings.defaults;
const A = aimAssistSettings.defaults;
const Y = gyroSettings.defaults;

// --- Built-in entries (PRD §11). Owners of each system may re-register with refined ranges. ---------------------
registerSettings([
  // Controls · Mouse (src/input/config.ts owns these namespaces and their defaults)
  {
    tab: 'controls',
    group: 'Mouse',
    ns: 'input.mouse',
    key: 'cm360',
    label: 'Sensitivity',
    kind: 'slider',
    min: 10,
    max: 90,
    step: 0.5,
    default: M.cm360,
    format: fixed(1, ' cm/360°'),
    hint: 'Mouse travel for a full turn at the DPI below. Higher is slower.',
  },
  {
    tab: 'controls',
    group: 'Mouse',
    ns: 'input.mouse',
    key: 'dpi',
    label: 'Mouse DPI',
    kind: 'slider',
    min: 200,
    max: 3200,
    step: 50,
    default: M.dpi,
    format: fixed(0, ' dpi'),
  },
  {
    tab: 'controls',
    group: 'Mouse',
    ns: 'input.mouse',
    key: 'adsMultiplier',
    label: 'ADS multiplier',
    kind: 'slider',
    min: 0.2,
    max: 1.5,
    step: 0.05,
    default: M.adsMultiplier,
    format: fixed(2, '×'),
  },
  {
    tab: 'controls',
    group: 'Mouse',
    ns: 'input.mouse',
    key: 'invertY',
    label: 'Invert Y',
    kind: 'toggle',
    default: M.invertY,
  },
  {
    tab: 'controls',
    group: 'Mouse',
    ns: 'input.mouse',
    key: 'rawInput',
    label: 'Raw input',
    kind: 'toggle',
    default: M.rawInput,
    hint: 'Pointer Lock unadjustedMovement where supported (off while the trackpad preset is on).',
  },
  {
    tab: 'controls',
    group: 'Mouse',
    ns: 'input.mouse',
    key: 'aimMode',
    label: 'Aim',
    kind: 'select',
    options: HOLD,
    default: M.aimMode,
  },
  {
    tab: 'controls',
    group: 'Mouse',
    ns: 'input.mouse',
    key: 'sprintMode',
    label: 'Sprint',
    kind: 'select',
    options: HOLD,
    default: M.sprintMode,
  },
  {
    tab: 'controls',
    group: 'Mouse',
    ns: 'input.mouse',
    key: 'crouchMode',
    label: 'Crouch',
    kind: 'select',
    options: HOLD,
    default: M.crouchMode,
  },
  // Controls · Trackpad
  {
    tab: 'controls',
    group: 'Trackpad',
    ns: 'input.trackpad',
    key: 'mode',
    label: 'Trackpad preset',
    kind: 'select',
    options: opts(['auto', 'Auto-detect'], ['on', 'On'], ['off', 'Off']),
    default: T.mode,
    hint: 'Keeps OS acceleration; precision curve, two-finger scroll for ready positions, pinch for aim mode.',
  },
  {
    tab: 'controls',
    group: 'Trackpad',
    ns: 'input.trackpad',
    key: 'sensitivity',
    label: 'Sensitivity',
    kind: 'slider',
    min: 0.0008,
    max: 0.008,
    step: 0.0001,
    default: T.sensitivity,
    format: (v) => `${(v / T.sensitivity).toFixed(2)}×`,
  },
  {
    tab: 'controls',
    group: 'Trackpad',
    ns: 'input.trackpad',
    key: 'adsMultiplier',
    label: 'ADS multiplier',
    kind: 'slider',
    min: 0.2,
    max: 1.5,
    step: 0.05,
    default: T.adsMultiplier,
    format: fixed(2, '×'),
  },
  {
    tab: 'controls',
    group: 'Trackpad',
    ns: 'input.trackpad',
    key: 'adsMode',
    label: 'Aim',
    kind: 'select',
    options: HOLD,
    default: T.adsMode,
  },
  {
    tab: 'controls',
    group: 'Trackpad',
    ns: 'input.trackpad',
    key: 'precisionCurve',
    label: 'Precision curve',
    kind: 'toggle',
    default: T.precisionCurve,
  },
  {
    tab: 'controls',
    group: 'Trackpad',
    ns: 'input.trackpad',
    key: 'scrollReady',
    label: 'Two-finger scroll: ready',
    kind: 'toggle',
    default: T.scrollReady,
  },
  {
    tab: 'controls',
    group: 'Trackpad',
    ns: 'input.trackpad',
    key: 'pinch',
    label: 'Pinch: aim mode / zoom',
    kind: 'toggle',
    default: T.pinch,
  },
  {
    tab: 'controls',
    group: 'Trackpad',
    ns: 'input.trackpad',
    key: 'edgeGlide',
    label: 'Edge-glide turning',
    kind: 'toggle',
    default: T.edgeGlide,
  },
  {
    tab: 'controls',
    group: 'Trackpad',
    ns: 'input.trackpad',
    key: 'snapTurns',
    label: 'Snap turns',
    kind: 'toggle',
    default: T.snapTurns,
  },
  {
    tab: 'controls',
    group: 'Trackpad',
    ns: 'input.trackpad',
    key: 'aimAssist',
    label: 'Aim slowdown',
    kind: 'toggle',
    default: T.aimAssist,
  },
  {
    tab: 'controls',
    group: 'Trackpad',
    ns: 'input.trackpad',
    key: 'invertY',
    label: 'Invert Y',
    kind: 'toggle',
    default: T.invertY,
  },
  // Controls · Controller
  {
    tab: 'controls',
    group: 'Controller',
    ns: 'input.gamepad',
    key: 'yawSpeed',
    label: 'Look speed (yaw)',
    kind: 'slider',
    min: 90,
    max: 720,
    step: 10,
    default: G.yawSpeed,
    format: fixed(0, '°/s'),
  },
  {
    tab: 'controls',
    group: 'Controller',
    ns: 'input.gamepad',
    key: 'pitchSpeed',
    label: 'Look speed (pitch)',
    kind: 'slider',
    min: 60,
    max: 540,
    step: 10,
    default: G.pitchSpeed,
    format: fixed(0, '°/s'),
  },
  {
    tab: 'controls',
    group: 'Controller',
    ns: 'input.gamepad',
    key: 'innerDeadzone',
    label: 'Stick deadzone',
    kind: 'slider',
    min: 0,
    max: 0.3,
    step: 0.01,
    default: G.innerDeadzone,
    format: pct,
  },
  {
    tab: 'controls',
    group: 'Controller',
    ns: 'input.gamepad',
    key: 'curve',
    label: 'Response curve',
    kind: 'select',
    options: opts(['exponential', 'Exponential'], ['classic', 'Classic'], ['linear', 'Linear']),
    default: G.curve,
  },
  {
    tab: 'controls',
    group: 'Controller',
    ns: 'input.gamepad',
    key: 'adsMultiplier',
    label: 'ADS multiplier',
    kind: 'slider',
    min: 0.2,
    max: 1.2,
    step: 0.05,
    default: G.adsMultiplier,
    format: fixed(2, '×'),
  },
  {
    tab: 'controls',
    group: 'Controller',
    ns: 'input.aimAssist',
    key: 'level',
    label: 'Aim assist',
    kind: 'select',
    options: opts(['hardcore', 'Off'], ['standard', 'Light'], ['arcade', 'Strong'], ['custom', 'Custom']),
    default: A.level,
    hint: 'Friction only (no snapping), never on no-shoot targets.',
  },
  {
    tab: 'controls',
    group: 'Controller',
    ns: 'input.aimAssist',
    key: 'custom',
    label: 'Assist strength',
    kind: 'slider',
    min: 0,
    max: 1,
    step: 0.05,
    default: A.custom,
    format: pct,
    visible: () => aimAssistSettings.get().level === 'custom',
  },
  {
    tab: 'controls',
    group: 'Controller',
    ns: 'input.gamepad',
    key: 'aimMode',
    label: 'Aim',
    kind: 'select',
    options: HOLD,
    default: G.aimMode,
  },
  {
    tab: 'controls',
    group: 'Controller',
    ns: 'input.gamepad',
    key: 'crouchMode',
    label: 'Crouch',
    kind: 'select',
    options: HOLD,
    default: G.crouchMode,
  },
  {
    tab: 'controls',
    group: 'Controller',
    ns: 'input.gamepad',
    key: 'invertY',
    label: 'Invert Y',
    kind: 'toggle',
    default: G.invertY,
  },
  {
    tab: 'controls',
    group: 'Controller',
    ns: 'input.gamepad',
    key: 'haptics',
    label: 'Vibration',
    kind: 'toggle',
    default: G.haptics,
  },
  {
    tab: 'controls',
    group: 'Controller',
    ns: 'input.gamepad',
    key: 'hapticsStrength',
    label: 'Vibration strength',
    kind: 'slider',
    min: 0,
    max: 1,
    step: 0.05,
    default: G.hapticsStrength,
    format: pct,
  },
  // Controls · Gyro (WebHID, Chromium only; Menu.attachInput registers the Connect button)
  {
    tab: 'controls',
    group: 'Gyro',
    ns: 'input.gyro',
    key: 'enabled',
    label: 'Gyro aiming',
    kind: 'toggle',
    default: Y.enabled,
    visible: hid,
  },
  {
    tab: 'controls',
    group: 'Gyro',
    ns: 'input.gyro',
    key: 'mode',
    label: 'Gyro active',
    kind: 'select',
    options: opts(['ads', 'While aiming'], ['always', 'Always']),
    default: Y.mode,
    visible: hid,
  },
  {
    tab: 'controls',
    group: 'Gyro',
    ns: 'input.gyro',
    key: 'sensitivity',
    label: 'Gyro sensitivity',
    kind: 'slider',
    min: 0.5,
    max: 4,
    step: 0.1,
    default: Y.sensitivity,
    format: fixed(1, '×'),
    visible: hid,
  },
  {
    tab: 'controls',
    group: 'Gyro',
    ns: 'input.gyro',
    key: 'invertYaw',
    label: 'Invert yaw',
    kind: 'toggle',
    default: Y.invertYaw,
    visible: hid,
  },
  {
    tab: 'controls',
    group: 'Gyro',
    ns: 'input.gyro',
    key: 'invertPitch',
    label: 'Invert pitch',
    kind: 'toggle',
    default: Y.invertPitch,
    visible: hid,
  },
  // Gameplay
  {
    tab: 'gameplay',
    group: 'Realism',
    ns: 'gameplay',
    key: 'realism',
    label: 'Realism preset',
    kind: 'select',
    options: opts(['arcade', 'Arcade'], ['standard', 'Standard'], ['hardcore', 'Hardcore']),
    default: 'standard',
    hint: 'Arcade: ammo counter + dot. Standard: hold reload for ammo check. Hardcore: no HUD.',
  },
  {
    tab: 'gameplay',
    group: 'Realism',
    ns: 'gameplay',
    key: 'inertia',
    label: 'Weapon inertia',
    kind: 'slider',
    min: 0,
    max: 1.5,
    step: 0.05,
    default: 1,
    format: pct,
  },
  {
    tab: 'gameplay',
    group: 'Camera',
    ns: 'gameplay',
    key: 'mount',
    label: 'Camera mount',
    kind: 'select',
    options: opts(['chest', 'Chest'], ['helmet', 'Helmet']),
    default: 'chest',
  },
  {
    tab: 'gameplay',
    group: 'Camera',
    ns: 'gameplay',
    key: 'autoFixCam',
    label: 'Auto-fix camera',
    kind: 'toggle',
    default: true,
  },
  // Video
  {
    tab: 'video',
    group: 'Display',
    ns: 'video',
    key: 'quality',
    label: 'Quality preset',
    kind: 'select',
    options: opts(['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['ultra', 'Ultra']),
    default: 'medium',
  },
  {
    tab: 'video',
    group: 'Display',
    ns: 'video',
    key: 'resScale',
    label: 'Resolution scale',
    kind: 'slider',
    min: 0.5,
    max: 1,
    step: 0.05,
    default: 1,
    format: pct,
  },
  {
    tab: 'video',
    group: 'Display',
    ns: 'video',
    key: 'fov',
    label: 'Field of view',
    kind: 'slider',
    min: 60,
    max: 100,
    step: 1,
    default: 78,
    format: fixed(0, '°'),
  },
  {
    tab: 'video',
    group: 'Display',
    ns: 'video',
    key: 'frameCap',
    label: 'Frame cap',
    kind: 'select',
    options: opts(['0', 'Off'], ['60', '60'], ['120', '120'], ['144', '144']),
    default: '0',
  },
  {
    tab: 'video',
    group: 'Footage',
    ns: 'video',
    key: 'footage',
    label: 'Footage intensity',
    kind: 'slider',
    min: 0,
    max: 1,
    step: 0.05,
    default: 1,
    format: pct,
  },
  {
    tab: 'video',
    group: 'Footage',
    ns: 'video',
    key: 'shake',
    label: 'Camera shake',
    kind: 'slider',
    min: 0,
    max: 1,
    step: 0.05,
    default: 1,
    format: pct,
  },
  {
    tab: 'video',
    group: 'Footage',
    ns: 'video',
    key: 'overlay',
    label: 'CAM04 burn-in overlay',
    kind: 'toggle',
    default: true,
  },
  {
    tab: 'video',
    group: 'Footage',
    ns: 'video',
    key: 'gamma',
    label: 'Gamma',
    kind: 'slider',
    min: 0.8,
    max: 1.2,
    step: 0.01,
    default: 1,
    format: fixed(2),
  },
  // Audio
  {
    tab: 'audio',
    group: 'Mix',
    ns: 'audio',
    key: 'master',
    label: 'Master',
    kind: 'slider',
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.9,
    format: pct,
  },
  {
    tab: 'audio',
    group: 'Mix',
    ns: 'audio',
    key: 'sfx',
    label: 'Effects',
    kind: 'slider',
    min: 0,
    max: 1,
    step: 0.05,
    default: 1,
    format: pct,
  },
  {
    tab: 'audio',
    group: 'Mix',
    ns: 'audio',
    key: 'ambience',
    label: 'Ambience',
    kind: 'slider',
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.8,
    format: pct,
  },
  {
    tab: 'audio',
    group: 'Mix',
    ns: 'audio',
    key: 'mic',
    label: 'Mic artifacts',
    kind: 'slider',
    min: 0,
    max: 1,
    step: 0.05,
    default: 1,
    format: pct,
    hint: 'How much the CAM04 microphone colours the sound.',
  },
  {
    tab: 'audio',
    group: 'Output',
    ns: 'audio',
    key: 'listening',
    label: 'Listening mode',
    kind: 'select',
    options: opts(['headphones', 'Headphones'], ['speakers', 'Speakers'], ['tv', 'TV / night']),
    default: 'headphones',
  },
  {
    tab: 'audio',
    group: 'Output',
    ns: 'audio',
    key: 'hrtf',
    label: 'HRTF spatialisation',
    kind: 'toggle',
    default: true,
  },
  // Accessibility
  {
    tab: 'accessibility',
    group: 'Comfort',
    ns: 'a11y',
    key: 'stableHorizon',
    label: 'Stable horizon',
    kind: 'toggle',
    default: false,
  },
  {
    tab: 'accessibility',
    group: 'Comfort',
    ns: 'a11y',
    key: 'reducedFlashes',
    label: 'Reduced flashes',
    kind: 'toggle',
    default: false,
  },
  {
    tab: 'accessibility',
    group: 'Readability',
    ns: 'a11y',
    key: 'captions',
    label: 'Audio cue captions',
    kind: 'toggle',
    default: false,
  },
  {
    tab: 'accessibility',
    group: 'Readability',
    ns: 'a11y',
    key: 'targetPaint',
    label: 'Target paint',
    kind: 'select',
    options: opts(
      ['default', 'Default'],
      ['deuteranopia', 'Deuteranopia-safe'],
      ['protanopia', 'Protanopia-safe'],
      ['tritanopia', 'Tritanopia-safe'],
    ),
    default: 'default',
  },
  {
    tab: 'accessibility',
    group: 'Readability',
    ns: 'a11y',
    key: 'contrastReticle',
    label: 'High-contrast reticles',
    kind: 'toggle',
    default: false,
  },
  {
    tab: 'accessibility',
    group: 'Readability',
    ns: 'a11y',
    key: 'uiScale',
    label: 'Menu text size',
    kind: 'slider',
    min: 0.9,
    max: 1.3,
    step: 0.05,
    default: 1,
    format: pct,
  },
]);
