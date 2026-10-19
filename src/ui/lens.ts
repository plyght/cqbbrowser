/**
 * HUD adapter for the CAM04 lens so DOM overlays stick to world objects on the warped image.
 * The math lives in src/render/post/lens.ts (`undistortPoint` = the shader's exact formula, `distortPoint` =
 * its inverse); this file only reads the live effect uniforms and keeps the HUD's [u, v] tuple API.
 */
import { Vector4 } from 'three';
import { distortPoint, IDENTITY_LENS, undistortPoint, type LensParams } from '../render/post/lens';

export interface Lens extends LensParams {
  /** Output width / height. */
  aspect: number;
}

/** The BodycamEffect uniforms we read (a `postprocessing` Effect's `uniforms` map satisfies this). */
export interface LensUniforms {
  get(name: string): { value: unknown } | undefined;
}

/** Current lens from the live effect uniform `uLens` = (k1, k2, crop scale, image-circle radius). */
export function lensFrom(u: LensUniforms, aspect: number): Lens {
  const v = u.get('uLens')?.value;
  if (v instanceof Vector4) return { k1: v.x, k2: v.y, scale: v.z, circle: v.w, aspect };
  return { ...IDENTITY_LENS, aspect };
}

/** Output uv → scene uv (what the shader samples for an output pixel). uv in 0..1, y up. */
export function barrel(u: number, v: number, lens: Lens): [number, number] {
  const p = undistortPoint({ x: u, y: v }, lens.aspect, lens);
  return [p.x, p.y];
}

/** Scene uv → output uv: where a projected world point appears on the final, warped frame. */
export function unbarrel(su: number, sv: number, lens: Lens): [number, number] {
  const p = distortPoint({ x: su, y: sv }, lens.aspect, lens);
  return [p.x, p.y];
}
