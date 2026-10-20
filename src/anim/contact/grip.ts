import { Quaternion, Vector3 } from 'three';
import { PART_BY_ID } from '../../weapons/attachments';
import type { ForegripPart } from '../../weapons/attachments/types';
import type { WeaponModel } from '../../weapons/models';
import type { ArmsRig } from '../rig/ArmsRig';
import gripData from './gripData.json';

/**
 * Runtime side of the baked grips (gripBake.ts solves them offline into gripData.json): types, lookup, and the
 * per-frame blend onto the clip pose.
 */

/** How the support hand holds the gun: the handguard (clip style), a vertical / angled foregrip, the magwell. */
export type SupportGrip = 'handguard' | 'vertical' | 'angled' | 'magwell';
export const SUPPORT_GRIPS: SupportGrip[] = ['handguard', 'vertical', 'angled', 'magwell'];
export type V3 = [number, number, number];

export interface JointDelta {
  bone: string;
  /** Rotation axis in the parent bone's frame (+ = curl), and the angle (rad). */
  axis: V3;
  a: number;
}

export interface SupportBake {
  /** Wrist offset (weapon frame, m) and turn (weapon-frame quaternion) applied through the arm IK. */
  offset: V3;
  turn: [number, number, number, number];
  joints: JointDelta[];
}

export interface GripBake {
  /** Gun-frame correction relative to the firing hand (column-major Matrix4). */
  seat: number[];
  R: JointDelta[];
  /** Extra index curl onto the trigger blade, applied by the trigger channel. */
  trigger: JointDelta[];
  L: Partial<Record<SupportGrip, SupportBake>>;
  /** Truth after the bake (mm), for the record. */
  report?: Record<string, number | string>;
}

export interface GripData {
  version: number;
  weapons: Record<string, GripBake>;
}

export const GRIPS = gripData as unknown as GripData;

/**
 * Weapons that ship on their baked grip by default (passed the visual gate: both hands read as holding the gun on
 * the sheets, never worse than raw on the true meshes in CI). The others keep their previous default.
 */
export const GRIP_SHIP = new Set<string>(['k47s', 'sb16', 'hb300']);

/** The baked grip for a weapon, when the model is the kit asset it was baked on. */
export function gripFor(id: string, model: WeaponModel): GripBake | null {
  if (!model.root.userData.kit) return null;
  return GRIPS.weapons[id] ?? null;
}

/** Support-hand style a build asks for (its foregrip; a hand stop keeps the handguard hold). */
export function supportGripFor(model: WeaponModel): SupportGrip {
  const id = model.build?.parts?.foregrip;
  const fg = id ? (PART_BY_ID[id] as ForegripPart | undefined) : undefined;
  return fg?.style === 'vertical' ? 'vertical' : fg?.style === 'angled' ? 'angled' : 'handguard';
}

const _q = new Quaternion();
const _q2 = new Quaternion();
const _sq = new Quaternion();
const _sw = new Quaternion();
const _v = new Vector3();
const _ss = new Vector3();
const _sp = new Vector3();
const _st = new Vector3();

/** Support-hand hold: wrist offset + turn (weapon frame), weighted, through the arm IK. */
export function applySupport(
  rig: ArmsRig,
  model: WeaponModel,
  offset: V3,
  turn: [number, number, number, number],
  w: number,
) {
  model.root.matrixWorld.decompose(_ss, _sw, _ss);
  _sq.set(...turn);
  _q2.identity().slerp(_sq, w);
  _q2.premultiply(_sw).multiply(_q.copy(_sw).invert());
  _st.set(offset[0] * w, offset[1] * w, offset[2] * w);
  const len = _st.length();
  if (len > 0) _st.transformDirection(model.root.matrixWorld).multiplyScalar(len);
  rig.bones.handL.getWorldPosition(_sp).add(_st);
  rig.reachHand('L', _sp, _q2);
}

/** Rotate bones by stored joint deltas (weighted) on top of their current (clip) pose. */
export function applyJoints(rig: ArmsRig, joints: JointDelta[], w: number) {
  for (const j of joints) {
    const b = rig.boneMap.get(j.bone);
    if (!b) continue;
    _q.setFromAxisAngle(_v.set(j.axis[0], j.axis[1], j.axis[2]), j.a * w);
    b.quaternion.premultiply(_q);
  }
}
