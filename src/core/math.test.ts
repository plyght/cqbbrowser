import { describe, expect, test } from 'bun:test';
import { Spring, damp, rng, wrapAngle } from './math';

describe('math', () => {
  test('damp is 0.5 at one half-life', () => {
    expect(damp(0.1, 0.1)).toBeCloseTo(0.5, 6);
  });
  test('wrapAngle', () => {
    expect(wrapAngle(Math.PI * 2.5)).toBeCloseTo(Math.PI / 2, 6);
    expect(wrapAngle(-Math.PI * 1.5)).toBeCloseTo(Math.PI / 2, 6);
  });
  test('spring settles on target', () => {
    const s = new Spring(6, 1);
    for (let i = 0; i < 240; i++) s.step(1, 1 / 120);
    expect(s.value).toBeCloseTo(1, 3);
  });
  test('spring stable on huge dt', () => {
    const s = new Spring(18, 0.7);
    for (let i = 0; i < 20; i++) s.step(1, 0.1);
    expect(Math.abs(s.value - 1)).toBeLessThan(0.01);
  });
  test('rng deterministic', () => {
    const a = rng(42),
      b = rng(42);
    for (let i = 0; i < 5; i++) expect(a()).toBe(b());
  });
});
