/**
 * Pure steel rules (no three/rapier imports — unit tested).
 *
 * Poppers are calibrated on momentum, not energy: a 5.56 round carries a lot of energy but about the
 * same momentum as 9 mm, while a subsonic .300 BLK or a slug knocks over heavy steel easily.
 */

/** Momentum (N·s) of a projectile with kinetic energy `energyJ` and mass `massKg`. */
export function bulletMomentum(energyJ: number, massKg: number): number {
  return Math.sqrt(2 * Math.max(0, energyJ) * Math.max(0, massKg));
}

export interface Calibration {
  /** Height of the calibration line above the hinge, metres. Hits below it never knock the plate. */
  calHeight: number;
  /** Momentum (N·s) at the calibration line needed to knock it over. */
  threshold: number;
}

/**
 * Knockdown rule: the hit must be above the calibration line, and its momentum, scaled by lever arm
 * relative to the calibration line (higher hits topple more easily), must reach the threshold.
 */
export function knocksDown(momentum: number, hitHeight: number, cal: Calibration): boolean {
  if (hitHeight < cal.calHeight) return false;
  // Lever bonus is capped: the head of a popper is only so much easier to topple.
  const lever = cal.calHeight > 0 ? Math.min(1.3, hitHeight / cal.calHeight) : 1;
  return momentum * lever >= cal.threshold;
}

/** Popper presets (N·s). 9 mm 124 gr ≈ 2.7, 5.56 ≈ 3.2, .300 BLK sub ≈ 4.4, 7.62x39 ≈ 5.2. */
export const POPPER_STANDARD: Calibration = { calHeight: 0.62, threshold: 2.4 };
export const POPPER_HEAVY: Calibration = { calHeight: 0.62, threshold: 4.0 };
/** Rack plates and star plates: any solid hit on the plate face. */
export const PLATE_ANY: Calibration = { calHeight: 0, threshold: 1.0 };

/**
 * Angular speed (rad/s) a pendulum-like paddle needs to swing over the top from `restAngle`
 * (radians from vertical, centre of mass at radius `r`), with a safety factor.
 */
export function flipSpeed(restAngle: number, r: number, factor = 1.35, g = 9.81): number {
  return Math.sqrt((2 * g * (1 - Math.cos(restAngle))) / Math.max(0.05, r)) * factor;
}
