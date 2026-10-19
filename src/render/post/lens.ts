/**
 * CAM04 lens model helpers (pure, unit-tested).
 *
 * Output coordinates are in "half-height units": the screen spans x ∈ [-aspect, aspect], y ∈ [-1, 1].
 * Brown–Conrady radial model maps an output point p to the undistorted source point
 *   q = p · (1 + k1·r² + k2·r⁴) · s
 * where `s` is the crop scale chosen so every visible output pixel samples inside the rendered frame.
 */

export function brownConrady(r: number, k1: number, k2: number): number {
  const r2 = r * r;
  return 1 + k1 * r2 + k2 * r2 * r2;
}

/**
 * Largest crop scale `s` such that every output point inside the screen rectangle and inside the image
 * circle (radius `circle`, half-height units; Infinity = no circle) maps inside the source frame.
 */
export function fitScale(k1: number, k2: number, aspect: number, circle = Infinity): number {
  let s = Infinity;
  const test = (x: number, y: number) => {
    const r = Math.hypot(x, y);
    if (r > circle + 1e-6) return;
    const f = brownConrady(r, k1, k2);
    const qx = Math.abs(x * f),
      qy = Math.abs(y * f);
    if (qx > 1e-9) s = Math.min(s, aspect / qx);
    if (qy > 1e-9) s = Math.min(s, 1 / qy);
  };
  const N = 256;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    // Screen rectangle edges (one quadrant is enough: the model is symmetric).
    test(aspect * t, 1);
    test(aspect, t);
    // Image circle arc.
    if (Number.isFinite(circle)) {
      const a = (t * Math.PI) / 2;
      test(Math.min(aspect, Math.cos(a) * circle), Math.min(1, Math.sin(a) * circle));
    }
  }
  return Number.isFinite(s) ? s : 1;
}

export interface LensParams {
  k1: number;
  k2: number;
  /** Crop scale `s` (see fitScale). */
  scale: number;
  /** Image-circle radius, half-height units. */
  circle: number;
}

/** Undistorted lens (identity), used before the renderer reports real values. */
export const IDENTITY_LENS: LensParams = { k1: 0, k2: 0, scale: 1, circle: Infinity };

export interface UV {
  x: number;
  y: number;
}

/**
 * Shader direction: displayed (output) screen UV → undistorted render UV. Exactly the CAM04 lens
 * formula (cSrc in cam04.frag.ts, green channel, without rolling shutter).
 */
export function undistortPoint(uv: UV, aspect: number, lens: LensParams = IDENTITY_LENS): UV {
  const px = (uv.x * 2 - 1) * aspect,
    py = uv.y * 2 - 1;
  const f = brownConrady(Math.hypot(px, py), lens.k1, lens.k2) * lens.scale;
  return { x: ((px * f) / aspect) * 0.5 + 0.5, y: py * f * 0.5 + 0.5 };
}

/**
 * HUD direction: undistorted render UV (e.g. a projected world point) → where it is displayed after the
 * CAM04 lens. Inverts the radial model with Newton iterations. UVs are 0..1, y up (three.js NDC*0.5+0.5).
 */
export function distortPoint(uv: UV, aspect: number, lens: LensParams = IDENTITY_LENS): UV {
  const qx = (uv.x * 2 - 1) * aspect,
    qy = uv.y * 2 - 1;
  const rq = Math.hypot(qx, qy);
  if (rq < 1e-9) return { x: 0.5, y: 0.5 };
  const { k1, k2, scale: s } = lens;
  // Solve g(r) = s·r·(1 + k1 r² + k2 r⁴) − rq = 0.
  let r = rq / s;
  for (let i = 0; i < 12; i++) {
    const r2 = r * r;
    const g = s * r * (1 + k1 * r2 + k2 * r2 * r2) - rq;
    const dg = s * (1 + 3 * k1 * r2 + 5 * k2 * r2 * r2);
    const step = g / dg;
    r -= step;
    if (Math.abs(step) < 1e-9) break;
  }
  const k = r / rq;
  return { x: ((qx * k) / aspect) * 0.5 + 0.5, y: qy * k * 0.5 + 0.5 };
}
