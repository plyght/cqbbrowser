import { describe, expect, test } from 'bun:test';
import { Matrix4, Vector3 } from 'three';
import { loadHeadlessRig } from '../contact/audit';
import type { ArmsRig } from './ArmsRig';

/**
 * Changing weapons must leave the rig on the new weapon's own clips. Regression: a direct attach (loadout
 * change + equipNow) kept the previous rifle's idle layer, so the P-17 was held with the rifle hold — support
 * arm stretched out left, hands apart, pistol canted low (in ADS too: ADS only moves the rig root).
 */
const rig = await loadHeadlessRig();
const ref = await loadHeadlessRig();
const { buildModel } = await import('../../weapons/models');
const { HandContact } = await import('../contact/HandContact');
const { weaponAnims } = await import('../library/library');
for (const r of [rig, ref]) {
  const c = new HandContact(r);
  c.autoEnable = (id) => weaponAnims(id).family === 'pistol';
  (r as ArmsRig & { _c?: InstanceType<typeof HandContact> })._c = c;
}
const step = (r: ArmsRig, n: number) => {
  const c = (r as ArmsRig & { _c?: InstanceType<typeof HandContact> })._c!;
  for (let i = 0; i < n; i++) {
    r.update(1 / 60);
    if (c.enabled) c.apply(1 / 60);
  }
};

/** Support / firing wrist in the gun frame, and their separation (m). */
function hands(r: ArmsRig) {
  const inv = new Matrix4().copy(r.weaponModel!.root.matrixWorld).invert();
  const L = r.bones.handL.getWorldPosition(new Vector3()).applyMatrix4(inv);
  const R = r.bones.handR.getWorldPosition(new Vector3()).applyMatrix4(inv);
  return { L, R, sep: L.distanceTo(R) };
}

/** A fresh P-17 at the same idle phase as `rig` (idle sway moves the support hand a few cm over a loop). */
function reference(phase: number) {
  ref.attachWeapon(buildModel('p17', { detailParts: true }), 'p17');
  ref.play('idle', { fade: 0 });
  step(ref, 30);
  const n = Math.ceil(ref.duration('idle', 'p17') * 60) * 2;
  for (let i = 0; i < n && Math.abs(ref.progress - phase) > 0.6 / (n / 2); i++) step(ref, 1);
  return hands(ref);
}

describe('weapon change → the new weapon’s hold', () => {
  for (const how of ['direct attach (setLoadout / equipNow)', 'swap (swapOut → swapIn)'] as const)
    test(`${how}: P-17 after 1 s matches a fresh P-17 idle (support hand ≤ 2 cm)`, () => {
      rig.attachWeapon(buildModel('sb16', { detailParts: true }), 'sb16');
      rig.play('idle', { fade: 0 });
      step(rig, 37);
      const p17 = buildModel('p17', { detailParts: true });
      if (how.startsWith('direct')) rig.attachWeapon(p17, 'p17');
      else {
        rig.swapTo(p17, 'p17');
        step(rig, Math.ceil((rig.duration('swapOut', 'sb16') + rig.duration('swapIn', 'p17')) * 60) + 2);
        expect(rig.weaponModel).toBe(p17);
      }
      step(rig, 60);
      expect(rig.action).toBe('idle');
      const a = hands(rig);
      const b = reference(rig.progress);
      expect(a.L.distanceTo(b.L)).toBeLessThan(0.02);
      expect(a.R.distanceTo(b.R)).toBeLessThan(0.02);
      expect(Math.abs(a.sep - b.sep)).toBeLessThan(0.02);
    });
});
