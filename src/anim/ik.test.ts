import { describe, expect, test } from 'bun:test';
import { Vector3 } from 'three';
import { solveTwoBone } from './ik';

const mid = new Vector3();
const end = new Vector3();

describe('solveTwoBone', () => {
  test('reaches a reachable target and preserves bone lengths', () => {
    const root = new Vector3(0.2, 1.45, 0);
    const target = new Vector3(0.05, 1.3, -0.45);
    const ok = solveTwoBone(root, target, new Vector3(1, 0, 0), 0.3, 0.28, mid, end);
    expect(ok).toBe(true);
    expect(end.distanceTo(target)).toBeLessThan(1e-6);
    expect(mid.distanceTo(root)).toBeCloseTo(0.3, 6);
    expect(mid.distanceTo(end)).toBeCloseTo(0.28, 6);
  });

  test('bends toward the pole', () => {
    const root = new Vector3(0, 0, 0);
    const target = new Vector3(0, 0, -0.4);
    solveTwoBone(root, target, new Vector3(0, -1, 0), 0.3, 0.3, mid, end);
    expect(mid.y).toBeLessThan(-0.1);
    solveTwoBone(root, target, new Vector3(1, 0, -0.2), 0.3, 0.3, mid, end);
    expect(mid.x).toBeGreaterThan(0.1);
    expect(Math.abs(mid.y)).toBeLessThan(1e-6);
  });

  test('out of reach: straight chain toward target, lengths kept', () => {
    const root = new Vector3(0, 0, 0);
    const target = new Vector3(0, 0, -2);
    const ok = solveTwoBone(root, target, new Vector3(0, -1, 0), 0.3, 0.3, mid, end);
    expect(ok).toBe(false);
    expect(end.z).toBeCloseTo(-0.6, 3);
    expect(mid.distanceTo(root)).toBeCloseTo(0.3, 6);
    expect(mid.z).toBeCloseTo(-0.3, 2);
  });

  test('degenerate pole along the axis still yields a valid bend', () => {
    const root = new Vector3(0, 0, 0);
    const target = new Vector3(0, 0, -0.3);
    solveTwoBone(root, target, new Vector3(0, 0, -1), 0.3, 0.3, mid, end);
    expect(mid.distanceTo(root)).toBeCloseTo(0.3, 6);
    expect(end.distanceTo(target)).toBeLessThan(1e-6);
    expect(Number.isFinite(mid.x + mid.y + mid.z)).toBe(true);
  });

  test('too close: clamps to the minimum fold', () => {
    const root = new Vector3(0, 0, 0);
    const ok = solveTwoBone(root, new Vector3(0, 0, -0.001), new Vector3(0, -1, 0), 0.3, 0.25, mid, end);
    expect(ok).toBe(false);
    expect(mid.distanceTo(end)).toBeCloseTo(0.25, 5);
  });
});
