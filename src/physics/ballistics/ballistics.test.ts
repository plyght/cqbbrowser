import { describe, expect, test } from 'bun:test';
import { CARTRIDGES, muzzleVelocity } from '../../weapons/ammo';
import { WEAPONS } from '../../weapons/defs';
import { applyBuild, defaultBuild, withPart } from '../../weapons/attachments';
import { BASE_WEAPONS } from '../../weapons/defs';
import { atmosphere, ISA } from './atmosphere';
import { chokeSigma, disperse, MOA, sigmaFromMoa } from './dispersion';
import { cdRef } from './drag';
import { recoilFor, sampleRecoil } from './recoil';
import { hashSeed, Rng } from './rng';
import { restitution, spallDir, steelImpulse } from './steel';
import {
  criticalAngle,
  initProjectile,
  MATERIALS,
  materialFor,
  newProjectile,
  perforate,
  ricochets,
} from './terminal';
import { chordTime, computeBoreAngle, flyTo, pointOfImpact } from './trajectory';
import {
  dropTable,
  fpsPerInch,
  PEN_CASES,
  PEN_LOADS,
  penetrationTable,
  recoilTable,
  steelTable,
  velocityTable,
  zeroTable,
} from './validation';

describe('atmosphere + drag', () => {
  test('ISA sea level', () => {
    expect(ISA.density).toBeCloseTo(1.225, 3);
    expect(ISA.soundSpeed).toBeCloseTo(340.3, 0);
    expect(atmosphere({ altitude: 1500 }).density).toBeLessThan(1.06);
    expect(atmosphere({ humidity: 1, tempC: 30 }).density).toBeLessThan(atmosphere({ tempC: 30 }).density);
  });

  test('drag tables: transonic rise, G7 below G1', () => {
    expect(cdRef('G1', 0.5)).toBeCloseTo(0.2032, 4);
    expect(cdRef('G1', 1.4)).toBeGreaterThan(cdRef('G1', 0.8) * 2);
    expect(cdRef('G7', 1.05)).toBeGreaterThan(cdRef('G7', 0.85) * 2.5);
    for (const m of [0.3, 0.9, 1.2, 2, 3]) expect(cdRef('G7', m)).toBeLessThan(cdRef('G1', m));
    expect(cdRef('G1', 0.625)).toBeGreaterThan(cdRef('G1', 0.6));
  });
});

describe('external ballistics', () => {
  test('validation: drop ≈ ½gt², TOF > range/v0', () => {
    for (const r of dropTable()) expect({ ammo: r.ammo, ok: r.ok }).toEqual({ ammo: r.ammo, ok: true });
  });

  test('reference drops from a horizontal bore', () => {
    // M193 16" @100 m ≈ 6 cm; 9 mm 124 gr 4.5" @100 m ≈ 44 cm (TOF ≈ 0.3 s); 220 gr sub 6" @100 m ≈ 58 cm.
    const d = (id: keyof typeof CARTRIDGES, inches: number, r: number) =>
      -flyTo(CARTRIDGES[id], muzzleVelocity(CARTRIDGES[id], inches), 0, r).y * 100;
    expect(d('m193', 16, 100)).toBeGreaterThan(5);
    expect(d('m193', 16, 100)).toBeLessThan(7);
    expect(d('p9_124', 4.5, 100)).toBeGreaterThan(38);
    expect(d('p9_124', 4.5, 100)).toBeLessThan(50);
    expect(d('blk220', 6, 100)).toBeGreaterThan(52);
    expect(d('blk220', 6, 100)).toBeLessThan(64);
  });

  test('zero: rounds hit ~one sight height low at 3 m and on the line at the zero', () => {
    for (const r of zeroTable()) expect({ w: r.weapon, ok: r.ok }).toEqual({ w: r.weapon, ok: true });
    const sb = zeroTable().find((r) => r.weapon === 'sb16')!;
    // 50 m zero: crosses again high-ish at 100 m for 5.56, then falls.
    expect(sb.poi.find((p) => p.range === 100)!.cm).toBeGreaterThan(0);
  });

  test('bore angle grows with sight height and shrinks with speed', () => {
    const c = CARTRIDGES.m193;
    const a = computeBoreAngle(50, 0.066, c, 900);
    expect(computeBoreAngle(50, 0.08, c, 900)).toBeGreaterThan(a);
    expect(computeBoreAngle(50, 0.066, c, 990)).toBeLessThan(a);
    expect(pointOfImpact(50, 0.066, a, c, 900).y).toBeCloseTo(0, 4);
  });

  test('chord tolerance keeps raycasts few at CQB range', () => {
    // 5 mm sagitta → ~64 ms chords: a 9 mm round covers 25 m in one chord.
    expect(chordTime(0.005) * 350).toBeGreaterThan(20);
  });
});

describe('dispersion', () => {
  test('deterministic per seed, MOA-scaled spread', () => {
    const rng = new Rng();
    const shoot = (seed: number) => {
      rng.seed(seed);
      return disperse({ x: 0, y: 0, z: -1 }, sigmaFromMoa(3), rng);
    };
    expect(shoot(hashSeed(100, 0))).toEqual(shoot(hashSeed(100, 0)));
    expect(shoot(hashSeed(100, 0))).not.toEqual(shoot(hashSeed(101, 0)));
    // Mean radius over many shots ≈ 1.25 σ.
    let sum = 0;
    const N = 4000;
    for (let i = 0; i < N; i++) {
      const d = shoot(hashSeed(i, 7));
      sum += Math.hypot(d.x, d.y);
    }
    const mr = sum / N / MOA;
    expect(mr).toBeGreaterThan(1.1);
    expect(mr).toBeLessThan(1.4);
  });

  test('chokes tighten the pattern', () => {
    expect(chokeSigma('full')).toBeLessThan(chokeSigma('modified'));
    expect(chokeSigma('cylinder') * 2.146 * 2 * 36).toBeCloseTo(1, 5); // 1"/yd at 90%
  });
});

describe('terminal ballistics', () => {
  const pen = penetrationTable();
  const cell = (case_: string, ammo: string) =>
    pen[PEN_CASES.findIndex((c) => c.id === case_)][PEN_LOADS.findIndex(([a]) => a === ammo)];

  test('5.56 through 2 layers of drywall with plenty left', () => {
    expect(cell('drywall2', 'm193').keep).toBeGreaterThan(0.9);
    expect(cell('drywall2', 'm855').keep).toBeGreaterThan(0.9);
  });

  test('9 mm through an interior door and a kill-house wall', () => {
    expect(cell('door', 'p9_124').keep).toBeGreaterThan(0.85);
    expect(cell('ply24', 'p9_124').keep).toBeGreaterThan(0.8);
    expect(cell('stud', 'p9_124').out).toBeGreaterThan(200);
  });

  test('pistol rounds go through more drywall than people expect', () => {
    expect(cell('drywall8', 'p9_124').out).toBeGreaterThan(220);
    expect(cell('drywall8', 'm193').out).toBeGreaterThan(0);
  });

  test('nothing through AR500 or 10 cm of concrete', () => {
    for (const [ammo] of PEN_LOADS) {
      expect(cell('ar500', ammo).out).toBe(0);
      expect(cell('concrete', ammo).out).toBe(0);
    }
  });

  test('5.56 tumbles in wood; fast M193 fragments', () => {
    expect(cell('stud89', 'm193').tumbling).toBe(true);
    expect(cell('stud89', 'm193').fragmented).toBe(true);
    expect(cell('drywall2', 'p9_124').tumbling).toBe(false);
  });

  test('stud depth ballpark: 9 mm 10–17 cm of pine', () => {
    const p = newProjectile();
    initProjectile(p, CARTRIDGES.p9_124, 356);
    const r = perforate(p, MATERIALS.pine, 1);
    expect(r.stopped).toBe(true);
    expect(r.depth).toBeGreaterThan(0.1);
    expect(r.depth).toBeLessThan(0.17);
  });

  test('ricochet: shallow angles skip off concrete, not drywall; steep never', () => {
    const p = newProjectile();
    initProjectile(p, CARTRIDGES.p9_124, 350);
    const deg = Math.PI / 180;
    expect(ricochets(p, MATERIALS.concrete, 5 * deg, 0.5)).toBe(true);
    expect(ricochets(p, MATERIALS.concrete, 45 * deg, 0.5)).toBe(false);
    expect(ricochets(p, MATERIALS.drywall, 5 * deg, 0.5)).toBe(false);
    expect(criticalAngle(p, MATERIALS.ar500)).toBeGreaterThan(criticalAngle(p, MATERIALS.dirt));
  });

  test('surface → material', () => {
    expect(materialFor('wood', 0.035).id).toBe('door');
    expect(materialFor('wood').id).toBe('pine');
    expect(materialFor('steel_target').hard).toBe(true);
    expect(materialFor('berm').id).toBe('dirt');
  });
});

describe('steel', () => {
  test('restitution in the 0.2–0.4 band, falls with speed (Johnson v^-1/4)', () => {
    for (const v of [300, 400, 800]) {
      expect(restitution(v)).toBeGreaterThan(0.2);
      expect(restitution(v)).toBeLessThan(0.4);
    }
    expect(restitution(300)).toBeGreaterThan(restitution(800));
    expect(steelImpulse(0.008, 360, 0.5)).toBeCloseTo(steelImpulse(0.008, 360) / 2, 6);
  });

  test('knockdown matrix: 9 mm rings heavy, .300 BLK sub drops it', () => {
    const t = steelTable();
    const row = (w: string) => t.find((r) => r.weapon === w)!;
    expect(row('p17').standard).toBe(true);
    expect(row('p17').heavyAtLine).toBe(false);
    expect(row('p17').heavyHigh).toBe(false);
    expect(row('kp9').heavyAtLine).toBe(false);
    expect(row('hb300').heavyAtLine).toBe(true);
    expect(row('k47s').heavyAtLine).toBe(true);
    expect(row('sb16').heavyAtLine).toBe(false);
    for (const r of t) expect(r.plate).toBe(true);
  });

  test('spall hugs the plate face', () => {
    const rng = new Rng(3);
    const o = { x: 0, y: 0, z: 0 };
    for (let i = 0; i < 50; i++) {
      spallDir({ x: 0, y: 0, z: -1 }, { x: 0, y: 0, z: 1 }, rng, o);
      expect(Math.hypot(o.x, o.y, o.z)).toBeCloseTo(1, 5);
      expect(o.z).toBeGreaterThan(Math.sin((2.9 * Math.PI) / 180));
      expect(o.z).toBeLessThan(Math.sin((20.1 * Math.PI) / 180));
    }
  });
});

describe('recoil', () => {
  test('validation: free recoil energy per default build', () => {
    for (const r of recoilTable())
      expect({ w: r.weapon, e: +r.energy.toFixed(2), ok: r.ok }).toEqual({
        w: r.weapon,
        e: +r.energy.toFixed(2),
        ok: true,
      });
  });

  test('profile packets sum to the free-recoil impulse; action nets to zero', () => {
    for (const d of Object.values(WEAPONS)) {
      const r = recoilFor(d);
      const sum = r.profile.reduce((a, p) => a + p.fx, 0);
      expect(sum).toBeCloseTo(r.impulseNs, 6);
      const action = r.profile.filter((p) => !['bore', 'gas'].includes(p.kind)).reduce((a, p) => a + p.fx, 0);
      expect(action).toBeCloseTo(0, 6);
      for (let i = 1; i < r.profile.length; i++)
        expect(r.profile[i].t).toBeGreaterThanOrEqual(r.profile[i - 1].t);
      const w = sampleRecoil(r, 0, 1, { fx: 0, fy: 0, torque: 0 });
      expect(w.fx).toBeCloseTo(r.impulseNs, 6);
      expect(w.torque).toBeGreaterThan(0); // net muzzle rise
    }
  });

  test('pistol frame feels the slide: big early slide share, late slam', () => {
    const r = recoilFor(WEAPONS.p17);
    expect(r.action).toBe('shortRecoil');
    const early = sampleRecoil(r, 0, 0.002, { fx: 0, fy: 0, torque: 0 }).fx;
    expect(early).toBeLessThan(0.5 * r.impulseNs);
    expect(r.cycleTime).toBeGreaterThan(0.015);
    expect(r.cycleTime).toBeLessThan(0.04);
  });

  test('muzzle devices: brake cuts impulse + adds downforce, can adds a little', () => {
    const base = defaultBuild('sb16');
    const def = (b: typeof base) => applyBuild(BASE_WEAPONS.sb16, b);
    const fh = recoilFor(def(base));
    const brake = recoilFor(def(withPart(base, 'muzzle', 'ar_brake').build));
    const can = recoilFor(def(withPart(base, 'muzzle', 'ar_supp').build));
    expect(brake.impulseNs).toBeLessThan(fh.impulseNs * 0.9);
    expect(brake.components.downforce).toBeGreaterThan(0);
    expect(can.impulseNs).toBeGreaterThan(fh.impulseNs);
    expect(can.carrierVelocity).toBeGreaterThan(fh.carrierVelocity); // back-pressure
    // ...but the can's mass lowers recoil velocity per impulse.
    expect(can.gunMassKg).toBeGreaterThan(fh.gunMassKg);
  });

  test('AK long-stroke bottoms harder than the AR', () => {
    const peak = (id: string) =>
      Math.max(
        ...recoilFor(WEAPONS[id])
          .profile.filter((p) => p.kind === 'bottom')
          .map((p) => p.fx),
      );
    expect(peak('k47s')).toBeGreaterThan(peak('sb16'));
  });

  test('velocity table within published ranges', () => {
    for (const r of velocityTable())
      expect({ id: `${r.ammo}@${r.inches}`, v: Math.round(r.v), ok: r.ok }).toEqual({
        id: `${r.ammo}@${r.inches}`,
        v: Math.round(r.v),
        ok: true,
      });
    // 5.56 under 16": ~30–50 fps/in; 220 sub barely cares.
    expect(fpsPerInch('m193')).toBeGreaterThan(30);
    expect(fpsPerInch('m193')).toBeLessThan(55);
    expect(fpsPerInch('blk220')).toBeLessThan(10);
  });
});
