import { expect, test } from 'bun:test';
import {
  buildKeyLookup,
  DEFAULT_KEY_BINDINGS,
  glyphFor,
  keyLabel,
  padTypeFromId,
  rebindKey,
} from './bindings';

test('key lookup resolves defaults and multi-bindings', () => {
  const m = buildKeyLookup(DEFAULT_KEY_BINDINGS, false);
  expect(m.get('KeyR')).toEqual(['reload']);
  expect(m.get('ControlLeft')).toEqual(['crouch']);
  expect(m.get('Mouse0')).toEqual(['fire']);
  expect(m.get('KeyX')).toEqual(['readyDown']);
  expect(m.get('KeyZ')).toBeUndefined();
});

test('snap turns shadow conflicting keys only when enabled', () => {
  const m = buildKeyLookup(DEFAULT_KEY_BINDINGS, true);
  expect(m.get('KeyX')).toEqual(['snapRight']);
  expect(m.get('KeyZ')).toEqual(['snapLeft']);
  expect(m.get('WheelDown')).toEqual(['readyDown']);
});

test('rebind moves a code between actions', () => {
  const b = rebindKey(DEFAULT_KEY_BINDINGS, 'reload', 'KeyG');
  expect(b.reload).toEqual(['KeyG']);
  const c = rebindKey(b, 'interact', 'KeyG');
  expect(c.reload).toEqual([]);
  expect(c.interact).toEqual(['KeyG']);
  const d = rebindKey(DEFAULT_KEY_BINDINGS, 'crouch', 'KeyK', 5);
  expect(d.crouch).toEqual(['KeyC', 'ControlLeft', 'KeyK']);
});

test('glyphs swap per device and pad family', () => {
  expect(glyphFor('reload', 'keyboardMouse')).toBe('R');
  expect(glyphFor('fire', 'keyboardMouse')).toBe('LMB');
  expect(glyphFor('reload', 'gamepad', 'xbox')).toBe('X');
  expect(glyphFor('reload', 'gamepad', 'playstation')).toBe('□');
  expect(glyphFor('interact', 'gamepad', 'playstation')).toBe('✕');
  expect(glyphFor('aim', 'trackpad')).toBe('2-Finger Click');
  expect(glyphFor('reload', 'trackpad')).toBe('R');
  expect(keyLabel('Digit1')).toBe('1');
});

test('pad family from id', () => {
  expect(padTypeFromId('DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)')).toBe(
    'playstation',
  );
  expect(padTypeFromId('Xbox 360 Controller (XInput STANDARD GAMEPAD)')).toBe('xbox');
  expect(padTypeFromId('045e-0b13-Xbox Wireless Controller')).toBe('xbox');
  expect(padTypeFromId('Pro Controller (STANDARD GAMEPAD Vendor: 057e Product: 2009)')).toBe('switch');
  expect(padTypeFromId('Some Pad')).toBe('generic');
});
