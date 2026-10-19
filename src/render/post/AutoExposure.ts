import {
  HalfFloatType,
  NearestFilter,
  RGBAFormat,
  ShaderMaterial,
  Uniform,
  Vector4,
  WebGLRenderTarget,
  type Texture,
  type WebGLRenderer,
} from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';

/**
 * GPU-only auto-exposure (no CPU readback). One 1×1 fragment per frame:
 *  1. meters a centre-weighted log-average luminance from a tiny mip of the scene,
 *  2. integrates the exposure (EV) toward the metered target with asymmetric time constants,
 *     lead/lag overshoot and a little hunting, and writes the new state into a ping-pong 1×1 target.
 * State texel: r = EV applied, g = slow-tracked target (for overshoot), b = instantaneous target, a = valid.
 */
const frag = /* glsl */ `
precision highp float;
uniform sampler2D tPrev;
uniform sampler2D tLum;
uniform vec4 uTime;     // dt, time, hunt amount, reset (0/1)
uniform vec4 uAE;       // darkTau, brightTau, overshoot, compensation
uniform vec4 uRange;    // evMin, evMax, key (log2), resetOffset
uniform float uKick;    // EV pulled down by muzzle flash (sensor sees the flash)
varying vec2 vUv;

void main() {
  float sumW = 0.0, sumL = 0.0, peak = -20.0;
  for (int j = 0; j < 6; j++) {
    for (int i = 0; i < 8; i++) {
      vec2 uv = vec2((float(i) + 0.5) / 8.0, (float(j) + 0.5) / 6.0);
      vec2 c = (uv - 0.5) * vec2(2.0, 2.0);
      // Centre-weighted (chest cams meter the middle; the outer ring is outside the image circle anyway).
      float w = exp(-dot(c, c) * 1.4) + 0.05;
      vec3 rgb = texture2D(tLum, uv).rgb;
      float L = log2(max(dot(rgb, vec3(0.2126, 0.7152, 0.0722)), 1e-5));
      sumL += L * w;
      sumW += w;
      peak = max(peak, L);
    }
  }
  float logL = sumL / sumW;
  // Bright-spot protection: a little bit of highlight weighting, like a camera's matrix metering.
  logL = mix(logL, peak, 0.12);
  float refL = -1.2; // daylight range average
  float tgt = uRange.z - (refL + uAE.w * (logL - refL)) - uKick;
  tgt = clamp(tgt, uRange.x, uRange.y);

  vec4 prev = texture2D(tPrev, vec2(0.5));
  float dt = uTime.x;
  if (prev.a < 0.5 || uTime.w > 0.5) {
    float ev0 = tgt + (uTime.w > 0.5 ? uRange.w : 0.0);
    gl_FragColor = vec4(ev0, ev0, tgt, 1.0);
    return;
  }
  float ev = prev.r;
  float slow = prev.g;
  slow += (tgt - slow) * (1.0 - exp(-dt / 0.9));
  float diff = tgt - slow;
  // Lead term → overshoot past the target, then settle as the slow tracker catches up.
  float aim = tgt + uAE.z * diff;
  // Hunting: small low-frequency wobble while unsettled.
  float t = uTime.y;
  aim += (sin(t * 4.7) * 0.6 + sin(t * 9.3 + 1.3) * 0.4) * 0.12 * uTime.z * clamp(abs(diff), 0.0, 1.5);
  float tau = aim > ev ? uAE.x : uAE.y;
  ev += (aim - ev) * (1.0 - exp(-dt / max(tau, 0.01)));
  gl_FragColor = vec4(ev, slow, tgt, 1.0);
}
`;

const vert = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

export class AutoExposure {
  private targets: [WebGLRenderTarget, WebGLRenderTarget];
  private idx = 0;
  private quad: FullScreenQuad;
  readonly material: ShaderMaterial;
  private resetPending = false;
  private resetOffset = 0;

  constructor() {
    const mk = () =>
      new WebGLRenderTarget(1, 1, {
        type: HalfFloatType,
        format: RGBAFormat,
        minFilter: NearestFilter,
        magFilter: NearestFilter,
        depthBuffer: false,
        generateMipmaps: false,
      });
    this.targets = [mk(), mk()];
    this.material = new ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tPrev: new Uniform(null),
        tLum: new Uniform(null),
        uTime: new Uniform(new Vector4()),
        uAE: new Uniform(new Vector4(0.55, 0.2, 0.4, 0.86)),
        uRange: new Uniform(new Vector4(-3, 5.5, Math.log2(0.18), 0)),
        uKick: new Uniform(0),
      },
    });
    this.quad = new FullScreenQuad(this.material);
  }

  /** The current exposure state texture (sample at 0.5,0.5). */
  get texture(): Texture {
    return this.targets[this.idx].texture;
  }

  /** Snap to the metered target plus `offsetEv` on the next update (power-on). */
  reset(offsetEv = 0) {
    this.resetPending = true;
    this.resetOffset = offsetEv;
  }

  setParams(darkTau: number, brightTau: number, overshoot: number, compensation: number) {
    (this.material.uniforms.uAE.value as Vector4).set(darkTau, brightTau, overshoot, compensation);
  }

  update(renderer: WebGLRenderer, lum: Texture, dt: number, time: number, hunt: number, kick: number) {
    const u = this.material.uniforms;
    const prev = this.targets[this.idx];
    this.idx ^= 1;
    const next = this.targets[this.idx];
    u.tPrev.value = prev.texture;
    u.tLum.value = lum;
    (u.uTime.value as Vector4).set(Math.min(dt, 0.1), time, hunt, this.resetPending ? 1 : 0);
    (u.uRange.value as Vector4).w = this.resetOffset;
    u.uKick.value = kick;
    this.resetPending = false;
    const old = renderer.getRenderTarget();
    renderer.setRenderTarget(next);
    this.quad.render(renderer);
    renderer.setRenderTarget(old);
  }

  dispose() {
    this.targets.forEach((t) => t.dispose());
    this.material.dispose();
    this.quad.dispose();
  }
}
