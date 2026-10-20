import RAPIER from '@dimforge/rapier3d-compat';
import { Vector3 } from 'three';
import type { Surface } from '../core/bus';

export { RAPIER };

export interface ColliderTag {
  surface: Surface;
  targetId?: string;
  /** Penetrable material thickness in metres (drywall/doors); 0 = stops rounds. */
  penetrable?: number;
}

export interface RayHit {
  point: Vector3;
  normal: Vector3;
  distance: number;
  collider: RAPIER.Collider;
  tag: ColliderTag;
}

export class Physics {
  world!: RAPIER.World;
  readonly tags = new Map<number, ColliderTag>();
  static readonly STEP = 1 / 60;

  async init() {
    await RAPIER.init();
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = Physics.STEP;
  }

  step() {
    this.world.step();
  }

  tag(c: RAPIER.Collider, tag: ColliderTag) {
    this.tags.set(c.handle, tag);
    return c;
  }

  tagOf(c: RAPIER.Collider): ColliderTag {
    return this.tags.get(c.handle) ?? { surface: 'concrete' };
  }

  /**
   * Ground slab (top at `y`) covering ±`extent` m, built from `tile`-sized cuboids. One huge cuboid broke the
   * character controller: on a 1 km box it lost ground contact to f32 precision, so the player sank into the
   * dirt step by step and got stuck.
   */
  ground(y: number, extent: number, tag: ColliderTag, tile = 100) {
    const h = tile / 2;
    for (let x = -extent; x < extent; x += tile)
      for (let z = -extent; z < extent; z += tile)
        this.box({ x: x + h, y: y - 0.5, z: z + h }, { x: h, y: 0.5, z: h }, tag);
  }

  /** Static axis-aligned box helper (centre + half extents). */
  box(
    center: { x: number; y: number; z: number },
    half: { x: number; y: number; z: number },
    tag: ColliderTag,
    rotY = 0,
  ) {
    const desc = RAPIER.ColliderDesc.cuboid(half.x, half.y, half.z).setTranslation(
      center.x,
      center.y,
      center.z,
    );
    if (rotY) desc.setRotation({ x: 0, y: Math.sin(rotY / 2), z: 0, w: Math.cos(rotY / 2) });
    return this.tag(this.world.createCollider(desc), tag);
  }

  raycast(
    origin: Vector3,
    dir: Vector3,
    maxDist: number,
    exclude?: RAPIER.Collider | RAPIER.RigidBody,
    filterGroups?: number,
  ): RayHit | null {
    const ray = new RAPIER.Ray(origin, dir);
    const excludeCollider = exclude && 'handle' in exclude && 'shape' in exclude ? exclude : undefined;
    const excludeBody = exclude && !excludeCollider ? (exclude as RAPIER.RigidBody) : undefined;
    const hit = this.world.castRayAndGetNormal(
      ray,
      maxDist,
      true,
      undefined,
      filterGroups,
      excludeCollider as RAPIER.Collider | undefined,
      excludeBody,
    );
    if (!hit) return null;
    const p = ray.pointAt(hit.timeOfImpact);
    return {
      point: new Vector3(p.x, p.y, p.z),
      normal: new Vector3(hit.normal.x, hit.normal.y, hit.normal.z),
      distance: hit.timeOfImpact,
      collider: hit.collider,
      tag: this.tagOf(hit.collider),
    };
  }
}
