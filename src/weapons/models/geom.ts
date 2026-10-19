import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CylinderGeometry,
  Euler,
  ExtrudeGeometry,
  LatheGeometry,
  Matrix4,
  Mesh,
  Path,
  Quaternion,
  Shape,
  Vector2,
  Vector3,
  type Material,
} from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ALIASES, UV_SCALE } from './materials';

/**
 * Parametric part helpers. All take model-frame coordinates: -z forward (muzzle), y up, x right,
 * origin at the grip, metres. Everything is merged per material by `Collector`.
 */
export type P2 = [number, number];

// ------------------------------------------------------------------ shapes

export function shape(pts: P2[], holes: P2[][] = []): Shape {
  const s = new Shape(pts.map(([x, y]) => new Vector2(x, y)));
  for (const h of holes) s.holes.push(new Path(h.map(([x, y]) => new Vector2(x, y))));
  return s;
}

/** Rounded-end slot (M-LOK style) as a hole path, centred at (cx, cy), along x. */
export function slotPath(cx: number, cy: number, len: number, w: number): Path {
  const r = w / 2;
  const p = new Path();
  p.moveTo(cx - len / 2 + r, cy - r);
  p.lineTo(cx + len / 2 - r, cy - r);
  p.absarc(cx + len / 2 - r, cy, r, -Math.PI / 2, Math.PI / 2, false);
  p.lineTo(cx - len / 2 + r, cy + r);
  p.absarc(cx - len / 2 + r, cy, r, Math.PI / 2, (3 * Math.PI) / 2, false);
  return p;
}

export function circlePath(cx: number, cy: number, r: number, cw = false): Path {
  const p = new Path();
  p.absarc(cx, cy, r, 0, Math.PI * 2, cw);
  return p;
}

/** Rounded rectangle centred on (cx, cy). */
export function roundRect(cx: number, cy: number, w: number, h: number, r: number): P2[] {
  const out: P2[] = [];
  const seg = 3;
  const corners: [number, number, number][] = [
    [cx + w / 2 - r, cy + h / 2 - r, 0],
    [cx - w / 2 + r, cy + h / 2 - r, Math.PI / 2],
    [cx - w / 2 + r, cy - h / 2 + r, Math.PI],
    [cx + w / 2 - r, cy - h / 2 + r, (3 * Math.PI) / 2],
  ];
  for (const [x, y, a0] of corners)
    for (let i = 0; i <= seg; i++) {
      const a = a0 + (i / seg) * (Math.PI / 2);
      out.push([x + Math.cos(a) * r, y + Math.sin(a) * r]);
    }
  return out;
}

// ------------------------------------------------------------------ geometry builders

const rotSide = new Matrix4().makeRotationY(-Math.PI / 2);

/**
 * Side-profile extrusion: `s` is drawn in the (z, y) plane (shape x = model z) and extruded across x,
 * centred on `x`, with a bevel for edge highlights.
 */
export function profile(s: Shape, width: number, bevel = 0.001, x = 0, curveSegments = 5): BufferGeometry {
  const b = Math.min(bevel, width * 0.3);
  const g = new ExtrudeGeometry(s, {
    depth: Math.max(0.0002, width - 2 * b),
    bevelEnabled: b > 0,
    bevelThickness: b,
    bevelSize: b,
    bevelSegments: b > 0.0015 ? 2 : 1,
    curveSegments,
  });
  g.translate(0, 0, -(width - 2 * b) / 2);
  g.applyMatrix4(rotSide);
  if (x) g.translate(x, 0, 0);
  return g;
}

/** Cross-section extrusion: `s` drawn in the (x, y) plane, extruded along z from z0 (rear) to z1 (front). */
export function sweep(s: Shape, z0: number, z1: number, bevel = 0, curveSegments = 5): BufferGeometry {
  const len = Math.abs(z0 - z1);
  const b = Math.min(bevel, len * 0.3);
  const g = new ExtrudeGeometry(s, {
    depth: Math.max(0.0002, len - 2 * b),
    bevelEnabled: b > 0,
    bevelThickness: b,
    bevelSize: b,
    bevelSegments: 1,
    curveSegments,
  });
  g.translate(0, 0, Math.min(z0, z1) + b);
  return g;
}

/** Lathe around the bore-parallel axis: profile points are [radius, z] from rear to front. */
export function lathe(pts: P2[], segments = 20, y = 0, x = 0, phiStart = 0, phiLength = Math.PI * 2) {
  // Orient so the outer surface faces outward regardless of the order the profile was written in.
  let area = 0;
  for (let i = 1; i < pts.length; i++)
    area += ((pts[i][0] + pts[i - 1][0]) / 2) * -(pts[i][1] - pts[i - 1][1]);
  if (area < 0) pts = [...pts].reverse();
  const g = new LatheGeometry(
    pts.map(([r, z]) => new Vector2(Math.max(r, 0), -z)),
    segments,
    phiStart,
    phiLength,
  );
  g.rotateX(-Math.PI / 2);
  g.translate(x, y, 0);
  return g;
}

/** Closed cylinder along z between z0 and z1. */
export function cylZ(r: number, z0: number, z1: number, y = 0, x = 0, segments = 16): BufferGeometry {
  const g = new CylinderGeometry(r, r, Math.abs(z0 - z1), segments, 1);
  g.rotateX(Math.PI / 2);
  g.translate(x, y, (z0 + z1) / 2);
  return g;
}

export function cyl(r: number, h: number, segments = 12): BufferGeometry {
  return new CylinderGeometry(r, r, h, segments, 1);
}

/** Beveled box centred on (x, y, z). */
export function rbox(
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
  r = 0.0012,
): BufferGeometry {
  const rr = Math.min(r, w / 2.2, h / 2.2, d / 2.2);
  const g = rr > 0.0002 ? new RoundedBoxGeometry(w, h, d, 1, rr) : new BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return g;
}

/** Box spanning z0..z1 (rear..front) with x/y centre. */
export function boxZ(w: number, h: number, z0: number, z1: number, x: number, y: number, r = 0.0012) {
  return rbox(w, h, Math.abs(z0 - z1), x, y, (z0 + z1) / 2, r);
}

export function xform(
  g: BufferGeometry,
  opts: { pos?: P3; rot?: P3; scale?: P3; order?: 'XYZ' | 'YXZ' | 'ZXY' },
) {
  const m = new Matrix4();
  const q = new Quaternion();
  if (opts.rot) q.setFromEuler(new Euler(opts.rot[0], opts.rot[1], opts.rot[2], opts.order ?? 'XYZ'));
  m.compose(new Vector3(...(opts.pos ?? [0, 0, 0])), q, new Vector3(...(opts.scale ?? [1, 1, 1])));
  g.applyMatrix4(m);
  return g;
}
export type P3 = [number, number, number];

// ------------------------------------------------------------------ picatinny / M-LOK

const PIC_W = 0.0212;

/** Picatinny cross-section (top at y=0, centred on x=0), height h. */
function picSection(h: number, w = PIC_W): Shape {
  const t = w / 2;
  return shape([
    [-t + 0.0015, -h],
    [t - 0.0015, -h],
    [t - 0.0015, -h + 0.002],
    [t, -h + 0.0035],
    [t, -0.0015],
    [t - 0.0015, 0],
    [-t + 0.0015, 0],
    [-t, -0.0015],
    [-t, -h + 0.0035],
    [-t + 0.0015, -h + 0.002],
  ]);
}

/**
 * Picatinny rail along z (z0 rear → z1 front) with its top at y = 0 in a local frame, then transformed
 * by `m` (identity = top rail at y=0 on the bore centreline). Teeth are merged, not instanced meshes.
 */
export function picatinny(
  z0: number,
  z1: number,
  m: Matrix4,
  opts: { h?: number; w?: number } = {},
): BufferGeometry {
  const h = opts.h ?? 0.0094;
  const w = opts.w ?? PIC_W;
  const parts: BufferGeometry[] = [];
  const base = sweep(picSection(h * 0.62, w * 0.82), z0, z1, 0, 1);
  base.translate(0, -h * 0.38, 0);
  parts.push(base);
  const pitch = 0.01;
  const tooth = 0.0052;
  const n = Math.floor((z0 - z1 - 0.002) / pitch);
  const start = z0 - (z0 - z1 - n * pitch) / 2;
  const t0 = sweep(picSection(h * 0.45, w), 0, -tooth, 0.0004, 1);
  for (let i = 0; i < n; i++) {
    const g = t0.clone();
    g.translate(0, 0, start - i * pitch - (pitch - tooth) / 2);
    parts.push(g);
  }
  const out = merge(parts);
  out.applyMatrix4(m);
  return out;
}

/** Matrix placing a local rail (top at y=0) at angle `a` (0 = top, +π/2 = right) around the bore at radius r. */
export function railMatrix(a: number, r: number, boreY: number): Matrix4 {
  const m = new Matrix4().makeRotationZ(-a);
  m.setPosition(Math.sin(a) * r, boreY + Math.cos(a) * r, 0);
  return m;
}

/**
 * Flat plate with M-LOK slots, lying along z (z0 → z1), across `w`, thickness t; outward normal at angle `a`
 * around the bore (0 = up, π/2 = right), outer face at radius r.
 */
export function mlokPlate(
  z0: number,
  z1: number,
  w: number,
  t: number,
  a: number,
  r: number,
  boreY: number,
  slots: boolean,
  slotStart = 0.02,
): BufferGeometry {
  const len = z0 - z1;
  const s = shape([
    [0, -w / 2],
    [len, -w / 2],
    [len, w / 2],
    [0, w / 2],
  ]);
  if (slots && w > 0.0105) {
    const pitch = 0.04;
    for (let c = slotStart + 0.016; c + 0.016 < len - 0.008; c += pitch)
      s.holes.push(slotPath(c, 0, 0.032, 0.0076));
  }
  const g = new ExtrudeGeometry(s, {
    depth: t,
    bevelEnabled: true,
    bevelThickness: 0.0004,
    bevelSize: 0.0004,
    bevelSegments: 1,
    curveSegments: 3,
  });
  // Local: x along length (→ -z), y across, z = thickness (inward → outward).
  const xAxis = new Vector3(0, 0, -1);
  const n = new Vector3(Math.sin(a), Math.cos(a), 0);
  const zAxis = n.clone();
  const yAxis = new Vector3().crossVectors(zAxis, xAxis);
  const m = new Matrix4().makeBasis(xAxis, yAxis, zAxis);
  m.setPosition(n.x * (r - t), boreY + n.y * (r - t), z0);
  g.applyMatrix4(m);
  return g;
}

// ------------------------------------------------------------------ merging

function prep(g: BufferGeometry): BufferGeometry {
  let out = g.index ? g.toNonIndexed() : g;
  if (out === g) out = g.clone();
  for (const name of Object.keys(out.attributes))
    if (name !== 'position' && name !== 'normal') out.deleteAttribute(name);
  if (!out.attributes.normal) out.computeVertexNormals();
  const tint = (g.userData.tint as [number, number, number] | undefined) ?? [1, 1, 1];
  const n = out.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) col.set(tint, i * 3);
  out.setAttribute('color', new BufferAttribute(col, 3));
  return out;
}

/** Box-projected UVs in metres × UV_SCALE so detail textures have constant density. */
function boxUV(g: BufferGeometry) {
  const p = g.attributes.position as BufferAttribute;
  const n = g.attributes.normal as BufferAttribute;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)),
      ay = Math.abs(n.getY(i)),
      az = Math.abs(n.getZ(i));
    let u, v;
    if (ax >= ay && ax >= az) [u, v] = [p.getZ(i), p.getY(i)];
    else if (ay >= az) [u, v] = [p.getX(i), p.getZ(i)];
    else [u, v] = [p.getX(i), p.getY(i)];
    uv[i * 2] = u * UV_SCALE;
    uv[i * 2 + 1] = v * UV_SCALE;
  }
  g.setAttribute('uv', new BufferAttribute(uv, 2));
}

export function merge(gs: BufferGeometry[]): BufferGeometry {
  const prepped = gs.map(prep);
  const m = mergeGeometries(prepped, false);
  if (!m) throw new Error('merge failed');
  for (const g of prepped) g.dispose();
  return m;
}

/** Collects geometry per material; `meshes()` merges each bucket into one draw call. */
export class Collector {
  private buckets = new Map<Material, BufferGeometry[]>();

  add(g: BufferGeometry, m: Material, matrix?: Matrix4): this {
    if (matrix) g.applyMatrix4(matrix);
    const alias = ALIASES.get(m);
    if (alias) {
      g.userData.tint = alias.tint;
      m = alias.to;
    }
    let b = this.buckets.get(m);
    if (!b) this.buckets.set(m, (b = []));
    b.push(g);
    return this;
  }

  /** Move everything into another collector (e.g. fold a sub-assembly into the static mesh). */
  drain(into: Collector, matrix?: Matrix4) {
    for (const [m, gs] of this.buckets) for (const g of gs) into.add(g, m, matrix);
    this.buckets.clear();
  }

  get empty() {
    return this.buckets.size === 0;
  }

  /** Merged meshes, translated so `pivot` becomes the local origin. */
  meshes(pivot?: Vector3): Mesh[] {
    const out: Mesh[] = [];
    for (const [m, gs] of this.buckets) {
      const g = merge(gs);
      for (const x of gs) x.dispose();
      if (pivot) g.translate(-pivot.x, -pivot.y, -pivot.z);
      boxUVAfterPivot(g, pivot);
      g.computeBoundingSphere();
      const mesh = new Mesh(g, m);
      mesh.frustumCulled = true;
      out.push(mesh);
    }
    this.buckets.clear();
    return out;
  }
}

function boxUVAfterPivot(g: BufferGeometry, pivot?: Vector3) {
  // UVs from model-frame positions so moving parts keep the same texture placement as before pivoting.
  if (pivot) g.translate(pivot.x, pivot.y, pivot.z);
  boxUV(g);
  if (pivot) g.translate(-pivot.x, -pivot.y, -pivot.z);
}

export function triangles(g: BufferGeometry) {
  return (g.index ? g.index.count : g.attributes.position.count) / 3;
}
