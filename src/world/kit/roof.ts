import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  Mesh,
  ShaderMaterial,
  Vector3,
  type Object3D,
} from 'three';
import type { RAPIER } from '../../physics/Physics';
import type { StaticBatch } from '../geo';
import type { Materials } from '../materials';
import { openingSpan, wallAxis, wallOf, type Layout } from './layout';

/** Direction toward the sun (World keeps the sun at this offset from its target). */
export const SUN_DIR = new Vector3(-30, 50, 20).normalize();

export interface Footprint {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/**
 * Flat roof for a layout placed at `at`: joists (2x6) bearing on the top plates at `spacing` on centre, running
 * out to a fascia past the walls, blocking over the exterior walls (no daylight slits between joists), and one
 * plywood sheet layer on top. Returns its colliders (sheathing is penetrable; joists are solid pine).
 */
export function buildRoof(
  batch: StaticBatch,
  mats: Materials,
  layout: Layout,
  fp: Footprint,
  at: (x: number, z: number) => Vector3,
): RAPIER.Collider[] {
  const roof = layout.roof!;
  const out: RAPIER.Collider[] = [];
  const H = layout.wallHeight;
  const t = layout.wallThickness;
  const jd = roof.joistDepth;
  const ov = roof.overhang;
  const x0 = fp.minX - t / 2 - ov,
    x1 = fp.maxX + t / 2 + ov;
  const z0 = fp.minZ - t / 2 - ov,
    z1 = fp.maxZ + t / 2 + ov;
  const c = at((x0 + x1) / 2, (z0 + z1) / 2);
  const W = x1 - x0,
    D = z1 - z0;
  const ply = roof.sheathing;
  const keep = (col: RAPIER.Collider | undefined) => col && out.push(col);

  // Sheathing (one sheet layer, rounds go through).
  keep(
    batch.box(mats.plywood, c.x, H + jd, c.z, W, ply, D, {
      cast: true,
      tag: { surface: 'plywood', penetrable: ply },
    }),
  );
  // Joists across the span, from fascia to fascia.
  const alongZ = roof.span === 'z';
  const lo = alongZ ? fp.minX - t / 2 : fp.minZ - t / 2;
  const hi = alongZ ? fp.maxX + t / 2 : fp.maxZ + t / 2;
  const n = Math.max(1, Math.round((hi - lo - 0.038) / roof.spacing));
  for (let i = 0; i <= n; i++) {
    const k = lo + 0.019 + (i / n) * (hi - lo - 0.038);
    const p = alongZ ? at(k, 0) : at(0, k);
    const cx = alongZ ? p.x : c.x,
      cz = alongZ ? c.z : p.z;
    keep(
      batch.box(mats.lumber, cx, H, cz, alongZ ? 0.038 : W, jd, alongZ ? D : 0.038, {
        cast: true,
        tag: { surface: 'wood' },
      }),
    );
  }
  // Fascia boards round the eaves.
  for (const s of [-1, 1]) {
    const fz = at(0, s < 0 ? z0 + 0.0095 : z1 - 0.0095).z;
    batch.box(mats.lumber, c.x, H + 0.0, fz, W, jd, 0.019, { cast: true });
    const fx = at(s < 0 ? x0 + 0.0095 : x1 - 0.0095, 0).x;
    batch.box(mats.lumber, fx, H, c.z, 0.019, jd, D, { cast: true });
  }
  // Blocking over the exterior walls (closes the joist bays; also stops daylight slits).
  for (const w of layout.walls.filter((x) => x.exterior)) {
    const ax = wallAxis(w);
    const a = at(w.a[0], w.a[1]),
      b = at(w.b[0], w.b[1]);
    const m = a.clone().add(b).multiplyScalar(0.5);
    const len = a.distanceTo(b) + t;
    keep(
      batch.box(mats.lumber, m.x, H, m.z, ax === 'x' ? len : t, jd, ax === 'x' ? t : len, {
        cast: true,
        tag: { surface: 'wood' },
      }),
    );
  }
  return out;
}

/**
 * Faint dusty sun shafts through exterior windows that face the sun: the window rectangle swept along the
 * sun's rays down to the floor, additive, fading toward the floor patch. One small mesh per window.
 */
export function buildSunShafts(parent: Object3D, layout: Layout, at: (x: number, z: number) => Vector3) {
  const meshes: Mesh[] = [];
  const t = layout.wallThickness;
  const ray = SUN_DIR.clone().negate();
  const xs = layout.rooms.flatMap((r) => [r.min[0], r.max[0]]);
  const zs = layout.rooms.flatMap((r) => [r.min[1], r.max[1]]);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2,
    cz = (Math.min(...zs) + Math.max(...zs)) / 2;
  for (const o of layout.openings) {
    if (o.kind !== 'window') continue;
    const w = wallOf(layout, o.at);
    if (!w?.exterior) continue;
    const ax = wallAxis(w);
    const n =
      ax === 'x' ? new Vector3(0, 0, Math.sign(o.at[1] - cz)) : new Vector3(Math.sign(o.at[0] - cx), 0, 0);
    if (n.dot(SUN_DIR) < 0.1) continue;
    const along = ax === 'x' ? new Vector3(1, 0, 0) : new Vector3(0, 0, 1);
    const { bottom, top } = openingSpan(o);
    const hw = (o.width ?? 0.9) / 2;
    const base = at(o.at[0], o.at[1]).addScaledVector(n, -t / 2);
    const corners = [
      [-hw, bottom],
      [hw, bottom],
      [hw, top],
      [-hw, top],
    ].map(([s, y]) => base.clone().addScaledVector(along, s).setY(y));
    // Each corner travels along the ray to the floor.
    const floor = corners.map((p) => p.clone().addScaledVector(ray, p.y / -ray.y));
    const pos: number[] = [];
    const fade: number[] = [];
    const quad = (a: Vector3, b: Vector3, c2: Vector3, d: Vector3, fa: number[]) => {
      for (const [p, f] of [
        [a, fa[0]],
        [b, fa[1]],
        [c2, fa[2]],
        [a, fa[0]],
        [c2, fa[2]],
        [d, fa[3]],
      ] as [Vector3, number][]) {
        pos.push(p.x, p.y, p.z);
        fade.push(f);
      }
    };
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      quad(corners[i], corners[j], floor[j], floor[i], [1, 1, 0, 0]);
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
    g.setAttribute('aFade', new BufferAttribute(new Float32Array(fade), 1));
    const mesh = new Mesh(g, shaftMaterial());
    mesh.renderOrder = 5;
    mesh.frustumCulled = true;
    parent.add(mesh);
    meshes.push(mesh);
  }
  return meshes;
}

let shaftMat: ShaderMaterial | null = null;
function shaftMaterial() {
  shaftMat ??= new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
    fog: false,
    uniforms: { uColor: { value: new Vector3(1.0, 0.9, 0.74).multiplyScalar(0.07) } },
    vertexShader: /* glsl */ `
      attribute float aFade;
      varying float vFade;
      varying vec3 vW;
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        vFade = aFade;
        vec4 w = modelMatrix * vec4(position, 1.0);
        vW = w.xyz;
        vV = cameraPosition - w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      varying float vFade;
      varying vec3 vW;
      varying vec3 vV;
      float h(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
      void main() {
        // Dust: a few slowly varying blotches along the shaft; brighter near the window.
        float d = 0.75 + 0.25 * sin(vW.x * 7.0 + vW.y * 5.0) * sin(vW.z * 6.0 - vW.y * 3.0);
        float grain = 0.85 + 0.3 * h(floor(vW * 90.0));
        float a = pow(vFade, 1.6) * 0.8 + 0.2 * vFade;
        // Fade out up close so walking through it doesn't flash the screen.
        float near = smoothstep(0.25, 1.2, length(vV));
        gl_FragColor = vec4(uColor * a * d * grain * near, 1.0);
      }`,
  });
  return shaftMat;
}
