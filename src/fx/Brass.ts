import {
  Color,
  CylinderGeometry,
  DynamicDrawUsage,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
  type Scene,
} from 'three';
import type { Surface } from '../core/bus';

export type BrassKind = 'rifle' | 'pistol' | 'shell';

export interface CastHit {
  point: Vector3;
  normal: Vector3;
  surface: Surface;
}
/** Ray cast used for casing collisions (physics in-game, a stub in tests). */
export type CastFn = (origin: Vector3, dir: Vector3, maxDist: number) => CastHit | null;

export interface Casing {
  pos: Vector3;
  prev: Vector3;
  vel: Vector3;
  rot: Quaternion;
  spin: Vector3;
  /** 0 = free slot, 1 = flying, 2 = resting. */
  state: 0 | 1 | 2;
  landed: boolean;
  kind: BrassKind;
  len: number;
  radius: number;
  bounces: number;
}

const G = 9.81;
const _dir = new Vector3();
const _q = new Quaternion();
const _axis = new Vector3();
const _y = new Vector3(0, 1, 0);

/**
 * One fixed step of casing physics. Returns the surface hit on the casing's FIRST ground contact
 * (for the `brass` event), else null. Pure apart from the cast callback; unit-tested.
 */
export function stepCasing(c: Casing, dt: number, cast: CastFn): CastHit | null {
  if (c.state !== 1) return null;
  c.prev.copy(c.pos);
  c.vel.y -= G * dt;
  c.vel.multiplyScalar(1 - 0.08 * dt); // air drag (tiny)
  const travel = c.vel.length() * dt;
  let first: CastHit | null = null;
  if (travel > 1e-6) {
    _dir.copy(c.vel).divideScalar(travel / dt);
    const hit = cast(c.pos, _dir, travel + c.radius);
    if (hit) {
      c.pos.copy(hit.point).addScaledVector(hit.normal, c.radius);
      // Reflect: lose most normal speed, some tangential (brass is light and bouncy on hard floors).
      const vn = c.vel.dot(hit.normal);
      if (vn < 0) {
        const hard = hit.surface === 'concrete' || hit.surface === 'tile' || hit.surface === 'metal';
        const e = hard ? 0.42 : 0.18;
        c.vel.addScaledVector(hit.normal, -vn * (1 + e));
        c.vel.multiplyScalar(hard ? 0.7 : 0.45);
      }
      c.spin.multiplyScalar(0.6);
      c.bounces++;
      if (!c.landed && hit.normal.y > 0.5) {
        c.landed = true;
        first = hit;
      }
      if (hit.normal.y > 0.7 && (c.vel.length() < 0.35 || c.bounces > 6)) settle(c);
    } else {
      c.pos.addScaledVector(c.vel, dt);
    }
  }
  // Integrate tumble.
  const w = c.spin.length();
  if (w > 1e-4) {
    _axis.copy(c.spin).divideScalar(w);
    _q.setFromAxisAngle(_axis, w * dt);
    c.rot.premultiply(_q);
  }
  return first;
}

/** Lay the casing on its side, keeping its heading. */
function settle(c: Casing) {
  c.state = 2;
  c.vel.set(0, 0, 0);
  c.spin.set(0, 0, 0);
  _axis.copy(_y).applyQuaternion(c.rot);
  _axis.y = 0;
  if (_axis.lengthSq() < 1e-6) _axis.set(1, 0, 0);
  _axis.normalize();
  c.rot.setFromUnitVectors(_y, _axis);
}

const DIMS: Record<BrassKind, { len: number; r: number; color: number }> = {
  rifle: { len: 0.045, r: 0.0048, color: 0xc9a14a },
  pistol: { len: 0.019, r: 0.0049, color: 0xd1a955 },
  shell: { len: 0.065, r: 0.0105, color: 0x9c2a22 },
};

/** Pooled instanced casings. Spent brass stays on the floor until the pool recycles it. */
export class BrassPool {
  readonly mesh: InstancedMesh;
  readonly casings: Casing[] = [];
  private next = 0;
  private m = new Matrix4();
  private p = new Vector3();
  private s = new Vector3();
  private col = new Color();

  constructor(
    scene: Scene,
    readonly capacity = 96,
  ) {
    const geo = new CylinderGeometry(1, 1, 1, 8, 1);
    const mat = new MeshStandardMaterial({ color: 0xffffff, metalness: 0.85, roughness: 0.32 });
    this.mesh = new InstancedMesh(geo, mat, capacity);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    scene.add(this.mesh);
    for (let i = 0; i < capacity; i++)
      this.casings.push({
        pos: new Vector3(),
        prev: new Vector3(),
        vel: new Vector3(),
        rot: new Quaternion(),
        spin: new Vector3(),
        state: 0,
        landed: false,
        kind: 'rifle',
        len: 0.045,
        radius: 0.005,
        bounces: 0,
      });
  }

  eject(pos: Vector3, vel: Vector3, rot: Quaternion, spin: Vector3, kind: BrassKind) {
    const i = this.next;
    this.next = (this.next + 1) % this.capacity;
    const c = this.casings[i];
    const d = DIMS[kind];
    c.pos.copy(pos);
    c.prev.copy(pos);
    c.vel.copy(vel);
    c.rot.copy(rot);
    c.spin.copy(spin);
    c.state = 1;
    c.landed = false;
    c.kind = kind;
    c.len = d.len;
    c.radius = d.r;
    c.bounces = 0;
    this.mesh.setColorAt(i, this.col.setHex(d.color));
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.mesh.count = Math.max(this.mesh.count, i + 1);
  }

  fixedUpdate(dt: number, cast: CastFn, onLand: (c: Casing, hit: CastHit) => void) {
    for (const c of this.casings) {
      if (c.state !== 1) continue;
      const hit = stepCasing(c, dt, cast);
      if (hit) onLand(c, hit);
      // Fell through the world / far away → retire.
      if (c.pos.y < -5) c.state = 0;
    }
  }

  /** Interpolated render matrices. */
  update(alpha: number) {
    let dirty = false;
    for (let i = 0; i < this.mesh.count; i++) {
      const c = this.casings[i];
      if (c.state === 0) {
        this.s.set(0, 0, 0);
        this.m.compose(c.pos, c.rot, this.s);
      } else {
        this.p.lerpVectors(c.prev, c.pos, c.state === 1 ? alpha : 1);
        this.s.set(c.radius, c.len, c.radius);
        this.m.compose(this.p, c.rot, this.s);
      }
      this.mesh.setMatrixAt(i, this.m);
      dirty = true;
    }
    if (dirty) this.mesh.instanceMatrix.needsUpdate = true;
  }

  clear() {
    for (const c of this.casings) c.state = 0;
    this.mesh.count = 0;
    this.next = 0;
  }
}
