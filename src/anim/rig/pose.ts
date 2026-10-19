import { decodeF32, decodeQ16, type ClipEvent, type ClipJson, type V3 } from './clipData';

/**
 * Decoded clips as one flat Float32Array per clip: `frames × stride` "pose vectors". Every channel of a frame
 * (bone rotations, gun frames, part channels, mags, anchor weights) lives in one vector, so sampling,
 * crossfading, additive layers and clip composition are all the same vector maths
 * (linear + normalised-lerp on the quaternion slots).
 */

export const MAG_SLOTS = 2;
const MAG_STRIDE = 16; // gun xf 7, hand xf 7, w, vis

export interface Layout {
  bones: string[];
  stride: number;
  rot: number;
  pos: Record<string, number>;
  gunHand: number;
  gunRoot: number;
  gunW: number;
  ch: { bolt: number; trigger: number; hammer: number; safety: number };
  mag: { gun: number; hand: number; w: number; vis: number }[];
  wL: { grip: number; well: number; charge: number };
  wR: { grip: number; well: number; charge: number };
  /** Offsets of every quaternion (xyzw) slot. */
  quats: number[];
}

export const POS_BONES = ['LeftShoulder', 'RightShoulder'];

export function makeLayout(bones: string[]): Layout {
  let o = 0;
  const rot = o;
  o += bones.length * 4;
  const pos: Record<string, number> = {};
  for (const b of POS_BONES) {
    pos[b] = o;
    o += 3;
  }
  const gunHand = o;
  o += 7;
  const gunRoot = o;
  o += 7;
  const gunW = o++;
  const ch = { bolt: o++, trigger: o++, hammer: o++, safety: o++ };
  const mag: Layout['mag'] = [];
  for (let k = 0; k < MAG_SLOTS; k++) {
    mag.push({ gun: o, hand: o + 7, w: o + 14, vis: o + 15 });
    o += MAG_STRIDE;
  }
  const wL = { grip: o++, well: o++, charge: o++ };
  const wR = { grip: o++, well: o++, charge: o++ };
  const quats = bones.map((_, i) => rot + i * 4);
  quats.push(gunHand + 3, gunRoot + 3);
  for (const m of mag) quats.push(m.gun + 3, m.hand + 3);
  return { bones, stride: o, rot, pos, gunHand, gunRoot, gunW, ch, mag, wL, wR, quats };
}

/** Authored hand-target override (model frame of the weapon), blended over the clip's own hand motion. */
export interface HandKey {
  t: number;
  /** Socket or part name on the weapon model (`boltCatch`, `chargingHandle`, `magwell`, `gripLeft`, …). */
  at: string;
  off: V3;
  w: number;
}

export interface Clip {
  id: string;
  action: string;
  pack: string;
  fps: number;
  frames: number;
  duration: number;
  layout: Layout;
  data: Float32Array;
  events: ClipEvent[];
  /** Loop region (seconds) while a hold is active (mag check). */
  hold?: [number, number];
  /** Authored hand-target overrides (support / firing hand). */
  handL?: HandKey[];
  handR?: HandKey[];
  /** Mag insertion style: AK rock-in vs straight (AR/SMG/pistol) — straightens the mag near the well. */
  magStyle?: 'rock' | 'straight';
  loop?: boolean;
  /** Applied as a delta from frame 0 on top of the base pose (shoot). */
  additive?: boolean;
  /** Last frame is held when finished (swap out: weapon stays off screen until the next action). */
  holdLast?: boolean;
}

export function decodeClip(j: ClipJson, layout: Layout): Clip {
  const n = j.frames;
  const S = layout.stride;
  const data = new Float32Array(n * S);
  const rot = decodeQ16(j.rot);
  const nb = j.bones.length;
  const boneIdx = j.bones.map((b) => layout.bones.indexOf(b));
  const put = (src: Float32Array | undefined, off: number, w: number) => {
    if (!src) return;
    for (let f = 0; f < n; f++) for (let k = 0; k < w; k++) data[f * S + off + k] = src[f * w + k];
  };
  for (let f = 0; f < n; f++)
    for (let b = 0; b < nb; b++) {
      const bi = boneIdx[b];
      if (bi < 0) continue;
      for (let k = 0; k < 4; k++) data[f * S + layout.rot + bi * 4 + k] = rot[(f * nb + b) * 4 + k];
    }
  for (const [b, off] of Object.entries(layout.pos)) put(j.pos[b] ? decodeF32(j.pos[b]) : undefined, off, 3);
  put(decodeF32(j.gunHand), layout.gunHand, 7);
  put(decodeF32(j.gunRoot), layout.gunRoot, 7);
  put(decodeF32(j.gunW), layout.gunW, 1);
  for (const c of ['bolt', 'trigger', 'hammer', 'safety'] as const)
    put(j.ch[c] ? decodeF32(j.ch[c]!) : undefined, layout.ch[c], 1);
  j.mags.slice(0, MAG_SLOTS).forEach((m, k) => {
    const L = layout.mag[k];
    put(decodeF32(m.gun), L.gun, 7);
    put(decodeF32(m.hand), L.hand, 7);
    put(decodeF32(m.w), L.w, 1);
    put(decodeF32(m.vis), L.vis, 1);
  });
  // Unused mag slots: identity transforms, hidden.
  for (let k = j.mags.length; k < MAG_SLOTS; k++)
    for (let f = 0; f < n; f++) {
      data[f * S + layout.mag[k].gun + 6] = 1;
      data[f * S + layout.mag[k].hand + 6] = 1;
    }
  for (const a of ['grip', 'well', 'charge'] as const) {
    put(decodeF32(j.wL[a]), layout.wL[a], 1);
    put(decodeF32(j.wR[a]), layout.wR[a], 1);
  }
  return {
    id: j.id,
    action: j.action,
    pack: j.pack,
    fps: j.fps,
    frames: n,
    duration: (n - 1) / j.fps,
    layout,
    data,
    events: j.events.slice(),
  };
}

/** Normalised lerp of the quaternion at `o` (in place on `out`, shortest arc). */
function nlerpQ(
  out: Float32Array,
  o: number,
  a: ArrayLike<number>,
  ao: number,
  b: ArrayLike<number>,
  bo: number,
  k: number,
) {
  const dot = a[ao] * b[bo] + a[ao + 1] * b[bo + 1] + a[ao + 2] * b[bo + 2] + a[ao + 3] * b[bo + 3];
  const s = dot < 0 ? -1 : 1;
  let x = a[ao] + (s * b[bo] - a[ao]) * k;
  let y = a[ao + 1] + (s * b[bo + 1] - a[ao + 1]) * k;
  let z = a[ao + 2] + (s * b[bo + 2] - a[ao + 2]) * k;
  let w = a[ao + 3] + (s * b[bo + 3] - a[ao + 3]) * k;
  const l = Math.hypot(x, y, z, w) || 1;
  x /= l;
  y /= l;
  z /= l;
  w /= l;
  out[o] = x;
  out[o + 1] = y;
  out[o + 2] = z;
  out[o + 3] = w;
}

/**
 * out = mix(a, b, k): linear on every slot, normalised-lerp on quaternion slots.
 * `a`/`b` are pose vectors at offsets `ao`/`bo` (frames inside clip data or standalone vectors).
 */
export function blendPose(
  layout: Layout,
  out: Float32Array,
  a: ArrayLike<number>,
  ao: number,
  b: ArrayLike<number>,
  bo: number,
  k: number,
) {
  const S = layout.stride;
  for (let i = 0; i < S; i++) out[i] = a[ao + i] + (b[bo + i] - a[ao + i]) * k;
  for (const q of layout.quats) nlerpQ(out, q, a, ao + q, b, bo + q, k);
}

/** Sample a clip at time `t` (clamped) into `out` (length = stride). */
export function samplePose(clip: Clip, t: number, out: Float32Array) {
  const f = Math.max(0, Math.min(clip.frames - 1, t * clip.fps));
  const i = Math.floor(f);
  const j = Math.min(clip.frames - 1, i + 1);
  const S = clip.layout.stride;
  blendPose(clip.layout, out, clip.data, i * S, clip.data, j * S, f - i);
}

/** Quaternion product r = a * b on raw arrays. */
export function qmul(
  a: ArrayLike<number>,
  ao: number,
  b: ArrayLike<number>,
  bo: number,
  r: Float32Array | number[],
  ro: number,
) {
  const ax = a[ao],
    ay = a[ao + 1],
    az = a[ao + 2],
    aw = a[ao + 3];
  const bx = b[bo],
    by = b[bo + 1],
    bz = b[bo + 2],
    bw = b[bo + 3];
  r[ro] = aw * bx + ax * bw + ay * bz - az * by;
  r[ro + 1] = aw * by - ax * bz + ay * bw + az * bx;
  r[ro + 2] = aw * bz + ax * by - ay * bx + az * bw;
  r[ro + 3] = aw * bw - ax * bx - ay * by - az * bz;
}

const _d = new Float32Array(4);
const _c = new Float32Array(4);
/**
 * Additive layer: for every bone rotation, base · (ref⁻¹ · cur) scaled by `w`; bolt/trigger take the max.
 * `ref` = the additive clip's first frame, `cur` = its sampled frame.
 */
export function addPose(layout: Layout, base: Float32Array, ref: Float32Array, cur: Float32Array, w: number) {
  for (let i = 0; i < layout.bones.length; i++) {
    const o = layout.rot + i * 4;
    _c[0] = -ref[o];
    _c[1] = -ref[o + 1];
    _c[2] = -ref[o + 2];
    _c[3] = ref[o + 3];
    qmul(_c, 0, cur, o, _d, 0);
    if (w < 1) {
      const id = [0, 0, 0, 1];
      nlerpQ(_d, 0, id, 0, _d, 0, w);
    }
    qmul(base, o, _d, 0, base, o);
  }
  for (const c of ['bolt', 'trigger'] as const)
    base[layout.ch[c]] = Math.max(base[layout.ch[c]], cur[layout.ch[c]] * w);
}
