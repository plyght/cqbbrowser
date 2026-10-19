import { ShaderChunk, ShaderLib, Vector3 } from 'three';

/**
 * Cheap "interior lighting" for the roofed kill house, patched into three's shared lighting chunks so every
 * lit material (walls, targets, doors, the weapon, the arms) agrees without extra passes or shadow maps:
 *
 * - **Indoor mask:** inside the roofed footprint the sky/ambient fill (hemisphere + ambient + env IBL) drops
 *   to a few percent; the sun is already blocked by the roof's shadow. Outside surfaces are untouched, so the
 *   yard seen through a doorway stays daylight-bright (the CAM04 auto-exposure then blows it out).
 * - **Daylight leaks:** each exterior door/window is a sky-lit area light (form-factor approximation, open
 *   doors only) added to the indoor fill — light pools on the floor inside openings.
 * - **Analytic wall occlusion:** point/spot lights are tested against the house's wall pieces and door leaves
 *   (2D segment crossings + height span) per fragment, so practical bulbs, the muzzle flash, the flashbang and
 *   an unshadowed weapon light don't leak through plywood into the next room — light only spills through
 *   openings, with hard jamb edges. ~40 segment tests, early-out outside the house.
 *
 * Data lives in shared Float32Arrays referenced from the built-in ShaderLib uniforms (three copies uniform
 * objects per material but keeps typed arrays by reference), so updating them here updates every material.
 * All zeros = disabled (any material/shader without these values is unaffected).
 */
export const KH_SEG = 40;
export const KH_LEAK = 8;

/** [0] minX minZ maxX maxZ · [1] yTop enabled roofOn indoorAmbient · [2] leak rgb, gain · [3] nSeg nLeak. */
export const khBox = new Float32Array(16);
/** Per segment: ax az bx bz (world). */
export const khSegA = new Float32Array(KH_SEG * 4);
/** Two segments per vec4: (y0, y1) of segment 2i and 2i+1. */
export const khSegB = new Float32Array((KH_SEG / 2) * 4);
/** Per leak: centre xyz, open 0..1. */
export const khLeakA = new Float32Array(KH_LEAK * 4);
/** Per leak: outward normal x z, half width, half height. */
export const khLeakB = new Float32Array(KH_LEAK * 4);

const PARS = /* glsl */ `
#define KH_SEG ${KH_SEG}
#define KH_LEAK ${KH_LEAK}
uniform vec4 khBox[4];
uniform vec4 khSegA[KH_SEG];
uniform vec4 khSegB[KH_SEG / 2];
uniform vec4 khLeakA[KH_LEAK];
uniform vec4 khLeakB[KH_LEAK];

vec3 khWorldPos( vec3 pView ) {
  return ( ( vec4( pView, 1.0 ) - viewMatrix[ 3 ] ) * viewMatrix ).xyz;
}

// Visibility of a light at lw from the fragment at pw through the house's walls (1 = clear).
float khOcc( vec3 lw, vec3 pw ) {
  if ( khBox[ 1 ].y < 0.5 ) return 1.0;
  vec2 lo = min( lw.xz, pw.xz );
  vec2 hi = max( lw.xz, pw.xz );
  if ( hi.x < khBox[ 0 ].x || hi.y < khBox[ 0 ].y || lo.x > khBox[ 0 ].z || lo.y > khBox[ 0 ].w ) return 1.0;
  vec2 d = pw.xz - lw.xz;
  float vis = 1.0;
  int n = int( khBox[ 3 ].x );
  for ( int i = 0; i < KH_SEG; i ++ ) {
    if ( i >= n ) break;
    vec4 s = khSegA[ i ];
    vec2 e = s.zw - s.xy;
    float den = d.x * e.y - d.y * e.x;
    if ( abs( den ) < 1e-7 ) continue;
    vec2 ap = s.xy - lw.xz;
    float t = ( ap.x * e.y - ap.y * e.x ) / den;
    float u = ( ap.x * d.y - ap.y * d.x ) / den;
    if ( t <= 0.0005 || t >= 0.9995 || u < 0.0 || u > 1.0 ) continue;
    vec4 yy = khSegB[ i / 2 ];
    vec2 span = ( i - ( i / 2 ) * 2 ) == 0 ? yy.xy : yy.zw;
    float y = mix( lw.y, pw.y, t );
    float inside = smoothstep( span.x - 0.015, span.x + 0.015, y ) * ( 1.0 - smoothstep( span.y - 0.015, span.y + 0.015, y ) );
    vis *= 1.0 - inside;
    if ( vis < 0.004 ) return 0.0;
  }
  return vis;
}

// 1 inside the roofed footprint (below the sheathing), 0 outside.
float khIndoor( vec3 pw ) {
  if ( khBox[ 1 ].y < 0.5 || khBox[ 1 ].z < 0.5 ) return 0.0;
  vec4 b = khBox[ 0 ];
  float mx = smoothstep( b.x, b.x + 0.035, pw.x ) * ( 1.0 - smoothstep( b.z - 0.035, b.z, pw.x ) );
  float mz = smoothstep( b.y, b.y + 0.035, pw.z ) * ( 1.0 - smoothstep( b.w - 0.035, b.w, pw.z ) );
  return mx * mz * ( 1.0 - smoothstep( khBox[ 1 ].x - 0.003, khBox[ 1 ].x + 0.003, pw.y ) );
}

// Sky light arriving through open exterior doors/windows (rectangular area-light form factor, approximated).
float khLeakE( vec3 pw, vec3 nw ) {
  float e = 0.0;
  int n = int( khBox[ 3 ].y );
  for ( int i = 0; i < KH_LEAK; i ++ ) {
    if ( i >= n ) break;
    vec4 a = khLeakA[ i ];
    if ( a.w < 0.001 ) continue;
    vec4 b = khLeakB[ i ];
    vec3 v = a.xyz - pw;
    float d2 = max( dot( v, v ), 1e-4 );
    vec3 l = v * inversesqrt( d2 );
    float area = 4.0 * b.z * b.w;
    float co = max( dot( l, vec3( b.x, 0.0, b.y ) ), 0.0 );
    float cr = max( dot( nw, l ), 0.0 ) * 0.8 + 0.2;
    e += a.w * area * co * cr / ( d2 + 0.5 * area );
  }
  return e;
}
`;

const OCC_POINT = 'getPointLightInfo( pointLight, geometryPosition, directLight );';
const OCC_SPOT = 'getSpotLightInfo( spotLight, geometryPosition, directLight );';

const END = /* glsl */ `
#if defined( RE_IndirectDiffuse )
{
  float khM = khIndoor( khPW );
  if ( khM > 0.0 ) {
    float khK = mix( 1.0, khBox[ 1 ].w, khM );
    vec3 khN = normalize( ( vec4( geometryNormal, 0.0 ) * viewMatrix ).xyz );
    irradiance = irradiance * khK + khM * khBox[ 2 ].rgb * ( khBox[ 2 ].a * khLeakE( khPW, khN ) );
    iblIrradiance *= khK;
    #if defined( RE_IndirectSpecular )
    radiance *= khK;
    #endif
  }
}
#endif
`;

let installed = false;

/** Patch three's lighting chunks + built-in material uniforms. Idempotent; call before the first render. */
export function installInteriorLighting() {
  if (installed) return;
  installed = true;
  ShaderChunk.lights_pars_begin += PARS;
  let begin = ShaderChunk.lights_fragment_begin;
  const ok =
    begin.includes(OCC_POINT) && begin.includes(OCC_SPOT) && begin.includes('IncidentLight directLight;');
  if (!ok) {
    console.warn('interiorLight: three lighting chunk changed; interior lighting disabled');
    return;
  }
  begin = begin
    .replace(
      'IncidentLight directLight;',
      'IncidentLight directLight;\nvec3 khPW = khWorldPos( geometryPosition );',
    )
    .replace(
      OCC_POINT,
      `${OCC_POINT}\n\t\tif ( directLight.visible && max( directLight.color.r, max( directLight.color.g, directLight.color.b ) ) > 1e-4 ) directLight.color *= khOcc( khWorldPos( pointLight.position ), khPW );`,
    )
    .replace(
      OCC_SPOT,
      `${OCC_SPOT}\n\t\tif ( directLight.visible && max( directLight.color.r, max( directLight.color.g, directLight.color.b ) ) > 1e-4 ) directLight.color *= khOcc( khWorldPos( spotLight.position ), khPW );`,
    );
  ShaderChunk.lights_fragment_begin = begin;
  ShaderChunk.lights_fragment_end = END + ShaderChunk.lights_fragment_end;
  const lib = ShaderLib as unknown as Record<string, { uniforms: Record<string, { value: unknown }> }>;
  for (const id of ['physical', 'standard', 'lambert', 'phong', 'toon']) {
    const u = lib[id]?.uniforms;
    if (!u) continue;
    u.khBox = { value: khBox };
    u.khSegA = { value: khSegA };
    u.khSegB = { value: khSegB };
    u.khLeakA = { value: khLeakA };
    u.khLeakB = { value: khLeakB };
  }
}

export interface OccluderSeg {
  a: [number, number];
  b: [number, number];
  y0: number;
  y1: number;
}

export interface Leak {
  center: Vector3;
  /** Outward normal (x, z). */
  normal: [number, number];
  halfW: number;
  halfH: number;
  open: number;
}

/** Writes the house description into the shared uniform arrays. Pure data; no GL. */
export class InteriorLighting {
  /** Static wall segments first, then dynamic (door leaves) from `dynamicStart`. */
  private segs: OccluderSeg[] = [];
  private dynamicStart = 0;
  readonly leaks: Leak[] = [];

  constructor(
    box: { minX: number; minZ: number; maxX: number; maxZ: number; top: number },
    opts: { indoorAmbient?: number; leakColor?: [number, number, number]; leakGain?: number } = {},
  ) {
    khBox.fill(0);
    khBox.set([box.minX, box.minZ, box.maxX, box.maxZ], 0);
    khBox.set([box.top, 1, 1, opts.indoorAmbient ?? 0.045], 4);
    const c = opts.leakColor ?? [0.84, 0.87, 0.9];
    khBox.set([c[0], c[1], c[2], opts.leakGain ?? 1.6], 8);
  }

  setStatic(segs: OccluderSeg[]) {
    this.segs = segs.slice(0, KH_SEG);
    this.dynamicStart = this.segs.length;
    this.flushSegs();
  }

  /** Door leaves (and anything else that moves), replaced every frame. */
  setDynamic(segs: OccluderSeg[]) {
    this.segs.length = this.dynamicStart;
    for (const s of segs) if (this.segs.length < KH_SEG) this.segs.push(s);
    this.flushSegs();
  }

  addLeak(l: Leak) {
    if (this.leaks.length >= KH_LEAK) return;
    this.leaks.push(l);
    this.flushLeaks();
  }

  flushLeaks() {
    khLeakA.fill(0);
    khLeakB.fill(0);
    this.leaks.forEach((l, i) => {
      khLeakA.set([l.center.x, l.center.y, l.center.z, l.open], i * 4);
      khLeakB.set([l.normal[0], l.normal[1], l.halfW, l.halfH], i * 4);
    });
    khBox[13] = this.leaks.length;
  }

  private flushSegs() {
    this.segs.forEach((s, i) => {
      khSegA.set([s.a[0], s.a[1], s.b[0], s.b[1]], i * 4);
      khSegB[(i >> 1) * 4 + (i & 1) * 2] = s.y0;
      khSegB[(i >> 1) * 4 + (i & 1) * 2 + 1] = s.y1;
    });
    khBox[12] = this.segs.length;
  }

  get segmentCount() {
    return this.segs.length;
  }

  /** Roof on: indoor fill drops + leaks; off: only the wall occlusion stays. */
  setRoof(on: boolean) {
    khBox[6] = on ? 1 : 0;
  }

  setEnabled(on: boolean) {
    khBox[5] = on ? 1 : 0;
  }

  /** CPU mirror of the shader's segment test (unit tests, gameplay queries like flashbang occlusion hints). */
  occlusion(light: Vector3, p: Vector3): number {
    let vis = 1;
    const dx = p.x - light.x,
      dz = p.z - light.z;
    for (const s of this.segs) {
      const ex = s.b[0] - s.a[0],
        ez = s.b[1] - s.a[1];
      const den = dx * ez - dz * ex;
      if (Math.abs(den) < 1e-7) continue;
      const apx = s.a[0] - light.x,
        apz = s.a[1] - light.z;
      const t = (apx * ez - apz * ex) / den;
      const u = (apx * dz - apz * dx) / den;
      if (t <= 0.0005 || t >= 0.9995 || u < 0 || u > 1) continue;
      const y = light.y + (p.y - light.y) * t;
      if (y >= s.y0 && y <= s.y1) vis = 0;
    }
    return vis;
  }
}
