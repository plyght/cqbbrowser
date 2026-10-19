import { describe, expect, test } from 'bun:test';
import { ammoForCaliber, CARTRIDGES, resolveAmmo } from './cartridges';
import { barrelFit, muzzlePressureRel, muzzleState, muzzleVelocity } from './interior';

describe('interior ballistics', () => {
  test('fit passes exactly through both reference points', () => {
    for (const c of Object.values(CARTRIDGES)) {
      for (const [inches, v] of c.ref) expect(muzzleVelocity(c, inches)).toBeCloseTo(v, 3);
      expect(barrelFit(c).x0).toBeGreaterThan(0);
    }
  });

  test('velocity rises monotonically with diminishing returns', () => {
    for (const c of Object.values(CARTRIDGES)) {
      let prev = 0,
        prevGain = Infinity;
      for (let l = 4; l <= 24; l += 2) {
        const v = muzzleVelocity(c, l);
        expect(v).toBeGreaterThan(prev);
        if (prev) {
          expect(v - prev).toBeLessThan(prevGain + 1e-9);
          prevGain = v - prev;
        }
        prev = v;
      }
    }
  });

  test('5.56 loses far more per inch than .300 BLK sub or 9 mm', () => {
    const perIn = (id: keyof typeof CARTRIDGES) =>
      (muzzleVelocity(CARTRIDGES[id], 16) - muzzleVelocity(CARTRIDGES[id], 10)) / 6;
    expect(perIn('m193') * 3.28).toBeGreaterThan(30);
    expect(perIn('blk220') * 3.28).toBeLessThan(10);
    expect(perIn('m193')).toBeGreaterThan(4 * perIn('blk220'));
  });

  test('muzzle state: energy, momentum, subsonic flag, blast', () => {
    const m193 = muzzleState(CARTRIDGES.m193, 20);
    expect(m193.energy).toBeGreaterThan(1650); // ~1750 J
    expect(m193.energy).toBeLessThan(1850);
    expect(m193.subsonic).toBe(false);
    expect(muzzleState(CARTRIDGES.blk220, 9).subsonic).toBe(true);
    expect(muzzleState(CARTRIDGES.p9_147, 4).subsonic).toBe(true);
    expect(muzzleState(CARTRIDGES.p9_124, 4).subsonic).toBe(false);
    const p9 = muzzleState(CARTRIDGES.p9_124, 4);
    expect(p9.energy).toBeGreaterThan(450); // ~490 J
    expect(p9.energy).toBeLessThan(540);
    // Buckshot: whole-payload energy.
    expect(muzzleState(CARTRIDGES.buck00, 18.5).energy).toBeGreaterThan(2300); // 9 × 53.8 gr @ 1300 fps ≈ 2450 J
    // Short barrels are louder/flashier.
    expect(muzzlePressureRel(CARTRIDGES.m855, 10.3)).toBeGreaterThan(1.3);
  });

  test('ammo resolution', () => {
    expect(resolveAmmo('5.56').id).toBe('m855');
    expect(resolveAmmo('5.56', 'm193').id).toBe('m193');
    expect(resolveAmmo('5.56', 'blk220').id).toBe('m855'); // doesn't chamber
    expect(ammoForCaliber('300blk').sort()).toEqual(['blk110', 'blk220']);
  });
});
