import { Group, Mesh, Object3D } from 'three';
import { BUILD_KEY_PREFIX } from '../attachments/apply';
import {
  computeStats,
  defaultBuild,
  layoutBuild,
  resolveBuild,
  validateBuild,
  type AimMode,
} from '../attachments/build';
import { PLATFORMS } from '../attachments/catalog';
import { PRESETS } from '../attachments/presets';
import type {
  ForegripPart,
  LightPart,
  OpticPart,
  SlingPart,
  WeaponBuild,
  WeaponId,
} from '../attachments/types';
import { Ctx, type BuildOptions, type PartName, type SocketName } from './core';
import { triangles } from './geom';
import { buildAK } from './parts/ak';
import { buildAR } from './parts/ar';
import { buildGlock } from './parts/glock';
import { buildMP5 } from './parts/mp5';
import {
  buisFront,
  buisRear,
  foregrip,
  laser,
  light,
  magnifier,
  offsetDot,
  primaryOptic,
  sling,
} from './parts/optics';

export type { BuildOptions, PartName, SocketName } from './core';
export { setWeaponEnvMap, weaponMaterials } from './materials';

export interface SightLine {
  mode: AimMode;
  /** At the rear of the sight on its optical axis; local -z looks downrange, local +y is the sight's up. */
  node: Object3D;
}

/**
 * Procedural weapon model. See ./README.md for the full contract.
 * Coordinates: -z forward (muzzle), y up, origin at the grip, metres; bore axis at y = `boreY`.
 */
export interface WeaponModel {
  root: Group;
  /** Local z of the muzzle tip (legacy field; prefer `sockets.muzzle`). */
  muzzleZ: number;
  /** Primary sight axis height above the origin (legacy). */
  sightY: number;
  weapon: WeaponId;
  build: WeaponBuild;
  boreY: number;
  /** Named, animatable parts positioned at their pivots (always present for the platform; may be empty). */
  parts: Partial<Record<PartName, Object3D>>;
  /** Attachment / hand sockets. */
  sockets: Partial<Record<SocketName, Object3D>>;
  /** One per aim mode, in cycle order. */
  sightLines: SightLine[];
  /** Overall length (m) in the current stock position. */
  length: number;
  massKg: number;
  /** Draw calls (meshes) and triangles for perf budgeting. */
  stats: { drawCalls: number; triangles: number };
  dispose(): void;
}

const LEGACY: Record<string, WeaponId> = { ar: 'sb16', pdw: 'hb300', ak: 'k47s', pistol: 'p17', smg: 'kp9' };

/** Resolve a model key: weapon id, preset id, legacy key, or `build:{json}` (from `applyBuild`). */
export function buildFromKey(key: string): WeaponBuild {
  if (key.startsWith(BUILD_KEY_PREFIX)) return JSON.parse(key.slice(BUILD_KEY_PREFIX.length)) as WeaponBuild;
  if (PRESETS[key]) return PRESETS[key];
  const id = (LEGACY[key] ?? key) as WeaponId;
  if (PLATFORMS[id]) return defaultBuild(id);
  return defaultBuild('sb16');
}

export function buildModel(key: string | WeaponBuild, opts?: BuildOptions): WeaponModel {
  return buildModelFromBuild(typeof key === 'string' ? buildFromKey(key) : key, opts);
}

export function buildModelFromBuild(build: WeaponBuild, opts: BuildOptions = {}): WeaponModel {
  const errors = validateBuild(build);
  if (errors.length)
    throw new Error(`invalid ${build.weapon} build: ${errors.map((e) => e.message).join('; ')}`);
  const r = resolveBuild(build);
  const l = layoutBuild(r);
  const c = new Ctx(r, l, opts);
  const pd = r.platform;

  if (pd.platform === 'ar') buildAR(c);
  else if (pd.platform === 'ak') buildAK(c);
  else if (pd.platform === 'mp5') buildMP5(c);
  else buildGlock(c);

  if (pd.platform !== 'glock') {
    const optic = r.parts.optic as OpticPart | undefined;
    if (optic && l.optic) primaryOptic(c, optic, l.optic);
    if (l.magnifier) magnifier(c, l.magnifier);
    if (l.offset) offsetDot(c, l.offset);
    if (l.buisRear) buisRear(c, l.buisRear);
    if (l.buisFront) buisFront(c, l.buisFront);
    if (r.parts.light) light(c, r.parts.light as LightPart);
    if (r.parts.laser) laser(c, r.parts.laser as LightPart);
    if (r.parts.foregrip) foregrip(c, r.parts.foregrip as ForegripPart);
    if (r.parts.sling) sling(c, r.parts.sling as SlingPart, pd.frame.receiverRearZ);
    const top = l.rails[0];
    const opt = l.optic ?? (top ? { z0: top.z0, z1: top.z0 - 0.05, railY: top.y } : undefined);
    if (opt) c.socket('optic', [0, opt.railY, (opt.z0 + opt.z1) / 2]);
    if (top) {
      const oz = l.offset ? (l.offset.z0 + l.offset.z1) / 2 : (opt ? opt.z1 : top.z0) - 0.02;
      c.socket('offsetOptic', [0.008, top.y - 0.002, oz], [0, 0, -Math.PI / 4]);
    }
  }
  c.socket('gripLeft', l.supportHand);

  const root = new Group();
  root.name = `weapon:${build.weapon}`;
  const parts = c.finish(root);
  const partsRec: Partial<Record<PartName, Object3D>> = Object.fromEntries(parts);

  const sockets: Partial<Record<SocketName, Object3D>> = {};
  for (const [name, s] of c.sockets) {
    const o = new Object3D();
    o.name = `socket:${name}`;
    o.position.copy(s.pos);
    if (s.rot) o.rotation.set(...s.rot);
    const parent = s.parent ? parts.get(s.parent) : undefined;
    if (parent) {
      o.position.sub(parent.position);
      parent.add(o);
    } else root.add(o);
    sockets[name] = o;
  }
  const sightParent = pd.platform === 'glock' ? parts.get('slide') : undefined;
  const sightLines: SightLine[] = l.aimModes.map((mode) => {
    const o = new Object3D();
    o.name = `sight:${mode.id}`;
    o.position.set(...mode.point);
    o.rotation.z = mode.roll;
    o.userData.mode = mode;
    if (sightParent) {
      o.position.sub(sightParent.position);
      sightParent.add(o);
    } else root.add(o);
    return { mode, node: o };
  });

  let drawCalls = 0,
    tris = 0;
  root.traverse((o) => {
    const m = o as Mesh;
    if (!m.isMesh) return;
    drawCalls++;
    tris += triangles(m.geometry);
    m.castShadow = false;
    m.receiveShadow = false;
    m.frustumCulled = false;
  });

  const stats = computeStats(r);
  const primary = l.aimModes[0];
  return {
    root,
    muzzleZ: l.muzzleTipZ,
    sightY: primary ? primary.point[1] : c.B + 0.03,
    weapon: build.weapon,
    build,
    boreY: c.B,
    parts: partsRec,
    sockets,
    sightLines,
    length: stats.length,
    massKg: stats.mass,
    stats: { drawCalls, triangles: tris },
    dispose() {
      root.traverse((o) => {
        const m = o as Mesh;
        if (m.isMesh) m.geometry.dispose();
      });
    },
  };
}
