import { Euler, Matrix4, Quaternion, Vector3 } from 'three';

/**
 * Hand template shared by the rendered rig (body/ArmRig) and the grip solver. Hand frame: origin at the grasp
 * centre, fingers along -z, back of the hand +y, palm -y; the right hand's thumb is on -x (left: mirrored, s=-1).
 * Finger curls: 15 floats — index, middle, ring, pinky as [knuckle, mid, tip] (negative = toward the palm), then
 * thumb [oppose, base, tip].
 */
export const WRIST = new Vector3(0, 0.034, 0.072);
export const KNUCKLE_Y = 0.035;
export const KNUCKLE_Z = -0.034;
export const FINGERS = [
  { x: -0.029, len: [0.044, 0.026, 0.021], r: 0.0098, splay: 0.06 },
  { x: -0.0095, len: [0.048, 0.029, 0.023], r: 0.0102, splay: 0.015 },
  { x: 0.0095, len: [0.045, 0.027, 0.022], r: 0.0097, splay: -0.03 },
  { x: 0.028, len: [0.036, 0.021, 0.019], r: 0.0086, splay: -0.08 },
];
export const THUMB = { x: -0.037, y: 0.03, z: 0.026, len: [0.04, 0.032, 0.026], r: 0.0112 };
/** Palm block (rounded box): centre, half extents, corner radius. Palm surface at y = PALM.c.y - PALM.h.y. */
export const PALM = { c: new Vector3(0, 0.036, 0.016), h: new Vector3(0.044, 0.016, 0.052), r: 0.013 };
/** Glove thickness is part of the rendered finger radii (≈4 mm over the skin). */
export const GLOVE = 0.004;
/** Web of the hand (thumb–index crotch), right hand; mirror x for the left. */
export const WEB = new Vector3(-0.036, 0.009, 0.018);

/** Bone ids in the arm skeleton (fingers 4.., thumb 16..18). */
export const fingerBone = (f: number, j: number) => 4 + f * 3 + j;
export const THUMB_BONE = 16;
export const N_BONES = 19;

const _m = new Matrix4();
const _l = new Matrix4();
const _q = new Quaternion();
const _e = new Euler(0, 0, 0, 'ZYX');
const _v = new Vector3();
const _one = new Vector3(1, 1, 1);

/** m = m * T(x,y,z) * R(e). */
function mulTR(m: Matrix4, x: number, y: number, z: number, e: Euler) {
  _q.setFromEuler(e);
  _l.compose(_v.set(x, y, z), _q, _one);
  m.multiply(_l);
}

/** Finger/thumb forward kinematics from a hand matrix; writes joint matrices into `out[boneId]`. */
export function fingerFK(hand: Matrix4, s: number, c: ArrayLike<number>, out: Matrix4[]) {
  for (let f = 0; f < 4; f++)
    fingerChainFK(hand, s, f, c[f * 3], c[f * 3 + 1], c[f * 3 + 2], out, f === 0 ? (c[15] ?? 0) : 0);
  thumbFK(hand, s, c[12], c[13], c[14], out);
}

export function fingerChainFK(
  hand: Matrix4,
  s: number,
  f: number,
  a0: number,
  a1: number,
  a2: number,
  out: Matrix4[],
  abduct = 0,
) {
  const fd = FINGERS[f];
  _m.copy(hand);
  _e.set(a0, s * (fd.splay + abduct), 0);
  mulTR(_m, s * fd.x, KNUCKLE_Y, KNUCKLE_Z, _e);
  out[fingerBone(f, 0)].copy(_m);
  _e.set(a1, 0, 0);
  mulTR(_m, 0, 0, -fd.len[0], _e);
  out[fingerBone(f, 1)].copy(_m);
  _e.set(a2, 0, 0);
  mulTR(_m, 0, 0, -fd.len[1], _e);
  out[fingerBone(f, 2)].copy(_m);
}

export function thumbFK(hand: Matrix4, s: number, oppose: number, a1: number, a2: number, out: Matrix4[]) {
  _m.copy(hand);
  _e.set(-0.3 + a1 * 0.3, s * 0.75, s * (0.35 + oppose));
  mulTR(_m, s * THUMB.x, THUMB.y, THUMB.z, _e);
  out[THUMB_BONE].copy(_m);
  _e.set(a1, 0, 0);
  mulTR(_m, 0, 0, -THUMB.len[0], _e);
  out[THUMB_BONE + 1].copy(_m);
  _e.set(a2, 0, 0);
  mulTR(_m, 0, 0, -THUMB.len[1], _e);
  out[THUMB_BONE + 2].copy(_m);
}
