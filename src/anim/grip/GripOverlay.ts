import {
  Color,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  Vector3,
  type Scene,
} from 'three';
import { handSamples, type Sample } from './solve';
import type { ShapeSet } from './sdf';

/**
 * `?grip` debug overlay: every glove sample of both hands as a dot coloured by its SDF to the weapon surfaces —
 * green = touching (0–3 mm), yellow = slight penetration (≤ 1.5 mm) or a hovering contact pad (> 3 mm),
 * red = penetration beyond 1.5 mm, grey = free sample away from the gun. One draw call.
 */
const MAX = 256;
const GREEN = new Color(0.1, 1, 0.25);
const YELLOW = new Color(1, 0.85, 0.1);
const RED = new Color(1, 0.1, 0.05);
const GREY = new Color(0.55, 0.55, 0.6);

export class GripOverlay {
  readonly mesh: InstancedMesh;
  private smp: Sample[] = [];
  private m = new Matrix4();
  private v = new Vector3();
  /** Last frame's worst penetration (m), for tests/HUD. */
  worst = 0;

  constructor(scene: Scene) {
    const mat = new MeshBasicMaterial({
      depthTest: false,
      depthWrite: false,
      transparent: true,
      toneMapped: false,
    });
    this.mesh = new InstancedMesh(new IcosahedronGeometry(0.0016, 0), mat, MAX);
    this.mesh.renderOrder = 999;
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    scene.add(this.mesh);
  }

  static enabled(): boolean {
    try {
      return new URLSearchParams(location.search).has('grip');
    } catch {
      return false;
    }
  }

  /**
   * @param weaponWorld weapon frame → world; hands are given in world space and evaluated in the weapon frame.
   */
  update(
    set: ShapeSet,
    weaponWorld: Matrix4,
    hands: {
      pos: Vector3;
      quat: { x: number; y: number; z: number; w: number };
      curls: ArrayLike<number>;
      side: 1 | -1;
    }[],
  ) {
    const inv = this.m.copy(weaponWorld).invert();
    let n = 0;
    this.worst = 0;
    const handW = new Matrix4();
    for (const h of hands) {
      handW.compose(h.pos, h.quat as never, this.v.set(1, 1, 1));
      handW.premultiply(inv);
      for (const s of handSamples(handW, h.side, h.curls, this.smp)) {
        if (n >= MAX) break;
        const d = set.sdf(s.p, (x) => x.name !== 'supportWrap');
        this.worst = Math.max(this.worst, -d);
        const pad = s.kind === 'pad' || s.kind === 'tip' || s.kind === 'palm';
        const c = d < -0.0015 ? RED : d < 0 ? YELLOW : d <= 0.003 ? GREEN : pad && d < 0.012 ? YELLOW : GREY;
        this.mesh.setColorAt(n, c);
        s.p.applyMatrix4(weaponWorld);
        const m = new Matrix4().makeTranslation(s.p.x, s.p.y, s.p.z);
        this.mesh.setMatrixAt(n++, m);
      }
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}
