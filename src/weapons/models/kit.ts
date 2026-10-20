import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Group,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  Quaternion,
  SRGBColorSpace,
  TextureLoader,
  Vector3,
  type Material,
  type Texture,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import catalogJson from '../../../public/assets/models/weapons/catalog.json';
import type { Layout, ResolvedBuild } from '../attachments/build';
import type { FinishPart, HandguardPart, LightPart, SlotId } from '../attachments/types';
import type { Ctx, PartName, SocketName } from './core';
import { weaponEnvMap, weaponMaterials, KIT_MATERIALS } from './materials';

/**
 * Blender-authored parts kit (tools/blender/weapons): GLB per family + catalog.json. See README.md ("Parts kit").
 * `preloadWeaponAssets()` loads every family once; afterwards `buildModel` (still synchronous) assembles builds
 * from kit nodes whenever every part of the build is in the catalog, and falls back to the procedural meshes
 * otherwise (and always in headless tests, where nothing is loaded).
 */

export type V3 = [number, number, number];

/** Collision proxy in node-local space. Boxes may be rotated about +x by `rx` (raked grips: local -y = down the grip). */
export type Proxy = { type: 'box'; c: V3; h: V3; rx?: number } | { type: 'capsule'; a: V3; b: V3; r: number };

export interface KitNode {
  family: string;
  /** Node origin (the part's pivot) in the weapon frame as authored. */
  pivot: V3;
  tris: number;
  bounds: [V3, V3];
  /** Collision proxies in node-local space (three frame, metres). */
  proxies: Proxy[];
  /** Sockets carried by the node (node-local). */
  sockets?: Record<string, V3>;
}

export interface KitEntry {
  node: string;
  /** How the node is placed: 'origin' (authored in place) or a layout anchor (see `anchorMatrix`). */
  anchor: string;
  /** Animated part the node belongs to (`WeaponModel.parts`); absent = static. */
  part?: PartName | 'hammer';
}

export interface KitMaterialDef {
  kind: 'atlas' | 'source' | 'special';
  map?: string;
  orm?: string;
  normal?: string;
  rough?: string;
  metal?: string;
  ao?: string;
  /** Finish mask in the albedo alpha. */
  mask?: 'alpha';
  /**
   * Source texture without a finish mask (e.g. the black CC0 M4 receiver): a non-black finish recolours it from
   * its luminance (detail and wear kept), as a cerakoted receiver would look.
   */
  recolor?: boolean;
}

export interface KitBase {
  nodes: KitEntry[];
  /** Weapon-frame socket positions measured on the asset (override the layout sockets). */
  sockets: Partial<Record<SocketName, V3>>;
  /** Weapon-frame overrides for layout anchors (e.g. the Krinkov's muzzle thread). */
  anchors: Record<string, V3>;
  /** Folding stock: hinge pivot (weapon frame), fold angle about +y (rad) and the folded offset. */
  fold?: { pivot: V3; angle: number; shift: V3 };
  /**
   * Weapon-frame translation of the whole asset (origin-anchored nodes, base anchors, base sockets), e.g. to put a
   * photo-traced grip where the authored hand clip already holds it. Layout-derived anchors (muzzle, optic…) follow
   * through the platform frame values instead.
   */
  offset?: V3;
  /**
   * Platform frame keys measured on this asset (they move with `offset`); omitted = every z value of the frame
   * (the P-17's frame is the asset's). E.g. the KP-9 keeps its procedural frame except the rear sight.
   */
  frameShift?: string[];
  /** Platform frame values measured on the asset (asset frame), e.g. the Krinkov's rear sight. */
  frame?: Record<string, unknown>;
  /** `frame` keys that replace the platform's when the kit is used (then moved by `offset` like the asset). */
  frameFromAsset?: string[];
}

export interface KitCatalog {
  version: number;
  families: Record<string, { glb: string; bytes?: number; materials: Record<string, KitMaterialDef> }>;
  nodes: Record<string, KitNode>;
  parts: Record<string, KitEntry[]>;
  bases: Record<string, KitBase>;
}

export const KIT = catalogJson as unknown as KitCatalog;

// ------------------------------------------------------------------ loading

interface LoadedNode {
  /** Geometry per glTF material name, in node-local space. */
  prims: { geometry: BufferGeometry; material: string }[];
  matrix: Matrix4;
}

const loaded = new Map<string, LoadedNode>();
const familyMats = new Map<string, Map<string, Material>>();
let ready = false;

/**
 * Weapons that use the kit when it is loaded (the others keep their procedural meshes). Families are switched on
 * as they pass review (now all of them); `?kit=all` turns everything on, `?kit=0` off, or a list (`?kit=p17,k47s`).
 */
const DEFAULT_KIT_WEAPONS = ['p17', 'p92', 'sb16', 'kp9', 'hb300', 'k47s'];
let kitWeapons: Set<string> | 'all' = new Set(DEFAULT_KIT_WEAPONS);
{
  const q = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('kit') : null;
  if (q === 'all') kitWeapons = 'all';
  else if (q === '0') kitWeapons = new Set();
  else if (q) kitWeapons = new Set(q.split(','));
}

/** Choose which weapons assemble from the kit (`'all'` or a list of weapon ids). */
export function setKitWeapons(w: 'all' | string[]) {
  kitWeapons = w === 'all' ? 'all' : new Set(w);
}

export function kitEnabledFor(weapon: string) {
  return kitWeapons === 'all' || kitWeapons.has(weapon);
}
let loading: Promise<void> | null = null;

/** True once the kit has been loaded (buildModel then assembles from it). */
export function weaponAssetsReady() {
  return ready;
}

/**
 * Load every kit family (GLB + atlases). Safe to call more than once; resolves when everything is in. Call at
 * boot before the first `buildModel` (Game.start, the bench). `base` prefixes asset URLs.
 */
export function preloadWeaponAssets(
  base = '',
  /** Headless (bun tools, audits): read GLB bytes from disk; textures are skipped (plain materials). */
  readFile?: (path: string) => ArrayBuffer,
): Promise<void> {
  if (loading) return loading;
  loading = (async () => {
    const [{ GLTFLoader }, { MeshoptDecoder }] = await Promise.all([
      import('three/examples/jsm/loaders/GLTFLoader.js'),
      import('three/examples/jsm/libs/meshopt_decoder.module.js'),
    ]);
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    const tex = new TextureLoader();
    const texCache = new Map<string, Promise<Texture>>();
    const loadTex = (url: string, srgb: boolean) => {
      const key = url + (srgb ? '#s' : '');
      let p = texCache.get(key);
      if (!p) {
        p = tex.loadAsync(base + url).then((t) => {
          t.flipY = false;
          if (srgb) t.colorSpace = SRGBColorSpace;
          t.anisotropy = 8;
          return t;
        });
        texCache.set(key, p);
      }
      return p;
    };
    await Promise.all(
      Object.entries(KIT.families).map(async ([fam, f]) => {
        const [gltf, mats] = readFile
          ? [
              await loader.parseAsync(readFile(base + f.glb), ''),
              new Map<string, Material>(
                Object.entries(f.materials)
                  .filter(([, d]) => d.kind !== 'special')
                  .map(([name]) => [name, new MeshStandardMaterial({ name })]),
              ),
            ]
          : await Promise.all([loader.loadAsync(base + f.glb), familyMaterials(f.materials, loadTex)]);
        familyMats.set(fam, mats);
        gltf.scene.updateMatrixWorld(true);
        gltf.scene.traverse((o) => {
          if (!KIT.nodes[o.name] || loaded.has(o.name)) return;
          const inv = new Matrix4().copy(o.matrixWorld).invert();
          const prims: LoadedNode['prims'] = [];
          o.traverse((m) => {
            const mesh = m as Mesh;
            if (!mesh.isMesh) return;
            const g = mesh.geometry.clone();
            g.applyMatrix4(new Matrix4().multiplyMatrices(inv, mesh.matrixWorld));
            const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
            prims.push({ geometry: g, material: mat.name });
          });
          loaded.set(o.name, { prims, matrix: o.matrixWorld.clone() });
        });
      }),
    );
    ready = true;
  })();
  return loading;
}

async function familyMaterials(
  defs: Record<string, KitMaterialDef>,
  loadTex: (url: string, srgb: boolean) => Promise<Texture>,
): Promise<Map<string, Material>> {
  const out = new Map<string, Material>();
  for (const [name, d] of Object.entries(defs)) {
    if (d.kind === 'special') continue;
    const m = new MeshStandardMaterial({ name, roughness: 1, metalness: 1, envMapIntensity: 1.4 });
    const [map, orm, normal, rough, metal, ao] = await Promise.all([
      d.map ? loadTex(d.map, true) : undefined,
      d.orm ? loadTex(d.orm, false) : undefined,
      d.normal ? loadTex(d.normal, false) : undefined,
      d.rough ? loadTex(d.rough, false) : undefined,
      d.metal ? loadTex(d.metal, false) : undefined,
      d.ao ? loadTex(d.ao, false) : undefined,
    ]);
    m.map = map ?? null;
    m.normalMap = normal ?? null;
    m.roughnessMap = orm ?? rough ?? null;
    m.metalnessMap = orm ?? metal ?? null;
    m.aoMap = orm ?? ao ?? null;
    m.aoMapIntensity = 1;
    if (!d.metal && !d.orm) m.metalness = 0;
    if (d.mask === 'alpha') m.userData.finishMask = true;
    if (d.recolor) m.userData.recolor = true;
    out.set(name, m);
  }
  return out;
}

// ------------------------------------------------------------------ materials (finish tint + specials)

const finishCache = new Map<string, Material>();

/** Source material recoloured to a (non-black) finish from its luminance. */
function recolored(base: Material, finish: string): Material {
  const key = base.uuid + finish + ':re';
  const m = finishCache.get(key);
  if (m) return m;
  const std = (base as MeshStandardMaterial).clone();
  const col = weaponMaterials().finish[finish as keyof ReturnType<typeof weaponMaterials>['finish']].color;
  const uFinish = { value: new Color().copy(col) };
  std.onBeforeCompile = (sh) => {
    sh.uniforms.uFinish = uFinish;
    sh.fragmentShader = sh.fragmentShader
      .replace('void main() {', 'uniform vec3 uFinish;\nvoid main() {')
      .replace(
        '#include <map_fragment>',
        [
          '#ifdef USE_MAP',
          '  vec4 sampledDiffuseColor = texture2D( map, vMapUv );',
          '  float lum = dot( sampledDiffuseColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );',
          '  diffuseColor.rgb *= uFinish * clamp( 0.6 + 6.0 * lum, 0.6, 1.5 );',
          '#endif',
        ].join('\n'),
      );
  };
  std.customProgramCacheKey = () => 'kitRecolor';
  std.envMap = weaponEnvMap();
  KIT_MATERIALS.add(std);
  finishCache.set(key, std);
  return std;
}

/** Parts that keep their own colour whatever the finish (magazines, the bolt seen through the port). */
const NO_FINISH = new Set<string>(['mag', 'bolt']);

/** Atlas material with the build's finish colour applied where the albedo alpha says so. */
function tinted(base: Material, finish: string): Material {
  if ((base as MeshStandardMaterial).userData?.recolor)
    return finish === 'black' ? base : recolored(base, finish);
  if (!(base as MeshStandardMaterial).userData?.finishMask) return base;
  const key = base.uuid + finish;
  const m = finishCache.get(key);
  if (m) return m;
  const std = (base as MeshStandardMaterial).clone();
  const col = weaponMaterials().finish[finish as keyof ReturnType<typeof weaponMaterials>['finish']].color;
  const uFinish = { value: new Color().copy(col) };
  std.onBeforeCompile = (sh) => {
    sh.uniforms.uFinish = uFinish;
    sh.fragmentShader = sh.fragmentShader
      .replace('void main() {', 'uniform vec3 uFinish;\nvoid main() {')
      .replace(
        '#include <map_fragment>',
        [
          '#ifdef USE_MAP',
          '  vec4 sampledDiffuseColor = texture2D( map, vMapUv );',
          '  diffuseColor.rgb *= sampledDiffuseColor.rgb * mix( vec3( 1.0 ), uFinish, sampledDiffuseColor.a );',
          '#endif',
        ].join('\n'),
      );
  };
  std.customProgramCacheKey = () => 'kitFinish';
  std.envMap = weaponEnvMap();
  KIT_MATERIALS.add(std);
  finishCache.set(key, std);
  return std;
}

let specials: Record<string, Material> | null = null;
function special(name: string): Material {
  if (!specials) {
    const M = weaponMaterials();
    specials = {
      glass: new MeshStandardMaterial({
        name: 'glass',
        color: 0x3a4a4e,
        metalness: 0.6,
        roughness: 0.05,
        transparent: true,
        opacity: 0.1,
        depthWrite: false,
        side: DoubleSide,
        envMap: weaponEnvMap(),
      }),
      lens: M.lensCoat,
      // HDR red (as the procedural optics) so the dot stays bright through the lens tint and auto-exposure
      reticle: M.reticle,
      lightLens: M.lightLens,
    };
    for (const m of Object.values(specials)) if (m instanceof MeshStandardMaterial) KIT_MATERIALS.add(m);
  }
  return specials[name] ?? specials.glass;
}

function materialFor(family: string, name: string, finish: string, part?: string): Material {
  const base = familyMats.get(family)?.get(name);
  if (base) {
    if (base instanceof MeshStandardMaterial && !KIT_MATERIALS.has(base)) {
      base.envMap = weaponEnvMap();
      KIT_MATERIALS.add(base);
    }
    return part && NO_FINISH.has(part) && base.userData?.recolor ? base : tinted(base, finish);
  }
  return special(name.split('.')[0]);
}

// ------------------------------------------------------------------ assembly

const SMALL = new Set(['trigger', 'safety', 'magRelease', 'boltCatch', 'dustCover', 'hammer']);

/** The handguard's accessory interface: M-LOK slots (free-float / integral) or 1913 rails (quad). */
export function hgRail(r: ResolvedBuild): 'mlok' | 'pic' {
  const s = (r.parts.handguard as HandguardPart | undefined)?.style;
  return s === 'mlok' || s === 'integral' ? 'mlok' : 'pic';
}

/** Every kit entry for a build, or null when some part has no asset (→ procedural fallback). */
export function kitEntries(r: ResolvedBuild): KitEntry[] | null {
  const base = KIT.bases[r.build.weapon];
  if (!base) return null;
  const out = [...base.nodes];
  for (const p of Object.values(r.parts)) {
    const es = KIT.parts[p.id];
    if (!es) return null;
    // `{slot}` in a node name = that slot's part id (barrel × profile variants); `{hgRail}` = the handguard's
    // accessory interface ('mlok' | 'pic') for parts that come in both mounts.
    for (const e of es)
      out.push(
        e.node.includes('{')
          ? {
              ...e,
              node: e.node.replace(/\{(\w+)\}/g, (_, s: string) =>
                s === 'hgRail' ? hgRail(r) : (r.parts[s as SlotId]?.id ?? ''),
              ),
            }
          : e,
      );
  }
  return out.every((e) => KIT.nodes[e.node] && (!ready || loaded.has(e.node))) ? out : null;
}

/**
 * The build as the kit will lay it out: when this build assembles from the kit and its base has an `offset`, the
 * platform frame's z values (`…Z` keys, nested `{ z }`) move by the offset so layout-derived anchors, sockets and
 * sight lines follow the shifted asset. Unchanged (same object) otherwise, so the procedural fallback is untouched.
 */
export function kitResolve(r: ResolvedBuild): ResolvedBuild {
  const base = KIT.bases[r.build.weapon];
  const dz = base?.offset?.[2] ?? 0;
  const fromAsset = base?.frameFromAsset ?? [];
  if ((!dz && !fromAsset.length) || !ready || !kitEnabledFor(r.build.weapon) || !kitEntries(r)) return r;
  const shift = (v: unknown, key: string): unknown => {
    if (typeof v === 'number') return key.endsWith('Z') || key === 'z' ? v + dz : v;
    if (v && typeof v === 'object' && !Array.isArray(v))
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, shift(x, k)]));
    return v;
  };
  const keys = base.frameShift;
  const f0 = {
    ...(r.platform.frame as unknown as Record<string, unknown>),
    ...Object.fromEntries(
      fromAsset.filter((k) => base.frame && k in base.frame).map((k) => [k, base.frame![k]]),
    ),
  };
  const frame = (
    keys
      ? {
          ...f0,
          ...Object.fromEntries(
            [...keys, ...fromAsset].filter((k) => k in f0).map((k) => [k, shift(f0[k], k)]),
          ),
        }
      : shift(f0, '')
  ) as typeof r.platform.frame;
  return { ...r, platform: { ...r.platform, frame } };
}

const around = (B: number, a: number, d: number): [number, number] => [Math.sin(a) * d, B + Math.cos(a) * d];

/** Model-frame placement of an anchor for this build (layout + per-base overrides). */
export function anchorMatrix(anchor: string, c: Ctx, base: KitBase): Matrix4 {
  const l: Layout = c.l;
  const m = new Matrix4();
  const o = base.offset ?? [0, 0, 0];
  const ov = base.anchors[anchor];
  if (ov) return m.makeTranslation(ov[0] + o[0], ov[1] + o[1], ov[2] + o[2]);
  const B = c.B;
  switch (anchor) {
    case 'origin':
      return m.makeTranslation(o[0], o[1], o[2]);
    case 'muzzle':
      return m.makeTranslation(0, 0, l.barrelMuzzleZ);
    case 'gas':
      return m.makeTranslation(0, 0, l.gasZ);
    case 'hgRear':
      return m.makeTranslation(0, 0, l.handguard?.z0 ?? c.r.platform.frame.receiverFrontZ);
    case 'hgFront':
      return m.makeTranslation(0, 0, l.handguard?.z1 ?? c.r.platform.frame.receiverFrontZ);
    case 'butt':
      return m.makeTranslation(0, 0, l.buttZ);
    case 'rear':
      return m.makeTranslation(0, 0, c.r.platform.frame.receiverRearZ);
    case 'optic':
    case 'magnifier':
    case 'buisRear':
    case 'buisFront': {
      const p =
        anchor === 'optic'
          ? l.optic
          : anchor === 'magnifier'
            ? l.magnifier
            : anchor === 'buisRear'
              ? l.buisRear
              : l.buisFront;
      return p ? m.makeTranslation(0, p.railY, p.z0) : m;
    }
    case 'offset': {
      const p = l.offset;
      if (!p) return m;
      const s = p.side === 'right' ? 1 : -1;
      return m
        .makeTranslation(0, p.railY - 0.005, p.z0)
        .multiply(new Matrix4().makeRotationZ((-s * Math.PI) / 4));
    }
    case 'light':
    case 'laser': {
      const lp = anchor === 'light' ? l.light : l.laser;
      if (!lp) return m;
      if (lp.side === 'bottom') return m.makeTranslation(0, base.anchors.pistolRail?.[1] ?? 0, lp.zFront);
      const s = lp.side === 'left' ? -1 : 1;
      const quad = c.hgStyle === 'quad';
      const scout = anchor === 'light' && (c.r.parts.light as LightPart | undefined)?.style === 'scout';
      const a =
        anchor === 'laser' ? -Math.PI / 2 : scout && !quad ? (s * 52 * Math.PI) / 180 : (s * Math.PI) / 2;
      const d = c.hgRadius + (anchor === 'laser' ? 0.018 : scout ? (quad ? 0.0135 : 0.0165) : 0.017);
      const [x, y] = around(B, a, d);
      return m.makeTranslation(x, y, lp.zFront).multiply(new Matrix4().makeRotationZ(-a));
    }
    case 'foregrip': {
      const z = l.foregrip?.z ?? 0;
      // On the kit handguard's own bottom face (its node bounds); the procedural radius sat 1-4 mm lower, so
      // grips floated under the kit guards.
      const hg = c.r.parts.handguard;
      const hgNode = hg ? KIT.parts[hg.id]?.[0]?.node : undefined;
      const b = hgNode ? KIT.nodes[hgNode]?.bounds : undefined;
      const y = b ? b[0][1] + o[1] : B - c.hgRadius - (c.hgStyle === 'quad' ? 0 : 0.002);
      return m.makeTranslation(0, y, z);
    }
    default:
      return m;
  }
}

/**
 * Replace the procedural meshes under `root` with kit nodes. Parts/sockets/sight lines (from the layout) stay;
 * sockets measured on the assets override the layout ones. Returns false (nothing changed) if not possible.
 */
export function assembleKit(
  c: Ctx,
  root: Group,
  parts: Map<PartName, Object3D>,
  sockets: Partial<Record<SocketName, Object3D>>,
  detailParts: boolean,
): boolean {
  if (!ready || !kitEnabledFor(c.r.build.weapon)) return false;
  const entries = kitEntries(c.r);
  const base = KIT.bases[c.r.build.weapon];
  if (!entries || !base) return false;
  const finish = (c.r.parts.finish as FinishPart | undefined)?.finish ?? 'black';

  // Drop the procedural geometry (keep groups, sockets, sight nodes).
  const old: Mesh[] = [];
  root.traverse((o) => {
    if ((o as Mesh).isMesh) old.push(o as Mesh);
  });
  for (const m of old) {
    m.geometry.dispose();
    m.removeFromParent();
  }
  const off = new Vector3(...(base.offset ?? [0, 0, 0]));
  // The asset's own hinge for a folding stock (the part group pivots there).
  const stockGroup = base.fold ? parts.get('stock') : undefined;
  if (stockGroup && base.fold) stockGroup.position.set(...base.fold.pivot).add(off);
  root.updateMatrixWorld(true);
  const rootInv = new Matrix4().copy(root.matrixWorld).invert();
  const modelOf = (o: Object3D) => new Matrix4().multiplyMatrices(rootInv, o.matrixWorld);

  // Per target group, per material: geometries in the group's local space.
  const buckets = new Map<Object3D, Map<Material, BufferGeometry[]>>();
  const overrides = new Map<string, Vector3>();
  const placed: { node: string; part?: string; matrix: Matrix4 }[] = [];
  for (const [k, v] of Object.entries(base.sockets)) overrides.set(k, new Vector3(...v).add(off));
  for (const e of entries) {
    const ln = loaded.get(e.node)!;
    const kn = KIT.nodes[e.node];
    const place = anchorMatrix(e.anchor, c, base).multiply(ln.matrix);
    let target: Object3D = root;
    const partName = e.part as PartName | undefined;
    if (partName && (detailParts || !SMALL.has(partName))) {
      let g = parts.get(partName);
      if (!g) {
        g = new Group();
        g.name = partName;
        g.position.setFromMatrixPosition(place);
        root.add(g);
        g.updateMatrixWorld(true);
        parts.set(partName, g);
      }
      target = g;
    }
    placed.push({ node: e.node, part: target === root ? undefined : partName, matrix: place.clone() });
    const local = new Matrix4().copy(modelOf(target)).invert().multiply(place);
    let byMat = buckets.get(target);
    if (!byMat) buckets.set(target, (byMat = new Map()));
    for (const p of ln.prims) {
      const mat = materialFor(kn.family, p.material, finish, partName);
      const g = p.geometry.clone().applyMatrix4(local);
      let list = byMat.get(mat);
      if (!list) byMat.set(mat, (list = []));
      list.push(g);
    }
    for (const [k, v] of Object.entries(kn.sockets ?? {}))
      overrides.set(k, new Vector3(...v).applyMatrix4(place));
  }
  for (const [target, byMat] of buckets)
    for (const [mat, list] of byMat) {
      const g = mergeGeometries(list.map(normalizeAttrs), false);
      for (const x of list) x.dispose();
      if (!g) continue;
      const mesh = new Mesh(g, mat);
      mesh.name = `kit:${mat.name || 'mat'}`;
      target.add(mesh);
    }
  if (stockGroup && base.fold && c.l.stockFolded) {
    stockGroup.rotateY(base.fold.angle);
    stockGroup.position.x += base.fold.shift[0];
    stockGroup.updateMatrixWorld(true);
  }
  // Socket overrides (positions only; rotations keep the layout's).
  for (const [k, p] of overrides) {
    let s = sockets[k as SocketName];
    if (!s) {
      s = new Object3D();
      s.name = `socket:${k}`;
      root.add(s);
      sockets[k as SocketName] = s;
    }
    const parentInv = new Matrix4().copy(modelOf(s.parent ?? root)).invert();
    s.position.copy(p).applyMatrix4(parentInv);
  }
  root.userData.kit = true;
  root.userData.kitNodes = placed;
  return true;
}

/** mergeGeometries needs identical attribute sets: keep position/normal/uv, non-indexed → indexed. */
function normalizeAttrs(g: BufferGeometry): BufferGeometry {
  for (const k of Object.keys(g.attributes))
    if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
  const n = g.attributes.position.count;
  if (!g.attributes.uv) g.setAttribute('uv', new BufferAttribute(new Float32Array(n * 2), 2));
  if (!g.attributes.normal) g.computeVertexNormals();
  if (!g.index) {
    const idx = new Uint32Array(n);
    for (let i = 0; i < n; i++) idx[i] = i;
    g.setIndex(new BufferAttribute(idx, 1));
  }
  return g;
}

/** Collision proxies of every kit node in a built model, in the weapon (model) frame. For anim/grip shapes. */
export function kitProxies(
  root: Object3D,
): { node: string; part?: string; proxies: Proxy[]; matrix: Matrix4 }[] {
  return (
    (root.userData.kitNodes as { node: string; part?: string; matrix: Matrix4 }[] | undefined) ?? []
  ).map((n) => ({ ...n, proxies: KIT.nodes[n.node]?.proxies ?? [] }));
}

/** Same shape as `CollisionProxy` (WeaponModel.collision): part frame (pivot, rest) or the weapon frame. */
export type KitCollision =
  | {
      kind: 'box';
      name: string;
      part?: PartName;
      center: V3;
      quat?: [number, number, number, number];
      half: V3;
      r: number;
    }
  | { kind: 'capsule'; name: string; part?: PartName; a: V3; b: V3; r: number };

/**
 * Collision proxies of an assembled kit model (WeaponModel.collision): every placed node's authored proxies,
 * moved into its part's frame (or the weapon frame for static nodes). Boxes get a small rounding radius.
 */
export function kitCollision(root: Object3D, parts: Partial<Record<PartName, Object3D>>): KitCollision[] {
  const placed = (root.userData.kitNodes ?? []) as { node: string; part?: PartName; matrix: Matrix4 }[];
  const out: KitCollision[] = [];
  root.updateMatrixWorld(true);
  const rootInv = new Matrix4().copy(root.matrixWorld).invert();
  const q = new Quaternion();
  const pt = (p: V3, m: Matrix4) => new Vector3(p[0], p[1], p[2]).applyMatrix4(m).toArray() as V3;
  for (const p of placed) {
    const proxies = KIT.nodes[p.node]?.proxies ?? [];
    const g = p.part ? parts[p.part] : undefined;
    const toFrame = new Matrix4().copy(p.matrix);
    if (g) toFrame.premultiply(new Matrix4().multiplyMatrices(rootInv, g.matrixWorld).invert());
    proxies.forEach((pr, i) => {
      const name = `${p.node}#${i}`;
      const part = g ? p.part : undefined;
      if (pr.type === 'capsule') {
        out.push({ kind: 'capsule', name, part, a: pt(pr.a, toFrame), b: pt(pr.b, toFrame), r: pr.r });
        return;
      }
      q.setFromRotationMatrix(new Matrix4().copy(toFrame).multiply(new Matrix4().makeRotationX(pr.rx ?? 0)));
      const half = pr.h.map((x) => Math.max(x, 1e-4)) as V3;
      out.push({
        kind: 'box',
        name,
        part,
        center: pt(pr.c, toFrame),
        quat: [q.x, q.y, q.z, q.w],
        half,
        r: Math.min(0.002, ...half),
      });
    });
  }
  return out;
}
