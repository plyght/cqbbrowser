import {
  BufferAttribute,
  BufferGeometry,
  Color,
  IcosahedronGeometry,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  MeshBasicMaterial,
  Object3D,
  Vector3,
} from 'three';
import type { Shape } from '../grip/sdf';
import type { HandContact } from './HandContact';
import { PALM, WRIST } from './handProxy';

/**
 * `?contact` debug overlay: the hand proxies (finger capsules as sphere chains, palm grid, wrist) coloured by
 * their distance to the weapon — red = penetrating > 1 mm, yellow = touching (±1 mm), green = 1–3 mm, grey =
 * free — and the weapon's collision boxes as wireframes (red where a hand sample is inside them).
 * Two draw calls; drawn on top of everything.
 */
const MAXS = 512;
const RED = new Color(1, 0.08, 0.05);
const YELLOW = new Color(1, 0.85, 0.1);
const GREEN = new Color(0.1, 1, 0.3);
const GREY = new Color(0.6, 0.62, 0.7);
const BOX = new Color(0.25, 0.75, 1);

const _p = new Vector3();
const _w = new Vector3();
const _m = new Matrix4();
const _m2 = new Matrix4();
const _m3 = new Matrix4();
const _c = new Color();
const EDGES = [0, 1, 1, 3, 3, 2, 2, 0, 4, 5, 5, 7, 7, 6, 6, 4, 0, 4, 1, 5, 2, 6, 3, 7];

export class ContactOverlay {
  readonly root = new Object3D();
  private spheres: InstancedMesh;
  private lines: LineSegments;
  private hot = new Set<Shape>();
  /** Last frame's worst penetration (m). */
  worst = 0;

  constructor(parent: Object3D) {
    const mat = new MeshBasicMaterial({
      depthTest: false,
      depthWrite: false,
      transparent: true,
      opacity: 0.55,
      toneMapped: false,
    });
    this.spheres = new InstancedMesh(new IcosahedronGeometry(1, 1), mat, MAXS);
    this.spheres.frustumCulled = false;
    this.spheres.renderOrder = 998;
    this.spheres.count = 0;
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(256 * 24 * 3), 3));
    g.setAttribute('color', new BufferAttribute(new Float32Array(256 * 24 * 3), 3));
    this.lines = new LineSegments(
      g,
      new LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true, toneMapped: false }),
    );
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 999;
    this.root.add(this.spheres, this.lines);
    parent.add(this.root);
  }

  static enabled(): boolean {
    try {
      return new URLSearchParams(location.search).has('contact');
    } catch {
      return false;
    }
  }

  /** Redraw from the contact layer's current state (call after `contact.apply`, before rendering). */
  update(c: HandContact) {
    const col = c.col;
    const model = c.rig.weaponModel;
    if (!col || !model || !c.sync()) {
      this.spheres.count = 0;
      this.lines.geometry.setDrawRange(0, 0);
      return;
    }
    this.root.parent?.updateMatrixWorld(true);
    const W = model.root.matrixWorld;
    const toLocal = _m2.copy(this.root.matrixWorld).invert().multiply(W);
    this.hot.clear();
    this.worst = 0;
    let n = 0;
    let skip: typeof col.hand | null = null;
    const put = (p: Vector3, r: number) => {
      if (n >= MAXS) return;
      const d = col.sdf(p, skip) - r;
      if (d < 0 && col.hit) this.hot.add(col.hit);
      this.worst = Math.max(this.worst, -d);
      _c.copy(d < -0.001 ? RED : d < 0.001 ? YELLOW : d < 0.003 ? GREEN : GREY);
      _w.copy(p).applyMatrix4(toLocal);
      _m.makeScale(r, r, r).setPosition(_w);
      this.spheres.setMatrixAt(n, _m);
      this.spheres.setColorAt(n++, _c);
    };
    for (const s of ['R', 'L'] as const) {
      const h = c.hands[s].proxy;
      skip = s === 'R' ? (col.hand ?? null) : null;
      for (const ph of h.phalanges) for (let i = 0; i < 3; i++) put(_p.lerpVectors(ph.a, ph.b, i / 2), ph.r);
      const r = PALM.halfN;
      const hx = h.palmHalf.x - r,
        hz = h.palmHalf.z - r;
      for (let i = 0; i < 4; i++)
        for (let j = 0; j < 3; j++)
          put(_p.set(-hx + hx * j, 0, -hz + ((2 * hz) / 3) * i).applyMatrix4(h.palm), r);
      for (let i = 0; i < 3; i++) put(_p.lerpVectors(h.wristA, h.wristB, i / 2), WRIST.r);
    }
    this.spheres.count = n;
    this.spheres.instanceMatrix.needsUpdate = true;
    if (this.spheres.instanceColor) this.spheres.instanceColor.needsUpdate = true;
    // Weapon boxes.
    const pos = this.lines.geometry.getAttribute('position') as BufferAttribute;
    const colr = this.lines.geometry.getAttribute('color') as BufferAttribute;
    let v = 0;
    const corner = [
      new Vector3(),
      new Vector3(),
      new Vector3(),
      new Vector3(),
      new Vector3(),
      new Vector3(),
      new Vector3(),
      new Vector3(),
    ];
    for (const g of col.groups) {
      if (!g.enabled) continue;
      for (const s of g.shapes) {
        if (s.kind !== 'box' || v + 24 > pos.count) continue;
        // box frame → group frame → weapon frame → overlay root
        _m.copy(s.inv).invert();
        if (g.obj) _m.premultiply(_m3.copy(g.toLocal).invert());
        _m.premultiply(toLocal);
        for (let k = 0; k < 8; k++)
          corner[k]
            .set(k & 1 ? s.half.x : -s.half.x, k & 2 ? s.half.y : -s.half.y, k & 4 ? s.half.z : -s.half.z)
            .applyMatrix4(_m);
        const cc = this.hot.has(s) ? RED : BOX;
        for (const e of EDGES) {
          pos.setXYZ(v, corner[e].x, corner[e].y, corner[e].z);
          colr.setXYZ(v++, cc.r, cc.g, cc.b);
        }
      }
    }
    this.lines.geometry.setDrawRange(0, v);
    pos.needsUpdate = true;
    colr.needsUpdate = true;
  }

  dispose() {
    this.root.removeFromParent();
    this.spheres.geometry.dispose();
    this.lines.geometry.dispose();
  }
}
