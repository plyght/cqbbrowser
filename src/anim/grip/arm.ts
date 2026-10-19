import { Euler, Matrix4, Quaternion, Vector3 } from 'three';
import { solveTwoBone } from '../ik';
import type { ClassCfg, HoldName } from '../holds';
import { WRIST } from './hand';

export const ARM_LEN = { upper: 0.31, fore: 0.29 };

/** Anatomical limits (deg) and IK tolerance (m). */
export const ARM_LIMITS = {
  reach: 0.002,
  wristFlex: 70,
  wristExt: 60,
  ulnar: 30,
  radial: 20,
  elbowMin: 30,
  elbowMax: 150,
};

export interface ArmMetrics {
  /** IK reach error (m). */
  reach: number;
  /** Elbow flexion (deg, 0 = straight). */
  elbow: number;
  /** Wrist: + extension / − flexion (deg). */
  flex: number;
  /** Wrist: + radial / − ulnar deviation (deg). */
  dev: number;
  /** Elbow below the shoulder (m, along the torso up). */
  drop?: number;
}

/** An arm in the weapon frame for one hold: shoulder joint and the natural elbow direction. */
export interface ArmContext {
  shoulder: Vector3;
  natural: Vector3;
  /** Torso up in this frame. */
  up: Vector3;
}

const deg = 180 / Math.PI;
const _w = new Vector3();
const _e = new Vector3();
const _end = new Vector3();
const _pole = new Vector3();
const _u = new Vector3();
const _f = new Vector3();
const _d = new Vector3();
const _inv = new Matrix4();

/** Wrist angles for an elbow position (forearm elbow → wrist end) against a hand frame. */
function wristAngles(
  elbow: Vector3,
  end: Vector3,
  hand: Matrix4,
  side: number,
  out: { flex: number; dev: number },
) {
  _inv.extractRotation(hand).invert();
  _d.subVectors(elbow, end).normalize().applyMatrix4(_inv);
  out.flex = Math.atan2(_d.y, _d.z) * deg;
  out.dev = Math.atan2(-side * _d.x, _d.z) * deg;
  return out;
}

const _n = new Vector3();
const _a0 = new Vector3();
const _b0 = new Vector3();
const _wa = { flex: 0, dev: 0 };

/**
 * Elbow swivel (the arm's free DOF): search the circle of elbow positions for the one that keeps the wrist in
 * range and the elbow hanging below the shoulder (along `up`), preferring the natural "down and out" pole.
 * Writes a pole point into `out` for `solveTwoBone`.
 */
export function armSwivel(
  shoulder: Vector3,
  wrist: Vector3,
  hand: Matrix4,
  natural: Vector3,
  up: Vector3,
  side: 1 | -1,
  out: Vector3,
  avoid?: Vector3,
  avoidR = 0,
): Vector3 {
  _n.subVectors(wrist, shoulder).normalize();
  _a0.copy(natural).addScaledVector(_n, -natural.dot(_n));
  if (_a0.lengthSq() < 1e-8) _a0.copy(up).negate().addScaledVector(_n, up.dot(_n));
  _a0.normalize();
  _b0.crossVectors(_n, _a0);
  let best = Infinity;
  const L = ARM_LIMITS;
  for (let i = -12; i < 12; i++) {
    const th = (i / 12) * Math.PI;
    _pole.copy(shoulder).addScaledVector(_a0, Math.cos(th)).addScaledVector(_b0, Math.sin(th));
    solveTwoBone(shoulder, wrist, _pole, ARM_LEN.upper, ARM_LEN.fore, _e, _end);
    const w = wristAngles(_e, _end, hand, side, _wa);
    const drop = _f.subVectors(shoulder, _e).dot(up);
    const c =
      Math.max(0, w.flex - L.wristExt + 5) +
      Math.max(0, -L.wristFlex + 5 - w.flex) +
      Math.max(0, w.dev - L.radial + 5) +
      Math.max(0, -L.ulnar + 5 - w.dev) +
      Math.max(0, 0.1 - drop) * 400 +
      Math.abs(th) * 4 +
      (avoid
        ? Math.max(0, avoidR - Math.min(segDist(avoid, shoulder, _e), segDist(avoid, _e, _end))) * 600
        : 0);
    if (c < best) {
      best = c;
      out.copy(_pole);
    }
  }
  return out;
}

const _sd = new Vector3();
const _sf = new Vector3();
/** Distance from `p` to the segment a–b. */
export function segDist(p: Vector3, a: Vector3, b: Vector3): number {
  _sd.subVectors(b, a);
  const l2 = _sd.lengthSq();
  const t = l2 > 0 ? Math.min(1, Math.max(0, _sd.dot(_sf.subVectors(p, a)) / l2)) : 0;
  return _sf.copy(a).addScaledVector(_sd, t).distanceTo(p);
}

/** Two-bone IK to a hand frame (all in one frame, elbow swivel searched) and the resulting joint angles. */
export function armMetrics(
  shoulder: Vector3,
  natural: Vector3,
  hand: Matrix4,
  side: 1 | -1,
  up = UP,
): ArmMetrics {
  _w.copy(WRIST).applyMatrix4(hand);
  armSwivel(shoulder, _w, hand, natural, up, side, _pole2);
  solveTwoBone(shoulder, _w, _pole2, ARM_LEN.upper, ARM_LEN.fore, _e, _end);
  _u.subVectors(_e, shoulder).normalize();
  _f.subVectors(_end, _e).normalize();
  const elbow = Math.acos(Math.min(1, Math.max(-1, _u.dot(_f)))) * deg;
  const w = wristAngles(_e, _end, hand, side, _wa);
  return {
    reach: _end.distanceTo(_w),
    elbow,
    flex: w.flex,
    dev: w.dev,
    drop: _f.subVectors(shoulder, _e).dot(up),
  };
}

const UP = new Vector3(0, 1, 0);
const _pole2 = new Vector3();

/** Sum of limit excesses (deg; reach in mm). 0 = anatomically fine. `margin` (deg) tightens the ranges. */
export function armViolation(m: ArmMetrics, margin = 0): number {
  const L = ARM_LIMITS;
  return (
    Math.max(0, m.reach - L.reach) * 1000 +
    Math.max(0, L.elbowMin + margin - m.elbow) +
    Math.max(0, m.elbow - L.elbowMax + margin) +
    Math.max(0, m.flex - L.wristExt + margin) +
    Math.max(0, -L.wristFlex + margin - m.flex) +
    Math.max(0, m.dev - L.radial + margin) +
    Math.max(0, -L.ulnar + margin - m.dev) +
    Math.max(0, 0.05 - (m.drop ?? 1)) * 1000
  );
}

export const VALIDATED_HOLDS: HoldName[] = ['high', 'ads', 'low', 'compressed'];

/** Arm contexts (weapon frame) for each validated hold of a class. ADS draws the right shoulder in. */
export function armContexts(cfg: ClassCfg, side: 1 | -1, dz = 0): ArmContext[] {
  return VALIDATED_HOLDS.map((pose) => {
    const h = cfg.holds[pose];
    const ads = pose === 'ads' ? 1 : 0;
    const weaponInv = new Matrix4()
      .compose(
        new Vector3(h.p[0], h.p[1], h.p[2] + dz),
        new Quaternion().setFromEuler(new Euler(h.r[0], h.r[1], h.r[2], 'YXZ')),
        new Vector3(1, 1, 1),
      )
      .invert();
    const sh = side > 0 ? cfg.shoulderR : cfg.shoulderL;
    const shoulder = new Vector3(sh[0] - (side > 0 ? ads * 0.03 : 0), sh[1], sh[2] - ads * 0.02).applyMatrix4(
      weaponInv,
    );
    const natural = new Vector3(...(side > 0 ? cfg.poleR : cfg.poleL)).transformDirection(weaponInv);
    const up = new Vector3(0, 1, 0).transformDirection(weaponInv);
    return { shoulder, natural, up };
  });
}
