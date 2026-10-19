import { expect, test } from 'bun:test';
import { AimAssist, assistStrength, fastTurnFade, frictionFactor } from './AimAssist';

const D = Math.PI / 180;

test('friction: full inside inner cone, fades to none at outer, off with no target', () => {
  expect(frictionFactor(0.5 * D, 0.35, 1.2 * D, 4.5 * D)).toBeCloseTo(0.65, 9);
  expect(frictionFactor(4.5 * D, 0.35, 1.2 * D, 4.5 * D)).toBe(1);
  expect(frictionFactor(Infinity, 0.35, 1.2 * D, 4.5 * D)).toBe(1);
  const mid = frictionFactor(2.85 * D, 0.35, 1.2 * D, 4.5 * D);
  expect(mid).toBeGreaterThan(0.65);
  expect(mid).toBeLessThan(1);
  expect(frictionFactor(0, 0, 1, 2)).toBe(1);
});

test('presets: standard light, arcade strong, hardcore off', () => {
  expect(assistStrength('standard', 0)).toBe(0.35);
  expect(assistStrength('arcade', 0)).toBeGreaterThan(0.35);
  expect(assistStrength('hardcore', 1)).toBe(0);
  expect(assistStrength('custom', 2)).toBe(1);
});

test('apply scales look only near targets and only when moving', () => {
  const a = new AimAssist();
  let calls = 0;
  a.provider = () => {
    calls++;
    return 0;
  };
  a.apply({ yaw: 0, pitch: 0 });
  expect(calls).toBe(0);
  const look = { yaw: 0.01, pitch: -0.02 };
  a.apply(look);
  expect(look.yaw).toBeCloseTo(0.0065, 9);
  expect(look.pitch).toBeCloseTo(-0.013, 9);
  a.provider = () => Infinity;
  const far = { yaw: 0.01, pitch: 0 };
  a.apply(far);
  expect(far.yaw).toBe(0.01);
});

test('friction fades out for full-speed turns', () => {
  expect(fastTurnFade(0.3)).toBe(1);
  expect(fastTurnFade(1)).toBe(0);
  const a = new AimAssist();
  a.provider = () => 0;
  const flick = { yaw: 0.1, pitch: 0 };
  a.apply(flick, 1);
  expect(flick.yaw).toBe(0.1);
});
