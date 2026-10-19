import { describe, expect, test } from 'bun:test';
import { Matrix4, Quaternion, Vector3 } from 'three';
import { LIBRARIES, type WeaponClass } from '../data/sequences';
import { HAND_POSES, POSE_SIZE, blendPose } from '../handPoses';
import { CFG, type HoldName } from '../holds';
import { segment } from '../tracks';
import {
  WEAPON_ANCHORS,
  applyKey,
  contactFilter,
  resolveHandContact,
  weaponAnchor,
  weaponRig,
  type WeaponRig,
} from './anchors';
import { ARM_LIMITS, armContexts, armMetrics, VALIDATED_HOLDS, type ArmMetrics } from './arm';
import { installHeadlessCanvas } from './headlessDom';
import { measure } from './solve';
import type { HandKey } from '../beats';

installHeadlessCanvas();
const { buildModel } = await import('../../weapons/models');
const { PRESETS } = await import('../../weapons/attachments');

const LIMITS = {
  penetration: 0.0015,
  gap: 0.003,
  web: 0.008,
  trigger: 0.003,
  ...ARM_LIMITS,
};

const rigs = Object.entries(PRESETS).map(([id, b]) => {
  const cls: WeaponClass = b.weapon === 'p17' ? 'pistol' : 'rifle';
  return { id, cls, rig: weaponRig(buildModel(id), CFG[cls]) };
});

/** Arm IK to a weapon-frame palm transform for a hold pose (weapon frame, from the hold's arm context). */
function arm(cls: WeaponClass, pose: HoldName, side: 1 | -1, handW: Matrix4, dz = 0): ArmMetrics {
  const c = armContexts(CFG[cls], side, dz)[VALIDATED_HOLDS.indexOf(pose)];
  return armMetrics(c.shoulder, c.natural, handW, side, c.up);
}

function expectArm(m: ArmMetrics, label: string) {
  const ok =
    m.reach < LIMITS.reach &&
    m.elbow >= LIMITS.elbowMin &&
    m.elbow <= LIMITS.elbowMax &&
    m.flex <= LIMITS.wristExt &&
    m.flex >= -LIMITS.wristFlex &&
    m.dev <= LIMITS.radial &&
    m.dev >= -LIMITS.ulnar;
  if (!ok)
    failures.push(`${label} ${JSON.stringify(m, (_k, v) => (typeof v === 'number' ? +v.toFixed(1) : v))}`);
}
const failures: string[] = [];

const handMat = (sol: { pos: Vector3; quat: Quaternion }) =>
  new Matrix4().compose(sol.pos, sol.quat, new Vector3(1, 1, 1));

describe('grip solver', () => {
  test('firing hand: web on the beavertail, wrapped, no penetration, index on frame / trigger', () => {
    for (const { id, rig } of rigs) {
      for (const sol of [rig.fire, rig.fireTrigger]) {
        const m = sol.metrics;
        if (m.penetration > LIMITS.penetration || m.gap > LIMITS.gap || (m.web ?? 0) > LIMITS.web)
          console.log(id, 'fire', JSON.stringify(m));
        expect(m.penetration).toBeLessThanOrEqual(LIMITS.penetration);
        expect(m.gap).toBeLessThanOrEqual(LIMITS.gap);
        expect(m.web!).toBeLessThanOrEqual(LIMITS.web);
      }
      expect(rig.fireTrigger.metrics.trigger!).toBeLessThanOrEqual(LIMITS.trigger);
    }
  });

  test('support hand wraps the handguard / firing hand', () => {
    for (const { id, rig } of rigs) {
      const m = rig.support.metrics;
      if (m.penetration > LIMITS.penetration || m.gap > LIMITS.gap)
        console.log(id, 'support', JSON.stringify(m));
      expect(m.penetration).toBeLessThanOrEqual(LIMITS.penetration);
      expect(m.gap).toBeLessThanOrEqual(LIMITS.gap);
    }
  });

  test('arms reach the solved grips in anatomical ranges in every hold', () => {
    for (const { id, cls, rig } of rigs)
      for (const pose of ['high', 'ads', 'low', 'compressed'] as HoldName[]) {
        expectArm(arm(cls, pose, 1, handMat(rig.fire), rig.holdDz), `${id} ${pose} right`);
        expectArm(arm(cls, pose, -1, handMat(rig.support), rig.holdDz), `${id} ${pose} left`);
      }
    if (failures.length) console.log(failures.join('\n'));
    expect(failures).toEqual([]);
  });

  test('reload beats on the weapon: contact-limited fingers never penetrate (30 Hz samples)', () => {
    const P = new Vector3(),
      Q = new Quaternion(),
      PA = new Vector3(),
      QA = new Quaternion(),
      PB = new Vector3(),
      QB = new Quaternion();
    const seg = { from: 0, to: 0, u: 0 };
    const curls = new Float32Array(POSE_SIZE),
      out = new Float32Array(POSE_SIZE);
    const hand = new Matrix4();
    const resolve = (rig: WeaponRig, k: HandKey, p: Vector3, q: Quaternion) => {
      weaponAnchor(rig, k.at, 0, 0, p, q);
      applyKey(rig, k, [0, 0, 0], 0, p, q);
    };
    let checked = 0;
    for (const { id, cls, rig } of rigs) {
      const lib = LIBRARIES[cls];
      for (const [name, set] of Object.entries(lib))
        for (const v of [...set.calm, ...(set.stressed ?? [])])
          for (const side of ['left', 'right'] as const) {
            const keys = side === 'left' ? v.left : v.right;
            if (!keys?.length) continue;
            const n = Math.max(2, Math.ceil(v.dur * 30));
            for (let i = 0; i <= n; i++) {
              const t = i / n;
              segment(keys, t, seg);
              const a = seg.from < 0 ? keys[0] : keys[seg.from];
              const b = keys[seg.to];
              if (!WEAPON_ANCHORS.has(a.at) || !WEAPON_ANCHORS.has(b.at)) continue;
              resolve(rig, a, PA, QA);
              resolve(rig, b, PB, QB);
              P.lerpVectors(PA, PB, seg.u);
              Q.slerpQuaternions(QA, QB, seg.u);
              blendPose(
                HAND_POSES[a.pose ?? 'relaxed'],
                HAND_POSES[b.pose ?? a.pose ?? 'relaxed'],
                seg.u,
                curls,
              );
              hand.compose(P, Q, new Vector3(1, 1, 1));
              const s = side === 'left' ? -1 : 1;
              const magInHand = a.at === 'well' || b.at === 'well';
              resolveHandContact(rig, hand, s, curls, out, magInHand);
              const m = measure(rig.shapes.set, hand, s, out, [], contactFilter(magInHand));
              if (m.penetration > LIMITS.penetration)
                console.log(id, name, v.id, side, t.toFixed(2), (m.penetration * 1000).toFixed(1), 'mm');
              expect(m.penetration).toBeLessThanOrEqual(LIMITS.penetration);
              checked++;
            }
          }
    }
    expect(checked).toBeGreaterThan(100);
  });
});
