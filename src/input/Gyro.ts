import type { ActionFrame, InputSource, PollInfo } from './actions';
import { gyroSettings } from './config';

/**
 * Optional WebHID gyro for DualSense / DualShock 4 (Chromium only, PRD §7.4). The Gamepad API exposes no motion
 * sensors, so we read the raw HID input report. `connect()` must run from a user gesture (settings UI button).
 *
 * Report layouts (offsets into WebHID's DataView, which excludes the report ID byte):
 * - DualSense USB, report 0x01: gyro X/Y/Z int16 LE at 15..20 (bytes 16..21 counting the ID byte).
 * - DualSense BT, report 0x31: one extra header byte → gyro at 16..21.
 * - DualShock 4 USB, report 0x01: gyro at 12..17. DS4 BT report 0x11: gyro at 14..19.
 * Raw units ≈ 1/16.384 °/s per LSB (±2000 °/s range); factory calibration is not applied, we zero bias on stillness.
 * Axis X = pitch, Y = yaw, Z = roll.
 */

const SONY = 0x054c;
const DUALSENSE = [0x0ce6, 0x0df2];
const DS4 = [0x05c4, 0x09cc, 0x0ba0];
export const GYRO_LSB_PER_DPS = 16.384;

export interface GyroSample {
  /** Angular velocity in degrees/second (pitch, yaw, roll), raw (uncalibrated). */
  pitch: number;
  yaw: number;
  roll: number;
}

/** Returns the gyro offset into the report DataView, or -1 for reports without motion data. */
export function gyroOffset(product: number, reportId: number): number {
  const ds = DUALSENSE.includes(product);
  if (ds && reportId === 0x01) return 15;
  if (ds && reportId === 0x31) return 16;
  if (!ds && reportId === 0x01) return 12;
  if (!ds && reportId === 0x11) return 14;
  return -1;
}

export function parseGyro(data: DataView, offset: number): GyroSample | null {
  if (offset < 0 || data.byteLength < offset + 6) return null;
  return {
    pitch: data.getInt16(offset, true) / GYRO_LSB_PER_DPS,
    yaw: data.getInt16(offset + 2, true) / GYRO_LSB_PER_DPS,
    roll: data.getInt16(offset + 4, true) / GYRO_LSB_PER_DPS,
  };
}

/**
 * Bias calibration on stillness: when the signal stays inside a small band for `window` seconds, its mean becomes
 * the new zero. Simple and robust for a controller resting on a desk or held steady.
 */
export class StillnessCalibrator {
  bias = { pitch: 0, yaw: 0, roll: 0 };
  calibrated = false;
  window = 1.0;
  /** Max deviation (°/s) from the running mean that still counts as still. */
  band = 3;
  /** Largest plausible bias (°/s). */
  maxBias = 6;
  private sum = { pitch: 0, yaw: 0, roll: 0 };
  private n = 0;
  private t = 0;

  feed(s: GyroSample, dt: number) {
    if (this.n > 0) {
      const m = { pitch: this.sum.pitch / this.n, yaw: this.sum.yaw / this.n, roll: this.sum.roll / this.n };
      const dev = Math.max(Math.abs(s.pitch - m.pitch), Math.abs(s.yaw - m.yaw), Math.abs(s.roll - m.roll));
      if (dev > this.band) this.restart();
    }
    this.sum.pitch += s.pitch;
    this.sum.yaw += s.yaw;
    this.sum.roll += s.roll;
    this.n++;
    this.t += dt;
    if (this.t >= this.window) {
      const m = { pitch: this.sum.pitch / this.n, yaw: this.sum.yaw / this.n, roll: this.sum.roll / this.n };
      // A steady slow pan also looks "still"; real sensor bias is small, so ignore large means.
      if (Math.max(Math.abs(m.pitch), Math.abs(m.yaw), Math.abs(m.roll)) <= this.maxBias) {
        this.bias = m;
        this.calibrated = true;
      }
      this.restart();
    }
  }

  restart() {
    this.sum = { pitch: 0, yaw: 0, roll: 0 };
    this.n = 0;
    this.t = 0;
  }
}

/** Small-motion tightening: rates below `threshold` °/s are scaled down quadratically (kills hand jitter). */
export function tighten(rate: number, threshold: number): number {
  const a = Math.abs(rate);
  if (threshold <= 0 || a >= threshold) return rate;
  return rate * (a / threshold);
}

interface HIDDeviceLike {
  vendorId: number;
  productId: number;
  productName?: string;
  opened: boolean;
  open(): Promise<void>;
  close(): Promise<void>;
  addEventListener(
    type: 'inputreport',
    fn: (e: { reportId: number; data: DataView; timeStamp: number }) => void,
  ): void;
}

interface HIDLike {
  requestDevice(o: { filters: { vendorId: number; productId?: number }[] }): Promise<HIDDeviceLike[]>;
  getDevices(): Promise<HIDDeviceLike[]>;
}

export class Gyro implements InputSource {
  readonly calibrator = new StillnessCalibrator();
  device: HIDDeviceLike | null = null;
  private yaw = 0;
  private pitch = 0;
  private lastT = 0;
  private hadInput = false;

  /** WebHID available (Chromium desktop, secure context). Firefox/Safari: the UI hides gyro options. */
  static get supported(): boolean {
    return typeof navigator !== 'undefined' && 'hid' in navigator;
  }

  get connected() {
    return !!this.device?.opened;
  }

  /** Must be called from a user gesture. Resolves true when a DualSense/DS4 is open and streaming. */
  async connect(): Promise<boolean> {
    if (!Gyro.supported) return false;
    const hid = (navigator as unknown as { hid: HIDLike }).hid;
    const filters = [...DUALSENSE, ...DS4].map((productId) => ({ vendorId: SONY, productId }));
    const [dev] = await hid.requestDevice({ filters });
    if (!dev) return false;
    return this.attach(dev);
  }

  /** Re-attach a previously permitted device without a prompt (call on boot). */
  async reconnect(): Promise<boolean> {
    if (!Gyro.supported) return false;
    const devs = await (navigator as unknown as { hid: HIDLike }).hid.getDevices();
    const dev = devs.find((d) => d.vendorId === SONY && [...DUALSENSE, ...DS4].includes(d.productId));
    return dev ? this.attach(dev) : false;
  }

  async disconnect() {
    await this.device?.close();
    this.device = null;
  }

  private async attach(dev: HIDDeviceLike): Promise<boolean> {
    if (!dev.opened) await dev.open();
    dev.addEventListener('inputreport', (e) => this.onReport(dev.productId, e.reportId, e.data, e.timeStamp));
    this.device = dev;
    this.calibrator.calibrated = false;
    return true;
  }

  /** Integrates one report. Exposed for tests. */
  onReport(product: number, reportId: number, data: DataView, timeStamp: number) {
    const sample = parseGyro(data, gyroOffset(product, reportId));
    if (!sample) return;
    const dt = this.lastT ? Math.min(0.05, Math.max(0, (timeStamp - this.lastT) / 1000)) : 0;
    this.lastT = timeStamp;
    if (dt === 0) return;
    this.calibrator.feed(sample, dt);
    const b = this.calibrator.bias;
    const s = gyroSettings.get();
    const yaw = tighten(sample.yaw - b.yaw, s.tightening);
    const pitch = tighten(sample.pitch - b.pitch, s.tightening);
    // Controller yawing left (positive Y) should turn the view left (negative look yaw).
    this.yaw += -yaw * dt * (Math.PI / 180) * s.sensitivity * (s.invertYaw ? -1 : 1);
    this.pitch += pitch * dt * (Math.PI / 180) * s.sensitivity * (s.invertPitch ? -1 : 1);
  }

  poll(frame: ActionFrame, _dt: number, info?: PollInfo): void {
    const s = gyroSettings.get();
    const on = s.enabled && this.connected && (s.mode === 'always' || !!info?.aiming);
    if (on) {
      frame.look.yaw += this.yaw;
      frame.look.pitch += this.pitch;
      const moved = Math.abs(this.yaw) + Math.abs(this.pitch) > 1e-4;
      if (moved) this.hadInput = true;
    }
    this.yaw = this.pitch = 0;
    if (this.hadInput) frame.activeDevice = 'gamepad';
    this.hadInput = false;
  }
}
