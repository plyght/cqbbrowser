import type { Anchor, BeatLibrary, HandKey, PoseKey, V3 } from '../beats';
import type { HandPoseName } from '../handPoses';
import type { Ease } from '../tracks';

/** Terse key constructors for authoring. */
export const hk = (t: number, at: Anchor, p?: V3, pose?: HandPoseName, e?: Ease, r?: V3): HandKey => ({
  t,
  at,
  p,
  pose,
  e,
  r,
});
export const pk = (t: number, p?: V3, r?: V3, e?: Ease): PoseKey => ({ t, p, r, e });

export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

/** Beats shared by all weapon classes: camera fix (left hand to the chest cam) and grip readjusts. */
export const COMMON_BEATS: BeatLibrary = {
  // Mag check aborted before the mag left the well: let go of it and get back on the gun.
  checkRelease: {
    calm: [{ id: 'a', dur: 0.08, events: [{ t: 0, ev: 'magToWell' }] }],
  },
  camReach: {
    calm: [
      {
        id: 'a',
        dur: 0.34,
        hit: 0.95,
        left: [hk(0.55, 'chest', [-0.2, -0.02, -0.28], 'relaxed'), hk(1, 'cam', [0, 0, 0], 'cam', 'out')],
        weapon: [pk(1, [0.03, -0.07, 0.03], [-0.22, -0.04, 0.28])],
        events: [{ t: 0.95, ev: 'camGrab' }],
      },
      {
        id: 'b',
        dur: 0.3,
        hit: 0.95,
        left: [
          hk(0.5, 'chest', [-0.16, 0.04, -0.3], 'relaxed'),
          hk(1, 'cam', [0.005, 0.01, 0], 'cam', 'out'),
        ],
        weapon: [pk(1, [0.04, -0.08, 0.02], [-0.25, -0.02, 0.22])],
        events: [{ t: 0.95, ev: 'camGrab' }],
      },
    ],
  },
  camAdjust: {
    calm: [
      {
        id: 'a',
        dur: 0.4,
        hit: 0.45,
        left: [
          hk(0.45, 'cam', [0.004, 0.008, 0], 'cam', 'io', [0, 0, 0.14]),
          hk(1, 'cam', [0, 0.002, 0], 'cam', 'io', [0, 0, 0.04]),
        ],
        events: [{ t: 0.45, ev: 'camFix' }],
      },
      {
        id: 'b',
        dur: 0.34,
        hit: 0.5,
        left: [
          hk(0.5, 'cam', [-0.004, -0.006, 0], 'cam', 'io', [0, 0, -0.12]),
          hk(1, 'cam', [0, 0, 0], 'cam'),
        ],
        events: [{ t: 0.5, ev: 'camFix' }],
      },
    ],
  },
  camLetGo: {
    calm: [
      {
        id: 'a',
        dur: 0.32,
        left: [hk(0.4, 'cam', [-0.06, -0.08, -0.06], 'relaxed'), hk(1, 'handguard', [0, 0, 0], 'support')],
        weapon: [pk(1)],
        events: [{ t: 0.1, ev: 'camRelease' }],
      },
    ],
  },
};
