import { describe, expect, test } from 'bun:test';
import {
  analyseProbe,
  bankPosition,
  convolverMix,
  eyringRt60,
  OUTDOOR,
  probeDirections,
  PROBE_RAYS,
  roomAcoustics,
  sabineRt60,
  smoothAcoustics,
  smoothK,
} from './acoustics';
import { castScene, outdoorRange, room, roomWithDoor, type Aabb } from './probeScenes';

const ear = { x: 0, y: 1.6, z: 0 };
const probe = (boxes: Aabb[], o = ear) => analyseProbe(castScene(o, boxes));

describe('listener probe', () => {
  test('uses the ray budget and starts with up/down rays', () => {
    const d = probeDirections();
    expect(d.length).toBe(PROBE_RAYS);
    expect(d[0].y).toBe(1);
    expect(d[1].y).toBe(-1);
    for (const v of d) expect(Math.hypot(v.x, v.y, v.z)).toBeCloseTo(1, 5);
  });

  test('tiny concrete box is fully enclosed, small, boomy', () => {
    const a = probe(room(1.5, 1.5, 2.4));
    expect(a.enclosure).toBeGreaterThan(0.95);
    expect(a.ceiling).toBeCloseTo(0.8, 2);
    expect(a.volume).toBeGreaterThan(5.4 / 2);
    expect(a.volume).toBeLessThan(5.4 * 2);
    expect(a.bass).toBeGreaterThan(0.6);
    expect(a.roomMode).toBeGreaterThan(60);
    expect(a.taps.length).toBeGreaterThanOrEqual(4);
    expect(a.taps[0].delay).toBeLessThan(0.01);
  });

  test('outdoor range is open: low enclosure, sky above, slapback taps off the berms', () => {
    const a = probe(outdoorRange());
    expect(a.enclosure).toBeLessThan(0.3);
    expect(a.ceiling).toBe(Infinity);
    expect(a.bass).toBe(0);
    expect(a.openness.y).toBeGreaterThan(0.3);
    // A berm 27–30 m away → ~160–180 ms slapback.
    expect(a.taps.some((t) => t.delay > 0.14 && t.delay < 0.2)).toBe(true);
  });

  test('a big room has a longer RT60 than a carpeted small one', () => {
    const hall = probe(room(20, 30, 8));
    const carpet = probe(room(3, 3, 2.5, 'carpet'));
    expect(hall.rt60).toBeGreaterThan(carpet.rt60);
    expect(hall.volume).toBeGreaterThan(carpet.volume * 20);
  });

  test('openness points out of the doorway', () => {
    const a = probe(roomWithDoor(3, 3, 2.6), { x: 0, y: 1.6, z: 1.2 });
    expect(a.openness.z).toBeGreaterThan(0);
    expect(a.enclosure).toBeLessThan(1);
    expect(a.enclosure).toBeGreaterThan(0.6);
  });
});

describe('reverb bank', () => {
  test('bank position goes outdoor → booth', () => {
    expect(bankPosition(probe(outdoorRange()))).toBeLessThan(0.7);
    expect(bankPosition(probe(room(1.5, 1.5, 2.4)))).toBeGreaterThan(4.5);
    const r = bankPosition(probe(room(5, 4, 2.7)));
    expect(r).toBeGreaterThan(2.5);
    expect(r).toBeLessThan(4.6);
  });

  test('2-convolver crossfade is equal power and only swaps a buffer at ~zero weight', () => {
    let prev = convolverMix(0);
    for (let p = 0; p <= 5; p += 0.01) {
      const m = convolverMix(p);
      expect(m.a.gain ** 2 + m.b.gain ** 2).toBeCloseTo(1, 5);
      expect(m.a.index % 2).toBe(0);
      expect(m.b.index % 2).toBe(1);
      if (m.a.index !== prev.a.index) expect(Math.max(m.a.gain, prev.a.gain)).toBeLessThan(0.05);
      if (m.b.index !== prev.b.index) expect(Math.max(m.b.gain, prev.b.gain)).toBeLessThan(0.05);
      prev = m;
    }
  });
});

describe('room maths', () => {
  test('Eyring ≈ Sabine for low absorption, shorter for high', () => {
    expect(eyringRt60(100, 130, 0.05) / sabineRt60(100, 130, 0.05)).toBeGreaterThan(0.95);
    expect(eyringRt60(100, 130, 0.6)).toBeLessThan(sabineRt60(100, 130, 0.6));
  });

  test('authored room graph: open portals make a room leaky and shorten RT60', () => {
    const r = {
      id: 'bath',
      volume: 8,
      floorArea: 3,
      ceilingHeight: 2.5,
      surfaces: [{ bands: [0.02, 0.02, 0.03, 0.04] as [number, number, number, number], area: 24 }],
      min: { x: 0, y: 0, z: 0 },
      max: { x: 1, y: 2.5, z: 3 },
    };
    const door = {
      id: 'd',
      rooms: ['bath', 'outside'] as [string, string],
      area: 1.8,
      openness: 0,
      position: r.min,
    };
    const closed = roomAcoustics(r, [door]);
    const open = roomAcoustics(r, [{ ...door, openness: 1 }]);
    expect(open.leakiness).toBeGreaterThan(closed.leakiness);
    expect(open.rt60[1]).toBeLessThan(closed.rt60[1]);
    expect(closed.bass).toBeGreaterThan(open.bass);
  });

  test('smoothing morphs indoor → outdoor continuously', () => {
    let s = probe(room(1.5, 1.5, 2.4));
    const k = smoothK(0.1, 0.3);
    let last = s.enclosure;
    for (let i = 0; i < 30; i++) {
      s = smoothAcoustics(s, OUTDOOR, k);
      expect(s.enclosure).toBeLessThanOrEqual(last);
      expect(last - s.enclosure).toBeLessThan(0.3);
      last = s.enclosure;
    }
    expect(s.enclosure).toBeLessThan(0.01);
    expect(Number.isFinite(s.ceiling)).toBe(true);
  });
});
