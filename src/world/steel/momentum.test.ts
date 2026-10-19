import { describe, expect, test } from 'bun:test';
import { WEAPONS } from '../../weapons/defs';
import {
  bulletMomentum,
  flipSpeed,
  hitImpulse,
  knocksDown,
  PADDLE_FLIP,
  PLATE_ANY,
  POPPER_HEAVY,
  POPPER_STANDARD,
} from './momentum';
import { zoneAt } from '../paperZones';

// Impulse each default build delivers (muzzle velocity from the interior-ballistics model, 9 m is ~muzzle).
const ke = (g: number, v: number) => 0.5 * (g / 1000) * v * v;
const J = (id: string) => {
  const d = WEAPONS[id];
  return hitImpulse(ke(d.bulletMass, d.velocity), d.bulletMass / 1000);
};
const j9 = J('p17'); // 9 mm 124 gr from 4.5"
const jSmg = J('kp9'); // 9 mm 124 gr from 8.9"
const j556 = J('sb16'); // M855 from 10.3"
const jBlk = J('hb300'); // .300 BLK 220 gr subsonic from 6"
const jAk = J('k47s');

describe('steel momentum rules', () => {
  test('momentum from energy and mass', () => {
    expect(bulletMomentum(ke(7.5, 360), 0.0075)).toBeCloseTo(7.5e-3 * 360, 5);
    // Impulse = m·v·(1+e), e ≈ 0.3.
    expect(j9 / (8.035e-3 * WEAPONS.p17.velocity)).toBeGreaterThan(1.25);
    expect(j9 / (8.035e-3 * WEAPONS.p17.velocity)).toBeLessThan(1.36);
  });

  test('standard popper falls to 9 mm above the calibration line only', () => {
    expect(knocksDown(j9, 0.8, POPPER_STANDARD)).toBe(true);
    expect(knocksDown(j9, 0.62, POPPER_STANDARD)).toBe(true);
    expect(knocksDown(j9, 0.4, POPPER_STANDARD)).toBe(false);
  });

  test('heavy popper: 9 mm only rings it, .300 BLK subsonic knocks it', () => {
    expect(knocksDown(j9, 1.0, POPPER_HEAVY)).toBe(false);
    expect(knocksDown(j9, 0.65, POPPER_HEAVY)).toBe(false);
    expect(knocksDown(jSmg, 0.65, POPPER_HEAVY)).toBe(false);
    expect(knocksDown(jBlk, 0.62, POPPER_HEAVY)).toBe(true);
    expect(knocksDown(jBlk, 0.65, POPPER_HEAVY)).toBe(true);
    expect(knocksDown(jAk, 0.62, POPPER_HEAVY)).toBe(true);
    // 5.56: lots of energy, little momentum — it rings heavy steel like a 9 mm does.
    expect(knocksDown(j556, 0.65, POPPER_HEAVY)).toBe(false);
    expect(knocksDown(j556, 0.62, POPPER_HEAVY)).toBe(false);
  });

  test('rack plates fall to any solid hit; paddles flip to 9 mm', () => {
    expect(knocksDown(j9, 0.05, PLATE_ANY)).toBe(true);
    expect(knocksDown(0.5, 0.05, PLATE_ANY)).toBe(false);
    expect(j9).toBeGreaterThan(PADDLE_FLIP);
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
