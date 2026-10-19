import { Effect, EffectAttribute } from 'postprocessing';
import { Uniform, Vector2 } from 'three';

/**
 * CAM04 sensor/lens look (v0): barrel distortion, radial chromatic aberration, vignette,
 * luminance-dependent grain, unsharp halo and motion-driven block compression.
 */
const frag = /* glsl */ `
uniform float uDistort;
uniform float uCA;
uniform float uVignette;
uniform float uGrain;
uniform float uSharpen;
uniform float uBlock;
uniform float uTime;
uniform float uIntensity;
uniform vec2 uRes;

vec2 barrel(vec2 uv, float k) {
  vec2 c = uv * 2.0 - 1.0;
  float aspect = uRes.x / uRes.y;
  c.x *= aspect;
  float r2 = dot(c, c);
  c *= 1.0 + k * r2 + k * 0.35 * r2 * r2;
  c.x /= aspect;
  // Normalise so the corners stay on-screen (crop like a real dewarped lens).
  float norm = 1.0 + k * (1.0 + aspect * aspect) * 0.62;
  return (c / norm) * 0.5 + 0.5;
}

float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

void mainImage(const in vec4 inputColor, const in vec2 uv0, out vec4 outputColor) {
  vec2 px = 1.0 / uRes;
  vec2 uv = barrel(uv0, uDistort * uIntensity);
  // Block quantisation: snap sampling to 8x8 blocks proportionally to uBlock (bitrate starvation).
  vec2 suv = uv;
  if (uBlock > 0.001) {
    vec2 b = 8.0 * px;
    vec2 snapped = (floor(uv / b) + 0.5) * b;
    suv = mix(uv, snapped, clamp(uBlock, 0.0, 1.0) * 0.6);
  }
  vec2 dir = uv - 0.5;
  float r = length(uv0 - 0.5);
  vec2 off = dir * r * uCA * uIntensity * 0.02;
  vec3 col;
  col.r = texture2D(inputBuffer, suv + off).r;
  col.g = texture2D(inputBuffer, suv).g;
  col.b = texture2D(inputBuffer, suv - off).b;

  // Unsharp mask (over-processed digital look).
  vec3 blur = (
    texture2D(inputBuffer, suv + vec2(px.x, 0.0) * 2.0).rgb +
    texture2D(inputBuffer, suv - vec2(px.x, 0.0) * 2.0).rgb +
    texture2D(inputBuffer, suv + vec2(0.0, px.y) * 2.0).rgb +
    texture2D(inputBuffer, suv - vec2(0.0, px.y) * 2.0).rgb) * 0.25;
  col += (col - blur) * uSharpen * uIntensity;

  // Grain: stronger in shadows.
  float luma = dot(col, vec3(0.299, 0.587, 0.114));
  float n = hash(uv * uRes + fract(uTime * 29.97) * 100.0) - 0.5;
  col += n * uGrain * uIntensity * mix(1.6, 0.4, luma);

  // Vignette.
  float v = smoothstep(0.85, 0.25, r * (1.0 + uVignette * uIntensity * 0.6));
  col *= mix(1.0, v, uVignette * uIntensity);

  // Outside the dewarped image → black (lens circle crop at extreme distortion).
  outputColor = vec4(max(col, 0.0), inputColor.a);
}
`;

export class BodycamEffect extends Effect {
  constructor() {
    super('BodycamEffect', frag, {
      attributes: EffectAttribute.CONVOLUTION,
      uniforms: new Map<string, Uniform>([
        ['uDistort', new Uniform(0.28)],
        ['uCA', new Uniform(1.0)],
        ['uVignette', new Uniform(0.55)],
        ['uGrain', new Uniform(0.06)],
        ['uSharpen', new Uniform(0.6)],
        ['uBlock', new Uniform(0)],
        ['uTime', new Uniform(0)],
        ['uIntensity', new Uniform(1)],
        ['uRes', new Uniform(new Vector2(1, 1))],
      ]),
    });
  }

  set(name: string, v: number) {
    this.uniforms.get(name)!.value = v;
  }

  override setSize(w: number, h: number) {
    (this.uniforms.get('uRes')!.value as Vector2).set(w, h);
  }

  override update(_r: unknown, _i: unknown, dt?: number) {
    this.uniforms.get('uTime')!.value += dt ?? 0.016;
  }
}
