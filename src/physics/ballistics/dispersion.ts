import type { Cartridge } from '../../weapons/ammo/types';
import type { Rng } from './rng';

/**
 * Mechanical dispersion: where the barrel + ammo put rounds with a perfect hold. The *hold* (wobble, sway,
 * recoil recovery) belongs to the handling layer, which aims the emitted `shot.dir`; it can also inject
 * extra per-shot error via `Ballistics.hold`.
 *
 * MOA figures are extreme spreads of 5-shot groups. For a circular normal, the expected 5-shot extreme
 * spread is ≈ 3.0 σ (σ per axis), so σ = ES / 3.
 */

export const MOA = Math.PI / (180 * 60);

/** Combined mechanical accuracy (MOA ES) of a weapon (`weaponMoa`) shooting `c` from `inches` of barrel. */
export function mechanicalMoa(weaponMoa: number, c: Cartridge, inches: number): number {
  // Very short barrels whip a bit more and give less bore guidance.
  const shortness = 1 + Math.max(0, 8 - inches) * 0.03;
  return Math.hypot(weaponMoa, c.moa) * shortness;
}

/** Per-axis angular σ (rad) for an extreme-spread MOA. */
export const sigmaFromMoa = (moaEs: number) => (moaEs * MOA) / 3;

export type Choke = 'cylinder' | 'improved' | 'modified' | 'full';

/** Pattern diameter growth (inches per yard) holding ~90% of the pellets (buckshot rule of thumb). */
const CHOKE_IN_PER_YD: Record<Choke, number> = { cylinder: 1.0, improved: 0.8, modified: 0.65, full: 0.5 };

/** Per-axis σ (rad) for a shot pattern: R90 = σ·√(2 ln 10) ≈ 2.146 σ. */
export const chokeSigma = (choke: Choke) => CHOKE_IN_PER_YD[choke] / 36 / 2 / 2.146;

/**
 * Perturb unit vector `d` (in place) by a 2D normal angular error of σ per axis, in d's own frame.
 * Works on any {x,y,z}; no allocation.
 */
export function disperse(d: { x: number; y: number; z: number }, sigma: number, rng: Rng) {
  if (sigma <= 0) return d;
  // Basis perpendicular to d.
  let ux = -d.z,
    uy = 0,
    uz = d.x;
  let ul = Math.hypot(ux, uy, uz);
  if (ul < 1e-6) {
    ux = 1;
    uy = 0;
    uz = 0;
    ul = 1;
  }
  ux /= ul;
  uz /= ul;
  const vx = d.y * uz - d.z * uy,
    vy = d.z * ux - d.x * uz,
    vz = d.x * uy - d.y * ux;
  const a = rng.gauss() * sigma,
    b = rng.gauss() * sigma;
  d.x += ux * a + vx * b;
  d.y += uy * a + vy * b;
  d.z += uz * a + vz * b;
  const l = Math.hypot(d.x, d.y, d.z);
  d.x /= l;
  d.y /= l;
  d.z /= l;
  return d;
}
