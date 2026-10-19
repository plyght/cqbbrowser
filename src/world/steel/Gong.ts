import { Mesh, Vector3 } from 'three';
import { RAPIER, type RayHit } from '../../physics/Physics';
import { boxGeo, mergeAny } from '../geo';
import { emitSteelHit, type Target, type TargetEnv } from '../targets';
import { bulletMomentum } from './momentum';
import { mapDark, plateGeometry, shapes, type PaintCell } from './paint';
import { STEEL_GROUPS, syncMesh, type PendingHit } from './common';

export interface GongOpts {
  round?: boolean;
  /** Width (diameter) and height, metres. */
  w?: number;
  h?: number;
  thicknessMm?: number;
  /** Hook (top of chain) height above ground. */
  hookY?: number;
  chain?: number;
  /** Build the steel stand (two posts + crossbar). */
  frame?: boolean;
  yaw?: number;
}

/** AR500 plate hung on chains: a dynamic body on a revolute joint under its hook. Rings, never falls. */
export class Gong implements Target {
  kind = 'gong' as const;
  hits = 0;
  down = false;
  mustFall = false;
  steel = true;
  noShoot = false;
  readonly mesh: Mesh;
  private body: RAPIER.RigidBody;
  private cell: PaintCell;
  private pending: PendingHit[] = [];
  private plate: { minX: number; minY: number; w: number; h: number };
  private dropY: number;
  readonly size: number;
  readonly thicknessMm: number;

  constructor(
    private env: TargetEnv,
    public id: string,
    pos: Vector3,
    o: GongOpts = {},
  ) {
    const { ctx, atlas, mats, batch } = env;
    const w = o.w ?? 0.3,
      h = o.h ?? w;
    const round = o.round ?? true;
    this.thicknessMm = o.thicknessMm ?? 10;
    this.size = Math.max(w, h);
    const t = this.thicknessMm / 1000;
    const hookY = o.hookY ?? 1.5;
    const chain = o.chain ?? 0.16;
    const yaw = o.yaw ?? 0;
    this.dropY = chain + h / 2;

    // Stand: two square posts, crossbar, feet.
    if (o.frame !== false) {
      const span = w / 2 + 0.25;
      const c = Math.cos(yaw),
        s = Math.sin(yaw);
      for (const k of [-1, 1]) {
        const px = pos.x + c * k * span,
          pz = pos.z - s * k * span;
        batch.box(mats.steelPost, px, pos.y, pz, 0.05, hookY + 0.05, 0.05, { yaw });
        batch.box(mats.steelPost, px, pos.y, pz, 0.06, 0.04, 0.6, { yaw });
      }
      batch.box(mats.steelPost, pos.x, pos.y + hookY, pos.z, span * 2 + 0.05, 0.05, 0.05, {
        yaw,
        cast: true,
      });
    }

    // Plate + chains in one mesh (chains mapped to the atlas' dark cell).
    this.cell = atlas.alloc();
    const shape = round ? shapes.circle(w / 2) : shapes.rect(w, h);
    const pg = plateGeometry(shape, t, atlas, this.cell, 28);
    this.plate = pg;
    pg.geo.translate(0, -this.dropY, 0);
    const parts = [pg.geo];
    for (const k of [-1, 1]) {
      const cg = mapDark(boxGeo(0.01, chain + 0.03, 0.01), atlas);
      cg.translate(k * w * 0.3, -chain / 2, 0);
      parts.push(cg);
    }
    this.mesh = new Mesh(mergeAny(parts), atlas.material);
    this.mesh.castShadow = true;
    env.parent.add(this.mesh);

    const w0 = ctx.physics.world;
    const q = { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };
    const hook = { x: pos.x, y: pos.y + hookY, z: pos.z };
    this.body = w0.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(hook.x, hook.y, hook.z)
        .setRotation(q)
        .setAngularDamping(0.35),
    );
    const col = w0.createCollider(
      RAPIER.ColliderDesc.cuboid(w / 2, h / 2, t / 2)
        .setTranslation(0, -this.dropY, 0)
        .setDensity(7850)
        .setCollisionGroups(STEEL_GROUPS),
      this.body,
    );
    ctx.physics.tag(col, { surface: 'steel_target', targetId: id });
    const anchor = w0.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(hook.x, hook.y, hook.z).setRotation(q),
    );
    w0.createImpulseJoint(
      RAPIER.JointData.revolute({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }),
      anchor,
      this.body,
      true,
    );
    syncMesh(this.mesh, this.body);
    env.register(this);
  }

  aimPoint() {
    return this.mesh.localToWorld(new Vector3(0, -this.dropY, 0));
  }

  onHit(hit: RayHit, dir: Vector3, energy: number): boolean {
    this.hits++;
    this.pending.push({ point: hit.point.clone(), dir: dir.clone(), energy });
    // Paint mark immediately (visible on the next frame).
    const local = this.mesh.worldToLocal(hit.point.clone());
    const p = this.plate;
    this.env.atlas.mark(
      this.cell,
      (local.x - p.minX) / p.w,
      (local.y + this.dropY - p.minY) / p.h,
      64 / this.size,
      energy,
    );
    emitSteelHit(this.env, this.id, hit.point, this.size, this.thicknessMm, energy);
    return true;
  }

  private process() {
    for (const h of this.pending) {
      const p = bulletMomentum(h.energy, this.env.shots.massKg) * 1.7;
      this.body.applyImpulseAtPoint({ x: h.dir.x * p, y: h.dir.y * p, z: h.dir.z * p }, h.point, true);
    }
    this.pending.length = 0;
  }

  fixedUpdate() {
    this.process();
  }

  update() {
    this.process();
    syncMesh(this.mesh, this.body);
  }

  reset() {
    this.hits = 0;
    this.env.atlas.repaint(this.cell);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
  }
}
