import {
  CanvasTexture,
  Color,
  DoubleSide,
  EquirectangularReflectionMapping,
  MeshBasicMaterial,
  MeshStandardMaterial,
  RepeatWrapping,
  SRGBColorSpace,
  ShaderChunk,
  Vector2,
  type Material,
  type Texture,
} from 'three';
import type { Finish } from '../attachments/types';

/**
 * Shared PBR materials for every weapon (one instance per finish across all weapons, so batching and
 * shader programs are shared). Detail comes from small generated canvas textures: a height-noise normal
 * map (stipple / grain / cast texture) and a roughness variation map. All weapon geometry is given
 * box-projected UVs in metres × UV_SCALE, so texel density is constant across parts.
 */
export const UV_SCALE = 32; // 1 texture tile ≈ 3 cm

type Kind = 'fine' | 'stipple' | 'cast' | 'wood' | 'brushed';

function rand(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function canvas(size: number) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return c;
}

/** Tileable height field → tangent-space normal map. */
function heightField(kind: Kind, size: number, seed: number): Float32Array {
  const r = rand(seed);
  const h = new Float32Array(size * size);
  const splat = (n: number, rad: number, amp: number) => {
    for (let i = 0; i < n; i++) {
      const cx = r() * size,
        cy = r() * size,
        a = amp * (r() * 0.6 + 0.4) * (r() < 0.5 ? -1 : 1);
      const R = Math.ceil(rad);
      for (let dy = -R; dy <= R; dy++)
        for (let dx = -R; dx <= R; dx++) {
          const d2 = (dx * dx + dy * dy) / (rad * rad);
          if (d2 > 1) continue;
          const x = (Math.floor(cx) + dx + size) % size;
          const y = (Math.floor(cy) + dy + size) % size;
          h[y * size + x] += a * (1 - d2) * (1 - d2);
        }
    }
  };
  if (kind === 'stipple') {
    splat(5200, 2.2, 1);
    splat(500, 3.5, 0.25);
  } else if (kind === 'cast') {
    splat(3000, 1.6, 0.7);
    splat(400, 6, 0.35);
  } else if (kind === 'fine') {
    splat(2600, 1.2, 0.5);
    splat(200, 8, 0.25);
  } else if (kind === 'brushed') {
    for (let y = 0; y < size; y++) {
      let v = 0;
      const base = (r() - 0.5) * 0.6;
      for (let x = 0; x < size; x++) {
        v += (r() - 0.5) * 0.25;
        v *= 0.97;
        h[y * size + x] = base + v;
      }
    }
  } else if (kind === 'wood') {
    // Long grain streaks along u (model z on the sides), gentle seamless wobble, per-row fibre noise.
    const rows = new Float32Array(size);
    for (let y = 0; y < size; y++) rows[y] = r();
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const u = x / size,
          v = y / size;
        const w = Math.sin(u * 6.283) * 0.04 + Math.sin(u * 6.283 * 2 + 1.3) * 0.02;
        const ring = Math.sin((v * 5 + w) * 6.283) * 0.5 + Math.sin((v * 13 + w * 2) * 6.283) * 0.2;
        const fibre = (rows[y] - 0.5) * 0.35 + (rows[(y + 1) % size] - 0.5) * 0.2;
        h[y * size + x] = ring * 0.4 + fibre + (r() - 0.5) * 0.05;
      }
  }
  return h;
}

function normalTex(kind: Kind, strength: number, seed: number, size = 256): Texture {
  const h = heightField(kind, size, seed);
  const c = canvas(size);
  const g = c.getContext('2d')!;
  const img = g.createImageData(size, size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const hx = h[y * size + ((x + 1) % size)] - h[y * size + ((x - 1 + size) % size)];
      const hy = h[((y + 1) % size) * size + x] - h[((y - 1 + size) % size) * size + x];
      let nx = -hx * strength,
        ny = -hy * strength;
      const nz = 1;
      const l = Math.hypot(nx, ny, nz);
      nx /= l;
      ny /= l;
      const i = (y * size + x) * 4;
      img.data[i] = (nx * 0.5 + 0.5) * 255;
      img.data[i + 1] = (ny * 0.5 + 0.5) * 255;
      img.data[i + 2] = (nz / l) * 0.5 * 255 + 127;
      img.data[i + 3] = 255;
    }
  g.putImageData(img, 0, 0);
  const t = new CanvasTexture(c);
  t.wrapS = t.wrapT = RepeatWrapping;
  return t;
}

/** Roughness variation (green channel used by three) with smudges / wear. */
function roughTex(base: number, vary: number, seed: number, size = 128): Texture {
  const r = rand(seed);
  const c = canvas(size);
  const g = c.getContext('2d')!;
  const v = Math.round(base * 255);
  g.fillStyle = `rgb(${v},${v},${v})`;
  g.fillRect(0, 0, size, size);
  for (let i = 0; i < 220; i++) {
    const k = Math.round((base + (r() - 0.5) * vary * 2) * 255);
    g.fillStyle = `rgba(${k},${k},${k},${0.08 + r() * 0.12})`;
    const s = 4 + r() * 22;
    g.beginPath();
    g.ellipse(r() * size, r() * size, s, s * (0.3 + r()), r() * 3, 0, 6.283);
    g.fill();
  }
  const t = new CanvasTexture(c);
  t.wrapS = t.wrapT = RepeatWrapping;
  return t;
}

function woodTex(seed: number, light: string, dark: string, size = 256): Texture {
  const h = heightField('wood', size, seed);
  const c = canvas(size);
  const g = c.getContext('2d')!;
  const img = g.createImageData(size, size);
  const a = new Color(light),
    b = new Color(dark);
  const r = rand(seed + 7);
  for (let i = 0; i < size * size; i++) {
    const t = Math.min(1, Math.max(0, h[i] * 0.9 + 0.5 + (r() - 0.5) * 0.08));
    img.data[i * 4] = (a.r + (b.r - a.r) * t) * 255;
    img.data[i * 4 + 1] = (a.g + (b.g - a.g) * t) * 255;
    img.data[i * 4 + 2] = (a.b + (b.b - a.b) * t) * 255;
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new CanvasTexture(c);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.colorSpace = SRGBColorSpace;
  return t;
}

/** Soft studio/overcast equirect so metals read even in scenes without an environment map. */
function envTex(): Texture {
  const w = 256,
    h = 128;
  const c = canvas(w);
  c.height = h;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, '#d9dde2');
  grad.addColorStop(0.35, '#9aa0a6');
  grad.addColorStop(0.5, '#6d6a64');
  grad.addColorStop(0.56, '#3a3631');
  grad.addColorStop(1, '#1b1a18');
  g.fillStyle = grad;
  g.fillRect(0, 0, w, h);
  // A couple of soft "windows"/softboxes for specular highlights along bevels.
  g.fillStyle = 'rgba(255,255,255,0.75)';
  g.fillRect(30, 14, 46, 26);
  g.fillRect(150, 10, 70, 18);
  g.fillStyle = 'rgba(255,250,240,0.4)';
  g.fillRect(100, 40, 30, 12);
  const t = new CanvasTexture(c);
  t.mapping = EquirectangularReflectionMapping;
  t.colorSpace = SRGBColorSpace;
  return t;
}

export interface WeaponMaterials {
  /** Receiver/handguard finish (anodized or cerakote) by finish. */
  finish: Record<Finish, MeshStandardMaterial>;
  phosphate: MeshStandardMaterial;
  blued: MeshStandardMaterial;
  steel: MeshStandardMaterial;
  polymer: MeshStandardMaterial;
  polymerFde: MeshStandardMaterial;
  /** Stippled grip panel: polymer with a stronger texture (same draw call). */
  polymerGrip: MeshStandardMaterial;
  polymerFdeGrip: MeshStandardMaterial;
  rubber: MeshStandardMaterial;
  wood: MeshStandardMaterial;
  bakelite: MeshStandardMaterial;
  plum: MeshStandardMaterial;
  can: MeshStandardMaterial;
  /** Near-black matte for cut-outs, slots, bores (cheap fake holes). */
  dark: MeshStandardMaterial;
  glass: MeshStandardMaterial;
  lensCoat: MeshStandardMaterial;
  reticle: MeshBasicMaterial;
  lightLens: MeshStandardMaterial;
  white: MeshStandardMaterial;
  all: Material[];
}

let cache: WeaponMaterials | null = null;
/**
 * Material → (base material, vertex tint, stipple boost). Resolved by the geometry Collector so minor
 * materials share their base material's draw call.
 */
export const ALIASES = new Map<Material, { to: Material; tint: [number, number, number]; boost?: number }>();
let env: Texture | null = null;

function std(o: ConstructorParameters<typeof MeshStandardMaterial>[0]) {
  return new MeshStandardMaterial({ envMapIntensity: 1, vertexColors: true, ...o });
}

interface Wear {
  /** Colour/metalness/roughness of the worn edge (bare aluminium/steel under the finish). */
  color: number;
  metal: number;
  rough: number;
  /** 0..1 how much bevel edges show wear. */
  amount: number;
  /** Extra normal-map strength where the per-vertex boost is 1 (stippled grip panels). */
  boost?: number;
}

/**
 * Patch a material with cheap curvature wear and stipple boost. The geometry carries an `aux` vec2:
 * x = edge factor (from bevel normals, computed at build time), y = texture boost.
 */
function withWear(mat: MeshStandardMaterial, w: Wear) {
  const uniforms = {
    uWearColor: { value: new Color(w.color) },
    uWearMetal: { value: w.metal },
    uWearRough: { value: w.rough },
    uWearAmount: { value: w.amount },
    uBoost: { value: w.boost ?? 0 },
  };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aux;\nvarying vec2 vAux;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvAux = aux;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec2 vAux;\nuniform vec3 uWearColor;\nuniform float uWearMetal, uWearRough, uWearAmount, uBoost;',
      )
      .replace(
        '#include <color_fragment>',
        '#include <color_fragment>\nfloat wearK = clamp(vAux.x * uWearAmount, 0.0, 1.0);\ndiffuseColor.rgb = mix(diffuseColor.rgb, uWearColor, wearK);',
      )
      .replace(
        '#include <roughnessmap_fragment>',
        '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, uWearRough, wearK);',
      )
      .replace(
        '#include <metalnessmap_fragment>',
        '#include <metalnessmap_fragment>\nmetalnessFactor = mix(metalnessFactor, uWearMetal, wearK);',
      )
      .replace(
        '#include <normal_fragment_maps>',
        ShaderChunk.normal_fragment_maps.replace(
          'mapN.xy *= normalScale;',
          'mapN.xy *= normalScale * (1.0 + vAux.y * uBoost);',
        ),
      );
  };
  mat.customProgramCacheKey = () => 'weaponWear';
  return mat;
}

export function weaponMaterials(): WeaponMaterials {
  if (cache) return cache;
  const fine = normalTex('fine', 1.6, 11);
  const stipple = normalTex('stipple', 2.4, 23);
  const cast = normalTex('cast', 2.0, 31);
  const brushed = normalTex('brushed', 1.2, 41);
  const woodN = normalTex('wood', 0.8, 53);
  const rAnod = roughTex(0.45, 0.1, 3);
  const rCera = roughTex(0.6, 0.1, 5);
  const rPoly = roughTex(0.74, 0.08, 7);
  const ns = (s: number) => new Vector2(s, s);
  const alu = { color: 0x8e9196, metal: 0.85, rough: 0.38 };
  const bareSteel = { color: 0x7d8086, metal: 0.9, rough: 0.34 };
  // Black anodize is a dyed oxide layer: optically a near-black dielectric with a satin sheen.
  const anod = (color: number, amount: number) =>
    withWear(
      std({
        color,
        metalness: 0.08,
        roughness: 1,
        roughnessMap: rAnod,
        normalMap: fine,
        normalScale: ns(0.22),
      }),
      { ...alu, amount },
    );
  const cera = (color: number) =>
    withWear(
      std({
        color,
        metalness: 0.02,
        roughness: 1,
        roughnessMap: rCera,
        normalMap: cast,
        normalScale: ns(0.2),
      }),
      { ...alu, amount: 0.45 },
    );
  const poly = (color: number) =>
    withWear(
      std({
        color,
        metalness: 0,
        roughness: 1,
        roughnessMap: rPoly,
        normalMap: stipple,
        normalScale: ns(0.14),
      }),
      { color: 0x3a3a3a, metal: 0, rough: 0.55, amount: 0.25, boost: 3.2 },
    );
  const m: Omit<WeaponMaterials, 'all'> = {
    finish: {
      black: anod(0x353637, 0.55),
      grey: anod(0x56585b, 0.5),
      fde: cera(0x7e735f),
      od: cera(0x4e5140),
    },
    phosphate: withWear(
      std({
        color: 0x2e2f30,
        metalness: 0.3,
        roughness: 1,
        roughnessMap: roughTex(0.6, 0.1, 9),
        normalMap: cast,
        normalScale: ns(0.22),
      }),
      { ...bareSteel, amount: 0.6 },
    ),
    blued: withWear(
      std({
        color: 0x25272a,
        metalness: 0.55,
        roughness: 1,
        roughnessMap: roughTex(0.42, 0.12, 13),
        normalMap: fine,
        normalScale: ns(0.16),
      }),
      { ...bareSteel, amount: 0.7 },
    ),
    steel: std({
      color: 0x8d9095,
      metalness: 0.9,
      roughness: 0.32,
      normalMap: brushed,
      normalScale: ns(0.12),
    }),
    polymer: poly(0x1d1d1e),
    polymerFde: poly(0x77695a),
    polymerGrip: std({ color: 0xffffff }), // alias marker → polymer with stipple boost
    polymerFdeGrip: std({ color: 0xffffff }),
    rubber: std({ color: 0x121212, metalness: 0, roughness: 0.92 }),
    wood: std({
      color: 0xffffff,
      map: woodTex(61, '#a26c3e', '#552c14'),
      metalness: 0,
      roughness: 0.5,
      normalMap: woodN,
      normalScale: ns(0.12),
    }),
    bakelite: std({
      color: 0xffffff,
      metalness: 0,
      roughness: 0.38,
      map: woodTex(71, '#8e5636', '#4a2618'),
      normalMap: fine,
      normalScale: ns(0.09),
    }),
    plum: std({ color: 0x5a2a28, metalness: 0, roughness: 0.6, normalMap: stipple, normalScale: ns(0.16) }),
    can: std({ color: 0x2a2a29 }),
    dark: std({ color: 0x050505, metalness: 0, roughness: 1, envMapIntensity: 0 }),
    glass: std({
      color: 0x0d1418,
      metalness: 1,
      roughness: 0.04,
      transparent: true,
      opacity: 0.32,
      depthWrite: false,
      side: DoubleSide,
      envMapIntensity: 1.6,
    }),
    lensCoat: std({
      color: 0x4a2c6a,
      metalness: 1,
      roughness: 0.06,
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
      side: DoubleSide,
      envMapIntensity: 1.8,
    }),
    reticle: new MeshBasicMaterial({ color: new Color(4, 0.25, 0.15), toneMapped: false }),
    lightLens: std({
      color: 0xdfe6ea,
      emissive: 0x99a2a6,
      emissiveIntensity: 0.35,
      metalness: 0.2,
      roughness: 0.1,
    }),
    white: std({ color: 0xd8d4c8, metalness: 0, roughness: 0.6 }),
  };
  for (const t of [fine, stipple, cast, brushed, woodN, rAnod, rCera, rPoly]) t.repeat.set(1, 1);
  const all: Material[] = [...Object.values(m.finish)];
  for (const [k, v] of Object.entries(m)) if (k !== 'finish') all.push(v as Material);
  cache = { ...m, all };
  // Minor materials ride along in a base material's draw call, tinted by vertex colour.
  ALIASES.set(m.dark, { to: m.phosphate, tint: [0.05, 0.05, 0.05] });
  ALIASES.set(m.can, { to: m.phosphate, tint: [0.85, 0.85, 0.83] });
  ALIASES.set(m.rubber, { to: m.polymer, tint: [0.6, 0.6, 0.6], boost: 0.6 });
  ALIASES.set(m.polymerGrip, { to: m.polymer, tint: [1, 1, 1], boost: 1 });
  ALIASES.set(m.polymerFdeGrip, { to: m.polymerFde, tint: [1, 1, 1], boost: 1 });
  ALIASES.set(m.glass, { to: m.lensCoat, tint: [0.3, 0.42, 0.42] });
  ALIASES.set(m.white, { to: m.steel, tint: [1, 1, 1] });
  setWeaponEnvMap(envTex());
  return cache;
}

/**
 * Environment used for weapon reflections. Defaults to a generated soft studio gradient; the renderer may
 * pass the scene's PMREM/HDRI (or null to fall back to `scene.environment`).
 */
export function setWeaponEnvMap(tex: Texture | null) {
  env = tex;
  for (const m of KIT_MATERIALS) {
    m.envMap = env;
    m.needsUpdate = true;
  }
  if (!cache) return;
  for (const m of cache.all) {
    if (m instanceof MeshStandardMaterial) {
      m.envMap = env;
      m.needsUpdate = true;
    }
  }
}

/** Kit (GLB) materials that follow `setWeaponEnvMap` too. */
export const KIT_MATERIALS = new Set<MeshStandardMaterial>();

/** The current weapon reflection environment (generated studio map unless the level set one). */
export function weaponEnvMap(): Texture | null {
  weaponMaterials();
  return env;
}

export function finishMaterial(f: Finish) {
  return weaponMaterials().finish[f];
}
