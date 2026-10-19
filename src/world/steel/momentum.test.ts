import { describe, expect, test } from 'bun:test';
import { bulletMomentum, flipSpeed, knocksDown, PLATE_ANY, POPPER_HEAVY, POPPER_STANDARD } from './momentum';
import { zoneAt } from '../paperZones';

const ke = (g: number, v: number) => 0.5 * (g / 1000) * v * v;
const p9 = bulletMomentum(ke(7.5, 360), 0.0075); // 9 mm
const p556 = bulletMomentum(ke(4, 790), 0.004);
const pBlk = bulletMomentum(ke(14.3, 310), 0.0143); // .300 BLK subsonic

describe('steel momentum rules', () => {
  test('momentum from energy and mass', () => {
    expect(p9).toBeCloseTo(7.5e-3 * 360, 5);
    expect(p556).toBeCloseTo(3.16, 2);
  });

  test('standard popper falls to 9 mm above the calibration line only', () => {
    expect(knocksDown(p9, 0.8, POPPER_STANDARD)).toBe(true);
    expect(knocksDown(p9, 0.4, POPPER_STANDARD)).toBe(false);
  });

  test('heavy popper: 9 mm only rings it, .300 BLK knocks it', () => {
    expect(knocksDown(p9, 1.0, POPPER_HEAVY)).toBe(false);
    expect(knocksDown(p9, 0.65, POPPER_HEAVY)).toBe(false);
    expect(knocksDown(pBlk, 0.65, POPPER_HEAVY)).toBe(true);
    // 5.56: lots of energy, little momentum — only a high hit topples heavy steel.
    expect(knocksDown(p556, 0.65, POPPER_HEAVY)).toBe(false);
  });

  test('rack plates fall to any solid hit', () => {
    expect(knocksDown(p9, 0.05, PLATE_ANY)).toBe(true);
    expect(knocksDown(0.5, 0.05, PLATE_ANY)).toBe(false);
  });

  test('paddle flip speed grows with rest angle', () => {
    expect(flipSpeed(1.05, 0.4)).toBeGreaterThan(flipSpeed(0.5, 0.4));
    expect(flipSpeed(0, 0.4)).toBe(0);
  });
});

describe('paper zones', () => {
  test('A / C / D / off', () => {
    expect(zoneAt(0, 0)).toBe('A'); // centre mass
    expect(zoneAt(0, 0.3)).toBe('A'); // head box
    expect(zoneAt(0.07, 0.31)).toBe('C'); // head, outside A
    expect(zoneAt(0.12, -0.05)).toBe('C');
    expect(zoneAt(0.2, -0.05)).toBe('D');
    expect(zoneAt(0.22, 0.36)).toBeNull(); // beside the head
    expect(zoneAt(0.3, 0)).toBeNull();
  });
});
