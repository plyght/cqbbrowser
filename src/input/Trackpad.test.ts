import { expect, test } from 'bun:test';
import {
  EdgeGlide,
  GestureStepper,
  precisionGain,
  SnapTurn,
  TrackpadDetector,
  TypingSuppressionDetector,
  type WheelSample,
} from './Trackpad';

const feedAll = (d: TrackpadDetector, xs: WheelSample[]) => xs.forEach((s) => d.feed(s));

test('detector: macOS-style trackpad scroll (small fractional high-frequency deltas, x+y) → detected', () => {
  const d = new TrackpadDetector();
  const xs: WheelSample[] = [];
  for (let i = 0; i < 20; i++)
    xs.push({ dx: i % 3 ? 0.5 : 0, dy: 2.25 + (i % 4) * 0.37, mode: 0, ctrl: false, t: i * 8 });
  feedAll(d, xs);
  expect(d.detected).toBe(true);
  expect(d.confidence).toBe(1);
});

test('detector: pinch (ctrl + fractional) is strong evidence', () => {
  const d = new TrackpadDetector();
  feedAll(d, [
    { dx: 0, dy: -1.3, mode: 0, ctrl: true, t: 0 },
    { dx: 0, dy: -2.7, mode: 0, ctrl: true, t: 10 },
  ]);
  expect(d.detected).toBe(true);
});

test('detector: mouse wheel notches (100 px, or line mode) → not detected', () => {
  const d = new TrackpadDetector();
  const xs: WheelSample[] = [];
  for (let i = 0; i < 30; i++)
    xs.push({ dx: 0, dy: 100, mode: 0, ctrl: false, t: i * 80, wheelDeltaY: -120 });
  feedAll(d, xs);
  expect(d.detected).toBe(false);
  const f = new TrackpadDetector();
  for (let i = 0; i < 30; i++) f.feed({ dx: 0, dy: 3, mode: 1, ctrl: false, t: i * 50 });
  expect(f.detected).toBe(false);
  // ctrl + mouse wheel (browser zoom shortcut) does not count as a pinch.
  const g = new TrackpadDetector();
  for (let i = 0; i < 10; i++) g.feed({ dx: 0, dy: 100, mode: 0, ctrl: true, t: i * 80 });
  expect(g.detected).toBe(false);
});

test('detector: switching back to a mouse flips detection off', () => {
  const d = new TrackpadDetector();
  for (let i = 0; i < 10; i++) d.feed({ dx: 0, dy: -1.5, mode: 0, ctrl: true, t: i * 10 });
  expect(d.detected).toBe(true);
  for (let i = 0; i < 20; i++) d.feed({ dx: 0, dy: 3, mode: 1, ctrl: false, t: 1000 + i * 60 });
  expect(d.detected).toBe(false);
});

test('gesture stepper: one step per gesture, inertial tail ignored, gap re-arms', () => {
  const g = new GestureStepper(60, 160);
  const steps: number[] = [];
  let t = 0;
  // Swipe + long inertial decay, events every 16 ms.
  for (let v = 30; v > 0.5; v *= 0.9, t += 16) steps.push(g.feed(v, t));
  expect(steps.filter((s) => s !== 0)).toEqual([1]);
  t += 300;
  steps.length = 0;
  for (let i = 0; i < 5; i++, t += 16) steps.push(g.feed(-20, t));
  expect(steps.filter((s) => s !== 0)).toEqual([-1]);
});

test('precision curve: slow < 1, mid = 1, fast boosted', () => {
  const o = { low: 0.65, mid: 450, boost: 0.35, high: 2200 };
  expect(precisionGain(0, o)).toBeCloseTo(0.65, 9);
  expect(precisionGain(450, o)).toBeCloseTo(1, 9);
  expect(precisionGain(5000, o)).toBeCloseTo(1.35, 9);
  expect(precisionGain(200, o)).toBeGreaterThan(0.65);
  expect(precisionGain(200, o)).toBeLessThan(1);
});

test('typing suppression: glide → keys down kill deltas → resume on release, twice → suspected', () => {
  const t = new TypingSuppressionDetector();
  const dt = 1 / 60;
  const episode = () => {
    for (let i = 0; i < 10; i++) t.update(dt, true, false); // gliding
    for (let i = 0; i < 40; i++) t.update(dt, false, true); // WASD held, deltas dead
    t.update(dt, false, false); // keys up
    t.update(dt, true, false); // deltas resume immediately
  };
  episode();
  expect(t.suspected).toBe(false);
  episode();
  expect(t.suspected).toBe(true);
});

test('typing suppression: normal play (looking while moving) never trips', () => {
  const t = new TypingSuppressionDetector();
  const dt = 1 / 60;
  for (let k = 0; k < 5; k++) {
    for (let i = 0; i < 10; i++) t.update(dt, true, false);
    for (let i = 0; i < 40; i++) t.update(dt, i % 5 === 0, true);
    t.update(dt, false, false);
    t.update(dt, true, false);
    // Or: stops looking before pressing keys.
    for (let i = 0; i < 30; i++) t.update(dt, false, false);
    for (let i = 0; i < 40; i++) t.update(dt, false, true);
    t.update(dt, false, false);
    t.update(dt, true, false);
  }
  expect(t.suspected).toBe(false);
});

test('edge glide continues a fast steady swipe that stops abruptly, cancels on new input', () => {
  const g = new EdgeGlide();
  const dt = 1 / 60;
  for (let i = 0; i < 10; i++) g.update(25, dt); // 1500 px/s
  let extra = 0;
  for (let i = 0; i < 6; i++) extra += g.update(0, dt);
  expect(g.active).toBe(true);
  expect(extra).toBeGreaterThan(50);
  g.update(-3, dt);
  expect(g.active).toBe(false);
  // Decelerating swipe → no glide.
  const h = new EdgeGlide();
  for (let v = 30; v > 3; v -= 3) h.update(v, dt);
  for (let i = 0; i < 6; i++) h.update(0, dt);
  expect(h.active).toBe(false);
});

test('snap turn emits exactly the requested angle over the duration', () => {
  const s = new SnapTurn();
  s.start(Math.PI / 2, 0.12);
  let sum = 0;
  let frames = 0;
  while (s.busy) {
    sum += s.step(1 / 60);
    frames++;
  }
  expect(sum).toBeCloseTo(Math.PI / 2, 9);
  expect(frames).toBe(8);
});
