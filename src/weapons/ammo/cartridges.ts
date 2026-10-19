import type { AmmoId, Cartridge } from './types';

const MM = 0.001;
const IN = 0.0254;

/**
 * Cartridge table. Reference velocities are published/chronographed ballpark figures (fps → m/s):
 *
 * - M193 55 gr FMJ: ~3250 fps (990 m/s) from 20", ~2850 fps (870 m/s) from 10.3" (Mk18).
 * - M855 62 gr FMJ: ~3050 fps (930 m/s) from 20", ~2600 fps (795 m/s) from 10.3" (heavier, slower powder
 *   → loses more when cut short).
 * - .300 BLK 110 gr supersonic (V-MAX class): ~2350 fps (716 m/s) from 16", ~2150 fps (655 m/s) from 9".
 * - .300 BLK 220 gr subsonic OTM: ~1050 fps (320 m/s) from 16", ~1000 fps (305 m/s) from 9" — the cartridge
 *   is built for short barrels, so it loses very little.
 * - 7.62x39 123 gr FMJ: ~2350 fps (715 m/s) from 16.3" (AKM), ~2160 fps (660 m/s) from 10.5".
 * - 9 mm 124 gr FMJ: ~1150 fps (350 m/s) from a 4" pistol, ~1350 fps (411 m/s) from a 16" carbine
 *   (MP5 8.9" lands ~1270 fps / 388 m/s).
 * - 9 mm 147 gr FMJ (subsonic): ~950 fps (290 m/s) from 4", ~1040 fps (317 m/s) from 16".
 * - 12 ga 2¾" 00 buck (9 × .33" pellets): ~1300 fps (395 m/s) from 18.5", ~1325 fps from 28".
 * - 12 ga 1 oz Foster slug: ~1560 fps (475 m/s) from 18.5", ~1600 fps (490 m/s) from 28".
 * - .357 Mag 158 gr JSP: ~1235 fps (376 m/s) from a 4" revolver, ~1790 fps (545 m/s) from an 18" carbine.
 *
 * BCs are manufacturer/Litz-style published values (lb/in²). Powder charges are typical factory loads.
 */
export const CARTRIDGES: Record<AmmoId, Cartridge> = {
  m193: {
    id: 'm193',
    name: '5.56 M193 55 gr FMJ',
    caliber: '5.56',
    bulletGr: 55,
    diameter: 5.7 * MM,
    length: 0.75 * IN,
    bc: { G1: 0.243, G7: 0.122 },
    drag: 'G7',
    powderGr: 26,
    ref: [
      [20, 990],
      [10.3, 870],
    ],
    gasFactor: 1.5,
    construction: 'fmj',
    nose: 'spitzer',
    yawOnset: 0.12,
    fragmentAbove: 760,
    moa: 2,
  },
  m855: {
    id: 'm855',
    name: '5.56 M855 62 gr FMJ',
    caliber: '5.56',
    bulletGr: 62,
    diameter: 5.7 * MM,
    length: 0.906 * IN,
    bc: { G1: 0.304, G7: 0.151 },
    drag: 'G7',
    powderGr: 25.5,
    ref: [
      [20, 930],
      [10.3, 795],
    ],
    gasFactor: 1.5,
    construction: 'fmjSteelCore',
    nose: 'spitzer',
    yawOnset: 0.13,
    fragmentAbove: 820,
    moa: 3,
  },
  blk110: {
    id: 'blk110',
    name: '.300 BLK 110 gr supersonic',
    caliber: '300blk',
    bulletGr: 110,
    diameter: 7.82 * MM,
    length: 1.0 * IN,
    bc: { G1: 0.29, G7: 0.146 },
    drag: 'G7',
    powderGr: 19,
    ref: [
      [16, 716],
      [9, 655],
    ],
    gasFactor: 1.6,
    construction: 'polytip',
    nose: 'spitzer',
    yawOnset: 0.05,
    fragmentAbove: 550,
    moa: 1.5,
  },
  blk220: {
    id: 'blk220',
    name: '.300 BLK 220 gr subsonic',
    caliber: '300blk',
    bulletGr: 220,
    diameter: 7.82 * MM,
    length: 1.5 * IN,
    bc: { G1: 0.629, G7: 0.32 },
    drag: 'G7',
    powderGr: 9.5,
    ref: [
      [16, 320],
      [9, 305],
    ],
    gasFactor: 1.75,
    construction: 'otm',
    nose: 'spitzer',
    yawOnset: 0.25,
    moa: 2,
  },
  x39_123: {
    id: 'x39_123',
    name: '7.62x39 123 gr FMJ',
    caliber: '7.62x39',
    bulletGr: 123,
    diameter: 7.92 * MM,
    length: 1.03 * IN,
    bc: { G1: 0.275, G7: 0.14 },
    drag: 'G1',
    powderGr: 25,
    ref: [
      [16.3, 715],
      [10.5, 660],
    ],
    gasFactor: 1.6,
    construction: 'fmjSteelCore',
    nose: 'spitzer',
    yawOnset: 0.26,
    moa: 3.5,
  },
  p9_124: {
    id: 'p9_124',
    name: '9 mm 124 gr FMJ',
    caliber: '9mm',
    bulletGr: 124,
    diameter: 9.02 * MM,
    length: 0.61 * IN,
    bc: { G1: 0.15 },
    drag: 'G1',
    powderGr: 5.5,
    ref: [
      [4, 350],
      [16, 411],
    ],
    gasFactor: 1.5,
    construction: 'fmj',
    nose: 'roundNose',
    yawOnset: 0.45,
    moa: 3,
  },
  p9_147: {
    id: 'p9_147',
    name: '9 mm 147 gr FMJ (sub)',
    caliber: '9mm',
    bulletGr: 147,
    diameter: 9.02 * MM,
    length: 0.67 * IN,
    bc: { G1: 0.17 },
    drag: 'G1',
    powderGr: 3.8,
    ref: [
      [4, 290],
      [16, 317],
    ],
    gasFactor: 1.5,
    construction: 'fmj',
    nose: 'flat',
    yawOnset: 0.45,
    moa: 2.5,
  },
  buck00: {
    id: 'buck00',
    name: '12 ga 00 buck (9 pellets)',
    caliber: '12ga',
    bulletGr: 53.8,
    diameter: 8.38 * MM,
    length: 8.38 * MM,
    bc: { G1: 0.046 },
    drag: 'G1',
    powderGr: 26,
    wadGr: 30,
    pellets: 9,
    ref: [
      [18.5, 395],
      [28, 405],
    ],
    gasFactor: 1.5,
    construction: 'buck',
    nose: 'sphere',
    yawOnset: 10,
    moa: 0,
  },
  slug12: {
    id: 'slug12',
    name: '12 ga 1 oz Foster slug',
    caliber: '12ga',
    bulletGr: 437.5,
    diameter: 17.5 * MM,
    length: 17 * MM,
    bc: { G1: 0.08 },
    drag: 'G1',
    powderGr: 28,
    wadGr: 20,
    ref: [
      [18.5, 475],
      [28, 490],
    ],
    gasFactor: 1.5,
    construction: 'slug',
    nose: 'flat',
    yawOnset: 10,
    moa: 4,
  },
  m357_158: {
    id: 'm357_158',
    name: '.357 Mag 158 gr JSP',
    caliber: '.357',
    bulletGr: 158,
    diameter: 9.07 * MM,
    length: 0.66 * IN,
    bc: { G1: 0.206 },
    drag: 'G1',
    powderGr: 14,
    ref: [
      [4, 376],
      [18, 545],
    ],
    gasFactor: 1.6,
    construction: 'jsp',
    nose: 'flat',
    yawOnset: 0.3,
    moa: 2.5,
  },
};

/** Default load per caliber (what a weapon fires unless its build picks another). */
export const DEFAULT_AMMO: Record<string, AmmoId> = {
  '5.56': 'm855',
  '300blk': 'blk220',
  '7.62x39': 'x39_123',
  '9mm': 'p9_124',
  '12ga': 'buck00',
  '.357': 'm357_158',
};

/** Loads a caliber can chamber (loadout UI). */
export function ammoForCaliber(caliber: string): AmmoId[] {
  return (Object.keys(CARTRIDGES) as AmmoId[]).filter((id) => CARTRIDGES[id].caliber === caliber);
}

export function cartridge(id: AmmoId | string): Cartridge {
  const c = CARTRIDGES[id as AmmoId];
  if (!c) throw new Error(`unknown cartridge ${id}`);
  return c;
}

/** Resolve the load for a caliber, with an optional explicit pick (falls back if it doesn't chamber). */
export function resolveAmmo(caliber: string, pick?: string): Cartridge {
  const p = pick ? CARTRIDGES[pick as AmmoId] : undefined;
  if (p && p.caliber === caliber) return p;
  return CARTRIDGES[DEFAULT_AMMO[caliber] ?? 'p9_124'];
}
