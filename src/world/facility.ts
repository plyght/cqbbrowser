import { Matrix4, Vector3, type Group, type Material } from 'three';
import type { StaticBatch } from './geo';
import { bermGeometry, groundGeo, trimeshCollider } from './geo';
import type { SignAtlas } from './signs';
import type { TargetEnv } from './targets';

export type FacilityId = 'range' | 'steel' | 'killhouse';

export interface SpawnPoint {
  pos: Vector3;
  yaw: number;
}

export interface Facility {
  id: FacilityId;
  name: string;
  group: Group;
  spawns: Record<string, SpawnPoint>;
  defaultSpawn: string;
}

export interface FacilityEnv extends TargetEnv {
  signs: SignAtlas;
}

/** Earth berm placed in the world: visual into the batch, trimesh collider for rounds and feet. */
export function berm(
  env: FacilityEnv,
  x: number,
  z: number,
  length: number,
  width: number,
  height: number,
  top: number,
  rotY = 0,
  seed = 1,
) {
  const g = bermGeometry(length, width, height, top, seed);
  const m = new Matrix4().makeRotationY(rotY).setPosition(x, 0, z);
  g.applyMatrix4(m);
  trimeshCollider(env.ctx.physics, g, { surface: 'berm' });
  // UVs were authored in local metres; world-rotated berms still tile correctly.
  env.batch.add(g, env.mats.berm, undefined, { cast: true });
}

export function floor(
  batch: StaticBatch,
  mat: Material,
  cx: number,
  cz: number,
  w: number,
  d: number,
  y = 0.004,
) {
  batch.add(groundGeo(w, d), mat, new Matrix4().makeTranslation(cx, y, cz));
}

/** Wooden shooting box: four 2x4s on the ground, 1 x 1 m. */
export function shootingBox(env: FacilityEnv, x: number, z: number, size = 1) {
  const { batch, mats } = env;
  const h = 0.04;
  batch.box(mats.paintWhite, x, 0.06, z - size / 2, size, h, 0.09);
  batch.box(mats.paintWhite, x, 0.06, z + size / 2, size, h, 0.09);
  batch.box(mats.paintWhite, x - size / 2, 0.06, z, 0.09, h, size);
  batch.box(mats.paintWhite, x + size / 2, 0.06, z, 0.09, h, size);
}

/** Sign board on two posts (or one), front facing yaw. */
export function signBoard(
  env: FacilityEnv,
  spec: Parameters<SignAtlas['draw']>[0],
  pos: Vector3,
  w: number,
  h: number,
  yaw = 0,
  postH = 1.0,
) {
  const { batch, mats, signs } = env;
  const c = Math.cos(yaw),
    s = Math.sin(yaw);
  const twoPosts = w > 0.7;
  for (const k of twoPosts ? [-1, 1] : [0]) {
    const off = k * (w / 2 - 0.06);
    batch.box(
      mats.woodStand,
      pos.x + c * off - s * 0.04,
      0,
      pos.z - s * off - c * 0.04,
      0.07,
      postH + h,
      0.07,
      { yaw },
    );
  }
  batch.box(mats.woodStand, pos.x, postH, pos.z, w + 0.04, h + 0.04, 0.025, { yaw });
  signs.place(
    batch,
    spec,
    new Vector3(pos.x + s * 0.014, postH + h / 2 + 0.02, pos.z + c * 0.014),
    w,
    h,
    yaw,
  );
}
