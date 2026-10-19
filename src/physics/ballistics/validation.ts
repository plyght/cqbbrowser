import { CARTRIDGES, muzzleVelocity, projectileKg, type AmmoId } from '../../weapons/ammo';
import { WEAPONS } from '../../weapons/defs';
import { ammoOf } from '../../weapons/ammo/forDef';
import { hitImpulse, knocksDown, POPPER_HEAVY, POPPER_STANDARD, PLATE_ANY } from '../../world/steel/momentum';
import { recoilFor } from './recoil';
import { initProjectile, MATERIALS, newProjectile, perforate, type MaterialId } from './terminal';
import { computeBoreAngle, flyTo, pointOfImpact } from './trajectory';

/**
 * Sanity/validation tables: computed rows + published reference ranges. Shared by the unit tests (which fail
 * when a row leaves its range) and `tools/ballistics-table.ts` (markdown).
 */

const FPS = 3.28084;

// ---------------------------------------------------------------- muzzle velocity

export interface VelocityRow {
  ammo: AmmoId;
  inches: number;
  v: number;
  fps: number;
  energy: number;
  /** Reference [lo, hi] m/s and its source. */
  ref: [number, number];
  note: string;
  ok: boolean;
}

/** Published ballpark muzzle velocities (m/s ranges). */
const V_REFS: [AmmoId, number, [number, number], string][] = [
  ['m193', 20, [970, 1005], 'M193 ~3250 fps from 20"'],
  ['m193', 16, [930, 965], '~3100–3150 fps from 16"'],
  ['m193', 10.3, [850, 885], '~2800–2900 fps from 10.3" (Mk18)'],
  ['m855', 20, [910, 950], 'M855 ~3000–3100 fps from 20"'],
  ['m855', 14.5, [850, 900], 'M4 ~2800–2950 fps'],
  ['m855', 10.3, [770, 815], 'Mk18 ~2550–2650 fps'],
  ['blk110', 16, [700, 730], '110 gr ~2350 fps from 16"'],
  ['blk110', 9, [640, 670], '~2100–2200 fps from 9"'],
  ['blk220', 16, [310, 330], '220 gr sub ~1030–1080 fps'],
  ['blk220', 9, [298, 315], '~980–1030 fps from 9"'],
  ['blk220', 6, [285, 305], 'HB-300 6" (stays subsonic)'],
  ['x39_123', 16.3, [700, 730], 'AKM ~2350 fps'],
  ['x39_123', 8.5, [610, 650], 'short AK ~2000–2130 fps'],
  ['p9_124', 4, [340, 360], '124 gr ~1120–1180 fps from 4"'],
  ['p9_124', 8.9, [380, 405], 'MP5 ~1250–1320 fps'],
  ['p9_147', 4, [280, 300], '147 gr ~920–985 fps'],
  ['m357_158', 4, [365, 390], '158 gr ~1200–1280 fps from 4"'],
  ['buck00', 18.5, [385, 410], '00 buck ~1260–1345 fps'],
  ['slug12', 18.5, [460, 490], '1 oz slug ~1510–1600 fps'],
];

export function velocityTable(): VelocityRow[] {
  return V_REFS.map(([ammo, inches, ref, note]) => {
    const c = CARTRIDGES[ammo];
    const v = muzzleVelocity(c, inches);
    const e = 0.5 * projectileKg(c) * (c.pellets ?? 1) * v * v;
    return { ammo, inches, v, fps: v * FPS, energy: e, ref, note, ok: v >= ref[0] && v <= ref[1] };
  });
}

/** Velocity lost per inch of barrel between 16" and `short` (fps/in). */
export function fpsPerInch(ammo: AmmoId, short = 10.3, long = 16) {
  const c = CARTRIDGES[ammo];
  return ((muzzleVelocity(c, long) - muzzleVelocity(c, short)) * FPS) / (long - short);
}

// ---------------------------------------------------------------- drop / TOF

export interface DropRow {
  ammo: AmmoId;
  inches: number;
  v0: number;
  at: { range: number; dropCm: number; tofMs: number; v: number }[];
  ok: boolean;
}

/** Drop from a horizontal bore. Checks: physical consistency (0.8·½gt² ≤ drop ≤ ½gt² — drag also slows the fall — and tof > range/v0). */
export function dropTable(): DropRow[] {
  const cases: [AmmoId, number][] = [
    ['m193', 16],
    ['m855', 10.3],
    ['blk110', 9],
    ['blk220', 6],
    ['x39_123', 8.5],
    ['p9_124', 4.5],
    ['p9_124', 8.9],
    ['m357_158', 4],
    ['slug12', 18.5],
  ];
  return cases.map(([ammo, inches]) => {
    const c = CARTRIDGES[ammo];
    const v0 = muzzleVelocity(c, inches);
    let ok = true;
    const at = [25, 50, 100].map((range) => {
      const p = flyTo(c, v0, 0, range);
      const vac = 0.5 * 9.80665 * p.tof * p.tof;
      if (-p.y > vac * 1.001 || -p.y < vac * 0.8 || p.tof < range / v0) ok = false;
      return { range, dropCm: -p.y * 100, tofMs: p.tof * 1000, v: p.v };
    });
    return { ammo, inches, v0, at, ok };
  });
}

// ---------------------------------------------------------------- zero / mechanical offset

export interface ZeroRow {
  weapon: string;
  zero: number;
  sightHeightCm: number;
  boreMrad: number;
  /** Point of impact vs line of sight (cm, + = high). */
  poi: { range: number; cm: number }[];
  ok: boolean;
}

export function zeroTable(): ZeroRow[] {
  return Object.values(WEAPONS).map((d) => {
    const c = ammoOf(d);
    const zero = d.slot === 'sidearm' ? 25 : 50;
    const ba = computeBoreAngle(zero, d.sightHeight, c, d.velocity);
    const poi = [3, 7, 15, 25, 50, 100].map((range) => ({
      range,
      cm: pointOfImpact(range, d.sightHeight, ba, c, d.velocity).y * 100,
    }));
    // Close in, rounds hit low by roughly the sight height; on the line at the zero.
    const p3 = poi[0].cm,
      pz = poi.find((p) => p.range === zero)!.cm;
    const ok = p3 < -0.6 * d.sightHeight * 100 && p3 > -d.sightHeight * 100 - 0.5 && Math.abs(pz) < 0.05;
    return { weapon: d.id, zero, sightHeightCm: d.sightHeight * 100, boreMrad: ba * 1000, poi, ok };
  });
}

// ---------------------------------------------------------------- free recoil

export interface RecoilRow {
  weapon: string;
  ammo: string;
  massKg: number;
  impulse: number;
  velocity: number;
  energy: number;
  ftlb: number;
  action: string;
  cycleMs: number;
  ref: [number, number];
  note: string;
  ok: boolean;
}

/**
 * Free-recoil energy references (J). Published free-recoil tables (Hatcher/Chuck Hawks style):
 * AR-15 .223 at 7.5 lb ≈ 3.5–3.7 ft·lbf (≈ 4.9 J) from 20"; the 10.3" SB-16 is slower (less bullet momentum)
 * → ~3.5–4.5 J. Glock 17 9 mm ≈ 4–4.5 ft·lbf (5–6 J). AK 7.62x39 ≈ 4.5–5.5 J at 3.6 kg (short barrel less).
 * MP5 ≈ 1.5–2.2 J (heavy gun, 9 mm). HB-300 220 gr sub ≈ 2.2–3.5 J.
 */
const R_REFS: Record<string, [[number, number], string]> = {
  sb16: [[3.3, 4.8], 'AR-15 SBR 5.56'],
  hb300: [[2.0, 3.5], '.300 BLK sub PDW'],
  k47s: [[4.5, 7.5], 'short AK 7.62x39'],
  kp9: [[1.3, 2.3], 'MP5-pattern 9 mm'],
  p17: [[4.8, 6.5], 'Glock-pattern 9 mm'],
};

export function recoilTable(): RecoilRow[] {
  return Object.values(WEAPONS).map((d) => {
    const r = recoilFor(d);
    const [ref, note] = R_REFS[d.id] ?? [[0, Infinity], ''];
    return {
      weapon: d.id,
      ammo: r.ammo,
      massKg: r.gunMassKg,
      impulse: r.impulseNs,
      velocity: r.velocity,
      energy: r.energyJ,
      ftlb: r.energyJ / 1.35582,
      action: r.action,
      cycleMs: r.cycleTime * 1000,
      ref,
      note,
      ok: r.energyJ >= ref[0] && r.energyJ <= ref[1],
    };
  });
}

// ---------------------------------------------------------------- penetration

export interface PenCase {
  id: string;
  label: string;
  layers: [MaterialId, number][];
}

export const PEN_CASES: PenCase[] = [
  {
    id: 'drywall2',
    label: 'interior wall (2× ½" drywall)',
    layers: [
      ['drywall', 0.0127],
      ['drywall', 0.0127],
    ],
  },
  {
    id: 'drywall8',
    label: '4 interior walls (8× drywall)',
    layers: Array.from({ length: 8 }, () => ['drywall', 0.0127] as [MaterialId, number]),
  },
  { id: 'ply24', label: 'kill-house wall (2× 12 mm ply)', layers: [['plywood', 0.024]] },
  { id: 'door', label: 'hollow-core door', layers: [['door', 0.035]] },
  { id: 'stud', label: '2x4 stud (across, 38 mm)', layers: [['pine', 0.038]] },
  { id: 'stud89', label: '2x4 stud (lengthwise, 89 mm)', layers: [['pine', 0.089]] },
  {
    id: 'car',
    label: 'car door (2× 0.8 mm sheet)',
    layers: [
      ['carBody', 0.0008],
      ['carBody', 0.0008],
    ],
  },
  { id: 'brick', label: 'brick (90 mm)', layers: [['brick', 0.09]] },
  { id: 'concrete', label: 'concrete (100 mm)', layers: [['concrete', 0.1]] },
  { id: 'ar500', label: 'AR500 plate (9.5 mm)', layers: [['ar500', 0.0095]] },
];

export const PEN_LOADS: [AmmoId, number][] = [
  ['m193', 10.3],
  ['m855', 10.3],
  ['blk110', 9],
  ['blk220', 6],
  ['x39_123', 8.5],
  ['p9_124', 4.5],
  ['p9_147', 4.5],
  ['m357_158', 4],
  ['buck00', 18.5],
  ['slug12', 18.5],
];

export interface PenCell {
  ammo: AmmoId;
  pen: string;
  /** Exit speed m/s, 0 = stopped. */
  out: number;
  /** Fraction of the impact speed kept. */
  keep: number;
  tumbling: boolean;
  fragmented: boolean;
}

export function penetrationTable(): PenCell[][] {
  const p = newProjectile();
  return PEN_CASES.map((pc) =>
    PEN_LOADS.map(([ammo, inches]) => {
      const c = CARTRIDGES[ammo];
      const v0 = muzzleVelocity(c, inches);
      initProjectile(p, c, v0);
      let out = v0;
      for (const [m, t] of pc.layers) {
        const r = perforate(p, MATERIALS[m], t);
        out = r.stopped ? 0 : r.speedOut;
        if (r.stopped) break;
      }
      return { ammo, pen: pc.id, out, keep: out / v0, tumbling: p.yaw > 0.5, fragmented: p.fragmented };
    }),
  );
}

// ---------------------------------------------------------------- steel knockdown

export interface SteelRow {
  weapon: string;
  ammo: string;
  impulse: number;
  standard: boolean;
  heavyAtLine: boolean;
  heavyHigh: boolean;
  plate: boolean;
}

export function steelTable(range = 9): SteelRow[] {
  return Object.values(WEAPONS).map((d) => {
    const c = ammoOf(d);
    const v = flyTo(c, d.velocity, 0, range).v;
    // Same path as the in-game steel (energy + mass → m·v·(1+e)).
    const m = projectileKg(c);
    const J = hitImpulse(0.5 * m * v * v, m);
    return {
      weapon: d.id,
      ammo: c.id,
      impulse: J,
      standard: knocksDown(J, POPPER_STANDARD.calHeight, POPPER_STANDARD),
      heavyAtLine: knocksDown(J, POPPER_HEAVY.calHeight, POPPER_HEAVY),
      heavyHigh: knocksDown(J, 1.0, POPPER_HEAVY),
      plate: knocksDown(J, 0.05, PLATE_ANY),
    };
  });
}
