import { Box3, Group, Matrix4, Object3D, Quaternion, Vector3 } from 'three';
import type { Context } from '../core/Context';
import { RAPIER } from '../physics/Physics';
import { GROUP_DEBRIS, GROUP_PLAYER } from '../player/Player';

interface Dropped {
  holder: Group;
  body: RAPIER.RigidBody;
  landed: boolean;
  prev: Vector3;
  polymer: boolean;
}

const MAX = 24;
const _p = new Vector3();
const _q = new Quaternion();
const _s = new Vector3();
const _c = new Vector3();
const _down = new Vector3(0, -1, 0);
const DEBRIS_GROUPS = (GROUP_DEBRIS << 16) | (0xffff & ~GROUP_PLAYER);

/**
 * Speed-reload mags: a copy of the gun's mag becomes a Rapier rigid body that falls, tumbles and stays on the
 * floor (visible in replays). `magDrop` fires on first contact with the surface underneath.
 */
export class DroppedMags {
  readonly items: Dropped[] = [];
  private boxes = new Map<string, Box3>();

  constructor(private ctx: Context) {}

  spawn(source: Object3D, world: Matrix4, vel: Vector3, spin: Vector3, polymer = true) {
    let box = this.boxes.get(source.uuid);
    const copy = source.clone(true);
    copy.visible = true;
    copy.position.set(0, 0, 0);
    copy.quaternion.identity();
    copy.scale.set(1, 1, 1);
    copy.updateMatrixWorld(true);
    if (!box) {
      box = new Box3().setFromObject(copy, true);
      this.boxes.set(source.uuid, box);
    }
    box.getCenter(_c);
    box.getSize(_s);
    copy.position.copy(_c).negate();
    const holder = new Group();
    holder.add(copy);
    world.decompose(_p, _q, _s.set(0, 0, 0));
    // Body sits at the mag's geometric centre.
    _p.add(_c.applyQuaternion(_q));
    holder.position.copy(_p);
    holder.quaternion.copy(_q);
    box.getSize(_s);
    const w = this.ctx.physics.world;
    const body = w.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(_p.x, _p.y, _p.z)
        .setRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w })
        .setLinvel(vel.x, vel.y, vel.z)
        .setAngvel({ x: spin.x, y: spin.y, z: spin.z })
        .setCcdEnabled(true)
        .setLinearDamping(0.05)
        .setAngularDamping(0.4),
    );
    const c = w.createCollider(
      RAPIER.ColliderDesc.cuboid(
        Math.max(0.006, _s.x / 2),
        Math.max(0.006, _s.y / 2),
        Math.max(0.006, _s.z / 2),
      )
        .setMass(polymer ? 0.14 : 0.2)
        .setRestitution(0.22)
        .setFriction(0.85)
        .setCollisionGroups(DEBRIS_GROUPS),
      body,
    );
    this.ctx.physics.tag(c, { surface: polymer ? 'concrete' : 'metal' });
    this.ctx.scene.add(holder);
    this.items.push({ holder, body, landed: false, prev: vel.clone(), polymer });
    if (this.items.length > MAX) this.remove(this.items[0]);
  }

  private remove(d: Dropped) {
    this.ctx.physics.world.removeRigidBody(d.body);
    this.ctx.scene.remove(d.holder);
    this.items.splice(this.items.indexOf(d), 1);
  }

  clear() {
    while (this.items.length) this.remove(this.items[0]);
  }

  /** Before the physics step: detect the first impact from the velocity change of the last step. */
  fixedUpdate() {
    for (const d of this.items) {
      if (d.landed || d.body.isSleeping()) continue;
      const v = d.body.linvel();
      const dv = Math.hypot(v.x - d.prev.x, v.y - d.prev.y, v.z - d.prev.z);
      if (dv > 0.9 && d.prev.y < -0.5) {
        d.landed = true;
        const t = d.body.translation();
        _p.set(t.x, t.y, t.z);
        const hit = this.ctx.physics.raycast(_p, _down, 0.3, d.body);
        this.ctx.bus.emit('magDrop', {
          point: _p.clone(),
          surface: hit?.tag.surface ?? 'concrete',
          polymer: d.polymer,
        });
      }
      d.prev.set(v.x, v.y, v.z);
    }
  }

  update() {
    for (const d of this.items) {
      if (d.body.isSleeping()) continue;
      const t = d.body.translation();
      const r = d.body.rotation();
      d.holder.position.set(t.x, t.y, t.z);
      d.holder.quaternion.set(r.x, r.y, r.z, r.w);
    }
  }
}
