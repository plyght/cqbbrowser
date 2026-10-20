import { Matrix4, Vector3, type Bone } from 'three';

/**
 * Bone-driven collision proxies of a first-person hand (canonical Mixamo arm/hand/finger bones, no mesh data):
 * a capsule per finger phalanx (bone → child bone; the distal one runs along the bone's +y for `TIP_LEN`), a
 * rounded palm box (hand bone → metacarpal heads) and a wrist capsule. Radii are glove radii measured on the
 * restyled Ch08 glove mesh (median vertex distance to the phalanx axis + ~1 mm; `tools/contact-audit.ts --fit`
 * reprints the measurement), so any body whose bones map 1:1 onto the Mixamo names reuses them.
 *
 * Everything is evaluated in the **weapon frame** (`update(toWeapon)`), where the weapon SDF lives.
 */
export const FINGERS = ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky'] as const;
export type Finger = (typeof FINGERS)[number];
export type Side = 'R' | 'L';

/** Outer glove radius per phalanx (proximal, middle, distal), metres. Thumb 1 is the thenar metacarpal. */
export const FINGER_R: Record<Finger, [number, number, number]> = {
  Thumb: [0.014, 0.011, 0.0095],
  Index: [0.0105, 0.0092, 0.0088],
  Middle: [0.011, 0.0095, 0.009],
  Ring: [0.0102, 0.0088, 0.0084],
  Pinky: [0.0092, 0.0076, 0.0073],
};
/** Distal phalanx axis length (tip sphere centre), metres. */
export const TIP_LEN: Record<Finger, number> = {
  Thumb: 0.017,
  Index: 0.016,
  Middle: 0.017,
  Ring: 0.016,
  Pinky: 0.013,
};
/** Palm box in the hand frame: u = wrist → middle knuckle, w = pinky → index, n = palm normal. */
export const PALM = { u0: -0.004, u1: 0.096, w0: -0.04, w1: 0.036, halfN: 0.016, r: 0.01 };
export const WRIST = { len: 0.05, r: 0.019 };
/** Palm normal = s · (u × w) points out of the palm (toward curled fingertips): measured at idle. */
const PALM_SIGN: Record<Side, number> = { R: -1, L: 1 };

export interface Phalanx {
  name: string;
  bone: Bone;
  finger: number;
  j: number;
  r: number;
  /** Weapon-frame endpoints (joint → next joint / tip). */
  a: Vector3;
  b: Vector3;
}

const _m = new Matrix4();
const _y = new Vector3();
const _u = new Vector3();
const _w = new Vector3();
const _n = new Vector3();

export class HandProxy {
  readonly hand: Bone;
  readonly chains: Phalanx[][] = [];
  readonly phalanges: Phalanx[] = [];
  /** Palm box frame (box-local → weapon) and its inverse; half extents (box frame: x = w, y = n, z = u). */
  readonly palm = new Matrix4();
  readonly palmInv = new Matrix4();
  readonly palmHalf = new Vector3((PALM.w1 - PALM.w0) / 2, PALM.halfN, (PALM.u1 - PALM.u0) / 2);
  /** Palm normal (out of the palm), finger axis u, across w (weapon frame). */
  readonly normal = new Vector3();
  readonly along = new Vector3();
  readonly across = new Vector3();
  readonly wristA = new Vector3();
  readonly wristB = new Vector3();
  /** Hand bone origin (wrist joint), weapon frame. */
  readonly origin = new Vector3();
  private readonly i1: Bone;
  private readonly p1: Bone;
  private readonly m1: Bone;
  private readonly fore: Bone;

  constructor(
    readonly side: Side,
    bone: (name: string) => Bone,
  ) {
    const s = side === 'R' ? 'Right' : 'Left';
    this.hand = bone(`${s}Hand`);
    this.fore = bone(`${s}ForeArm`);
    this.i1 = bone(`${s}HandIndex1`);
    this.p1 = bone(`${s}HandPinky1`);
    this.m1 = bone(`${s}HandMiddle1`);
    FINGERS.forEach((f, fi) => {
      const chain: Phalanx[] = [];
      for (let j = 0; j < 3; j++) {
        const ph: Phalanx = {
          name: `${side}.${f}${j + 1}`,
          bone: bone(`${s}Hand${f}${j + 1}`),
          finger: fi,
          j,
          r: FINGER_R[f][j],
          a: new Vector3(),
          b: new Vector3(),
        };
        chain.push(ph);
        this.phalanges.push(ph);
      }
      this.chains.push(chain);
    });
  }

  /** Recompute every proxy from the live bones; `toWeapon` = inverse weapon world matrix. */
  update(toWeapon: Matrix4) {
    for (let fi = 0; fi < 5; fi++) {
      const ch = this.chains[fi];
      for (let j = 0; j < 3; j++) {
        const p = ch[j];
        p.a.setFromMatrixPosition(p.bone.matrixWorld).applyMatrix4(toWeapon);
        if (j < 2) p.b.setFromMatrixPosition(ch[j + 1].bone.matrixWorld).applyMatrix4(toWeapon);
        else {
          _m.multiplyMatrices(toWeapon, p.bone.matrixWorld);
          _y.setFromMatrixColumn(_m, 1).normalize();
          p.b.copy(p.a).addScaledVector(_y, TIP_LEN[FINGERS[fi]]);
        }
      }
    }
    const o = this.origin.setFromMatrixPosition(this.hand.matrixWorld).applyMatrix4(toWeapon);
    _u.setFromMatrixPosition(this.m1.matrixWorld).applyMatrix4(toWeapon).sub(o).normalize();
    _w.setFromMatrixPosition(this.i1.matrixWorld).applyMatrix4(toWeapon);
    _y.setFromMatrixPosition(this.p1.matrixWorld).applyMatrix4(toWeapon);
    _w.sub(_y);
    _w.addScaledVector(_u, -_w.dot(_u)).normalize();
    _n.crossVectors(_u, _w).multiplyScalar(PALM_SIGN[this.side]);
    this.normal.copy(_n);
    this.along.copy(_u);
    this.across.copy(_w);
    // Box frame: x = w, y = n, z = u (right-handed up to the sign; the SDF only needs an orthonormal basis).
    this.palm.makeBasis(_w, _n, _u);
    const cu = (PALM.u0 + PALM.u1) / 2,
      cw = (PALM.w0 + PALM.w1) / 2;
    this.palm.setPosition(
      o.x + _u.x * cu + _w.x * cw,
      o.y + _u.y * cu + _w.y * cw,
      o.z + _u.z * cu + _w.z * cw,
    );
    this.palmInv.copy(this.palm).invert();
    // Wrist: back from the hand origin toward the elbow.
    _y.setFromMatrixPosition(this.fore.matrixWorld).applyMatrix4(toWeapon).sub(o).normalize();
    this.wristA.copy(o);
    this.wristB.copy(o).addScaledVector(_y, WRIST.len);
  }
}
