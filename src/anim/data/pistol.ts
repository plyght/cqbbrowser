import type { BeatLibrary, V3 } from '../beats';
import { COMMON_BEATS, add, hk, pk } from './common';

/**
 * Pistol beat tracks. `well` is the magazine frame with its origin just under the baseplate when seated,
 * so p.y ≈ -0.095 puts the mag top at the mouth of the grip.
 */
const WP: V3 = [-0.02, 0.06, 0.11];
const WR: V3 = [0.38, 0.1, -0.38];
const WP2: V3 = [0, 0.05, 0.12];
const WR2: V3 = [0.3, 0.05, -0.28];
/** Mag-check pose: gun drawn in a little and canted so the support hand and the witness holes face the lens. */
const PCP: V3 = [0.02, 0.03, 0.12];
const PCR: V3 = [0.4, 0.3, -0.9];

export const PISTOL_BEATS: BeatLibrary = {
  ...COMMON_BEATS,
  magRelease: {
    calm: [
      {
        id: 'a',
        dur: 0.16,
        hit: 0.2,
        left: [hk(1, 'well', [-0.03, -0.09, 0.03], 'relaxed')],
        weapon: [pk(1, WP, WR)],
        events: [{ t: 0.2, ev: 'drop' }],
      },
      {
        id: 'b',
        dur: 0.18,
        hit: 0.25,
        left: [hk(1, 'well', [-0.05, -0.07, 0.01], 'relaxed')],
        weapon: [pk(1, WP2, WR2)],
        events: [{ t: 0.25, ev: 'drop' }],
      },
    ],
  },
  magGrab: {
    calm: [
      {
        id: 'a',
        dur: 0.26,
        hit: 0.8,
        left: [hk(0.6, 'well', [-0.02, -0.04, 0.02], 'relaxed'), hk(1, 'well', [0, 0, 0], 'magGrab', 'out')],
        weapon: [pk(0.8, WP, WR)],
        events: [{ t: 1, ev: 'magToHand' }],
      },
      {
        id: 'b',
        dur: 0.24,
        hit: 0.8,
        left: [hk(0.55, 'well', [0, -0.05, -0.02], 'relaxed'), hk(1, 'well', [0, 0, 0], 'magGrab', 'out')],
        weapon: [pk(0.8, WP2, WR2)],
        events: [{ t: 1, ev: 'magToHand' }],
      },
    ],
  },
  magOut: {
    calm: [{ id: 'a', dur: 0.18, hit: 0.1, left: [hk(1, 'well', [-0.02, -0.13, 0.03], 'magGrab', 'out')] }],
  },
  magStow: {
    calm: [
      {
        id: 'a',
        dur: 0.42,
        hit: 0.85,
        left: [
          hk(0.5, 'chest', [-0.12, -0.28, -0.18], 'magGrab'),
          hk(0.85, 'dump', [0, 0.05, 0], 'magGrab'),
          hk(1, 'dump', [0, 0, 0], 'relaxed'),
        ],
        events: [{ t: 0.9, ev: 'magHide' }],
      },
      {
        id: 'b',
        dur: 0.46,
        hit: 0.85,
        left: [
          hk(0.45, 'chest', [-0.15, -0.22, -0.22], 'magGrab'),
          hk(0.85, 'dump', [0.01, 0.06, -0.01], 'magGrab'),
          hk(1, 'dump', [0, 0, 0], 'relaxed'),
        ],
        events: [{ t: 0.9, ev: 'magHide' }],
      },
    ],
  },
  magDump: {
    calm: [
      {
        id: 'a',
        dur: 0.2,
        hit: 0.3,
        left: [
          hk(0.4, 'well', [-0.05, -0.16, 0.02], 'relaxed'),
          hk(1, 'chest', [-0.08, -0.22, -0.22], 'relaxed'),
        ],
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
          hk(0.45, 'pistolPouch', [0, 0.04, 0], 'relaxed'),
          hk(0.58, 'pistolPouch', [0, 0, 0], 'magGrab'),
          hk(0.72, 'pistolPouch', [0, 0.1, -0.02], 'magGrab'),
          hk(1, 'well', [-0.02, -0.18, 0.03], 'magGrab'),
        ],
        events: [{ t: 0.6, ev: 'magShow' }],
      },
      {
        id: 'b',
        dur: 0.45,
        hit: 0.62,
        left: [
          hk(0.45, 'pistolPouch', [0.01, 0.05, -0.01], 'relaxed'),
          hk(0.6, 'pistolPouch', [0, 0, 0], 'magGrab'),
          hk(0.75, 'pistolPouch', [-0.02, 0.12, -0.04], 'magGrab'),
          hk(1, 'well', [0, -0.17, 0.05], 'magGrab'),
        ],
        events: [{ t: 0.62, ev: 'magShow' }],
      },
    ],
  },
  magIndex: {
    calm: [
      {
        id: 'a',
        dur: 0.2,
        hit: 0.9,
        left: [
          hk(0.6, 'well', [0, -0.125, 0.006], 'magGrab'),
          hk(1, 'well', [0, -0.095, 0], 'magGrab', 'out'),
        ],
      },
      {
        id: 'b',
        dur: 0.22,
        hit: 0.9,
        left: [
          hk(0.55, 'well', [-0.008, -0.12, -0.01], 'magGrab', 'io', [0, 0, 0.1]),
          hk(1, 'well', [0, -0.095, 0], 'magGrab', 'out'),
        ],
      },
    ],
  },
  fumbleMiss: {
    calm: [
      {
        id: 'a',
        dur: 0.36,
        hit: 0.3,
        left: [
          hk(0.3, 'well', [0.012, -0.1, 0.015], 'magGrab', 'in'),
          hk(0.6, 'well', [0.01, -0.14, 0.02], 'magGrab'),
          hk(1, 'well', [0, -0.115, 0], 'magGrab'),
        ],
        weapon: [pk(0.35, add(WP, [0, 0.008, 0]), add(WR, [0.04, 0, 0.04])), pk(1, WP, WR)],
      },
    ],
  },
  magSeat: {
    calm: [
      {
        id: 'push',
        dur: 0.18,
        hit: 0.5,
        left: [hk(0.5, 'well', [0, 0.002, 0], 'magGrab', 'out'), hk(1, 'well', [0, -0.006, 0], 'flat')],
        weapon: [pk(0.55, add(WP, [0, 0.01, 0]), add(WR, [0.04, 0, 0])), pk(1, WP, WR)],
        events: [{ t: 0.5, ev: 'magToWell' }],
        kick: { at: 'well', j: [0, 0.7, 0.05], cam: 0.04 },
      },
      {
        id: 'slap',
        dur: 0.26,
        hit: 0.35,
        left: [
          hk(0.35, 'well', [0, 0.002, 0], 'magGrab', 'out'),
          hk(0.6, 'well', [0, -0.06, 0.01], 'flat'),
          hk(0.85, 'well', [0, -0.012, 0], 'flat', 'in'),
          hk(1, 'well', [0, -0.03, 0], 'flat'),
        ],
        weapon: [pk(0.87, add(WP, [0, 0.014, 0]), add(WR, [0.05, 0, 0])), pk(1, WP, WR)],
        events: [{ t: 0.35, ev: 'magToWell' }],
        kick: { at: 'well', j: [0, 0.9, 0.05], cam: 0.05 },
      },
    ],
  },
  slideRelease: {
    calm: [
      {
        id: 'overhand',
        dur: 0.45,
        hit: 0.8,
        left: [
          hk(0.4, 'slide', [0, 0.03, 0.01], 'relaxed'),
          hk(0.55, 'slide', [0, 0, 0], 'pinch'),
          hk(0.75, 'slide', [0, 0, 0.05], 'pinch', 'in'),
          hk(1, 'slide', [-0.03, 0.03, 0.08], 'relaxed'),
        ],
        parts: {
          slide: [
            { t: 0.55, v: 1 },
            { t: 0.75, v: 1.25, e: 'in' },
            { t: 0.8, v: 0, e: 'snap' },
          ],
        },
        events: [{ t: 0.8, ev: 'chamber' }],
        // Bolt / slide slams home: a recoil-like jolt.
        kick: { at: 'slide', j: [0, 0.15, -0.7], cam: 0.05 },
      },
      {
        id: 'thumb',
        dur: 0.22,
        hit: 0.4,
        weapon: [pk(0.4, add(WP, [0, -0.01, 0]), add(WR, [-0.04, 0, 0])), pk(1, WP, WR)],
        parts: {
          slide: [
            { t: 0.35, v: 1 },
            { t: 0.42, v: 0, e: 'snap' },
          ],
        },
        events: [{ t: 0.4, ev: 'chamber' }],
        // Bolt / slide slams home: a recoil-like jolt.
        kick: { at: 'slide', j: [0, 0.15, -0.7], cam: 0.05 },
      },
    ],
  },
  slideSlip: {
    calm: [
      {
        id: 'slip',
        dur: 0.34,
        hit: 0.65,
        left: [
          hk(0.4, 'slide', [0, 0.03, 0.01], 'relaxed'),
          hk(0.55, 'slide', [0, 0, 0], 'pinch'),
          hk(0.66, 'slide', [0.01, 0.02, 0.03], 'relaxed', 'in'),
          hk(1, 'slide', [0, 0.03, 0.01], 'relaxed'),
        ],
        parts: {
          slide: [
            { t: 0.55, v: 1 },
            { t: 0.62, v: 1.1 },
            { t: 0.68, v: 1 },
          ],
        },
      },
    ],
  },
  handReturn: {
    calm: [
      { id: 'a', dur: 0.26, left: [hk(1, 'handguard', [0, 0, 0], 'support')], weapon: [pk(1)] },
      {
        id: 'b',
        dur: 0.3,
        left: [
          hk(0.6, 'handguard', [-0.02, -0.03, 0.03], 'relaxed'),
          hk(1, 'handguard', [0, 0, 0], 'support'),
        ],
        weapon: [pk(1)],
      },
    ],
  },
  magCheck: {
    calm: [
      {
        id: 'a',
        dur: 0.3,
        left: [hk(0.6, 'well', [-0.02, -0.05, 0.02], 'relaxed'), hk(1, 'well', [0, 0, 0], 'magGrab', 'out')],
        weapon: [pk(1, PCP, PCR)],
        events: [{ t: 1, ev: 'magToHand' }],
      },
    ],
  },
  // Pistol mag check: drop the mag partway (thumb on the release), tilt the gun to read the witness holes, push it
  // back up and slap it home (magSeat).
  magCheckOut: {
    calm: [
      {
        id: 'a',
        dur: 0.24,
        hit: 0.3,
        left: [
          hk(0.3, 'well', [0, -0.01, 0], 'magGrab', 'in'),
          hk(1, 'well', [0, -0.05, 0.004], 'magGrab', 'out'),
        ],
        weapon: [pk(1, add(PCP, [0, 0.01, 0.01]), add(PCR, [0.08, 0.05, -0.1]))],
        kick: { at: 'well', j: [0, -0.2, 0] },
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
          hk(0.5, 'well', [0.003, -0.053, 0.006], 'magGrab'),
          hk(1, 'well', [0, -0.05, 0.004], 'magGrab'),
        ],
        weapon: [
          pk(0.5, add(PCP, [0, 0.014, 0.01]), add(PCR, [0.1, 0.06, -0.12])),
          pk(1, add(PCP, [0, 0.01, 0.01]), add(PCR, [0.08, 0.05, -0.1])),
        ],
      },
    ],
  },
  magCheckIn: {
    calm: [
      {
        id: 'a',
        dur: 0.2,
        hit: 0.8,
        left: [hk(0.8, 'well', [0, -0.012, 0], 'magGrab', 'in'), hk(1, 'well', [0, -0.012, 0], 'magGrab')],
        weapon: [pk(1, WP, WR)],
      },
    ],
  },
  gripAdjust: {
    calm: [
      {
        id: 'rewrap',
        dur: 0.38,
        hit: 0.8,
        left: [
          hk(0.4, 'handguard', [-0.012, -0.012, 0.01], 'relaxed'),
          hk(1, 'handguard', [0, 0, 0], 'support'),
        ],
        weapon: [pk(0.4, [0, -0.004, 0.006], [-0.015, 0, 0.03]), pk(1)],
      },
      {
        id: 'squeeze',
        dur: 0.32,
        hit: 0.7,
        right: [hk(0.4, 'grip', [0.003, -0.006, 0.006], 'relaxed'), hk(1, 'grip', [0, 0, 0], 'grip')],
        weapon: [pk(0.4, [0, -0.005, 0.004], [-0.02, 0.005, -0.02]), pk(1)],
      },
    ],
  },
};
