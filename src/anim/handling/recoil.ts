/**
 * Recoil source for the handling sim. The ballistics engineer's `src/physics/ballistics/recoil.ts` will provide
 * `recoilFor(build | def)`; until it merges this local stub implements the same interface from the def.
 */
import type { WeaponDef } from '../../weapons/defs';

export interface RecoilSample {
  /** Seconds after ignition. */
  t: number;
  /** Rearward force fraction of the impulse delivered in this slice (sums to 1 over the profile). */
  fx: number;
  /** Extra muzzle-rise torque (N·m·s) delivered in this slice (muzzle devices, bolt carrier). */
  torque: number;
}

export interface RecoilProfile {
  /** Free-recoil momentum (N·s): bullet + powder gas, after muzzle devices. */
  impulseNs: number;
  profile: RecoilSample[];
  /** Bore axis height over the grip origin (m). */
  boreOffset: number;
}

/** Stub: momentum ≈ bullet momentum × 1.6 (gas jet), scaled by the build's rearward recoil multiplier. */
export function recoilFor(def: WeaponDef, boreY = 0.03): RecoilProfile {
  const bullet = (def.bulletMass / 1000) * def.velocity * (def.pellets ? 1.4 : 1);
  const impulseNs = bullet * 1.6 * def.recoil.back;
  // Bolt carrier / slide: most of the impulse in the first ~1 ms, a smaller kick when the action cycles.
  const rise = 0.08 * def.recoil.up;
  return {
    impulseNs,
    profile: [
      { t: 0, fx: 0.8, torque: rise * 0.5 },
      { t: 0.006, fx: 0.2, torque: rise * 0.5 },
    ],
    boreOffset: boreY,
  };
}
