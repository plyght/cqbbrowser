import { Euler, Quaternion } from 'three';
import type { ClipEvent, V3 } from '../rig/clipData';
import {
  blendPose,
  despike,
  qmul,
  samplePose,
  settleToStart,
  type Clip,
  type HandKey,
  type Layout,
} from '../rig/pose';

/**
 * Clip composition: build a weapon-specific clip from segments of the baked source clips (trim, speed,
 * reverse, freeze, crossfade) plus authored layers (weapon tilt, bolt keys, a synthetic old-mag drop, mag
 * offsets, hand-target overrides, events). Output is an ordinary sampled `Clip` at 30 fps.
 */

export type Seg =
  /** Plays the source from t0 to t1 (t1 < t0 plays it backwards). */
  | { clip: string; t0?: number; t1?: number; speed?: number }
  /** Freeze the previous segment's last pose for `hold` seconds. */
  | { hold: number }
  /** Smooth transition (smoothstep) from the previous segment's end to the next segment's start. */
  | { blend: number };

export interface Key {
  t: number;
  v: number;
}

export interface Recipe {
  segs: Seg[];
  /** Global time scale (> 1 = faster). Authored key times are in composed time before this scale. */
  speed?: number;
  /** Keep the source clips' events (default true). */
  keepEvents?: boolean;
  dropEvents?: string[];
  events?: ClipEvent[];
  handL?: HandKey[];
  handR?: HandKey[];
  /** Weapon rotation about its grip origin (model-frame XYZ euler, radians), linear between keys. */
  tilt?: { t: number; r: V3 }[];
  /** Bolt/slide channel override keys (replace the source channel between the first and last key). */
  bolt?: Key[];
  /** Seated-mag hand-weight override keys (0 = the mag stays weapon-relative). */
  magW?: Key[];
  /** Firing-hand-holds-the-grip override keys (1 = parented to the hand). */
  gunW?: Key[];
  /** Synthesise the old mag falling out of the well (mag slot 1) starting at `t`. */
  magDrop?: { t: number };
  /** Offset of the seated mag (slot 0) in the model frame, weighted: partial drop for a mag check. */
  magOffset?: { t: number; p: V3; r?: V3 }[];
  hold?: [number, number];
  loop?: boolean;
  additive?: boolean;
  holdLast?: boolean;
  magStyle?: 'rock' | 'straight';
}

const FPS = 30;
const smoothstep = (x: number) => x * x * (3 - 2 * x);

type Piece =
  | { kind: 'clip'; clip: Clip; t0: number; t1: number; start: number; dur: number }
  | { kind: 'hold'; start: number; dur: number }
  | { kind: 'blend'; start: number; dur: number };

/** Linear interpolation over sorted keys (clamped). */
export function keyAt<T extends { t: number }>(keys: T[], t: number, get: (k: T) => number): number {
  if (t <= keys[0].t) return get(keys[0]);
  for (let i = 1; i < keys.length; i++)
    if (t <= keys[i].t) {
      const a = keys[i - 1];
      const b = keys[i];
      const k = (t - a.t) / Math.max(1e-6, b.t - a.t);
      return get(a) + (get(b) - get(a)) * k;
    }
  return get(keys[keys.length - 1]);
}

export function compose(id: string, action: string, recipe: Recipe, clips: Record<string, Clip>): Clip {
  const speed = recipe.speed ?? 1;
  const pieces: Piece[] = [];
  let t = 0;
  let layout: Layout | undefined;
  let pack = '';
  for (const s of recipe.segs) {
    if ('clip' in s) {
      const c = clips[s.clip];
      if (!c) throw new Error(`compose ${id}: unknown clip ${s.clip}`);
      layout = c.layout;
      pack = pack || c.pack;
      const t0 = s.t0 ?? 0;
      const t1 = Math.min(s.t1 ?? c.duration, c.duration);
      const dur = Math.abs(t1 - t0) / (s.speed ?? 1) / speed;
      pieces.push({ kind: 'clip', clip: c, t0, t1, start: t, dur });
      t += dur;
    } else if ('hold' in s) {
      pieces.push({ kind: 'hold', start: t, dur: s.hold / speed });
      t += s.hold / speed;
    } else {
      pieces.push({ kind: 'blend', start: t, dur: s.blend / speed });
      t += s.blend / speed;
    }
  }
  if (!layout) throw new Error(`compose ${id}: no clip segments`);
  const L = layout;
  const S = L.stride;
  const total = t;
  const frames = Math.max(2, Math.round(total * FPS) + 1);
  const data = new Float32Array(frames * S);
  const tmpA = new Float32Array(S);
  const tmpB = new Float32Array(S);
  const out = new Float32Array(S);

  const clipTime = (p: Extract<Piece, { kind: 'clip' }>, u: number) => p.t0 + (p.t1 - p.t0) * u;
  /** Pose at the end (`end`) or start of the nearest clip piece before/after index i. */
  const edgePose = (i: number, dir: -1 | 1, dst: Float32Array) => {
    for (let k = i + dir; k >= 0 && k < pieces.length; k += dir) {
      const p = pieces[k];
      if (p.kind === 'clip') {
        samplePose(p.clip, clipTime(p, dir < 0 ? 1 : 0), dst);
        return true;
      }
    }
    return false;
  };

  for (let f = 0; f < frames; f++) {
    const tt = Math.min(total, f / FPS);
    let pi = pieces.findIndex((p) => tt >= p.start && tt <= p.start + p.dur + 1e-9);
    if (pi < 0) pi = pieces.length - 1;
    const p = pieces[pi];
    const u = p.dur > 0 ? Math.min(1, (tt - p.start) / p.dur) : 1;
    if (p.kind === 'clip') samplePose(p.clip, clipTime(p, u), out);
    else if (p.kind === 'hold') {
      if (!edgePose(pi, -1, out)) edgePose(pi, 1, out);
    } else {
      const hasA = edgePose(pi, -1, tmpA);
      const hasB = edgePose(pi, 1, tmpB);
      if (hasA && hasB) blendPose(L, out, tmpA, 0, tmpB, 0, smoothstep(u));
      else out.set(hasA ? tmpA : tmpB);
    }
    data.set(out, f * S);
  }

  // Events carried from the source segments.
  const events: ClipEvent[] = [];
  if (recipe.keepEvents !== false)
    for (const p of pieces) {
      if (p.kind !== 'clip') continue;
      const lo = Math.min(p.t0, p.t1);
      const hi = Math.max(p.t0, p.t1);
      for (const e of p.clip.events) {
        if (e.t < lo - 1e-6 || e.t > hi + 1e-6) continue;
        if (recipe.dropEvents?.includes(e.name)) continue;
        const u = (e.t - p.t0) / (p.t1 - p.t0 || 1);
        events.push({ name: e.name, t: p.start + u * p.dur });
      }
    }
  for (const e of recipe.events ?? []) events.push({ name: e.name, t: e.t / speed });
  events.sort((a, b) => a.t - b.t);

  const at = (f: number) => (f / FPS) * speed; // composed (pre-speed) time of frame f
  // Weapon tilt about the grip origin: right-multiply the gun frames.
  if (recipe.tilt?.length) {
    const e = new Euler();
    const q = new Quaternion();
    const qa = [0, 0, 0, 1];
    for (let f = 0; f < frames; f++) {
      const k = recipe.tilt;
      const tt = at(f);
      e.set(
        keyAt(k, tt, (x) => x.r[0]),
        keyAt(k, tt, (x) => x.r[1]),
        keyAt(k, tt, (x) => x.r[2]),
      );
      q.setFromEuler(e);
      qa[0] = q.x;
      qa[1] = q.y;
      qa[2] = q.z;
      qa[3] = q.w;
      for (const off of [L.gunHand, L.gunRoot]) qmul(data, f * S + off + 3, qa, 0, data, f * S + off + 3);
    }
  }
  const overrideKeys = (keys: Key[] | undefined, off: number) => {
    if (!keys?.length) return;
    const t0 = keys[0].t;
    const t1 = keys[keys.length - 1].t;
    for (let f = 0; f < frames; f++) {
      const tt = at(f);
      if (tt < t0 - 1e-6 || tt > t1 + 1e-6) continue;
      data[f * S + off] = keyAt(keys, tt, (k) => k.v);
    }
  };
  overrideKeys(recipe.bolt, L.ch.bolt);
  overrideKeys(recipe.gunW, L.gunW);
  overrideKeys(recipe.magW, L.mag[0].w);

  if (recipe.magDrop) {
    const m = L.mag[1];
    const e = new Euler();
    const q = new Quaternion();
    for (let f = 0; f < frames; f++) {
      const dt = at(f) - recipe.magDrop.t;
      const o = f * S;
      if (dt < 0 || dt > 0.45) {
        data[o + m.vis] = 0;
        continue;
      }
      // Free fall (scaled for the viewmodel), a little forward kick and a tumble.
      data[o + m.gun] = 0;
      data[o + m.gun + 1] = -0.5 * 7.5 * dt * dt - 0.05 * dt;
      data[o + m.gun + 2] = -0.04 * dt;
      q.setFromEuler(e.set(-1.4 * dt * dt * 4, 0, 0.3 * dt));
      data[o + m.gun + 3] = q.x;
      data[o + m.gun + 4] = q.y;
      data[o + m.gun + 5] = q.z;
      data[o + m.gun + 6] = q.w;
      data[o + m.w] = 0;
      data[o + m.vis] = 1;
    }
  }
  if (recipe.magOffset?.length) {
    const m = L.mag[0];
    const keys = recipe.magOffset;
    const e = new Euler();
    const q = new Quaternion();
    const qa = [0, 0, 0, 1];
    for (let f = 0; f < frames; f++) {
      const tt = at(f);
      const o = f * S + m.gun;
      data[o] += keyAt(keys, tt, (k) => k.p[0]);
      data[o + 1] += keyAt(keys, tt, (k) => k.p[1]);
      data[o + 2] += keyAt(keys, tt, (k) => k.p[2]);
      q.setFromEuler(
        e.set(
          keyAt(keys, tt, (k) => k.r?.[0] ?? 0),
          keyAt(keys, tt, (k) => k.r?.[1] ?? 0),
          keyAt(keys, tt, (k) => k.r?.[2] ?? 0),
        ),
      );
      qa[0] = q.x;
      qa[1] = q.y;
      qa[2] = q.z;
      qa[3] = q.w;
      qmul(qa, 0, data, o + 3, data, o + 3);
    }
  }
  const scaleKeys = (ks?: HandKey[]) => ks?.map((k) => ({ ...k, t: k.t / speed }));
  const clip: Clip = {
    id,
    action,
    pack,
    fps: FPS,
    frames,
    duration: (frames - 1) / FPS,
    layout: L,
    data,
    events,
    hold: recipe.hold ? [recipe.hold[0] / speed, recipe.hold[1] / speed] : undefined,
    handL: scaleKeys(recipe.handL),
    handR: scaleKeys(recipe.handR),
    magStyle: recipe.magStyle,
    loop: recipe.loop,
    additive: recipe.additive,
    holdLast: recipe.holdLast,
  };
  // Piece joins can step; the sources' retarget flips are already removed at decode.
  despike(clip);
  // Loops end where they start (no seam at the wrap); additive layers return to a zero delta before they drop.
  if (recipe.loop) settleToStart(clip, 0.3);
  if (recipe.additive) settleToStart(clip, 0.4, true);
  return clip;
}
