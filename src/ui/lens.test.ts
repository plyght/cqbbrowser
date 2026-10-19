import { expect, test } from 'bun:test';
import { Uniform, Vector4 } from 'three';
import { fitScale } from '../render/post/lens';
import { barrel, lensFrom, unbarrel, type Lens } from './lens';

const aspect = 16 / 9;
const lens: Lens = { k1: 0.11, k2: 0.025, scale: fitScale(0.11, 0.025, aspect, 1.78), circle: 1.78, aspect };

test('lensFrom reads the CAM04 uLens uniform', () => {
  const u = new Map([['uLens', new Uniform(new Vector4(0.11, 0.025, lens.scale, 1.78))]]);
  const l = lensFrom(u, aspect);
  expect(l.k1).toBe(0.11);
  expect(l.scale).toBeCloseTo(lens.scale, 9);
  expect(lensFrom(new Map(), aspect).k1).toBe(0);
});

test('barrel keeps the centre fixed and magnifies it', () => {
  const [u, v] = barrel(0.5, 0.5, lens);
  expect(u).toBeCloseTo(0.5, 6);
  expect(v).toBeCloseTo(0.5, 6);
  const [nu] = barrel(0.55, 0.5, lens);
  expect(nu - 0.5).toBeLessThan(0.05);
});

test('unbarrel inverts barrel (HUD matches the shader)', () => {
  for (const [u, v] of [
    [0.5, 0.5],
    [0.62, 0.3],
    [0.2, 0.8],
    [0.95, 0.1],
  ]) {
    const [su, sv] = barrel(u, v, lens);
    const [ou, ov] = unbarrel(su, sv, lens);
    expect(ou).toBeCloseTo(u, 5);
    expect(ov).toBeCloseTo(v, 5);
  }
});

test('a scene point off-centre appears further out on the warped frame', () => {
  const [ou] = unbarrel(0.6, 0.5, lens);
  expect(ou).toBeGreaterThan(0.6);
});
