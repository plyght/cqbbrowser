import type { ClipEvent, V3 } from '../rig/clipData';
import type { HandKey } from '../rig/pose';
import type { Recipe } from './compose';

/**
 * Per-weapon first-person clip library. Every weapon plays on the same canonical arms; its clips are composed
 * from the two retargeted source packs (`ak.*` = AK74U pack, `beretta.*` = Beretta pack, split from its single
 * timeline) plus authored layers, so each family moves differently:
 *
 *  - k47s  — the AK clips as authored (rock-in mag, firing hand racks `recam`).
 *  - sb16 / hb300 — AK hands, but straight mag insert, AR grip/handguard via anchor offsets, and an empty
 *    reload that ends with a support-palm **bolt-release slap** instead of the AK rack. HB-300 is faster.
 *  - kp9   — MP5-style: support hand locks the charging handle back first, straight mag, then the **HK slap**.
 *  - p17   — Beretta pack clips; Glock-style slide/mag/trigger tracks.
 *
 * Times in authored keys/events are seconds in composed time before `speed` is applied.
 */

export type ArmsAction =
  | 'idle'
  | 'draw'
  | 'holster'
  | 'swapIn'
  | 'swapOut'
  | 'shoot'
  | 'shootLast'
  | 'reloadTactical'
  | 'reloadEmpty'
  | 'magCheck'
  | 'inspect';

export const ACTIONS: ArmsAction[] = [
  'idle',
  'swapIn',
  'swapOut',
  'shoot',
  'shootLast',
  'reloadTactical',
  'reloadEmpty',
  'magCheck',
  'inspect',
];

/** How a 0..1 bolt channel moves a model part (metres along +z, rest = 0). */
export interface PartDrive {
  part: 'bolt' | 'chargingHandle' | 'slide';
  travel: number;
}

export interface WeaponAnims {
  id: string;
  family: 'rifle' | 'smg' | 'pistol';
  pack: 'ak' | 'beretta';
  /** Bolt/slide channel → model parts. */
  drive: PartDrive[];
  /** Bolt / slide stays back after the last round. */
  locksBack: boolean;
  /** Trigger pull (rad about +x) and safety throw (rad about +x) at channel = 1. */
  triggerRad: number;
  safetyRad: number;
  /** Model-frame offset of the weapon in the firing hand (fine fit of the grip, m). */
  grip: V3;
  clips: Record<ArmsAction, Recipe>;
}

const ev = (name: string, t: number): ClipEvent => ({ name, t });

// ------------------------------------------------------------------------------------ mag check

/** Per-family feel of the mag check: where the mag is presented (chest-cam frame) and how the gun moves. */
interface CheckFeel {
  /** Mag centre (m, camera frame: -z forward) and its XYZ euler there (rad). */
  pose: { p: V3; r: V3 };
  /** Swing around the gun on the way up (camera frame, m). */
  arc: V3;
  /** Gun tilt (model-frame euler) while the support hand works the mag. */
  tilt: V3;
  /** AK rock about the front lug (rad). */
  rock?: number;
  /** Hand moved around the mag (see PresentRecipe.gripTurn / gripShift); default: palm on the front, a bit low. */
  gripTurn?: number;
  gripShift?: V3;
}

/**
 * Rifle / SMG mag check on the AK-pack arms: support hand to the mag (clip), release, the mag comes **fully out**
 * (path 0 → 1: clear of the well plus a gap), up and tilted toward the face (1 → 2), hold, back down, in, seat with a
 * push, a tug check, hand back to the handguard. Composed time (s) before `speed`:
 *
 *   0.42 release · 0.45–0.78 out (magCheckOut at clear) · 0.78–1.18 up · hold 1.22–1.62 · 1.66–2.02 down ·
 *   2.02–2.2 in (magCheckIn at the well, magSeat at 2.2) · tug 2.24–2.36 · hand back 2.36–2.6
 */
function rifleCheck(speed: number, magStyle: 'rock' | 'straight', f: CheckFeel): Recipe {
  return {
    segs: [
      { clip: 'ak.reloadTactical', t0: 0, t1: 0.62 },
      { hold: 1.86 },
      { clip: 'ak.reloadTactical', t0: 0.62, t1: 0.3 },
      { blend: 0.3 },
      { clip: 'ak.idle', t0: 0, t1: 0 },
    ],
    speed,
    keepEvents: false,
    events: [ev('magRelease', 0.42), ev('magCheckOut', 0.7), ev('magCheckIn', 2.1), ev('magSeat', 2.2)],
    tilt: [
      { t: 0.25, r: [0, 0, 0] },
      { t: 0.75, r: f.tilt },
      { t: 1.9, r: f.tilt },
      { t: 2.2, r: [f.tilt[0] * 0.6, f.tilt[1] * 0.6, f.tilt[2] * 0.6] },
      // Seat: the push rocks the gun up a touch.
      { t: 2.26, r: [f.tilt[0] * 0.6 + 0.04, f.tilt[1] * 0.6, f.tilt[2] * 0.6] },
      { t: 2.75, r: [0, 0, 0] },
    ],
    hold: [1.22, 1.62],
    magStyle,
    present: {
      path: [
        { t: 0.42, v: 0 },
        { t: 0.5, v: 0.06 },
        { t: 0.78, v: 1 },
        { t: 1.18, v: 2 },
        { t: 1.66, v: 2 },
        { t: 2.02, v: 1 },
        { t: 2.2, v: 0 },
        { t: 2.26, v: 0 },
        { t: 2.31, v: 0.015 },
        { t: 2.37, v: 0 },
      ],
      hand: [
        { t: 0.26, v: 0 },
        { t: 0.42, v: 1 },
        { t: 2.38, v: 1 },
        { t: 2.6, v: 0 },
      ],
      pose: f.pose,
      arc: f.arc,
      grip: { clip: 'ak.reloadTactical', t: 0.63 },
      gripTurn: f.gripTurn ?? -Math.PI / 2,
      gripShift: f.gripShift ?? [0, -0.05, 0],
      rock: f.rock,
      rockSpan: 0.3,
    },
  };
}

/**
 * Pistol mag check on the Beretta-pack arms: cant, thumb the release, the mag drops a few cm, the support hand
 * catches it and strips it **fully out**, presents it close and low (back toward the camera: witness holes), hold,
 * back in, palm push to seat, tug, support hand back on the grip.
 */
function pistolCheck(): Recipe {
  const tilt: V3 = [0, -0.2, 0.3];
  return {
    segs: [
      { clip: 'beretta.reloadTactical', t0: 0, t1: 0.3 },
      { blend: 0.3 },
      { clip: 'beretta.reloadTactical', t0: 1.2, t1: 1.2 },
      { hold: 1.9 },
      { blend: 0.32 },
      { clip: 'beretta.idle', t0: 0, t1: 0 },
    ],
    keepEvents: false,
    events: [ev('magRelease', 0.3), ev('magCheckOut', 0.74), ev('magCheckIn', 2.06), ev('magSeat', 2.16)],
    tilt: [
      { t: 0, r: [0, 0, 0] },
      { t: 0.4, r: tilt },
      { t: 2.16, r: tilt },
      { t: 2.21, r: [tilt[0] + 0.05, tilt[1], tilt[2]] },
      { t: 2.75, r: [0, 0, 0] },
    ],
    hold: [1.24, 1.64],
    magStyle: 'straight',
    present: {
      path: [
        { t: 0.3, v: 0 },
        { t: 0.4, v: 0.18 },
        { t: 0.6, v: 0.22 },
        { t: 0.84, v: 1 },
        { t: 1.18, v: 2 },
        { t: 1.7, v: 2 },
        { t: 2.0, v: 1 },
        { t: 2.16, v: 0 },
        { t: 2.21, v: 0 },
        { t: 2.26, v: 0.012 },
        { t: 2.31, v: 0 },
      ],
      hand: [
        { t: 0.4, v: 0 },
        { t: 0.6, v: 1 },
        { t: 2.32, v: 1 },
        { t: 2.52, v: 0 },
      ],
      pose: { p: [-0.1, -0.07, -0.21], r: [-0.15, 0.35, 0.2] },
      arc: [-0.04, -0.04, -0.04],
      grip: { clip: 'beretta.reloadTactical', t: 1.2 },
    },
  };
}

// ------------------------------------------------------------------------------------ shared rifle pieces

/** AK-pack rifle clips with per-weapon modifiers. */
function rifle(o: {
  speed: number;
  swapSpeed: number;
  swing: number;
  emptyReload: Recipe;
  magStyle: 'rock' | 'straight';
  locksBack: boolean;
  check: CheckFeel;
}): Record<ArmsAction, Recipe> {
  const swapOut: Recipe = {
    segs: [{ clip: 'ak.holster', t0: 0, t1: 0.4 }],
    speed: o.swapSpeed,
    events: [ev('slingDrop', 0.12), ev('swapMid', 0.4)],
    tilt: o.swing
      ? [
          { t: 0, r: [0, 0, 0] },
          { t: 0.4, r: [0.1, 0, o.swing] },
        ]
      : undefined,
    holdLast: true,
  };
  const swapIn: Recipe = {
    segs: [{ clip: 'ak.draw' }],
    speed: o.swapSpeed,
    tilt: o.swing
      ? [
          { t: 0, r: [0.1, 0, o.swing] },
          { t: 0.45, r: [0, 0, 0] },
        ]
      : undefined,
  };
  const shootBolt = [
    { t: 0, v: 0 },
    { t: 0.025, v: 1 },
    { t: 0.07, v: 0 },
  ];
  return {
    idle: { segs: [{ clip: 'ak.idle' }], loop: true },
    draw: swapIn,
    swapIn,
    holster: swapOut,
    swapOut,
    shoot: { segs: [{ clip: 'ak.shoot' }], additive: true, bolt: shootBolt },
    shootLast: {
      segs: [{ clip: 'ak.shoot' }],
      additive: true,
      bolt: o.locksBack
        ? [
            { t: 0, v: 0 },
            { t: 0.025, v: 1 },
            { t: 0.5, v: 1 },
          ]
        : shootBolt,
    },
    reloadTactical: { segs: [{ clip: 'ak.reloadTactical' }], speed: o.speed, magStyle: o.magStyle },
    reloadEmpty: o.emptyReload,
    magCheck: rifleCheck(o.speed, o.magStyle, o.check),
    inspect: { segs: [{ clip: 'ak.inspect' }], speed: o.speed },
  };
}

/** AK empty reload: the old mag drops, fresh one rocked in, firing hand racks the carrier. */
const akEmpty = (speed: number): Recipe => ({
  segs: [{ clip: 'ak.reloadEmpty' }],
  speed,
  magDrop: { t: 0 },
  events: [ev('magRelease', 0), ev('magOut', 0.1)],
  magStyle: 'rock',
});

/** AR empty reload: straight insert, then the support palm slaps the bolt catch (no rack). */
const arEmpty = (speed: number): Recipe => {
  const slap: HandKey[] = [
    { t: 1.68, at: 'boltCatch', off: [-0.08, -0.1, 0.1], w: 0 },
    { t: 1.86, at: 'boltCatch', off: [-0.085, -0.095, 0.085], w: 1 },
    { t: 1.94, at: 'boltCatch', off: [-0.06, -0.09, 0.08], w: 1 },
    { t: 2.04, at: 'boltCatch', off: [-0.09, -0.1, 0.09], w: 1 },
    { t: 2.25, at: 'boltCatch', off: [-0.09, -0.11, 0.1], w: 0 },
  ];
  return {
    segs: [
      { clip: 'ak.reloadEmpty', t0: 0, t1: 1.68 },
      { hold: 0.6 },
      { blend: 0.32 },
      { clip: 'ak.idle', t0: 0, t1: 0 },
    ],
    speed,
    magDrop: { t: 0 },
    events: [ev('magRelease', 0), ev('magOut', 0.1), ev('boltRelease', 1.94)],
    bolt: [
      { t: 0, v: 1 },
      { t: 1.93, v: 1 },
      { t: 1.97, v: 0 },
    ],
    gunW: [
      { t: 1.6, v: 1 },
      { t: 2.6, v: 1 },
    ],
    handL: slap,
    magStyle: 'straight',
  };
};

/** MP5-style: lock the charging handle back, swap the mag (straight), HK slap the handle down. */
const hkEmpty = (speed: number): Recipe => ({
  segs: [
    { clip: 'ak.idle', t0: 0, t1: 0 },
    { hold: 0.5 },
    { blend: 0.18 },
    { clip: 'ak.reloadEmpty', t0: 0.3, t1: 1.68 },
    { hold: 0.55 },
    { blend: 0.3 },
    { clip: 'ak.idle', t0: 0, t1: 0 },
  ],
  speed,
  magDrop: { t: 0.62 },
  events: [ev('chargingHandle', 0.3), ev('magRelease', 0.62), ev('magOut', 0.72), ev('boltRelease', 2.33)],
  bolt: [
    { t: 0, v: 0 },
    { t: 0.22, v: 0 },
    { t: 0.32, v: 1 },
    { t: 2.32, v: 1 },
    { t: 2.36, v: 0 },
  ],
  handL: [
    // Reach up to the cocking tube, pull back, flip into the notch, let go.
    { t: 0.02, at: 'chargingHandle', off: [-0.05, -0.03, 0.06], w: 0 },
    { t: 0.2, at: 'chargingHandle', off: [-0.05, -0.03, 0.07], w: 1 },
    { t: 0.34, at: 'chargingHandle', off: [-0.05, -0.03, 0.14], w: 1 },
    { t: 0.48, at: 'chargingHandle', off: [-0.07, -0.05, 0.14], w: 1 },
    { t: 0.62, at: 'chargingHandle', off: [-0.08, -0.08, 0.14], w: 0 },
    // Slap: palm comes down hard on the locked handle.
    { t: 2.08, at: 'chargingHandle', off: [-0.1, 0.03, 0.17], w: 0, turn: [0, 0, 0] },
    { t: 2.24, at: 'chargingHandle', off: [-0.1, 0.05, 0.16], w: 1, turn: [0, 0, -1.3] },
    { t: 2.33, at: 'chargingHandle', off: [-0.09, 0.0, 0.15], w: 1, turn: [0, 0, -1.3] },
    { t: 2.44, at: 'chargingHandle', off: [-0.1, -0.02, 0.15], w: 1, turn: [0, 0, -1.1] },
    { t: 2.62, at: 'chargingHandle', off: [-0.1, -0.06, 0.12], w: 0, turn: [0, 0, 0] },
  ],
  gunW: [
    { t: 1.9, v: 1 },
    { t: 2.9, v: 1 },
  ],
  magStyle: 'straight',
});

// ------------------------------------------------------------------------------------ pistol

function pistol(): Record<ArmsAction, Recipe> {
  const swapIn: Recipe = {
    segs: [{ clip: 'beretta.draw', t0: 0.12 }],
    speed: 1.45,
    bolt: [
      { t: 0, v: 0 },
      { t: 1.2, v: 0 },
    ],
    events: [ev('holsterClear', 0.06)],
  };
  const swapOut: Recipe = {
    segs: [{ clip: 'beretta.holster' }],
    speed: 1.2,
    events: [ev('holsterClear', 0.42), ev('swapMid', 0.5)],
    holdLast: true,
  };
  return {
    idle: { segs: [{ clip: 'beretta.idle' }], loop: true },
    draw: swapIn,
    swapIn,
    holster: swapOut,
    swapOut,
    shoot: { segs: [{ clip: 'beretta.shoot' }], additive: true },
    shootLast: { segs: [{ clip: 'beretta.shootLast' }], additive: true },
    reloadTactical: { segs: [{ clip: 'beretta.reloadTactical' }], speed: 1.1, magStyle: 'straight' },
    reloadEmpty: { segs: [{ clip: 'beretta.reloadEmpty' }], speed: 1.1, magStyle: 'straight' },
    magCheck: pistolCheck(),
    inspect: { segs: [{ clip: 'beretta.inspect' }] },
  };
}

// ------------------------------------------------------------------------------------ table

export const WEAPON_ANIMS: Record<string, WeaponAnims> = {
  k47s: {
    id: 'k47s',
    family: 'rifle',
    pack: 'ak',
    drive: [{ part: 'bolt', travel: 0.09 }],
    locksBack: false,
    triggerRad: 0.3,
    safetyRad: 0.5,
    grip: [0, 0, 0],
    clips: rifle({
      speed: 1,
      swapSpeed: 1,
      swing: 0.55,
      emptyReload: akEmpty(1),
      magStyle: 'rock',
      locksBack: false,
      check: {
        pose: { p: [-0.085, -0.095, -0.3], r: [1.0, -0.9, 0.2] },
        arc: [-0.05, -0.03, 0.03],
        tilt: [0.2, 0, -0.3],
        rock: 0.32,
        gripShift: [0, -0.06, 0],
      },
    }),
  },
  sb16: {
    id: 'sb16',
    family: 'rifle',
    pack: 'ak',
    drive: [{ part: 'bolt', travel: 0.075 }],
    locksBack: true,
    triggerRad: 0.3,
    safetyRad: 1.2,
    grip: [0, 0, 0],
    clips: rifle({
      speed: 1.05,
      swapSpeed: 1.15,
      swing: 0,
      emptyReload: arEmpty(1.05),
      magStyle: 'straight',
      locksBack: true,
      check: {
        pose: { p: [-0.085, -0.1, -0.3], r: [0.9, -1.25, 0.35] },
        arc: [-0.05, -0.03, 0.03],
        tilt: [0.2, 0, -0.3],
      },
    }),
  },
  hb300: {
    id: 'hb300',
    family: 'rifle',
    pack: 'ak',
    drive: [{ part: 'bolt', travel: 0.075 }],
    locksBack: true,
    triggerRad: 0.3,
    safetyRad: 1.2,
    grip: [0, 0, 0],
    clips: rifle({
      speed: 1.15,
      swapSpeed: 1.3,
      swing: 0,
      emptyReload: arEmpty(1.15),
      magStyle: 'straight',
      locksBack: true,
      check: {
        pose: { p: [-0.085, -0.1, -0.3], r: [0.9, -1.25, 0.35] },
        arc: [-0.05, -0.03, 0.03],
        tilt: [0.2, 0, -0.3],
      },
    }),
  },
  kp9: {
    id: 'kp9',
    family: 'smg',
    pack: 'ak',
    drive: [{ part: 'chargingHandle', travel: 0.07 }],
    locksBack: false,
    triggerRad: 0.3,
    safetyRad: 1.0,
    grip: [0, 0, 0],
    clips: rifle({
      speed: 1.08,
      swapSpeed: 1.2,
      swing: 0.15,
      emptyReload: hkEmpty(1.08),
      magStyle: 'straight',
      locksBack: false,
      check: {
        pose: { p: [-0.08, -0.1, -0.29], r: [0.35, -1.5, 0.4] },
        arc: [-0.05, -0.03, 0.03],
        tilt: [0.15, 0, -0.25],
      },
    }),
  },
  p17: {
    id: 'p17',
    family: 'pistol',
    pack: 'beretta',
    drive: [{ part: 'slide', travel: 0.028 }],
    locksBack: true,
    triggerRad: 0.25,
    safetyRad: 0,
    grip: [0, 0, 0],
    clips: pistol(),
  },
};

/** Families for weapons not in the table yet (future revolver / shotgun fall back to these). */
export function weaponAnims(id: string): WeaponAnims {
  if (WEAPON_ANIMS[id]) return WEAPON_ANIMS[id];
  if (/revolver|pistol|^p\d/.test(id)) return { ...WEAPON_ANIMS.p17, id };
  if (/smg|^kp/.test(id)) return { ...WEAPON_ANIMS.kp9, id };
  if (/^k/.test(id)) return { ...WEAPON_ANIMS.k47s, id };
  return { ...WEAPON_ANIMS.sb16, id };
}
