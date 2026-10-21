import { expect, test } from 'bun:test';
import { HELMET } from './Player';

test('helmet ADS never zooms like a scope', () => {
  expect(HELMET.fovNarrow).toBeGreaterThanOrEqual(0);
  expect(HELMET.fovNarrow).toBeLessThanOrEqual(5);
});

test('helmet head tuck is a few centimetres', () => {
  expect(HELMET.tuck).toBeGreaterThanOrEqual(0);
  expect(HELMET.tuck).toBeLessThanOrEqual(0.05);
});
