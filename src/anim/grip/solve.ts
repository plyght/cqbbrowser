import { Matrix4, Quaternion, Vector3 } from 'three';
import { HAND_POSES, POSE_SIZE } from '../handPoses';
import { FINGERS, PALM, THUMB, THUMB_BONE, WEB, fingerBone, fingerChainFK, thumbFK } from './hand';
import type { Shape, ShapeSet } from './sdf';
import type { GripShapes } from './shapes';
import { armMetrics, armViolation, type ArmContext } from './arm';

/**
 * Grip solver: places a palm frame against the grip surfaces, then curls each finger joint until its pads touch
 * the SDF (bisection along each chain, distal joints coupled). Samples sit on the glove surface, so contact is at
 * sdf = 0 (= the skin at glove thickness). Everything is in the weapon frame.
 */

export type SampleKind = 'pad' | 'side' | 'tip' | 'palm';
export interface Sample {
  p: Vector3;
  /** 0..3 fingers, 4 thumb, -1 palm. */
  finger: number;
  seg: number;
  kind: SampleKind;
}

const MAX_WRAP = Float32Array.from([
  // (index abduction last)
  ...[-1.5, -1.9, -1.3],
  ...[-1.6, -1.9, -1.35],
  ...[-1.65, -1.9, -1.35],
  ...[-1.7, -1.9, -1.35],
  ...[0.9, -1.2, -1.0],
  0,
]);

const mats: Matrix4[] = Array.from({ length: 19 }, () => new Matrix4());
const _v = new Vector3();
const _hm = new Matrix4();

function segLocalSamples(r: number, len: number, seg: number, out: { p: Vector3; kind: SampleKind }[]) {
  const ry = r * 0.88;
  out.push({ p: new Vector3(0, -ry, -len * 0.3), kind: 'pad' });
  out.push({ p: new Vector3(0, -ry, -len * 0.72), kind: 'pad' });
  out.push({ p: new Vector3(r, 0, -len * 0.5), kind: 'side' });
  out.push({ p: new Vector3(-r, 0, -len * 0.5), kind: 'side' });
  out.push({ p: new Vector3(0, ry, -len * 0.5), kind: 'side' });
  if (seg === 2) out.push({ p: new Vector3(0, -ry * 0.45, -len - r * 0.75), kind: 'tip' });
}

/** Per-finger, per-segment local samples (precomputed). */
const LOCAL: { p: Vector3; kind: SampleKind }[][][] = [];
for (let f = 0; f < 5; f++) {
  LOCAL.push([]);
  for (let j = 0; j < 3; j++) {
    const arr: { p: Vector3; kind: SampleKind }[] = [];
    const r = f < 4 ? FINGERS[f].r * (1 - j * 0.07) : THUMB.r * (1 - j * 0.08);
    const len = f < 4 ? FINGERS[f].len[j] : THUMB.len[j];
    segLocalSamples(r, len, j, arr);
    LOCAL[f].push(arr);
  }
}
const PALM_LOCAL: Vector3[] = [];
for (const x of [-0.032, -0.011, 0.011, 0.032])
  for (const z of [-0.03, 0.0, 0.03, 0.058]) PALM_LOCAL.push(new Vector3(x, PALM.c.y - PALM.h.y, z));

const boneOf = (f: number, j: number) => (f < 4 ? fingerBone(f, j) : THUMB_BONE + j);

function chainFK(hand: Matrix4, s: number, f: number, a0: number, a1: number, a2: number) {
  if (f < 4) fingerChainFK(hand, s, f, a0, a1, a2, mats);
  else thumbFK(hand, s, a0, a1, a2, mats);
}

/** Min clearance of finger `f` segments [j0..2] for the given joint angles. */
function chainClear(
  set: ShapeSet,
  hand: Matrix4,
  s: number,
  f: number,
  a: number[],
  j0: number,
  only?: (x: Shape) => boolean,
) {
  chainFK(hand, s, f, a[0], a[1], a[2]);
  let d = Infinity;
  for (let j = j0; j < 3; j++) {
    const m = mats[boneOf(f, j)];
    for (const smp of LOCAL[f][j]) {
      const lp = smp.p;
      // Mirror side samples for the left hand (x).
      _v.set(lp.x * s, lp.y, lp.z).applyMatrix4(m);
      d = Math.min(d, set.sdf(_v, only));
    }
  }
  return d;
}

function bisect(f: (x: number) => number, lo: number, hi: number, it = 14): number {
  // Find the largest |x| in [lo → hi] with f(x) >= 0, assuming f decreases from lo to hi.
  if (f(hi) >= 0) return hi;
  if (f(lo) < 0) return lo;
  for (let i = 0; i < it; i++) {
    const mid = (lo + hi) / 2;
    if (f(mid) >= 0) lo = mid;
    else hi = mid;
  }
  return lo;
}

/**
 * Curl fingers (and thumb) toward `maxCurls` until their pads contact the shapes. `which` selects chains (0..3
 * fingers, 4 thumb). The proximal joint closes first, then the middle joint with the distal coupled to it.
 */
export function curlToContact(
  set: ShapeSet,
  hand: Matrix4,
  s: number,
  maxCurls: ArrayLike<number>,
  out: Float32Array,
  which: number[] = [0, 1, 2, 3, 4],
  only?: (x: Shape) => boolean,
) {
  const a = [0, 0, 0];
  for (const f of which) {
    const i = f * 3;
    if (f === 4) {
      // Thumb: search opposition × curl for the closest contact without penetration.
      const k = maxCurls[13] !== 0 ? maxCurls[14] / maxCurls[13] : 0.8;
      let best = -Infinity,
        bo = maxCurls[12],
        bc = 0;
      for (let oi = 0; oi <= 12; oi++)
        for (let ci = 0; ci <= 10; ci++) {
          a[0] = -1.6 + (oi / 12) * (Math.max(maxCurls[12], -1.6) + 1.6);
          a[1] = (maxCurls[13] * ci) / 10;
          a[2] = a[1] * k;
          const d = chainClear(set, hand, s, 4, a, 0, only);
          // Prefer touching (d≈0) over hovering; never penetrating.
          const score = d < 0 ? d * 100 - 1 : -d;
          if (score > best) [best, bo, bc] = [score, a[0], a[1]];
        }
      out[12] = bo;
      out[13] = bc;
      out[14] = bc * k;
      continue;
    }
    const t0 = bisect(
      (x) => {
        a[0] = x;
        a[1] = 0;
        a[2] = 0;
        return chainClear(set, hand, s, f, a, 0, only);
      },
      0,
      maxCurls[i],
    );
    const k = maxCurls[i + 1] !== 0 ? maxCurls[i + 2] / maxCurls[i + 1] : 0.7;
    const t1 = bisect(
      (x) => {
        a[0] = t0;
        a[1] = x;
        a[2] = x * k;
        return chainClear(set, hand, s, f, a, 1, only);
      },
      0,
      maxCurls[i + 1],
    );
    out[i] = t0;
    out[i + 1] = t1;
    out[i + 2] = t1 * k;
  }
  return out;
}

/** All glove-surface samples (fingers, thumb, palm) for a hand pose. */
/** All glove-surface samples (fingers, thumb, palm) for a hand pose. Reuses `out`'s objects (no allocation). */
export function handSamples(
  hand: Matrix4,
  s: number,
  curls: ArrayLike<number>,
  out: Sample[] = [],
): Sample[] {
  let n = 0;
  const put = (finger: number, seg: number, kind: SampleKind) => {
    let o = out[n];
    if (!o) out[n] = o = { p: new Vector3(), finger, seg, kind };
    o.finger = finger;
    o.seg = seg;
    o.kind = kind;
    n++;
    return o.p;
  };
  for (let f = 0; f < 5; f++) {
    const i = f * 3;
    if (f === 0) fingerChainFK(hand, s, 0, curls[0], curls[1], curls[2], mats, curls[15] ?? 0);
    else chainFK(hand, s, f, curls[i], curls[i + 1], curls[i + 2]);
    for (let j = 0; j < 3; j++) {
      const m = mats[boneOf(f, j)];
      for (const smp of LOCAL[f][j])
        put(f, j, smp.kind)
          .set(smp.p.x * s, smp.p.y, smp.p.z)
          .applyMatrix4(m);
    }
  }
  for (const lp of PALM_LOCAL) put(-1, 0, 'palm').copy(lp).applyMatrix4(hand);
  out.length = n;
  return out;
}

function palmClear(set: ShapeSet, hand: Matrix4, only?: (x: Shape) => boolean) {
  let d = Infinity;
  for (const lp of PALM_LOCAL) d = Math.min(d, set.sdf(_v.copy(lp).applyMatrix4(hand), only));
  return d;
}

export interface GripMetrics {
  /** Max penetration of any glove sample into any surface (m). */
  penetration: number;
  /** Largest gap among intended contact pads (m). */
  gap: number;
  /** Web of the hand → beavertail (m), firing hand only. */
  web?: number;
  /** Index pad → trigger face (m), when on the trigger. */
  trigger?: number;
}

export interface HandSolution {
  pos: Vector3;
  quat: Quaternion;
  curls: Float32Array;
  metrics: GripMetrics;
}

/** Gauss-Newton on the palm translation for a residual function. */
function solveTranslation(res: (t: Vector3, out: number[]) => void, t: Vector3, iters = 12) {
  const r0: number[] = [],
    r1: number[] = [];
  const J: number[][] = [];
  const tt = new Vector3();
  const h = 1e-4;
  for (let it = 0; it < iters; it++) {
    res(t, r0);
    const n = r0.length;
    J.length = 0;
    for (let k = 0; k < 3; k++) {
      tt.copy(t).setComponent(k, t.getComponent(k) + h);
      res(tt, r1);
      J.push(r1.map((v, i) => (v - r0[i]) / h));
    }
    // (JᵀJ + λI) δ = -Jᵀ r
    const A = [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ];
    const b = [0, 0, 0];
    for (let a = 0; a < 3; a++) {
      for (let c = 0; c < 3; c++) for (let i = 0; i < n; i++) A[a][c] += J[a][i] * J[c][i];
      for (let i = 0; i < n; i++) b[a] -= J[a][i] * r0[i];
      A[a][a] += 1e-6;
    }
    const d = solve3(A, b);
    t.x += d[0];
    t.y += d[1];
    t.z += d[2];
    if (Math.hypot(d[0], d[1], d[2]) < 1e-6) break;
  }
  return t;
}

function solve3(A: number[][], b: number[]): number[] {
  const det = (m: number[][]) =>
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
    m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
    m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const D = det(A);
  if (Math.abs(D) < 1e-18) return [0, 0, 0];
  const out = [0, 0, 0];
  for (let k = 0; k < 3; k++) {
    const M = A.map((row, i) => row.map((v, j) => (j === k ? b[i] : v)));
    out[k] = det(M) / D;
  }
  return out;
}

const basis = new Matrix4();
function quatFromAxes(x: Vector3, y: Vector3, z: Vector3) {
  return new Quaternion().setFromRotationMatrix(basis.makeBasis(x, y, z));
}

const notSupport = (x: Shape) => x.name !== 'supportWrap';

/** Firing hand on the pistol grip: web high on the beavertail, palm on the grip side, index on frame/trigger. */
export function solveFiring(g: GripShapes, onTrigger: boolean): HandSolution {
  const X = new Vector3(1, 0, 0);
  const x = g.gripDown.clone();
  const y = X.clone();
  const z = new Vector3().crossVectors(x, y).normalize();
  const quat = quatFromAxes(x, y, z);
  const web = new Vector3();
  const place = (bt: Vector3) => {
    const t = g.gripCenter.clone().add(new Vector3(-0.006, 0, 0));
    solveTranslation((p, out) => {
      _hm.compose(p, quat, ONE);
      out.length = 0;
      out.push(palmClear(g.set, _hm, notSupport) * 4);
      web.copy(WEB).applyMatrix4(_hm).sub(bt);
      out.push(web.x, web.y, web.z);
    }, t);
    return t;
  };
  // The hand rides as high on the beavertail as it can while the index still reaches the trigger face:
  // search the web target along the backstrap (within the 8 mm web tolerance).
  let t = place(g.beavertail);
  let bestReach = Infinity;
  const tmpCurls = new Float32Array(POSE_SIZE);
  for (let i = -3; i <= 3; i++)
    for (let j = -1; j <= 1; j++) {
      const bt = g.beavertail
        .clone()
        .addScaledVector(g.gripDown, i * 0.0022)
        .addScaledVector(g.gripBack, j * 0.002);
      const tt = place(bt);
      const reach = placeIndexOnTrigger(g, new Matrix4().compose(tt, quat, ONE), tmpCurls);
      const webD = new Vector3()
        .copy(WEB)
        .applyMatrix4(new Matrix4().compose(tt, quat, ONE))
        .distanceTo(g.beavertail);
      const score = reach + Math.max(0, webD - 0.0075) * 10;
      if (score < bestReach) [bestReach, t] = [score, tt];
    }
  const hand = new Matrix4().compose(t, quat, ONE);
  const curls = new Float32Array(POSE_SIZE);
  curlToContact(g.set, hand, 1, MAX_WRAP, curls, [1, 2, 3, 4], notSupport);
  let triggerDist: number | undefined;
  if (onTrigger) triggerDist = placeIndexOnTrigger(g, hand, curls);
  else {
    const frameMax = Float32Array.from(curls);
    frameMax[0] = -0.5;
    frameMax[1] = -0.08;
    frameMax[2] = -0.05;
    curlToContact(g.set, hand, 1, frameMax, curls, [0], notSupport);
  }
  const metrics = measure(g.set, hand, 1, curls, [1, 2, 3], notSupport);
  metrics.web = new Vector3().copy(WEB).applyMatrix4(hand).distanceTo(g.beavertail);
  if (triggerDist !== undefined) metrics.trigger = triggerDist;
  return { pos: t, quat, curls, metrics };
}

const ONE = new Vector3(1, 1, 1);

function placeIndexOnTrigger(g: GripShapes, hand: Matrix4, curls: Float32Array): number {
  const tip = new Vector3();
  const pen = (x: Shape) => x.name !== 'supportWrap' && x.name !== 'trigger';
  const cost = (x0: number, x1: number, ab: number) => {
    fingerChainFK(hand, 1, 0, x0, x1, x1 * 0.6, mats, ab);
    tip.copy(LOCAL[0][2][1].p).applyMatrix4(mats[boneOf(0, 2)]);
    const d = tip.distanceTo(g.triggerFace);
    let clear = Infinity;
    for (let j = 0; j < 3; j++)
      for (const smp of LOCAL[0][j])
        clear = Math.min(clear, g.set.sdf(_v.copy(smp.p).applyMatrix4(mats[boneOf(0, j)]), pen));
    return d + Math.max(0, -clear) * 10;
  };
  let best = Infinity,
    b0 = 0,
    b1 = 0,
    b2 = 0;
  for (let i = 0; i <= 12; i++)
    for (let j = 0; j <= 12; j++)
      for (let k = -3; k <= 3; k++) {
        const x0 = (-1.3 * i) / 12,
          x1 = (-1.7 * j) / 12,
          ab = k * 0.1;
        const c = cost(x0, x1, ab);
        if (c < best) [best, b0, b1, b2] = [c, x0, x1, ab];
      }
  let step = 0.06;
  for (let it = 0; it < 40 && step > 1e-4; it++) {
    let moved = false;
    for (const [d0, d1, d2] of [
      [step, 0, 0],
      [-step, 0, 0],
      [0, step, 0],
      [0, -step, 0],
      [0, 0, step],
      [0, 0, -step],
    ]) {
      const c = cost(b0 + d0, b1 + d1, Math.max(-0.35, Math.min(0.35, b2 + d2)));
      if (c < best) {
        [best, b0, b1, b2] = [c, b0 + d0, b1 + d1, Math.max(-0.35, Math.min(0.35, b2 + d2))];
        moved = true;
      }
    }
    if (!moved) step *= 0.5;
  }
  curls[0] = b0;
  curls[1] = b1;
  curls[2] = b1 * 0.6;
  curls[15] = b2;
  cost(b0, b1, b2);
  return tip.distanceTo(g.triggerFace);
}

/**
 * Support hand. Rifles: palm against the handguard at angle `a` around the bore, fingers wrapping around it at
 * angle `phi` toward the muzzle, thumb forward along the guard. Pistol: palm over the firing fingers, fingers
 * angled by `phi`, rolled by `a`. With arm contexts the (a, phi) pair is searched so every hold keeps the wrist
 * and elbow in anatomical ranges (the hand orientation is a free variable of the grip, the arm is not).
 */
export function solveSupport(g: GripShapes, firing?: HandSolution, arms?: ArmContext[]): HandSolution {
  if (!arms?.length)
    return supportWith(g, firing, g.pistol ? 0 : (205 * Math.PI) / 180, g.pistol ? -0.3 : 0.5);
  let best: HandSolution | null = null;
  let bestScore = Infinity;
  for (const sol of supportCandidates(g, firing)) {
    const score = supportScore(sol, arms, g.pistol);
    if (score < bestScore) [bestScore, best] = [score, sol];
  }
  return best!;
}

/** Candidate support grips over the (a, phi) family (independent of the arm, so they can be cached). */
export function supportCandidates(g: GripShapes, firing?: HandSolution): (HandSolution & { phi: number })[] {
  const As = g.pistol
    ? [-0.4, -0.2, 0, 0.2, 0.4]
    : [150, 165, 180, 195, 210, 225, 240, 255, 270].map((d) => (d * Math.PI) / 180);
  const Ps = g.pistol ? [-0.7, -0.5, -0.3, -0.1, 0.1] : [0, 0.2, 0.4, 0.6, 0.8, 1.0, 1.2];
  const out: (HandSolution & { phi: number })[] = [];
  for (const a of As) for (const phi of Ps) out.push({ ...supportWith(g, firing, a, phi), phi });
  return out;
}

/** Arm-range violations over the holds + contact quality + a mild preference for the textbook wrap. */
export function supportScore(
  sol: HandSolution & { phi?: number },
  arms: ArmContext[],
  pistol: boolean,
): number {
  const hand = new Matrix4().compose(sol.pos, sol.quat, ONE);
  let score = 0;
  for (const c of arms) score += armViolation(armMetrics(c.shoulder, c.natural, hand, -1, c.up), 3);
  score += Math.max(0, sol.metrics.penetration - 0.0015) * 2e4 + Math.max(0, sol.metrics.gap - 0.003) * 2e4;
  return score + Math.abs((sol.phi ?? 0) - (pistol ? -0.3 : 0.5)) * 0.5;
}

function supportWith(g: GripShapes, firing: HandSolution | undefined, a: number, phi: number): HandSolution {
  const only = (x: Shape) => x.name === g.supportShape;
  let quat: Quaternion;
  const t = g.support.clone();
  if (g.pistol) {
    const y = new Vector3(-1, 0, 0);
    const z = g.gripBack.clone();
    const x = new Vector3().crossVectors(y, z).normalize();
    const q0 = quatFromAxes(x, y, z);
    // Fingers tilt (about the palm normal) and roll (about the finger axis).
    quat = q0
      .multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), phi))
      .multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), a));
    const f = firing?.pos ?? g.gripCenter;
    const du = f.dot(g.gripDown) + 0.012,
      dw = f.dot(g.gripBack) - 0.006;
    t.copy(f).add(new Vector3(-0.03, 0, 0));
    solveTranslation((p, out) => {
      _hm.compose(p, quat, ONE);
      out.length = 0;
      out.push(palmClear(g.set, _hm, only) * 2, (p.dot(g.gripDown) - du) * 2, (p.dot(g.gripBack) - dw) * 2);
    }, t);
  } else {
    const pdir = new Vector3(Math.cos(a), Math.sin(a), 0);
    const b = new Vector3(0, 0, -1);
    const tan = new Vector3().crossVectors(pdir, b).normalize();
    const f = tan.clone().multiplyScalar(Math.cos(phi)).addScaledVector(b, Math.sin(phi)).normalize();
    const y = pdir.clone();
    const z = f.clone().negate();
    const x = new Vector3().crossVectors(y, z).normalize();
    quat = quatFromAxes(x, y, z);
    const hg = g.set.get(g.supportShape);
    const axisY = hg && hg.kind === 'box' ? -hg.inv.elements[13] : g.support.y;
    const sz = g.support.z;
    t.set(0, axisY, sz).addScaledVector(pdir, 0.05);
    solveTranslation((p, out) => {
      _hm.compose(p, quat, ONE);
      out.length = 0;
      out.push(palmClear(g.set, _hm, only) * 2);
      const pc = _v.copy(PALM.c).applyMatrix4(_hm);
      out.push((pc.z - sz) * 2);
      out.push((pc.x * tan.x + (pc.y - axisY) * tan.y) * 2);
    }, t);
  }
  const hand = new Matrix4().compose(t, quat, ONE);
  const curls = new Float32Array(POSE_SIZE);
  curlToContact(g.set, hand, -1, MAX_WRAP, curls, [0, 1, 2, 3, 4], g.pistol ? undefined : notSupport);
  // Pistol: the support index rides the front of the trigger guard (contact on middle–pinky); rifles: the pinky
  // may run off the end of a short guard, so contact is required on index–ring.
  const metrics = measure(
    g.set,
    hand,
    -1,
    curls,
    g.pistol ? [1, 2, 3] : [0, 1, 2],
    only,
    g.pistol ? undefined : notSupport,
  );
  return { pos: t, quat, curls, metrics };
}

/**
 * Penetration over all samples against all surfaces (`penOnly`), and the contact gap over intended pads (fingers
 * listed in `contactFingers`, measured against `contactOnly`).
 */
export function measure(
  set: ShapeSet,
  hand: Matrix4,
  s: number,
  curls: ArrayLike<number>,
  contactFingers: number[],
  contactOnly?: (x: Shape) => boolean,
  penOnly?: (x: Shape) => boolean,
): GripMetrics {
  const smp = handSamples(hand, s, curls);
  let minAll = Infinity;
  const perFinger = new Map<number, number>();
  let palm = Infinity;
  for (const x of smp) {
    minAll = Math.min(minAll, set.sdf(x.p, penOnly ?? contactOnly));
    if (x.kind === 'pad' || x.kind === 'tip') {
      if (!contactFingers.includes(x.finger) || x.seg === 0) continue;
      const d = set.sdf(x.p, contactOnly);
      perFinger.set(x.finger, Math.min(perFinger.get(x.finger) ?? Infinity, d));
    } else if (x.kind === 'palm') palm = Math.min(palm, set.sdf(x.p, contactOnly));
  }
  let gap = Math.max(0, palm);
  for (const d of perFinger.values()) gap = Math.max(gap, d);
  return { penetration: Math.max(0, -minAll), gap };
}

/** Default (authored) curls, exported for callers that only want contact limiting. */
export const AUTHORED = HAND_POSES;
