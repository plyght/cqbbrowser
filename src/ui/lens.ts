/**
 * CPU port of the CAM04 barrel distortion so DOM overlays can stick to world objects on the warped image.
 *
 * KEEP IN SYNC with `barrel()` in src/render/post/BodycamEffect.ts (the shader samples the scene at
 * `barrel(uv0)` for each output pixel `uv0`). If the render engineer changes that function, change `barrel` here;
 * `unbarrel` (the inverse used for overlays) adapts automatically.
 */

export interface Lens {
  /** Effective distortion: uDistort * uIntensity. */
  k: number;
  /** Output width / height (shader `uRes.x / uRes.y`). */
  aspect: number;
}

/** The BodycamEffect uniforms we read (a `postprocessing` Effect's `uniforms` map satisfies this). */
export interface LensUniforms {
  get(name: string): { value: unknown } | undefined;
}

/** Current lens from the live effect uniforms: k = uDistort × uIntensity (as in the shader's mainImage). */
export function lensFrom(u: LensUniforms, aspect: number): Lens {
  const d = Number(u.get('uDistort')?.value ?? 0);
  const i = Number(u.get('uIntensity')?.value ?? 1);
  return { k: d * i, aspect };
}

/** Output uv → scene uv (exact port of the GLSL). uv in 0..1, y up. */
export function barrel(u: number, v: number, k: number, aspect: number): [number, number] {
  let cx = (u * 2 - 1) * aspect;
  let cy = v * 2 - 1;
  const r2 = cx * cx + cy * cy;
  const s = 1 + k * r2 + k * 0.35 * r2 * r2;
  cx *= s;
  cy *= s;
  cx /= aspect;
  const norm = 1 + k * (1 + aspect * aspect) * 0.62;
  return [(cx / norm) * 0.5 + 0.5, (cy / norm) * 0.5 + 0.5];
}

/**
 * Scene uv → output uv: where a projected world point appears on the final, warped frame.
 * Newton iterations with a numeric Jacobian; converges in a few steps for the distortions we use.
 */
export function unbarrel(su: number, sv: number, k: number, aspect: number): [number, number] {
  if (Math.abs(k) < 1e-6) return [su, sv];
  let u = 0.5 + (su - 0.5) * 0.7;
  let v = 0.5 + (sv - 0.5) * 0.7;
  const e = 1e-4;
  for (let i = 0; i < 8; i++) {
    const [fu, fv] = barrel(u, v, k, aspect);
    const ru = fu - su;
    const rv = fv - sv;
    if (Math.abs(ru) + Math.abs(rv) < 1e-6) break;
    const [au, av] = barrel(u + e, v, k, aspect);
    const [bu, bv] = barrel(u, v + e, k, aspect);
    const j00 = (au - fu) / e;
    const j10 = (av - fv) / e;
    const j01 = (bu - fu) / e;
    const j11 = (bv - fv) / e;
    const det = j00 * j11 - j01 * j10;
    if (Math.abs(det) < 1e-9) break;
    u -= (j11 * ru - j01 * rv) / det;
    v -= (-j10 * ru + j00 * rv) / det;
  }
  return [u, v];
}
