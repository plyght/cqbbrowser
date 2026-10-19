import type { V3 } from './beats';
import type { WeaponClass } from './data/sequences';

/**
 * Hold poses and arm geometry per weapon class (torso frame: chest camera at (-0.075, 0, -0.16), -z forward).
 * Tuned against chest-cam reference footage: rifle at high ready enters bottom-right with the rail running to
 * the aim point; ADS brings the sight line to the eye; pistol low-centre with both arms extended.
 */
export type HoldName = 'high' | 'ads' | 'low' | 'compressed' | 'sprint';
export interface Hold {
  /** Weapon root (grip) position, torso-local. */
  p: V3;
  /** Weapon-local [pitch, yaw, roll] offsets from the converged aim. */
  r: V3;
}

export interface ClassCfg {
  holds: Record<HoldName, Hold>;
  /** How far below the magwell mouth the support hand holds the mag. */
  graspDepth: number;
  shoulderR: V3;
  shoulderL: V3;
  /** Elbow pole directions (torso-local). */
  poleR: V3;
  poleL: V3;
  /** Holster / sling pose at the bottom of a weapon switch. */
  away: Hold;
  awayTime: number;
  drawTime: number;
  /** Fallback socket positions when a model lacks them. */
  sockets: Record<string, V3>;
  /** Hand bases [finger dir, back-of-hand dir] in the weapon frame. */
  gripBasis: [V3, V3];
  supportBasis: [V3, V3];
  /**
   * Shouldered builds index the stock to the shoulder pocket: the hold moves forward by this fraction of the
   * build's length of pull beyond `BUTT_REF` (a longer stock sits the gun further out). 0 = no stock.
   */
  buttFollow: number;
}

/** Butt-pad z (behind the grip) the rifle holds were authored for (SB-16 CQB). */
export const BUTT_REF = 0.288;

/** Torso-z shift of every hold for a build with butt pad at `buttZ` (m behind the grip). */
export function holdShiftZ(cfg: ClassCfg, buttZ: number | undefined): number {
  return buttZ === undefined ? 0 : -(buttZ - BUTT_REF) * cfg.buttFollow;
}

/**
 * Hold poses: authored against chest-cam reference footage, then refined by the anatomical hold optimiser
 * (`src/anim/grip/arm.ts` metrics over the solved grips of every preset build) so wrists and elbows stay in range.
 */
export const CFG: Record<WeaponClass, ClassCfg> = {
  rifle: {
    holds: {
      high: { p: [0.05, -0.135, -0.38], r: [0.03, 0.06, 0] },
      ads: { p: [-0.014, -0.015, -0.27], r: [0.084, 0, 0] },
      low: { p: [0.017, -0.239, -0.22], r: [-0.398, 0.11, 0.06] },
      compressed: { p: [0.04, -0.2, -0.22], r: [-0.12, 0, 0] },
      sprint: { p: [0.02, -0.25, -0.25], r: [-0.75, 0.55, -0.5] },
    },
    graspDepth: 0.065,
    shoulderR: [0.19, 0.02, -0.02],
    shoulderL: [-0.19, -0.04, -0.15],
    poleR: [0.45, -0.55, 0.15],
    poleL: [-0.3, -0.95, 0.1],
    away: { p: [0.07, -0.34, 0.1], r: [-1.05, 0.35, 0.75] },
    awayTime: 0.32,
    drawTime: 0.42,
    sockets: {
      gripRight: [0, -0.04, 0.042],
      gripLeft: [0, 0.03, -0.28],
      magwell: [0, -0.015, -0.06],
      chargingHandle: [0, 0.052, 0.098],
      boltCatch: [-0.027, 0.005, -0.02],
      slideRear: [0, 0.05, 0.05],
    },
    gripBasis: [
      [0, -0.34, -0.94],
      [1, 0, 0],
    ],
    supportBasis: [
      [0.8, 0.5, -0.33],
      [-0.5, -0.85, 0],
    ],
    buttFollow: 0.5,
  },
  pistol: {
    holds: {
      high: { p: [-0.055, -0.14, -0.55], r: [0, 0, 0] },
      ads: { p: [-0.078, -0.03, -0.61], r: [-0.06, -0.011, 0.03] },
      low: { p: [-0.05, -0.254, -0.487], r: [-0.6, 0, 0] },
      compressed: { p: [-0.01, -0.17, -0.3], r: [-0.1, 0, 0] },
      sprint: { p: [0.06, -0.28, -0.3], r: [-1.0, 0.15, 0] },
    },
    graspDepth: 0.012,
    shoulderR: [0.17, 0.06, -0.05],
    shoulderL: [-0.17, 0.06, -0.05],
    poleR: [0.45, -0.55, 0.05],
    poleL: [-0.45, -0.55, 0.05],
    away: { p: [0.14, -0.42, 0.26], r: [-1.3, 0, 0.2] },
    awayTime: 0.36,
    drawTime: 0.4,
    sockets: {
      gripRight: [0, -0.04, 0.012],
      gripLeft: [-0.022, -0.052, 0],
      magwell: [0, -0.105, 0.005],
      chargingHandle: [0, 0.03, 0.022],
      boltCatch: [-0.016, 0.0, -0.02],
      slideRear: [0, 0.03, 0.022],
    },
    gripBasis: [
      [0, -0.25, -0.97],
      [1, 0, 0],
    ],
    supportBasis: [
      [0.1, -0.25, -0.96],
      [-1, 0, 0.1],
    ],
    buttFollow: 0,
  },
};
