import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  DynamicDrawUsage,
  InstancedMesh,
  LatheGeometry,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  Vector2,
  Vector3,
  Vector4,
  type Material,
  type Mesh,
  type Object3D,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { resolveBuild } from '../attachments/build';
import type { WeaponModel } from './index';
import { magInfo, sliceAt, type MagInfo } from './magGeom';
import { KIT_MATERIALS, weaponEnvMap } from './materials';

/**
 * Rounds inside the magazine: one instanced round mesh per calibre (brass case + projectile, lathed, vertex
 * colours: one draw call for the whole stack) laid along the mag's own rear-wall curve (`magGeom.ts`), staggered
 * where the mag is double-stack, the top round at the feed lips. Only the rounds that exist are drawn (`set(n)`):
 * the spring pushes the stack up, so a part-empty mag shows the top round at the lips and empty witness holes below.
 *
 * The mag's own material (cloned per mag) gets real openings: the top is open between the feed lips, witness holes
 * / the PMAG window are cut where the real mag has them (fragments discarded in the mag frame), and the inside of
 * the shell renders as a dark cavity (double-sided, back faces darkened), so the rounds read through the openings.
 */

export type CaliberId = '9mm' | '5.56' | '5.45' | '300blk' | '7.62x39';

interface RoundSpec {
  /** Case head (rim) diameter, case length, overall length (m). */
  head: number;
  caseLen: number;
  oal: number;
  /** Lathe profile (r, z) along the axis from the case head (z = 0) to the nose. Case points then bullet points. */
  caseProfile: [number, number][];
  bulletProfile: [number, number][];
  caseColor: number;
  bulletColor: number;
}

const MM = 0.001;

/** Bottleneck rifle case: head, extractor groove, body taper, shoulder, neck. */
function bottleneck(
  head: number,
  body: number,
  shoulder: number,
  neck: number,
  caseLen: number,
  neckLen: number,
) {
  const r = (d: number) => (d / 2) * MM;
  const L = caseLen * MM;
  const s = L - neckLen * MM - 0.002;
  return [
    [0, 0],
    [r(head), 0],
    [r(head), 0.0012],
    [r(head) * 0.82, 0.0016],
    [r(head) * 0.82, 0.0026],
    [r(body), 0.0032],
    [r(shoulder), s],
    [r(neck), s + 0.002],
    [r(neck), L],
  ] as [number, number][];
}

/** Ogive projectile from the case mouth (z = caseLen) to the tip at oal. */
function ogive(dia: number, caseLen: number, oal: number, tip: number, shank: number) {
  const R = (dia / 2) * MM;
  const z0 = caseLen * MM;
  const z1 = oal * MM;
  const zs = z0 + shank * MM;
  const pts: [number, number][] = [
    [R * 0.98, z0 - 0.0005],
    [R, z0],
    [R, zs],
  ];
  for (let i = 1; i <= 5; i++) {
    const u = i / 5;
    const r = R * Math.sqrt(Math.max(0, 1 - u * u)) * (1 - tip) + R * tip * (1 - u);
    pts.push([Math.max(r, i === 5 ? R * tip * 0.6 : 0), zs + (z1 - zs) * u]);
  }
  pts.push([0, z1]);
  return pts;
}

const BRASS = 0xc9a24f;
const COPPER = 0xb8734a;
const STEEL_CASE = 0x6e6648;

const SPECS: Record<CaliberId, RoundSpec> = {
  // 9x19: straight-walled, round-nose FMJ.
  '9mm': {
    head: 9.96 * MM,
    caseLen: 19.15 * MM,
    oal: 29.7 * MM,
    caseProfile: [
      [0, 0],
      [4.98 * MM, 0],
      [4.98 * MM, 0.0011],
      [4.2 * MM, 0.0015],
      [4.2 * MM, 0.0024],
      [4.95 * MM, 0.003],
      [4.83 * MM, 19.15 * MM],
    ],
    bulletProfile: ogive(9.02, 19.15, 29.7, 0.18, 1.2),
    caseColor: BRASS,
    bulletColor: COPPER,
  },
  // 5.56x45: long slim case, spitzer.
  '5.56': {
    head: 9.6 * MM,
    caseLen: 44.7 * MM,
    oal: 57.4 * MM,
    caseProfile: bottleneck(9.6, 9.58, 9.0, 6.43, 44.7, 5.5),
    bulletProfile: ogive(5.7, 44.7, 57.4, 0.08, 1.0),
    caseColor: BRASS,
    bulletColor: COPPER,
  },
  // 5.45x39: lacquered steel case.
  '5.45': {
    head: 10 * MM,
    caseLen: 39.8 * MM,
    oal: 57 * MM,
    caseProfile: bottleneck(10, 10, 9.25, 6.3, 39.8, 5),
    bulletProfile: ogive(5.6, 39.8, 57, 0.06, 4),
    caseColor: STEEL_CASE,
    bulletColor: COPPER,
  },
  // .300 BLK subsonic: the 5.56 case cut short and necked up (fat neck), long heavy projectile.
  '300blk': {
    head: 9.6 * MM,
    caseLen: 34.7 * MM,
    oal: 56 * MM,
    caseProfile: bottleneck(9.6, 9.58, 9.1, 8.4, 34.7, 7),
    bulletProfile: ogive(7.82, 34.7, 56, 0.07, 6),
    caseColor: BRASS,
    bulletColor: COPPER,
  },
  // 7.62x39: tapered steel case.
  '7.62x39': {
    head: 11.35 * MM,
    caseLen: 38.7 * MM,
    oal: 56 * MM,
    caseProfile: bottleneck(11.35, 11.3, 10.07, 8.6, 38.7, 6),
    bulletProfile: ogive(7.92, 38.7, 56, 0.07, 4),
    caseColor: STEEL_CASE,
    bulletColor: COPPER,
  },
};

export function caliberId(c: string): CaliberId {
  if (c === '5.56' || c === '5.45' || c === '300blk' || c === '7.62x39') return c;
  if (/5\.45/.test(c)) return '5.45';
  if (/300/.test(c)) return '300blk';
  if (/7\.62/.test(c)) return '7.62x39';
  if (/5\.56|223/.test(c)) return '5.56';
  return '9mm';
}

const SEGS = 9;
const geoCache = new Map<CaliberId, BufferGeometry>();

/** One round, case head at the origin, nose toward -z, with brass/copper/primer vertex colours (~200 tris). */
export function roundGeometry(cal: CaliberId): BufferGeometry {
  let g = geoCache.get(cal);
  if (g) return g;
  const s = SPECS[cal];
  const part = (pts: [number, number][], color: number, primer = false) => {
    const lathe = new LatheGeometry(
      pts.map(([r, z]) => new Vector2(r, z)),
      SEGS,
    );
    const n = lathe.attributes.position.count;
    const col = new Float32Array(n * 3);
    const c = new Color(color).convertSRGBToLinear();
    const pc = new Color(0xb9b4a8).convertSRGBToLinear();
    const pos = lathe.attributes.position;
    for (let i = 0; i < n; i++) {
      // Primer: the centre of the case head.
      const k = primer && pos.getY(i) < 1e-5 && Math.hypot(pos.getX(i), pos.getZ(i)) < s.head * 0.2 ? pc : c;
      col[i * 3] = k.r;
      col[i * 3 + 1] = k.g;
      col[i * 3 + 2] = k.b;
    }
    lathe.setAttribute('color', new BufferAttribute(col, 3));
    // Lathe axis +y → nose toward -z.
    lathe.applyMatrix4(new Matrix4().makeRotationX(-Math.PI / 2));
    return lathe.toNonIndexed();
  };
  // A primer disc: a short centre point on the case head.
  const head: [number, number][] = [
    [0, -0.00006],
    [s.head * 0.19, -0.00006],
    [s.head * 0.21, 0.0001],
  ];
  g = mergeGeometries([
    part(s.caseProfile, s.caseColor),
    part(s.bulletProfile, s.bulletColor),
    part(head, 0xb9b4a8, true),
  ])!;
  g.computeBoundingSphere();
  geoCache.set(cal, g);
  return g;
}

let roundMat: MeshStandardMaterial | null = null;
function roundMaterial(): MeshStandardMaterial {
  if (!roundMat) {
    roundMat = new MeshStandardMaterial({
      name: 'magRounds',
      vertexColors: true,
      metalness: 1,
      roughness: 0.32,
      envMapIntensity: 1.3,
      side: DoubleSide,
    });
    roundMat.envMap = weaponEnvMap();
    KIT_MATERIALS.add(roundMat);
  }
  return roundMat;
}

// ------------------------------------------------------------------ layout

export interface RoundSlot {
  /** Case head centre (mag frame) and orientation (nose = -z rotated by q). */
  p: Vector3;
  q: Quaternion;
}

export interface MagLayout {
  slots: RoundSlot[];
  /** Uniform scale of the round so the stack fits this mag's cavity (≤ 1). */
  scale: number;
  /** Lateral stagger (m; 0 = single stack). */
  stagger: number;
  /** Pitch between consecutive rounds measured across the stack (m). */
  pitch: number;
  diameter: number;
}

const WALL = 0.0012;

/**
 * Lay `capacity` rounds from the feed lips down the mag (only slots inside the mag are returned). Rounds are centred
 * between the front and rear walls along the cavity's centre line, staggered either side of it, and turn with the
 * curve (the top round is level with the mag's top). Every round is checked against the walls at its nose and head.
 */
export function layoutRounds(info: MagInfo, cal: CaliberId, capacity: number): MagLayout {
  const spec = SPECS[cal];
  const S0 = info.slices;
  const med = (f: (x: (typeof S0)[number]) => number) => {
    const v = S0.map(f).sort((p, q) => p - q);
    return v[Math.floor(v.length / 2)];
  };
  const depth = med((x) => x.z1 - x.z0);
  const width = med((x) => x.x1 - x.x0);
  // Fit the round to the cavity (an undersized mag mesh shrinks the round rather than poke through the walls) and
  // stagger it like a real double-stack mag: centres 0.44 d either side, so two rounds span 1.88 d.
  const scale = Math.min(1, (depth - 2 * WALL) / (spec.oal + 0.001), (width - 2 * WALL) / (1.88 * spec.head));
  const d = spec.head * scale;
  const L = spec.oal * scale;
  const stagger = 0.44 * d;
  const pitch = Math.sqrt(Math.max(1e-8, d * d - 4 * stagger * stagger));
  // The feed lips: the highest slice deep and wide enough for a round (lugs / catch tabs above it don't count).
  let lip = S0.findIndex((x) => x.z1 - x.z0 >= 0.95 * L && x.x1 - x.x0 >= 1.5 * d);
  if (lip < 0) lip = 0;
  const S = S0.slice(lip);
  const body = S[Math.min(S.length - 1, 2)];
  const cx = (body.x0 + body.x1) / 2;
  // Cavity centre line (lips → floor) with arclength.
  const pts = S.map((x) => new Vector2(x.y, (x.z0 + x.z1) / 2));
  const arc = [0];
  for (let i = 1; i < pts.length; i++) arc.push(arc[i - 1] + pts[i].distanceTo(pts[i - 1]));
  const at = (a: number, out: Vector2, tan: Vector2) => {
    let i = 1;
    while (i < arc.length - 1 && arc[i] < a) i++;
    const t = Math.min(1, Math.max(0, (a - arc[i - 1]) / Math.max(1e-6, arc[i] - arc[i - 1])));
    out.lerpVectors(pts[i - 1], pts[i], t);
    // Tangent over a few slices (smooth curvature).
    const j0 = Math.max(0, i - 5),
      j1 = Math.min(pts.length - 1, i + 5);
    tan.subVectors(pts[j1], pts[j0]).normalize();
    return a <= arc[arc.length - 1];
  };
  const slots: RoundSlot[] = [];
  const P = new Vector2();
  const T = new Vector2();
  // Forward sweep of the centre line (rad, + = the mag curves forward going down).
  const sweep = (t: Vector2) => Math.atan2(-t.y, -t.x);
  // Top round: centre just under the lip line, slightly proud of it.
  let a = 0.42 * d;
  at(a, P, T);
  const phi0 = sweep(T);
  const along = 1 / Math.max(0.5, Math.cos(phi0));
  const floor = info.bottom + 0.012;
  const sl = { y: 0, x0: 0, x1: 0, z0: 0, z1: 0 };
  const X = new Vector3(1, 0, 0);
  const ax = new Vector3();
  const head = new Vector3();
  const nose = new Vector3();
  for (let k = 0; k < capacity; k++) {
    if (!at(a, P, T) || P.x - d / 2 < floor) break;
    // Lower rounds turn with the curve (noses up where the mag sweeps forward).
    const q = new Quaternion().setFromAxisAngle(X, Math.max(0, sweep(T) - phi0));
    ax.set(0, 0, -1).applyQuaternion(q);
    // Centred on the centre line; case head toward the rear.
    head.set(cx + (k % 2 === 0 ? stagger : -stagger), P.x, P.y).addScaledVector(ax, -L / 2);
    nose.copy(head).addScaledVector(ax, L);
    // Keep head and nose inside the walls at their own heights.
    const hz = sliceAt(info, head.y, sl).z1 - WALL;
    if (head.z > hz) head.z = hz;
    const nz = sliceAt(info, head.y + ax.y * L, sl).z0 + WALL;
    if (head.z + ax.z * L < nz) head.z = nz - ax.z * L;
    slots.push({ p: head.clone(), q });
    // Next round: one pitch across the stack, measured along the centre line.
    a += pitch * along;
  }
  return { slots, scale, stagger, pitch, diameter: d };
}

// ------------------------------------------------------------------ openings (witness holes, window, open top)

export type MagStyle = 'glock' | 'beretta' | 'pmag' | 'gi' | 'ak' | 'hk';

/** Which openings the real mag has, from the build's magazine part (or the weapon family). */
export function magStyle(model: WeaponModel): MagStyle {
  let id: string;
  try {
    id = resolveBuild(model.build).parts.magazine?.id ?? '';
  } catch {
    id = '';
  }
  if (/^p17/.test(id) || model.weapon === 'p17') return 'glock';
  if (/^p92/.test(id) || model.weapon === 'p92') return 'beretta';
  if (/^ar_mag_p/.test(id)) return 'pmag';
  if (/^ar_mag_s/.test(id)) return 'gi';
  if (/^ak/.test(id) || model.weapon === 'k47s') return 'ak';
  if (/^kp/.test(id) || model.weapon === 'kp9') return 'hk';
  return model.weapon === 'sb16' || model.weapon === 'hb300' ? 'pmag' : 'ak';
}

/** A cut through the faces whose normal points along `n`: a capsule from `c - a` to `c + a` of radius `r`. */
export interface Cut {
  c: Vector3;
  a: Vector3;
  r: number;
  n: Vector3;
}

const MAX_CUTS = 12;

/** Witness holes numbered from the full count down every `step` rounds (≥ `min`). */
function holeCounts(cap: number, step: number, min: number) {
  const out: number[] = [];
  for (let k = cap; k >= min; k -= step) out.push(k);
  return out;
}

export function magCuts(style: MagStyle, info: MagInfo, lay: MagLayout, capacity: number): Cut[] {
  const cuts: Cut[] = [];
  const slot = (k: number) => lay.slots[Math.min(lay.slots.length - 1, k - 1)];
  const d = lay.diameter;
  const body = info.slices[Math.min(info.slices.length - 1, 3)];
  const cx = (body.x0 + body.x1) / 2;
  const sl = { y: 0, x0: 0, x1: 0, z0: 0, z1: 0 };
  const back = (k: number, r: number) => {
    const s = slot(k);
    if (!s || k > lay.slots.length) return;
    sliceAt(info, s.p.y, sl);
    cuts.push({ c: new Vector3(cx, s.p.y, sl.z1), a: new Vector3(), r, n: new Vector3(0, 0, 1) });
  };
  const side = (k: number, r: number, inset: number) => {
    const s = slot(k);
    if (!s || k > lay.slots.length) return;
    sliceAt(info, s.p.y, sl);
    for (const sx of [-1, 1])
      cuts.push({
        c: new Vector3(sx < 0 ? sl.x0 : sl.x1, s.p.y, sl.z1 - inset),
        a: new Vector3(),
        r,
        n: new Vector3(sx, 0, 0),
      });
  };
  switch (style) {
    case 'glock':
      // Numbered witness holes up the back of the mag.
      for (const k of holeCounts(capacity, 3, 4)) back(k, 0.0021);
      break;
    case 'beretta':
      for (const k of holeCounts(capacity, 3, 4)) back(k, 0.0019);
      break;
    case 'hk':
      // Witness holes down the side, behind the case heads' line.
      for (const k of holeCounts(capacity, 5, 5)) side(k, 0.0022, 0.009);
      break;
    case 'gi':
      for (const k of holeCounts(capacity, 10, 10)) side(k, 0.0022, 0.008);
      break;
    case 'pmag': {
      // Gen M3 window: a slot down each side near the back, from ~round 4 to the bottom of the stack.
      const a = slot(4);
      const b = slot(Math.min(capacity, lay.slots.length));
      if (!a || !b) break;
      const ya = a.p.y,
        yb = b.p.y;
      for (const sx of [-1, 1]) {
        const za = sliceAt(info, ya, sl).z1 - 0.011;
        const xa = sx < 0 ? sl.x0 : sl.x1;
        const zb = sliceAt(info, yb, sl).z1 - 0.011;
        const c = new Vector3(xa, (ya + yb) / 2, (za + zb) / 2);
        cuts.push({
          c,
          a: new Vector3(0, (ya - yb) / 2, (za - zb) / 2),
          r: 0.0032,
          n: new Vector3(sx, 0, 0),
        });
      }
      break;
    }
    case 'ak':
      break;
  }
  void d;
  return cuts.slice(0, MAX_CUTS);
}

interface Opening {
  cuts: Cut[];
  /** Open top: faces pointing up above `y` inside the x/z rectangle. */
  top: { y: number; x0: number; x1: number; z0: number; z1: number };
}

function openingUniforms(o: Opening, toMag: Matrix4) {
  const c = Array.from({ length: MAX_CUTS }, () => new Vector4());
  const a = Array.from({ length: MAX_CUTS }, () => new Vector4());
  const n = Array.from({ length: MAX_CUTS }, () => new Vector4());
  o.cuts.forEach((k, i) => {
    c[i].set(k.c.x, k.c.y, k.c.z, k.r);
    a[i].set(k.a.x, k.a.y, k.a.z, 0);
    n[i].set(k.n.x, k.n.y, k.n.z, 0);
  });
  return {
    uMagM: { value: toMag },
    uCutC: { value: c },
    uCutA: { value: a },
    uCutN: { value: n },
    uCutCount: { value: o.cuts.length },
    uTopMin: { value: new Vector3(o.top.x0, o.top.y, o.top.z0) },
    uTopMax: { value: new Vector3(o.top.x1, 1, o.top.z1) },
  };
}

const CUT_VERT = /* glsl */ `
uniform mat4 uMagM;
varying vec3 vMagP;
varying vec3 vMagN;
`;
const CUT_FRAG = /* glsl */ `
varying vec3 vMagP;
varying vec3 vMagN;
uniform vec4 uCutC[${MAX_CUTS}];
uniform vec4 uCutA[${MAX_CUTS}];
uniform vec4 uCutN[${MAX_CUTS}];
uniform int uCutCount;
uniform vec3 uTopMin;
uniform vec3 uTopMax;
bool magCut() {
  vec3 p = vMagP;
  vec3 nm = normalize(vMagN);
  if (nm.y > 0.5 && all(greaterThan(p, uTopMin)) && all(lessThan(p, uTopMax))) return true;
  for (int i = 0; i < ${MAX_CUTS}; i++) {
    if (i >= uCutCount) break;
    vec3 n = uCutN[i].xyz;
    if (dot(nm, n) < 0.45) continue;
    vec3 d = p - uCutC[i].xyz;
    d -= n * dot(d, n);
    vec3 ax = uCutA[i].xyz;
    float L = dot(ax, ax);
    float t = L > 1e-10 ? clamp(dot(d, ax) / L, -1.0, 1.0) : 0.0;
    if (length(d - ax * t) < uCutC[i].w) return true;
  }
  return false;
}
`;

/** Clone `mat` for one mag mesh with the openings cut and a dark inside (chains the material's own patch). */
function cutMaterial(mat: Material, o: Opening, toMag: Matrix4): Material {
  const m = mat.clone();
  const prev = mat.onBeforeCompile;
  const prevKey = mat.customProgramCacheKey();
  const uniforms = openingUniforms(o, toMag);
  m.side = DoubleSide;
  m.onBeforeCompile = (shader, renderer) => {
    prev.call(m, shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${CUT_VERT}`)
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvMagP = (uMagM * vec4(position, 1.0)).xyz;\nvMagN = mat3(uMagM) * normal;',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${CUT_FRAG}`)
      .replace(
        '#include <clipping_planes_fragment>',
        '#include <clipping_planes_fragment>\nif (magCut()) discard;',
      )
      .replace(
        '#include <dithering_fragment>',
        '#include <dithering_fragment>\nif (!gl_FrontFacing) gl_FragColor.rgb *= 0.12;',
      );
  };
  m.customProgramCacheKey = () => `${prevKey}|magCut`;
  if (mat instanceof MeshStandardMaterial && KIT_MATERIALS.has(mat))
    KIT_MATERIALS.add(m as MeshStandardMaterial);
  return m;
}

// ------------------------------------------------------------------ the stack on a mag

const _m = new Matrix4();
const _s = new Vector3();

/** Rounds + openings fitted to one model's mag. `set(n)` shows the top `n` rounds. */
export class MagRounds {
  readonly mesh: InstancedMesh;
  readonly layout: MagLayout;
  readonly style: MagStyle;
  readonly info: MagInfo;
  private shown = -1;

  constructor(
    readonly model: WeaponModel,
    caliber: string,
    readonly capacity: number,
  ) {
    const mag = model.parts.mag!;
    this.info = magInfo(model)!;
    const cal = caliberId(caliber);
    this.layout = layoutRounds(this.info, cal, capacity);
    this.style = magStyle(model);
    this.mesh = new InstancedMesh(roundGeometry(cal), roundMaterial(), Math.max(1, this.layout.slots.length));
    this.mesh.name = 'magRounds';
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    _s.setScalar(this.layout.scale);
    this.layout.slots.forEach((s, i) => this.mesh.setMatrixAt(i, _m.compose(s.p, s.q, _s)));
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.count = 0;
    this.mesh.visible = false;
    // Openings on the mag shell (per mesh: its own matrix into the mag frame).
    const body = this.info.slices[Math.min(this.info.slices.length - 1, 3)];
    const lip = 0.0016;
    const open: Opening = {
      cuts: magCuts(this.style, this.info, this.layout, capacity),
      top: {
        y: this.info.top - 0.016,
        x0: body.x0 + lip,
        x1: body.x1 - lip,
        z0: body.z0 + lip,
        z1: body.z1 - lip,
      },
    };
    mag.updateMatrixWorld(true);
    const inv = new Matrix4().copy(mag.matrixWorld).invert();
    mag.traverse((o: Object3D) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh || o === this.mesh) return;
      const toMag = new Matrix4().multiplyMatrices(inv, mesh.matrixWorld);
      mesh.material = Array.isArray(mesh.material)
        ? mesh.material.map((x) => cutMaterial(x, open, toMag))
        : cutMaterial(mesh.material, open, toMag);
    });
    mag.add(this.mesh);
  }

  /** Show the top `n` rounds (clamped to what fits in this mag). */
  set(n: number): void {
    const k = Math.max(0, Math.min(this.layout.slots.length, Math.floor(n)));
    if (k === this.shown) return;
    this.shown = k;
    this.mesh.count = k;
    this.mesh.visible = k > 0;
  }

  get count(): number {
    return Math.max(0, this.shown);
  }
}

/** The rounds stack on a mag object (or a clone of one), if any. */
export function roundsOn(mag: Object3D | undefined): InstancedMesh | undefined {
  return mag?.children.find((c) => c.name === 'magRounds') as InstancedMesh | undefined;
}
