import { describe, expect, test } from 'bun:test';
import { rng } from '../core/math';
import { Magazines } from '../weapons/Magazines';
import {
  BeatPlayer,
  VariantPicker,
  fumbleChance,
  planSequence,
  stressify,
  type BeatEventName,
  type BeatLibrary,
  type PlannedBeat,
} from './beats';
import { CHECK_NAMES, LIBRARIES, dumpUpgradeTail, reloadNames } from './data/sequences';
import { ease, sampleNum } from './tracks';

const opts = (stressed = false, seed = 1, fumble = 0) => ({
  stressed,
  rand: rng(seed),
  picker: new VariantPicker(),
  fumbleChance: fumble,
});

describe('tracks', () => {
  test('easings hit their endpoints', () => {
    for (const e of ['lin', 'in', 'out', 'io', 'back', 'snap', undefined] as const) {
      expect(ease(e, 0)).toBeCloseTo(0, 6);
      expect(ease(e, 1)).toBeCloseTo(1, 6);
    }
    expect(Math.max(...Array.from({ length: 50 }, (_, i) => ease('back', i / 49)))).toBeGreaterThan(1);
  });

  test('sampleNum blends from the carried start value', () => {
    const keys = [
      { t: 0.5, v: 1, e: 'lin' as const },
      { t: 1, v: 0, e: 'lin' as const },
    ];
    expect(sampleNum(keys, 0, 0.4)).toBeCloseTo(0.4);
    expect(sampleNum(keys, 0.25, 0)).toBeCloseTo(0.5);
    expect(sampleNum(keys, 0.75, 0)).toBeCloseTo(0.5);
    expect(sampleNum(keys, 2, 0)).toBe(0);
  });
});

describe('variant selection', () => {
  test('never repeats a variant immediately and uses them all', () => {
    const p = new VariantPicker();
    const r = rng(7);
    const list = ['a', 'b', 'c'];
    let prev = '';
    const seen = new Set<string>();
    for (let i = 0; i < 300; i++) {
      const v = p.pick('magSeat', list, r);
      expect(v).not.toBe(prev);
      seen.add(v);
      prev = v;
    }
    expect(seen.size).toBe(3);
  });

  test('stressed plans use the stressed set or derived faster variants', () => {
    const lib = LIBRARIES.rifle;
    const calm = planSequence(['magIndex', 'magOut'], lib, opts(false));
    const hot = planSequence(['magIndex', 'magOut'], lib, opts(true));
    expect(lib.magIndex.stressed!.map((v) => v.id)).toContain(hot[0].variant.id);
    expect(hot[1].variant.id.endsWith('!')).toBe(true);
    expect(hot[1].variant.dur).toBeLessThan(
      lib.magOut.calm.find((v) => `${v.id}!` === hot[1].variant.id)!.dur,
    );
    expect(calm.every((b) => !b.stressed)).toBe(true);
    expect(stressify(lib.magOut.calm[0])).toBe(stressify(lib.magOut.calm[0]));
  });

  test('timing noise stays within ±8%', () => {
    const lib = LIBRARIES.rifle;
    const o = opts(false, 3);
    for (let i = 0; i < 200; i++) {
      const [b] = planSequence(['magDraw'], lib, o);
      const r = b.dur / b.variant.dur;
      expect(r).toBeGreaterThanOrEqual(0.92 - 1e-9);
      expect(r).toBeLessThanOrEqual(1.08 + 1e-9);
    }
  });
});

describe('fumbles', () => {
  test('gating by stress and realism preset', () => {
    expect(fumbleChance(1, 'off')).toBe(0);
    expect(fumbleChance(0.5, 'rare')).toBe(0);
    expect(fumbleChance(0.9, 'rare')).toBeGreaterThan(0.2);
    expect(fumbleChance(0.1, 'on')).toBeGreaterThan(0);
    expect(fumbleChance(0.9, 'on')).toBeGreaterThan(fumbleChance(0.4, 'on'));
    expect(fumbleChance(1, 'on')).toBeLessThanOrEqual(0.5);
  });

  test('a fumble inserts a miss before the retried index / charge', () => {
    const plan = planSequence(
      reloadNames('rifle', 'speed', true, () => 0.9),
      LIBRARIES.rifle,
      opts(true, 1, 1),
    );
    const names = plan.map((b) => b.name);
    expect(names.indexOf('fumbleMiss')).toBe(names.indexOf('magIndex') - 1);
    expect(names.indexOf('handSlip')).toBe(names.indexOf('chargingHandle') - 1);
    expect(plan.find((b) => b.name === 'fumbleMiss')!.fumble).toBe(true);
    const none = planSequence(
      reloadNames('rifle', 'speed', true, () => 0.9),
      LIBRARIES.rifle,
      opts(true, 1, 0),
    );
    expect(none.some((b) => b.fumble)).toBe(false);
  });

  test('pistol slide fumble', () => {
    const plan = planSequence(
      reloadNames('pistol', 'speed', true, Math.random),
      LIBRARIES.pistol,
      opts(true, 2, 1),
    );
    const names = plan.map((b) => b.name);
    expect(names.indexOf('slideSlip')).toBe(names.indexOf('slideRelease') - 1);
  });
});

/** Runs a plan to completion, applying inventory events the way WeaponController does. */
function run(plan: PlannedBeat[], mags: Magazines, retain: boolean, onTick?: (p: BeatPlayer) => void) {
  const p = new BeatPlayer();
  const log: (string | BeatEventName)[] = [];
  p.start(plan, null, null);
  let guard = 0;
  while (p.active && guard++ < 2000) {
    onTick?.(p);
    p.update(1 / 60, {
      hit: (b) => log.push(b.name),
      event: (ev) => {
        log.push(ev);
        if (ev === 'magHide') mags.swap(retain);
        if (ev === 'drop') mags.swap(false);
        if (ev === 'chamber') mags.chamber();
      },
    });
  }
  return log;
}

describe('beat sequencing and magazine flows', () => {
  test('all sequences resolve to authored beats', () => {
    for (const cls of ['rifle', 'pistol'] as const)
      for (const names of [
        reloadNames(cls, 'tactical', false, () => 0.1),
        reloadNames(cls, 'speed', false, () => 0.1),
        reloadNames(cls, 'speed', true, () => 0.1),
        reloadNames(cls, 'speed', true, () => 0.9),
        CHECK_NAMES,
      ])
        for (const n of names) expect(LIBRARIES[cls][n]).toBeDefined();
  });

  test('tactical reload retains the partial mag in the dump pouch', () => {
    const mags = new Magazines(30, 2);
    for (let i = 0; i < 10; i++) mags.fire();
    const plan = planSequence(reloadNames('rifle', 'tactical', false, Math.random), LIBRARIES.rifle, opts());
    const log = run(plan, mags, true);
    expect(log.indexOf('magToHand')).toBeLessThan(log.indexOf('magHide'));
    expect(log.indexOf('magHide')).toBeLessThan(log.indexOf('magShow'));
    expect(log.indexOf('magShow')).toBeLessThan(log.indexOf('magToWell'));
    expect(mags.dump.map((m) => m.rounds)).toEqual([20]);
    expect(mags.inGun!.rounds).toBe(30);
    expect(mags.chambered).toBe(true);
  });

  test('speed reload drops the mag; empty reload chambers via the bolt beat', () => {
    const mags = new Magazines(30, 2);
    while (mags.fire());
    expect(mags.empty).toBe(true);
    const plan = planSequence(
      reloadNames('rifle', 'speed', true, () => 0.1),
      LIBRARIES.rifle,
      opts(),
    );
    const log = run(plan, mags, false);
    expect(log).toContain('drop');
    expect(log).toContain('boltRelease');
    expect(log.indexOf('magToWell')).toBeLessThan(log.indexOf('chamber'));
    expect(mags.dump.length).toBe(0);
    expect(mags.chambered).toBe(true);
    expect(mags.rounds).toBe(30);
  });

  test('double-tap upgrade during mag out branches into a dump', () => {
    const mags = new Magazines(30, 2);
    mags.fire();
    const o = opts();
    const plan = planSequence(reloadNames('rifle', 'tactical', false, Math.random), LIBRARIES.rifle, o);
    let upgraded = false;
    const log = run(plan, mags, true, (p) => {
      if (!upgraded && p.current?.name === 'magOut') {
        const tail = dumpUpgradeTail(p.tailNames());
        expect(tail).not.toBeNull();
        p.replaceTail(planSequence(tail!, LIBRARIES.rifle, o));
        upgraded = true;
      }
    });
    expect(upgraded).toBe(true);
    expect(log).toContain('magDump');
    expect(log).not.toContain('magStow');
    expect(mags.dump.length).toBe(0);
    expect(dumpUpgradeTail(['magDraw', 'magIndex'])).toBeNull();
  });

  test('hold beats loop while held and continue on release', () => {
    const plan = planSequence(CHECK_NAMES, LIBRARIES.rifle, opts());
    const p = new BeatPlayer();
    p.start(plan, null, null);
    p.holding = true;
    for (let i = 0; i < 300; i++) p.update(1 / 60, {});
    expect(p.current?.name).toBe('checkHold');
    p.holding = false;
    for (let i = 0; i < 120; i++) p.update(1 / 60, {});
    expect(p.active).toBe(false);
  });

  test('each beat starts from the previous beat’s last hand key', () => {
    const lib: BeatLibrary = {
      a: { calm: [{ id: 'x', dur: 0.1, left: [{ t: 1, at: 'well', p: [0, -0.1, 0] }] }] },
      b: { calm: [{ id: 'y', dur: 0.1, left: [{ t: 1, at: 'pouch' }] }] },
    };
    const p = new BeatPlayer();
    p.start(planSequence(['a', 'b'], lib, { ...opts(), noise: 0 }), { t: 1, at: 'handguard' }, null);
    const seg = { a: null!, b: null!, u: 0, mid: 0 };
    expect(p.handSegment('left', seg)!.a.at).toBe('handguard');
    p.update(0.15, {});
    expect(p.current?.name).toBe('b');
    expect(p.handSegment('left', seg)!.a.at).toBe('well');
    expect(p.handSegment('right', seg)).toBeNull();
  });
});
