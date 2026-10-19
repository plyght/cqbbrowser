import { expect, test } from 'bun:test';
import { Vector3 } from 'three';
import { FLIP_S, NvgMount } from './nvg';
import { throwVelocity, UNDERHAND_MAX } from './throwables';

test('NVG mount: ~0.4 s flip, powers at the eye with a swirl, auto-off when flipped up', () => {
  const m = new NvgMount();
  expect(m.toggle()).toEqual(['flipStart']);
  const events: string[] = [];
  let t = 0;
  while (m.state !== 'down' && t < 2) {
    events.push(...m.update(1 / 60));
    t += 1 / 60;
  }
  expect(t).toBeCloseTo(FLIP_S, 1);
  expect(events).toContain('detentDown');
  expect(events).toContain('powerOn');
  expect(m.swirl).toBeGreaterThan(0.5);
  expect(m.power).toBeLessThan(0.2);
  for (let i = 0; i < 30; i++) m.update(1 / 60);
  expect(m.power).toBeCloseTo(1, 3);
  expect(m.swirl).toBeLessThan(0.01);
  expect(m.toggle()).toEqual(['flipStart', 'powerOff']);
  expect(m.power).toBe(0);
  for (let i = 0; i < 30; i++) m.update(1 / 60);
  expect(m.state).toBe('up');
  expect(m.flip).toBe(0);
});

test('NVG mount: reversing mid-flip goes back the way it came', () => {
  const m = new NvgMount();
  m.toggle();
  for (let i = 0; i < 12; i++) m.update(1 / 60);
  const mid = m.flip;
  expect(mid).toBeGreaterThan(0.3);
  m.toggle();
  m.update(1 / 60);
  expect(m.flip).toBeLessThan(mid);
  expect(m.state).toBe('raising');
});

test('throw: tap rolls it along the floor, a long hold winds up a faster lob', () => {
  const fwd = new Vector3(0, -0.2, -1).normalize();
  const up = new Vector3(0, 1, 0);
  const roll = throwVelocity(0.1, fwd, up);
  expect(roll.underhand).toBe(true);
  expect(Math.abs(roll.vel.y)).toBeLessThan(1);
  expect(Math.hypot(roll.vel.x, roll.vel.z)).toBeCloseTo(4.6, 1);
  const soft = throwVelocity(UNDERHAND_MAX + 0.05, fwd, up);
  const hard = throwVelocity(2, fwd, up);
  expect(soft.underhand).toBe(false);
  expect(hard.power).toBe(1);
  expect(hard.vel.length()).toBeGreaterThan(soft.vel.length());
  // Lobbed a bit above the line of sight.
  expect(hard.vel.clone().normalize().y).toBeGreaterThan(fwd.y);
});
