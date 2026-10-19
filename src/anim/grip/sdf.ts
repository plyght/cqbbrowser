import { Matrix4, Vector3 } from 'three';

/** Cheap analytic signed distance shapes (weapon frame), unioned per weapon. */
export type Shape =
  | { kind: 'box'; name: string; inv: Matrix4; half: Vector3; r: number }
  | { kind: 'capsule'; name: string; a: Vector3; b: Vector3; r: number };

const _p = new Vector3();
const _ab = new Vector3();

/** Rounded box: `inv` takes weapon-frame points into the box frame (centre at origin). */
export function box(name: string, world: Matrix4, half: Vector3, r: number): Shape {
  return { kind: 'box', name, inv: world.clone().invert(), half: half.clone(), r };
}

export function capsule(name: string, a: Vector3, b: Vector3, r: number): Shape {
  return { kind: 'capsule', name, a: a.clone(), b: b.clone(), r };
}

export function sdShape(s: Shape, p: Vector3): number {
  if (s.kind === 'box') {
    _p.copy(p).applyMatrix4(s.inv);
    const qx = Math.abs(_p.x) - (s.half.x - s.r),
      qy = Math.abs(_p.y) - (s.half.y - s.r),
      qz = Math.abs(_p.z) - (s.half.z - s.r);
    const ox = Math.max(qx, 0),
      oy = Math.max(qy, 0),
      oz = Math.max(qz, 0);
    return Math.hypot(ox, oy, oz) + Math.min(Math.max(qx, qy, qz), 0) - s.r;
  }
  _ab.subVectors(s.b, s.a);
  _p.subVectors(p, s.a);
  const t = Math.min(1, Math.max(0, _p.dot(_ab) / Math.max(1e-12, _ab.lengthSq())));
  return _p.addScaledVector(_ab, -t).length() - s.r;
}

export class ShapeSet {
  constructor(readonly shapes: Shape[]) {}

  /** Union distance (min over shapes); optional name filter. */
  sdf(p: Vector3, only?: (s: Shape) => boolean): number {
    let d = Infinity;
    for (const s of this.shapes) if (!only || only(s)) d = Math.min(d, sdShape(s, p));
    return d;
  }

  get(name: string): Shape | undefined {
    return this.shapes.find((s) => s.name === name);
  }
}
