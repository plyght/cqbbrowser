import { expect, test } from 'bun:test';
import { applyCurve, axialDeadzone, curveVec, radialDeadzone, triggerAxis, TurnRamp } from './stick';

test('radial deadzone: inside inner → zero, rescales band, clamps at outer', () => {
  expect(radialDeadzone(0.05, 0.05, 0.08, 0.97)).toEqual({ x: 0, y: 0 });
  const mid = radialDeadzone(0.525, 0, 0.08, 0.97);
  expect(mid.x).toBeCloseTo(0.5, 5);
  expect(radialDeadzone(0.99, 0, 0.08, 0.97).x).toBe(1);
  // Direction preserved on diagonals.
  const d = radialDeadzone(0.5, 0.5, 0.08, 0.97);
  expect(d.x).toBeCloseTo(d.y, 9);
  expect(Math.hypot(d.x, d.y)).toBeCloseTo((Math.SQRT1_2 - 0.08) / 0.89, 5);
});

test('anti-deadzone lifts the first non-zero output', () => {
  const v = radialDeadzone(0.081, 0, 0.08, 0.97, 0.2);
  expect(v.x).toBeGreaterThanOrEqual(0.2);
});

test('axial deadzone', () => {
  expect(axialDeadzone(0.1, 0.15)).toBe(0);
  expect(axialDeadzone(-1, 0.15)).toBe(-1);
  expect(axialDeadzone(0.575, 0.15)).toBeCloseTo(0.5, 5);
});

test('curves: endpoints fixed, exponential is below linear in the middle', () => {
  for (const k of ['linear', 'exponential', 'classic', 'custom'] as const) {
    expect(applyCurve(0, k)).toBe(0);
    expect(applyCurve(1, k)).toBeCloseTo(1, 9);
  }
  expect(applyCurve(0.5, 'exponential', 1.8)).toBeCloseTo(Math.pow(0.5, 1.8), 9);
  expect(applyCurve(0.5, 'linear')).toBe(0.5);
  expect(applyCurve(0.5, 'classic')).toBeCloseTo(0.3 * 0.5 + 0.7 * 0.125, 9);
  expect(applyCurve(0.5, 'custom', 3)).toBeCloseTo(0.125, 9);
  const v = curveVec({ x: 0.3, y: 0.4 }, 'exponential', 2);
  expect(Math.hypot(v.x, v.y)).toBeCloseTo(0.25, 9);
});

test('turn ramp: delay, linear ramp, reset below threshold', () => {
  const r = new TurnRamp();
  expect(r.update(1, 0.1)).toBe(1); // 0.10 s < 0.12 delay
  expect(r.update(1, 0.145)).toBeCloseTo(1 + 0.7 * (0.125 / 0.25), 6); // 0.245 s held
  expect(r.update(1, 0.5)).toBeCloseTo(1.7, 9);
  expect(r.update(1, 0.016, 1)).toBeCloseTo(1.7, 9);
  expect(r.update(1, 0.016, -1)).toBe(1); // reversal through centre in one frame restarts
  expect(r.update(0.5, 0.016)).toBe(1);
  expect(r.update(1, 0.016)).toBe(1);
});

test('trigger axis deadzone', () => {
  expect(triggerAxis(0.03)).toBe(0);
  expect(triggerAxis(1)).toBe(1);
});
