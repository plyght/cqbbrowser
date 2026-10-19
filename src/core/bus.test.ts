import { expect, test } from 'bun:test';
import { Bus } from './bus';

test('a throwing listener does not stop later listeners or the emitter', () => {
  const bus = new Bus();
  const seen: string[] = [];
  const orig = console.error;
  console.error = () => {};
  bus.on('timerBeep', () => {
    throw new Error('boom');
  });
  bus.on('timerBeep', (e) => seen.push(e.kind));
  expect(() => bus.emit('timerBeep', { kind: 'start' })).not.toThrow();
  console.error = orig;
  expect(seen).toEqual(['start']);
});
