import { expect, test } from 'bun:test';
import { emptyFrame } from './actions';
import {
  AimAssist,
  assistRadius,
  fastTurnFade,
  frictionFactor,
  type AssistInput,
  type AssistScene,
  type AssistTarget,
} from './AimAssist';
import { ASSIST_CAPS, ASSIST_TUNE, type AssistMode } from './config';
import { Gamepad, type PadLike } from './Gamepad';
import { Trackpad } from './Trackpad';

const D = Math.PI / 180;
const DT = 1 / 60;

const dirOf = (yaw: number, pitch = 0) => ({
  x: Math.sin(yaw) * Math.cos(pitch),
  y: Math.sin(pitch),
  z: -Math.cos(yaw) * Math.cos(pitch),
});
const tgt = (id: string, x: number, y: number, z: number, noShoot = false): AssistTarget => ({
  id,
  pos: { x, y, z },
  radius: assistRadius('paper'),
  noShoot,
});

/** A player at the origin looking along bearing `yaw` (rad, right +) with the given targets. */
function rig(mode: AssistMode, targets: AssistTarget[]) {
  const a = new AimAssist(() => mode);
  const st = { yaw: 0, pitch: 0, ex: 0, ez: 0 };
  a.scene = (): AssistScene => {
    const d = dirOf(st.yaw, st.pitch);
    const eye = { x: st.ex, y: 0, z: st.ez };
    return { eye, camDir: d, muzzle: eye, boreDir: d, targets };
  };
  return { a, st };
}
const inp = (o: Partial<AssistInput> = {}): AssistInput => ({
  dt: DT,
  intensity: 0.3,
  move: 0,
  aiming: false,
  ...o,
});

/** Sweep the aim right at `rate` rad/s (the raw stick contribution) from -`from` to +`from`; returns frames spent. */
function sweep(mode: AssistMode, targets: AssistTarget[], rate: number, from = 12 * D) {
  const { a, st } = rig(mode, targets);
  st.yaw = -from;
  let frames = 0;
  let minK = 1;
  while (st.yaw < from && frames < 5000) {
    const look = { yaw: rate * DT, pitch: 0 };
    a.apply(look, inp());
    minK = Math.min(minK, a.lastFactor);
    st.yaw += look.yaw;
    frames++;
  }
  return { frames, minK };
}

test('friction: full inside inner, smooth fade to none at outer, none without a target', () => {
  expect(frictionFactor(0, 0.3, 0, 3.5 * D)).toBeCloseTo(0.7, 9);
  expect(frictionFactor(3.5 * D, 0.3, 0, 3.5 * D)).toBe(1);
  expect(frictionFactor(Infinity, 0.3, 0, 3.5 * D)).toBe(1);
  let prev = 0;
  for (let i = 0; i <= 35; i++) {
    const k = frictionFactor(i * 0.1 * D, 0.3, 0, 3.5 * D);
    expect(k).toBeGreaterThanOrEqual(prev - 1e-12);
    prev = k;
  }
  expect(fastTurnFade(0.3)).toBe(1);
  expect(fastTurnFade(1)).toBe(0);
});

test('tunes: Off does nothing, Light < Standard, slowdown is 25-35%, nothing exceeds the caps', () => {
  expect(ASSIST_TUNE.off).toEqual({ slow: 0, follow: 0, magnetDeg: 0 });
  expect(ASSIST_TUNE.light.slow).toBeGreaterThanOrEqual(0.25);
  expect(ASSIST_TUNE.standard.slow).toBeLessThanOrEqual(0.35);
  expect(ASSIST_TUNE.light.slow).toBeLessThan(ASSIST_TUNE.standard.slow);
  for (const m of ['off', 'light', 'standard'] as const) {
    const t = new AimAssist(() => m).tune();
    expect(t.slow).toBeLessThanOrEqual(ASSIST_CAPS.slow);
    expect(t.follow).toBeLessThanOrEqual(ASSIST_CAPS.follow);
    expect(t.magnetDeg).toBeLessThanOrEqual(ASSIST_CAPS.magnetDeg);
  }
});

test('sweeping a stick past a target takes measurably longer with assist, and Off is untouched', () => {
  const targets = [tgt('a', 0, 0, -10)];
  const rate = 40 * D; // moderate deflection, 40 deg/s
  const off = sweep('off', targets, rate);
  const light = sweep('light', targets, rate);
  const std = sweep('standard', targets, rate);
  const free = Math.round((24 * D) / (rate * DT));
  expect(Math.abs(off.frames - free)).toBeLessThanOrEqual(1);
  expect(off.minK).toBe(1);
  // Light: peak slowdown 25%, standard 35%; total sweep time grows by a few frames, standard more than light.
  expect(light.minK).toBeCloseTo(0.75, 2);
  expect(std.minK).toBeCloseTo(0.65, 2);
  expect(light.frames).toBeGreaterThanOrEqual(off.frames + 2);
  expect(std.frames).toBeGreaterThan(light.frames);
  // ...but it is light: well under a 20% longer sweep over a 24 degree arc.
  expect(std.frames).toBeLessThan(off.frames * 1.2);
});

test('slowdown falls off smoothly with angular distance from the hitbox edge', () => {
  const targets = [tgt('a', 0, 0, -10)];
  const { a, st } = rig('standard', targets);
  const ks: number[] = [];
  for (let deg = 0; deg <= 8; deg += 0.25) {
    st.yaw = deg * D;
    const look = { yaw: 0.01, pitch: 0 };
    a.apply(look, inp());
    ks.push(a.lastFactor);
  }
  expect(ks[0]).toBeCloseTo(0.65, 2);
  for (let i = 1; i < ks.length; i++) expect(ks[i]).toBeGreaterThanOrEqual(ks[i - 1] - 1e-9);
  expect(ks[ks.length - 1]).toBe(1);
  // Smooth: no step bigger than a few percent between 0.25 degree samples.
  for (let i = 1; i < ks.length; i++) expect(ks[i] - ks[i - 1]).toBeLessThan(0.06);
});

test('no assist for fast turns, with no look input, or when the target is off to the side', () => {
  const { a, st } = rig('standard', [tgt('a', 0, 0, -10)]);
  const flick = { yaw: 0.1, pitch: 0 };
  a.apply(flick, inp({ intensity: 1 }));
  expect(flick.yaw).toBe(0.1);
  const none = { yaw: 0, pitch: 0 };
  a.apply(none, inp());
  expect(none).toEqual({ yaw: 0, pitch: 0 });
  st.yaw = 40 * D;
  const away = { yaw: 0.01, pitch: 0 };
  a.apply(away, inp());
  expect(away.yaw).toBe(0.01);
});

test('no-shoot targets never produce slowdown, follow or magnetism', () => {
  const { a, st } = rig('standard', [tgt('ns', 0, 0, -10, true)]);
  st.yaw = 1 * D;
  const look = { yaw: 0.01, pitch: 0 };
  a.apply(look, inp({ move: 1 }));
  expect(look.yaw).toBe(0.01);
  expect(a.lastFactor).toBe(1);
  // Entering ADS next to a no-shoot: no pull either.
  a.apply({ yaw: 0, pitch: 0 }, inp({ aiming: false }));
  const l2 = { yaw: 0, pitch: 0 };
  a.apply(l2, inp({ aiming: true }));
  expect(l2).toEqual({ yaw: 0, pitch: 0 });
});

test('a shootable target is preferred over a no-shoot beside it', () => {
  const { a, st } = rig('standard', [tgt('ns', 0.5, 0, -10, true), tgt('ok', 4, 0, -10)]);
  st.yaw = 0.5 * D; // over the no-shoot, far from the good target
  const look = { yaw: 0.01, pitch: 0 };
  a.apply(look, inp());
  expect(look.yaw).toBe(0.01);
});

test('occluded targets are ignored', () => {
  const { a } = rig('standard', [tgt('a', 0, 0, -10)]);
  a.los = () => false;
  const look = { yaw: 0.01, pitch: 0 };
  a.apply(look, inp());
  expect(look.yaw).toBe(0.01);
  const ads = { yaw: 0, pitch: 0 };
  a.apply(ads, inp({ aiming: true }));
  expect(ads).toEqual({ yaw: 0, pitch: 0 });
  a.los = () => true;
  const open = { yaw: 0.01, pitch: 0 };
  a.apply(open, inp());
  expect(open.yaw).toBeLessThan(0.01);
});

test('follow: a strafing player gets a small fraction of the line-of-sight rate, capped, none when standing', () => {
  const run = (mode: AssistMode, move: number, speed = 3) => {
    const { a, st } = rig(mode, [tgt('a', 0, 0, -6)]);
    let total = 0;
    let peak = 0;
    for (let i = 0; i < 60; i++) {
      st.ex += speed * DT; // strafing right: the target drifts left in view
      const look = { yaw: 0.002, pitch: 0 };
      a.apply(look, inp({ move }));
      total += a.lastFollow.yaw;
      peak = Math.max(peak, Math.abs(a.lastFollow.yaw) / DT);
      // The player steers to keep roughly on the target (so it stays inside the cone).
      st.yaw += look.yaw + Math.atan2(speed * DT, 6) * 0.9;
    }
    return { total, peak };
  };
  const moving = run('standard', 1);
  expect(Math.abs(moving.total)).toBeGreaterThan(0.1 * D);
  expect(moving.peak).toBeLessThanOrEqual(ASSIST_CAPS.followDegPerSec * D + 1e-9);
  // Follow is a fraction of the LOS rate (~28 deg/s here), never all of it.
  expect(moving.peak).toBeLessThan(0.4 * 28.6 * D);
  expect(run('standard', 0).total).toBe(0);
  expect(run('off', 1).total).toBe(0);
  expect(Math.abs(run('light', 1).total)).toBeLessThan(Math.abs(moving.total));
});

test('ADS magnetism: small capped pull toward a target inside the cone, none outside it', () => {
  const pull = (mode: AssistMode, offDeg: number) => {
    const { a, st } = rig(mode, [tgt('a', 0, 0, -12)]);
    st.yaw = offDeg * D;
    a.apply({ yaw: 0, pitch: 0 }, inp({ aiming: false }));
    let sum = 0;
    for (let i = 0; i < 40; i++) {
      const look = { yaw: 0, pitch: 0 };
      a.apply(look, inp({ aiming: true }));
      sum += look.yaw;
      st.yaw += look.yaw;
    }
    return sum;
  };
  const light = pull('light', 2.5);
  const std = pull('standard', 2.5);
  // Target is to the left (negative bearing offset), so the pull is negative (left), within 1 / 1.5 degrees.
  expect(light).toBeLessThan(0);
  expect(Math.abs(light)).toBeLessThanOrEqual(1 * D + 1e-9);
  expect(Math.abs(std)).toBeLessThanOrEqual(1.5 * D + 1e-9);
  expect(Math.abs(std)).toBeGreaterThan(Math.abs(light));
  expect(Math.abs(std)).toBeLessThanOrEqual(ASSIST_CAPS.magnetDeg * D);
  expect(pull('standard', 6)).toBe(0); // outside the 3 degree cone
  expect(pull('off', 2.5)).toBe(0);
  // Already on target: nothing to do.
  expect(pull('standard', 0.1)).toBe(0);
  // Never overshoots the target.
  expect(Math.abs(pull('standard', 0.8))).toBeLessThan(0.8 * D);
});

test('ADS magnetism is spread over several frames (no snap) and only fires on entry', () => {
  const { a, st } = rig('standard', [tgt('a', 0, 0, -12)]);
  st.yaw = 2.5 * D;
  a.apply({ yaw: 0, pitch: 0 }, inp());
  const steps: number[] = [];
  for (let i = 0; i < 20; i++) {
    const look = { yaw: 0, pitch: 0 };
    a.apply(look, inp({ aiming: true }));
    st.yaw += look.yaw;
    steps.push(Math.abs(look.yaw));
  }
  expect(Math.max(...steps)).toBeLessThan(0.45 * D);
  expect(steps.filter((s) => s > 0).length).toBeGreaterThanOrEqual(6);
  // Held ADS afterwards: nothing more.
  const later = { yaw: 0, pitch: 0 };
  a.apply(later, inp({ aiming: true }));
  expect(later.yaw).toBe(0);
});

test('gamepad only: the pad source applies the assist, the trackpad and mouse paths never do', () => {
  const targets = [tgt('a', 0, 0, -10)];
  const { a } = rig('standard', targets);
  const pad: PadLike & { axes: number[] } = {
    id: 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e)',
    index: 0,
    connected: true,
    mapping: 'standard',
    axes: [0, 0, 0.5, 0],
    buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })),
  };
  const withAssist = new Gamepad(a, () => [pad]);
  const without = new Gamepad(undefined, () => [pad]);
  const f1 = emptyFrame();
  const f2 = emptyFrame();
  withAssist.poll(f1, DT);
  without.poll(f2, DT);
  expect(f1.look.yaw).toBeLessThan(f2.look.yaw);
  expect(f1.look.yaw / f2.look.yaw).toBeCloseTo(0.65, 2);
  // An idle pad (mouse in use) contributes nothing, even though the aim is on a target.
  pad.axes = [0, 0, 0, 0];
  const f3 = emptyFrame();
  withAssist.poll(f3, DT);
  expect(f3.look).toEqual({ yaw: 0, pitch: 0 });
  // The trackpad takes no assist at all.
  expect(Trackpad.length).toBe(0);
});

test('hardcore realism turns the default assist off', async () => {
  const { settings } = await import('../settings/Settings');
  const gp = settings.ns('gameplay', { realism: 'standard' });
  const a = new AimAssist();
  expect(a.tune().slow).toBeGreaterThan(0);
  gp.set({ realism: 'hardcore' });
  expect(a.tune()).toEqual({ slow: 0, follow: 0, magnetDeg: 0 });
  gp.set({ realism: 'standard' });
});
