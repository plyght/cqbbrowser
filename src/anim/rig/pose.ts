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
  /** Extra hand rotation about the weapon's axes (XYZ euler, rad), weighted like the target. */
  turn?: V3;
}

/** Mag-check presentation layer (see `PresentRecipe` in library/compose.ts), times in clip seconds. */
export interface ClipPresent {
  path: { t: number; v: number }[];
  hand: { t: number; v: number }[];
  pose: { p: V3; r: V3 };
  arc: V3;
  rock: number;
  rockSpan: number;
  /** Mag-in-support-hand transform (pos xyz, quat xyzw) sampled from the grip source frame. */
  grip: Float32Array;
  gripTurn: number;
  gripShift: V3;
  /** Span (clip seconds) the layer owns the mag and the support hand. */
  t0: number;
  t1: number;
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
  /** Mag check: the mag out of the well and presented (procedural, on top of the sampled pose). */
  present?: ClipPresent;
  /** Launch velocity (model frame, m/s) for the physical floor mag at `magOut`. */
  drop?: V3;
  /** Authored gun tilt keys (clip seconds, model-frame XYZ euler), already baked into the gun frames. */
  tilt?: { t: number; r: V3 }[];
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
  const clip: Clip = {
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
  despike(clip);
  return clip;
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
const ID_Q = [0, 0, 0, 1];
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
    if (w < 1) nlerpQ(_d, 0, ID_Q, 0, _d, 0, w);
    qmul(base, o, _d, 0, base, o);
  }
  for (const c of ['bolt', 'trigger'] as const)
    base[layout.ch[c]] = Math.max(base[layout.ch[c]], cur[layout.ch[c]] * w);
}

/** Angle (rad) between the unit quaternions at `a[ao]` and `b[bo]`. */
export function quatAngle(a: ArrayLike<number>, ao: number, b: ArrayLike<number>, bo: number): number {
  const dot = Math.abs(a[ao] * b[bo] + a[ao + 1] * b[bo + 1] + a[ao + 2] * b[bo + 2] + a[ao + 3] * b[bo + 3]);
  return 2 * Math.acos(Math.min(1, dot));
}

/**
 * Remove single-frame rotation pops from a clip's bone tracks in place. The retargeted source packs have frames
 * where one bone turns 80–155° (mostly twist about the bone: a retarget flip) in one 30 fps frame while its
 * neighbours (the window's median) move < 1/2.5 as much — a skin "flick" at 60 Hz+. Such a step is re-timed: the bone's frames across a
 * window of ±`k` frames around it are replaced by a smoothstep slerp between the window's edge poses, so the
 * same rotation happens over ~2k frames. Returns the number of spikes fixed.
 */
export function despike(clip: Clip, minStep = (35 * Math.PI) / 180, ratio = 2.5, k = 3): number {
  const L = clip.layout;
  const S = L.stride;
  const n = clip.frames;
  const d = clip.data;
  const steps = new Float32Array(n);
  const a = new Float32Array(4);
  const nb: number[] = [];
  let fixed = 0;
  for (let bi = 0; bi < L.bones.length; bi++) {
    const o = L.rot + bi * 4;
    for (let pass = 0; pass < 3; pass++) {
      for (let f = 1; f < n; f++) steps[f] = quatAngle(d, (f - 1) * S + o, d, f * S + o);
      let any = false;
      for (let f = 1; f < n; f++) {
        const s = steps[f];
        if (s < minStep) continue;
        // Typical neighbour step outside the spike itself (it can straddle two frames): the window's median.
        nb.length = 0;
        for (let j = f - k; j <= f + k; j++) if (j >= 1 && j < n && Math.abs(j - f) > 1) nb.push(steps[j]);
        nb.sort((x, y) => x - y);
        const around = nb.length ? nb[nb.length >> 1] : 0;
        if (s < ratio * around) continue;
        const f0 = Math.max(0, f - k);
        const f1 = Math.min(n - 1, f + k - 1);
        if (f1 - f0 < 2) continue;
        a.set(d.subarray(f0 * S + o, f0 * S + o + 4));
        const b = d.slice(f1 * S + o, f1 * S + o + 4);
        for (let g = f0 + 1; g < f1; g++) {
          const u = (g - f0) / (f1 - f0);
          slerpQ(d, g * S + o, a, b, u * u * (3 - 2 * u));
        }
        fixed++;
        any = true;
        f = f1;
      }
      if (!any) break;
    }
  }
  return fixed;
}

/** Spherical lerp of quaternions `a` → `b` (shortest arc) into `out[o]`. */
function slerpQ(out: Float32Array, o: number, a: ArrayLike<number>, b: ArrayLike<number>, t: number) {
  let dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  const s = dot < 0 ? -1 : 1;
  dot = Math.min(1, Math.abs(dot));
  const th = Math.acos(dot);
  let ka = 1 - t,
    kb = t;
  if (th > 1e-4) {
    const sn = Math.sin(th);
    ka = Math.sin((1 - t) * th) / sn;
    kb = Math.sin(t * th) / sn;
  }
  let l = 0;
  for (let i = 0; i < 4; i++) {
    out[o + i] = a[i] * ka + s * b[i] * kb;
    l += out[o + i] * out[o + i];
  }
  l = Math.sqrt(l) || 1;
  for (let i = 0; i < 4; i++) out[o + i] /= l;
}

/**
 * Make a clip end where it starts, in place: over its last `fraction`, every frame is blended (smoothstep) toward
 * frame 0. Loops then have no seam at the wrap, and additive clips (applied as a delta from frame 0) return to a
 * zero delta, so the layer leaves without a pop. `bonesOnly` limits it to the bone rotations (additive clips:
 * their bolt / trigger channels are maxed, not deltas).
 */
export function settleToStart(clip: Clip, fraction: number, bonesOnly = false) {
  const L = clip.layout;
  const S = L.stride;
  const n = clip.frames;
  const d = clip.data;
  const k = Math.max(2, Math.round((n - 1) * fraction));
  const head = d.slice(0, S);
  const tmp = new Float32Array(S);
  for (let f = n - 1 - k; f < n; f++) {
    if (f <= 0) continue;
    const u = (f - (n - 1 - k)) / k;
    const w = u * u * (3 - 2 * u);
    if (bonesOnly) {
      for (let bi = 0; bi < L.bones.length; bi++) {
        const o = L.rot + bi * 4;
        nlerpQ(d, f * S + o, d, f * S + o, head, o, w);
      }
    } else {
      blendPose(L, tmp, d, f * S, head, 0, w);
      d.set(tmp, f * S);
    }
  }
}
