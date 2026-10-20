import { afterAll, expect, test } from 'bun:test';
import { emptyFrame } from './actions';

/** Minimal event-target stand-ins: KeyboardMouse only needs add/remove listener on window and the canvas. */
type Fn = (e: unknown) => void;
const win: Record<string, Fn[]> = {};
const g = globalThis as unknown as Record<string, unknown>;
const prevAdd = g.addEventListener;
afterAll(() => {
  g.addEventListener = prevAdd;
});
g.addEventListener = (type: string, fn: Fn) => (win[type] ??= []).push(fn);
g.window ??= globalThis;
const el = {
  listeners: {} as Record<string, Fn[]>,
  addEventListener(type: string, fn: Fn) {
    (this.listeners[type] ??= []).push(fn);
  },
};
const fire = (target: Record<string, Fn[]>, type: string, e: object) =>
  target[type]?.forEach((f) => f({ type, preventDefault() {}, ...e }));

test('a press released before the next poll still registers for one frame (trackpad tap-to-click)', async () => {
  const { KeyboardMouse } = await import('./KeyboardMouse');
  const km = new KeyboardMouse(el as unknown as HTMLElement);
  // Tap-to-click: mousedown + mouseup between two frames.
  fire(el.listeners, 'mousedown', { button: 0 });
  fire(win, 'mouseup', { button: 0 });
  // Quick key tap: weapon switch.
  fire(win, 'keydown', { code: 'Digit2' });
  fire(win, 'keyup', { code: 'Digit2' });
  const f1 = emptyFrame();
  km.poll(f1, 1 / 60);
  expect(f1.down.has('fire')).toBe(true);
  expect(f1.down.has('switchWeapon')).toBe(true);
  // Released: gone on the next frame.
  const f2 = emptyFrame();
  km.poll(f2, 1 / 60);
  expect(f2.down.has('fire')).toBe(false);
  expect(f2.down.has('switchWeapon')).toBe(false);
});
