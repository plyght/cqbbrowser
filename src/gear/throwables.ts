import {
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
  type BufferGeometry,
  type PerspectiveCamera,
} from 'three';
import type { Context } from '../core/Context';
import { RAPIER } from '../physics/Physics';
import { GROUP_DEBRIS, GROUP_PLAYER } from '../player/Player';
import { boxGeo, mergeAny, tint } from '../world/geo';
import { Fuse, FUSE_S } from './flash';

const DEBRIS_GROUPS = (GROUP_DEBRIS << 16) | (0xffff & ~GROUP_PLAYER);
/** Hold this long and the spoon flies while the bang is still in your hand (cooking). */
export const COOK_AT = 1.15;
/** Shorter than this = underhand roll along the floor; longer winds up an overhand throw. */
export const UNDERHAND_MAX = 0.3;
const WINDUP = 0.5;
const MAX_LIVE = 8;

export interface ThrowSpec {
  /** 0..1 overhand power (ignored for underhand). */
  power?: number;
  underhand?: boolean;
  /** Training flash-bang simulator: reduced charge, no scorch. */
  training?: boolean;
  /** Seconds already cooked off the fuse. */
  cooked?: number;
  /** Bypass the inventory (drills). */
  free?: boolean;
}

export interface SpawnSpec {
  pos: Vector3;
  vel: Vector3;
  spin?: Vector3;
  fuse?: number;
  training?: boolean;
}

interface Live {
  root: Group;
  body: RAPIER.RigidBody;
  fuse: Fuse;
  prev: Vector3;
  training: boolean;
  spent: boolean;
  age: number;
  smokeT: number;
  lastBounce: number;
}

interface Spoon {
  mesh: Mesh;
  pos: Vector3;
  vel: Vector3;
  spin: Vector3;
  floor: number;
  life: number;
  landed: boolean;
}

/** Pure throw kinematics: launch velocity in world space from the look basis and how long the button was held. */
export function throwVelocity(
  held: number,
  fwd: Vector3,
  up: Vector3,
  out = new Vector3(),
): { vel: Vector3; underhand: boolean; power: number } {
  const underhand = held < UNDERHAND_MAX;
  if (underhand) {
    // Bowled along the floor: mostly horizontal, a little down, ~4.5 m/s.
    const flat = new Vector3(fwd.x, 0, fwd.z);
    if (flat.lengthSq() < 1e-6) flat.set(0, 0, -1);
    flat.normalize();
    out.copy(flat).multiplyScalar(4.6).setY(-0.6);
    return { vel: out, underhand, power: 0 };
  }
  const power = Math.min(1, (held - UNDERHAND_MAX) / WINDUP);
  const speed = 7 + 8 * power;
  // Release a little above the line of sight (lob).
  out.copy(fwd).addScaledVector(up, 0.14).normalize().multiplyScalar(speed);
  return { vel: out, underhand, power };
}

let geoCache: BufferGeometry | null = null;
let matCache: MeshStandardMaterial | null = null;
let spoonGeo: BufferGeometry | null = null;

/** M84-ish: olive perforated steel body, grey fuse head, spoon down the side. Local +y = fuse end. */
function grenadeMesh() {
  if (!geoCache) {
    const body = tint(new CylinderGeometry(0.022, 0.022, 0.1, 14), 0x4b5039);
    const bands = [-0.035, 0, 0.035].map((y) => {
      const g = tint(new CylinderGeometry(0.0225, 0.0225, 0.008, 14), 0x23251d);
      g.translate(0, y, 0);
      return g;
    });
    const head = tint(new CylinderGeometry(0.013, 0.016, 0.026, 10), 0x7a7b78);
    head.translate(0, 0.063, 0);
    const spoon = tint(boxGeo(0.012, 0.085, 0.004), 0x5a5f46);
    spoon.translate(0, 0.03, 0.0245);
    geoCache = mergeAny([body, ...bands, head, spoon]);
    matCache = new MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.35 });
  }
  const m = new Mesh(geoCache, matCache!);
  m.castShadow = true;
  return m;
}

function spoonMesh() {
  spoonGeo ??= tint(boxGeo(0.012, 0.085, 0.004), 0x5a5f46);
  return new Mesh(spoonGeo, matCache!);
}

/**
 * Throwables: the flashbang inventory, the throw gesture (press = pull the pin, hold = wind up, release =
 * throw; tap = underhand roll; hold past COOK_AT = the spoon flies and it cooks in hand), Rapier-simulated
 * bouncing bodies with surface-aware bounce foley, fuse timing and the spent bodies smoking on the floor.
 * Detonation effects are the owner's (`onDetonate`).
 */
export class Throwables {
  count = 2;
  readonly live: Live[] = [];
  private spoons: Spoon[] = [];
  private hand: { t: number; fuse: Fuse; training: boolean } | null = null;
  onDetonate: (p: Vector3, training: boolean, inHand: boolean) => void = () => {};
  onSmoke: (p: Vector3, age: number) => void = () => {};
  private v1 = new Vector3();
  private v2 = new Vector3();
  private v3 = new Vector3();
  private q = new Quaternion();
  private down = new Vector3(0, -1, 0);

  constructor(
    private ctx: Context,
    private exclude: () => RAPIER.RigidBody | undefined,
    private velocityOf: () => Vector3,
  ) {}

  get holding() {
    return !!this.hand;
  }

  /** Seconds the current throw has been held (0 = nothing in hand). */
  get heldFor() {
    return this.hand?.t ?? 0;
  }

  get cooking() {
    return !!this.hand?.fuse.armed;
  }

  /** Where the support hand holds it: off the left shoulder, in front of the chest. */
  handPos(cam: PerspectiveCamera, out = new Vector3()) {
    cam.updateMatrixWorld();
    return out.set(-0.22, -0.16, -0.22).applyMatrix4(cam.matrixWorld);
  }

  /** Input: call every frame with the throw button state. */
  input(down: boolean, pressed: boolean, cam: PerspectiveCamera) {
    if (pressed && !this.hand && this.count > 0) {
      this.hand = { t: 0, fuse: new Fuse(FUSE_S), training: false };
      this.ctx.bus.emit('gearSound', { kind: 'pin', point: this.handPos(cam) });
    }
    if (this.hand && !down) {
      const h = this.hand;
      this.hand = null;
      this.count = Math.max(0, this.count - 1);
      this.launch(cam, h.t, h.fuse, h.training);
    }
  }

  /** Programmatic throw from the player (drills, tests): spoon off at release unless `cooked`. */
  throw(cam: PerspectiveCamera, spec: ThrowSpec = {}) {
    if (!spec.free) {
      if (this.count <= 0) return false;
      this.count--;
    }
    const held = spec.underhand ? 0 : UNDERHAND_MAX + WINDUP * (spec.power ?? 0.6);
    const f = new Fuse(FUSE_S);
    if (spec.cooked) {
      f.arm();
      f.remaining -= spec.cooked;
    }
    this.launch(cam, held, f, !!spec.training);
    return true;
  }

  private launch(cam: PerspectiveCamera, held: number, fuse: Fuse, training: boolean) {
    const fwd = this.v1.set(0, 0, -1).applyQuaternion(cam.quaternion);
    const up = this.v2.set(0, 1, 0).applyQuaternion(cam.quaternion);
    const { vel, underhand } = throwVelocity(held, fwd, up, new Vector3());
    vel.add(this.velocityOf());
    const pos = this.handPos(cam, new Vector3());
    if (underhand) pos.addScaledVector(up, -0.55).addScaledVector(fwd, 0.25);
    // Don't spawn inside a wall: pull back along the ray from the camera if something's in the way.
    const toHand = this.v3.copy(pos).sub(cam.position);
    const len = toHand.length();
    const hit = this.ctx.physics.raycast(cam.position, toHand.normalize(), len + 0.05, this.exclude());
    if (hit) pos.copy(cam.position).addScaledVector(toHand, Math.max(0, hit.distance - 0.06));
    const right = new Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
    const spin = underhand
      ? right.clone().multiplyScalar(-14)
      : right.clone().multiplyScalar(-9 - Math.random() * 5);
    if (!fuse.armed) {
      fuse.arm();
      this.flingSpoon(pos, vel);
    }
    this.ctx.bus.emit('gearSound', { kind: 'throw', point: pos.clone(), speed: vel.length() });
    this.spawn({ pos, vel, spin, fuse: fuse.remaining, training }, fuse, underhand ? right : undefined);
  }

  /** Spawn a live device (drill hook: scripted throws, a flash-bang simulator dropped through a door, …). */
  spawn(s: SpawnSpec, fuse?: Fuse, axis?: Vector3) {
    const f = fuse ?? new Fuse(s.fuse ?? FUSE_S);
    if (!f.armed) f.arm();
    const root = new Group();
    root.add(grenadeMesh());
    // Underhand rolls go out lying on their side (local y across the roll direction).
    if (axis) this.q.setFromUnitVectors(new Vector3(0, 1, 0), axis);
    else this.q.setFromAxisAngle(new Vector3(1, 0, 0), 0.3);
    root.position.copy(s.pos);
    root.quaternion.copy(this.q);
    const w = this.ctx.physics.world;
    const spin = s.spin ?? new Vector3(8, 0, 2);
    const body = w.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(s.pos.x, s.pos.y, s.pos.z)
        .setRotation({ x: this.q.x, y: this.q.y, z: this.q.z, w: this.q.w })
        .setLinvel(s.vel.x, s.vel.y, s.vel.z)
        .setAngvel({ x: spin.x, y: spin.y, z: spin.z })
        .setCcdEnabled(true)
        .setLinearDamping(0.04)
        .setAngularDamping(0.6),
    );
    const c = w.createCollider(
      RAPIER.ColliderDesc.cylinder(0.055, 0.022)
        .setMass(0.236)
        .setRestitution(0.32)
        .setFriction(0.55)
        .setCollisionGroups(DEBRIS_GROUPS),
      body,
    );
    this.ctx.physics.tag(c, { surface: 'metal' });
    this.ctx.scene.add(root);
    this.live.push({
      root,
      body,
      fuse: f,
      prev: s.vel.clone(),
      training: !!s.training,
      spent: false,
      age: 0,
      smokeT: 0,
      lastBounce: -1,
    });
    while (this.live.length > MAX_LIVE) this.remove(this.live.find((l) => l.spent) ?? this.live[0]);
  }

  private flingSpoon(pos: Vector3, vel: Vector3) {
    if (!matCache) grenadeMesh();
    const mesh = spoonMesh();
    mesh.position.copy(pos);
    this.ctx.scene.add(mesh);
    const hit = this.ctx.physics.raycast(pos, this.down, 3, this.exclude());
    this.spoons.push({
      mesh,
      pos: pos.clone(),
      vel: vel
        .clone()
        .multiplyScalar(0.3)
        .add(new Vector3((Math.random() - 0.5) * 2, 2.2, (Math.random() - 0.5) * 2)),
      spin: new Vector3(Math.random() * 30, Math.random() * 30, Math.random() * 30),
      floor: hit ? hit.point.y + 0.002 : pos.y - 1.4,
      life: 0,
      landed: false,
    });
    this.ctx.bus.emit('gearSound', { kind: 'spoon', point: pos.clone() });
  }

  private remove(l: Live) {
    this.ctx.physics.world.removeRigidBody(l.body);
    this.ctx.scene.remove(l.root);
    this.live.splice(this.live.indexOf(l), 1);
  }

  /** Clear devices on the floor (drill reset) and restock. */
  reset(count: number) {
    while (this.live.length) this.remove(this.live[0]);
    for (const s of this.spoons) this.ctx.scene.remove(s.mesh);
    this.spoons.length = 0;
    this.hand = null;
    this.count = count;
  }

  /** Fixed step (before the physics step): fuses, cook-off in hand, bounce detection. */
  fixedUpdate(dt: number, cam: PerspectiveCamera) {
    if (this.hand) {
      const h = this.hand;
      h.t += dt;
      if (!h.fuse.armed && h.t >= COOK_AT) {
        h.fuse.arm();
        this.flingSpoon(this.handPos(cam, new Vector3()), this.velocityOf());
      }
      if (h.fuse.update(dt)) {
        // Held too long.
        this.hand = null;
        this.count = Math.max(0, this.count - 1);
        this.onDetonate(this.handPos(cam, new Vector3()), h.training, true);
      }
    }
    for (const l of [...this.live]) {
      l.age += dt;
      const t = l.body.translation();
      if (!l.spent && l.fuse.update(dt)) {
        l.spent = true;
        this.onDetonate(new Vector3(t.x, t.y, t.z), l.training, false);
        // Spent body: scorched, smoking.
        const m = l.root.children[0] as Mesh;
        m.material = spentMaterial();
      }
      if (l.spent) {
        l.smokeT -= dt;
        if (l.smokeT <= 0 && l.fuse.remaining > -4) {
          this.onSmoke(new Vector3(t.x, t.y + 0.04, t.z), -l.fuse.remaining);
          l.smokeT = 0.09;
        }
        l.fuse.remaining -= dt;
        if (l.age > 40) this.remove(l);
      }
      if (l.body.isSleeping()) continue;
      const v = l.body.linvel();
      const dv = Math.hypot(v.x - l.prev.x, v.y - l.prev.y, v.z - l.prev.z);
      if (dv > 0.8 && l.age - l.lastBounce > 0.06) {
        l.lastBounce = l.age;
        const p = new Vector3(t.x, t.y, t.z);
        const hit = this.ctx.physics.raycast(p, this.down, 0.25, l.body);
        this.ctx.bus.emit('gearSound', {
          kind: 'bounce',
          point: p,
          surface: hit?.tag.surface ?? 'concrete',
          speed: dv,
        });
      }
      l.prev.set(v.x, v.y, v.z);
    }
  }

  /** Per frame: sync meshes, animate flying spoons. */
  update(dt: number) {
    for (const l of this.live) {
      const t = l.body.translation();
      const r = l.body.rotation();
      l.root.position.set(t.x, t.y, t.z);
      l.root.quaternion.set(r.x, r.y, r.z, r.w);
    }
    for (let i = this.spoons.length - 1; i >= 0; i--) {
      const s = this.spoons[i];
      s.life += dt;
      if (!s.landed) {
        s.vel.y -= 9.81 * dt;
        s.pos.addScaledVector(s.vel, dt);
        s.mesh.rotation.x += s.spin.x * dt;
        s.mesh.rotation.y += s.spin.y * dt;
        s.mesh.rotation.z += s.spin.z * dt;
        if (s.pos.y <= s.floor) {
          s.pos.y = s.floor;
          s.landed = true;
          s.mesh.rotation.set(Math.PI / 2, s.mesh.rotation.y, 0);
          this.ctx.bus.emit('gearSound', { kind: 'spoon', point: s.pos.clone(), speed: 1 });
        }
        s.mesh.position.copy(s.pos);
      }
      if (s.life > 30) {
        this.ctx.scene.remove(s.mesh);
        this.spoons.splice(i, 1);
      }
    }
  }
}

let spent: MeshStandardMaterial | null = null;
function spentMaterial() {
  spent ??= new MeshStandardMaterial({ vertexColors: true, color: 0x6a665e, roughness: 0.8, metalness: 0.2 });
  return spent;
}
