import { expect, test } from 'bun:test';
import { Vector3 } from 'three';
import { Bus } from '../core/bus';
import { HapticsDirector, felt } from './HapticsDirector';
import { gamepadSettings } from './config';
import { buildSonyOutput, crc32 } from './sonyHid';

function rig() {
  const bus = new Bus();
  const calls: { s: number; w: number; ms: number }[] = [];
  const trig: number[] = [];
  const d = new HapticsDirector(bus, {
    dual: (s, w, ms) => calls.push({ s, w, ms }),
    triggers: (_l, r) => trig.push(r),
  });
  return { bus, d, calls, trig };
}

const shot = (bus: Bus, energyJ: number) =>
  bus.emit('shot', {
    weaponId: 'sb16',
    origin: new Vector3(),
    dir: new Vector3(0, 0, -1),
    suppressed: false,
    caliber: '5.56',
    recoil: { energyJ } as never,
  });

test('a shot rumbles both motors and the right trigger; harder guns rumble harder', () => {
  const a = rig();
  shot(a.bus, 1.7);
  a.d.update(0.03);
  const b = rig();
  shot(b.bus, 6);
  b.d.update(0.03);
  expect(a.calls[0].s).toBeGreaterThan(0.2);
  expect(b.calls[0].s).toBeGreaterThan(a.calls[0].s);
  expect(b.trig.length).toBeGreaterThan(0);
});

test('overlapping effects mix instead of replacing each other, and never exceed 1', () => {
  const { d } = rig();
  d.play(200, 0.6, 0.6);
  const one = d.mix(0.01).strong;
  d.play(200, 0.6, 0.6);
  const two = d.mix(0.01).strong;
  expect(two).toBeGreaterThan(one);
  expect(two).toBeLessThanOrEqual(1);
});

test('steel ping is delayed by the speed of sound', () => {
  const { bus, d } = rig();
  bus.emit('steelHit', {
    point: new Vector3(),
    targetId: 'g',
    size: 0.3,
    thicknessMm: 10,
    energy: 1500,
    distance: 34.3,
  });
  expect(d.mix(0.05).weak).toBe(0);
  expect(d.mix(0.105).weak).toBeGreaterThan(0);
});

test('disabled director sends a stop, then goes quiet', () => {
  const { d, calls } = rig();
  d.enabled = () => false;
  d.play(500, 1, 1);
  d.update(0.03);
  d.update(0.03);
  expect(calls[0].s).toBe(0);
});

test('Sony reports: sizes, ids, motor bytes and Bluetooth CRC', () => {
  const ds = buildSonyOutput('dualsense', 'usb', { strong: 1, weak: 0.5 });
  expect(ds.reportId).toBe(0x02);
  expect(ds.data.length).toBe(47);
  expect(ds.data[3]).toBe(255);
  expect(ds.data[2]).toBe(128);
  const bt = buildSonyOutput('ds4', 'bt', { strong: 0.5, weak: 0 });
  expect(bt.reportId).toBe(0x11);
  expect(bt.data.length).toBe(77);
  const body = new Uint8Array(2 + 73);
  body[0] = 0xa2;
  body[1] = 0x11;
  body.set(bt.data.subarray(0, 73), 2);
  const crc = crc32(body);
  const v = new DataView(bt.data.buffer);
  expect(v.getUint32(73, true)).toBe(crc);
  // Known CRC32 vector.
  expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
});

const shotOf = (bus: Bus, weaponId: string, caliber: string, energyJ: number) =>
  bus.emit('shot', {
    weaponId,
    origin: new Vector3(),
    dir: new Vector3(0, 0, -1),
    suppressed: false,
    caliber,
    recoil: { energyJ } as never,
  });

test('shots hit hard: rifle strong motor 0.8–1.0 with a weak tail, pistol a sharp ~0.7', () => {
  const a = rig();
  shotOf(a.bus, 'sb16', '5.56', 5);
  a.d.update(0.026);
  expect(a.calls[0].s).toBeGreaterThanOrEqual(0.8);
  expect(a.calls[0].s).toBeLessThanOrEqual(1);
  // The weak-motor tail is still running after the strong hit has decayed.
  for (let i = 0; i < 3; i++) a.d.update(0.026);
  expect(a.calls.at(-1)!.w).toBeGreaterThan(0.15);
  const b = rig();
  shotOf(b.bus, 'p17', '9mm', 4);
  b.d.update(0.026);
  expect(b.calls[0].s).toBeGreaterThan(0.6);
  expect(b.calls[0].s).toBeLessThan(0.85);
  // Sharp: gone well before a rifle shot is.
  for (let i = 0; i < 4; i++) b.d.update(0.026);
  expect(b.calls.at(-1)!.s).toBeLessThan(0.2);
});

test('every send lasts several ticks (overlap), well over a frame', () => {
  const { bus, d, calls } = rig();
  shotOf(bus, 'sb16', '5.56', 5);
  d.update(0.026);
  expect(calls[0].ms).toBeGreaterThanOrEqual(60);
});

test('reload beats are clearly felt', () => {
  for (const beat of ['magOut', 'magIn', 'magSeat', 'boltRelease', 'slideRelease', 'magCheckOut']) {
    const { bus, d, calls } = rig();
    bus.emit('weaponBeat', { weaponId: 'sb16', beat, stressed: false });
    d.update(0.026);
    expect(Math.max(calls[0].s, calls[0].w)).toBeGreaterThan(0.4);
  }
});

test('non-damage events are present: footsteps (walk subtle < sprint), landing, ADS, NVG, swap, steel', () => {
  const step = (speed: number) => {
    const { bus, d, calls } = rig();
    bus.emit('footstep', { point: new Vector3(), surface: 'concrete', foot: 'L', speed, scuff: 0 });
    d.update(0.026);
    return calls[0]?.s ?? 0;
  };
  const walk = step(1.5);
  const sprint = step(5);
  expect(walk).toBeGreaterThan(0.12);
  expect(walk).toBeLessThan(0.35);
  expect(sprint).toBeGreaterThan(walk + 0.15);
  const felt = (emit: (bus: Bus) => void, min = 0.25) => {
    const { bus, d, calls } = rig();
    emit(bus);
    d.update(0.026);
    expect(Math.max(calls[0]?.s ?? 0, calls[0]?.w ?? 0)).toBeGreaterThan(min);
  };
  felt((b) => b.emit('land', { speed: 5 }), 0.6);
  felt((b) => b.emit('ads', { on: true }));
  felt((b) => b.emit('gearSound', { kind: 'nvgDown' }));
  felt((b) => b.emit('weaponBeat', { weaponId: 'sb16', beat: 'swapMid', stressed: false }));
  felt(
    (b) =>
      b.emit('steelHit', {
        point: new Vector3(),
        targetId: 's',
        size: 0.3,
        thicknessMm: 10,
        energy: 1500,
        distance: 3,
      }),
    0.2,
  );
});

test('flashbang: heavy and long', () => {
  const { bus, d, calls } = rig();
  bus.emit('flashbang', {
    point: new Vector3(),
    distance: 3,
    visual: 1,
    hearing: 1,
    los: true,
    indoor: true,
  });
  for (let i = 0; i < 4; i++) d.update(0.026);
  expect(Math.max(...calls.map((c) => c.s))).toBeGreaterThan(0.85);
  for (let i = 0; i < 20; i++) d.update(0.026);
  // Still rumbling ~0.6 s later.
  expect(calls.at(-1)!.s).toBeGreaterThan(0.2);
});

test('perceptual floor: a small request still spins the motor, zero stays zero; default strength is 1', () => {
  expect(felt(0)).toBe(0);
  expect(felt(0.05)).toBeGreaterThan(0.12);
  expect(felt(1)).toBe(1);
  expect(gamepadSettings.defaults.hapticsStrength).toBe(1);
});
