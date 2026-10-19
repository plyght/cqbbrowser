import { describe, expect, test } from 'bun:test';
import { BASE_WEAPONS, WEAPONS } from '../defs';
import {
  applyBuild,
  BuildValidationError,
  computeStats,
  defaultBuild,
  layoutBuild,
  parseBuild,
  PLATFORMS,
  PRESETS,
  resolveBuild,
  serializeBuild,
  validateBuild,
  withPart,
  type SlotId,
  type WeaponBuild,
  type WeaponId,
} from '.';

const W = Object.keys(PLATFORMS) as WeaponId[];
const b = (
  weapon: WeaponId,
  parts: Partial<Record<SlotId, string>> = {},
  params?: WeaponBuild['params'],
): WeaponBuild => ({
  v: 1,
  weapon,
  parts,
  params,
});
const codes = (x: WeaponBuild) => validateBuild(x).map((e) => e.code);
const stats = (x: WeaponBuild) => computeStats(resolveBuild(x));

describe('validation', () => {
  test('defaults and presets are valid', () => {
    for (const w of W) expect(validateBuild(defaultBuild(w))).toEqual([]);
    for (const [id, p] of Object.entries(PRESETS))
      expect({ id, errors: validateBuild(p) }).toEqual({ id, errors: [] });
  });

  test('unknown part, wrong slot, wrong weapon, missing slot', () => {
    expect(codes(b('sb16', { optic: 'nope' }))).toEqual(['unknownPart']);
    expect(codes(b('sb16', { optic: 'opt_holo', muzzle: 'opt_reddot' }))).toEqual(['wrongSlot']);
    expect(codes(b('sb16', { magazine: 'ak_mag_steel30' }))).toEqual(['fit']);
    expect(codes(b('p17', { stock: 'ar_stock_carbine' }))).toEqual(['slot']);
    expect(codes({ v: 2 } as unknown as WeaponBuild)).toEqual(['version']);
  });

  test('AK needs a rail before an optic', () => {
    const e = validateBuild(b('k47s', { optic: 'opt_reddot' }));
    expect(e).toHaveLength(1);
    expect(e[0].message).toContain('needs a top rail');
    expect(codes(b('k47s', { optic: 'opt_reddot', mount: 'ak_mount_side' }))).toEqual([]);
    expect(codes(b('k47s', { optic: 'opt_reddot', handguard: 'ak_hg_quad' }))).toEqual([]);
    expect(codes(b('k47s', { optic: 'opt_holo', mount: 'ak_mount_cover' }))).toEqual([]);
  });

  test('LPVO needs receiver rail, not the scout gas-tube rail', () => {
    const e = validateBuild(b('k47s', { optic: 'opt_lpvo', handguard: 'ak_hg_quad' }));
    expect(e.map((x) => x.code)).toEqual(['requires']);
    expect(e[0].message).toContain('receiver');
    expect(codes(b('k47s', { optic: 'opt_lpvo', mount: 'ak_mount_side' }))).toEqual([]);
  });

  test('offset dot needs top rail space; magnifier needs a unity optic', () => {
    expect(
      codes(b('k47s', { optic: 'opt_reddot', handguard: 'ak_hg_quad', offsetOptic: 'off_dot45' })),
    ).toEqual(['requires']);
    expect(codes(b('sb16', { optic: 'opt_lpvo', buis: 'buis_none', magnifier: 'mag_3x' }))).toContain(
      'requires',
    );
    expect(codes(b('sb16', { optic: 'opt_none', magnifier: 'mag_3x' }))).toContain('requires');
    // Claw rail is short: holo + magnifier don't fit.
    expect(codes(b('kp9', { mount: 'kp_mount_claw', optic: 'opt_holo', magnifier: 'mag_3x' }))).toEqual([
      'railSpace',
    ]);
    expect(codes(b('kp9', { mount: 'kp_mount_claw', optic: 'opt_reddot', magnifier: 'mag_3x' }))).toEqual([]);
  });

  test('BUIS cannot co-witness an LPVO; a weapon needs some sight', () => {
    expect(codes(b('sb16', { optic: 'opt_lpvo', buis: 'buis_flip' }))).toEqual(['requires']);
    expect(codes(b('sb16', { optic: 'opt_none', buis: 'buis_none' }))).toEqual(['noSights']);
    expect(codes(b('sb16', { optic: 'opt_none', buis: 'buis_flip' }))).toEqual([]);
  });

  test('integral suppressor rules', () => {
    expect(codes(b('hb300', { muzzle: 'ar_supp' }))).toEqual(['requires', 'requires']);
    expect(codes(b('hb300', { barrel: 'hb_b9', handguard: 'hb_hg_mlok8' }))).toEqual(['requires']); // default muzzle = integral can
    expect(codes(b('hb300', { barrel: 'hb_b9', handguard: 'hb_hg_mlok8', muzzle: 'ar_supp' }))).toEqual([]);
    expect(codes(b('hb300', { barrel: 'hb_b9', muzzle: 'ar_fh_a2' }))).toEqual(['requires']); // integral shroud
  });

  test('handguard must fit the barrel (can extend over a suppressor)', () => {
    const e = validateBuild(b('sb16', { barrel: 'ar_b103', handguard: 'ar_hg_mlok13' }));
    expect(e.map((x) => x.code)).toEqual(['handguardLength']);
    expect(e[0].message).toMatch(/max \d+\.\d"/);
    expect(codes(b('sb16', { barrel: 'ar_b145', handguard: 'ar_hg_mlok13' }))).toEqual([]);
    expect(codes(b('sb16', { barrel: 'ar_b115', handguard: 'ar_hg_quad12' }))).toEqual(['handguardLength']);
    expect(codes(b('sb16', { barrel: 'ar_b115', handguard: 'ar_hg_quad12', muzzle: 'ar_supp' }))).toEqual([]);
  });

  test('pistol dependencies', () => {
    expect(codes(b('p17', { optic: 'p17_rmr' }))).toEqual(['requires']);
    expect(codes(b('p17', { optic: 'p17_rmr', slide: 'p17_slide_rmr' }))).toEqual([]);
    expect(codes(b('p17', { muzzle: 'p17_comp' }))).toEqual(['requires']);
    expect(codes(b('p17', { muzzle: 'p17_comp', barrel: 'p17_b_thread' }))).toEqual([]);
  });

  test('accessories need rail; light and laser cannot share a side', () => {
    expect(codes(b('k47s', { light: 'light_scout' }))).toEqual(['requires']);
    expect(codes(b('k47s', { foregrip: 'fg_vertical' }))).toEqual(['requires']);
    expect(codes(b('k47s', { light: 'light_scout', handguard: 'ak_hg_mlok' }))).toEqual([]);
    expect(codes(b('sb16', { light: 'light_scout', laser: 'laser_box' }, { lightSide: 'left' }))).toEqual([
      'sideConflict',
    ]);
  });

  test('withPart reports the consequence of one change', () => {
    const r = withPart(defaultBuild('k47s'), 'optic', 'opt_holo');
    expect(r.errors[0].slot).toBe('optic');
  });
});

describe('serialization', () => {
  test('round-trips and is stable', () => {
    for (const p of Object.values(PRESETS)) {
      const s = serializeBuild(p);
      expect(serializeBuild(parseBuild(s))).toBe(s);
    }
  });
  test('parseBuild throws with every reason', () => {
    expect(() => parseBuild('{')).toThrow('not valid JSON');
    expect(() => parseBuild(JSON.stringify(b('k47s', { optic: 'opt_lpvo', light: 'light_scout' })))).toThrow(
      /receiver.*;.*M-LOK/,
    );
  });
});

describe('stats', () => {
  test('barrel length drives velocity, length and mass', () => {
    const s103 = stats(b('sb16', { barrel: 'ar_b103' }));
    const s145 = stats(b('sb16', { barrel: 'ar_b145', handguard: 'ar_hg_mlok13' }));
    expect(s103.velocity).toBeCloseTo(753, 0);
    expect(s145.velocity).toBeCloseTo(853, 0);
    expect(s145.length - s103.length).toBeCloseTo(4.2 * 0.0254, 4);
    expect(s145.mass).toBeGreaterThan(s103.mass);
    expect(s103.flash).toBeGreaterThan(s145.flash);
  });

  test('realistic overall numbers', () => {
    const s = stats(defaultBuild('sb16'));
    expect(s.mass).toBeGreaterThan(3);
    expect(s.mass).toBeLessThan(3.8);
    expect(s.length).toBeGreaterThan(0.65);
    expect(s.length).toBeLessThan(0.72);
    const p = stats(defaultBuild('p17'));
    expect(p.mass).toBeCloseTo(0.81, 1);
    expect(p.length).toBeCloseTo(0.186, 2);
  });

  test('suppressor: longer, heavier, front-heavier, quieter', () => {
    const base = b('sb16', { barrel: 'ar_b115', handguard: 'ar_hg_mlok95' });
    const a = stats(base);
    const s = stats({ ...base, parts: { ...base.parts, muzzle: 'ar_supp' } });
    expect(s.length - a.length).toBeCloseTo(0.165 - 0.054, 4);
    expect(s.mass - a.mass).toBeCloseTo(0.44, 4);
    expect(s.handling.balance).toBeGreaterThan(a.handling.balance);
    expect(s.handling.lagHalfLife).toBeGreaterThan(a.handling.lagHalfLife);
    expect(s.report).toBeLessThan(a.report * 0.5);
    expect(s.suppressed).toBe(true);
    expect(s.soundTags).toContain('suppressed');
  });

  test('stock position changes length; folding is short but unstable', () => {
    const p0 = stats(b('sb16', {}, { stockPosition: 0 }));
    const p5 = stats(b('sb16', {}, { stockPosition: 5 }));
    expect(p5.length - p0.length).toBeCloseTo(5 * 0.0165, 5);
    expect(stats(b('sb16', {}, { stockPosition: 99 })).length).toBeCloseTo(p5.length, 6);
    const ak = stats(defaultBuild('k47s'));
    const folded = stats(b('k47s', {}, { stockFolded: true }));
    expect(folded.length).toBeLessThan(ak.length - 0.2);
    expect(folded.handling.swayMul).toBeGreaterThan(ak.handling.swayMul * 1.5);
    expect(folded.recoilMul.up).toBeGreaterThan(1.3);
    expect(folded.handling.adsTime).toBeLessThan(ak.handling.adsTime);
  });

  test('heavy LPVO build is slower to ADS and lags more than a light CQB build', () => {
    const cqb = stats(PRESETS.sb16_cqb);
    const lpvo = stats(PRESETS.sb16_lpvo);
    expect(lpvo.handling.adsTime).toBeGreaterThan(cqb.handling.adsTime * 1.15);
    expect(lpvo.handling.lagHalfLife).toBeGreaterThanOrEqual(cqb.handling.lagHalfLife);
    for (const p of Object.values(PRESETS)) {
      const h = stats(p).handling;
      expect(h.lagHalfLife).toBeGreaterThanOrEqual(0.025);
      expect(h.lagHalfLife).toBeLessThanOrEqual(0.06);
      expect(h.adsTime).toBeGreaterThan(0.1);
      expect(h.adsTime).toBeLessThan(0.5);
    }
  });

  test('muzzle devices and grips multiply recoil', () => {
    const brake = stats(b('sb16', { muzzle: 'ar_brake', foregrip: 'fg_vertical' }));
    expect(brake.recoilMul.up).toBeCloseTo(0.82 * 0.95, 5);
    expect(brake.recoilMul.side).toBeCloseTo(0.9 * 0.85, 5);
    expect(brake.recoilMul.back).toBeCloseTo(0.72, 5);
    expect(brake.report).toBeGreaterThan(stats(defaultBuild('sb16')).report);
  });

  test('loaded magazine mass counts rounds', () => {
    const m20 = stats(b('sb16', { magazine: 'ar_mag_p20' }));
    const m40 = stats(b('sb16', { magazine: 'ar_mag_p40' }));
    expect(m40.mass - m20.mass).toBeCloseTo(0.17 - 0.105 + 20 * 0.0123, 5);
    expect(m40.capacity).toBe(40);
  });
});

describe('layout + aim modes', () => {
  test('primary → magnified → irons with co-witnessed BUIS', () => {
    const l = layoutBuild(resolveBuild(PRESETS.sb16_supp));
    expect(l.aimModes.map((m) => m.id)).toEqual(['primary', 'magnified', 'irons']);
    expect(l.aimModes[0].sightHeight).toBeCloseTo(0.067, 3); // ~2.6" over bore
    expect(l.magnifier!.z1).toBeGreaterThan(l.optic!.z0);
  });
  test('offset dot is canted 45° and sits ahead of the LPVO mount', () => {
    const l = layoutBuild(resolveBuild(PRESETS.sb16_lpvo));
    const off = l.aimModes.find((m) => m.id === 'offset')!;
    expect(off.roll).toBeCloseTo(-Math.PI / 4, 6);
    expect(off.point[0]).toBeGreaterThan(0.02);
    expect(l.offset!.z0).toBeLessThan(l.optic!.z1);
    expect(l.aimModes.map((m) => m.id)).toEqual(['primary', 'offset']);
  });
  test('AK irons: kept with a gas-tube dot, lost under a railed top cover', () => {
    expect(layoutBuild(resolveBuild(PRESETS.k47s_railed)).aimModes.map((m) => m.id)).toEqual([
      'primary',
      'irons',
    ]);
    const cover = b('k47s', { mount: 'ak_mount_cover', optic: 'opt_reddot' });
    expect(layoutBuild(resolveBuild(cover)).aimModes.map((m) => m.id)).toEqual(['primary']);
  });
});

describe('applyBuild', () => {
  test('recomputes existing fields and adds handling', () => {
    const d = applyBuild(BASE_WEAPONS.sb16, PRESETS.sb16_lpvo);
    expect(d.id).toBe('sb16');
    expect(d.model.startsWith('build:')).toBe(true);
    expect(d.velocity).toBe(853);
    expect(d.magCapacity).toBe(30);
    expect(d.recoil.up).toBeCloseTo(BASE_WEAPONS.sb16.recoil.up * 0.82 * 0.96 * 1.02, 5);
    expect(d.handling!.adsTime).toBeGreaterThan(0.25);
    expect(d.aimModes!.length).toBe(2);
    expect(d.suppressed).toBe(false);
    expect(applyBuild(BASE_WEAPONS.hb300, defaultBuild('hb300')).suppressed).toBe(true);
  });
  test('throws a typed error listing reasons', () => {
    try {
      applyBuild(BASE_WEAPONS.k47s, b('k47s', { optic: 'opt_reddot' }));
      throw new Error('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(BuildValidationError);
      expect((e as BuildValidationError).reasons[0]).toContain('top rail');
    }
  });
  test('WEAPONS are the default builds', () => {
    for (const w of W) {
      expect(WEAPONS[w].build).toEqual(defaultBuild(w));
      expect(WEAPONS[w].mass).toBeCloseTo(stats(defaultBuild(w)).mass, 3);
    }
  });
});
