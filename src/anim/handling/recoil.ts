/**
 * Recoil feel layer. The physics (`src/physics/ballistics/recoil.ts`) gives the real impulse packets of a build:
 * free-recoil momentum along the bore, muzzle-device jet, and the action's internal carrier/slide exchange
 * (unlock → bottom → slam) that shapes the timing. Real numbers are right but read as "nothing" on a screen:
 * a 3.8 kg carbine held by two arms and a shoulder rises ~0.3° per shot. This module scales them for feel.
 *
 * FEEL GAINS (documented, tune here):
 * - `back`: multiplier on every packet's rearward fx into the handling rigid body (linear kick you see).
 * - `lever` (m): extra rise lever per N·s of rearward fx — stands in for the shoulder/wrist pivot sitting below
 *   the bore line (the real source of muzzle flip for a held gun). Scaled by the def's `recoil.up` character.
 * - `side`: random yaw wander (N·m·s per N·s), scaled by `recoil.side`.
 * - Camera: the stock shoves the body; the chest cam pitches up and moves back through the body spring. Driven by
 *   free-recoil velocity V = I/M of the gun (m/s), rifle stock contact 1.0, pistol (arms only) 0.3.
 * - `fov`: ~1° punch for an SB-16, scaled by V.
 * - `climb`: aim-point walk per shot (rad) that stacks over a string and recovers with `climbHalfLife`.
 * Targets (see `handling.test.ts` table): SB-16 clearly visible but controllable; K-47S and P-17 snappier;
 * KP-9 and HB-300 softer.
 */
import type { WeaponDef } from '../../weapons/defs';
import { recoilFor as physicsRecoil, type RecoilProfile } from '../../physics/ballistics/recoil';

export type { RecoilProfile };

export interface RecoilFeel {
  /** Rearward fx multiplier into the rigid body. */
  back: number;
  /** Extra rise torque per N·s of rearward fx (m). */
  lever: number;
  /** Yaw wander scale (N·m·s per N·s, random sign per shot). */
  side: number;
  /** Chest-cam pitch impulse (rad/s, + = up) and rearward body shove (m/s). */
  camPitch: number;
  camShove: number;
  /** Camera roll / yaw jitter impulse amplitude (rad/s). */
  camJitter: number;
  /** FOV punch impulse (deg/s into a ~7 Hz spring → ≈ peak/0.016). */
  fov: number;
  /** Aim-point climb per shot (rad) and its recovery half-life (s). */
  climb: number;
  climbHalfLife: number;
  /** View (look direction) rise per shot, rad, and the share that returns on its own after the string. */
  view: number;
  viewRecover: number;
  /** Free-recoil velocity of the gun (m/s): the "how hard" number everything scales from. */
  velocity: number;
}

/** Global feel gains (see header). */
export const FEEL = {
  back: 2.6,
  lever: 0.3,
  side: 0.03,
  cam: 1.35,
  shove: 0.22,
  fovDegPerV: 1.6,
  climb: 0.009,
  /** View climb per shot (rad) for an SB-16-class carbine: moves where you look; you pull it back down. */
  view: 0.014,
};

const cache = new WeakMap<WeaponDef, { profile: RecoilProfile; feel: RecoilFeel }>();

/** Physics profile + feel gains for a def (cached). Every build gets a non-null profile. */
export function recoilFor(def: WeaponDef): { profile: RecoilProfile; feel: RecoilFeel } {
  let r = cache.get(def);
  if (r) return r;
  const profile = physicsRecoil(def);
  const pistol = def.slot === 'sidearm';
  const V = profile.impulseNs / Math.max(0.3, profile.gunMassKg);
  const up = def.recoil.up;
  const contact = pistol ? 0.3 : 1;
  const feel: RecoilFeel = {
    back: FEEL.back,
    lever: FEEL.lever * up * (pistol ? 0.27 : 1),
    side: FEEL.side * def.recoil.side,
    camPitch: FEEL.cam * V * contact * (0.7 + 0.3 * up),
    camShove: FEEL.shove * V * contact,
    camJitter: 0.05 * V * contact * (0.5 + def.recoil.roll),
    fov: (FEEL.fovDegPerV * Math.min(V, 2.2) * (pistol ? 0.6 : 1)) / 0.016,
    climb: FEEL.climb * up * Math.min(1.6, V / 1.36),
    climbHalfLife: pistol ? 0.12 : 0.16,
    view: FEEL.view * up * Math.min(1.8, V / 1.36) * (pistol ? 0.8 : 1),
    viewRecover: pistol ? 0.75 : 0.55,
    velocity: V,
  };
  r = { profile, feel };
  cache.set(def, r);
  return r;
}
