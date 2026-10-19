import {
  MeshStandardMaterial,
  SRGBColorSpace,
  TextureLoader,
  type Material,
  type Object3D,
  type Texture,
} from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

/**
 * Loading of the two CC-BY BURNER source packs (see assets/ATTRIBUTION.md). The GLBs carry no
 * textures: materials are matched by name and get their WebP maps here (flipY = false, glTF UVs).
 */
export const SOURCE_URLS = {
  ak: 'assets/models/ak74u/ak74u.glb',
  beretta: 'assets/models/beretta/beretta.glb',
} as const;
export type SourceId = keyof typeof SOURCE_URLS;

interface MatMaps {
  map?: string;
  normalMap?: string;
  roughnessMap?: string;
  metalnessMap?: string;
  aoMap?: string;
}

const AK = 'assets/models/ak74u/';
const BER = 'assets/models/beretta/';
export const SOURCE_MATERIALS: Record<string, MatMaps> = {
  Krinkov: {
    map: AK + 'Krinkov_Color.webp',
    normalMap: AK + 'Krinkov_NRM.webp',
    roughnessMap: AK + 'Krinkov_Rough.webp',
    metalnessMap: AK + 'Krinkov_Metal.webp',
    aoMap: AK + 'Krinkov_AO.webp',
  },
  Magazine: {
    map: AK + 'Magazine_Color.webp',
    normalMap: AK + 'Magazine_NRM.webp',
    roughnessMap: AK + 'Magazine_Rough.webp',
    metalnessMap: AK + 'Magazine_Metal.webp',
  },
  Ch08_body: {
    map: AK + 'Ch08_1001_Diffuse.webp',
    normalMap: AK + 'Ch08_1001_Normal.webp',
    roughnessMap: AK + 'Ch08_1001_Rough.webp',
  },
  Ch08_body1: {
    map: AK + 'Ch08_1002_Diffuse.webp',
    normalMap: AK + 'Ch08_1002_Normal.webp',
    roughnessMap: AK + 'Ch08_1002_Rough.webp',
  },
  beretta: {
    map: BER + 'berettaColor.webp',
    normalMap: BER + 'berettaNormal.webp',
    roughnessMap: BER + 'berettaRoughness.webp',
    metalnessMap: BER + 'berettaMetallic.webp',
    aoMap: BER + 'berettaAO.webp',
  },
  TEXTURA: { map: BER + 'TEXTURA.webp', normalMap: BER + 'TEXTURA_NORMAL.webp' },
};

const texCache = new Map<string, Promise<Texture>>();
let base = '';
/** Prefix for asset URLs (the pages live at the site root; tests may override). */
export function setAssetBase(b: string) {
  base = b;
}

export function loadTexture(url: string, srgb = false): Promise<Texture> {
  const key = url + (srgb ? '#srgb' : '');
  let p = texCache.get(key);
  if (!p) {
    p = new TextureLoader().loadAsync(base + url).then((t) => {
      t.flipY = false;
      if (srgb) t.colorSpace = SRGBColorSpace;
      t.anisotropy = 4;
      return t;
    });
    texCache.set(key, p);
  }
  return p;
}

/** Fresh PBR material for a source material name (textures shared/cached). */
export async function sourceMaterial(name: string): Promise<MeshStandardMaterial> {
  const spec = SOURCE_MATERIALS[name];
  const m = new MeshStandardMaterial({ name, roughness: 1, metalness: spec?.metalnessMap ? 1 : 0 });
  if (!spec) return m;
  const [map, normalMap, roughnessMap, metalnessMap, aoMap] = await Promise.all([
    spec.map ? loadTexture(spec.map, true) : undefined,
    spec.normalMap ? loadTexture(spec.normalMap) : undefined,
    spec.roughnessMap ? loadTexture(spec.roughnessMap) : undefined,
    spec.metalnessMap ? loadTexture(spec.metalnessMap) : undefined,
    spec.aoMap ? loadTexture(spec.aoMap) : undefined,
  ]);
  Object.assign(m, { map, normalMap, roughnessMap, metalnessMap, aoMap });
  if (!spec.roughnessMap) m.roughness = 0.75;
  return m;
}

const gltfCache = new Map<string, Promise<GLTF>>();
export function loadSourceGltf(id: SourceId): Promise<GLTF> {
  let p = gltfCache.get(id);
  if (!p) {
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    p = loader.loadAsync(base + SOURCE_URLS[id]);
    gltfCache.set(id, p);
  }
  return p;
}

/** Give every mesh under `root` its textured source material (in place). */
export async function texturePack(root: Object3D): Promise<void> {
  const jobs: Promise<void>[] = [];
  root.traverse((o) => {
    const mesh = o as Object3D & { isMesh?: boolean; material?: Material | Material[] };
    if (!mesh.isMesh || !mesh.material) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    jobs.push(
      Promise.all(mats.map((m) => sourceMaterial(m.name))).then((ms) => {
        mesh.material = Array.isArray(mesh.material) ? ms : ms[0];
      }),
    );
  });
  await Promise.all(jobs);
}
