import { CylinderGeometry, Mesh, Quaternion, Vector3 } from 'three';
import { RAPIER, type RayHit } from '../../physics/Physics';
import { boxGeo, mergeAny } from '../geo';
import { emitSteelHit, type Target, type TargetEnv } from '../targets';
import { hitImpulse, PLATE_ANY } from './momentum';
import { mapDark, plateGeometry, shapes, type PaintCell } from './paint';
import { STEEL_GROUPS, syncMesh, yawQuat, type PendingHit } from './common';

const ARM = 0.52; // hub → plate centre
const R = 0.1; // 8" plates
const T = 0.0095;

interface StarPlate {
  id: string;
  angle: number;
  mesh: Mesh;
  cell: PaintCell;
  collider: RAPIER.Collider | null;
  body: RAPIER.RigidBody | null;
  off: boolean;
  fallT: number;
  local: Vector3;
}

/**
 * Texas star: five 8" plates on a free-spinning five-arm star (revolute joint, axis toward the
 * shooter). Plates are colliders of the hub body while attached; a hit detaches one into its own
 * dynamic body, which changes the hub's mass distribution so the star swings and spins from the
 * imbalance. The star itself is one target (`id`); each plate routes hits via `${id}.p<i>`.
 */
export class TexasStar implements Target {
  kind = 'star' as const;
  hits = 0;
  down = false;
  mustFall = true;
  steel = true;
  noShoot = false;
  readonly hub: Mesh;
  readonly plates: StarPlate[] = [];
  private body: RAPIER.RigidBody;
  private pending: PendingHit[] = [];
  private homeQ: Quaternion;
  private centre: Vector3;

  constructor(
    private env: TargetEnv,
    public id: string,
    private ground: Vector3,
    yaw = 0,
  ) {
    const { ctx, atlas, batch, mats } = env;
    const hubY = 1.55;
    this.homeQ = yawQuat(yaw);
    const c = Math.cos(yaw),
      s = Math.sin(yaw);
    this.centre = new Vector3(ground.x + s * 0.08, ground.y + hubY, ground.z + c * 0.08);
    // Post + base (static).
    batch.box(mats.steelPost, ground.x, ground.y, ground.z, 1.0, 0.05, 0.7, { yaw });
    batch.box(mats.steelPost, ground.x, ground.y, ground.z, 0.09, hubY + 0.05, 0.09, {
      yaw,
      cast: true,
      tag: { surface: 'metal' },
    });

    // Hub mesh: arms + hub cap in the atlas' dark cell.
    const parts = [];
    const hubG = new CylinderGeometry(0.07, 0.07, 0.05, 18);
    hubG.rotateX(Math.PI / 2);
    parts.push(mapDark(hubG, atlas));
    for (let i = 0; i < 5; i++) {
      const a = Math.PI / 2 + (i * Math.PI * 2) / 5;
      const g = mapDark(boxGeo(0.045, ARM, 0.012), atlas);
      g.translate(0, ARM / 2, -0.01);
      g.rotateZ(a - Math.PI / 2);
      parts.push(g);
    }
    this.hub = new Mesh(mergeAny(parts), atlas.material);
    this.hub.castShadow = true;
    env.parent.add(this.hub);

    const w = ctx.physics.world;
    const q = this.homeQ;
    this.body = w.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(this.centre.x, this.centre.y, this.centre.z)
        .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
        .setAngularDamping(0.12)
        .setCanSleep(false),
    );
    ctx.physics.tag(
      w.createCollider(
        RAPIER.ColliderDesc.cylinder(0.025, 0.07)
          .setRotation(rotX90())
          .setDensity(7850)
          .setCollisionGroups(STEEL_GROUPS),
        this.body,
      ),
      { surface: 'steel_target', targetId: id },
    );
    for (let i = 0; i < 5; i++) {
      const a = Math.PI / 2 + (i * Math.PI * 2) / 5;
      const zq = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), a - Math.PI / 2);
      const col = w.createCollider(
        RAPIER.ColliderDesc.cuboid(0.022, ARM / 2, 0.006)
          .setTranslation(Math.cos(a) * (ARM / 2), Math.sin(a) * (ARM / 2), -0.01)
          .setRotation({ x: zq.x, y: zq.y, z: zq.z, w: zq.w })
          .setDensity(7850)
          .setCollisionGroups(STEEL_GROUPS),
        this.body,
      );
      ctx.physics.tag(col, { surface: 'steel_target', targetId: id });
      const cell = atlas.alloc();
      const pg = plateGeometry(shapes.circle(R), T, atlas, cell, 24);
      const mesh = new Mesh(pg.geo, atlas.material);
      mesh.castShadow = true;
      const local = new Vector3(Math.cos(a) * ARM, Math.sin(a) * ARM, 0.008);
      mesh.position.copy(local);
      this.hub.add(mesh);
      const p: StarPlate = {
        id: `${id}.p${i}`,
        angle: a,
        mesh,
        cell,
        collider: null,
        body: null,
        off: false,
        fallT: -1,
        local,
      };
      this.attach(p);
      this.plates.push(p);
    }
    const anchor = w.createRigidBody(
      RAPIER.RigidBodyDesc.fixed()
        .setTranslation(this.centre.x, this.centre.y, this.centre.z)
        .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }),
    );
    w.createImpulseJoint(
      RAPIER.JointData.revolute({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }),
      anchor,
      this.body,
      true,
    );
    syncMesh(this.hub, this.body);
    env.register(
      this,
      this.plates.map((p) => p.id),
    );
  }

  private attach(p: StarPlate) {
    const { ctx } = this.env;
    p.collider = ctx.physics.world.createCollider(
      RAPIER.ColliderDesc.cylinder(T / 2, R)
        .setRotation(rotX90())
        .setTranslation(p.local.x, p.local.y, p.local.z)
        .setDensity(7850)
        .setCollisionGroups(STEEL_GROUPS),
      this.body,
    );
    ctx.physics.tag(p.collider, { surface: 'steel_target', targetId: p.id });
  }

  /** Plates still on the star. */
  remaining() {
    return this.plates.filter((p) => !p.off).length;
  }

  /** The first plate still on the star (or the hub once it's clear). */
  aimPoint() {
    const p = this.plates.find((x) => !x.off);
    const v = new Vector3();
    return p ? p.mesh.getWorldPosition(v) : this.hub.getWorldPosition(v);
  }

  onHit(hit: RayHit, dir: Vector3, energy: number): boolean {
    this.hits++;
    const pid = hit.tag.targetId;
    const plate = this.plates.find((p) => p.id === pid);
    if (plate) {
      const local = plate.mesh.worldToLocal(hit.point.clone());
      this.env.atlas.mark(plate.cell, (local.x + R) / (2 * R), (local.y + R) / (2 * R), 64 / (2 * R), energy);
    }
    this.pending.push({
      point: hit.point.clone(),
      dir: dir.clone(),
      energy,
      sub: plate ? this.plates.indexOf(plate) : -1,
    });
    emitSteelHit(this.env, pid ?? this.id, hit.point, plate ? 2 * R : 0.5, plate ? 9.5 : 12, energy);
    return true;
  }

  private process() {
    for (const h of this.pending) {
      const p = hitImpulse(h.energy, this.env.shots.massKg);
      const k = p;
      this.body.applyImpulseAtPoint({ x: h.dir.x * k, y: h.dir.y * k, z: h.dir.z * k }, h.point, true);
      const plate = h.sub !== undefined && h.sub >= 0 ? this.plates[h.sub] : undefined;
      if (plate && !plate.off && p >= PLATE_ANY.threshold) this.detach(plate, h, p);
    }
    this.pending.length = 0;
  }

  private detach(p: StarPlate, h: PendingHit, momentum: number) {
    const w = this.env.ctx.physics.world;
    p.off = true;
    p.fallT = 0;
    const pos = new Vector3(),
      q = new Quaternion();
    this.hub.updateMatrixWorld();
    p.mesh.getWorldPosition(pos);
    p.mesh.getWorldQuaternion(q);
    if (p.collider) w.removeCollider(p.collider, true);
    p.collider = null;
    this.body.recomputeMassPropertiesFromColliders();
    // Point velocity of the spinning hub + kick from the round; the plate hinge drops it forward/down.
    const ang = this.body.angvel();
    const ctr = this.body.translation();
    const r = pos.clone().sub(new Vector3(ctr.x, ctr.y, ctr.z));
    const vPoint = new Vector3(ang.x, ang.y, ang.z).cross(r);
    const plateMass = Math.PI * R * R * T * 7850;
    const kick = h.dir.clone().multiplyScalar((momentum / plateMass) * 0.9);
    const v = vPoint.add(kick).add(new Vector3(0, 0.4, 0));
    p.body = w.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(pos.x, pos.y, pos.z)
        .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
        .setLinvel(v.x, v.y, v.z)
        .setAngvel({
          x: (Math.random() - 0.5) * 14,
          y: (Math.random() - 0.5) * 8,
          z: (Math.random() - 0.5) * 14,
        })
        .setLinearDamping(0.1)
        .setAngularDamping(0.5),
    );
    const col = w.createCollider(
      RAPIER.ColliderDesc.cylinder(T / 2, R)
        .setRotation(rotX90())
        .setDensity(7850)
        .setFriction(0.8)
        .setCollisionGroups(STEEL_GROUPS),
      p.body,
    );
    this.env.ctx.physics.tag(col, { surface: 'steel_target', targetId: p.id });
    this.hub.remove(p.mesh);
    this.env.parent.add(p.mesh);
    p.mesh.position.copy(pos);
    p.mesh.quaternion.copy(q);
  }

  fixedUpdate(dt: number) {
    this.process();
    for (const p of this.plates) {
      if (p.fallT < 0 || !p.body) continue;
      p.fallT += dt;
      const t = p.body.translation();
      if (t.y < this.ground.y + 0.25 || p.fallT > 0.8) {
        p.fallT = -1;
        this.env.ctx.bus.emit('steelFall', { point: new Vector3(t.x, t.y, t.z), targetId: p.id });
        if (this.remaining() === 0) this.down = true;
      }
    }
  }

  update() {
    this.process();
    syncMesh(this.hub, this.body);
    for (const p of this.plates) if (p.body) syncMesh(p.mesh, p.body);
  }

  /** Plate `i` (0..4) is off the star. */
  plateDown(id: string) {
    const p = this.plates.find((x) => x.id === id);
    return !!p && p.off && p.fallT < 0;
  }

  reset() {
    const w = this.env.ctx.physics.world;
    this.hits = 0;
    this.down = false;
    for (const p of this.plates) {
      if (p.body) w.removeRigidBody(p.body);
      p.body = null;
      if (p.off) {
        this.env.parent.remove(p.mesh);
        this.hub.add(p.mesh);
        p.mesh.position.copy(p.local);
        p.mesh.quaternion.identity();
        this.attach(p);
      }
      p.off = false;
      p.fallT = -1;
      this.env.atlas.repaint(p.cell);
    }
    this.body.recomputeMassPropertiesFromColliders();
    const q = this.homeQ;
    this.body.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true);
    this.body.setTranslation({ x: this.centre.x, y: this.centre.y, z: this.centre.z }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
  }
}

function rotX90() {
  const h = Math.SQRT1_2;
  return { x: h, y: 0, z: 0, w: h };
}
