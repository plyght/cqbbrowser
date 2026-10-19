import type { Construction } from '../../weapons/ammo/types';
import type { Rng } from './rng';

/**
 * Bullet → steel momentum transfer (AR500 targets).
 *
 * The plate receives the bullet's normal momentum plus whatever bounces back: J = m·v·cosθ·(1 + e).
 * e is an effective coefficient of restitution of the splash (lead/jacket fragments sprayed back off the
 * face). Lead on hardened steel is an elastic-plastic impact, for which e falls with impact speed as
 * e ∝ v^(−1/4) (Johnson, *Contact Mechanics* §11.5); anchored at e = 0.30 for 400 m/s FMJ, which keeps it in
 * the 0.2–0.4 band measured for jacketed lead on hardened steel. Soft-nose/lead pancakes more (lower e); a
 * steel penetrator core rebounds a little more.
 */

const E_REF = 0.3;
const V_REF = 400;
const CONSTRUCTION_E: Record<Construction, number> = {
  fmj: 1,
  fmjSteelCore: 1.15,
  otm: 1,
  polytip: 0.9,
  jsp: 0.8,
  buck: 0.8,
  slug: 0.7,
};

/** Effective coefficient of restitution of a round on hard steel. */
export function restitution(speed: number, construction: Construction = 'fmj'): number {
  const e = E_REF * Math.pow(Math.max(50, speed) / V_REF, -0.25) * CONSTRUCTION_E[construction];
  return Math.min(0.45, Math.max(0.1, e));
}

/** Impulse (N·s) delivered to a steel target, along the bullet's path: m·v·cosθ·(1+e). */
export function steelImpulse(
  massKg: number,
  speed: number,
  cosIncidence = 1,
  construction: Construction = 'fmj',
): number {
  return massKg * speed * Math.max(0, cosIncidence) * (1 + restitution(speed, construction));
}

/** Same, from kinetic energy + mass (what the steel targets get from the hit router). */
export function steelImpulseFromEnergy(
  energyJ: number,
  massKg: number,
  cosIncidence = 1,
  construction: Construction = 'fmj',
): number {
  if (massKg <= 0 || energyJ <= 0) return 0;
  return steelImpulse(massKg, Math.sqrt((2 * energyJ) / massKg), cosIncidence, construction);
}

/**
 * Spall direction for fx: fragments leave in a thin cone hugging the plate face (3–20° off the surface),
 * biased toward the bullet's along-face motion (oblique hits spray "downstream"). `n` is the face normal
 * toward the shooter, `d` the bullet direction (unit). Writes a unit vector into `out` (any {x,y,z}).
 */
export function spallDir(
  d: { x: number; y: number; z: number },
  n: { x: number; y: number; z: number },
  rng: Rng,
  out: { x: number; y: number; z: number },
) {
  // Tangent basis on the face.
  const dn = d.x * n.x + d.y * n.y + d.z * n.z;
  let tx = d.x - dn * n.x,
    ty = d.y - dn * n.y,
    tz = d.z - dn * n.z;
  let tl = Math.hypot(tx, ty, tz);
  const oblique = Math.min(1, tl * 1.5);
  if (tl < 1e-4) {
    // Head-on: any tangent.
    tx = Math.abs(n.y) < 0.9 ? 0 : 1;
    ty = Math.abs(n.y) < 0.9 ? 1 : 0;
    tz = 0;
    const k = tx * n.x + ty * n.y + tz * n.z;
    tx -= k * n.x;
    ty -= k * n.y;
    tz -= k * n.z;
    tl = Math.hypot(tx, ty, tz);
  }
  tx /= tl;
  ty /= tl;
  tz /= tl;
  const bx = n.y * tz - n.z * ty,
    by = n.z * tx - n.x * tz,
    bz = n.x * ty - n.y * tx;
  // Azimuth: uniform around the hit, concentrated downstream for oblique hits.
  const spread = Math.PI * (1 - 0.75 * oblique);
  const az = (rng.next() * 2 - 1) * spread;
  const el = ((3 + 17 * rng.next()) * Math.PI) / 180;
  const ca = Math.cos(az),
    sa = Math.sin(az),
    ce = Math.cos(el),
    se = Math.sin(el);
  out.x = (tx * ca + bx * sa) * ce + n.x * se;
  out.y = (ty * ca + by * sa) * ce + n.y * se;
  out.z = (tz * ca + bz * sa) * ce + n.z * se;
  return out;
}
