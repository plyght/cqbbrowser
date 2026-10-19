import { Matrix4, Quaternion, Vector3, Euler, type Bone, type SkinnedMesh } from 'three';
import { solveTwoBone } from '../anim/ik';
import { HAND_POSES, POSE_SIZE } from '../anim/handPoses';
import { C, SkinBuilder, ball, box, camo, cloth, makeSkinned, tube } from './skin';

/** Arm segment lengths (m): shoulder→elbow, elbow→wrist. */
export const ARM = { upper: 0.31, fore: 0.29 };

/**
 * Hand frame (both sides): origin at the grasp centre (the axis the curled fingers wrap around), fingers along
 * -z, back of the hand +y, palm -y. Right hand's thumb is on -x, left hand's on +x (mirrored).
 */
export const WRIST = new Vector3(0, 0.034, 0.072);
const KNUCKLE_Y = 0.033;
const KNUCKLE_Z = -0.034;
const FINGERS = [
  { x: -0.029, len: [0.044, 0.026, 0.021], w: 0.0195, splay: 0.06 },
  { x: -0.0095, len: [0.048, 0.029, 0.023], w: 0.02, splay: 0.015 },
  { x: 0.0095, len: [0.045, 0.027, 0.022], w: 0.0195, splay: -0.03 },
  { x: 0.028, len: [0.036, 0.021, 0.019], w: 0.017, splay: -0.08 },
];
const THUMB = { x: -0.036, y: 0.02, z: 0.028, len: [0.04, 0.032, 0.026], w: 0.022 };

export const PALETTE = {
  sleeve: [0x8a7d5d, 0x6a6445, 0x9d9272, 0x4f4331],
  glove: 0x4f5440,
  knuckle: 0x26281f,
  palm: 0x5f5b48,
  cuff: 0x34362b,
};

const B_UPPER = 0,
  B_FORE = 1,
  B_HAND = 2,
  B_THUMB = 15;
const fingerBone = (f: number, j: number) => 3 + f * 3 + j;

function buildArm(s: 1 | -1) {
  const b = new SkinBuilder();
  const sleeve = camo(PALETTE.sleeve, 24, s > 0 ? 0 : 9);
  const glove = cloth(PALETTE.glove, 0.07, s);
  const knuckle = C(PALETTE.knuckle);
  // Upper arm sleeve + shoulder + elbow.
  b.add(tube(0.056, 0.047, 0.04, -ARM.upper, 14, 4), B_UPPER, sleeve);
  b.add(ball(0.056, 0, 0, 0.02, 12), B_UPPER, sleeve);
  b.add(ball(0.047, 0, 0, -ARM.upper, 12), B_UPPER, sleeve);
  // Forearm sleeve with a loose cuff over the glove.
  b.add(tube(0.048, 0.04, 0.0, -(ARM.fore - 0.045), 14, 4), B_FORE, sleeve);
  b.add(tube(0.044, 0.043, -(ARM.fore - 0.07), -(ARM.fore - 0.035), 14, 1), B_FORE, cloth(0x5d5640, 0.05));
  // Hand: glove cuff, palm, knuckle armour.
  const cuff = tube(0.041, 0.037, WRIST.z + 0.055, WRIST.z - 0.02, 12, 1, 0.85);
  cuff.translate(0, WRIST.y, 0);
  b.add(cuff, B_HAND, C(PALETTE.cuff));
  b.add(box(0.03, 0.006, 0.04, 0, WRIST.y + 0.035, WRIST.z + 0.01), B_HAND, C(0x222319));
  b.add(box(0.086, 0.03, 0.1, 0, 0.035, 0.017), B_HAND, (p, n) =>
    n.y < -0.5 ? C(PALETTE.palm) : glove(p, n),
  );
  b.add(box(0.078, 0.012, 0.028, 0, 0.054, -0.02), B_HAND, knuckle);
  b.add(box(0.05, 0.008, 0.035, s * 0.006, 0.053, 0.025), B_HAND, C(0x30322a));
  // Fingers.
  FINGERS.forEach((fd, f) => {
    for (let j = 0; j < 3; j++) {
      const l = fd.len[j];
      const w = fd.w * (1 - j * 0.06);
      b.add(box(w, 0.019 - j * 0.0012, l + 0.004, 0, 0, -l / 2), fingerBone(f, j), glove);
      if (j === 0) b.add(box(w * 0.95, 0.007, l * 0.6, 0, 0.011, -l * 0.45), fingerBone(f, j), knuckle);
      if (j === 2) b.add(ball(w * 0.5, 0, -0.001, -l, 6, 0.95), fingerBone(f, j), glove);
    }
  });
  for (let j = 0; j < 3; j++) {
    const l = THUMB.len[j];
    const w = THUMB.w * (1 - j * 0.08);
    b.add(box(w, 0.02, l + 0.004, 0, 0, -l / 2), B_THUMB + j, glove);
    if (j === 2) b.add(ball(w * 0.5, 0, 0, -l, 6), B_THUMB + j, glove);
  }
  return b.build();
}

const _m = new Matrix4();
const _l = new Matrix4();
const _q = new Quaternion();
const _e = new Euler(0, 0, 0, 'ZYX');
const _v = new Vector3();
const _up = new Vector3();
const _one = new Vector3(1, 1, 1);
const _wrist = new Vector3();
const _elbow = new Vector3();
const _end = new Vector3();

/** Procedural sleeved arm + tactical glove as one skinned mesh (1 draw call), driven by two-bone IK. */
export class ArmRig {
  readonly mesh: SkinnedMesh;
  readonly bones: Bone[];
  /** World inputs set by the caller each frame. */
  readonly shoulder = new Vector3();
  readonly pole = new Vector3();
  readonly handPos = new Vector3();
  readonly handQuat = new Quaternion();
  readonly curls = new Float32Array(POSE_SIZE);
  readonly elbow = new Vector3();
  reached = true;

  constructor(readonly side: 1 | -1) {
    const r = makeSkinned(buildArm(side), 18);
    this.mesh = r.mesh;
    this.bones = r.bones;
    this.curls.set(HAND_POSES.relaxed);
  }

  update() {
    const s = this.side;
    _wrist.copy(WRIST).applyQuaternion(this.handQuat).add(this.handPos);
    this.reached = solveTwoBone(this.shoulder, _wrist, this.pole, ARM.upper, ARM.fore, _elbow, _end);
    // Out of reach: the hand stays on the forearm rather than detaching from it.
    if (!this.reached) this.handPos.add(_end).sub(_wrist);
    this.elbow.copy(_elbow);

    // Upper arm & forearm: -z along the segment, +y roughly up / back-of-hand.
    _up.set(0, 1, 0).applyQuaternion(this.handQuat);
    setSegment(this.bones[B_UPPER], this.shoulder, _elbow, _up);
    setSegment(this.bones[B_FORE], _elbow, _end, _up);

    const hand = this.bones[B_HAND].matrixWorld;
    hand.compose(this.handPos, this.handQuat, _one);
    const c = this.curls;
    for (let f = 0; f < 4; f++) {
      const fd = FINGERS[f];
      _m.copy(hand);
      _e.set(c[f * 3], s * fd.splay, 0);
      mulTR(_m, s * fd.x, KNUCKLE_Y, KNUCKLE_Z, _e);
      this.bones[fingerBone(f, 0)].matrixWorld.copy(_m);
      for (let j = 1; j < 3; j++) {
        _e.set(c[f * 3 + j], 0, 0);
        mulTR(_m, 0, 0, -fd.len[j - 1], _e);
        this.bones[fingerBone(f, j)].matrixWorld.copy(_m);
      }
    }
    // Thumb: opposition swings it under the palm, joints curl it.
    _m.copy(hand);
    _e.set(-0.3 + c[13] * 0.3, s * 0.75, s * (0.35 + c[12]));
    mulTR(_m, s * THUMB.x, THUMB.y, THUMB.z, _e);
    this.bones[B_THUMB].matrixWorld.copy(_m);
    for (let j = 1; j < 3; j++) {
      _e.set(c[12 + j], 0, 0);
      mulTR(_m, 0, 0, -THUMB.len[j - 1], _e);
      this.bones[B_THUMB + j].matrixWorld.copy(_m);
    }
  }
}

/** m = m * T(x,y,z) * R(e). */
function mulTR(m: Matrix4, x: number, y: number, z: number, e: Euler) {
  _q.setFromEuler(e);
  _l.compose(_v.set(x, y, z), _q, _one);
  m.multiply(_l);
}

const _z = new Vector3();
const _x = new Vector3();
const _y = new Vector3();

/** Bone at `a` with -z pointing to `b`; +y as close to `up` as possible. */
export function setSegment(bone: Bone, a: Vector3, b: Vector3, up: Vector3) {
  _z.subVectors(a, b).normalize();
  _x.crossVectors(up, _z);
  if (_x.lengthSq() < 1e-8) _x.set(1, 0, 0).cross(_z);
  _x.normalize();
  _y.crossVectors(_z, _x);
  const m = bone.matrixWorld;
  m.makeBasis(_x, _y, _z);
  m.setPosition(a);
}
