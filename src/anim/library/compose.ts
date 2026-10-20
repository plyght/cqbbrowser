import { Euler, Quaternion } from 'three';
import type { ClipEvent, V3 } from '../rig/clipData';
import {
  blendPose,
  despike,
  qmul,
  samplePose,
  settleToStart,
  type Clip,
  type ClipPresent,
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

/**
 * Mag check: the mag leaves the well completely and is presented to the camera (procedural layer in ArmsRig on top
 * of the composed arms). `path`: 0 = seated, 1 = clear of the well (with a gap), 2 = presented; `hand`: the support
 * hand rides the mag (0..1). Keys are interpolated monotone-cubic (no overshoot, no velocity steps).
 */
export interface PresentRecipe {
  path: Key[];
  hand: Key[];
  /** The mag's centre in the present frame (chest cam: -z forward, metres) and its XYZ euler there (rad). */
  pose: { p: V3; r: V3 };
  /** Offset (present frame) at the middle of the clear → presented leg, to swing the mag around the gun. */
  arc?: V3;
  /** Source-clip frame whose mag-in-support-hand transform is the grip on the mag. */
  grip: { clip: string; t: number };
  /**
   * Move that grip around our mag (mag frame): turn the hand about the mag's long axis through its centre (rad) and
   * shift it (m), so the hand holds the front / base and leaves the witness holes, window and lips in view.
   */
  gripTurn?: number;
  gripShift?: V3;
  /** AK-style rock out/in about the front lug (rad, bottom swings forward) over the first `rockSpan` of the path. */
  rock?: number;
  rockSpan?: number;
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
  magDrop?: {
    t: number;
    /** Show the old mag seated in the well until `t` (AK: it stays in until the fresh mag knocks it out). */
    hold?: boolean;
    /** Extra launch velocity (model frame, m/s): knocked forward, flicked aside. */
    kick?: V3;
  };
  /** Launch velocity (model frame, m/s) the controller gives the physical floor mag at `magOut`. */
  drop?: V3;
  /** Offset of the seated mag (slot 0) in the model frame, weighted: partial drop for a mag check. */
  magOffset?: { t: number; p: V3; r?: V3 }[];
  hold?: [number, number];
  loop?: boolean;
  additive?: boolean;
  holdLast?: boolean;
  magStyle?: 'rock' | 'straight';
  present?: PresentRecipe;
}

const FPS = 30;
const smoothstep = (x: number) => x * x * (3 - 2 * x);

type Piece =
  | { kind: 'clip'; clip: Clip; t0: number; t1: number; start: number; dur: number }
  | { kind: 'hold'; start: number; dur: number }
  | { kind: 'blend'; start: number; dur: number };

/**
 * Monotone cubic (Fritsch–Carlson) interpolation over sorted keys (clamped): smooth velocity through the keys and
 * no overshoot between them.
 */
export function smoothKeyAt(keys: Key[], t: number): number {
  const n = keys.length;
  if (t <= keys[0].t) return keys[0].v;
  if (t >= keys[n - 1].t) return keys[n - 1].v;
  let i = 1;
  while (keys[i].t < t) i++;
  const slope = (j: number) => (keys[j + 1].v - keys[j].v) / Math.max(1e-6, keys[j + 1].t - keys[j].t);
  const tan = (j: number) => {
    if (j <= 0 || j >= n - 1) return 0;
    const a = slope(j - 1),
      b = slope(j);
    if (a * b <= 0) return 0;
    // Harmonic mean of the neighbouring slopes (monotone, no overshoot).
    return (2 * a * b) / (a + b);
  };
  const a = keys[i - 1],
    b = keys[i];
  const h = Math.max(1e-6, b.t - a.t);
  const u = (t - a.t) / h;
  const m0 = tan(i - 1) * h,
    m1 = tan(i) * h;
  const u2 = u * u,
    u3 = u2 * u;
  return (2 * u3 - 3 * u2 + 1) * a.v + (u3 - 2 * u2 + u) * m0 + (-2 * u3 + 3 * u2) * b.v + (u3 - u2) * m1;
}

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
      if (dt < 0 && recipe.magDrop.hold) {
        // Still seated.
        for (let k = 0; k < 6; k++) data[o + m.gun + k] = 0;
        data[o + m.gun + 6] = 1;
        data[o + m.w] = 0;
        data[o + m.vis] = 1;
        continue;
      }
      if (dt < 0 || dt > 0.45) {
        data[o + m.vis] = 0;
        continue;
      }
      // Free fall (scaled for the viewmodel), a little forward kick and a tumble.
      const kk = recipe.magDrop.kick ?? [0, 0, 0];
      data[o + m.gun] = kk[0] * dt;
      data[o + m.gun + 1] = -0.5 * 7.5 * dt * dt - 0.05 * dt + kk[1] * dt;
      data[o + m.gun + 2] = -0.04 * dt + kk[2] * dt;
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
  let present: ClipPresent | undefined;
  if (recipe.present) {
    const pr = recipe.present;
    const src = clips[pr.grip.clip];
    if (!src) throw new Error(`compose ${id}: unknown grip clip ${pr.grip.clip}`);
    samplePose(src, pr.grip.t, tmpA);
    const o = L.mag[0].hand;
    const sk = (ks: Key[]) => ks.map((k) => ({ t: k.t / speed, v: k.v }));
    const path = sk(pr.path);
    const hand = sk(pr.hand);
    present = {
      path,
      hand,
      pose: pr.pose,
      arc: pr.arc ?? [0, 0, 0],
      rock: pr.rock ?? 0,
      rockSpan: pr.rockSpan ?? 0.3,
      grip: tmpA.slice(o, o + 7),
      gripTurn: pr.gripTurn ?? 0,
      gripShift: pr.gripShift ?? [0, 0, 0],
      t0: Math.min(path[0].t, hand[0].t),
      t1: Math.max(path[path.length - 1].t, hand[hand.length - 1].t),
    };
  }
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
    present,
    drop: recipe.drop,
    tilt: recipe.tilt?.map((k) => ({ t: k.t / speed, r: k.r })),
  };
  // Piece joins can step; the sources' retarget flips are already removed at decode.
  despike(clip);
  // Loops end where they start (no seam at the wrap); additive layers return to a zero delta before they drop.
  if (recipe.loop) settleToStart(clip, 0.3);
  if (recipe.additive) settleToStart(clip, 0.4, true);
  return clip;
}
