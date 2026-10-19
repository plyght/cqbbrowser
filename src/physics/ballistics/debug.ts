import {
  Color,
  CylinderGeometry,
  DynamicDrawUsage,
  Group,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  OctahedronGeometry,
  Quaternion,
  Vector3,
  type Scene,
} from 'three';
import type { TraceLog } from './traceLog';

/**
 * `?ballistics` overlay: the last N trajectories as thin tubes drawn over the world (no depth test, so you
 * see the path through walls), colour-coded by state: cyan = clean flight, green = after penetrating
 * (exit holes marked with a green diamond), orange = ricochet (departure vector), red diamond = stopped in a
 * material, yellow = steel hit with its spall fan.
 */

const COLORS = {
  flight: new Color(0x31e6ff),
  exited: new Color(0x5dff5a),
  ricochet: new Color(0xffa020),
  stop: new Color(0xff3030),
  steel: new Color(0xffe040),
};

const MAX_SEG = 2400;
const MAX_MARK = 600;

export class BallisticsDebug {
  readonly group = new Group();
  private segs: InstancedMesh;
  private marks: InstancedMesh;
  private seen = -1;
  private m = new Matrix4();
  private q = new Quaternion();
  private s = new Vector3();
  private a = new Vector3();
  private up = new Vector3(0, 1, 0);

  constructor(
    scene: Scene,
    private log: TraceLog,
  ) {
    const mat = () =>
      new MeshBasicMaterial({
        depthTest: false,
        depthWrite: false,
        transparent: true,
        opacity: 0.9,
        toneMapped: false,
      });
    this.segs = new InstancedMesh(new CylinderGeometry(1, 1, 1, 5, 1, true), mat(), MAX_SEG);
    this.marks = new InstancedMesh(new OctahedronGeometry(1, 0), mat(), MAX_MARK);
    for (const im of [this.segs, this.marks]) {
      im.instanceMatrix.setUsage(DynamicDrawUsage);
      im.frustumCulled = false;
      im.renderOrder = 1000;
      im.count = 0;
      im.setColorAt(0, COLORS.flight);
    }
    this.group.add(this.segs, this.marks);
    this.group.name = 'ballistics-debug';
    scene.add(this.group);
  }

  set visible(v: boolean) {
    this.group.visible = v;
  }

  private seg(a: Vector3, b: Vector3, r: number, c: Color, n: number) {
    if (n >= MAX_SEG) return n;
    const len = a.distanceTo(b);
    if (len < 1e-4) return n;
    this.s.copy(b).sub(a).divideScalar(len);
    this.q.setFromUnitVectors(this.up, this.s);
    this.m.compose(this.s.copy(a).add(b).multiplyScalar(0.5), this.q, this.a.set(r, len, r));
    this.segs.setMatrixAt(n, this.m);
    this.segs.setColorAt(n, c);
    return n + 1;
  }

  private mark(p: Vector3, size: number, c: Color, n: number) {
    if (n >= MAX_MARK) return n;
    this.m.compose(p, this.q.identity(), this.s.set(size, size, size));
    this.marks.setMatrixAt(n, this.m);
    this.marks.setColorAt(n, c);
    return n + 1;
  }

  update() {
    if (!this.group.visible || this.seen === this.log.version) return;
    this.seen = this.log.version;
    const L = this.log;
    let ns = 0,
      nm = 0;
    const a = new Vector3(),
      b = new Vector3(),
      p = new Vector3(),
      d = new Vector3();
    for (const i of L.order()) {
      const n = L.npts[i];
      const evs = Array.from({ length: L.nev[i] }, (_, k) => L.eventAt(i, k));
      let color = COLORS.flight;
      let e = 0;
      for (let k = 1; k < n; k++) {
        while (e < evs.length && evs[e].after < k) {
          const ev = evs[e++];
          if (ev.kind === 'exit') color = COLORS.exited;
          else if (ev.kind === 'ricochet') color = COLORS.ricochet;
        }
        a.fromArray(L.pointAt(i, k - 1));
        b.fromArray(L.pointAt(i, k));
        ns = this.seg(a, b, 0.011, color, ns);
      }
      for (const ev of evs) {
        p.fromArray(ev.at);
        d.fromArray(ev.dir);
        switch (ev.kind) {
          case 'exit':
            nm = this.mark(p, 0.055, COLORS.exited, nm);
            break;
          case 'stop':
            nm = this.mark(p, 0.065, COLORS.stop, nm);
            break;
          case 'steel':
            nm = this.mark(p, 0.06, COLORS.steel, nm);
            break;
          case 'ricochet':
            nm = this.mark(p, 0.06, COLORS.ricochet, nm);
            ns = this.seg(p, b.copy(p).addScaledVector(d, 1.5), 0.014, COLORS.ricochet, ns);
            break;
          case 'spall':
            ns = this.seg(p, b.copy(p).addScaledVector(d, 0.5), 0.007, COLORS.steel, ns);
            break;
        }
      }
    }
    this.segs.count = ns;
    this.marks.count = nm;
    this.segs.instanceMatrix.needsUpdate = true;
    this.marks.instanceMatrix.needsUpdate = true;
    if (this.segs.instanceColor) this.segs.instanceColor.needsUpdate = true;
    if (this.marks.instanceColor) this.marks.instanceColor.needsUpdate = true;
  }
}
