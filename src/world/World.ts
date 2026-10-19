import {
  AmbientLight,
  Color,
  DirectionalLight,
  Fog,
  Group,
  HemisphereLight,
  Mesh,
  Vector3,
  type Object3D,
} from 'three';
import type { Context, System } from '../core/Context';
import type { RAPIER, RayHit } from '../physics/Physics';
import type { Ballistics, HitListener } from '../weapons/Ballistics';
import {
  berm,
  floor,
  signBoard,
  type Facility,
  type FacilityEnv,
  type FacilityId,
  type SpawnPoint,
} from './facility';
import { StaticBatch, groundGeo } from './geo';
import { KillHouse } from './kit/KillHouse';
import layoutA from './kit/layouts/killhouseA.json';
import type { Layout, RoomGraph } from './kit/layout';
import { makeMaterials, type Materials } from './materials';
import { buildRange } from './Range';
import { SignAtlas } from './signs';
import { PaintAtlas } from './steel/paint';
import { buildSteelPark } from './SteelPark';
import { ShotTracker, type Target } from './targets';

export const KILLHOUSE_ORIGIN = new Vector3(-158, 0, -6);

export interface PlayerLike {
  position: Vector3;
  velocity: Vector3;
  rigidBody: RAPIER.RigidBody;
}

const FACILITIES: FacilityId[] = ['range', 'steel', 'killhouse'];

export function mapFromUrl(): FacilityId {
  try {
    const m = new URLSearchParams(location.search).get('map');
    return FACILITIES.includes(m as FacilityId) ? (m as FacilityId) : 'range';
  } catch {
    return 'range';
  }
}

/**
 * The Axis-7 training center: square range, steel park and Kill House A, built once at boot and laid
 * out side by side (range at the origin, steel park at x=+150, kill house at x≈-150). Only the active
 * facility is visible; the others' static colliders stay in the physics world. Owns the lights, all
 * targets (single ballistics listener that routes by collider target id) and the doors.
 */
export class World implements System, HitListener {
  readonly mats: Materials;
  readonly atlas = new PaintAtlas();
  readonly signs = new SignAtlas();
  readonly targets = new Map<string, Target>();
  private targetList: Target[] = [];
  private facilityOf = new Map<Target, FacilityId>();
  readonly facilities = {} as Record<FacilityId, Facility>;
  readonly killhouse: KillHouse;
  readonly ready: Promise<void>;
  active: FacilityId = 'range';
  private sun: DirectionalLight;
  private freeCam: { pos: Vector3; look: Vector3 } | null = null;
  private shots: ShotTracker;
  private doorByCollider = new Map<number, number>();

  constructor(
    private ctx: Context,
    ballistics: Ballistics,
    private player: PlayerLike,
    map: FacilityId = mapFromUrl(),
  ) {
    const { scene, physics } = ctx;
    this.mats = makeMaterials();
    this.shots = new ShotTracker(ctx);
    scene.background = new Color(0xaeb8c2);
    scene.fog = new Fog(0xaeb8c2, 70, 320);

    this.sun = new DirectionalLight(0xfff1dc, 3.2);
    this.sun.position.set(-30, 50, 20);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -36;
    sc.right = sc.top = 36;
    sc.near = 1;
    sc.far = 160;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.02;
    scene.add(
      this.sun,
      this.sun.target,
      new HemisphereLight(0xd6e0ea, 0x6a5f50, 1.5),
      new AmbientLight(0xffffff, 0.25),
    );

    // Global ground (one draw) + collider.
    const ground = new Mesh(groundGeo(1000, 1000, 24), this.mats.ground);
    // Slightly below the facility floors so big far-away triangles can't z-fight them.
    ground.position.y = -0.02;
    ground.receiveShadow = true;
    scene.add(ground);
    physics.box({ x: 0, y: -0.5, z: 0 }, { x: 500, y: 0.5, z: 500 }, { surface: 'dirt' });

    const envFor = (id: FacilityId): FacilityEnv & { batch: StaticBatch } => {
      const group = new Group();
      group.name = `facility:${id}`;
      scene.add(group);
      return {
        ctx,
        mats: this.mats,
        atlas: this.atlas,
        shots: this.shots,
        batch: new StaticBatch(physics),
        parent: group,
        signs: this.signs,
        register: (t, ids) => this.register(t, id, ids),
      };
    };

    const rEnv = envFor('range');
    this.facilities.range = buildRange(rEnv);
    rEnv.batch.build(rEnv.parent);

    const sEnv = envFor('steel');
    this.facilities.steel = buildSteelPark(sEnv);
    sEnv.batch.build(sEnv.parent);

    const kEnv = envFor('killhouse');
    this.killhouse = new KillHouse(kEnv, layoutA as Layout, KILLHOUSE_ORIGIN);
    this.facilities.killhouse = this.buildKillHouseSite(kEnv, this.killhouse);
    kEnv.batch.build(kEnv.parent);
    this.killhouse.doors.forEach((d, i) => this.doorByCollider.set(d.collider.handle, i));
    this.killhouse.reroll(1);

    ballistics.listeners.push(this);
    this.ready = this.mats.ready;
    this.setFacility(map);
  }

  private buildKillHouseSite(env: FacilityEnv, kh: KillHouse): Facility {
    const o = KILLHOUSE_ORIGIN;
    floor(env.batch, this.mats.gravel, o.x + 8, o.z + 7, 40, 34);
    // Earth backstop berms on the long sides (training rounds go through plywood).
    berm(env, o.x + 8, o.z - 6, 34, 8, 3.5, 1.5, 0, 21);
    berm(env, o.x - 8, o.z + 6, 30, 8, 3.5, 1.5, Math.PI / 2, 22);
    signBoard(
      env,
      {
        lines: ['KILL HOUSE A', 'AXIS-7 · LIVE FIRE PAPER ONLY', 'MUZZLE DISCIPLINE — STAY ON THE LINE'],
        bg: '#1f3b63',
        fg: '#f4f1e6',
        px: [512, 220],
      },
      new Vector3(o.x + 5.6, 0, o.z + 13.6),
      1.6,
      0.7,
      0.25,
      1.0,
    );
    signBoard(
      env,
      { lines: ['START'], bg: '#2c7a3a', fg: '#ffffff', px: [128, 64] },
      new Vector3(o.x + 9.2, 0, o.z + 14.6),
      0.4,
      0.2,
      0,
      0.6,
    );
    signBoard(
      env,
      { lines: ['FINISH'], bg: '#b3201b', fg: '#ffffff', px: [128, 64] },
      new Vector3(o.x + 18.6, 0, o.z + 4.6),
      0.4,
      0.2,
      -Math.PI / 2,
      0.6,
    );
    return {
      id: 'killhouse',
      name: kh.layout.name,
      group: env.parent as Group,
      spawns: { 'killhouse.start': { pos: kh.start.clone(), yaw: kh.startYaw } },
      defaultSpawn: 'killhouse.start',
    };
  }

  private register(t: Target, facility: FacilityId, ids?: string[]) {
    this.targets.set(t.id, t);
    for (const id of ids ?? []) this.targets.set(id, t);
    this.targetList.push(t);
    this.facilityOf.set(t, facility);
  }

  // ---- Public API -------------------------------------------------------------------------------

  /** Default spawn of the active facility (Game uses these on restart). */
  get spawn(): Vector3 {
    return this.spawnPoint().pos.clone();
  }
  get spawnYaw(): number {
    return this.spawnPoint().yaw;
  }

  spawnPoint(name?: string): SpawnPoint {
    if (name) {
      for (const f of Object.values(this.facilities)) if (f.spawns[name]) return f.spawns[name];
    }
    const f = this.facilities[this.active];
    return f.spawns[f.defaultSpawn];
  }

  /** Which facility owns a spawn point name. */
  facilityOfSpawn(name: string): FacilityId | undefined {
    return FACILITIES.find((id) => this.facilities[id].spawns[name]);
  }

  setFacility(id: FacilityId) {
    this.active = id;
    for (const f of FACILITIES) this.facilities[f].group.visible = f === id;
  }

  /** All targets (unique), optionally in one facility. */
  list(facility?: FacilityId): Target[] {
    return this.targetList.filter((t) => !facility || this.facilityOf.get(t) === facility);
  }

  /** Targets whose id matches a pattern: exact id, or a prefix ending in `*`. */
  select(patterns: string[]): Target[] {
    const out = new Set<Target>();
    for (const p of patterns) {
      if (p.endsWith('*')) {
        const pre = p.slice(0, -1);
        for (const t of this.targetList) if (t.id.startsWith(pre)) out.add(t);
      } else {
        const t = this.targets.get(p);
        if (t) out.add(t);
      }
    }
    return [...out];
  }

  /** Reset (repaint, re-stand, re-hang) targets — the active facility's, or all. */
  reset(facility: FacilityId | 'all' = this.active) {
    for (const t of this.targetList) if (facility === 'all' || this.facilityOf.get(t) === facility) t.reset();
    if (facility === 'all' || facility === 'killhouse') this.killhouse.resetDoors();
  }

  /** Audio room/portal graph (Kill House A; outdoor facilities are a single open space). Portals are live. */
  roomGraph(): RoomGraph {
    return this.killhouse.graph;
  }

  door(id: string) {
    return this.killhouse.doors.find((d) => d.id === id);
  }

  /** Test/replay hook: override the camera with a free camera (null restores the body cam). */
  setFreeCam(pos: Vector3 | null, look?: Vector3) {
    this.freeCam = pos ? { pos: pos.clone(), look: (look ?? new Vector3()).clone() } : null;
  }

  /** Test hook: fire one round from `from` toward `to` as weapon `weaponId` through the real ballistics. */
  testShot(from: Vector3, to: Vector3, weaponId = 'p17') {
    const dir = to.clone().sub(from).normalize();
    this.ctx.bus.emit('shot', { weaponId, origin: from.clone(), dir, suppressed: false, caliber: '' });
  }

  // ---- HitListener ------------------------------------------------------------------------------

  onHit(hit: RayHit, dir: Vector3, energy: number): boolean {
    const id = hit.tag.targetId;
    if (id) {
      const t = this.targets.get(id);
      if (t) return t.onHit(hit, dir, energy);
    }
    const di = this.doorByCollider.get(hit.collider.handle);
    if (di !== undefined) {
      const d = this.killhouse.doors[di];
      d.body.applyImpulseAtPoint({ x: dir.x * 0.6, y: 0, z: dir.z * 0.6 }, hit.point, true);
    }
    return false;
  }

  // ---- System -----------------------------------------------------------------------------------

  fixedUpdate(dt: number) {
    for (const t of this.targetList) t.fixedUpdate?.(dt);
    this.killhouse.fixedUpdate(dt, this.player.position, this.player.velocity);
  }

  update(dt: number, alpha: number) {
    const f = this.ctx.input.frame;
    if (f.pressed.has('interact')) this.tryInteract();
    for (const t of this.targetList) t.update?.(dt, alpha);
    this.killhouse.update();
    this.atlas.flush();

    const cam = this.ctx.camera;
    if (this.freeCam) {
      cam.position.copy(this.freeCam.pos);
      cam.lookAt(this.freeCam.look);
      cam.updateMatrixWorld();
    }
    // Shadow frustum follows the camera (snapped to texels to avoid shimmer).
    const snap = (72 / 2048) * 4;
    const cx = Math.round(cam.position.x / snap) * snap,
      cz = Math.round(cam.position.z / snap) * snap;
    const fwd = new Vector3(0, 0, -1).applyQuaternion(cam.quaternion).setY(0).normalize().multiplyScalar(16);
    const tx = cx + Math.round(fwd.x / snap) * snap,
      tz = cz + Math.round(fwd.z / snap) * snap;
    this.sun.target.position.set(tx, 0, tz);
    this.sun.position.set(tx - 30, 50, tz + 20);
    this.sun.target.updateMatrixWorld();
  }

  private tryInteract() {
    const cam = this.ctx.camera;
    const dir = new Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    const hit = this.ctx.physics.raycast(cam.position, dir, 2.2, this.player.rigidBody);
    if (!hit) return;
    const di = this.doorByCollider.get(hit.collider.handle);
    if (di !== undefined) this.killhouse.doors[di].toggle();
  }

  /** Every mesh root (for debugging / draw-call accounting). */
  roots(): Object3D[] {
    return FACILITIES.map((f) => this.facilities[f].group);
  }
}
