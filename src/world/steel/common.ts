import { Quaternion, Vector3, type Object3D } from 'three';
import { RAPIER } from '../../physics/Physics';

/** Steel bodies don't collide with each other (frames, other plates) but do hit the ground and player. */
export const STEEL_GROUPS = (0x0002 << 16) | 0xfffd;

export function syncMesh(obj: Object3D, body: RAPIER.RigidBody) {
  const t = body.translation();
  const r = body.rotation();
  obj.position.set(t.x, t.y, t.z);
  obj.quaternion.set(r.x, r.y, r.z, r.w);
}

export function yawQuat(yaw: number) {
  return new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw);
}

/** Signed rotation of `q` about local `axis` (unit, in the frame of `ref`) relative to `ref`. */
export function twistAngle(q: RAPIER.Rotation, ref: Quaternion, axis: 'x' | 'y' | 'z') {
  const rel = ref
    .clone()
    .invert()
    .multiply(new Quaternion(q.x, q.y, q.z, q.w));
  const c = axis === 'x' ? rel.x : axis === 'y' ? rel.y : rel.z;
  let a = 2 * Math.atan2(c, rel.w);
  if (a > Math.PI) a -= Math.PI * 2;
  if (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export interface PendingHit {
  point: Vector3;
  dir: Vector3;
  energy: number;
  sub?: number;
  /** Hit height above the hinge (knockdown steel). */
  height?: number;
  /** Physically computed steel impulse (N·s) from Ballistics' HitInfo, when available. */
  impulse?: number;
}

/** Rapier vector helper. */
export const v3 = (v: { x: number; y: number; z: number }) => ({ x: v.x, y: v.y, z: v.z });
