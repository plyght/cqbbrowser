import { describe, expect, test } from 'bun:test';
import { Quaternion, Vector3 } from 'three';
import { stepCasing, type CastFn, type Casing } from './Brass';

/** Infinite concrete floor at y = 0. */
const floor: CastFn = (o, d, max) => {
  if (d.y >= 0) return null;
  const t = -o.y / d.y;
  if (t < 0 || t > max) return null;
  return { point: o.clone().addScaledVector(d, t), normal: new Vector3(0, 1, 0), surface: 'concrete' };
};

function casing(): Casing {
  return {
    pos: new Vector3(0, 1.2, 0),
    prev: new Vector3(0, 1.2, 0),
    vel: new Vector3(2.5, 1.5, 0.3),
    rot: new Quaternion(),
    spin: new Vector3(3, 1, 30),
    state: 1,
    landed: false,
    kind: 'rifle',
    len: 0.045,
    radius: 0.005,
    bounces: 0,
  };
}

describe('brass', () => {
  test('lands once, bounces, then settles on its side', () => {
    const c = casing();
    let landings = 0;
    for (let i = 0; i < 60 * 4 && c.state === 1; i++) if (stepCasing(c, 1 / 60, floor)) landings++;
    expect(landings).toBe(1);
    expect(c.state).toBe(2);
    expect(c.bounces).toBeGreaterThan(1);
    expect(c.pos.y).toBeGreaterThanOrEqual(0);
    expect(c.pos.y).toBeLessThan(0.02);
    // Cylinder axis (local Y) lies horizontal.
    const axis = new Vector3(0, 1, 0).applyQuaternion(c.rot);
    expect(Math.abs(axis.y)).toBeLessThan(1e-6);
    // Thrown to the right.
    expect(c.pos.x).toBeGreaterThan(0.5);
  });
  test('never tunnels through the floor at high speed', () => {
    const c = casing();
    c.vel.set(0, -40, 0);
    for (let i = 0; i < 30; i++) {
      stepCasing(c, 1 / 60, floor);
      expect(c.pos.y).toBeGreaterThanOrEqual(-1e-6);
    }
  });
});
