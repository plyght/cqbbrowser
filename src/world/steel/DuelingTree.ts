import { Mesh, Quaternion, Vector3 } from 'three';
import { RAPIER, type RayHit } from '../../physics/Physics';
import { boxGeo, mergeAny } from '../geo';
import { emitSteelHit, type Target, type TargetEnv } from '../targets';
import { bulletMomentum, flipSpeed } from './momentum';
import { mapDark, plateGeometry, shapes, type PaintCell } from './paint';
import { STEEL_GROUPS, syncMesh, twistAngle, yawQuat, type PendingHit } from './common';

const REST = 1.05; // radians from vertical where a paddle rests against its stop
const ARM = 0.4;
const PLATE = 0.15;

/**
 * One paddle of a dueling tree: an arm on a revolute joint (axis toward the shooter) at the post.
 * It rests against a stop on one side; a hit with enough momentum swings it over the top to the other.
 */
export class Paddle implements Target {
  kind = 'paddle' as const;
  hits = 0;
  down = false;
  mustFall = true;
  steel = true;
  noShoot = false;
  readonly mesh: Mesh;
  private body: RAPIER.RigidBody;
  private cell: PaintCell;
  private pending: PendingHit[] = [];
  private homeQ: Quaternion;
  private frameQ: Quaternion;
  private side: number;
  private settled = true;
  private bounds: { minX: number; minY: number; w: number; h: number };

  constructor(
    private env: TargetEnv,
    public id: string,
    private pivot: Vector3,
    yaw: number,
    private startSide: 1 | -1,
  ) {
    const { ctx, atlas } = env;
    this.side = startSide;
    this.frameQ = yawQuat(yaw);
    this.homeQ = this.frameQ
      .clone()
      .multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), REST * startSide));
    this.cell = atlas.alloc();
    const pg = plateGeometry(shapes.rect(PLATE, PLATE), 0.0095, atlas, this.cell);
    this.bounds = pg;
    pg.geo.translate(0, ARM + PLATE / 2 - 0.02, 0);
    const arm = mapDark(boxGeo(0.03, ARM, 0.012), atlas);
    arm.translate(0, ARM / 2, -0.008);
    const hub = mapDark(boxGeo(0.06, 0.06, 0.03), atlas);
    this.mesh = new Mesh(mergeAny([pg.geo, arm, hub]), atlas.material);
    this.mesh.castShadow = true;
    env.parent.add(this.mesh);

    const w = ctx.physics.world;
    const hq = this.homeQ;
    this.body = w.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(pivot.x, pivot.y, pivot.z)
        .setRotation({ x: hq.x, y: hq.y, z: hq.z, w: hq.w })
        .setAngularDamping(0.6)
        .setCanSleep(true),
    );
    const plate = w.createCollider(
      RAPIER.ColliderDesc.cuboid(PLATE / 2, PLATE / 2, 0.005)
        .setTranslation(0, ARM + PLATE / 2 - 0.02, 0)
        .setDensity(7850)
        .setCollisionGroups(STEEL_GROUPS),
      this.body,
    );
    const armC = w.createCollider(
      RAPIER.ColliderDesc.cuboid(0.015, ARM / 2, 0.006)
        .setTranslation(0, ARM / 2, 0)
        .setDensity(7850)
        .setCollisionGroups(STEEL_GROUPS),
      this.body,
    );
    for (const c of [plate, armC]) ctx.physics.tag(c, { surface: 'steel_target', targetId: id });
    const fq = this.frameQ;
    const anchor = w.createRigidBody(
      RAPIER.RigidBodyDesc.fixed()
        .setTranslation(pivot.x, pivot.y, pivot.z)
        .setRotation({ x: fq.x, y: fq.y, z: fq.z, w: fq.w }),
    );
    const j = w.createImpulseJoint(
      RAPIER.JointData.revolute({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }),
      anchor,
      this.body,
      true,
    ) as RAPIER.RevoluteImpulseJoint;
    j.setLimits(-REST, REST);
    syncMesh(this.mesh, this.body);
    env.register(this);
  }

  angle() {
    return twistAngle(this.body.rotation(), this.frameQ, 'z');
  }

  aimPoint() {
    return this.mesh.localToWorld(new Vector3(0, ARM + PLATE / 2 - 0.02, 0));
  }

  onHit(hit: RayHit, dir: Vector3, energy: number): boolean {
    this.hits++;
    const local = this.mesh.worldToLocal(hit.point.clone());
    const b = this.bounds;
    const ly = local.y - (ARM + PLATE / 2 - 0.02);
    if (ly > b.minY) {
      this.env.atlas.mark(this.cell, (local.x - b.minX) / b.w, (ly - b.minY) / b.h, 64 / PLATE, energy);
    }
    this.pending.push({ point: hit.point.clone(), dir: dir.clone(), energy });
    emitSteelHit(this.env, this.id, hit.point, PLATE, 9.5, energy);
    return true;
  }

  private process() {
    for (const h of this.pending) {
      const p = bulletMomentum(h.energy, this.env.shots.massKg);
      const a = this.angle();
      const from = Math.sign(a) || this.side;
      const axis = new Vector3(0, 0, 1).applyQuaternion(this.frameQ);
      // Enough momentum swings it over the top; less just rattles it on its stop.
      const omega = p >= 1.2 ? flipSpeed(Math.abs(a), ARM) : 1.2;
      const s = -from * omega;
      this.body.setAngvel({ x: axis.x * s, y: axis.y * s, z: axis.z * s }, true);
      this.settled = false;
    }
    this.pending.length = 0;
  }

  fixedUpdate() {
    this.process();
    if (!this.settled) {
      const a = this.angle();
      const av = this.body.angvel();
      if (Math.abs(a) > REST - 0.12 && Math.hypot(av.x, av.y, av.z) < 0.6) {
        this.settled = true;
        const side = Math.sign(a);
        if (side !== this.side) {
          this.side = side;
          this.down = side !== this.startSide;
          const t = this.body.translation();
          this.env.ctx.bus.emit('steelFall', { point: new Vector3(t.x, t.y, t.z), targetId: this.id });
        }
      }
    }
  }

  update() {
    this.process();
    syncMesh(this.mesh, this.body);
  }

  reset() {
    this.hits = 0;
    this.down = false;
    this.side = this.startSide;
    this.settled = true;
    this.env.atlas.repaint(this.cell);
    const hq = this.homeQ;
    this.body.setTranslation({ x: this.pivot.x, y: this.pivot.y, z: this.pivot.z }, true);
    this.body.setRotation({ x: hq.x, y: hq.y, z: hq.z, w: hq.w }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
  }
}

/** Six-paddle dueling tree: post on a base, paddles alternating left/right. Ids `${id}.p0..p5` bottom up. */
export function makeDuelingTree(env: TargetEnv, id: string, ground: Vector3, yaw = 0): Paddle[] {
  const { batch, mats } = env;
  batch.box(mats.steelPost, ground.x, ground.y, ground.z, 0.9, 0.05, 0.6, { yaw });
  batch.box(mats.steelPost, ground.x, ground.y, ground.z, 0.08, 2.05, 0.08, {
    yaw,
    cast: true,
    tag: { surface: 'metal' },
  });
  const c = Math.cos(yaw),
    s = Math.sin(yaw);
  const out: Paddle[] = [];
  for (let i = 0; i < 6; i++) {
    const pivot = new Vector3(ground.x + s * 0.065, ground.y + 0.75 + i * 0.24, ground.z + c * 0.065);
    out.push(new Paddle(env, `${id}.p${i}`, pivot, yaw, i % 2 ? -1 : 1));
  }
  return out;
}
