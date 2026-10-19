import { expect, test } from 'bun:test';
import { Magazines } from './Magazines';

test('fire consumes and empties', () => {
  const m = new Magazines(3, 1);
  expect(m.rounds).toBe(4);
  for (let i = 0; i < 4; i++) expect(m.fire()).toBe(true);
  expect(m.fire()).toBe(false);
  expect(m.empty).toBe(true);
});
test('tactical retains partial, speed drops it', () => {
  const m = new Magazines(30, 2);
  for (let i = 0; i < 10; i++) m.fire();
  expect(m.swap(true)).toBeNull();
  expect(m.dump.length).toBe(1);
  expect(m.dump[0].rounds).toBe(20);
  const dropped = m.swap(false);
  expect(dropped?.rounds).toBe(30);
});
test('empty reload needs chamber', () => {
  const m = new Magazines(2, 1);
  while (m.fire());
  m.swap(false);
  expect(m.chambered).toBe(false);
  m.chamber();
  expect(m.rounds).toBe(2);
});
