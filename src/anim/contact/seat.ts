import { Euler, Matrix4, Quaternion, Vector3 } from 'three';
import { PALM, WRIST, type HandProxy } from './handProxy';
import type { WeaponCollision } from './weaponCollision';

/**
 * Grip seat: the authored firing-hand clips were made around the pack's reference weapon, so on another
 * weapon's grip the hand sinks in (or floats). Once per weapon, with the rig at idle frame 0, find the rigid
 * correction S of the gun relative to the hand (translation + rotation about the grip socket) that minimises
 * firing-hand penetration (rigid body hard, fingers softer since they can still open) while keeping the palm
 * on the backstrap. Pattern search, ~0.3k cost evaluations, cached per weapon id.
 */

const SEATS = new Map<string, Matrix4>();

interface Pt {
  p: Vector3;
  r: number;
  w: number;
  palm: boolean;
  /** Wrap contact at the authored pose: keep it touching (two-sided). */
  contact: boolean;
  wrapper: boolean;
}

const _q = new Vector3();
const _m = new Matrix4();
const _mi = new Matrix4();
const _rot = new Quaternion();
const _e = new Euler();
const ONE = new Vector3(1, 1, 1);

function samples(h: HandProxy): Pt[] {
  const out: Pt[] = [];
  const r = PALM.halfN;
  const hx = h.palmHalf.x - r,
    hz = h.palmHalf.z - r;
  for (let i = 0; i < 5; i++)
    for (let j = 0; j < 4; j++)
      out.push({
        p: new Vector3(-hx + (2 * hx * j) / 3, 0, -hz + (2 * hz * i) / 4).applyMatrix4(h.palm),
        r,
        w: 1,
        palm: true,
        contact: false,
        wrapper: true,
      });
  for (let i = 0; i < 3; i++)
    out.push({
      p: h.wristA.clone().lerp(h.wristB, i / 2),
      r: WRIST.r,
      w: 1,
      palm: false,
      contact: false,
      wrapper: false,
    });
  for (const ph of h.phalanges) {
    // Fingers can still open around a thicker grip: only the knuckle (rigid) weighs like the palm.
    for (let i = 0; i < 4; i++)
      out.push({
        p: ph.a.clone().lerp(ph.b, i / 3),
        r: ph.r,
        w: ph.j === 0 ? (ph.finger === 0 && i < 2 ? 1 : 0.5) : 0.1,
        palm: false,
        contact: false,
        wrapper: false,
      });
  }
  return out;
}

/** S = T(c) · R · T(-c) · T(t). */
function seatMatrix(x: number[], c: Vector3, out: Matrix4) {
  _rot.setFromEuler(_e.set(x[3], x[4], x[5]));
  out.compose(_q.set(0, 0, 0), _rot, ONE);
  out.premultiply(_m.makeTranslation(c.x, c.y, c.z));
  out.multiply(_m.makeTranslation(-c.x + x[0], -c.y + x[1], -c.z + x[2]));
  return out;
}

function cost(col: WeaponCollision, pts: Pt[], x: number[], c: Vector3): number {
  seatMatrix(x, c, _mi).invert();
  let s = 0,
    palmGap = Infinity;
  for (const pt of pts) {
    _q.copy(pt.p).applyMatrix4(_mi);
    const d = col.sdf(_q, null, null, pt.r + 0.03) - pt.r;
    const pen = Math.max(0, 0.0005 - d) * 1000;
    s += pt.w * pen * pen;
    if (pt.contact) {
      const gap = Math.max(0, d - 0.0015) * 1000;
      s += 1.0 * gap * gap;
    }
    if (pt.palm) palmGap = Math.min(palmGap, d);
  }
  const g = Math.max(0, palmGap - 0.001) * 1000;
  s += 0.5 * g * g;
  const t = Math.hypot(x[0], x[1], x[2]) * 100; // cm
  const a = Math.hypot(x[3], x[4], x[5]) * 10; // 0.1 rad
  return s + 2 * t * t + 2 * a * a;
}

export function solveSeat(col: WeaponCollision, hand: HandProxy, pivot: Vector3, key: string): Matrix4 {
  const hit = SEATS.get(key);
  if (hit) return hit;
  const pts = samples(hand);
  // Samples the authored pose holds on (or in) a surface stay in contact: the seat moves the grip into the
  // authored wrap instead of pulling it out of the hand.
  for (const pt of pts) if (pt.wrapper && col.sdf(pt.p, null, null, 0.05) - pt.r < 0.012) pt.contact = true;
  const x = [0, 0, 0, 0, 0, 0];
  const steps = [0.006, 0.006, 0.006, 0.08, 0.05, 0.05];
  const lim = [0.02, 0.04, 0.03, 0.1, 0.06, 0.06];
  let best = cost(col, pts, x, pivot);
  for (let round = 0; round < 60; round++) {
    let improved = false;
    for (let k = 0; k < 6; k++)
      for (const sgn of [1, -1]) {
        const old = x[k];
        x[k] = Math.max(-lim[k], Math.min(lim[k], old + sgn * steps[k]));
        const c = cost(col, pts, x, pivot);
        if (c < best - 1e-9) {
          best = c;
          improved = true;
        } else x[k] = old;
      }
    if (!improved) {
      for (let k = 0; k < 6; k++) steps[k] *= 0.5;
      if (steps[0] < 0.0003) break;
    }
  }
  if (typeof process !== 'undefined' && process.env?.SEAT_DEBUG)
    console.log(
      'seat',
      key.slice(0, 6),
      x.map((v) => v.toFixed(3)).join(' '),
      'cost',
      cost(col, pts, [0, 0, 0, 0, 0, 0], pivot).toFixed(0),
      '->',
      best.toFixed(0),
    );
  const m = seatMatrix(x, pivot, new Matrix4());
  SEATS.set(key, m);
  return m;
}

export function clearSeats() {
  SEATS.clear();
}
