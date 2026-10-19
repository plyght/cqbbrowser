/**
 * Settings schema registry. The Settings screen renders generic controls (slider / toggle / select) from these
 * entries and reads/writes them through `src/settings/Settings.ts` namespaces.
 *
 * Other systems append their own entries at module load:
 *   registerSettings([{ tab: 'audio', group: 'Mix', ns: 'audio', key: 'brass', label: 'Brass', kind: 'slider',
 *                       min: 0, max: 1, step: 0.05, default: 0.8, format: pct }]);
 * Registering the same ns+key again replaces the earlier entry (so an owner can refine labels/ranges).
 */
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
  /** Settings namespace + key the value lives under. */
  ns: string;
  key: string;
  label: string;
  hint?: string;
  /** Sort order inside the group (default: registration order). */
  order?: number;
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
export type SettingDef = SliderDef | ToggleDef | SelectDef;

const registry: SettingDef[] = [];

export function registerSettings(defs: SettingDef[]) {
  for (const d of defs) {
    const i = registry.findIndex((r) => r.ns === d.ns && r.key === d.key);
    if (i >= 0) registry[i] = d;
    else registry.push(d);
  }
}

export function settingsFor(tab: SettingsTab): SettingDef[] {
  return registry
    .map((d, i) => ({ d, i }))
    .filter(({ d }) => d.tab === tab)
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
  for (const d of registry) if (d.ns === ns) defaults[d.key] = d.default;
  return settings.ns(ns, defaults);
}

export function readSetting(d: SettingDef): number | boolean | string {
  const v = nsFor(d.ns).get()[d.key];
  return (v ?? d.default) as number | boolean | string;
}

export function writeSetting(d: SettingDef, v: number | boolean | string) {
  nsFor(d.ns).set({ [d.key]: v });
}

export const pct = (v: number) => `${Math.round(v * 100)}%`;
const fixed =
  (n: number, unit = '') =>
  (v: number) =>
    `${v.toFixed(n)}${unit}`;
const opts = (...pairs: [string, string][]) => pairs.map(([value, label]) => ({ value, label }));

// --- Built-in entries (PRD §11). Owners of each system may re-register with refined ranges. ---------------------
registerSettings([
  // Controls · Mouse
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
    default: 34,
    format: fixed(1, ' cm/360°'),
    hint: 'Distance the mouse travels for a full turn (800 dpi). Higher is slower.',
  },
  {
    tab: 'controls',
    group: 'Mouse',
    ns: 'input.mouse',
    key: 'adsScale',
    label: 'ADS multiplier',
    kind: 'slider',
    min: 0.3,
    max: 1.5,
    step: 0.05,
    default: 1,
    format: fixed(2, '×'),
  },
  {
    tab: 'controls',
    group: 'Mouse',
    ns: 'input.mouse',
    key: 'invertY',
    label: 'Invert Y',
    kind: 'toggle',
    default: false,
  },
  {
    tab: 'controls',
    group: 'Mouse',
    ns: 'input.mouse',
    key: 'raw',
    label: 'Raw input',
    kind: 'toggle',
    default: true,
    hint: 'Pointer Lock unadjustedMovement where supported.',
  },
  // Controls · Trackpad
  {
    tab: 'controls',
    group: 'Trackpad',
    ns: 'input.trackpad',
    key: 'sens',
    label: 'Sensitivity',
    kind: 'slider',
    min: 0.2,
    max: 3,
    step: 0.05,
    default: 1,
    format: fixed(2, '×'),
  },
  {
    tab: 'controls',
    group: 'Trackpad',
    ns: 'input.trackpad',
    key: 'edgeGlide',
    label: 'Edge-glide turning',
    kind: 'toggle',
    default: true,
  },
  {
    tab: 'controls',
    group: 'Trackpad',
    ns: 'input.trackpad',
    key: 'swipeLean',
    label: 'Two-finger swipe lean',
    kind: 'toggle',
    default: false,
  },
  // Controls · Controller
  {
    tab: 'controls',
    group: 'Controller',
    ns: 'input.gamepad',
    key: 'lookSpeed',
    label: 'Look speed',
    kind: 'slider',
    min: 90,
    max: 540,
    step: 10,
    default: 260,
    format: fixed(0, '°/s'),
  },
  {
    tab: 'controls',
    group: 'Controller',
    ns: 'input.gamepad',
    key: 'deadzone',
    label: 'Stick deadzone',
    kind: 'slider',
    min: 0,
    max: 0.3,
    step: 0.01,
    default: 0.08,
    format: pct,
  },
  {
    tab: 'controls',
    group: 'Controller',
    ns: 'input.gamepad',
    key: 'curve',
    label: 'Response curve',
    kind: 'select',
    options: opts(['linear', 'Linear'], ['classic', 'Classic'], ['precise', 'Precise']),
    default: 'classic',
  },
  {
    tab: 'controls',
    group: 'Controller',
    ns: 'input.gamepad',
    key: 'aimAssist',
    label: 'Aim assist',
    kind: 'select',
    options: opts(['off', 'Off'], ['light', 'Light'], ['strong', 'Strong']),
    default: 'light',
  },
  {
    tab: 'controls',
    group: 'Controller',
    ns: 'input.gamepad',
    key: 'invertY',
    label: 'Invert Y',
    kind: 'toggle',
    default: false,
  },
  {
    tab: 'controls',
    group: 'Controller',
    ns: 'input.gamepad',
    key: 'haptics',
    label: 'Vibration',
    kind: 'toggle',
    default: true,
  },
  // Controls · Keyboard
  {
    tab: 'controls',
    group: 'Keyboard',
    ns: 'input.keyboard',
    key: 'aimToggle',
    label: 'Aim',
    kind: 'select',
    options: opts(['hold', 'Hold'], ['toggle', 'Toggle']),
    default: 'hold',
  },
  {
    tab: 'controls',
    group: 'Keyboard',
    ns: 'input.keyboard',
    key: 'sprintToggle',
    label: 'Sprint',
    kind: 'select',
    options: opts(['hold', 'Hold'], ['toggle', 'Toggle']),
    default: 'hold',
  },
  {
    tab: 'controls',
    group: 'Keyboard',
    ns: 'input.keyboard',
    key: 'crouchToggle',
    label: 'Crouch',
    kind: 'select',
    options: opts(['hold', 'Hold'], ['toggle', 'Toggle']),
    default: 'toggle',
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
