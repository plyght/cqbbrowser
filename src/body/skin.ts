import {
  Bone,
  BoxGeometry,
  BufferGeometry,
  Color,
  CylinderGeometry,
  Euler,
  Float32BufferAttribute,
  Matrix4,
  MeshStandardMaterial,
  Skeleton,
  SkinnedMesh,
  SphereGeometry,
  Uint16BufferAttribute,
  Vector3,
} from 'three';

/**
 * Rigid-skinned procedural meshes: every primitive is authored in its bone's local frame and bound to that
 * bone with weight 1. One SkinnedMesh + vertex colours = one draw call for a whole limb or the whole body.
 * Bones are not in the scene graph; callers write `bone.matrixWorld` directly each frame.
 */
export type PaintFn = (p: Vector3, n: Vector3) => Color;
export type Paint = Color | PaintFn;

const _p = new Vector3();
const _n = new Vector3();

export class SkinBuilder {
  private pos: number[] = [];
  private nor: number[] = [];
  private col: number[] = [];
  private idx: number[] = [];
  private bone: number[] = [];
  private count = 0;

  add(geo: BufferGeometry, bone: number, paint: Paint, m?: Matrix4): this {
    if (m) geo.applyMatrix4(m);
    const p = geo.getAttribute('position');
    const n = geo.getAttribute('normal');
    const base = this.count;
    for (let i = 0; i < p.count; i++) {
      _p.fromBufferAttribute(p, i);
      _n.fromBufferAttribute(n, i);
      this.pos.push(_p.x, _p.y, _p.z);
      this.nor.push(_n.x, _n.y, _n.z);
      const c = typeof paint === 'function' ? paint(_p, _n) : paint;
      this.col.push(c.r, c.g, c.b);
      this.bone.push(bone);
    }
    const index = geo.getIndex();
    if (index) for (let i = 0; i < index.count; i++) this.idx.push(base + index.getX(i));
    else for (let i = 0; i < p.count; i++) this.idx.push(base + i);
    this.count += p.count;
    geo.dispose();
    return this;
  }

  build(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new Float32BufferAttribute(this.col, 3));
    const si: number[] = [];
    const sw: number[] = [];
    for (const b of this.bone) {
      si.push(b, 0, 0, 0);
      sw.push(1, 0, 0, 0);
    }
    g.setAttribute('skinIndex', new Uint16BufferAttribute(si, 4));
    g.setAttribute('skinWeight', new Float32BufferAttribute(sw, 4));
    g.setIndex(this.idx);
    return g;
  }
}

/** Skinned mesh with `n` free bones (identity bind pose). */
export function makeSkinned(
  geo: BufferGeometry,
  n: number,
  roughness = 0.85,
): { mesh: SkinnedMesh; bones: Bone[] } {
  const bones = Array.from({ length: n }, () => new Bone());
  const skeleton = new Skeleton(bones);
  const mat = new MeshStandardMaterial({ vertexColors: true, roughness, metalness: 0.02 });
  const mesh = new SkinnedMesh(geo, mat);
  mesh.bind(skeleton, new Matrix4());
  mesh.frustumCulled = false;
  mesh.matrixAutoUpdate = false;
  return { mesh, bones };
}

// --- Primitive helpers (segments run from the bone origin along -z) ---

const _m = new Matrix4();

export function box(
  w: number,
  h: number,
  d: number,
  x = 0,
  y = 0,
  z = 0,
  rx = 0,
  ry = 0,
  rz = 0,
): BufferGeometry {
  const g = new BoxGeometry(w, h, d);
  if (rx || ry || rz) g.applyMatrix4(_m.makeRotationFromEuler(_e.set(rx, ry, rz)));
  g.translate(x, y, z);
  return g;
}

/** Tapered tube from z=z0 to z=z1 (r0 at z0, r1 at z1). Optional y-scale for flattened limbs. */
export function tube(
  r0: number,
  r1: number,
  z0: number,
  z1: number,
  seg = 12,
  rings = 3,
  sy = 1,
): BufferGeometry {
  // CylinderGeometry top (+y) → after rotateX(-π/2) faces -z.
  const g = new CylinderGeometry(r1, r0, Math.abs(z1 - z0), seg, rings, false);
  g.rotateX(-Math.PI / 2);
  if (z1 > z0) g.rotateY(Math.PI);
  g.scale(1, sy, 1);
  g.translate(0, 0, (z0 + z1) / 2);
  return g;
}

export function ball(r: number, x = 0, y = 0, z = 0, seg = 10, sy = 1): BufferGeometry {
  const g = new SphereGeometry(r, seg, Math.max(4, seg >> 1));
  g.scale(1, sy, 1);
  g.translate(x, y, z);
  return g;
}

const _e = new Euler();

// --- Paint ---

function hash3(x: number, y: number, z: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return s - Math.floor(s);
}

function vnoise(x: number, y: number, z: number): number {
  const xi = Math.floor(x),
    yi = Math.floor(y),
    zi = Math.floor(z);
  const xf = x - xi,
    yf = y - yi,
    zf = z - zi;
  const u = xf * xf * (3 - 2 * xf),
    v = yf * yf * (3 - 2 * yf),
    w = zf * zf * (3 - 2 * zf);
  let r = 0;
  for (let dz = 0; dz < 2; dz++)
    for (let dy = 0; dy < 2; dy++)
      for (let dx = 0; dx < 2; dx++)
        r += hash3(xi + dx, yi + dy, zi + dz) * (dx ? u : 1 - u) * (dy ? v : 1 - v) * (dz ? w : 1 - w);
  return r;
}

/** Multicam-like blotches by position; `seed` decorrelates parts. */
export function camo(palette: number[], scale = 22, seed = 0): PaintFn {
  const cols = palette.map((c) => new Color(c));
  const out = new Color();
  return (p) => {
    const n1 = vnoise(p.x * scale + seed, p.y * scale, p.z * scale);
    const n2 = vnoise(p.x * scale * 2.3 + 17 + seed, p.y * scale * 2.3, p.z * scale * 2.3);
    const n = n1 * 0.7 + n2 * 0.3;
    const i = n < 0.38 ? 0 : n < 0.52 ? 1 : n < 0.64 ? 2 : 3;
    return out.copy(cols[Math.min(i, cols.length - 1)]);
  };
}

/** Flat colour with slight per-vertex variation (fabric/rubber read better than flat fills). */
export function cloth(hex: number, vary = 0.06, seed = 0): PaintFn {
  const base = new Color(hex);
  const out = new Color();
  return (p) => {
    const k = 1 + (vnoise(p.x * 40 + seed, p.y * 40, p.z * 40) - 0.5) * 2 * vary;
    return out.setRGB(base.r * k, base.g * k, base.b * k);
  };
}

export const C = (hex: number) => new Color(hex);
