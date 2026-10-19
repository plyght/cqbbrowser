import { expect, test } from 'bun:test';
import { pips, postureKey, postureLabel, weaponLabel } from './hudText';

test('pips', () => {
  expect(
    pips([
      { rounds: 30, capacity: 30 },
      { rounds: 12, capacity: 30 },
      { rounds: 0, capacity: 30 },
    ]),
  ).toEqual(['full', 'half', 'empty']);
});

test('weapon label', () => {
  expect(weaponLabel('HB-300 PDW (.300 BLK, integral can)', 'auto')).toBe('HB-300 · AUTO');
});

test('posture', () => {
  const p = { lean: 0.9, crouch: 1, ready: 'low' };
  expect(postureLabel(p)).toBe('LEAN R · CROUCH · LOW READY');
  expect(postureLabel({ lean: 0.1, crouch: 0, ready: 'high' })).toBe('STAND · HIGH READY');
  // Small smoothing changes don't retrigger.
  expect(postureKey({ ...p, lean: 0.8 })).toBe(postureKey(p));
  expect(postureKey({ ...p, lean: -0.8 })).not.toBe(postureKey(p));
});
