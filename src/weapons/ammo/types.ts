/**
 * Cartridge data model. Pure data (no three.js): consumed by interior ballistics (`./interior`), the flight
 * solver and terminal model (`src/physics/ballistics`), recoil, steel and audio (subsonic flag).
 */

export type AmmoId =
  'm193' | 'm855' | 'blk110' | 'blk220' | 'x39_123' | 'p9_124' | 'p9_147' | 'buck00' | 'slug12' | 'm357_158';

export type DragModel = 'G1' | 'G7';

/** Bullet construction: drives penetration, yaw/fragmentation and steel restitution. */
export type Construction = 'fmj' | 'fmjSteelCore' | 'otm' | 'polytip' | 'jsp' | 'buck' | 'slug';

/** Nose form: Poncelet nose coefficient for penetration in solids. */
export type Nose = 'spitzer' | 'roundNose' | 'flat' | 'sphere';

export interface Cartridge {
  id: AmmoId;
  name: string;
  /** Matches `WeaponDef.caliber` ('5.56', '300blk', '7.62x39', '9mm', '12ga', '.357'). */
  caliber: string;
  /** Mass of one projectile (one pellet for buckshot), grains. */
  bulletGr: number;
  /** Projectile diameter, metres. */
  diameter: number;
  /** Projectile length, metres (tumbling area ratio = length / diameter). */
  length: number;
  /** Ballistic coefficients, lb/in² (published). `drag` picks the one used by the solver. */
  bc: { G1: number; G7?: number };
  drag: DragModel;
  /** Powder charge, grains (gas ejecta for free recoil). */
  powderGr: number;
  /** Non-projectile ejecta leaving at muzzle velocity (shotgun wad), grains. */
  wadGr?: number;
  /** Projectiles per round (00 buck = 9). */
  pellets?: number;
  /**
   * Two published reference points (barrel inches → muzzle m/s). The interior model fits an adiabatic
   * expansion curve through them (see `interior.ts`), so any barrel length gets a velocity.
   */
  ref: [[number, number], [number, number]];
  /** Powder-gas exit velocity as a multiple of muzzle velocity (free-recoil gas term, ~1.5–1.75). */
  gasFactor: number;
  construction: Construction;
  nose: Nose;
  /**
   * Penetration depth (m) in 10% ordnance gel before the bullet yaws. Converted to areal density for the
   * terminal model: thin walls barely destabilize a bullet, a stud or several layers start it tumbling.
   */
  yawOnset: number;
  /** Fragments when tumbling above this speed (m/s), e.g. M193 ~760 m/s. Omit if it doesn't. */
  fragmentAbove?: number;
  /** Intrinsic ammo accuracy, MOA (extreme spread of a 5-shot group from a good barrel). */
  moa: number;
}
