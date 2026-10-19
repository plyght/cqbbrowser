import { ASSIST_PRESET, aimAssistSettings, type AssistLevel } from './config';

const DEG = Math.PI / 180;

/**
 * Friction factor (0..1 multiplier on look deltas) for a given angular distance from the weapon aim ray to the
 * nearest shootable target. Full `strength` inside `inner`, smoothstep fade to none at `outer`.
 */
export function frictionFactor(angle: number, strength: number, inner: number, outer: number): number {
  if (!(angle < outer) || strength <= 0) return 1;
  const t = angle <= inner ? 1 : 1 - (angle - inner) / Math.max(1e-6, outer - inner);
  const s = t * t * (3 - 2 * t);
  return 1 - Math.min(1, strength) * s;
}

/** 1 below 60% intensity, smoothly 0 at full intensity. */
export function fastTurnFade(intensity: number): number {
  const t = Math.max(0, Math.min(1, (intensity - 0.6) / 0.4));
  return 1 - t * t * (3 - 2 * t);
}

export function assistStrength(level: AssistLevel, custom: number): number {
  return level === 'custom' ? Math.max(0, Math.min(1, custom)) : ASSIST_PRESET[level];
}

/**
 * Rotational slowdown only (PRD §7.4): no snap, no magnetism. The game sets `provider`, which returns the angle
 * (radians) between the *weapon aim ray* and the nearest shootable target (Infinity when none). No-shoots must be
 * excluded by the provider so the assist never pulls you into a penalty.
 */
export class AimAssist {
  provider: () => number = () => Infinity;
  /** Last factor applied (for debug/UI). */
  lastFactor = 1;

  strength(): number {
    const s = aimAssistSettings.get();
    return assistStrength(s.level, s.custom);
  }

  /**
   * Scales a look delta in place. Only queries the provider when there is look input and assist is on.
   * `intensity` (0..1, e.g. post-curve stick magnitude) fades friction out for full-speed turns so sweeping past
   * targets never feels sticky; fine aiming (low intensity) gets the full effect.
   */
  apply(look: { yaw: number; pitch: number }, intensity = 0): void {
    this.lastFactor = 1;
    if (look.yaw === 0 && look.pitch === 0) return;
    const strength = this.strength() * fastTurnFade(intensity);
    if (strength <= 0) return;
    const s = aimAssistSettings.get();
    const k = frictionFactor(this.provider(), strength, s.innerDeg * DEG, s.outerDeg * DEG);
    this.lastFactor = k;
    look.yaw *= k;
    look.pitch *= k;
  }
}
