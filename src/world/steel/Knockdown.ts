import { Mesh, Quaternion, Vector3, type Shape } from 'three';
import { Spring } from '../../core/math';
import { RAPIER, type RayHit } from '../../physics/Physics';
import { emitSteelHit, type Target, type TargetEnv } from '../targets';
import { hitImpulse, knocksDown, POPPER_HEAVY, POPPER_STANDARD, type Calibration } from './momentum';
import { plateGeometry, shapes, type PaintCell } from './paint';
import { STEEL_GROUPS, syncMesh, twistAngle, yawQuat, type PendingHit } from './common';

export interface KnockdownOpts {
  kind?: 'popper' | 'plate';
  /** Plate outline in local x/y with y = 0 at the hinge. */
  shape: Shape;
  thicknessMm?: number;
  cal?: Calibration;
  yaw?: number;
  /** Lowest joint angle (falls backwards to this, radians, negative). */
  fallLimit?: number;
  /** Size reported to audio (plate width/diameter). */
  size: number;
}

/**
 * Hinged steel that stays up until a hit above its calibration line carries enough momentum
 * (poppers, rack plates). Standing, the body is fixed (no solver drift); a qualifying hit makes it
 * dynamic and the revolute hinge + gravity lay it down. Sub-threshold hits just rock it.
 */
export class Knockdown implements Target {
  kind: 'popper' | 'plate';
  hits = 0;
  down = false;
  mustFall = true;
  steel = true;
  noShoot = false;
  readonly mesh: Mesh;
  private body: RAPIER.RigidBody;
  private cell: PaintCell;
  private pending: PendingHit[] = [];
  private bounds: { minX: number; minY: number; w: number; h: number };
  private home: Vector3;
  private homeQ: Quaternion;
  private cal: Calibration;
  private wobble = new Spring(3.2, 0.18);
  private fallT = -1;
  private fallLimit: number;
  readonly thicknessMm: number;
  readonly size: number;

  constructor(
    private env: TargetEnv,
    public id: string,
    hinge: Vector3,
    o: KnockdownOpts,
  ) {
    const { ctx, atlas } = env;
    this.kind = o.kind ?? 'popper';
    this.cal = o.cal ?? POPPER_STANDARD;
    this.thicknessMm = o.thicknessMm ?? 10;
    this.size = o.size;
    this.fallLimit = o.fallLimit ?? -1.42;
    const t = this.thicknessMm / 1000;
    this.home = hinge.clone();
    this.homeQ = yawQuat(o.yaw ?? 0);

    this.cell = atlas.alloc();
    const pg = plateGeometry(o.shape, t, atlas, this.cell, 18);
    this.bounds = pg;
    this.mesh = new Mesh(pg.geo, atlas.material);
    this.mesh.castShadow = true;
    env.parent.add(this.mesh);

    const w = ctx.physics.world;
    const q = { x: this.homeQ.x, y: this.homeQ.y, z: this.homeQ.z, w: this.homeQ.w };
    this.body = w.createRigidBody(
      RAPIER.RigidBodyDesc.fixed()
        .setTranslation(hinge.x, hinge.y, hinge.z)
        .setRotation(q)
        .setAngularDamping(0.4),
    );
    // Convex hull of the outline, front and back.
    const pts = o.shape.getPoints(12);
    const hull = new Float32Array(pts.length * 6);
    pts.forEach((p, i) => {
      hull.set([p.x, p.y, t / 2, p.x, p.y, -t / 2], i * 6);
    });
    const desc = (RAPIER.ColliderDesc.convexHull(hull) ?? RAPIER.ColliderDesc.cuboid(0.1, 0.3, t / 2))
      .setDensity(7850)
      .setCollisionGroups(STEEL_GROUPS);
    ctx.physics.tag(w.createCollider(desc, this.body), { surface: 'steel_target', targetId: id });
    const anchor = w.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(hinge.x, hinge.y, hinge.z).setRotation(q),
    );
    const j = w.createImpulseJoint(
      RAPIER.JointData.revolute({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }),
      anchor,
      this.body,
      true,
    ) as RAPIER.RevoluteImpulseJoint;
    j.setLimits(this.fallLimit, 0.05);
    syncMesh(this.mesh, this.body);
    env.register(this);
  }

  aimPoint() {
    const b = this.bounds;
    // Above the calibration line.
    return this.mesh.localToWorld(new Vector3(b.minX + b.w / 2, b.minY + b.h * 0.72, 0));
  }

  onHit(hit: RayHit, dir: Vector3, energy: number): boolean {
    this.hits++;
    const local = this.mesh.worldToLocal(hit.point.clone());
    const b = this.bounds;
    this.env.atlas.mark(
      this.cell,
      (local.x - b.minX) / b.w,
      (local.y - b.minY) / b.h,
      64 / Math.max(b.w, b.h),
      energy,
    );
    this.pending.push({ point: hit.point.clone(), dir: dir.clone(), energy, height: local.y });
    emitSteelHit(this.env, this.id, hit.point, this.size, this.thicknessMm, energy);
    return true;
  }

  private process() {
    for (const h of this.pending) {
      const p = hitImpulse(h.energy, this.env.shots.massKg);
      const hitHeight = h.height ?? 0;
      if (!this.down && knocksDown(p, hitHeight, this.cal)) this.knock(h, p);
      else if (!this.down) this.wobble.impulse(-(0.25 + p * 0.12));
      else this.body.applyImpulseAtPoint({ x: h.dir.x * p, y: 0, z: h.dir.z * p }, h.point, true);
    }
    this.pending.length = 0;
  }

  private knock(h: PendingHit, p: number) {
    this.down = true;
    this.fallT = 0;
    this.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
    // Start it rotating backwards about its hinge; gravity finishes the job.
    const axis = new Vector3(1, 0, 0).applyQuaternion(this.homeQ);
    const spin = -(2.2 + p * 0.4);
    this.body.setAngvel({ x: axis.x * spin, y: axis.y * spin, z: axis.z * spin }, true);
    this.body.applyImpulseAtPoint({ x: h.dir.x * p, y: 0, z: h.dir.z * p }, h.point, true);
  }

  fixedUpdate(dt: number) {
    this.process();
    if (this.fallT >= 0) {
      this.fallT += dt;
      const a = twistAngle(this.body.rotation(), this.homeQ, 'x');
      if (a < this.fallLimit + 0.25 || this.fallT > 0.9) {
        this.fallT = -1;
        const t = this.body.translation();
        this.env.ctx.bus.emit('steelFall', { point: new Vector3(t.x, t.y, t.z), targetId: this.id });
      }
    }
  }

  update(dt: number) {
    this.process();
    syncMesh(this.mesh, this.body);
    if (!this.down) {
      this.wobble.step(0, dt);
      if (Math.abs(this.wobble.value) > 1e-4) this.mesh.rotateX(this.wobble.value * 0.05);
    }
  }

  reset() {
    this.down = false;
    this.hits = 0;
    this.fallT = -1;
    this.wobble.reset();
    this.env.atlas.repaint(this.cell);
    this.body.setBodyType(RAPIER.RigidBodyType.Fixed, true);
    this.body.setTranslation({ x: this.home.x, y: this.home.y, z: this.home.z }, true);
    this.body.setRotation({ x: this.homeQ.x, y: this.homeQ.y, z: this.homeQ.z, w: this.homeQ.w }, true);
  }
}

/** Full-size popper (1.07 m x 0.3 m) on a hinge 8 cm above its base plate. */
export function makePopper(
  env: TargetEnv,
  id: string,
  ground: Vector3,
  yaw = 0,
  heavy = false,
  cal?: Calibration,
) {
  const { batch, mats } = env;
  batch.box(mats.steelPost, ground.x, ground.y, ground.z, 0.5, 0.04, 0.42, { yaw });
  batch.box(mats.steelPost, ground.x, ground.y + 0.04, ground.z, 0.22, 0.05, 0.06, { yaw });
  return new Knockdown(env, id, new Vector3(ground.x, ground.y + 0.08, ground.z), {
    kind: 'popper',
    shape: shapes.popper(1.07, 0.3),
    thicknessMm: heavy ? 13 : 10,
    cal: cal ?? (heavy ? POPPER_HEAVY : POPPER_STANDARD),
    yaw,
    size: 0.3,
  });
}
