import { expect, test } from 'bun:test';
import { Vector3 } from 'three';
import { Bus } from '../core/bus';
import { HapticsDirector } from './HapticsDirector';
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
