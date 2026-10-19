/** Loadout-screen stat lines: what each build change does, as values + 0..1 bars + "better/worse" deltas. */
import { recoilFor } from '../anim/handling/recoil';
import {
  applyBuild,
  computeStats,
  resolveBuild,
  validateBuild,
  type WeaponBuild,
} from '../weapons/attachments';
import { BASE_WEAPONS } from '../weapons/defs';
import { CARRIERS, type Loadout } from './model';

export type StatId = 'mass' | 'length' | 'balance' | 'ads' | 'recoil' | 'velocity' | 'lag' | 'switch';

export interface StatDef {
  id: StatId;
  label: string;
  unit: string;
  /** Bar range (value → 0..1). */
  range: [number, number];
  /** +1: higher is better, -1: lower is better. */
  better: 1 | -1;
  fmt: (v: number) => string;
}

export const STATS: StatDef[] = [
  { id: 'mass', label: 'Mass', unit: 'kg', range: [0.6, 4.6], better: -1, fmt: (v) => v.toFixed(2) },
  { id: 'length', label: 'Length', unit: 'cm', range: [15, 95], better: -1, fmt: (v) => v.toFixed(1) },
  { id: 'balance', label: 'Balance fwd', unit: 'cm', range: [0, 25], better: -1, fmt: (v) => v.toFixed(1) },
  { id: 'ads', label: 'ADS time', unit: 'ms', range: [120, 420], better: -1, fmt: (v) => v.toFixed(0) },
  { id: 'recoil', label: 'Recoil energy', unit: 'J', range: [0, 16], better: -1, fmt: (v) => v.toFixed(1) },
  {
    id: 'velocity',
    label: 'Muzzle vel.',
    unit: 'm/s',
    range: [250, 950],
    better: 1,
    fmt: (v) => v.toFixed(0),
  },
  { id: 'lag', label: 'Handling lag', unit: 'ms', range: [24, 62], better: -1, fmt: (v) => v.toFixed(0) },
  { id: 'switch', label: 'Switch time', unit: 's', range: [0.25, 1], better: -1, fmt: (v) => v.toFixed(2) },
];

export type StatValues = Record<StatId, number>;

/** Stat values for a build, or null if it doesn't validate. */
export function buildStats(build: WeaponBuild): StatValues | null {
  if (validateBuild(build).length) return null;
  const s = computeStats(resolveBuild(build));
  const def = applyBuild(BASE_WEAPONS[build.weapon], build);
  // Free recoil energy of the weapon: E = p² / 2m (impulse from the recoil model, mass of the loaded gun).
  const p = recoilFor(def).impulseNs;
  return {
    mass: s.mass,
    length: s.length * 100,
    balance: s.handling.balance * 100,
    ads: s.handling.adsTime * 1000,
    recoil: (p * p) / (2 * s.mass),
    velocity: s.velocity,
    lag: s.handling.lagHalfLife * 1000,
    switch: s.handling.switchTime,
  };
}

export const bar = (d: StatDef, v: number) =>
  Math.max(0, Math.min(1, (v - d.range[0]) / (d.range[1] - d.range[0])));

/** Signed quality of a change: >0 better, <0 worse, 0 negligible (<0.5% of the bar range). */
export function deltaSign(d: StatDef, from: number, to: number): -1 | 0 | 1 {
  const diff = to - from;
  if (Math.abs(diff) < (d.range[1] - d.range[0]) * 0.005) return 0;
  return (Math.sign(diff) * d.better) as -1 | 1;
}

export function fmtDelta(d: StatDef, from: number, to: number) {
  const diff = to - from;
  const s = d.fmt(Math.abs(diff));
  if (Number(s) === 0) return '';
  return (diff > 0 ? '+' : '−') + s;
}

/** Whole-kit numbers for the gear tab. */
export function kitStats(l: Loadout) {
  const c = CARRIERS[l.gear.carrier];
  const p = l.primary ? buildStats(l.primary) : null;
  const s = l.sidearm ? buildStats(l.sidearm) : null;
  const pCap = l.primary ? computeStats(resolveBuild(l.primary)).capacity : 0;
  const sCap = l.sidearm ? computeStats(resolveBuild(l.sidearm)).capacity : 0;
  const magKg = (b: WeaponBuild | null) => {
    if (!b) return 0;
    const r = resolveBuild(b);
    const mag = r.parts.magazine;
    return (mag?.mass ?? 0) + (r.parts.magazine ? computeStats(r).capacity * r.platform.roundMass : 0);
  };
  const mass =
    (p?.mass ?? 0) +
    (s?.mass ?? 0) +
    c.mass +
    l.gear.rifleMags * magKg(l.primary) +
    l.gear.pistolMags * magKg(l.sidearm) +
    l.gear.flashbangs * 0.45 +
    (l.gear.nvg ? 0.7 : 0);
  return {
    mass,
    rifleRounds: l.primary ? pCap * (l.gear.rifleMags + 1) + 1 : 0,
    pistolRounds: l.sidearm ? sCap * (l.gear.pistolMags + 1) + 1 : 0,
  };
}
