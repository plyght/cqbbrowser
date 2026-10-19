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
import { CHECK_NAMES, LIBRARIES, checkAbortTail, dumpUpgradeTail, reloadNames } from './data/sequences';
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

describe('punchy reloads and the animated mag check', () => {
  const calmDur = (cls: 'rifle' | 'pistol', names: string[]) =>
    names.reduce((t, n) => {
      const v = LIBRARIES[cls][n].calm;
      return t + v.reduce((a, b) => a + b.dur, 0) / v.length;
    }, 0);

  test('reload timing: calm tactical ~2.0–2.3 s, speed ~1.5 s', () => {
    const r = rng(3);
    const tac = calmDur('rifle', reloadNames('rifle', 'tactical', false, r));
    const spd = calmDur('rifle', reloadNames('rifle', 'speed', false, r));
    expect(tac).toBeGreaterThanOrEqual(2.0);
    expect(tac).toBeLessThanOrEqual(2.35);
    expect(spd).toBeGreaterThanOrEqual(1.35);
    expect(spd).toBeLessThanOrEqual(1.65);
    expect(calmDur('pistol', reloadNames('pistol', 'speed', false, r))).toBeLessThan(1.6);
  });

  test('seat and bolt/slide beats jolt the weapon on the contact frame (the seat lands with magToWell)', () => {
    for (const cls of ['rifle', 'pistol'] as const) {
      const lib = LIBRARIES[cls];
      for (const v of lib.magSeat.calm) {
        expect(v.kick).toBeDefined();
        const seat = v.events!.find((e) => e.ev === 'magToWell')!;
        expect(seat.t).toBeCloseTo(v.hit!, 5);
      }
      const bolt = cls === 'rifle' ? ['boltRelease', 'chargingHandle'] : ['slideRelease'];
      for (const n of bolt)
        for (const v of lib[n].calm) {
          expect(v.kick).toBeDefined();
          expect(v.events!.find((e) => e.ev === 'chamber')!.t).toBeCloseTo(v.hit!, 5);
        }
    }
  });

  test('mag check emits magCheck → magCheckOut → magCheckIn → magSeat and seats the mag', () => {
    for (const cls of ['rifle', 'pistol'] as const) {
      const plan = planSequence(CHECK_NAMES, LIBRARIES[cls], opts());
      const p = new BeatPlayer();
      p.start(plan, null, null);
      p.holding = true;
      const hits: string[] = [];
      const evs: BeatEventName[] = [];
      const sink = { hit: (b: PlannedBeat) => hits.push(b.name), event: (e: BeatEventName) => evs.push(e) };
      for (let i = 0; i < 120; i++) p.update(1 / 60, sink);
      expect(p.current?.name).toBe('checkHold');
      p.holding = false;
      for (let i = 0; i < 120; i++) p.update(1 / 60, sink);
      expect(p.active).toBe(false);
      expect(hits.filter((h) => h.startsWith('mag'))).toEqual([
        'magCheck',
        'magCheckOut',
        'magCheckIn',
        'magSeat',
      ]);
      expect(evs).toEqual(['magToHand', 'magToWell']);
    }
  });

  test('the checked mag leaves and re-enters straight along the well axis (no clipping)', () => {
    // Hand offsets are in the mag frame (y = up the well). While the top of the mag is still inside the well
    // (offset above -0.09 m on rifles, -0.03 on pistols) it may only move along y, unrotated.
    for (const [cls, depth] of [
      ['rifle', -0.09],
      ['pistol', -0.03],
    ] as const) {
      const lib = LIBRARIES[cls];
      let prev = lib.magCheck.calm[0].left!.at(-1)!;
      for (const name of ['magCheckOut', 'checkHold', 'magCheckIn', 'magSeat'])
        for (const v of lib[name].calm) {
          let a = prev;
          // Once seated (magToWell) the mag stays in the gun: only the held part of the path matters.
          const held = (v.left ?? []).filter((k) => name !== 'magSeat' || k.t <= (v.hit ?? 1) + 1e-6);
          for (const k of held) {
            for (let u = 0; u <= 1.0001; u += 0.05) {
              const pa = a.p ?? [0, 0, 0],
                pb = k.p ?? [0, 0, 0];
              const y = pa[1] + (pb[1] - pa[1]) * u;
              if (y <= depth || a.at !== 'well' || k.at !== 'well') continue;
              const x = pa[0] + (pb[0] - pa[0]) * u,
                z = pa[2] + (pb[2] - pa[2]) * u;
              expect(Math.hypot(x, z)).toBeLessThan(0.0085);
              expect(
                Math.max(Math.hypot(...(a.r ?? [0, 0, 0])), Math.hypot(...(k.r ?? [0, 0, 0]))),
              ).toBeLessThan(0.05);
            }
            a = k;
          }
          if (name !== 'magSeat') prev = v.left!.at(-1)!;
        }
    }
  });

  test('firing during a check aborts into a fast reinsert', () => {
    expect(checkAbortTail('magCheck')).toEqual(['checkRelease', 'handReturn']);
    expect(checkAbortTail('checkHold')).toEqual(['magCheckIn', 'magSeat', 'handReturn']);
    expect(checkAbortTail('magSeat')).toBeNull();
  });
});
