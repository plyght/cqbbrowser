import { describe, expect, test } from 'bun:test';
import {
  flashHearing,
  flashVisual,
  Fuse,
  FUSE_S,
  whiteoutAt,
  whiteoutShape,
  type FlashGeometry,
} from './flash';

const base: FlashGeometry = { distance: 3, los: true, cosAngle: 1, indoor: true, sameRoom: true };

describe('fuse', () => {
  test('does nothing until the spoon flies, then fires once at ~1.5 s', () => {
    const f = new Fuse();
    expect(f.length).toBe(FUSE_S);
    for (let i = 0; i < 300; i++) expect(f.update(1 / 60)).toBe(false);
    f.arm();
    let fired = -1;
    for (let i = 0; i < 200; i++) if (f.update(1 / 60) && fired < 0) fired = (i + 1) / 60;
    expect(fired).toBeCloseTo(1.5, 1);
    expect(f.fired).toBe(true);
    expect(f.update(1 / 60)).toBe(false);
  });

  test('cooking eats the fuse', () => {
    const f = new Fuse();
    f.arm();
    for (let i = 0; i < 60; i++) f.update(1 / 60);
    expect(f.cooked).toBeCloseTo(1, 3);
    let t = 0;
    while (!f.update(1 / 60)) t += 1 / 60;
    expect(t).toBeCloseTo(0.5, 1);
  });
});

describe('exposure model', () => {
  test('closer and dead-ahead is worse; saturates in a small room', () => {
    const close = flashVisual({ ...base, distance: 1.5 });
    const far = flashVisual({ ...base, distance: 12 });
    expect(close).toBeGreaterThan(0.95);
    expect(far).toBeLessThan(close);
    const ahead = flashVisual({ ...base, distance: 8, sameRoom: false, indoor: false });
    const behind = flashVisual({ ...base, distance: 8, sameRoom: false, indoor: false, cosAngle: -1 });
    expect(behind).toBeLessThan(ahead);
  });

  test('a wall in between: much weaker, but bounce light in the same room still gets you', () => {
    const los = flashVisual({ ...base, distance: 4, sameRoom: false });
    const walled = flashVisual({ ...base, distance: 4, los: false, sameRoom: false });
    expect(walled).toBeLessThan(los * 0.5);
    const roomBehind = flashVisual({ ...base, distance: 4, los: false, cosAngle: -1, sameRoom: true });
    expect(roomBehind).toBeGreaterThan(walled * 2);
    // Outdoors behind cover is nearly nothing.
    expect(flashVisual({ ...base, distance: 6, los: false, indoor: false, sameRoom: false })).toBeLessThan(
      0.1,
    );
  });

  test('falloff is monotonic with distance', () => {
    let prevV = 2,
      prevH = 2;
    for (let d = 0.5; d < 40; d *= 1.3) {
      const v = flashVisual({ ...base, distance: d });
      const h = flashHearing({ ...base, distance: d });
      expect(v).toBeLessThanOrEqual(prevV + 1e-9);
      expect(h).toBeLessThanOrEqual(prevH + 1e-9);
      prevV = v;
      prevH = h;
    }
  });

  test('hearing: indoors is deafening, walls and open air help, training sim is milder', () => {
    const inRoom = flashHearing({ ...base, distance: 4 });
    const outside = flashHearing({ ...base, distance: 4, indoor: false, sameRoom: false });
    const nextRoom = flashHearing({ ...base, distance: 4, los: false, sameRoom: false });
    expect(inRoom).toBeGreaterThan(outside);
    expect(nextRoom).toBeLessThan(inRoom);
    expect(flashHearing({ ...base, distance: 4, training: true })).toBeLessThan(inRoom);
    expect(flashVisual({ ...base, distance: 4, training: true })).toBeLessThan(
      flashVisual({ ...base, distance: 4 }),
    );
  });

  test('white-out holds, then decays; stronger exposures last longer', () => {
    const v = 0.95;
    const { hold } = whiteoutShape(v);
    expect(whiteoutAt(v, 0)).toBeCloseTo(1, 5);
    expect(whiteoutAt(v, hold * 0.9)).toBeCloseTo(1, 5);
    expect(whiteoutAt(v, hold + 1.5)).toBeLessThan(0.6);
    expect(whiteoutAt(v, 8)).toBeLessThan(0.05);
    expect(whiteoutAt(0.3, 1.0)).toBeLessThan(whiteoutAt(0.9, 1.0));
    expect(whiteoutAt(v, -1)).toBe(0);
  });
});
