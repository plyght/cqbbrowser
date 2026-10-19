import type { Surface } from '../../core/bus';
import { GR } from '../../weapons/ammo/interior';
import type { Cartridge, Construction, Nose } from '../../weapons/ammo/types';

/**
 * Terminal ballistics: perforation of building materials, ricochet and exit deflection.
 *
 * Penetration uses the Poncelet resistance law, the classic engineering model for projectiles in solids:
 *
 *     m · dv/dx = −A · (σ + ½ · ρ · Cn · v²)
 *
 * σ = material's dynamic flow strength (Pa), ρ its density, Cn a nose coefficient, A the presented area.
 * Its closed form over a slab of path x (B = ½ρCn·A/m, S = σA/m):
 *
 *     v(x)² = (v0² + S/B) · e^(−2Bx) − S/B,      stop depth = ln(1 + B·v0²/S) / (2B)
 *
 * It's velocity-dependent (the ρv² term) and caliber-dependent (A/m = 1/sectional density) for free. Bullets
 * yaw as they push through dense material (`yawOnset` areal density, from gel data): the presented area
 * grows toward length × diameter, so a 5.56 that went through a stud tumbles and slows hard, and keyholes
 * on whatever it hits next. Fast thin-jacketed bullets fragment once tumbling above their threshold.
 */

export type MaterialId =
  | 'drywall'
  | 'plywood'
  | 'door'
  | 'pine'
  | 'concrete'
  | 'brick'
  | 'ar500'
  | 'mildSteel'
  | 'cardboard'
  | 'dirt'
  | 'carBody';

export interface Material {
  id: MaterialId;
  name: string;
  /** kg/m³ (effective, for layered/hollow parts). */
  density: number;
  /** Dynamic flow strength σ, Pa. */
  strength: number;
  /** Never perforated (hardened steel): rounds shatter, spall and ricochet. */
  hard?: boolean;
  /** Critical grazing angle (deg from the surface) at 400 m/s; below it rounds skip. */
  ricochetDeg: number;
  /** Exit deflection scale (rad) for a round that lost all its speed in it. */
  roughness: number;
  /** Typical thickness for tables (m). */
  thickness: number;
  /** How much faster than gel it destabilizes a bullet (rigid media tip bullets over sooner). */
  yawRate: number;
}

export const MATERIALS: Record<MaterialId, Material> = {
  drywall: {
    id: 'drywall',
    name: '1/2" drywall',
    density: 700,
    strength: 4e6,
    ricochetDeg: 3,
    roughness: 0.05,
    thickness: 0.0127,
    yawRate: 2,
  },
  plywood: {
    id: 'plywood',
    name: '12 mm plywood',
    density: 560,
    strength: 1.8e7,
    ricochetDeg: 4,
    roughness: 0.06,
    thickness: 0.012,
    yawRate: 3,
  },
  door: {
    id: 'door',
    name: 'hollow-core door',
    density: 220,
    strength: 8e6,
    ricochetDeg: 4,
    roughness: 0.05,
    thickness: 0.035,
    yawRate: 2,
  },
  pine: {
    id: 'pine',
    name: 'pine 2x4 (across)',
    density: 500,
    strength: 4.5e7,
    ricochetDeg: 5,
    roughness: 0.08,
    thickness: 0.038,
    yawRate: 3,
  },
  concrete: {
    id: 'concrete',
    name: 'poured concrete',
    density: 2300,
    strength: 4e8,
    ricochetDeg: 18,
    roughness: 0.2,
    thickness: 0.1,
    yawRate: 4,
  },
  brick: {
    id: 'brick',
    name: 'clay brick',
    density: 1900,
    strength: 2.2e8,
    ricochetDeg: 15,
    roughness: 0.2,
    thickness: 0.09,
    yawRate: 4,
  },
  ar500: {
    id: 'ar500',
    name: 'AR500 steel',
    density: 7850,
    strength: 1.6e9,
    hard: true,
    ricochetDeg: 22,
    roughness: 0.3,
    thickness: 0.0095,
    yawRate: 4,
  },
  mildSteel: {
    id: 'mildSteel',
    name: 'mild steel',
    density: 7850,
    strength: 9e8,
    ricochetDeg: 14,
    roughness: 0.2,
    thickness: 0.004,
    yawRate: 4,
  },
  carBody: {
    id: 'carBody',
    name: 'car body panel',
    density: 7850,
    strength: 9e8,
    ricochetDeg: 10,
    roughness: 0.15,
    thickness: 0.0008,
    yawRate: 4,
  },
  cardboard: {
    id: 'cardboard',
    name: 'cardboard target',
    density: 600,
    strength: 1.5e6,
    ricochetDeg: 1,
    roughness: 0.01,
    thickness: 0.004,
    yawRate: 1,
  },
  dirt: {
    id: 'dirt',
    name: 'packed dirt berm',
    density: 1700,
    strength: 3e6,
    ricochetDeg: 9,
    roughness: 0.3,
    thickness: 1,
    yawRate: 1.5,
  },
};

/** Surface tag (+ optional authored material thickness) → material. */
export function materialFor(surface: Surface, penetrable?: number): Material {
  switch (surface) {
    case 'drywall':
      return MATERIALS.drywall;
    case 'plywood':
      return MATERIALS.plywood;
    case 'wood':
      // Doors are authored as ~35 mm penetrable wood; posts/lumber are solid.
      return penetrable && penetrable > 0.02 && penetrable < 0.06 ? MATERIALS.door : MATERIALS.pine;
    case 'steel_target':
      return MATERIALS.ar500;
    case 'metal':
      return MATERIALS.mildSteel;
    case 'paper_target':
      return MATERIALS.cardboard;
    case 'dirt':
    case 'berm':
    case 'gravel':
    case 'grass':
      return MATERIALS.dirt;
    default:
      return MATERIALS.concrete;
  }
}

// ---------------------------------------------------------------- projectile state

const NOSE_CN: Record<Nose, number> = { spitzer: 0.55, roundNose: 0.75, flat: 0.95, sphere: 0.8 };
/** Ricochet tendency by nose: round/spherical noses skip more, flat noses dig in. */
const NOSE_RIC: Record<Nose, number> = { spitzer: 1, roundNose: 1.2, flat: 0.8, sphere: 1.35 };

/** Mutable per-round terminal state (pooled by the router; no allocation per hit). */
export interface Projectile {
  massKg: number;
  diameter: number;
  /** m/s */
  speed: number;
  /** 0 = point forward, 1 = fully tumbling. */
  yaw: number;
  fragmented: boolean;
  nose: Nose;
  construction: Construction;
  /** kg/m² of material before it starts to yaw. */
  yawAreal: number;
  /** Length / diameter: presented-area ratio when tumbling. */
  lenRatio: number;
  fragmentAbove: number;
}

export const newProjectile = (): Projectile => ({
  massKg: 0,
  diameter: 0,
  speed: 0,
  yaw: 0,
  fragmented: false,
  nose: 'spitzer',
  construction: 'fmj',
  yawAreal: 100,
  lenRatio: 2,
  fragmentAbove: Infinity,
});

export function initProjectile(p: Projectile, c: Cartridge, speed: number): Projectile {
  p.massKg = c.bulletGr * GR;
  p.diameter = c.diameter;
  p.speed = speed;
  p.yaw = 0;
  p.fragmented = false;
  p.nose = c.nose;
  p.construction = c.construction;
  p.yawAreal = c.yawOnset * 1000; // 10% gel ≈ 1000 kg/m³
  p.lenRatio = Math.max(1, c.length / c.diameter);
  p.fragmentAbove = c.fragmentAbove ?? Infinity;
  return p;
}

export const energyOf = (p: Projectile) => 0.5 * p.massKg * p.speed * p.speed;

/** Presented area (m²) for the current yaw (smoothstep from nose-on to side-on). */
export function presentedArea(p: Projectile): number {
  const a = (Math.PI / 4) * p.diameter * p.diameter;
  const y = p.yaw * p.yaw * (3 - 2 * p.yaw);
  return a * (1 + (p.lenRatio - 1) * 0.8 * y) * (p.fragmented ? 1.4 : 1);
}

/** Air-drag multiplier for a yawed/tumbling bullet. */
export const tumbleDrag = (p: Projectile) => 1 + 2.5 * p.yaw * p.yaw;

// ---------------------------------------------------------------- perforation

export interface PenResult {
  stopped: boolean;
  /** Exit speed (0 if stopped). */
  speedOut: number;
  /** Depth reached if stopped (m along the path). */
  depth: number;
}

const PEN: PenResult = { stopped: false, speedOut: 0, depth: 0 };

/**
 * Push `p` through `path` metres of `m` (sub-slabs so yaw can grow). Mutates `p.speed`, `yaw`, mass on
 * fragmentation. Returns a shared result record (copy what you need).
 */
export function perforate(p: Projectile, m: Material, path: number, out: PenResult = PEN): PenResult {
  out.stopped = false;
  out.depth = 0;
  if (m.hard) {
    out.stopped = true;
    out.speedOut = 0;
    p.speed = 0;
    return out;
  }
  const n = Math.min(80, Math.max(1, Math.ceil(path / 0.015)));
  const dx = path / n;
  let v = p.speed;
  for (let i = 0; i < n; i++) {
    const A = presentedArea(p);
    const B = (0.5 * m.density * NOSE_CN[p.nose] * A) / p.massKg;
    const S = (m.strength * A) / p.massKg;
    const e = Math.exp(-2 * B * dx);
    const v2 = (v * v + S / B) * e - S / B;
    if (v2 <= 0) {
      out.depth += Math.log(1 + (B * v * v) / S) / (2 * B);
      out.stopped = true;
      v = 0;
      break;
    }
    v = Math.sqrt(v2);
    out.depth += dx;
    p.yaw = Math.min(1, p.yaw + (m.density * m.yawRate * dx) / p.yawAreal);
    if (!p.fragmented && p.yaw > 0.6 && v > p.fragmentAbove) {
      // Jacket splits at the cannelure; the front half carries on as the main fragment.
      p.fragmented = true;
      p.massKg *= 0.55;
    }
  }
  p.speed = v;
  out.speedOut = v;
  return out;
}

/** Depth (m) the projectile would reach in a semi-infinite block of `m` (doesn't mutate `p`). */
export function penetrationDepth(p: Projectile, m: Material): number {
  if (m.hard) return 0;
  const save = { ...p };
  const r = perforate(p, m, 1.2);
  const d = r.stopped ? r.depth : 1.2;
  Object.assign(p, save);
  return d;
}

// ---------------------------------------------------------------- ricochet

/** Critical grazing angle (rad) for this round on `m`. Faster rounds dig in a little more. */
export function criticalAngle(p: Projectile, m: Material): number {
  const vf = Math.min(1.4, Math.max(0.6, Math.sqrt(400 / Math.max(50, p.speed))));
  return ((m.ricochetDeg * Math.PI) / 180) * vf * NOSE_RIC[p.nose] * (p.yaw > 0.5 ? 0.7 : 1);
}

/**
 * Does a round arriving at grazing angle `graze` (rad, 0 = skimming the surface) ricochet? `r` ∈ [0,1)
 * jitters the threshold ±15% so the boundary isn't a hard line.
 */
export const ricochets = (p: Projectile, m: Material, graze: number, r: number) =>
  graze < criticalAngle(p, m) * (0.85 + 0.3 * r);

export interface Ricochet {
  /** Departure angle above the surface (rad). */
  angle: number;
  /** Fraction of the speed kept. */
  keep: number;
}

const RIC: Ricochet = { angle: 0, keep: 0 };

/**
 * Departure of a ricochet: rounds leave flatter than they arrive (≈ 0.3–0.6× the incidence; the classic
 * "skips a few cm above the floor") and keep more speed the shallower they came in.
 */
export function ricochetOut(p: Projectile, m: Material, graze: number, r: number, out: Ricochet = RIC) {
  const crit = Math.max(1e-3, criticalAngle(p, m));
  out.angle = graze * (0.3 + 0.3 * r);
  out.keep = (m.hard ? 0.55 : 0.75) * (1 - 0.5 * Math.min(1, graze / crit));
  return out;
}

/** Exit deflection std-dev (rad): rougher/slower exits wander more; tumbling rounds wander most. */
export function exitDeflection(m: Material, speedIn: number, speedOut: number, yaw: number): number {
  const lost = speedIn > 0 ? 1 - speedOut / speedIn : 1;
  return m.roughness * Math.sqrt(Math.max(0, lost)) + 0.04 * yaw;
}
