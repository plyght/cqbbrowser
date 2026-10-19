import { describe, expect, test } from 'bun:test';
import { ceilingCurve, CEILING, saturationCurve } from './Mixer';

describe('mic output stage curves', () => {
  // Waveshaper input is pre-scaled by 1/4 (headroom): one step of an n-point curve spans 8 / (n − 1) of signal.
  const slopeAtZero = (c: Float32Array) =>
    (c[(c.length - 1) / 2 + 1] - c[(c.length - 1) / 2]) / (8 / (c.length - 1));

  test('ceiling is unity for small signals and never exceeds −1 dBFS', () => {
    const c = ceilingCurve(4097);
    expect(slopeAtZero(c)).toBeCloseTo(1, 2);
    for (const v of c) expect(Math.abs(v)).toBeLessThanOrEqual(CEILING);
    expect(c[c.length - 1]).toBeGreaterThan(CEILING * 0.99);
  });

  test('parallel saturation is unity for small signals and saturates at 1/drive', () => {
    const s = saturationCurve(2.5, 4097);
    expect(slopeAtZero(s)).toBeCloseTo(1, 2);
    for (const v of s) expect(Math.abs(v)).toBeLessThanOrEqual(1 / 2.5 + 1e-6);
  });
});
