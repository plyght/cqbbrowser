import { expect, test } from 'bun:test';
import { ReloadGesture } from './ReloadGesture';

const run = (g: ReloadGesture, seq: [boolean, number][]) => seq.flatMap(([d, t]) => g.update(d, t));

test('tap → tactical on release', () => {
  expect(
    run(new ReloadGesture(), [
      [true, 0.016],
      [true, 0.05],
      [false, 0.016],
    ]),
  ).toEqual(['tactical']);
});
test('double tap → tactical then speedUpgrade', () => {
  const g = new ReloadGesture();
  expect(
    run(g, [
      [true, 0.016],
      [false, 0.016],
      [false, 0.1],
      [true, 0.016],
      [false, 0.016],
    ]),
  ).toEqual(['tactical', 'speedUpgrade']);
});
test('hold → check start/end, no reload', () => {
  const g = new ReloadGesture();
  const seq: [boolean, number][] = [[true, 0.016]];
  for (let i = 0; i < 20; i++) seq.push([true, 0.016]);
  seq.push([false, 0.016]);
  expect(run(g, seq)).toEqual(['checkStart', 'checkEnd']);
});
