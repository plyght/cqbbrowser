import type { ClipEvent, V3 } from '../rig/clipData';
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
  | 'reloadSpeed'
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
  'reloadSpeed',
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
      gripShift: f.gripShift ?? [0, -0.085, 0],
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
  /** Speed / empty reload family. */
  reload: 'ar' | 'ak' | 'hk';
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
    reloadSpeed: SPEED[o.reload](o.speed * SPEED_PACE[o.reload], false),
    reloadEmpty: SPEED[o.reload](o.speed * EMPTY_PACE[o.reload], true),
    magCheck: rifleCheck(o.speed, o.magStyle, o.check),
    inspect: { segs: [{ clip: 'ak.inspect' }], speed: o.speed },
  };
}

// ------------------------------------------------------------------------------------ speed / empty reloads

/**
 * Rifle speed reloads (double-tap R, and the empty reloads that end in the bolt / handle), built for the punch the
 * pistol's Beretta-pack speed reload has: a beat of anticipation (the gun dips and cants out), a snappy dump, a
 * fast low hand trip to the chest rig, the mag indexed in and punched home with the whole gun kicking up on the
 * seat, then the family's finisher and a snap back to the ready. Composed time (s) before `speed`; the seat lands at
 * ≈ 0.8 s on every rifle and the whole speed reload takes ≈ 1 s (tactical reloads stay at ≈ 2 s).
 *
 * Families:
 *  - AR (sb16 / hb300): index finger on the release, the empty drops free and tumbles; fresh mag straight in, palm
 *    punch; empty → the support palm slaps the bolt catch.
 *  - AK (k47s): the fresh mag's spine knocks the old one out past the paddle (it stays in until the new one gets
 *    there), rock in front-lug first, hard clack; empty → overhand rack with a wrist roll.
 *  - HK (kp9): rip the old mag out and flick it away, fresh mag in; empty → cock, lock and HK-slap the handle.
 */
const V0: V3 = [0, 0, 0];
/**
 * Lead-in from the ready hold into the source reload (composed s): the AK-pack reload starts mid-motion, and a
 * shorter blend popped the support hand (> 50 mm/frame at speed-reload pace).
 */
const LEAD = 0.25;
const T = (t: number, r: V3) => ({ t, r });

/**
 * Re-time every authored key / event. The builders are written against a short lead-in (`pre` s, then the source at
 * a uniform pace); `slow` source spans play slower (the AK pack's hand trip to the pouch turns the wrist ~35°/frame,
 * which at speed-reload pace would flip a bone in one frame), so keys after them move later.
 */
function retime(r: Recipe, pre: number, src0: number, slow: [number, number, number][] = []): Recipe {
  const warp = (old: number) => {
    if (old < pre) return (old / pre) * LEAD;
    const src = old - pre + src0;
    let t = LEAD + (src - src0);
    for (const [a, b, k] of slow) t += Math.max(0, Math.min(src, b) - a) * (1 / k - 1);
    return t;
  };
  const m = <K extends { t: number }>(ks?: K[]) => ks?.map((k) => ({ ...k, t: warp(k.t) }));
  return {
    ...r,
    events: m(r.events),
    tilt: m(r.tilt),
    bolt: m(r.bolt),
    gunW: m(r.gunW),
    handL: m(r.handL),
    magDrop: r.magDrop && { ...r.magDrop, t: warp(r.magDrop.t) },
  };
}

/** The AR reload's slowed span (source s, relative pace). */
const AR_SLOW: [number, number, number][] = [[0.12, 0.45, 0.55]];

/** AR: dump (free fall) → pouch → straight in → punch; `empty` adds the bolt-catch slap. */
function arSpeed(speed: number, empty: boolean): Recipe {
  const cant: V3 = [0.12, 0.05, -0.4];
  const seat = 1.35; // source reloadEmpty 1.30 (source 0.05 at composed 0.1)
  const tilt = [
    T(0, V0),
    // Anticipation: a short dip, then the gun cants out to bring the well to the support hand.
    T(0.05, [-0.06, 0, -0.06]),
    T(0.3, cant),
    T(1.15, cant),
    T(seat - 0.02, [0.08, 0.05, -0.36]),
    // Palm punch: the whole gun kicks up on the seat.
    T(seat + 0.02, [0.22, 0.05, -0.32]),
    T(seat + 0.1, [0.1, 0.03, -0.22]),
  ];
  const segs: Recipe['segs'] = [
    { clip: 'ak.idle', t0: 0, t1: 0 },
    { blend: LEAD },
    { clip: 'ak.reloadEmpty', t0: 0.05, t1: 0.12 },
    { clip: 'ak.reloadEmpty', t0: 0.12, t1: 0.45, speed: AR_SLOW[0][2] },
    { clip: 'ak.reloadEmpty', t0: 0.45, t1: empty ? 1.55 : 1.42 },
  ];
  const r: Recipe = {
    segs,
    speed,
    magDrop: { t: 0.04 },
    drop: [0, -1.4, 0.15],
    events: [ev('magRelease', 0), ev('magOut', 0.04)],
    bolt: [
      { t: 0, v: empty ? 1 : 0 },
      { t: 1.6, v: empty ? 1 : 0 },
    ],
    magStyle: 'straight',
    tilt,
  };
  if (!empty) {
    segs.push({ blend: 0.22 }, { clip: 'ak.idle', t0: 0, t1: 0 });
    tilt.push(T(1.69, V0));
    return retime(r, 0.1, 0.05, AR_SLOW);
  }
  // Bolt-catch slap with the support palm right after the seat.
  const slap = 1.62;
  segs.push({ hold: 0.34 }, { blend: 0.25 }, { clip: 'ak.idle', t0: 0, t1: 0 });
  tilt.push(
    T(slap - 0.02, [0.1, 0.03, -0.22]),
    T(slap + 0.02, [0.17, 0.03, -0.2]),
    T(slap + 0.1, [0.08, 0.02, -0.12]),
    T(2.19, V0),
  );
  r.events!.push(ev('boltRelease', slap));
  const out = r;
  r.bolt = [
    { t: 0, v: 1 },
    { t: slap - 0.01, v: 1 },
    { t: slap + 0.02, v: 0 },
  ];
  r.gunW = [
    { t: 1.5, v: 1 },
    { t: 2.19, v: 1 },
  ];
  r.handL = [
    { t: 1.42, at: 'boltCatch', off: [-0.08, -0.1, 0.1], w: 0 },
    { t: 1.56, at: 'boltCatch', off: [-0.085, -0.095, 0.085], w: 1 },
    { t: slap, at: 'boltCatch', off: [-0.06, -0.09, 0.08], w: 1 },
    { t: 1.7, at: 'boltCatch', off: [-0.09, -0.1, 0.09], w: 1 },
    { t: 1.86, at: 'boltCatch', off: [-0.09, -0.11, 0.1], w: 0 },
  ];
  return retime(out, 0.1, 0.05, AR_SLOW);
}

/** AK: the fresh mag knocks the old one out, rock in, clack; `empty` adds the overhand rack with a wrist roll. */
function akSpeed(speed: number, empty: boolean): Recipe {
  const cant: V3 = [0.1, 0, -0.32];
  // Source reloadEmpty from 0.15 at composed 0.1: composed = source - 0.05.
  const knock = 0.65;
  const seat = 1.25;
  const tilt = [
    T(0, V0),
    T(0.05, [-0.05, 0, -0.05]),
    T(0.25, cant),
    T(knock - 0.02, cant),
    // The spine hits the paddle: the old mag pops out forward.
    T(knock + 0.02, [0.14, 0, -0.36]),
    T(seat - 0.05, [0.12, 0, -0.3]),
    // Rocked back into the catch: hard clack.
    T(seat, [0.24, 0, -0.26]),
    T(seat + 0.08, [0.1, 0, -0.18]),
  ];
  const segs: Recipe['segs'] = [
    { clip: 'ak.idle', t0: 0, t1: 0 },
    { blend: LEAD },
    { clip: 'ak.reloadEmpty', t0: 0.15, t1: empty ? undefined : 1.42 },
  ];
  const r: Recipe = {
    segs,
    speed,
    // The old mag stays seated until the new one knocks it out.
    magDrop: { t: knock, hold: true, kick: [0, -0.2, -0.9] },
    drop: [0, -0.7, -1.3],
    events: [ev('magRelease', knock - 0.03), ev('magOut', knock)],
    magStyle: 'rock',
    tilt,
  };
  if (!empty) {
    segs.push({ blend: 0.22 }, { clip: 'ak.idle', t0: 0, t1: 0 });
    tilt.push(T(1.59, V0));
    return retime(r, 0.1, 0.15);
  }
  // Source rack: charging handle 2.17, release 2.53 → composed 2.12 / 2.48. A little wrist roll into the rack.
  tilt.push(
    T(1.6, [0.05, 0, -0.1]),
    T(2.12, [0.05, 0, 0.14]),
    T(2.46, [0.04, 0, 0.1]),
    T(2.5, [0.18, 0, 0.04]),
    T(2.62, [0.04, 0, 0]),
    T(3.0, V0),
  );
  return retime(r, 0.1, 0.15);
}

/** HK: rip the old mag out and flick it away, fresh mag in; `empty` adds cock → lock → HK slap. */
function hkSpeed(speed: number, empty: boolean): Recipe {
  const cant: V3 = [0.1, 0, -0.35];
  // reloadTactical 0.25–0.73 at composed 0.08 (grab, rip), flick blend, reloadEmpty from 0.38 at composed 0.76.
  const flick = 0.64;
  const seat = 1.68; // source 1.30
  const tilt = [
    T(0, V0),
    T(0.05, [-0.05, 0, -0.05]),
    T(0.3, cant),
    T(0.56, [0.08, 0.04, -0.38]),
    // The flick: a wrist snap that throws the empty aside.
    T(flick, [0.04, 0.12, -0.44]),
    T(0.9, cant),
    T(seat - 0.04, [0.1, 0, -0.35]),
    T(seat, [0.22, 0, -0.3]),
    T(seat + 0.08, [0.08, 0, -0.2]),
  ];
  const segs: Recipe['segs'] = [
    { clip: 'ak.idle', t0: 0, t1: 0 },
    { blend: LEAD },
    { clip: 'ak.reloadTactical', t0: 0.25, t1: 0.73 },
    { blend: 0.2 },
    { clip: 'ak.reloadEmpty', t0: 0.38, t1: empty ? 1.62 : 1.42 },
  ];
  const r: Recipe = {
    segs,
    speed,
    keepEvents: false,
    drop: [-1.5, -0.5, -0.5],
    events: [ev('magRelease', 0.26), ev('magOut', flick), ev('magIn', 1.48), ev('magSeat', seat)],
    magStyle: 'straight',
    tilt,
    bolt: [
      { t: 0, v: 0 },
      { t: 1.85, v: 0 },
    ],
  };
  if (!empty) {
    segs.push({ blend: 0.22 }, { clip: 'ak.idle', t0: 0, t1: 0 });
    tilt.push(T(2.02, V0));
    return retime(r, 0.08, 0.25);
  }
  // Cock the handle back, flip it into the notch, then slap it down hard.
  const cock = 2.0;
  const slap = 2.44;
  segs.push({ hold: 0.7 }, { blend: 0.25 }, { clip: 'ak.idle', t0: 0, t1: 0 });
  tilt.push(
    T(1.86, [0.06, 0, -0.18]),
    T(cock, [0.02, 0, -0.1]),
    T(slap - 0.03, [0.02, 0, -0.06]),
    T(slap + 0.02, [0.16, 0, -0.04]),
    T(slap + 0.1, [0.03, 0, 0]),
    T(2.95, V0),
  );
  r.events!.push(ev('chargingHandle', cock), ev('boltRelease', slap));
  r.bolt = [
    { t: 0, v: 0 },
    { t: cock - 0.08, v: 0 },
    { t: cock, v: 1 },
    { t: slap - 0.01, v: 1 },
    { t: slap + 0.02, v: 0 },
  ];
  r.handL = [
    // Reach up to the cocking tube, pull back, flip into the notch, let go (the MP5 lock)…
    { t: 1.74, at: 'chargingHandle', off: [-0.05, -0.03, 0.06], w: 0 },
    { t: 1.88, at: 'chargingHandle', off: [-0.06, -0.03, 0.07], w: 1 },
    { t: cock, at: 'chargingHandle', off: [-0.06, -0.03, 0.14], w: 1 },
    { t: 2.1, at: 'chargingHandle', off: [-0.07, -0.05, 0.14], w: 1 },
    { t: 2.2, at: 'chargingHandle', off: [-0.08, -0.08, 0.14], w: 0 },
    // …then the slap: palm comes down hard on the locked handle.
    { t: 2.22, at: 'chargingHandle', off: [-0.1, 0.03, 0.17], w: 0, turn: [0, 0, 0] },
    { t: 2.36, at: 'chargingHandle', off: [-0.1, 0.05, 0.16], w: 1, turn: [0, 0, -1.3] },
    { t: slap, at: 'chargingHandle', off: [-0.09, 0.0, 0.15], w: 1, turn: [0, 0, -1.3] },
    { t: 2.54, at: 'chargingHandle', off: [-0.1, -0.02, 0.15], w: 1, turn: [0, 0, -1.1] },
    { t: 2.72, at: 'chargingHandle', off: [-0.1, -0.06, 0.12], w: 0, turn: [0, 0, 0] },
  ];
  r.gunW = [
    { t: 1.7, v: 1 },
    { t: 2.95, v: 1 },
  ];
  return retime(r, 0.08, 0.25);
}

const SPEED = { ar: arSpeed, ak: akSpeed, hk: hkSpeed };
/** Speed-reload pace over the weapon's base clip speed: the whole reload lands at ≈ 1 s. */
const SPEED_PACE = { ar: 2.05, ak: 1.85, hk: 2.1 };
/** Empty-reload pace (these end in the finisher, so they run longer). */
const EMPTY_PACE = { ar: 1.45, ak: 1.3, hk: 1.35 };

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
    // The double-tap: the same dump-and-index Beretta-pack reload, faster.
    reloadSpeed: { segs: [{ clip: 'beretta.reloadTactical' }], speed: 1.1 * 1.18, magStyle: 'straight' },
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
      reload: 'ak',
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
      reload: 'ar',
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
      reload: 'ar',
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
      reload: 'hk',
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
