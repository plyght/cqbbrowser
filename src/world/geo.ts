import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  Euler,
  Matrix4,
  Mesh,
  PlaneGeometry,
  Quaternion,
  Vector3,
  type Material,
  type Object3D,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { ColliderTag, Physics } from '../physics/Physics';
import { RAPIER } from '../physics/Physics';

/** Box with UVs in metres on every face (so tiling textures keep a constant texel density). */
export function boxGeo(w: number, h: number, d: number): BufferGeometry {
  const g = new BoxGeometry(w, h, d);
  const uv = g.getAttribute('uv') as BufferAttribute;
  // Face order: +x, -x, +y, -y, +z, -z; 4 verts each.
  const dims: [number, number][] = [
    [d, h],
    [d, h],
    [w, d],
    [w, d],
    [w, h],
    [w, h],
  ];
  for (let f = 0; f < 6; f++) {
    for (let i = 0; i < 4; i++) {
      const k = f * 4 + i;
      uv.setXY(k, uv.getX(k) * dims[f][0], uv.getY(k) * dims[f][1]);
    }
  }
  return g;
}

/** Paint a flat colour into a geometry (for vertex-coloured shared materials). */
export function tint(g: BufferGeometry, color: number): BufferGeometry {
  const c = new Color(color);
  const n = g.getAttribute('position').count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) c.toArray(a, i * 3);
  g.setAttribute('color', new BufferAttribute(a, 3));
  return g;
}

/** Merge geometries that may be indexed or not, keeping position/normal/uv (+color if all have it). */
export function mergeAny(geos: BufferGeometry[]): BufferGeometry {
  const keepColor = geos.every((g) => g.getAttribute('color'));
  const prepared = geos.map((g) => {
    const n = g.index ? g.toNonIndexed() : g;
    for (const name of Object.keys(n.attributes)) {
      if (name !== 'position' && name !== 'normal' && name !== 'uv' && !(keepColor && name === 'color')) {
        n.deleteAttribute(name);
      }
    }
    if (!n.getAttribute('uv'))
      n.setAttribute('uv', new BufferAttribute(new Float32Array(n.attributes.position.count * 2), 2));
    n.clearGroups();
    return n;
  });
  return mergeGeometries(prepared, false)!;
}

export interface BatchOpts {
  cast?: boolean;
  receive?: boolean;
}

const tmpM = new Matrix4();
const tmpQ = new Quaternion();
const tmpE = new Euler();
const tmpS = new Vector3(1, 1, 1);

/**
 * Collects static geometry and merges it per material (+shadow flags) so a whole facility costs a
 * handful of draw calls. Optional static cuboid colliders are created alongside.
 */
export class StaticBatch {
  private parts = new Map<string, { mat: Material; opts: BatchOpts; geos: BufferGeometry[] }>();

  constructor(private physics?: Physics) {}

  add(geo: BufferGeometry, mat: Material, matrix?: Matrix4, opts: BatchOpts = {}) {
    const key = `${mat.uuid}|${opts.cast ? 1 : 0}|${opts.receive === false ? 0 : 1}`;
    let p = this.parts.get(key);
    if (!p) this.parts.set(key, (p = { mat, opts, geos: [] }));
    const g = geo.clone();
    if (matrix) g.applyMatrix4(matrix);
    p.geos.push(g);
    geo.dispose();
  }

  /**
   * Box by centre position (y = bottom), size and yaw. With `tag`, a matching static collider is added.
   * Returns the collider (if any).
   */
  box(
    mat: Material,
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
    opts: BatchOpts & { tag?: ColliderTag; yaw?: number; pitch?: number; roll?: number } = {},
  ) {
    tmpE.set(opts.pitch ?? 0, opts.yaw ?? 0, opts.roll ?? 0, 'YXZ');
    tmpQ.setFromEuler(tmpE);
    tmpM.compose(new Vector3(x, y + h / 2, z), tmpQ, tmpS);
    this.add(boxGeo(w, h, d), mat, tmpM, opts);
    if (opts.tag && this.physics) {
      const desc = RAPIER.ColliderDesc.cuboid(w / 2, h / 2, d / 2)
        .setTranslation(x, y + h / 2, z)
        .setRotation({ x: tmpQ.x, y: tmpQ.y, z: tmpQ.z, w: tmpQ.w });
      return this.physics.tag(this.physics.world.createCollider(desc), opts.tag);
    }
    return undefined;
  }

  build(parent: Object3D): Mesh[] {
    const out: Mesh[] = [];
    for (const p of this.parts.values()) {
      const mesh = new Mesh(mergeAny(p.geos), p.mat);
      for (const g of p.geos) g.dispose();
      mesh.castShadow = !!p.opts.cast;
      mesh.receiveShadow = p.opts.receive !== false;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      parent.add(mesh);
      out.push(mesh);
    }
    this.parts.clear();
    return out;
  }
}

/** Static trimesh collider from a (world-space) geometry. */
export function trimeshCollider(physics: Physics, geo: BufferGeometry, tag: ColliderTag) {
  const pos = geo.getAttribute('position') as BufferAttribute;
  const verts = new Float32Array(pos.array as ArrayLike<number>);
  let idx: Uint32Array;
  if (geo.index) idx = new Uint32Array(geo.index.array as ArrayLike<number>);
  else idx = Uint32Array.from({ length: pos.count }, (_, i) => i);
  return physics.tag(physics.world.createCollider(RAPIER.ColliderDesc.trimesh(verts, idx)), tag);
}

/** Small deterministic hash noise for organic shapes (berms). */
export function hashNoise(x: number, y: number, seed = 0) {
  const s = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453;
  return s - Math.floor(s);
}

function smoothNoise(x: number, y: number, seed: number) {
  const xi = Math.floor(x),
    yi = Math.floor(y);
  const xf = x - xi,
    yf = y - yi;
  const u = xf * xf * (3 - 2 * xf),
    v = yf * yf * (3 - 2 * yf);
  const a = hashNoise(xi, yi, seed),
    b = hashNoise(xi + 1, yi, seed),
    c = hashNoise(xi, yi + 1, seed),
    d = hashNoise(xi + 1, yi + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/**
 * Earth berm as a heightfield over a length x width footprint (local x = length, z = width), with a
 * trapezoid cross-section, sloped ends and lumpy noise. UVs in metres. Returns indexed geometry.
 */
export function bermGeometry(length: number, width: number, height: number, top: number, seed = 1) {
  const nx = Math.max(8, Math.round(length / 1.5));
  const nz = 14;
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const slopeW = (width - top) / 2;
  for (let i = 0; i <= nx; i++) {
    const x = -length / 2 + (i / nx) * length;
    for (let j = 0; j <= nz; j++) {
      const z = -width / 2 + (j / nz) * width;
      const dz = Math.abs(z);
      let k = dz <= top / 2 ? 1 : 1 - (dz - top / 2) / slopeW;
      k = Math.max(0, k);
      k = k * k * (3 - 2 * k);
      const ex = Math.min(1, (length / 2 - Math.abs(x)) / Math.max(1, slopeW));
      const e = Math.max(0, ex);
      const n =
        (smoothNoise(x * 0.35, z * 0.35, seed) - 0.5) * 0.9 +
        (smoothNoise(x * 1.3, z * 1.3, seed + 3) - 0.5) * 0.25;
      const edge = j === 0 || j === nz || i === 0 || i === nx;
      const y = edge
        ? -0.05
        : Math.max(0, height * k * (e * e * (3 - 2 * e)) + n * Math.min(1, k * 3) * (height / 5));
      pos.push(x, y, z);
      uv.push(x, z + y);
    }
  }
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < nz; j++) {
      const a = i * (nz + 1) + j,
        b = a + nz + 1;
      idx.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Plane lying on the ground (y up), UVs in metres. */
export function groundGeo(w: number, d: number, segments = 1): BufferGeometry {
  const g = new PlaneGeometry(w, d, segments, segments);
  g.rotateX(-Math.PI / 2);
  const uv = g.getAttribute('uv') as BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w, uv.getY(i) * d);
  return g;
}
