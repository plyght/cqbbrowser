import { Matrix4, Quaternion, Vector3, type Mesh, type Object3D } from 'three';
import type { CollisionProxy, WeaponModel } from '../../weapons/models';
import type { PartName } from '../../weapons/models/core';
import { box, capsule, sdShape, type Shape } from '../grip/sdf';

/**
 * Hard-contact collision set of a weapon (weapon frame = model root: origin at the grip, -z muzzle).
 *
 * Source: `model.collision` when the model ships authored proxies (asset pipeline catalog), else
 * `fitCollision(model)` fits rounded boxes to the model's own vertices:
 *  - pistol grip in the grip frame (sliced along the grip axis: backstrap, beavertail, front strap taper);
 *  - the rest of the static mesh in 1 cm slabs along the bore, split into vertical runs (receiver, guard,
 *    magwell walls, handguard, handstop/foregrip, rails, stock…), merged along z where the profile repeats;
 *  - the magazine well is carved out as an opening (the seated mag's footprint), so a mag can enter along the
 *    well axis and a finger can't hide in a solid magwell;
 *  - every moving part (mag, slide, bolt, charging handle, trigger, …) in its own pivot frame, so the proxies
 *    follow the part live (the mag while it rides the support hand).
 *
 * Runtime: `update()` once per frame (part frames), then `sdf(p)` (union, branch-and-bound on per-shape AABBs,
 * allocation-free) / `gradient`. `hit` names the closest shape of the last query.
 */

export interface Group {
  name: string;
  part?: PartName;
  /** Live part object (undefined = static, weapon frame). */
  obj?: Object3D;
  shapes: Shape[];
  /** Shape-local AABBs in the group frame: [minx,miny,minz,maxx,maxy,maxz] per shape. */
  aabb: Float64Array;
  /** Weapon frame → group frame (identity for static). */
  toLocal: Matrix4;
  enabled: boolean;
  /** Broadphase candidates (shape indices) while a selection is active. */
  cand: Int32Array;
  nCand: number;
}

const _v = new Vector3();
const _q = new Vector3();
const _m = new Matrix4();
const _m2 = new Matrix4();
const _qt = new Quaternion();
const ONE = new Vector3(1, 1, 1);

// ------------------------------------------------------------------------------------------------ fitting

interface Pts {
  /** xyz triples in the target frame. */
  p: number[];
}

const _ta = new Vector3();
const _tb = new Vector3();
const _tc = new Vector3();
/**
 * Surface samples of the meshes directly owned by `obj` (not nested part groups), in a frame (`toFrame` ×
 * world): every vertex plus a barycentric grid on each triangle at ≤ `step` spacing (low-poly faces carry no
 * interior vertices).
 */
export function collect(
  obj: Object3D,
  toFrame: Matrix4,
  isPart: (o: Object3D) => boolean,
  out: Pts,
  step = 0.003,
) {
  const walk = (o: Object3D) => {
    const mesh = o as Mesh;
    if (mesh.isMesh) {
      const pa = mesh.geometry.attributes.position;
      const ix = mesh.geometry.index;
      _m.multiplyMatrices(toFrame, mesh.matrixWorld);
      const nt = ix ? ix.count / 3 : pa.count / 3;
      for (let t = 0; t < nt; t++) {
        const i0 = ix ? ix.getX(t * 3) : t * 3,
          i1 = ix ? ix.getX(t * 3 + 1) : t * 3 + 1,
          i2 = ix ? ix.getX(t * 3 + 2) : t * 3 + 2;
        _ta.fromBufferAttribute(pa, i0).applyMatrix4(_m);
        _tb.fromBufferAttribute(pa, i1).applyMatrix4(_m);
        _tc.fromBufferAttribute(pa, i2).applyMatrix4(_m);
        const L = Math.max(_ta.distanceTo(_tb), _tb.distanceTo(_tc), _tc.distanceTo(_ta));
        const n = Math.max(1, Math.ceil(L / step));
        for (let a = 0; a <= n; a++)
          for (let b = 0; b <= n - a; b++) {
            const u = a / n,
              v = b / n,
              w = 1 - u - v;
            out.p.push(
              _ta.x * w + _tb.x * u + _tc.x * v,
              _ta.y * w + _tb.y * u + _tc.y * v,
              _ta.z * w + _tb.z * u + _tc.z * v,
            );
          }
      }
    }
    for (const c of o.children) if (!isPart(c)) walk(c);
  };
  walk(obj);
}

interface BoxSpec {
  min: [number, number, number];
  max: [number, number, number];
  name: string;
}

/**
 * Slab decomposition: bins along `axis` (0 = x, 1 = y, 2 = z), each bin split into runs along `runAxis` where
 * vertices are more than `gap` apart; every run → its AABB. Consecutive bins with matching runs merge.
 */
function slabBoxes(pts: number[], axis: number, runAxis: number, bin: number, gap: number, name: string) {
  const n = pts.length / 3;
  if (!n) return [] as BoxSpec[];
  let lo = Infinity,
    hi = -Infinity;
  for (let i = 0; i < n; i++) {
    lo = Math.min(lo, pts[i * 3 + axis]);
    hi = Math.max(hi, pts[i * 3 + axis]);
  }
  const nb = Math.max(1, Math.ceil((hi - lo) / bin - 1e-9));
  const bins: number[][] = Array.from({ length: nb }, () => []);
  for (let i = 0; i < n; i++) bins[Math.min(nb - 1, Math.floor((pts[i * 3 + axis] - lo) / bin))].push(i);
  const out: BoxSpec[] = [];
  let prev: BoxSpec[] = [];
  for (let b = 0; b < nb; b++) {
    const idx = bins[b].sort((i, j) => pts[i * 3 + runAxis] - pts[j * 3 + runAxis]);
    const cur: BoxSpec[] = [];
    let run: number[] = [];
    const flush = () => {
      if (run.length < 3) return void (run = []);
      const mn: [number, number, number] = [Infinity, Infinity, Infinity];
      const mx: [number, number, number] = [-Infinity, -Infinity, -Infinity];
      for (const i of run)
        for (let k = 0; k < 3; k++) {
          mn[k] = Math.min(mn[k], pts[i * 3 + k]);
          mx[k] = Math.max(mx[k], pts[i * 3 + k]);
        }
      // Slab extent along the bin axis: the vertices' own range, never wider than the bin.
      cur.push({ min: mn, max: mx, name });
      run = [];
    };
    for (let k = 0; k < idx.length; k++) {
      if (run.length && pts[idx[k] * 3 + runAxis] - pts[run[run.length - 1] * 3 + runAxis] > gap) flush();
      run.push(idx[k]);
    }
    flush();
    // Merge with a matching run of the previous bin (same cross-section within 1.5 mm).
    const next: BoxSpec[] = [];
    for (const c of cur) {
      const m = prev.find(
        (p) =>
          [0, 1, 2].every(
            (k) =>
              k === axis ||
              (Math.abs(p.min[k] - c.min[k]) < 0.0015 && Math.abs(p.max[k] - c.max[k]) < 0.0015),
          ) && c.min[axis] - p.max[axis] < bin * 0.6,
      );
      if (m) {
        for (let k = 0; k < 3; k++) {
          m.min[k] = Math.min(m.min[k], c.min[k]);
          m.max[k] = Math.max(m.max[k], c.max[k]);
        }
        next.push(m);
      } else {
        out.push(c);
        next.push(c);
      }
    }
    prev = next;
  }
  return out;
}

/** Box minus an (axis-aligned, same frame) hole → up to 6 pieces thicker than `minT`. */
function carve(b: BoxSpec, h: BoxSpec, minT = 0.0015): BoxSpec[] {
  for (let k = 0; k < 3; k++) if (h.max[k] <= b.min[k] || h.min[k] >= b.max[k]) return [b];
  const out: BoxSpec[] = [];
  const cur = { min: [...b.min] as BoxSpec['min'], max: [...b.max] as BoxSpec['max'] };
  for (let k = 0; k < 3; k++) {
    if (h.min[k] > cur.min[k]) {
      const p = { min: [...cur.min] as BoxSpec['min'], max: [...cur.max] as BoxSpec['max'], name: b.name };
      p.max[k] = h.min[k];
      if (p.max[k] - p.min[k] >= minT) out.push(p);
      cur.min[k] = h.min[k];
    }
    if (h.max[k] < cur.max[k]) {
      const p = { min: [...cur.min] as BoxSpec['min'], max: [...cur.max] as BoxSpec['max'], name: b.name };
      p.min[k] = h.max[k];
      if (p.max[k] - p.min[k] >= minT) out.push(p);
      cur.max[k] = h.max[k];
    }
  }
  return out;
}

function toProxy(b: BoxSpec, frame: Matrix4 | null, part?: PartName): CollisionProxy {
  const c = new Vector3((b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2);
  const pad = 0.0004;
  const half: [number, number, number] = [
    (b.max[0] - b.min[0]) / 2 + pad,
    (b.max[1] - b.min[1]) / 2 + pad,
    (b.max[2] - b.min[2]) / 2 + pad,
  ];
  const r = Math.min(0.003, ...half) * 0.9;
  let quat: [number, number, number, number] | undefined;
  if (frame) {
    c.applyMatrix4(frame);
    _qt.setFromRotationMatrix(frame);
    quat = [_qt.x, _qt.y, _qt.z, _qt.w];
  }
  return { kind: 'box', name: b.name, part, center: [c.x, c.y, c.z], quat, half, r };
}

/** Fit rounded-box proxies to a model's meshes (weapon frame / part pivot frames). See the module doc. */
export function fitCollision(model: WeaponModel): CollisionProxy[] {
  const root = model.root;
  root.updateMatrixWorld(true);
  const inv = root.matrixWorld.clone().invert();
  const partObjs = new Map<Object3D, PartName>();
  for (const [k, o] of Object.entries(model.parts)) if (o) partObjs.set(o, k as PartName);
  const isPart = (o: Object3D) => partObjs.has(o) || o.name === 'spareMag';
  const pistol = model.weapon === 'p17' || !!model.parts.slide;
  const out: CollisionProxy[] = [];

  // Seated mag footprint (weapon frame): the well opening.
  const magPts: Pts = { p: [] };
  if (model.parts.mag) collect(model.parts.mag, inv, isPart, magPts);

  // Static mesh.
  const st: Pts = { p: [] };
  collect(root, inv, isPart, st);
  // Grip region in the grip frame (x, up the grip, back).
  const gr = model.sockets.gripRight;
  const angle = gr ? Math.abs(gr.rotation.x) : 0.33;
  const gc = gr
    ? new Vector3().setFromMatrixPosition(gr.matrixWorld).applyMatrix4(inv)
    : new Vector3(0, -0.06, 0.06);
  const up = new Vector3(0, Math.cos(angle), -Math.sin(angle));
  const back = new Vector3(0, Math.sin(angle), Math.cos(angle));
  const G = new Matrix4().makeBasis(new Vector3(1, 0, 0), up, back).setPosition(gc);
  const Ginv = G.clone().invert();
  const gripTopY = gc.y + (pistol ? 0.04 : 0.028);
  const gPts: number[] = [];
  const rest: number[] = [];
  for (let i = 0; i < st.p.length; i += 3) {
    _v.set(st.p[i], st.p[i + 1], st.p[i + 2]);
    const wy = _v.y;
    _q.copy(_v).applyMatrix4(Ginv);
    const inGrip = wy < gripTopY && Math.abs(_q.x) < 0.03 && _q.z > -0.032 && _q.z < 0.04 && _q.y > -0.12;
    (inGrip ? gPts : rest).push(st.p[i], st.p[i + 1], st.p[i + 2]);
  }
  // Mag holes per frame: footprint of the seated mag in that frame, sliced like the boxes it carves.
  const holeIn = (frame: Matrix4 | null, b: BoxSpec): BoxSpec | null => {
    const mn = [Infinity, Infinity, Infinity],
      mx = [-Infinity, -Infinity, -Infinity];
    let any = false;
    for (let i = 0; i < magPts.p.length; i += 3) {
      _v.set(magPts.p[i], magPts.p[i + 1], magPts.p[i + 2]);
      if (frame) _v.applyMatrix4(frame);
      // Mag vertices within this box's slab (bin axis = the box's thinnest range is not known; use z & y overlap).
      if (_v.z < b.min[2] - 0.001 || _v.z > b.max[2] + 0.001) continue;
      any = true;
      mn[0] = Math.min(mn[0], _v.x);
      mx[0] = Math.max(mx[0], _v.x);
      mn[1] = Math.min(mn[1], _v.y);
      mx[1] = Math.max(mx[1], _v.y);
      mn[2] = Math.min(mn[2], _v.z);
      mx[2] = Math.max(mx[2], _v.z);
    }
    if (!any) return null;
    const e = 0.0008;
    // The well is open downward (the mag comes in from below): the hole runs to the box bottom.
    return { min: [mn[0] - e, -Infinity, mn[2] - e], max: [mx[0] + e, mx[1] + e, mx[2] + e], name: 'well' };
  };
  const emit = (boxes: BoxSpec[], frame: Matrix4 | null, frameInv: Matrix4 | null) => {
    for (const b of boxes) {
      const h = pistol ? null : holeIn(frameInv, b);
      const pieces = h ? carve(b, h) : [b];
      for (const p of pieces) {
        if (pieces.length > 1 || (h && pieces[0] !== b)) p.name = 'magwell';
        out.push(toProxy(p, frame));
      }
    }
  };
  // Grip slices in the grip frame (along its axis, 1 cm).
  const gl: number[] = [];
  for (let i = 0; i < gPts.length; i += 3) {
    _v.set(gPts[i], gPts[i + 1], gPts[i + 2]).applyMatrix4(Ginv);
    gl.push(_v.x, _v.y, _v.z);
  }
  emit(slabBoxes(gl, 1, 2, 0.01, 0.006, 'grip'), G, Ginv);
  const hgz = model.sockets.gripLeft
    ? new Vector3().setFromMatrixPosition(model.sockets.gripLeft.matrixWorld).applyMatrix4(inv).z
    : -0.2;
  const boxes = slabBoxes(rest, 2, 1, 0.01, 0.005, 'receiver');
  const trig = model.parts.trigger
    ? new Vector3().setFromMatrixPosition(model.parts.trigger.matrixWorld).applyMatrix4(inv)
    : null;
  for (const b of boxes) {
    const cz = (b.min[2] + b.max[2]) / 2,
      cy = (b.min[1] + b.max[1]) / 2;
    if (pistol) b.name = cy > 0.012 ? 'frameTop' : 'frame';
    else if (cz < hgz + 0.12 && cz < -0.12 && cy < 0.07)
      b.name = cy < model.boreY - 0.035 ? 'foregrip' : 'handguard';
    else if (trig && cy < trig.y - 0.01 && Math.abs(cz - trig.z) < 0.05) b.name = 'guard';
    else if (cz > 0.1 && !pistol) b.name = 'stock';
  }
  emit(boxes, null, null);
  // Hands see the well as solid (no finger fits beside a mag in it): a plug over the opening, from the well
  // mouth (lowest carved wall) up, that the mag rule ignores.
  if (!pistol && magPts.p.length) {
    let mouth = Infinity;
    for (const p of out)
      if (p.name === 'magwell' && p.kind === 'box' && !p.part)
        mouth = Math.min(mouth, p.center[1] - p.half[1]);
    if (mouth < Infinity) {
      const mn = [Infinity, Infinity, Infinity],
        mx = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < magPts.p.length; i += 3) {
        if (magPts.p[i + 1] < mouth) continue;
        for (let k = 0; k < 3; k++) {
          mn[k] = Math.min(mn[k], magPts.p[i + k]);
          mx[k] = Math.max(mx[k], magPts.p[i + k]);
        }
      }
      if (mn[0] < Infinity)
        out.push(
          toProxy(
            { min: [mn[0], mouth, mn[2]], max: [mx[0], mx[1], mx[2]], name: 'wellPlug' } as BoxSpec,
            null,
          ),
        );
    }
  }

  // Moving parts in their pivot frames.
  for (const [o, name] of partObjs) {
    const toPart = o.matrixWorld.clone().invert();
    const pts: Pts = { p: [] };
    collect(o, toPart, isPart, pts);
    if (pts.p.length < 9) continue;
    const bx =
      name === 'mag'
        ? slabBoxes(pts.p, 1, 2, 0.005, 0.008, 'mag')
        : slabBoxes(pts.p, 2, 1, 0.01, 0.004, name);
    for (const b of bx) out.push({ ...toProxy(b, null), part: name });
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ runtime

function shapeOf(p: CollisionProxy): Shape {
  if (p.kind === 'capsule') return capsule(p.name, new Vector3(...p.a), new Vector3(...p.b), p.r);
  _qt.set(...(p.quat ?? [0, 0, 0, 1]));
  _m.compose(_v.set(...p.center), _qt, ONE);
  return box(p.name, _m, new Vector3(...p.half), p.r);
}

function shapeAabb(s: Shape, out: Float64Array, o: number) {
  if (s.kind === 'capsule') {
    for (let k = 0; k < 3; k++) {
      const a = s.a.getComponent(k),
        b = s.b.getComponent(k);
      out[o + k] = Math.min(a, b) - s.r;
      out[o + 3 + k] = Math.max(a, b) + s.r;
    }
    return;
  }
  // Box: inv maps group → box; its inverse maps the box corners out.
  _m2.copy(s.inv).invert();
  for (let k = 0; k < 3; k++) {
    out[o + k] = Infinity;
    out[o + 3 + k] = -Infinity;
  }
  for (let c = 0; c < 8; c++) {
    _v.set(
      c & 1 ? s.half.x : -s.half.x,
      c & 2 ? s.half.y : -s.half.y,
      c & 4 ? s.half.z : -s.half.z,
    ).applyMatrix4(_m2);
    for (let k = 0; k < 3; k++) {
      const x = _v.getComponent(k);
      out[o + k] = Math.min(out[o + k], x);
      out[o + 3 + k] = Math.max(out[o + 3 + k], x);
    }
  }
}

export class WeaponCollision {
  readonly groups: Group[] = [];
  readonly proxies: CollisionProxy[];
  /** Closest shape / group of the last `sdf` query. */
  hit: Shape | null = null;
  hitGroup: Group | null = null;
  /** Weapon-frame point → mag group local (for the mag-in-well rule). */
  readonly mag?: Group;
  /** Hands-only plug over the magwell opening (muted for the mag-in-well rule). */
  readonly plug?: Group;
  /** A group excluded from every query while set. */
  mute: Group | null = null;

  constructor(readonly model: WeaponModel) {
    this.proxies = model.collision ?? fitCollision(model);
    const byKey = new Map<string, CollisionProxy[]>();
    for (const p of this.proxies) {
      const k = p.part ?? (p.name === 'wellPlug' ? '#plug' : '');
      if (!byKey.has(k)) byKey.set(k, []);
      byKey.get(k)!.push(p);
    }
    for (const [k, list] of byKey) {
      const shapes = list.map(shapeOf);
      const aabb = new Float64Array(shapes.length * 6);
      shapes.forEach((s, i) => shapeAabb(s, aabb, i * 6));
      const part = (k && k !== '#plug' ? k : undefined) as PartName | undefined;
      const g: Group = {
        name: k || 'static',
        part,
        obj: part && k !== '#plug' ? model.parts[part] : undefined,
        shapes,
        aabb,
        toLocal: new Matrix4(),
        enabled: true,
        cand: new Int32Array(shapes.length),
        nCand: 0,
      };
      this.groups.push(g);
      if (k === 'mag') this.mag = g;
      if (k === '#plug') this.plug = g;
    }
  }

  /** Refresh part frames (call after the rig drove the parts this frame). */
  update() {
    const root = this.model.root;
    root.updateMatrixWorld(true);
    _m.copy(root.matrixWorld).invert();
    for (const g of this.groups) {
      if (!g.obj) continue;
      g.toLocal.multiplyMatrices(_m, g.obj.matrixWorld).invert();
      g.enabled = g.obj.visible && (!g.obj.parent || g.obj.parent.visible !== false);
    }
  }

  /**
   * Hand↔hand: the firing hand as an obstacle group (15 phalanx capsules + the palm box, weapon frame), so the
   * support hand yields to it. Created on first use; `setHand` refreshes it, `hand.enabled` toggles it.
   */
  hand?: Group;

  setHand(
    caps: { a: Vector3; b: Vector3; r: number }[],
    palm: Matrix4,
    palmInv: Matrix4,
    half: Vector3,
    r: number,
  ) {
    let g = this.hand;
    if (!g) {
      const shapes: Shape[] = caps.map((c, i) => capsule(`R.finger${i}`, c.a, c.b, c.r));
      shapes.push(box('R.palm', palm, half, r));
      g = {
        name: 'hand',
        shapes,
        aabb: new Float64Array(shapes.length * 6),
        toLocal: new Matrix4(),
        enabled: true,
        cand: new Int32Array(shapes.length),
        nCand: 0,
      };
      this.groups.push(g);
      this.hand = g;
    }
    for (let i = 0; i < caps.length; i++) {
      const s = g.shapes[i] as Extract<Shape, { kind: 'capsule' }>;
      s.a.copy(caps[i].a);
      s.b.copy(caps[i].b);
      s.r = caps[i].r;
    }
    const pb = g.shapes[caps.length] as Extract<Shape, { kind: 'box' }>;
    pb.inv.copy(palmInv);
    pb.half.copy(half);
    pb.r = r;
    g.shapes.forEach((s, i) => shapeAabb(s, g.aabb, i * 6));
    void palm;
  }

  private sel = false;

  /**
   * Broadphase: restrict queries to shapes whose AABB touches the sphere (weapon frame) until `unselect()`.
   * One per hand per frame keeps the per-query cost to the handful of shapes near that hand.
   */
  select(c: Vector3, radius: number) {
    this.sel = true;
    for (const g of this.groups) {
      _q.copy(c);
      if (g.obj) _q.applyMatrix4(g.toLocal);
      const A = g.aabb;
      let n = 0;
      for (let i = 0; i < g.shapes.length; i++) {
        const o = i * 6;
        const dx = Math.max(A[o] - _q.x, 0, _q.x - A[o + 3]);
        const dy = Math.max(A[o + 1] - _q.y, 0, _q.y - A[o + 4]);
        const dz = Math.max(A[o + 2] - _q.z, 0, _q.z - A[o + 5]);
        if (dx * dx + dy * dy + dz * dz <= radius * radius) g.cand[n++] = i;
      }
      g.nCand = n;
    }
  }

  unselect() {
    this.sel = false;
    this.mute = null;
  }

  /** Union SDF at a weapon-frame point; `skip` excludes a group (e.g. the held mag), `only` keeps one. */
  /** SDF evaluations so far (profiling). */
  queries = 0;

  sdf(p: Vector3, skip?: Group | null, only?: Group | null, maxD = Infinity): number {
    this.queries++;
    let best = maxD;
    this.hit = null;
    this.hitGroup = null;
    for (let gi = 0; gi < this.groups.length; gi++) {
      const g = this.groups[gi];
      if (!g.enabled || g === skip || g === this.mute || (only && g !== only)) continue;
      const sel = this.sel;
      if (sel && g.nCand === 0) continue;
      _q.copy(p);
      if (g.obj) _q.applyMatrix4(g.toLocal);
      const A = g.aabb;
      const N = sel ? g.nCand : g.shapes.length;
      for (let c = 0; c < N; c++) {
        const i = sel ? g.cand[c] : c;
        const o = i * 6;
        const dx = Math.max(A[o] - _q.x, 0, _q.x - A[o + 3]);
        const dy = Math.max(A[o + 1] - _q.y, 0, _q.y - A[o + 4]);
        const dz = Math.max(A[o + 2] - _q.z, 0, _q.z - A[o + 5]);
        const lb2 = dx * dx + dy * dy + dz * dz;
        if (best > 0 ? lb2 >= best * best : lb2 > 0) continue;
        const d = sdShape(g.shapes[i], _q);
        if (d < best) {
          best = d;
          this.hit = g.shapes[i];
          this.hitGroup = g;
        }
      }
    }
    return best;
  }

  /** Outward SDF gradient (unit) at `p` by central differences. */
  gradient(p: Vector3, out: Vector3, skip?: Group | null, only?: Group | null): Vector3 {
    const h = 0.0004;
    const x = p.x,
      y = p.y,
      z = p.z;
    const f = (a: number, b: number, c: number) => this.sdf(_g.set(a, b, c), skip, only, 0.05);
    out.set(
      f(x + h, y, z) - f(x - h, y, z),
      f(x, y + h, z) - f(x, y - h, z),
      f(x, y, z + h) - f(x, y, z - h),
    );
    const l = out.length();
    return l > 1e-9 ? out.divideScalar(l) : out.set(0, 1, 0);
  }

  get shapeCount(): number {
    let n = 0;
    for (const g of this.groups) n += g.shapes.length;
    return n;
  }
}
const _g = new Vector3();
