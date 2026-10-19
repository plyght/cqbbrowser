import { CylinderGeometry, Mesh, Quaternion, Vector3, type Object3D } from 'three';
import type { Context } from '../../core/Context';
import { RAPIER } from '../../physics/Physics';
import { boxGeo, mergeAny, tint } from '../geo';
import type { Materials } from '../materials';
import type { Portal } from './layout';

export interface DoorSpec {
  id: string;
  /** World position of the hinge axis at floor level. */
  hinge: Vector3;
  /** Yaw of the closed slab: local +x runs from hinge to latch. */
  yaw: number;
  /** +1 swings toward local +z, -1 toward -z. */
  swing: 1 | -1;
  width: number;
  height: number;
  open?: number;
}

const OPEN_ANGLE = Math.PI / 2 - 0.08;

/**
 * Hollow-core interior door on a Rapier revolute hinge. `interact` toggles it (motor-driven),
 * and walking into it from the push side shoves it open.
 */
export class Door {
  readonly id: string;
  readonly mesh: Mesh;
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  private joint: RAPIER.RevoluteImpulseJoint;
  private baseQ: Quaternion;
  private motorT = 0;
  private motorTarget = 0;
  portal?: Portal;
  private width: number;
  private swing: 1 | -1;

  constructor(ctx: Context, mats: Materials, parent: Object3D, spec: DoorSpec) {
    this.id = spec.id;
    this.width = spec.width;
    this.swing = spec.swing;
    const w = spec.width - 0.02,
      h = spec.height - 0.03,
      t = 0.035;
    // Slab + lever handles both sides, one vertex-coloured mesh.
    const slab = tint(boxGeo(w, h, t), 0xd9d3c4);
    slab.translate(w / 2 + 0.006, h / 2 + 0.022, 0);
    const parts = [slab];
    for (const side of [-1, 1]) {
      const rose = tint(new CylinderGeometry(0.03, 0.03, 0.012, 12), 0x6b6b68);
      rose.rotateX(Math.PI / 2);
      rose.translate(w - 0.065, 0.98, side * (t / 2 + 0.006));
      const lever = tint(boxGeo(0.11, 0.018, 0.018), 0x777774);
      lever.translate(w - 0.11, 0.98, side * (t / 2 + 0.03));
      parts.push(rose, lever);
    }
    const hingeKnuckles = [0.2, h / 2, h - 0.2].map((y) => {
      const k = tint(new CylinderGeometry(0.008, 0.008, 0.09, 6), 0x55554f);
      k.translate(0, y, 0);
      return k;
    });
    parts.push(...hingeKnuckles);
    this.mesh = new Mesh(mergeAny(parts), mats.door);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    parent.add(this.mesh);

    const wd = ctx.physics.world;
    this.baseQ = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), spec.yaw);
    const q = this.baseQ;
    const p = spec.hinge;
    this.body = wd.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(p.x, p.y, p.z)
        .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
        .setAngularDamping(3.5)
        .setLinearDamping(2)
        .setCanSleep(true),
    );
    this.collider = wd.createCollider(
      RAPIER.ColliderDesc.cuboid(w / 2, h / 2, t / 2)
        .setTranslation(w / 2 + 0.006, h / 2 + 0.022, 0)
        .setDensity(380)
        .setFriction(0.3),
      this.body,
    );
    ctx.physics.tag(this.collider, { surface: 'wood', penetrable: 0.035 });
    const anchor = wd.createRigidBody(
      RAPIER.RigidBodyDesc.fixed()
        .setTranslation(p.x, p.y, p.z)
        .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }),
    );
    this.joint = wd.createImpulseJoint(
      RAPIER.JointData.revolute({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }),
      anchor,
      this.body,
      true,
    ) as RAPIER.RevoluteImpulseJoint;
    // Rotation about +y by +a moves local +x toward -z, so a +z swing is a negative angle.
    if (spec.swing > 0) this.joint.setLimits(-OPEN_ANGLE, 0);
    else this.joint.setLimits(0, OPEN_ANGLE);
    // Latched closed (or held at its initial angle) by a soft motor until someone pushes it.
    this.setOpen(spec.open ?? 0);
    this.sync();
  }

  /** Signed hinge angle. */
  angle() {
    const r = this.body.rotation();
    const rel = this.baseQ
      .clone()
      .invert()
      .multiply(new Quaternion(r.x, r.y, r.z, r.w));
    return 2 * Math.atan2(rel.y, rel.w);
  }

  /** 0 closed … 1 fully open. */
  openAmount() {
    return Math.min(1, Math.abs(this.angle()) / OPEN_ANGLE);
  }

  /** Snap to an open fraction (tests, layout initial state) and hold it there. */
  setOpen(f: number) {
    const a = -this.swing * OPEN_ANGLE * Math.min(1, Math.max(0, f));
    const q = this.baseQ.clone().multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), a));
    this.body.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.hold(a);
  }

  private hold(a: number) {
    this.motorTarget = a;
    this.joint.configureMotorPosition(a, 30, 6);
  }

  /** `interact`: open if mostly closed, else close. */
  toggle() {
    const opening = this.openAmount() < 0.5;
    const target = opening ? -this.swing * OPEN_ANGLE : 0;
    this.motorTarget = target;
    this.joint.configureMotorPosition(target, 120, 18);
    this.motorT = 1.2;
    this.body.wakeUp();
  }

  /** Called each fixed step with the player's capsule (feet position + planar velocity). */
  fixedUpdate(dt: number, playerPos: Vector3, playerVel: Vector3) {
    if (this.motorT > 0) {
      this.motorT -= dt;
      if (this.motorT <= 0) this.hold(this.motorTarget === 0 ? 0 : this.angle());
    }
    // Player push: find the player in the slab's frame.
    const t = this.body.translation();
    const r = this.body.rotation();
    const q = new Quaternion(r.x, r.y, r.z, r.w);
    const inv = q.clone().invert();
    const rel = playerPos
      .clone()
      .sub(new Vector3(t.x, playerPos.y, t.z))
      .applyQuaternion(inv);
    const vLocal = playerVel.clone().applyQuaternion(inv);
    const reach = 0.3 + 0.02 + 0.09;
    if (rel.x > 0.05 && rel.x < this.width + 0.05 && Math.abs(rel.z) < reach) {
      // Moving into the slab from the side it swings away from?
      const pushSide = -this.swing; // player must stand on the side opposite the swing
      const into = -Math.sign(rel.z) * vLocal.z;
      if (Math.sign(rel.z) === pushSide && into > 0.15) {
        const omega = (into * 1.3) / Math.max(0.25, rel.x);
        // Positive local z push on the slab = negative hinge angle (see setLimits).
        const s = -this.swing * omega;
        this.body.setAngvel({ x: 0, y: s, z: 0 }, true);
        this.joint.configureMotorVelocity(0, 0.4); // free swing with a little hinge friction
        this.motorTarget = -this.swing * OPEN_ANGLE;
        this.motorT = 0.3;
      }
    }
    if (this.portal) this.portal.open = this.openAmount();
  }

  sync() {
    const t = this.body.translation();
    const r = this.body.rotation();
    this.mesh.position.set(t.x, t.y, t.z);
    this.mesh.quaternion.set(r.x, r.y, r.z, r.w);
  }
}
