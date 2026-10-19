import type { Cartridge } from './types';

/**
 * Interior ballistics: muzzle velocity vs barrel length.
 *
 * Model: the powder gas does work on the bullet while expanding (near-)adiabatically down the bore. With an
 * effective initial gas column length `x0` (chamber volume / bore area, plus the burn still in progress), the
 * work done by the time the bullet has travelled L is
 *
 *     W(L) = W∞ · (1 − (x0 / (x0 + L))^(γ−1)),    γ ≈ 1.25 for propellant gas
 *
 * so v(L) = v∞ · sqrt(1 − (x0/(x0+L))^(γ−1)). Two published reference points per cartridge fix x0 and v∞
 * (bisection on x0, then v∞ follows). The curve has the right shape: big losses per inch when short, nearly
 * flat when long; slow-burning rifle loads get a large x0 (lose ~25–40 fps/in under 16"), fast pistol and
 * subsonic loads a tiny one (they're "done" in a few inches). The leftover expansion ratio also gives the
 * muzzle pressure (blast/flash) for free.
 */

const K = 0.25; // γ − 1
const GAMMA = 1.25;
export const GR = 6.479891e-5; // kg per grain
const IN = 0.0254;

export interface BarrelFit {
  /** Effective gas column length, inches. */
  x0: number;
  /** Asymptotic velocity (infinite barrel), m/s. */
  vInf: number;
}

const fits = new Map<string, BarrelFit>();

const f = (x0: number, L: number) => 1 - Math.pow(x0 / (x0 + L), K);

/** Fit (cached) x0 and v∞ through the cartridge's two reference points. */
export function barrelFit(c: Cartridge): BarrelFit {
  let fit = fits.get(c.id);
  if (fit) return fit;
  const [[l1, v1], [l2, v2]] = c.ref;
  const target = (v1 / v2) ** 2;
  // ratio(x0) = f(l1)/f(l2) moves monotonically from 1 (x0→0) to l1/l2 (x0→∞).
  let lo = 1e-4,
    hi = 400;
  const g = (x0: number) => f(x0, l1) / f(x0, l2) - target;
  const sLo = Math.sign(g(lo));
  for (let i = 0; i < 80; i++) {
    const mid = Math.sqrt(lo * hi);
    if (Math.sign(g(mid)) === sLo) lo = mid;
    else hi = mid;
  }
  const x0 = Math.sqrt(lo * hi);
  fit = { x0, vInf: v1 / Math.sqrt(f(x0, l1)) };
  fits.set(c.id, fit);
  return fit;
}

/** Muzzle velocity (m/s) from a barrel of `inches` (bolt face to muzzle). `mul` models ported barrels. */
export function muzzleVelocity(c: Cartridge, inches: number, mul = 1): number {
  const { x0, vInf } = barrelFit(c);
  return vInf * Math.sqrt(f(x0, Math.max(0.5, inches))) * mul;
}

/** Muzzle gas pressure relative to the same load from a 16" barrel (blast/flash/report scaling). */
export function muzzlePressureRel(c: Cartridge, inches: number): number {
  const { x0 } = barrelFit(c);
  const p = (L: number) => Math.pow(x0 / (x0 + L), GAMMA);
  return p(Math.max(0.5, inches)) / p(16);
}

/** Speed of sound (m/s) at `tempC` in dry air. */
export const soundSpeed = (tempC = 15) => 331.3 * Math.sqrt(1 + tempC / 273.15);

export interface MuzzleState {
  /** m/s */
  velocity: number;
  /** Projectile mass (one pellet), kg. */
  massKg: number;
  /** Muzzle energy of the whole round (all pellets), J. */
  energy: number;
  /** Projectile momentum of the whole round (all pellets), N·s. */
  momentum: number;
  /** Powder gas mass, kg. */
  gasKg: number;
  mach: number;
  /** Below the speed of sound: no supersonic crack (audio), no transonic buffeting. */
  subsonic: boolean;
  pressureRel: number;
}

export const projectileKg = (c: Cartridge) => c.bulletGr * GR;

/** Everything leaving the muzzle for a barrel length (inches). */
export function muzzleState(c: Cartridge, inches: number, velocityMul = 1, tempC = 15): MuzzleState {
  const v = muzzleVelocity(c, inches, velocityMul);
  const m = projectileKg(c);
  const n = c.pellets ?? 1;
  const mach = v / soundSpeed(tempC);
  return {
    velocity: v,
    massKg: m,
    energy: 0.5 * m * n * v * v,
    momentum: m * n * v,
    gasKg: c.powderGr * GR,
    mach,
    subsonic: mach < 1,
    pressureRel: muzzlePressureRel(c, inches),
  };
}

export const inchesOf = (metres: number) => metres / IN;
