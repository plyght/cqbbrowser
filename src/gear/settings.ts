import { settings } from '../settings/Settings';
import { registerSettings } from '../ui/settingsSchema';

export type NvgTubes = 'mono' | 'dual';
export type Phosphor = 'green' | 'white';
export type IrMode = 'laser' | 'laserFlood';

/** Gear loadout + NVG options (Settings → Gameplay → Gear). */
export const gearSettings = settings.ns('gear', {
  /** PVS-14-style monocular over the right eye, or a dual-tube binocular. */
  nvgTubes: 'mono' as NvgTubes,
  phosphor: 'green' as Phosphor,
  /** Manual gain knob, EV (the tube's ABC still works under it). */
  nvgGain: 0,
  /** Flashbangs carried per run (resupplied at drill standby / restart). */
  flashbangs: 2,
  /** What the IR switch turns on: aiming laser, or laser + IR flood (illuminator). */
  irMode: 'laserFlood' as IrMode,
});

const opts = (...pairs: [string, string][]) => pairs.map(([value, label]) => ({ value, label }));

registerSettings([
  {
    tab: 'gameplay',
    group: 'Gear',
    ns: 'gear',
    key: 'flashbangs',
    label: 'Flashbangs carried',
    kind: 'slider',
    min: 0,
    max: 4,
    step: 1,
    default: 2,
    format: (v) => `${v}`,
    hint: 'Throw: 4 / mouse 4 (controller: RS click). Hold to wind up an overhand throw, tap to roll it.',
  },
  {
    tab: 'gameplay',
    group: 'Gear',
    ns: 'gear',
    key: 'nvgTubes',
    label: 'Night vision',
    kind: 'select',
    options: opts(['mono', 'Monocular (PVS-14 style)'], ['dual', 'Dual tube']),
    default: 'mono',
    hint: 'Flip down/up: G (controller: hold D-pad left).',
  },
  {
    tab: 'gameplay',
    group: 'Gear',
    ns: 'gear',
    key: 'phosphor',
    label: 'Phosphor',
    kind: 'select',
    options: opts(['green', 'Green (P43)'], ['white', 'White (P45)']),
    default: 'green',
  },
  {
    tab: 'gameplay',
    group: 'Gear',
    ns: 'gear',
    key: 'nvgGain',
    label: 'NVG gain',
    kind: 'slider',
    min: -2,
    max: 2,
    step: 0.25,
    default: 0,
    format: (v) => `${v > 0 ? '+' : ''}${v.toFixed(2)} EV`,
  },
  {
    tab: 'gameplay',
    group: 'Gear',
    ns: 'gear',
    key: 'irMode',
    label: 'IR device',
    kind: 'select',
    options: opts(['laser', 'Aiming laser'], ['laserFlood', 'Laser + illuminator']),
    default: 'laserFlood',
    hint: 'Y (controller: hold D-pad right). Only visible through the NVG.',
  },
  {
    tab: 'gameplay',
    group: 'Facilities',
    ns: 'world.killhouse',
    key: 'roof',
    label: 'Kill house roof',
    kind: 'toggle',
    default: true,
    hint: 'Off: open-top house with the instructor catwalk (overview / replay runs). URL: ?roof=0',
  },
]);
