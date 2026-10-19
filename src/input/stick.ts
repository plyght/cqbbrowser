/**
 * Pure stick/trigger math (PRD §7.4). No DOM; unit-tested in stick.test.ts.
 */

export type CurveKind = 'exponential' | 'linear' | 'classic' | 'custom';

export interface Vec2 {
  x: number;
  y: number;
}

/**
 * Radial deadzone with rescale: magnitudes below `inner` → 0, above `outer` → 1, and the band in between is
 * remapped to 0..1 so the full output range is reachable. Direction is preserved. `anti` (anti-deadzone) lifts the
 * smallest non-zero output to counter a game-side deadzone (rarely needed; default 0).
 */
export function radialDeadzone(x: number, y: number, inner: number, outer: number, anti = 0): Vec2 {
  const m = Math.hypot(x, y);
  if (m <= inner || m === 0) return { x: 0, y: 0 };
  let r = Math.min(1, (m - inner) / Math.max(1e-6, outer - inner));
  if (anti > 0) r = anti + (1 - anti) * r;
  return { x: (x / m) * r, y: (y / m) * r };
}

/** Per-axis deadzone (off by default; for players who want pure cardinal movement near the axes). */
export function axialDeadzone(v: number, dz: number): number {
  const a = Math.abs(v);
  if (a <= dz) return 0;
  return Math.sign(v) * Math.min(1, (a - dz) / Math.max(1e-6, 1 - dz));
}

/**
 * Response curve on a 0..1 magnitude.
 * - exponential: m^exp (default 1.8) — fine aim near centre, full speed at the rim.
 * - linear: m.
 * - classic: the "old console" S-ish curve: cubic blended with linear (0.3·m + 0.7·m³).
 * - custom: m^customExp.
 */
export function applyCurve(m: number, kind: CurveKind, exp = 1.8): number {
  const c = Math.min(1, Math.max(0, m));
  switch (kind) {
    case 'linear':
      return c;
    case 'classic':
      return 0.3 * c + 0.7 * c * c * c;
    case 'exponential':
    case 'custom':
      return Math.pow(c, Math.max(0.1, exp));
  }
}

/** Applies a magnitude curve to a 2D vector, preserving direction. */
export function curveVec(v: Vec2, kind: CurveKind, exp = 1.8): Vec2 {
  const m = Math.hypot(v.x, v.y);
  if (m === 0) return { x: 0, y: 0 };
  const k = applyCurve(m, kind, exp) / m;
  return { x: v.x * k, y: v.y * k };
}

/**
 * Outer-zone turn ramp: once the (post-deadzone) stick magnitude stays above `threshold` for `delay` seconds,
 * the yaw multiplier ramps linearly from 1 to 1 + boost over `time` seconds. Dropping below resets instantly.
 */
export class TurnRamp {
  threshold = 0.92;
  delay = 0.12;
  time = 0.25;
  boost = 0.7;
  private held = 0;
  private dir = 0;

  /** `dir` = sign of the yaw input; reversing direction (a flick through centre) restarts the ramp. */
  update(magnitude: number, dt: number, dir = 0): number {
    const flipped = dir !== 0 && this.dir !== 0 && dir !== this.dir;
    if (dir !== 0) this.dir = dir;
    if (magnitude < this.threshold || flipped) {
      this.held = 0;
      if (magnitude < this.threshold) return 1;
    }
    this.held += dt;
    const t = this.held - this.delay;
    if (t <= 0) return 1;
    return 1 + this.boost * Math.min(1, t / Math.max(1e-6, this.time));
  }

  reset() {
    this.held = 0;
  }
}

/** Trigger deadzone + rescale (0..1). */
export function triggerAxis(v: number, dz = 0.05): number {
  if (v <= dz) return 0;
  return Math.min(1, (v - dz) / (1 - dz));
}
