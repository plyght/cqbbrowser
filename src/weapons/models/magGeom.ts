import { Matrix4, Vector3, type BufferGeometry, type Mesh, type Object3D } from 'three';
import type { WeaponModel } from './index';

/**
 * Magazine shape measured from the mag part's own triangles (kit GLB or procedural fallback alike), in the mag's
 * frame (= weapon frame at rest: metres, -z forward, origin at the grip). Used by the round stack (`magRounds.ts`)
 * and the mag-check path (`ArmsRig`): rear-wall curve, width, feed-lip height, the out-of-well axis and how far
 * the mag has to travel along it to clear the well with a visible gap.
 */

export interface MagSlice {
  /** Slice height (mag frame). */
  y: number;
  x0: number;
  x1: number;
  /** Front (min z) and rear (max z) of the cross-section. */
  z0: number;
  z1: number;
}

export interface MagInfo {
  /** Horizontal cross-sections, top → bottom, every `STEP` m. */
  slices: MagSlice[];
  /** Feed-lip height (top of the mag) and the floor plate. */
  top: number;
  bottom: number;
  /** Bounds centre (mag frame): what the mag check presents to the camera. */
  centre: Vector3;
  /** Unit direction the mag leaves the well along (points down, mag frame). */
  axis: Vector3;
  /** Distance along `axis` from seated to clear of the well plus a gap (m). */
  travel: number;
  /** Front lug at the top (AK rock-out pivot), mag frame. */
  lug: Vector3;
  /** Mag length (m). */
  length: number;
}

const STEP = 0.003;
/** Clear gap between the mag top and the well once it is out (m). */
export const MAG_GAP = 0.04;

const _a = new Vector3();
const _b = new Vector3();
const _c = new Vector3();

/** Meshes under `root` (the rounds stack excluded), with their matrix relative to `root`. */
function meshesUnder(root: Object3D, skip?: (o: Object3D) => boolean): { geo: BufferGeometry; m: Matrix4 }[] {
  root.updateMatrixWorld(true);
  const inv = new Matrix4().copy(root.matrixWorld).invert();
  const out: { geo: BufferGeometry; m: Matrix4 }[] = [];
  const walk = (o: Object3D) => {
    if (o.name === 'magRounds' || o.name === 'spareMag' || skip?.(o)) return;
    const mesh = o as Mesh;
    if (mesh.isMesh && !(mesh as { isInstancedMesh?: boolean }).isInstancedMesh)
      out.push({ geo: mesh.geometry, m: new Matrix4().multiplyMatrices(inv, mesh.matrixWorld) });
    for (const c of o.children) walk(c);
  };
  walk(root);
  return out;
}

function forTriangles(
  list: { geo: BufferGeometry; m: Matrix4 }[],
  fn: (a: Vector3, b: Vector3, c: Vector3) => void,
) {
  for (const { geo, m } of list) {
    const pos = geo.getAttribute('position');
    if (!pos) continue;
    const idx = geo.index;
    const n = idx ? idx.count : pos.count;
    for (let i = 0; i + 2 < n; i += 3) {
      const ia = idx ? idx.getX(i) : i;
      const ib = idx ? idx.getX(i + 1) : i + 1;
      const ic = idx ? idx.getX(i + 2) : i + 2;
      _a.fromBufferAttribute(pos, ia).applyMatrix4(m);
      _b.fromBufferAttribute(pos, ib).applyMatrix4(m);
      _c.fromBufferAttribute(pos, ic).applyMatrix4(m);
      fn(_a, _b, _c);
    }
  }
}

const cache = new WeakMap<Object3D, MagInfo>();

/** Measure the model's mag (cached per mag object). Null when the model has no mag geometry. */
export function magInfo(model: WeaponModel): MagInfo | null {
  const mag = model.parts.mag;
  if (!mag) return null;
  const hit = cache.get(mag);
  if (hit) return hit;
  // Mag frame = the mag group's local frame (its rest pivot is the model origin, so this is the weapon frame).
  const list = meshesUnder(mag);
  const lo = new Vector3(Infinity, Infinity, Infinity);
  const hi = new Vector3(-Infinity, -Infinity, -Infinity);
  forTriangles(list, (a, b, c) => {
    for (const v of [a, b, c]) {
      lo.min(v);
      hi.max(v);
    }
  });
  if (!isFinite(lo.x)) return null;
  const y0 = lo.y;
  const y1 = hi.y;
  const n = Math.max(2, Math.ceil((y1 - y0) / STEP));
  const S: MagSlice[] = [];
  for (let k = 0; k < n; k++)
    S.push({ y: y1 - 0.0005 - k * STEP, x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity });
  // Plane-triangle intersection per slice.
  const seg = (p: Vector3, q: Vector3, y: number, s: MagSlice) => {
    if ((p.y - y) * (q.y - y) > 0 || p.y === q.y) return;
    const t = (y - p.y) / (q.y - p.y);
    const x = p.x + (q.x - p.x) * t;
    const z = p.z + (q.z - p.z) * t;
    if (x < s.x0) s.x0 = x;
    if (x > s.x1) s.x1 = x;
    if (z < s.z0) s.z0 = z;
    if (z > s.z1) s.z1 = z;
  };
  forTriangles(list, (a, b, c) => {
    const ymin = Math.min(a.y, b.y, c.y);
    const ymax = Math.max(a.y, b.y, c.y);
    const k0 = Math.max(0, Math.floor((y1 - 0.0005 - ymax) / STEP));
    const k1 = Math.min(n - 1, Math.ceil((y1 - 0.0005 - ymin) / STEP));
    for (let k = k0; k <= k1; k++) {
      const s = S[k];
      seg(a, b, s.y, s);
      seg(b, c, s.y, s);
      seg(c, a, s.y, s);
    }
  });
  const slices = S.filter((s) => isFinite(s.x0));
  // Smooth the rear wall (feed-lip notches, floor-plate flares) with a 3-tap median.
  const med = (i: number, k: 'z0' | 'z1') => {
    const v = [slices[Math.max(0, i - 1)][k], slices[i][k], slices[Math.min(slices.length - 1, i + 1)][k]];
    return v.sort((p, q) => p - q)[1];
  };
  const z1s = slices.map((_, i) => med(i, 'z1'));
  const z0s = slices.map((_, i) => med(i, 'z0'));
  slices.forEach((s, i) => {
    s.z1 = z1s[i];
    s.z0 = z0s[i];
  });
  const top = y1;
  const bottom = y0;
  const length = top - bottom;
  // Out-of-well axis: the rear wall's direction over the upper third (the part that rides in the well).
  const i0 = Math.min(slices.length - 1, 1);
  const i1 = Math.min(slices.length - 1, Math.max(i0 + 1, Math.round(slices.length * 0.3)));
  const axis = new Vector3(0, slices[i1].y - slices[i0].y, slices[i1].z1 - slices[i0].z1).normalize();
  if (!(axis.y < -0.5)) axis.set(0, -1, 0);
  const topS = slices[0];
  const lug = new Vector3((topS.x0 + topS.x1) / 2, top, topS.z0);
  // How deep the mag sits in the gun: pistols carry the whole mag in the grip; long guns to the well's mouth
  // (the lowest static geometry over the mag's top footprint), else the magwell socket.
  // Static geometry is measured in the weapon frame: shift it into the mag frame (the mag hangs off the root).
  const rest = mag.parent === model.root ? mag.position.clone() : new Vector3();
  const m0 = new Matrix4().copy(model.root.matrixWorld).invert();
  let mouth = top - 0.06;
  if (model.sockets.magwell)
    mouth = model.sockets.magwell.getWorldPosition(new Vector3()).applyMatrix4(m0).sub(rest).y;
  const pistol = model.weapon === 'p17' || model.weapon === 'p92';
  let depth: number;
  if (pistol) depth = length;
  else {
    const partRoots = new Set(Object.values(model.parts).filter(Boolean) as Object3D[]);
    const isPart = (o: Object3D) => partRoots.has(o);
    let wellLow = Infinity;
    const xa = topS.x0 - 0.004,
      xb = topS.x1 + 0.004,
      za = topS.z0 - 0.002,
      zb = topS.z1 + 0.002;
    const stat = meshesUnder(model.root, isPart);
    for (const it of stat) it.m.premultiply(new Matrix4().makeTranslation(-rest.x, -rest.y, -rest.z));
    forTriangles(stat, (a, b, c) => {
      for (const v of [a, b, c])
        if (v.x > xa && v.x < xb && v.z > za && v.z < zb && v.y > bottom && v.y < top + 0.02 && v.y < wellLow)
          wellLow = v.y;
    });
    const low = isFinite(wellLow) ? Math.min(wellLow, mouth) : mouth;
    depth = Math.max(0.04, top - low);
  }
  const travel = depth / Math.max(0.5, -axis.y) + MAG_GAP;
  const centre = lo.clone().add(hi).multiplyScalar(0.5);
  const info: MagInfo = { slices, top, bottom, centre, axis, travel, lug, length };
  cache.set(mag, info);
  return info;
}

/** Rear wall (max z) and width at height `y` (linear between slices, clamped). */
export function sliceAt(
  info: MagInfo,
  y: number,
  out: MagSlice = { y, x0: 0, x1: 0, z0: 0, z1: 0 },
): MagSlice {
  const S = info.slices;
  if (y >= S[0].y) return Object.assign(out, S[0], { y });
  for (let i = 1; i < S.length; i++)
    if (y >= S[i].y) {
      const a = S[i - 1],
        b = S[i];
      const t = (a.y - y) / Math.max(1e-6, a.y - b.y);
      out.y = y;
      out.x0 = a.x0 + (b.x0 - a.x0) * t;
      out.x1 = a.x1 + (b.x1 - a.x1) * t;
      out.z0 = a.z0 + (b.z0 - a.z0) * t;
      out.z1 = a.z1 + (b.z1 - a.z1) * t;
      return out;
    }
  return Object.assign(out, S[S.length - 1], { y });
}
