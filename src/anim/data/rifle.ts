import type { BeatLibrary, V3 } from '../beats';
import { COMMON_BEATS, add, hk, pk } from './common';

/**
 * Rifle (AR/AK/PDW) beat tracks. Hand offsets are in the anchor's frame: for `well` that is the magazine
 * frame (y up the mag, so -y = mag pulled out of the well), for body anchors the torso frame.
 * Weapon keys are offsets from the hold pose: p torso-local metres, r = [pitch, yaw, roll].
 * Reload "work space": the rifle comes in toward the chest and cants so the well faces the support hand.
 */
const WP: V3 = [-0.05, 0.13, -0.1];
const WR: V3 = [0.36, 0.34, -0.7];
const WP2: V3 = [-0.04, 0.12, -0.09];
const WR2: V3 = [0.3, 0.28, -0.58];
/** Mag-check weapon pose (cant toward the support hand, in toward the chest cam). */
const CP: V3 = [-0.05, 0.06, -0.05];
const CR: V3 = [0.22, 0.22, -0.6];
/** Mag held up for the check in front of the chest cam (torso frame), feed lips / top round toward the lens. */
const SHOW_P: V3 = [-0.16, -0.13, -0.38];
const SHOW_R: V3 = [1.3, 0, 0.25];

export const RIFLE_BEATS: BeatLibrary = {
  ...COMMON_BEATS,
  magGrab: {
    calm: [
      {
        id: 'side',
        dur: 0.3,
        hit: 0.85,
        left: [
          hk(0.55, 'well', [-0.03, -0.07, -0.03], 'relaxed'),
          hk(1, 'well', [0, 0, 0], 'magGrab', 'out'),
        ],
        weapon: [pk(0.8, WP, WR)],
        events: [{ t: 1, ev: 'magToHand' }],
      },
      {
        id: 'front',
        dur: 0.28,
        hit: 0.85,
        left: [hk(0.5, 'well', [0.0, -0.05, -0.08], 'relaxed'), hk(1, 'well', [0, 0, 0], 'magGrab', 'out')],
        weapon: [pk(0.8, WP2, WR2)],
        events: [{ t: 1, ev: 'magToHand' }],
      },
    ],
  },
  // Decisive strip: the mag leaves straight down the well axis, then swings clear.
  magOut: {
    calm: [
      {
        id: 'a',
        dur: 0.2,
        hit: 0.12,
        left: [
          hk(0.45, 'well', [0, -0.09, 0], 'magGrab', 'snap'),
          hk(1, 'well', [-0.02, -0.16, 0.03], 'magGrab', 'out'),
        ],
        kick: { at: 'well', j: [0, -0.5, 0] },
      },
      {
        id: 'b',
        dur: 0.22,
        hit: 0.12,
        left: [
          hk(0.5, 'well', [0, -0.1, 0], 'magGrab', 'snap'),
          hk(1, 'well', [-0.04, -0.17, 0.05], 'magGrab'),
        ],
        kick: { at: 'well', j: [0, -0.45, 0] },
      },
    ],
  },

  magStow: {
    calm: [
      {
        id: 'a',
        dur: 0.45,
        hit: 0.85,
        left: [
          hk(0.45, 'chest', [-0.17, -0.3, -0.18], 'magGrab'),
          hk(0.8, 'dump', [0, 0.06, 0], 'magGrab'),
          hk(1, 'dump', [0, 0, 0], 'relaxed'),
        ],
        events: [{ t: 0.9, ev: 'magHide' }],
      },
      {
        id: 'b',
        dur: 0.5,
        hit: 0.88,
        left: [
          hk(0.4, 'chest', [-0.13, -0.24, -0.24], 'magGrab'),
          hk(0.82, 'dump', [0.01, 0.07, -0.01], 'magGrab'),
          hk(1, 'dump', [0, -0.01, 0], 'relaxed'),
        ],
        events: [{ t: 0.9, ev: 'magHide' }],
      },
    ],
  },
  magDump: {
    calm: [
      {
        id: 'a',
        dur: 0.22,
        hit: 0.3,
        left: [
          hk(0.4, 'well', [-0.06, -0.2, 0.02], 'relaxed'),
          hk(1, 'chest', [-0.06, -0.2, -0.25], 'relaxed'),
        ],
        events: [{ t: 0.3, ev: 'drop' }],
      },
    ],
  },
  magRelease: {
    calm: [
      {
        id: 'a',
        dur: 0.2,
        hit: 0.25,
        left: [hk(1, 'chest', [-0.05, -0.2, -0.24], 'relaxed')],
        weapon: [pk(1, WP, WR)],
        events: [{ t: 0.25, ev: 'drop' }],
      },
      {
        id: 'b',
        dur: 0.18,
        hit: 0.3,
        left: [hk(1, 'chest', [-0.08, -0.22, -0.2], 'relaxed')],
        weapon: [pk(1, WP2, WR2)],
        events: [{ t: 0.3, ev: 'drop' }],
      },
    ],
  },
  magDraw: {
    calm: [
      {
        id: 'a',
        dur: 0.42,
        hit: 0.6,
        left: [
          hk(0.4, 'pouch', [0, 0.04, -0.01], 'relaxed'),
          hk(0.55, 'pouch', [0, 0, 0], 'magGrab'),
          hk(0.72, 'pouch', [0, 0.12, -0.03], 'magGrab'),
          hk(1, 'well', [-0.03, -0.14, 0.04], 'magGrab'),
        ],
        events: [{ t: 0.58, ev: 'magShow' }],
      },
      {
        id: 'b',
        dur: 0.46,
        hit: 0.62,
        left: [
          hk(0.42, 'pouch', [0.01, 0.05, -0.02], 'relaxed'),
          hk(0.58, 'pouch', [0, 0, 0], 'magGrab'),
          hk(0.75, 'pouch', [-0.02, 0.14, -0.05], 'magGrab'),
          hk(1, 'well', [-0.01, -0.12, 0.06], 'magGrab'),
        ],
        events: [{ t: 0.6, ev: 'magShow' }],
      },
    ],
  },
  magIndex: {
    calm: [
      {
        id: 'feel',
        dur: 0.22,
        hit: 0.92,
        left: [
          hk(0.65, 'well', [-0.004, -0.05, 0.012], 'magGrab'),
          hk(1, 'well', [0, -0.03, 0], 'magGrab', 'out'),
        ],
      },
      {
        id: 'front',
        dur: 0.24,
        hit: 0.9,
        left: [
          hk(0.5, 'well', [0, -0.065, -0.02], 'magGrab'),
          hk(1, 'well', [0, -0.03, 0.003], 'magGrab', 'out'),
        ],
      },
      {
        id: 'cant',
        dur: 0.2,
        hit: 0.9,
        left: [
          hk(0.6, 'well', [-0.01, -0.055, 0.008], 'magGrab', 'io', [0, 0, 0.12]),
          hk(1, 'well', [0, -0.03, 0], 'magGrab', 'out'),
        ],
      },
    ],
    stressed: [
      {
        id: 'jab',
        dur: 0.16,
        hit: 0.9,
        left: [
          hk(0.55, 'well', [0.008, -0.06, 0.015], 'magGrab'),
          hk(1, 'well', [0, -0.03, 0], 'magGrab', 'back'),
        ],
      },
      {
        id: 'rush',
        dur: 0.15,
        hit: 0.9,
        left: [hk(1, 'well', [0.003, -0.028, 0.004], 'magGrab', 'back')],
      },
    ],
  },
  fumbleMiss: {
    calm: [
      {
        id: 'edge',
        dur: 0.38,
        hit: 0.3,
        left: [
          hk(0.3, 'well', [0.018, -0.022, 0.02], 'magGrab', 'in'),
          hk(0.6, 'well', [0.012, -0.075, 0.03], 'magGrab'),
          hk(1, 'well', [-0.006, -0.055, 0.008], 'magGrab'),
        ],
        weapon: [pk(0.35, add(WP, [0, 0.01, 0]), add(WR, [0.05, 0, 0.05])), pk(1, WP, WR)],
      },
      {
        id: 'front',
        dur: 0.36,
        hit: 0.28,
        left: [
          hk(0.28, 'well', [0, -0.02, -0.025], 'magGrab', 'in'),
          hk(0.6, 'well', [-0.01, -0.07, -0.02], 'magGrab'),
          hk(1, 'well', [0, -0.05, 0.005], 'magGrab'),
        ],
      },
    ],
  },
  // Seat: anticipation dip, a fast drive up into the well (contact = the click + jolt), follow-through, tug test.
  magSeat: {
    calm: [
      {
        id: 'slap',
        dur: 0.32,
        hit: 0.3,
        left: [
          hk(0.18, 'well', [0, -0.052, 0.006], 'magGrab', 'out'),
          hk(0.3, 'well', [0, 0.003, 0], 'magGrab', 'in'),
          hk(0.5, 'well', [0, -0.05, 0.012], 'flat', 'out'),
          hk(0.78, 'well', [0, 0, 0], 'magGrab', 'io'),
          hk(1, 'well', [0, -0.007, 0], 'magGrab'),
        ],
        weapon: [
          pk(0.28, WP, WR),
          pk(0.42, add(WP, [0, 0.022, 0.004]), add(WR, [0.09, 0, 0.05]), 'out'),
          pk(1, WP, WR),
        ],
        events: [{ t: 0.3, ev: 'magToWell' }],
        kick: { at: 'well', j: [0, 1.9, 0.25], cam: 0.1 },
      },
      {
        id: 'push-tug',
        dur: 0.27,
        hit: 0.4,
        left: [
          hk(0.2, 'well', [0, -0.046, 0], 'magGrab', 'out'),
          hk(0.4, 'well', [0, 0.004, 0], 'magGrab', 'in'),
          hk(0.68, 'well', [0, -0.008, 0], 'magGrab', 'out'),
          hk(1, 'well', [0, 0, 0], 'magGrab'),
        ],
        weapon: [
          pk(0.38, WP, WR),
          pk(0.52, add(WP, [0, 0.014, 0]), add(WR, [0.06, 0, 0.03]), 'out'),
          pk(1, WP, WR),
        ],
        events: [{ t: 0.4, ev: 'magToWell' }],
        kick: { at: 'well', j: [0, 1.2, 0.15], cam: 0.06 },
      },
    ],
  },

  boltRelease: {
    calm: [
      {
        id: 'palm',
        dur: 0.26,
        hit: 0.7,
        left: [
          hk(0.5, 'boltCatch', [-0.025, 0, 0], 'flat'),
          hk(0.7, 'boltCatch', [0, 0, 0], 'flat', 'in'),
          hk(1, 'boltCatch', [-0.03, 0, 0.01], 'flat'),
        ],
        weapon: [pk(0.72, add(WP, [0.012, 0, 0]), add(WR, [0, -0.04, -0.06])), pk(1, WP, WR)],
        events: [{ t: 0.7, ev: 'chamber' }],
        // Bolt / slide slams home: a recoil-like jolt.
        kick: { at: 'bore', j: [0, 0.2, -1.1], cam: 0.08 },
      },
      {
        id: 'swipe',
        dur: 0.24,
        hit: 0.6,
        left: [
          hk(0.45, 'boltCatch', [-0.02, -0.03, -0.02], 'flat'),
          hk(0.65, 'boltCatch', [0, 0.01, 0.01], 'flat', 'in'),
          hk(1, 'boltCatch', [-0.025, 0.02, 0.02], 'relaxed'),
        ],
        events: [{ t: 0.6, ev: 'chamber' }],
        // Bolt / slide slams home: a recoil-like jolt.
        kick: { at: 'bore', j: [0, 0.2, -1.1], cam: 0.08 },
      },
    ],
  },
  chargingHandle: {
    calm: [
      {
        id: 'hook',
        dur: 0.55,
        hit: 0.84,
        left: [
          hk(0.4, 'charging', [0, 0.04, -0.03], 'relaxed'),
          hk(0.55, 'charging', [0, 0, 0], 'pinch'),
          hk(0.78, 'charging', [0, 0, 0.075], 'pinch', 'in'),
          hk(1, 'charging', [-0.03, 0.04, 0.1], 'relaxed'),
        ],
        weapon: [pk(0.5, [-0.04, 0.03, 0.06], [0.2, 0.05, -0.15])],
        parts: {
          charge: [
            { t: 0.55, v: 0 },
            { t: 0.78, v: 1, e: 'in' },
            { t: 0.84, v: 0, e: 'snap' },
          ],
        },
        events: [{ t: 0.84, ev: 'chamber' }],
        // Bolt / slide slams home: a recoil-like jolt.
        kick: { at: 'bore', j: [0, 0.2, -1.1], cam: 0.08 },
      },
      {
        id: 'blade',
        dur: 0.5,
        hit: 0.82,
        left: [
          hk(0.4, 'charging', [0.02, 0.05, -0.02], 'flat'),
          hk(0.55, 'charging', [0, 0.005, 0], 'pinch'),
          hk(0.76, 'charging', [0, 0.005, 0.07], 'pinch', 'in'),
          hk(1, 'charging', [-0.04, 0.05, 0.08], 'relaxed'),
        ],
        weapon: [pk(0.5, [-0.03, 0.04, 0.07], [0.24, 0.08, -0.2])],
        parts: {
          charge: [
            { t: 0.55, v: 0 },
            { t: 0.76, v: 1, e: 'in' },
            { t: 0.82, v: 0, e: 'snap' },
          ],
        },
        events: [{ t: 0.82, ev: 'chamber' }],
        // Bolt / slide slams home: a recoil-like jolt.
        kick: { at: 'bore', j: [0, 0.2, -1.1], cam: 0.08 },
      },
    ],
  },
  handSlip: {
    calm: [
      {
        id: 'slip',
        dur: 0.36,
        hit: 0.65,
        left: [
          hk(0.35, 'charging', [0, 0.04, -0.03], 'relaxed'),
          hk(0.5, 'charging', [0, 0, 0], 'pinch'),
          hk(0.65, 'charging', [0, 0.025, 0.045], 'relaxed', 'in'),
          hk(1, 'charging', [-0.02, 0.045, 0.02], 'relaxed'),
        ],
        weapon: [pk(0.5, [-0.04, 0.03, 0.06], [0.2, 0.05, -0.15])],
        parts: {
          charge: [
            { t: 0.5, v: 0 },
            { t: 0.62, v: 0.45 },
            { t: 0.68, v: 0, e: 'snap' },
          ],
        },
      },
    ],
  },
  handReturn: {
    calm: [
      { id: 'a', dur: 0.3, left: [hk(1, 'handguard', [0, 0, 0], 'support')], weapon: [pk(1)] },
      {
        id: 'b',
        dur: 0.34,
        left: [hk(0.6, 'handguard', [0, -0.035, 0.05], 'relaxed'), hk(1, 'handguard', [0, 0, 0], 'support')],
        weapon: [pk(1)],
      },
    ],
  },
  // Mag check (hold reload): the gun cants so the well faces the support hand, the mag comes straight out down the
  // well axis, tilts its feed lips / top round toward the chest cam, holds while the button is held, then goes
  // back in along the axis and is seated with a slap + tug (magSeat).
  magCheck: {
    calm: [
      {
        id: 'a',
        dur: 0.3,
        hit: 0.9,
        left: [
          hk(0.55, 'well', [-0.03, -0.07, -0.03], 'relaxed'),
          hk(0.9, 'well', [0, 0, 0], 'magGrab', 'out'),
        ],
        weapon: [pk(0.9, CP, CR)],
        events: [{ t: 0.9, ev: 'magToHand' }],
      },
    ],
  },
  magCheckOut: {
    calm: [
      {
        id: 'a',
        dur: 0.36,
        hit: 0.42,
        left: [
          hk(0.18, 'well', [0, -0.012, 0], 'magGrab', 'in'),
          hk(0.42, 'well', [0, -0.1, 0], 'magGrab', 'lin'),
          hk(1, 'chest', SHOW_P, 'magGrab', 'io', SHOW_R),
        ],
        weapon: [pk(1, CP, CR)],
        kick: { at: 'well', j: [0, -0.35, 0] },
      },
    ],
  },
  checkHold: {
    calm: [
      {
        id: 'a',
        dur: 0.6,
        hold: true,
        left: [
          hk(0.5, 'chest', add(SHOW_P, [0.003, 0.004, 0.002]), 'magGrab', 'io', add(SHOW_R, [0.04, 0.03, 0])),
          hk(1, 'chest', SHOW_P, 'magGrab', 'io', SHOW_R),
        ],
        weapon: [pk(0.5, add(CP, [0, 0.004, 0.003]), add(CR, [0.02, 0.01, -0.02])), pk(1, CP, CR)],
      },
    ],
  },
  magCheckIn: {
    calm: [
      {
        id: 'a',
        dur: 0.3,
        hit: 0.82,
        left: [
          hk(0.5, 'well', [0, -0.105, 0], 'magGrab', 'io'),
          hk(0.82, 'well', [0, -0.03, 0], 'magGrab', 'in'),
          hk(1, 'well', [0, -0.03, 0], 'magGrab'),
        ],
        weapon: [pk(1, WP, WR)],
      },
    ],
  },
  // Grip readjust after a string (scaled by weapon stability).
  gripAdjust: {
    calm: [
      {
        id: 'slide-back',
        dur: 0.42,
        hit: 0.8,
        left: [hk(0.4, 'handguard', [0, -0.012, 0.035], 'relaxed'), hk(1, 'handguard', [0, 0, 0], 'support')],
        right: [hk(0.3, 'grip', [0.004, 0.006, 0.01], 'relaxed'), hk(1, 'grip', [0, 0, 0], 'grip')],
        weapon: [pk(0.4, [0, 0.004, 0.008], [0.012, 0, 0.035]), pk(1)],
      },
      {
        id: 'reach-out',
        dur: 0.45,
        hit: 0.85,
        left: [
          hk(0.45, 'handguard', [0, -0.015, -0.03], 'relaxed'),
          hk(1, 'handguard', [0, 0, -0.008], 'support'),
        ],
        weapon: [pk(0.45, [0.003, -0.004, 0], [-0.01, 0, -0.03]), pk(1)],
      },
      {
        id: 'regrip',
        dur: 0.36,
        hit: 0.7,
        right: [hk(0.4, 'grip', [0.006, -0.01, 0.012], 'relaxed'), hk(1, 'grip', [0, 0, 0], 'grip')],
        weapon: [pk(0.4, [0, -0.006, 0.01], [-0.015, 0.01, 0.05]), pk(1)],
      },
    ],
  },
};
