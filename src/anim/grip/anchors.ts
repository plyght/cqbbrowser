import { Euler, Matrix4, Quaternion, Vector3, type Object3D } from 'three';
import type { WeaponModel } from '../../weapons/models';
import type { Anchor, HandKey, V3 } from '../beats';
import { holdShiftZ, type ClassCfg } from '../holds';
import { layoutBuild, resolveBuild } from '../../weapons/attachments';
import { armContexts } from './arm';
import { gripShapes, type GripShapes } from './shapes';
import {
  curlToContact,
  handSamples,
  solveFiring,
  solveSupport,
  type HandSolution,
  type Sample,
} from './solve';
import type { Shape } from './sdf';

/**
 * Weapon-frame hand anchors shared by the runtime (WeaponController) and the grip validator tests: sockets,
 * mag grasp frame, solved grips, and the authored-pose → contact-limited curl step.
 */
export interface WeaponRig {
  sockets: Record<string, Vector3>;
  magGrasp: Vector3;
  magRestQ: Quaternion;
  magRest: Vector3 | null;
  shapes: GripShapes;
  fire: HandSolution;
  fireTrigger: HandSolution;
  support: HandSolution;
  /** Torso-z shift of the class holds for this build's length of pull (`holdShiftZ`). */
  holdDz: number;
}

export const WEAPON_ANCHORS = new Set<Anchor>([
  'grip',
  'handguard',
  'well',
  'charging',
  'boltCatch',
  'slide',
]);

/** Hand bases for the remaining anchors (left hand; weapon / mag / torso frames): [finger dir, back of hand]. */
export const BASES: Partial<Record<Anchor, [V3, V3]>> = {
  well: [
    [0, 0, -1],
    [-1, 0, 0],
  ],
  charging: [
    [1, 0, 0],
    [0, 1, 0],
  ],
  boltCatch: [
    [0, 0.3, -1],
    [-1, 0, 0],
  ],
  slide: [
    [1, -0.3, 0.15],
    [0, 1, 0],
  ],
  cam: [
    [0.3, 0.15, -1],
    [-1, 0, 0],
  ],
};
export const BODY_BASIS: [V3, V3] = [
  [0, -0.3, -1],
  [-1, 0, 0],
];

const _bx = new Vector3();
const _by = new Vector3();
const _bz = new Vector3();
const _bm = new Matrix4();
/** Quaternion whose -z is `finger` and +y is (orthogonalised) `back`. */
export function basisQuat([finger, back]: [V3, V3], out = new Quaternion()): Quaternion {
  _bz.set(-finger[0], -finger[1], -finger[2]).normalize();
  _by.set(back[0], back[1], back[2]);
  _by.addScaledVector(_bz, -_by.dot(_bz)).normalize();
  _bx.crossVectors(_by, _bz);
  return out.setFromRotationMatrix(_bm.makeBasis(_bx, _by, _bz));
}

/** Sockets, mag frame and solved grips for a model (once per build). */
export function weaponRig(model: WeaponModel, cfg: ClassCfg): WeaponRig {
  const root = model.root;
  root.updateMatrixWorld(true);
  const inv = new Matrix4().copy(root.matrixWorld).invert();
  const sockets: Record<string, Vector3> = {};
  const named = model.sockets as Record<string, Object3D | undefined>;
  const parts = model.parts as Record<string, Object3D | undefined>;
  // Pistols rack on the slide serrations (the `chargingHandle` socket of the models).
  const alias: Record<string, string> = { slideRear: 'chargingHandle' };
  for (const [name, fb] of Object.entries(cfg.sockets)) {
    const o =
      named[name] ??
      parts[name] ??
      (alias[name] ? named[alias[name]] : undefined) ??
      root.getObjectByName(name);
    sockets[name] = o
      ? new Vector3().setFromMatrixPosition(o.matrixWorld).applyMatrix4(inv)
      : new Vector3(...fb);
  }
  const mag = parts.mag ?? root.getObjectByName('mag');
  const magRestQ = mag ? mag.quaternion.clone() : new Quaternion();
  const magRest = mag ? mag.position.clone() : null;
  // Grasp point: below the well mouth along the mag axis, expressed in the mag's local frame.
  const magGrasp = new Vector3(0, -cfg.graspDepth, 0).applyQuaternion(magRestQ).add(sockets.magwell);
  if (magRest) magGrasp.sub(magRest).applyQuaternion(magRestQ.clone().invert());
  // The solve (~0.5 s) depends only on the build and the class holds: cache it per build.
  let buttZ: number | undefined;
  try {
    buttZ = layoutBuild(resolveBuild(model.build)).buttZ;
  } catch {
    /* hand-built model without a valid build */
  }
  const holdDz = holdShiftZ(cfg, buttZ);
  const key = JSON.stringify(model.build) + JSON.stringify(cfg.holds) + JSON.stringify(cfg.shoulderL);
  let solved = SOLVED.get(key);
  if (!solved) {
    const shapes = gripShapes(model);
    const fire = solveFiring(shapes, false);
    const fireTrigger = solveFiring(shapes, true);
    const support = solveSupport(shapes, fire, armContexts(cfg, -1, holdDz));
    SOLVED.set(key, (solved = { shapes, fire, fireTrigger, support }));
  }
  return { sockets, magGrasp, magRestQ, magRest, holdDz, ...solved };
}

const SOLVED = new Map<string, Pick<WeaponRig, 'shapes' | 'fire' | 'fireTrigger' | 'support'>>();

/** Anchor frame in the weapon frame (weapon anchors only). `charge`/`slide` are part travel channels. */
export function weaponAnchor(
  rig: WeaponRig,
  at: Anchor,
  charge: number,
  slide: number,
  outP: Vector3,
  outQ: Quaternion,
) {
  outQ.identity();
  switch (at) {
    case 'grip':
      outP.copy(rig.fire.pos);
      return;
    case 'handguard':
      outP.copy(rig.support.pos);
      return;
    case 'well':
      // Mag frame at rest (mag rotation within the weapon), origin at the support-hand grasp point.
      outQ.copy(rig.magRestQ);
      outP.copy(rig.magGrasp).applyQuaternion(rig.magRestQ);
      if (rig.magRest) outP.add(rig.magRest);
      return;
    case 'charging':
      outP.copy(rig.sockets.chargingHandle);
      outP.z += charge * 0.07;
      return;
    case 'boltCatch':
      outP.copy(rig.sockets.boltCatch);
      return;
    case 'slide':
      outP.copy(rig.sockets.slideRear);
      outP.z += slide * 0.028;
      return;
    default:
      outP.set(0, 0, 0);
  }
}

export function anchorBasis(rig: WeaponRig, at: Anchor, out: Quaternion): Quaternion {
  if (at === 'grip') return out.copy(rig.fire.quat);
  if (at === 'handguard') return out.copy(rig.support.quat);
  return basisQuat(BASES[at] ?? BODY_BASIS, out);
}

const _q2 = new Quaternion();
const _v3 = new Vector3();
const _e = new Euler(0, 0, 0, 'YXZ');

/** A hand key resolved in an anchor frame (already placed): offset in that frame, then the hand basis. */
export function applyKey(
  rig: WeaponRig,
  k: HandKey,
  jitter: V3,
  jk: number,
  outP: Vector3,
  outQ: Quaternion,
) {
  const o = k.p ?? [0, 0, 0];
  _v3.set(o[0] + jitter[0] * jk, o[1] + jitter[1] * jk, o[2] + jitter[2] * jk).applyQuaternion(outQ);
  outP.add(_v3);
  outQ.multiply(anchorBasis(rig, k.at, _q2));
  if (k.r) outQ.multiply(_q2.setFromEuler(_e.set(k.r[0], k.r[1], k.r[2])));
}

/** Shapes the hand may touch: never the pistol support-wrap proxy, and not the mag while it rides the hand. */
export const contactFilter = (magInHand: boolean) => (x: Shape) =>
  x.name !== 'supportWrap' && (!magInHand || x.name !== 'mag');

const _pm = new Matrix4();
/**
 * Authored pose → contact-limited curls for a hand in the weapon frame (`hand` is modified if the palm would sink
 * into a surface: it is pushed out along the palm normal).
 */
export function resolveHandContact(
  rig: WeaponRig,
  hand: Matrix4,
  side: 1 | -1,
  authored: ArrayLike<number>,
  out: Float32Array,
  magInHand: boolean,
) {
  const only = contactFilter(magInHand);
  // Curl to contact; anything still inside a surface (palm, or a finger that touches even when open) pushes the
  // whole hand out along the palm normal and the fingers re-close.
  for (let it = 0; it < 6; it++) {
    curlToContact(rig.shapes.set, hand, side, authored, out, undefined, only);
    let min = Infinity;
    for (const x of handSamples(hand, side, out, _smp)) min = Math.min(min, rig.shapes.set.sdf(x.p, only));
    if (min >= 0) break;
    _v3
      .set(0, 1, 0)
      .transformDirection(hand)
      .multiplyScalar(-min + 0.0005);
    hand.premultiply(_pm.makeTranslation(_v3.x, _v3.y, _v3.z));
  }
  return out;
}
const _smp: Sample[] = [];
