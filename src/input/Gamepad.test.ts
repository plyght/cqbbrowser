import { expect, test } from 'bun:test';
import { emptyFrame, type PollInfo } from './actions';
import { PAD } from './bindings';
import { Gamepad, padActive, readyCycle, stickLookRate, type PadLike } from './Gamepad';
import { TurnRamp } from './stick';

const opts = {
  inner: 0.08,
  outer: 0.97,
  axial: 0,
  anti: 0,
  curve: 'exponential' as const,
  exponent: 1.8,
  yawSpeed: 330,
  pitchSpeed: 230,
  invertY: false,
};

function fakePad(): PadLike & { buttons: { pressed: boolean; value: number }[]; axes: number[] } {
  return {
    id: 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e)',
    index: 0,
    connected: true,
    mapping: 'standard',
    axes: [0, 0, 0, 0],
    buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })),
  };
}

const press = (p: ReturnType<typeof fakePad>, i: number, v = 1) =>
  (p.buttons[i] = { pressed: v > 0.5, value: v });

test('look rate: full right deflection = yawSpeed, ramp boosts after delay, pitch up on stick up', () => {
  const ramp = new TurnRamp();
  const r = stickLookRate(1, 0, opts, ramp, 1 / 60);
  expect(r.yaw).toBeCloseTo((330 * Math.PI) / 180, 6);
  for (let i = 0; i < 30; i++) stickLookRate(1, 0, opts, ramp, 1 / 60);
  expect(stickLookRate(1, 0, opts, ramp, 1 / 60).yaw).toBeCloseTo((330 * 1.7 * Math.PI) / 180, 6);
  expect(stickLookRate(0, -1, opts, new TurnRamp(), 1 / 60).pitch).toBeGreaterThan(0);
  expect(stickLookRate(0, -1, { ...opts, invertY: true }, new TurnRamp(), 1 / 60).pitch).toBeLessThan(0);
  expect(stickLookRate(0.05, 0.05, opts, new TurnRamp(), 1 / 60)).toEqual({ yaw: 0, pitch: 0, intensity: 0 });
  // Exponential: half deflection is much slower than half speed.
  const half = stickLookRate(0.525, 0, opts, new TurnRamp(), 1 / 60).yaw / ((330 * Math.PI) / 180);
  expect(half).toBeCloseTo(Math.pow(0.5, 1.8), 4);
});

test('ready cycle presses follow the player rules', () => {
  const step = (r: PollInfo['ready'], a: string): PollInfo['ready'] =>
    a === 'readyUp' ? (r === 'low' ? 'high' : 'compressed') : r === 'compressed' ? 'high' : 'low';
  let r: PollInfo['ready'] = 'high';
  const seen: string[] = [];
  for (let i = 0; i < 3; i++) {
    for (const a of readyCycle(r)) r = step(r, a);
    seen.push(r);
  }
  expect(seen).toEqual(['low', 'compressed', 'high']);
});

test('binding resolution: buttons → actions, triggers → analog axes, sticks → move/look', () => {
  const pad = fakePad();
  const gp = new Gamepad(undefined, () => [pad]);
  const info: PollInfo = { aiming: false, ready: 'high' };
  const poll = () => {
    const f = emptyFrame();
    gp.poll(f, 1 / 60, info);
    return f;
  };
  pad.axes = [0, -1, 1, 0];
  press(pad, PAD.X);
  press(pad, PAD.A);
  press(pad, PAD.LB);
  press(pad, PAD.RT, 0.8);
  press(pad, PAD.LT, 0.4);
  const f = poll();
  expect(f.activeDevice).toBe('gamepad');
  expect(f.move.y).toBeCloseTo(1, 6);
  expect(f.look.yaw).toBeGreaterThan(0);
  expect([...f.down].sort()).toEqual(['interact', 'leanLeft', 'reload']);
  expect(f.fireAxis).toBeGreaterThan(0.7);
  expect(f.aimAxis).toBeGreaterThan(0.3);
  expect(gp.padType).toBe('xbox');

  // Crouch hybrid: tap B → one press.
  pad.buttons.forEach((_, i) => press(pad, i, 0));
  pad.axes = [0, 0, 0, 0];
  press(pad, PAD.B);
  expect(poll().pressed.has('crouch')).toBe(true);
  expect(poll().pressed.has('crouch')).toBe(false);
  press(pad, PAD.B, 0);
  expect(poll().pressed.has('crouch')).toBe(false);

  // D-pad up tap → aimMode on release; hold → magnifier.
  press(pad, PAD.Up);
  expect(poll().pressed.has('aimMode')).toBe(false);
  press(pad, PAD.Up, 0);
  expect(poll().pressed.has('aimMode')).toBe(true);
  press(pad, PAD.Up);
  let mag = false;
  for (let i = 0; i < 20; i++) mag = poll().down.has('magnifier');
  expect(mag).toBe(true);
  press(pad, PAD.Up, 0);
  expect(poll().pressed.has('aimMode')).toBe(false);

  // View: restart only after a hold.
  press(pad, PAD.View);
  expect(poll().down.has('restart')).toBe(false);
  let restart = false;
  for (let i = 0; i < 60; i++) restart ||= poll().down.has('restart');
  expect(restart).toBe(true);
  press(pad, PAD.View, 0);

  // LS click latches sprint while pushing forward; releasing the stick cancels.
  pad.axes = [0, -1, 0, 0];
  press(pad, PAD.LS);
  expect(poll().down.has('sprint')).toBe(true);
  press(pad, PAD.LS, 0);
  expect(poll().down.has('sprint')).toBe(true);
  pad.axes = [0, 0, 0, 0];
  expect(poll().down.has('sprint')).toBe(false);
});

test('idle pads do not steal the active device; drift inside deadzone is ignored', () => {
  const pad = fakePad();
  pad.axes = [0.05, 0.04, -0.06, 0.02];
  expect(padActive(pad, 0.08)).toBe(false);
  const gp = new Gamepad(undefined, () => [pad]);
  const f = emptyFrame();
  gp.poll(f, 1 / 60);
  expect(f.activeDevice).toBe('keyboardMouse');
  expect(f.look).toEqual({ yaw: 0, pitch: 0 });
});

test('haptics use dual-rumble and trigger-rumble when supported', () => {
  const pad = fakePad();
  const calls: [string, Record<string, number>][] = [];
  pad.vibrationActuator = {
    effects: ['dual-rumble', 'trigger-rumble'],
    playEffect: (t, p) => {
      calls.push([t, p]);
      return Promise.resolve();
    },
  };
  const gp = new Gamepad(undefined, () => [pad]);
  press(pad, PAD.A);
  gp.poll(emptyFrame(), 1 / 60);
  gp.rumble(0.5, 0.25, 70);
  gp.triggerRumble(0, 1, 40);
  expect(calls.map((c) => c[0])).toEqual(['dual-rumble', 'trigger-rumble']);
  expect(calls[0][1].strongMagnitude).toBe(0.5);
  expect(calls[1][1].rightTrigger).toBe(1);
});
