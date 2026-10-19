/**
 * Pure steel rules (no three/rapier imports — unit tested).
 *
 * Poppers are calibrated on momentum transfer, not energy: a 5.56 round carries a lot of energy but about the
 * same momentum as 9 mm, while a subsonic .300 BLK or a slug knocks over heavy steel easily.
 *
 * The impulse a plate receives is J = m·v·cosθ·(1 + e) (`physics/ballistics/steel.ts`): the bullet's
 * momentum plus the splash bouncing back off the face (e ≈ 0.25–0.35 for jacketed lead on AR500). All
 * thresholds below are in that impulse (N·s).
 */
import { steelImpulseFromEnergy } from '../../physics/ballistics/steel';

export { steelImpulse, steelImpulseFromEnergy, restitution } from '../../physics/ballistics/steel';

/** Momentum (N·s) of a projectile with kinetic energy `energyJ` and mass `massKg`. */
export function bulletMomentum(energyJ: number, massKg: number): number {
  return Math.sqrt(2 * Math.max(0, energyJ) * Math.max(0, massKg));
}

/** Impulse (N·s) a steel target receives from a hit (router passes impact energy; mass from the shot). */
export const hitImpulse = (energyJ: number, massKg: number) => steelImpulseFromEnergy(energyJ, massKg);

export interface Calibration {
  /** Height of the calibration line above the hinge, metres. Hits below it never knock the plate. */
  calHeight: number;
  /** Impulse (N·s) at the calibration line needed to knock it over. */
  threshold: number;
}

/**
 * Knockdown rule: the hit must be above the calibration line, and its impulse, scaled by lever arm
 * relative to the calibration line (higher hits topple more easily), must reach the threshold.
 */
export function knocksDown(impulse: number, hitHeight: number, cal: Calibration): boolean {
  if (hitHeight < cal.calHeight) return false;
  // Lever bonus is capped: the head of a popper is only so much easier to topple.
  const lever = cal.calHeight > 0 ? Math.min(1.3, hitHeight / cal.calHeight) : 1;
  return impulse * lever >= cal.threshold;
}

/**
 * Popper presets (impulse, N·s), with the default builds' loads at 9 m:
 * P-17 9 mm 124 gr ≈ 3.7, KP-9 9 mm ≈ 4.0, SB-16 M855 ≈ 4.0, HB-300 220 gr sub ≈ 5.5, K-47S ≈ 6.3
 * (`bun tools/ballistics-table.ts`). Standard falls to any 9 mm above the line; heavy needs ~major power
 * factor: .300 BLK sub / 7.62x39 drop it at the line, 9 mm and 5.56 only ring it (a KP-9 head hit at the
 * 1.3× lever cap is ~1% shy — barrel length matters, PRD §8.1).
 */
export const POPPER_STANDARD: Calibration = { calHeight: 0.62, threshold: 3.1 };
export const POPPER_HEAVY: Calibration = { calHeight: 0.62, threshold: 5.2 };
/** Rack plates and star plates: any solid hit on the plate face. */
export const PLATE_ANY: Calibration = { calHeight: 0, threshold: 1.3 };
/** Dueling-tree paddle: impulse that swings it over the top. */
export const PADDLE_FLIP = 1.55;

/**
 * Angular speed (rad/s) a pendulum-like paddle needs to swing over the top from `restAngle`
 * (radians from vertical, centre of mass at radius `r`), with a safety factor.
 */
export function flipSpeed(restAngle: number, r: number, factor = 1.35, g = 9.81): number {
  return Math.sqrt((2 * g * (1 - Math.cos(restAngle))) / Math.max(0.05, r)) * factor;
}
