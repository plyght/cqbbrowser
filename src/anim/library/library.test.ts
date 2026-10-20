import { describe, expect, test } from 'bun:test';
import { makeLayout, type Clip } from '../rig/pose';
import { compose } from './compose';
import { detectEvents, smooth, splitTimeline } from './detect';
import { ACTIONS, WEAPON_ANIMS, weaponAnims } from './library';

const fps = 24;
const ramp = (n: number, f: (i: number) => number) => Array.from({ length: n }, (_, i) => f(i));

describe('event detection', () => {
  test('mag out / in / seat and a racked bolt', () => {
    const n = 80;
    // Seated → pulled out (frames 10..20) → away → new mag in (50..60) → seated.
    const dist = ramp(n, (i) =>
      i < 10 ? 0 : i < 20 ? (i - 10) * 0.02 : i < 50 ? 0.3 : i < 60 ? 0.2 - (i - 50) * 0.02 : 0,
    );
    const bolt = ramp(n, (i) => (i < 65 ? 0 : i < 68 ? (i - 64) / 3 : i < 72 ? 1 : 0));
    const ev = detectEvents({ fps, mags: [{ dist }], bolt, platform: 'rifle' });
    const names = ev.map((e) => e.name);
    expect(names).toEqual(['magRelease', 'magOut', 'magIn', 'magSeat', 'chargingHandle', 'boltRelease']);
    expect(ev[0].t).toBeCloseTo(10 / fps, 4);
    expect(ev[3].t).toBeCloseTo(60 / fps, 4);
  });

  test('a shot does not count as a rack; pistol release is a slideRelease', () => {
    const n = 40;
    const trigger = ramp(n, (i) => (i === 5 ? 1 : 0));
    const bolt = ramp(n, (i) => (i === 6 ? 1 : i < 30 ? 0 : i < 34 ? 1 : 0));
    const ev = detectEvents({ fps, mags: [], bolt, trigger, platform: 'pistol' });
    expect(ev.map((e) => e.name)).toEqual(['fire', 'chargingHandle', 'slideRelease']);
  });

  test('a teleported (parked) mag is not a mag-in', () => {
    const dist = ramp(30, (i) => (i < 15 ? 1.5 : 0));
    expect(detectEvents({ fps, mags: [{ dist }], platform: 'rifle' }).length).toBe(0);
  });
});

describe('timeline split', () => {
  test('labels draw, idle, shot, reloads, inspect, holster', () => {
    const n = 200;
    const rest = new Array(n).fill(0);
    const trigger = new Array(n).fill(0);
    const bolt = new Array(n).fill(0);
    const mag = new Array(n).fill(0);
    const act = (a: number, b: number) => {
      for (let i = a; i < b; i++) rest[i] = 0.2;
    };
    act(0, 20); // draw
    act(40, 60); // inspect
    trigger[80] = 1; // shot
    bolt[81] = 0.6;
    act(100, 130); // tactical reload
    for (let i = 110; i < 120; i++) mag[i] = 0.2;
    trigger[140] = 1; // last shot: slide locks
    for (let i = 141; i < 175; i++) bolt[i] = 1;
    act(150, 175); // empty reload
    for (let i = 155; i < 165; i++) mag[i] = 0.2;
    act(190, 200); // holster
    const segs = splitTimeline({ restDist: rest, trigger, bolt, magDist: mag });
    const labels = segs.map((s) => s.label);
    for (const l of [
      'draw',
      'inspect',
      'shoot',
      'reloadTactical',
      'shootLast',
      'reloadEmpty',
      'holster',
      'idle',
    ])
      expect(labels).toContain(l);
    const tac = segs.find((s) => s.label === 'reloadTactical')!;
    expect(tac.f0).toBeLessThanOrEqual(100);
    expect(tac.f1).toBeGreaterThanOrEqual(129);
  });

  test('smooth keeps the mean of a constant', () => {
    expect(Array.from(smooth([1, 1, 1, 1], 2))).toEqual([1, 1, 1, 1]);
  });
});

/** Minimal synthetic source clip: 1 bone, bolt channel = time. */
function synthClip(id: string, dur: number, events: { name: string; t: number }[] = []): Clip {
  const L = makeLayout(['A']);
  const frames = Math.round(dur * 30) + 1;
  const data = new Float32Array(frames * L.stride);
  for (let f = 0; f < frames; f++) {
    data[f * L.stride + L.rot + 3] = 1;
    data[f * L.stride + L.gunHand + 6] = 1;
    data[f * L.stride + L.gunRoot + 6] = 1;
    for (const m of L.mag) {
      data[f * L.stride + m.gun + 6] = 1;
      data[f * L.stride + m.hand + 6] = 1;
    }
    data[f * L.stride + L.ch.bolt] = f / 30;
  }
  return { id, action: id, pack: 'x', fps: 30, frames, duration: (frames - 1) / 30, layout: L, data, events };
}

describe('composition', () => {
  const clips = { a: synthClip('a', 1, [{ name: 'magOut', t: 0.5 }]), b: synthClip('b', 1) };

  test('trim, speed, hold and blend durations; events remapped', () => {
    const c = compose(
      'x',
      'reloadEmpty',
      {
        segs: [{ clip: 'a', t0: 0.2, t1: 0.8 }, { hold: 0.3 }, { blend: 0.2 }, { clip: 'b', t0: 0, t1: 0.5 }],
        speed: 2,
      },
      clips,
    );
    expect(c.duration).toBeCloseTo((0.6 + 0.3 + 0.2 + 0.5) / 2, 1);
    expect(c.events).toEqual([{ name: 'magOut', t: (0.5 - 0.2) / 2 }]);
    const L = c.layout;
    // During the hold the bolt channel (= source time) stays at 0.8.
    const f = Math.round(0.4 * 30);
    expect(c.data[f * L.stride + L.ch.bolt]).toBeCloseTo(0.8, 2);
  });

  test('reverse segments mirror time and events', () => {
    const c = compose('x', 'magCheck', { segs: [{ clip: 'a', t0: 1, t1: 0 }] }, clips);
    expect(c.events[0].t).toBeCloseTo(0.5, 5);
    expect(c.data[c.layout.ch.bolt]).toBeCloseTo(1, 2);
  });

  test('bolt override keys and a synthetic mag drop', () => {
    const c = compose(
      'x',
      'r',
      {
        segs: [{ clip: 'a' }],
        bolt: [
          { t: 0, v: 1 },
          { t: 0.5, v: 1 },
          { t: 0.6, v: 0 },
        ],
        magDrop: { t: 0 },
      },
      clips,
    );
    const L = c.layout;
    expect(c.data[3 * L.stride + L.ch.bolt]).toBe(1);
    expect(c.data[3 * L.stride + L.mag[1].vis]).toBe(1);
    expect(c.data[3 * L.stride + L.mag[1].gun + 1]).toBeLessThan(0);
    expect(c.data[29 * L.stride + L.mag[1].vis]).toBe(0);
  });
});

describe('library table', () => {
  test('every weapon defines every action; families differ', () => {
    for (const w of Object.values(WEAPON_ANIMS)) for (const a of ACTIONS) expect(w.clips[a]).toBeDefined();
    // AR slap vs AK rack vs HK slap: different empty reloads.
    expect(WEAPON_ANIMS.sb16.clips.reloadEmpty.handL?.[0].at).toBe('boltCatch');
    expect(WEAPON_ANIMS.kp9.clips.reloadEmpty.handL?.[0].at).toBe('chargingHandle');
    expect(WEAPON_ANIMS.k47s.clips.reloadEmpty.handL).toBeUndefined();
    expect(WEAPON_ANIMS.sb16.clips.reloadTactical.magStyle).toBe('straight');
    expect(WEAPON_ANIMS.k47s.clips.reloadTactical.magStyle).toBe('rock');
    expect(WEAPON_ANIMS.hb300.clips.reloadEmpty.speed!).toBeGreaterThan(
      WEAPON_ANIMS.sb16.clips.reloadEmpty.speed!,
    );
    expect(WEAPON_ANIMS.p17.pack).toBe('beretta');
  });

  test('rifle speed reloads: faster than the tactical, punch on the seat, per-family finishers', () => {
    const t = (id: string, a: 'reloadSpeed' | 'reloadTactical' | 'reloadEmpty', name: string) => {
      const r = WEAPON_ANIMS[id].clips[a];
      const e = r.events?.find((x) => x.name === name);
      return e ? e.t / (r.speed ?? 1) : NaN;
    };
    for (const id of ['sb16', 'hb300', 'k47s', 'kp9']) {
      const sp = WEAPON_ANIMS[id].clips.reloadSpeed;
      // The source's own seat marker (AK pack) or an authored one: either way well under a second.
      expect(sp.speed!).toBeGreaterThan(WEAPON_ANIMS[id].clips.reloadTactical.speed ?? 1);
      expect(sp.tilt?.length).toBeGreaterThan(4);
      expect(sp.drop).toBeDefined();
      expect(t(id, 'reloadSpeed', 'magOut')).toBeLessThan(0.5);
    }
    // AK: the old mag stays seated until the fresh one knocks it out; HK flicks it; AR lets it fall.
    expect(WEAPON_ANIMS.k47s.clips.reloadSpeed.magDrop?.hold).toBe(true);
    expect(WEAPON_ANIMS.kp9.clips.reloadSpeed.drop![0]).toBeLessThan(-1);
    expect(WEAPON_ANIMS.sb16.clips.reloadSpeed.magDrop?.hold).toBeFalsy();
    // Empty finishers: bolt catch slap (AR), handle cock + slap (HK), rack (AK, from the source).
    expect(t('sb16', 'reloadEmpty', 'boltRelease')).toBeGreaterThan(0);
    expect(t('kp9', 'reloadEmpty', 'chargingHandle')).toBeLessThan(t('kp9', 'reloadEmpty', 'boltRelease'));
  });

  test('swaps carry swapMid / slingDrop / holsterClear', () => {
    const names = (id: string, a: 'swapOut' | 'swapIn') =>
      (WEAPON_ANIMS[id].clips[a].events ?? []).map((e) => e.name);
    expect(names('sb16', 'swapOut')).toEqual(expect.arrayContaining(['slingDrop', 'swapMid']));
    expect(names('p17', 'swapOut')).toEqual(expect.arrayContaining(['holsterClear', 'swapMid']));
    expect(names('p17', 'swapIn')).toContain('holsterClear');
  });

  test('unknown weapons fall back by family', () => {
    expect(weaponAnims('revolver').pack).toBe('beretta');
    expect(weaponAnims('shotgun').pack).toBe('ak');
  });
});
