import { describe, expect, test } from 'bun:test';
import { Vector3 } from 'three';
import { installHeadlessCanvas } from '../../anim/grip/headlessDom';

installHeadlessCanvas();
const { buildModel } = await import('.');
const { WEAPONS } = await import('../defs');
const { magInfo, sliceAt } = await import('./magGeom');
const { MagRounds, caliberId, roundGeometry, roundsOn } = await import('./magRounds');

const IDS = ['p17', 'p92', 'sb16', 'hb300', 'k47s', 'kp9'];

describe('mag rounds', () => {
  test('one lightweight instanced round per calibre', () => {
    for (const c of ['9mm', '5.56', '5.45', '300blk', '7.62x39'] as const) {
      const g = roundGeometry(c);
      const tris = g.attributes.position.count / 3;
      expect(tris).toBeLessThan(400);
      expect(g.getAttribute('color')).toBeTruthy();
    }
    expect(caliberId('7.62x39')).toBe('7.62x39');
    expect(caliberId('300blk')).toBe('300blk');
    // The .300 BLK case is short and fat-necked, its projectile long.
    const blk = roundGeometry('300blk');
    const r556 = roundGeometry('5.56');
    blk.computeBoundingBox();
    r556.computeBoundingBox();
    expect(blk.boundingBox!.min.z).toBeGreaterThan(r556.boundingBox!.min.z - 0.002);
  });

  test('every weapon: a full stack inside the mag, the top round at the lips, one extra draw call', () => {
    for (const id of IDS) {
      const def = WEAPONS[id];
      const m = buildModel(id, { detailParts: true });
      m.root.updateMatrixWorld(true);
      const info = magInfo(m)!;
      expect(info).toBeTruthy();
      let meshes = 0;
      m.root.traverse((o) => void ((o as { isMesh?: boolean }).isMesh && meshes++));
      const r = new MagRounds(m, def.caliber, def.magCapacity);
      let after = 0;
      m.root.traverse((o) => void ((o as { isMesh?: boolean }).isMesh && after++));
      expect(after - meshes).toBe(1);
      const L = r.layout;
      expect(L.slots.length).toBe(def.magCapacity);
      // Top round just under the lip line; stack goes down; staggered left/right.
      expect(L.slots[0].p.y).toBeLessThan(info.top);
      expect(L.slots[0].p.y).toBeGreaterThan(info.top - 0.03);
      for (let k = 1; k < L.slots.length; k++) {
        expect(L.slots[k].p.y).toBeLessThan(L.slots[k - 1].p.y);
        expect(Math.sign(L.slots[k].p.x - L.slots[k - 1].p.x)).not.toBe(0);
      }
      // Heads and noses inside the shell (front/rear walls at their heights), within its width.
      const s = { y: 0, x0: 0, x1: 0, z0: 0, z1: 0 };
      const len = (def.caliber === '9mm' ? 0.0297 : 0.056) * L.scale;
      for (const slot of L.slots) {
        const ax = new Vector3(0, 0, -1).applyQuaternion(slot.q);
        const nose = slot.p.clone().addScaledVector(ax, len);
        sliceAt(info, slot.p.y, s);
        expect(slot.p.z).toBeLessThanOrEqual(s.z1 + 1e-4);
        expect(slot.p.x - L.diameter / 2).toBeGreaterThan(s.x0 - 1e-3);
        expect(slot.p.x + L.diameter / 2).toBeLessThan(s.x1 + 1e-3);
        sliceAt(info, nose.y, s);
        expect(nose.z).toBeGreaterThan(s.z0 - 0.003);
      }
      // Only the rounds that exist are drawn.
      r.set(def.magCapacity);
      expect(r.mesh.count).toBe(def.magCapacity);
      r.set(1);
      expect(r.mesh.count).toBe(1);
      r.set(0);
      expect(r.mesh.visible).toBe(false);
      expect(roundsOn(m.parts.mag)).toBe(r.mesh);
      // A clone of the mag (floor drop) keeps its own count.
      r.set(5);
      const copy = m.parts.mag!.clone(true);
      expect(roundsOn(copy)!.count).toBe(5);
      // Out of the well needs a clear gap beyond the depth the mag sits in the gun.
      expect(info.travel).toBeGreaterThan(0.08);
      expect(info.axis.y).toBeLessThan(-0.5);
    }
  });

  test('openings follow the real mags (witness holes, PMAG window, none on the AK)', () => {
    const styles: Record<string, string> = {};
    for (const id of IDS) {
      const m = buildModel(id, { detailParts: true });
      m.root.updateMatrixWorld(true);
      const r = new MagRounds(m, WEAPONS[id].caliber, WEAPONS[id].magCapacity);
      styles[id] = r.style;
    }
    expect(styles).toEqual({
      p17: 'glock',
      p92: 'beretta',
      sb16: 'pmag',
      hb300: 'pmag',
      k47s: 'ak',
      kp9: 'hk',
    });
  });
});
