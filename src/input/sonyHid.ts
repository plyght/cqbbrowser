/**
 * Sony controller output reports over WebHID: rumble for DualShock 4 and DualSense (USB + Bluetooth),
 * plus DualSense adaptive-trigger resistance. Pure builders so they can be unit-tested; Gyro owns the device.
 *
 * Layouts follow the community-documented reports (Linux hid-playstation / hid-sony drivers):
 * - DualSense USB: report 0x02, 47 bytes. [0] flags0, [1] flags1, [2] right (weak) motor, [3] left (strong) motor,
 *   [10..20] right trigger effect, [21..31] left trigger effect.
 * - DualSense BT: report 0x31, 77 bytes: [0] seq tag, then the USB payload at offset 1, CRC32 in the last 4 bytes.
 * - DS4 USB: report 0x05, 31 bytes. [0] flags (0x01 rumble), [3] weak motor, [4] strong motor.
 * - DS4 BT: report 0x11, 77 bytes. [0] 0xC0 | poll rate, [2] flags, [5] weak, [6] strong, CRC32 at the end.
 * Bluetooth CRC32 is over a 0xA2 seed byte, the report id and the payload (excluding the CRC itself).
 */

export type SonyTransport = 'usb' | 'bt';
export type SonyPad = 'dualsense' | 'ds4';

/** DualSense adaptive-trigger effect: 'off', or section resistance between start/end (0..1) with force 0..1. */
export type TriggerEffect = { mode: 'off' } | { mode: 'section'; start: number; end: number; force: number };

export interface SonyOutput {
  reportId: number;
  data: Uint8Array;
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes: Uint8Array, seed = 0xffffffff): number {
  let c = seed;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const byte = (v: number) => Math.max(0, Math.min(255, Math.round(v * 255)));

function writeTrigger(out: Uint8Array, at: number, fx: TriggerEffect) {
  if (fx.mode === 'off') {
    out[at] = 0x05; // "reset/off" effect
    return;
  }
  out[at] = 0x02; // section resistance
  out[at + 1] = byte(fx.start);
  out[at + 2] = byte(fx.end);
  out[at + 3] = byte(fx.force);
}

/** Append the BT CRC32 to `payload` (the last 4 bytes are overwritten). */
function sealBt(reportId: number, payload: Uint8Array) {
  const body = new Uint8Array(2 + payload.length - 4);
  body[0] = 0xa2;
  body[1] = reportId;
  body.set(payload.subarray(0, payload.length - 4), 2);
  const crc = crc32(body);
  const n = payload.length;
  payload[n - 4] = crc & 0xff;
  payload[n - 3] = (crc >>> 8) & 0xff;
  payload[n - 2] = (crc >>> 16) & 0xff;
  payload[n - 1] = (crc >>> 24) & 0xff;
}

export interface SonyRumble {
  /** Low-frequency (left, heavy) motor 0..1. */
  strong: number;
  /** High-frequency (right, light) motor 0..1. */
  weak: number;
  /** DualSense only; omitted = leave triggers alone. */
  leftTrigger?: TriggerEffect;
  rightTrigger?: TriggerEffect;
}

let btSeq = 0;

export function buildSonyOutput(pad: SonyPad, transport: SonyTransport, r: SonyRumble): SonyOutput {
  if (pad === 'dualsense') {
    const p = new Uint8Array(47);
    // flags0: 0x01 compatible vibration, 0x02 haptics select; 0x04/0x08 right/left trigger effect valid.
    p[0] = 0x03 | (r.rightTrigger ? 0x04 : 0) | (r.leftTrigger ? 0x08 : 0);
    p[2] = byte(r.weak);
    p[3] = byte(r.strong);
    if (r.rightTrigger) writeTrigger(p, 10, r.rightTrigger);
    if (r.leftTrigger) writeTrigger(p, 21, r.leftTrigger);
    if (transport === 'usb') return { reportId: 0x02, data: p };
    const bt = new Uint8Array(77);
    btSeq = (btSeq + 1) & 0x0f;
    bt[0] = (btSeq << 4) | 0x00; // seq in the high nibble, tag 0
    bt.set(p, 1);
    sealBt(0x31, bt);
    return { reportId: 0x31, data: bt };
  }
  if (transport === 'usb') {
    const p = new Uint8Array(31);
    p[0] = 0x01; // rumble valid (LED untouched)
    p[3] = byte(r.weak);
    p[4] = byte(r.strong);
    return { reportId: 0x05, data: p };
  }
  const bt = new Uint8Array(77);
  bt[0] = 0xc0 | 0x04; // HID + CRC, poll rate
  bt[2] = 0x01; // rumble valid
  bt[5] = byte(r.weak);
  bt[6] = byte(r.strong);
  sealBt(0x11, bt);
  return { reportId: 0x11, data: bt };
}
