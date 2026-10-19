import { expect, test } from 'bun:test';
import { FlipButton, HoldGate, ModalButton, TapHold } from './buttons';

const dt = 1 / 60;
const run = (b: { update(d: boolean, dt: number): unknown }, seq: [boolean, number][]) =>
  seq.flatMap(([d, n]) => Array.from({ length: n }, () => b.update(d, dt)));

test('ModalButton hold / toggle', () => {
  const h = new ModalButton('hold');
  expect(
    run(h, [
      [true, 2],
      [false, 1],
    ]),
  ).toEqual([true, true, false]);
  const t = new ModalButton('toggle');
  expect(
    run(t, [
      [true, 2],
      [false, 2],
      [true, 1],
      [false, 1],
    ]),
  ).toEqual([true, true, true, true, false, false]);
});

test('ModalButton hybrid: tap toggles, hold is momentary', () => {
  const b = new ModalButton('hybrid');
  run(b, [
    [true, 3],
    [false, 1],
  ]);
  expect(b.on).toBe(true); // tap → on
  run(b, [
    [true, 3],
    [false, 1],
  ]);
  expect(b.on).toBe(false); // tap again → off
  run(b, [
    [true, 30],
    [false, 1],
  ]);
  expect(b.on).toBe(false); // long hold → off on release
});

test('FlipButton emits presses for crouch hold/hybrid', () => {
  const count = (b: FlipButton, seq: [boolean, number][]) => run(b, seq).filter(Boolean).length;
  const tap: [boolean, number][] = [
    [true, 3],
    [false, 2],
  ];
  const long: [boolean, number][] = [
    [true, 30],
    [false, 2],
  ];
  expect(count(new FlipButton('toggle'), long)).toBe(1);
  expect(count(new FlipButton('hold'), tap)).toBe(2);
  expect(count(new FlipButton('hybrid'), tap)).toBe(1);
  expect(count(new FlipButton('hybrid'), long)).toBe(2);
});

test('TapHold splits tap and hold', () => {
  const th = new TapHold(0.25);
  let taps = 0;
  for (let i = 0; i < 5; i++) if (th.update(true, dt).tap) taps++;
  if (th.update(false, dt).tap) taps++;
  expect(taps).toBe(1);
  let held = false;
  for (let i = 0; i < 30; i++) held = th.update(true, dt).hold;
  expect(held).toBe(true);
  expect(th.update(false, dt).tap).toBe(false);
});

test('HoldGate', () => {
  const g = new HoldGate(0.5);
  expect(run(g, [[true, 29]]).some(Boolean)).toBe(false);
  expect(g.update(true, dt * 2)).toBe(true);
  expect(g.update(false, dt)).toBe(false);
});
