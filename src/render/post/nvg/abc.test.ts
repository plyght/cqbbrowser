import { expect, test } from 'bun:test';
import { ABC_DEFAULTS, abcNoise, abcStep, abcTarget } from './abc';

const settle = (ev: number, meter: number, secs: number) => {
  for (let t = 0; t < secs; t += 1 / 60) ev = abcStep(ev, meter, 1 / 60);
  return ev;
};

test('ABC normalises a dim room to the target output', () => {
  const meter = Math.log2(0.004);
  const ev = settle(0, meter, 3);
  expect(0.004 * 2 ** ev).toBeCloseTo(ABC_DEFAULTS.target, 2);
});

test('gain is capped: a black room stays dark (and noisy)', () => {
  const ev = settle(0, Math.log2(1e-6), 5);
  expect(ev).toBeCloseTo(ABC_DEFAULTS.maxEv, 3);
  expect(1e-6 * 2 ** ev).toBeLessThan(0.01);
  expect(abcNoise(ev)).toBeCloseTo(1, 3);
  expect(abcNoise(0)).toBe(0);
});

test('bright source: gain drops fast (BSP), recovers slowly', () => {
  const dark = Math.log2(0.003);
  const ev0 = settle(0, dark, 3);
  // 100 ms of a very bright scene.
  let ev = ev0;
  for (let i = 0; i < 6; i++) ev = abcStep(ev, Math.log2(40), 1 / 60);
  const dropped = ev0 - ev;
  expect(dropped).toBeGreaterThan(5);
  // 100 ms back in the dark: climbs back much less than it dropped.
  const evDown = ev;
  for (let i = 0; i < 6; i++) ev = abcStep(ev, dark, 1 / 60);
  expect(ev - evDown).toBeLessThan(dropped * 0.5);
  expect(abcTarget(Math.log2(1e4))).toBe(ABC_DEFAULTS.minEv);
});

test('user gain knob shifts the output', () => {
  const p = { ...ABC_DEFAULTS, userEv: 1 };
  const meter = Math.log2(0.01);
  expect(abcTarget(meter, p) - abcTarget(meter)).toBeCloseTo(1, 6);
});
