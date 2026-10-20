import { Matrix4, Vector3, type Bone, type Mesh, type Object3D, type SkinnedMesh } from 'three';
import { box, capsule, sdShape, type Shape } from '../grip/sdf';
import { FINGERS, HandProxy, PALM, WRIST, type Side } from './handProxy';

/**
 * Ground truth for the contact layer: true mesh-vs-mesh distances between the skinned glove and the weapon's
 * render mesh (no proxies on either side). Used by the grip audit / CI to judge what the proxies and the solver
 * claim: per hand region (palm, each phalanx pad, thumb) the signed gap (m, < 0 = inside the gun), which weapon
 * face it is nearest to (outward normal, weapon frame) and whether the pad faces it (normals opposed).
 *
 * Weapon side: every triangle in a uniform grid (1.5 cm cells); exact point-triangle distance; the sign comes from
 * the nearest triangle's face normal (ties on shared edges/vertices: the face the point is most clearly off).
 */

// ------------------------------------------------------------------------------------------ weapon triangles

export interface TriField {
  /** 9 floats per triangle (weapon frame). */
  tri: Float32Array;
  /** Unit face normal per triangle. */
  nrm: Float32Array;
  cell: number;
  grid: Map<number, number[]>;
  /** Per-triangle query stamp (dedupe across cells). */
  seen: Int32Array;
  query: number;
}

const key = (x: number, y: number, z: number) => ((x + 512) * 1024 + (y + 512)) * 1024 + (z + 512);
const _m = new Matrix4();
const _a = new Vector3();
const _b = new Vector3();
const _c = new Vector3();

/** Triangles of every mesh under `root` (incl. parts at their current pose) in the frame `toFrame` × world. */
export function triField(
  root: Object3D,
  toFrame: Matrix4,
  include: (m: Mesh) => boolean = () => true,
): TriField {
  const tri: number[] = [];
  const nrm: number[] = [];
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh || !include(mesh) || !isShown(mesh)) return;
    const pa = mesh.geometry.attributes.position;
    const ix = mesh.geometry.index;
    _m.multiplyMatrices(toFrame, mesh.matrixWorld);
    const nt = ix ? ix.count / 3 : pa.count / 3;
    for (let t = 0; t < nt; t++) {
      _a.fromBufferAttribute(pa, ix ? ix.getX(t * 3) : t * 3).applyMatrix4(_m);
      _b.fromBufferAttribute(pa, ix ? ix.getX(t * 3 + 1) : t * 3 + 1).applyMatrix4(_m);
      _c.fromBufferAttribute(pa, ix ? ix.getX(t * 3 + 2) : t * 3 + 2).applyMatrix4(_m);
      // three's CCW front face: n = (b - a) × (c - a).
      const n = _b.clone().sub(_a).cross(_c.clone().sub(_a));
      const l = n.length();
      if (l < 1e-12) continue;
      n.divideScalar(l);
      tri.push(_a.x, _a.y, _a.z, _b.x, _b.y, _b.z, _c.x, _c.y, _c.z);
      nrm.push(n.x, n.y, n.z);
    }
  });
  return buildField(tri, nrm);
}

/** Field from raw triangles (9 floats each) and unit normals (3 each). */
export function buildField(tri: number[], nrm: number[]): TriField {
  const cell = 0.015;
  const grid = new Map<number, number[]>();
  for (let t = 0; t < tri.length / 9; t++) {
    let x0 = Infinity,
      y0 = Infinity,
      z0 = Infinity,
      x1 = -Infinity,
      y1 = -Infinity,
      z1 = -Infinity;
    for (let k = 0; k < 3; k++) {
      const o = t * 9 + k * 3;
      x0 = Math.min(x0, tri[o]);
      x1 = Math.max(x1, tri[o]);
      y0 = Math.min(y0, tri[o + 1]);
      y1 = Math.max(y1, tri[o + 1]);
      z0 = Math.min(z0, tri[o + 2]);
      z1 = Math.max(z1, tri[o + 2]);
    }
    for (let x = Math.floor(x0 / cell); x <= Math.floor(x1 / cell); x++)
      for (let y = Math.floor(y0 / cell); y <= Math.floor(y1 / cell); y++)
        for (let z = Math.floor(z0 / cell); z <= Math.floor(z1 / cell); z++) {
          const k = key(x, y, z);
          let l = grid.get(k);
          if (!l) grid.set(k, (l = []));
          l.push(t);
        }
  }
  return {
    tri: Float32Array.from(tri),
    nrm: Float32Array.from(nrm),
    cell,
    grid,
    seen: new Int32Array(nrm.length / 3),
    query: 0,
  };
}

function isShown(o: Object3D): boolean {
  for (let p: Object3D | null = o; p; p = p.parent) if (!p.visible) return false;
  return true;
}

export interface Closest {
  /** Signed distance (m, < 0 inside). */
  d: number;
  /** Closest surface point and the face's outward normal. */
  q: Vector3;
  n: Vector3;
  tri: number;
}

const _q = new Vector3();
const _ab = new Vector3();
const _ac = new Vector3();
const _ap = new Vector3();

/** Closest point on triangle (Ericson, RTCD 5.1.5). */
function closestOnTri(p: Vector3, a: Vector3, b: Vector3, c: Vector3, out: Vector3) {
  _ab.subVectors(b, a);
  _ac.subVectors(c, a);
  _ap.subVectors(p, a);
  const d1 = _ab.dot(_ap),
    d2 = _ac.dot(_ap);
  if (d1 <= 0 && d2 <= 0) return out.copy(a);
  const bp = _q.subVectors(p, b);
  const d3 = _ab.dot(bp),
    d4 = _ac.dot(bp);
  if (d3 >= 0 && d4 <= d3) return out.copy(b);
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) return out.copy(a).addScaledVector(_ab, d1 / (d1 - d3));
  const cp = _q.subVectors(p, c);
  const d5 = _ab.dot(cp),
    d6 = _ac.dot(cp);
  if (d6 >= 0 && d5 <= d6) return out.copy(c);
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) return out.copy(a).addScaledVector(_ac, d2 / (d2 - d6));
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0)
    return out.copy(b).addScaledVector(_q.subVectors(c, b), (d4 - d3) / (d4 - d3 + (d5 - d6)));
  const den = 1 / (va + vb + vc);
  return out
    .copy(a)
    .addScaledVector(_ab, vb * den)
    .addScaledVector(_ac, vc * den);
}

const _ta = new Vector3();
const _tb = new Vector3();
const _tc = new Vector3();
const _cp = new Vector3();
const _dv = new Vector3();

/** Nearest weapon surface to `p` within `maxD` (false if none). */
export function closest(f: TriField, p: Vector3, maxD: number, out: Closest): boolean {
  const c = f.cell;
  const r = Math.ceil(maxD / c);
  const cx = Math.floor(p.x / c),
    cy = Math.floor(p.y / c),
    cz = Math.floor(p.z / c);
  let best = maxD * maxD;
  let bestT = -1;
  let bestOff = 0;
  const stamp = ++f.query;
  for (let x = cx - r; x <= cx + r; x++)
    for (let y = cy - r; y <= cy + r; y++)
      for (let z = cz - r; z <= cz + r; z++) {
        // Cell lower bound vs the best so far.
        const dx = Math.max(x * c - p.x, 0, p.x - (x + 1) * c);
        const dy = Math.max(y * c - p.y, 0, p.y - (y + 1) * c);
        const dz = Math.max(z * c - p.z, 0, p.z - (z + 1) * c);
        if (dx * dx + dy * dy + dz * dz > best) continue;
        const l = f.grid.get(key(x, y, z));
        if (!l) continue;
        for (const t of l) {
          if (f.seen[t] === stamp) continue;
          f.seen[t] = stamp;
          const o = t * 9;
          _ta.set(f.tri[o], f.tri[o + 1], f.tri[o + 2]);
          _tb.set(f.tri[o + 3], f.tri[o + 4], f.tri[o + 5]);
          _tc.set(f.tri[o + 6], f.tri[o + 7], f.tri[o + 8]);
          closestOnTri(p, _ta, _tb, _tc, _cp);
          const d2 = _cp.distanceToSquared(p);
          _dv.subVectors(p, _cp);
          const off = Math.abs(_dv.x * f.nrm[t * 3] + _dv.y * f.nrm[t * 3 + 1] + _dv.z * f.nrm[t * 3 + 2]);
          // Ties (shared edge / vertex): keep the face the point is most clearly in front of / behind.
          if (d2 < best - 1e-12 || (Math.abs(d2 - best) <= 1e-12 && off > bestOff)) {
            best = d2;
            bestT = t;
            bestOff = off;
            out.q.copy(_cp);
          }
        }
      }
  if (bestT < 0) return false;
  out.tri = bestT;
  out.n.set(f.nrm[bestT * 3], f.nrm[bestT * 3 + 1], f.nrm[bestT * 3 + 2]);
  _dv.subVectors(p, out.q);
  let s = _dv.dot(out.n) < 0 ? -1 : 1;
  // Deeper than 1.5 mm by the nearest face: confirm by ray parity (kit meshes have overlapping shells and
  // interior faces, so a sub-mm move can flip the nearest face — the vote keeps the sign stable).
  if (s < 0 && best > 0.0015 * 0.0015 && !insideVote(f, p)) {
    s = 1;
    out.n.copy(_dv).normalize();
  }
  out.d = s * Math.sqrt(best);
  return true;
}

const RAYS = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];
const _e1 = new Vector3();
const _e2 = new Vector3();
const _pv = new Vector3();
const _tv = new Vector3();
const _qv = new Vector3();
const _rd = new Vector3();

/** Inside by majority of 6 axis rays (crossing parity within 8 cm). */
export function insideVote(f: TriField, p: Vector3): boolean {
  let inside = 0;
  const c = f.cell;
  for (const r of RAYS) {
    _rd.set(r[0], r[1], r[2]);
    const stamp = ++f.query;
    let hits = 0;
    const steps = Math.ceil(0.08 / c) + 1;
    const cx = Math.floor(p.x / c),
      cy = Math.floor(p.y / c),
      cz = Math.floor(p.z / c);
    for (let k = 0; k <= steps; k++) {
      const l = f.grid.get(key(cx + r[0] * k, cy + r[1] * k, cz + r[2] * k));
      if (!l) continue;
      for (const t of l) {
        if (f.seen[t] === stamp) continue;
        f.seen[t] = stamp;
        const o = t * 9;
        _ta.set(f.tri[o], f.tri[o + 1], f.tri[o + 2]);
        _e1.set(f.tri[o + 3], f.tri[o + 4], f.tri[o + 5]).sub(_ta);
        _e2.set(f.tri[o + 6], f.tri[o + 7], f.tri[o + 8]).sub(_ta);
        _pv.crossVectors(_rd, _e2);
        const det = _e1.dot(_pv);
        if (Math.abs(det) < 1e-14) continue;
        const inv = 1 / det;
        _tv.subVectors(p, _ta);
        const u = _tv.dot(_pv) * inv;
        if (u < 0 || u > 1) continue;
        _qv.crossVectors(_tv, _e1);
        const v = _rd.dot(_qv) * inv;
        if (v < 0 || u + v > 1) continue;
        const tt = _e2.dot(_qv) * inv;
        if (tt > 1e-7 && tt < 0.08) hits++;
      }
    }
    if (hits % 2 === 1) inside++;
  }
  return inside >= 4;
}

/**
 * The skinned glove's triangles of one hand (every triangle with a vertex dominated by that hand's bones), at
 * the current pose, in the frame `toFrame` × world — the firing hand as an obstacle for the support hand.
 */
export function gloveTris(g: GloveRegions, toFrame: Matrix4): { tri: number[]; nrm: number[] } {
  const mesh = g.mesh;
  const own = new Set<number>();
  for (const l of g.all.values()) for (const i of l) own.add(i);
  const ix = mesh.geometry.index;
  const nt = ix ? ix.count / 3 : mesh.geometry.attributes.position.count / 3;
  _m.multiplyMatrices(toFrame, mesh.matrixWorld);
  const tri: number[] = [];
  const nrm: number[] = [];
  const P = [_a, _b, _c];
  for (let t = 0; t < nt; t++) {
    const v = [0, 1, 2].map((k) => (ix ? ix.getX(t * 3 + k) : t * 3 + k));
    if (!v.some((i) => own.has(i))) continue;
    for (let k = 0; k < 3; k++) mesh.getVertexPosition(v[k], P[k]).applyMatrix4(_m);
    const n = _b.clone().sub(_a).cross(_c.clone().sub(_a));
    const l = n.length();
    if (l < 1e-12) continue;
    n.divideScalar(l);
    tri.push(_a.x, _a.y, _a.z, _b.x, _b.y, _b.z, _c.x, _c.y, _c.z);
    nrm.push(n.x, n.y, n.z);
  }
  return { tri, nrm };
}

/**
 * The firing hand as an analytic obstacle (bone-driven capsules + palm box, `HandProxy`): the glove mesh is open
 * (cuff, seams), so its inside/outside sign is unreliable; the proxies are not.
 */
export class HandObstacle {
  readonly proxy: HandProxy;
  private shapes: Shape[] = [];
  constructor(bone: (n: string) => Bone, side: Side = 'R') {
    this.proxy = new HandProxy(side, bone);
  }
  update(toWeapon: Matrix4) {
    const h = this.proxy;
    h.update(toWeapon);
    this.shapes = h.phalanges.map((ph) => capsule(ph.name, ph.a, ph.b, ph.r));
    this.shapes.push(box('palm', h.palm, h.palmHalf, PALM.halfN));
    this.shapes.push(capsule('wrist', h.wristA, h.wristB, WRIST.r));
  }
  sdf = (p: Vector3): number => {
    let d = Infinity;
    for (const s of this.shapes) d = Math.min(d, sdShape(s, p));
    return d;
  };
}

// ------------------------------------------------------------------------------------------ glove regions

export type Region = 'palm' | `${(typeof FINGERS)[number]}${1 | 2 | 3}`;
export const REGIONS: Region[] = [
  'palm',
  ...FINGERS.flatMap((f) => [1, 2, 3].map((j) => `${f}${j}` as Region)),
];

export interface GloveRegions {
  side: Side;
  mesh: SkinnedMesh;
  /** Pad-side vertex indices per region (palm: palmar side of the hand bone's vertices). */
  pads: Map<Region, number[]>;
  /** Every vertex per region (dominant skin bone). */
  all: Map<Region, number[]>;
}

/**
 * Label the glove's vertices per hand region at the bind pose: dominant skin bone (hand / phalanx) and the pad
 * side (in front of the bone along the palm normal, measured with the same palm frame as `HandProxy`).
 */
export function gloveRegions(mesh: SkinnedMesh, canon: Map<Bone, string>, side: Side): GloveRegions {
  const s = side === 'R' ? 'Right' : 'Left';
  const bones = mesh.skeleton.bones;
  const bind = bones.map((_, i) => new Matrix4().copy(mesh.skeleton.boneInverses[i]).invert());
  const idx = (n: string) => bones.findIndex((b) => canon.get(b) === n);
  const pos = (n: string) => new Vector3().setFromMatrixPosition(bind[idx(n)]);
  const o = pos(`${s}Hand`);
  const u = pos(`${s}HandMiddle1`).sub(o).normalize();
  const w = pos(`${s}HandIndex1`).sub(pos(`${s}HandPinky1`));
  w.addScaledVector(u, -w.dot(u)).normalize();
  const n = new Vector3().crossVectors(u, w).multiplyScalar(side === 'R' ? -1 : 1);
  const regionOf = new Map<number, Region>();
  regionOf.set(idx(`${s}Hand`), 'palm');
  for (const f of FINGERS)
    for (const j of [1, 2, 3] as const) {
      const i = idx(`${s}Hand${f}${j}`);
      if (i >= 0) regionOf.set(i, `${f}${j}`);
    }
  const pads = new Map<Region, number[]>(REGIONS.map((r) => [r, []]));
  const all = new Map<Region, number[]>(REGIONS.map((r) => [r, []]));
  const g = mesh.geometry;
  const P = g.attributes.position,
    SI = g.attributes.skinIndex,
    SW = g.attributes.skinWeight;
  const v = new Vector3();
  for (let i = 0; i < P.count; i++) {
    let bi = -1,
      bw = 0;
    for (let k = 0; k < 4; k++) {
      const wk = SW.getComponent(i, k);
      if (wk > bw) {
        bw = wk;
        bi = SI.getComponent(i, k);
      }
    }
    const r = regionOf.get(bi);
    if (!r) continue;
    all.get(r)!.push(i);
    v.fromBufferAttribute(P, i).applyMatrix4(mesh.bindMatrix);
    const bo = new Vector3().setFromMatrixPosition(bind[bi]);
    if (v.sub(bo).dot(n) > (r === 'palm' ? 0.004 : 0.001)) pads.get(r)!.push(i);
  }
  return { side, mesh, pads, all };
}

export interface RegionTruth {
  /** Signed gap of the region (min over its pad vertices), m; < 0 = penetration depth. */
  d: number;
  /** Nearest weapon face normal (weapon frame) of the closest vertex, and the pad normal there. */
  n: Vector3;
  pad: Vector3;
  /** Closest vertex (weapon frame). */
  at: Vector3;
  /** Region found a surface within range. */
  near: boolean;
}

const _v = new Vector3();
const _vn = new Vector3();
const _hit: Closest = { d: 0, q: new Vector3(), n: new Vector3(), tri: -1 };

/** Measure every region of one glove against the weapon (`toWeapon` = inverse weapon world matrix). */
export function measureGlove(
  g: GloveRegions,
  f: TriField,
  toWeapon: Matrix4,
  maxD = 0.03,
  extra?: (p: Vector3) => number,
): Map<Region, RegionTruth> {
  const out = new Map<Region, RegionTruth>();
  const mesh = g.mesh;
  mesh.updateMatrixWorld(true);
  _m.multiplyMatrices(toWeapon, mesh.matrixWorld);
  const N = mesh.geometry.attributes.normal;
  for (const [r, list] of g.pads) {
    const t: RegionTruth = { d: maxD, n: new Vector3(), pad: new Vector3(), at: new Vector3(), near: false };
    for (const i of list) {
      mesh.getVertexPosition(i, _v);
      // Skinned normal: skin a point 1 mm along the bind normal.
      _vn.fromBufferAttribute(N, i);
      const p0 = _v.clone().applyMatrix4(_m);
      _b.fromBufferAttribute(mesh.geometry.attributes.position, i).addScaledVector(_vn, 0.001);
      // getVertexPosition only takes an index: skin the offset point by hand (same bone transform).
      const off = skinPoint(mesh, i, _b).applyMatrix4(_m).sub(p0).normalize();
      let found = closest(f, p0, maxD, _hit);
      if (extra) {
        const e = extra(p0);
        if (e < (found ? _hit.d : maxD)) {
          // The other hand (analytic proxies): no face of the gun.
          _hit.d = e;
          _hit.n.set(0, 0, 0);
          found = true;
        }
      }
      if (!found) continue;
      if (_hit.d < t.d) {
        t.d = _hit.d;
        t.n.copy(_hit.n);
        t.pad.copy(off);
        t.at.copy(p0);
        t.near = true;
      }
    }
    out.set(r, t);
  }
  return out;
}

const _sk = new Vector3();
const _sb = new Matrix4();
/** Linear-blend skin a bind-space point with vertex `i`'s weights (mesh local). */
function skinPoint(mesh: SkinnedMesh, i: number, p: Vector3): Vector3 {
  const g = mesh.geometry;
  const SI = g.attributes.skinIndex,
    SW = g.attributes.skinWeight;
  const out = new Vector3();
  const base = _sk.copy(p).applyMatrix4(mesh.bindMatrix);
  for (let k = 0; k < 4; k++) {
    const wk = SW.getComponent(i, k);
    if (wk === 0) continue;
    const bi = SI.getComponent(i, k);
    _sb.multiplyMatrices(mesh.skeleton.bones[bi].matrixWorld, mesh.skeleton.boneInverses[bi]);
    out.addScaledVector(_c.copy(base).applyMatrix4(_sb), wk);
  }
  return out.applyMatrix4(mesh.bindMatrixInverse);
}
