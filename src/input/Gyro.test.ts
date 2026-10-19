import { expect, test } from 'bun:test';
import { GYRO_LSB_PER_DPS, gyroOffset, parseGyro, StillnessCalibrator, tighten } from './Gyro';

test('DualSense USB report 0x01: gyro int16 LE at bytes 16..21 (15..20 without the report ID)', () => {
  const buf = new DataView(new ArrayBuffer(63));
  const off = gyroOffset(0x0ce6, 0x01);
  expect(off).toBe(15);
  buf.setInt16(off, 164, true);
  buf.setInt16(off + 2, -1638, true);
  buf.setInt16(off + 4, 0, true);
  const s = parseGyro(buf, off)!;
  expect(s.pitch).toBeCloseTo(164 / GYRO_LSB_PER_DPS, 6);
  expect(s.yaw).toBeCloseTo(-100, 0);
  expect(gyroOffset(0x0ce6, 0x31)).toBe(16);
  expect(gyroOffset(0x05c4, 0x01)).toBe(12);
  expect(gyroOffset(0x0ce6, 0x05)).toBe(-1);
  expect(parseGyro(new DataView(new ArrayBuffer(10)), 15)).toBeNull();
});

test('stillness calibration finds bias; motion restarts the window', () => {
  const c = new StillnessCalibrator();
  for (let i = 0; i < 300; i++) c.feed({ pitch: 1.2 + (i % 2) * 0.2, yaw: -0.8, roll: 0.1 }, 0.004);
  expect(c.calibrated).toBe(true);
  expect(c.bias.pitch).toBeCloseTo(1.3, 1);
  expect(c.bias.yaw).toBeCloseTo(-0.8, 6);
  const d = new StillnessCalibrator();
  for (let i = 0; i < 300; i++) d.feed({ pitch: (i % 20) * 5, yaw: 0, roll: 0 }, 0.004);
  expect(d.calibrated).toBe(false);
});

test('tightening damps tiny rates only', () => {
  expect(tighten(0.75, 1.5)).toBeCloseTo(0.375, 9);
  expect(tighten(20, 1.5)).toBe(20);
  expect(tighten(-0.75, 1.5)).toBeCloseTo(-0.375, 9);
});
