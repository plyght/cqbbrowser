import {
  AdditiveBlending,
  DoubleSide,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  NormalBlending,
  PlaneGeometry,
  ShaderMaterial,
  Uniform,
  type Scene,
  type Texture,
} from 'three';

export interface ParticleSpawn {
  x: number;
  y: number;
  z: number;
  vx?: number;
  vy?: number;
  vz?: number;
  life: number;
  size0: number;
  size1?: number;
  r: number;
  g: number;
  b: number;
  alpha?: number;
  /** Atlas cell (see textures.ts ATLAS). */
  frame: number;
  gravity?: number;
  /** Linear drag per second. */
  drag?: number;
  rot?: number;
  rotVel?: number;
  /** 0 = billboard, 1 = streak along velocity (len = size + |v|·stretch), 2 = fixed axis (len = size·stretch). */
  mode?: 0 | 1 | 2;
  stretch?: number;
  ax?: number;
  ay?: number;
  az?: number;
  /** Bounce off y=floorY (chunks, sparks). */
  bounce?: number;
  floorY?: number;
  /** Alpha curve exponent over life (higher = fades sooner). */
  fade?: number;
}

/** Reusable spawn record so emitters don't allocate per particle. */
export function spawnRecord(): Required<ParticleSpawn> {
  return {
    x: 0,
    y: 0,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    life: 1,
    size0: 0.1,
    size1: 0.1,
    r: 1,
    g: 1,
    b: 1,
    alpha: 1,
    frame: 0,
    gravity: 0,
    drag: 0,
    rot: 0,
    rotVel: 0,
    mode: 0,
    stretch: 0,
    ax: 0,
    ay: 1,
    az: 0,
    bounce: -1,
    floorY: 0,
    fade: 1,
  };
}

/** Reset a spawn record to defaults (keeps the object). */
export function resetRecord(s: Required<ParticleSpawn>) {
  s.vx = s.vy = s.vz = 0;
  s.size1 = s.size0;
  s.alpha = 1;
  s.gravity = s.drag = s.rot = s.rotVel = s.stretch = s.ax = s.az = s.floorY = 0;
  s.ay = 1;
  s.mode = 0;
  s.bounce = -1;
  s.fade = 1;
  return s;
}

const vert = /* glsl */ `
attribute vec4 iPos;   // xyz, size
attribute vec4 iCol;   // rgb (HDR), alpha
attribute vec4 iMisc;  // frame, rotation, length, mode
attribute vec3 iAxis;
uniform float uPx; // pixels per world unit at 1 m
varying vec2 vUv;
varying vec4 vCol;
void main() {
  vec4 mv = viewMatrix * vec4(iPos.xyz, 1.0);
  vec2 c = position.xy;
  // Keep sub-pixel sparks from aliasing away: widen to ~1.6 px and dim to conserve energy.
  float dist = max(-mv.z, 0.01);
  float w = iPos.w;
  float wpx = w * uPx / dist;
  float boost = 1.0;
  if (wpx < 1.6) {
    boost = wpx / 1.6;
    w = 1.6 * dist / uPx;
  }
  if (iMisc.w > 0.5) {
    vec3 ax = (viewMatrix * vec4(iAxis, 0.0)).xyz;
    vec2 sd = ax.xy / max(length(ax.xy), 1e-4);
    vec3 off = ax * (c.y * max(iMisc.z, w));
    // Width axis = streak direction rotated -90° so the quad keeps its winding.
    off.x += sd.y * c.x * w;
    off.y -= sd.x * c.x * w;
    mv.xyz += off;
  } else {
    float s = sin(iMisc.y), co = cos(iMisc.y);
    mv.xy += mat2(co, s, -s, co) * c * w;
  }
  gl_Position = projectionMatrix * mv;
  float cell = iMisc.x;
  vUv = (uv + vec2(mod(cell, 4.0), 3.0 - floor(cell / 4.0))) * 0.25;
  vCol = vec4(iCol.rgb, iCol.a * boost);
}
`;

const fragAdd = /* glsl */ `
uniform sampler2D map;
varying vec2 vUv;
varying vec4 vCol;
void main() {
  vec4 t = texture2D(map, vUv);
  gl_FragColor = vec4(vCol.rgb * t.rgb * t.a * vCol.a, 1.0);
}
`;

const fragAlpha = /* glsl */ `
uniform sampler2D map;
varying vec2 vUv;
varying vec4 vCol;
void main() {
  vec4 t = texture2D(map, vUv);
  float a = t.a * vCol.a;
  if (a < 0.004) discard;
  gl_FragColor = vec4(vCol.rgb * t.rgb, a);
}
`;

/**
 * Pooled instanced billboard particles (one draw call per pool). CPU-simulated struct-of-arrays,
 * no allocations after construction. Active particles are packed into the first `count` instances.
 */
export class ParticlePool {
  readonly mesh: Mesh;
  private n = 0;
  // Sim state (SoA).
  private pos: Float32Array;
  private vel: Float32Array;
  private axis: Float32Array;
  private col: Float32Array;
  /** life, maxLife, size0, size1 */
  private lt: Float32Array;
  /** frame, rot, rotVel, mode */
  private m0: Float32Array;
  /** gravity, drag, stretch, bounce */
  private m1: Float32Array;
  /** floorY, fade */
  private m2: Float32Array;
  // GPU attributes.
  private aPos: InstancedBufferAttribute;
  private aCol: InstancedBufferAttribute;
  private aMisc: InstancedBufferAttribute;
  private aAxis: InstancedBufferAttribute;
  private geo: InstancedBufferGeometry;

  constructor(
    scene: Scene,
    map: Texture,
    readonly capacity: number,
    additive: boolean,
  ) {
    const cap = capacity;
    this.pos = new Float32Array(cap * 3);
    this.vel = new Float32Array(cap * 3);
    this.axis = new Float32Array(cap * 3);
    this.col = new Float32Array(cap * 4);
    this.lt = new Float32Array(cap * 4);
    this.m0 = new Float32Array(cap * 4);
    this.m1 = new Float32Array(cap * 4);
    this.m2 = new Float32Array(cap * 2);
    const base = new PlaneGeometry(1, 1);
    const geo = new InstancedBufferGeometry();
    geo.index = base.index;
    geo.setAttribute('position', base.getAttribute('position'));
    geo.setAttribute('uv', base.getAttribute('uv'));
    const mk = (n: number) =>
      new InstancedBufferAttribute(new Float32Array(cap * n), n).setUsage(DynamicDrawUsage);
    this.aPos = mk(4);
    this.aCol = mk(4);
    this.aMisc = mk(4);
    this.aAxis = mk(3);
    geo.setAttribute('iPos', this.aPos);
    geo.setAttribute('iCol', this.aCol);
    geo.setAttribute('iMisc', this.aMisc);
    geo.setAttribute('iAxis', this.aAxis);
    geo.instanceCount = 0;
    this.geo = geo;
    const mat = new ShaderMaterial({
      vertexShader: vert,
      fragmentShader: additive ? fragAdd : fragAlpha,
      uniforms: { map: new Uniform(map), uPx: new Uniform(600) },
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
      blending: additive ? AdditiveBlending : NormalBlending,
    });
    this.mesh = new Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = additive ? 20 : 10;
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  /** Pixels per world unit at 1 m (drawing-buffer height / (2·tan(fov/2))). */
  setPixelScale(px: number) {
    ((this.mesh.material as ShaderMaterial).uniforms.uPx as Uniform).value = px;
  }

  get count() {
    return this.n;
  }

  spawn(s: ParticleSpawn): void {
    let i = this.n;
    if (i >= this.capacity) {
      // Pool full: recycle the oldest-looking slot (highest life fraction).
      let best = 0,
        bf = -1;
      for (let k = 0; k < this.n; k++) {
        const f = this.lt[k * 4] / this.lt[k * 4 + 1];
        if (f > bf) {
          bf = f;
          best = k;
        }
      }
      i = best;
    } else this.n++;
    const p3 = i * 3,
      p4 = i * 4;
    this.pos[p3] = s.x;
    this.pos[p3 + 1] = s.y;
    this.pos[p3 + 2] = s.z;
    this.vel[p3] = s.vx ?? 0;
    this.vel[p3 + 1] = s.vy ?? 0;
    this.vel[p3 + 2] = s.vz ?? 0;
    this.axis[p3] = s.ax ?? 0;
    this.axis[p3 + 1] = s.ay ?? 1;
    this.axis[p3 + 2] = s.az ?? 0;
    this.col[p4] = s.r;
    this.col[p4 + 1] = s.g;
    this.col[p4 + 2] = s.b;
    this.col[p4 + 3] = s.alpha ?? 1;
    this.lt[p4] = 0;
    this.lt[p4 + 1] = s.life;
    this.lt[p4 + 2] = s.size0;
    this.lt[p4 + 3] = s.size1 ?? s.size0;
    this.m0[p4] = s.frame;
    this.m0[p4 + 1] = s.rot ?? 0;
    this.m0[p4 + 2] = s.rotVel ?? 0;
    this.m0[p4 + 3] = s.mode ?? 0;
    this.m1[p4] = s.gravity ?? 0;
    this.m1[p4 + 1] = s.drag ?? 0;
    this.m1[p4 + 2] = s.stretch ?? 0;
    this.m1[p4 + 3] = s.bounce ?? -1;
    this.m2[i * 2] = s.floorY ?? 0;
    this.m2[i * 2 + 1] = s.fade ?? 1;
  }

  private kill(i: number) {
    const last = --this.n;
    if (i === last) return;
    const copy = (a: Float32Array, k: number) => {
      for (let j = 0; j < k; j++) a[i * k + j] = a[last * k + j];
    };
    copy(this.pos, 3);
    copy(this.vel, 3);
    copy(this.axis, 3);
    copy(this.col, 4);
    copy(this.lt, 4);
    copy(this.m0, 4);
    copy(this.m1, 4);
    copy(this.m2, 2);
  }

  update(dt: number) {
    const { pos, vel, lt, m0, m1, m2 } = this;
    for (let i = this.n - 1; i >= 0; i--) {
      const p3 = i * 3,
        p4 = i * 4;
      lt[p4] += dt;
      if (lt[p4] >= lt[p4 + 1]) {
        this.kill(i);
        continue;
      }
      const drag = Math.max(0, 1 - m1[p4 + 1] * dt);
      vel[p3] *= drag;
      vel[p3 + 1] = vel[p3 + 1] * drag - m1[p4] * dt;
      vel[p3 + 2] *= drag;
      pos[p3] += vel[p3] * dt;
      pos[p3 + 1] += vel[p3 + 1] * dt;
      pos[p3 + 2] += vel[p3 + 2] * dt;
      const bounce = m1[p4 + 3];
      if (bounce >= 0 && pos[p3 + 1] < m2[i * 2] && vel[p3 + 1] < 0) {
        pos[p3 + 1] = m2[i * 2];
        vel[p3 + 1] *= -bounce;
        vel[p3] *= 0.5;
        vel[p3 + 2] *= 0.5;
        m0[p4 + 2] *= 0.5;
      }
      m0[p4 + 1] += m0[p4 + 2] * dt;
    }
    this.upload();
  }

  private upload() {
    const n = this.n;
    const P = this.aPos.array as Float32Array,
      C = this.aCol.array as Float32Array,
      M = this.aMisc.array as Float32Array,
      A = this.aAxis.array as Float32Array;
    for (let i = 0; i < n; i++) {
      const p3 = i * 3,
        p4 = i * 4;
      const t = this.lt[p4] / this.lt[p4 + 1];
      const size = this.lt[p4 + 2] + (this.lt[p4 + 3] - this.lt[p4 + 2]) * Math.sqrt(t);
      P[p4] = this.pos[p3];
      P[p4 + 1] = this.pos[p3 + 1];
      P[p4 + 2] = this.pos[p3 + 2];
      P[p4 + 3] = size;
      const fade = Math.pow(1 - t, this.m2[i * 2 + 1]);
      C[p4] = this.col[p4];
      C[p4 + 1] = this.col[p4 + 1];
      C[p4 + 2] = this.col[p4 + 2];
      C[p4 + 3] = this.col[p4 + 3] * fade;
      const mode = this.m0[p4 + 3];
      let len = 0;
      if (mode === 1) {
        const vx = this.vel[p3],
          vy = this.vel[p3 + 1],
          vz = this.vel[p3 + 2];
        const sp = Math.hypot(vx, vy, vz) || 1;
        A[p3] = vx / sp;
        A[p3 + 1] = vy / sp;
        A[p3 + 2] = vz / sp;
        len = size + sp * this.m1[p4 + 2];
      } else if (mode === 2) {
        A[p3] = this.axis[p3];
        A[p3 + 1] = this.axis[p3 + 1];
        A[p3 + 2] = this.axis[p3 + 2];
        len = size * this.m1[p4 + 2];
      }
      M[p4] = this.m0[p4];
      M[p4 + 1] = this.m0[p4 + 1];
      M[p4 + 2] = len;
      M[p4 + 3] = mode;
    }
    this.geo.instanceCount = n;
    this.mesh.visible = n > 0;
    if (n > 0) {
      for (const a of [this.aPos, this.aCol, this.aMisc, this.aAxis]) {
        a.clearUpdateRanges();
        a.addUpdateRange(0, n * a.itemSize);
        a.needsUpdate = true;
      }
    }
  }
}
