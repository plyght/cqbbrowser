import { Quaternion, Vector3 } from 'three';
import { solveTwoBone } from '../ik';

/**
 * Retargeting math shared by the offline tool (tools/anim/build.ts) and the runtime rig. Pure, no scene.
 *
 * Both source packs are Mixamo rigs (bone +Y runs along the bone), so a pose transfers by bone name once the
 * bind-pose difference is cancelled:
 *  - same hierarchy: `local_dst = dstBind · (srcBind⁻¹ · srcAnim)` (the animation's local delta from bind);
 *  - different hierarchy (the Beretta's hands hang off IK helper bones, not the forearms): the same idea in
 *    world space, `world_dst = srcWorld · srcBindWorld⁻¹ · dstBindWorld`.
 * Bone lengths differ, so arm positions come from a two-bone IK that puts the canonical wrist where the
 * source wrist was (`solveArm`): the gun grip still lands in the palm.
 */

/** Canonical bone name: Mixamo name without the `mixamorigN:` prefix (three strips the colon on load). */
export function canonicalBoneName(name: string): string {
  return name.replace(/^mixamorig\d*:?/, '');
}

/** `dstBind · srcBind⁻¹ · srcAnim` — local rotation delta from the source bind pose applied to the target's. */
export function localDelta(
  srcBind: Quaternion,
  srcAnim: Quaternion,
  dstBind: Quaternion,
  out = new Quaternion(),
): Quaternion {
  const d = srcBind.clone().invert().multiply(srcAnim);
  return out.copy(dstBind).multiply(d);
}

/** `srcWorld · srcBindWorld⁻¹ · dstBindWorld` — world rotation of the target bone for a posed source bone. */
export function retargetWorld(
  srcWorld: Quaternion,
  srcBindWorld: Quaternion,
  dstBindWorld: Quaternion,
  out = new Quaternion(),
): Quaternion {
  const off = srcBindWorld.clone().invert().multiply(dstBindWorld);
  return out.copy(srcWorld).multiply(off);
}

const _a = new Vector3();
const _b = new Vector3();
const _q = new Quaternion();
/**
 * Swing `rot` (a world rotation) by the smallest rotation that maps its local `axis` onto world `dir`,
 * keeping the twist about the bone. Writes `rot`.
 */
export function aimAxis(rot: Quaternion, axis: Vector3, dir: Vector3): Quaternion {
  _a.copy(axis).applyQuaternion(rot).normalize();
  _b.copy(dir).normalize();
  _q.setFromUnitVectors(_a, _b);
  return rot.premultiply(_q);
}

export interface ArmSolve {
  /** World rotations of the upper arm and forearm after the solve (twist kept from the inputs). */
  upper: Quaternion;
  fore: Quaternion;
  elbow: Vector3;
  wrist: Vector3;
  reached: boolean;
}

const Y = new Vector3(0, 1, 0);
/**
 * Two-bone arm solve in world space. `upperRot`/`foreRot` are the retargeted world rotations (their twist and
 * the general bend direction are kept); the elbow bends toward `pole`. Bones point along local +Y.
 */
export function solveArm(
  shoulder: Vector3,
  upperLen: number,
  foreLen: number,
  target: Vector3,
  pole: Vector3,
  upperRot: Quaternion,
  foreRot: Quaternion,
): ArmSolve {
  const elbow = new Vector3();
  const wrist = new Vector3();
  const reached = solveTwoBone(shoulder, target, pole, upperLen, foreLen, elbow, wrist);
  const upper = aimAxis(upperRot.clone(), Y, elbow.clone().sub(shoulder));
  const fore = aimAxis(foreRot.clone(), Y, wrist.clone().sub(elbow));
  return { upper, fore, elbow, wrist, reached };
}

/** Smoothstep weight in [0, 1]: 1 at or below `near`, 0 at or beyond `far` (proximity → contact weight). */
export function proximity(d: number, near: number, far: number): number {
  if (d <= near) return 1;
  if (d >= far) return 0;
  const x = (far - d) / (far - near);
  return x * x * (3 - 2 * x);
}
