import {
  Color,
  MeshBasicMaterial,
  Uniform,
  Vector4,
  type MeshBasicMaterialParameters,
  type Texture,
} from 'three';

/**
 * Illuminated reticles (red dots, holo rings, LPVO dots) at a fixed *display* brightness.
 *
 * The camera auto-exposes (GPU-only AE, no readback) and the NVG tube runs its own gain, so an emissive dot with a
 * fixed HDR radiance came out as a giant bloomed blob in a dark room or under NVG (the gain multiplies it) and
 * merely bright in daylight. Real sights get dialled to the scene; here the reticle shader divides by the current
 * exposure instead: after AE (or the tube gain) the dot lands at `display` × its colour, a modest glow.
 *
 * The renderer feeds the exposure state textures every frame (`updateReticleExposure`); without them (bench,
 * tests) the factor is just `display`.
 */
export const reticleUniforms = {
  /** Bodycam AE state (r = EV applied). */
  tRetAE: new Uniform<Texture | null>(null),
  /** NVG tube gain state (r = gain EV). */
  tRetNvg: new Uniform<Texture | null>(null),
  /** x = EV bias + boot offset, y = NVG on (0/1), z = has AE texture (0/1), w = unused. */
  uRet: new Uniform(new Vector4(0, 0, 0, 0)),
};

/** Display-referred brightness of the reticle after exposure (scene-linear multiplier of its colour). */
export const RETICLE_DISPLAY = 0.95;
/** Under NVG: tube signal target (stays below the tube's halo threshold, ~1.4). */
export const RETICLE_NVG = 1.35;

export function updateReticleExposure(
  ae: Texture | null,
  evBias: number,
  nvg: Texture | null,
  nvgOn: boolean,
) {
  reticleUniforms.tRetAE.value = ae;
  reticleUniforms.tRetNvg.value = nvg;
  reticleUniforms.uRet.value.set(evBias, nvgOn && nvg ? 1 : 0, ae ? 1 : 0, 0);
}

/** Exposure-compensated factor for a reticle (CPU mirror of the shader, for tests). */
export function reticleGain(ev: number | null, nvgEv: number | null): number {
  const k = nvgEv !== null ? RETICLE_NVG * 2 ** -nvgEv : RETICLE_DISPLAY * 2 ** -(ev ?? 0);
  return Math.min(64, Math.max(1e-4, k));
}

/** A reticle material: unlit, not tone-mapped, brightness locked to the exposure. */
export function reticleMaterial(
  color: Color | number,
  params: MeshBasicMaterialParameters = {},
): MeshBasicMaterial {
  const m = new MeshBasicMaterial({ ...params, color, toneMapped: false });
  m.name = params.name ?? 'reticle';
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, reticleUniforms);
    sh.fragmentShader = sh.fragmentShader
      .replace(
        'void main() {',
        /* glsl */ `uniform sampler2D tRetAE;
uniform sampler2D tRetNvg;
uniform vec4 uRet;
void main() {`,
      )
      .replace(
        '#include <opaque_fragment>',
        /* glsl */ `#include <opaque_fragment>
  {
    float retK;
    if (uRet.y > 0.5) retK = ${RETICLE_NVG.toFixed(3)} * exp2(-texture2D(tRetNvg, vec2(0.5)).r);
    else retK = ${RETICLE_DISPLAY.toFixed(3)} * exp2(-(uRet.z > 0.5 ? texture2D(tRetAE, vec2(0.5)).r : 0.0) - uRet.x);
    gl_FragColor.rgb *= clamp(retK, 1e-4, 64.0);
  }`,
      );
  };
  m.customProgramCacheKey = () => 'reticle-expo';
  return m;
}

/** Sight red: a deep, saturated red (the brightness comes from the exposure lock, not the colour). */
export const RETICLE_RED = new Color(1, 0.05, 0.03);
