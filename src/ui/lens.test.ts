import { expect, test } from 'bun:test';
import { barrel, unbarrel } from './lens';

test('barrel keeps the centre fixed and magnifies it', () => {
  const [u, v] = barrel(0.5, 0.5, 0.28, 16 / 9);
  expect(u).toBeCloseTo(0.5, 6);
  expect(v).toBeCloseTo(0.5, 6);
  // Near the centre the output is magnified (scene uv moves less than output uv).
  const [nu] = barrel(0.55, 0.5, 0.28, 16 / 9);
  expect(nu - 0.5).toBeLessThan(0.05);
});

test('unbarrel inverts barrel', () => {
  for (const k of [0, 0.15, 0.28, 0.45]) {
    for (const [u, v] of [
      [0.5, 0.5],
      [0.62, 0.3],
      [0.2, 0.8],
      [0.95, 0.1],
    ]) {
      const [su, sv] = barrel(u, v, k, 16 / 9);
      const [ou, ov] = unbarrel(su, sv, k, 16 / 9);
      expect(ou).toBeCloseTo(u, 4);
      expect(ov).toBeCloseTo(v, 4);
    }
  }
});

test('a scene point off-centre appears further out on the warped frame', () => {
  const [ou] = unbarrel(0.6, 0.5, 0.28, 16 / 9);
  expect(ou).toBeGreaterThan(0.6);
});
