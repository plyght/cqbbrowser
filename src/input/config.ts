import { settings } from '../settings/Settings';
import { DEFAULT_KEY_BINDINGS, DEFAULT_PAD_BINDINGS, type KeyBindings, type PadBindings } from './bindings';
import type { HoldMode } from './buttons';
import type { CurveKind } from './stick';

/**
 * Input settings namespaces (persisted). The settings UI edits these; sources subscribe via get() each frame,
 * so changes apply live.
 */

/** Mouse: real-unit sensitivity (cm/360 at a given DPI) + ADS multiplier + hold/toggle modes. */
export const mouseSettings = settings.ns('input.mouse', {
  cm360: 30,
  dpi: 800,
  adsMultiplier: 0.8,
  invertY: false,
  rawInput: true,
  aimMode: 'hold' as HoldMode,
  crouchMode: 'toggle' as HoldMode,
  sprintMode: 'hold' as HoldMode,
  /** Hold Backspace this long to restart (prevents accidental restarts). */
  restartHold: 0.5,
});

export const keySettings = settings.ns('input.keys', { bindings: DEFAULT_KEY_BINDINGS as KeyBindings });

/** Trackpad preset (§7.3). mode: auto = switch on when the heuristic is confident; UI may ask and set on/off. */
export const trackpadSettings = settings.ns('input.trackpad', {
  mode: 'auto' as 'auto' | 'on' | 'off',
  /** Radians per (OS-accelerated) pixel. */
  sensitivity: 0.0028,
  adsMultiplier: 0.6,
  invertY: false,
  precisionCurve: true,
  /** Gain at very slow glide speeds (px/s ≈ 0). */
  curveLowGain: 0.65,
  /** Speed (px/s) at which gain reaches 1. */
  curveMidSpeed: 450,
  /** Extra gain added by `curveHighSpeed` px/s. */
  curveBoost: 0.35,
  curveHighSpeed: 2200,
  /** ADS micro-adjust zone: deltas slower than this (px/s) get extra reduction. */
  microSpeed: 70,
  microGain: 0.7,
  adsMode: 'toggle' as HoldMode,
  scrollReady: true,
  /** Pixels of two-finger vertical scroll per ready step. */
  scrollThreshold: 60,
  /** Quiet gap (ms) that ends a scroll gesture and re-arms it (kills inertial-scroll spam). */
  scrollGapMs: 160,
  pinch: true,
  edgeGlide: false,
  edgeGlideMinSpeed: 900,
  edgeGlideMaxTime: 0.6,
  snapTurns: false,
  snapDegrees: 90,
  snapTime: 0.12,
});

/** Gamepad (§7.4). Sensitivities are degrees/second at full deflection. */
export const gamepadSettings = settings.ns('input.gamepad', {
  innerDeadzone: 0.08,
  outerDeadzone: 0.97,
  moveInnerDeadzone: 0.1,
  axialDeadzone: 0,
  antiDeadzone: 0,
  curve: 'exponential' as CurveKind,
  curveExponent: 1.8,
  yawSpeed: 330,
  pitchSpeed: 230,
  adsMultiplier: 0.5,
  invertY: false,
  rampThreshold: 0.92,
  rampDelay: 0.12,
  rampTime: 0.25,
  rampBoost: 0.7,
  triggerDeadzone: 0.05,
  crouchMode: 'hybrid' as HoldMode,
  aimMode: 'hold' as HoldMode,
  restartHold: 0.8,
  haptics: true,
  hapticsStrength: 1,
  bindings: DEFAULT_PAD_BINDINGS as PadBindings,
});

export type AssistMode = 'off' | 'light' | 'standard';

/** What each mode does. All three effects are small by design (single-player training aid, not an aimbot). */
export interface AssistTune {
  /** Look-sensitivity reduction when the aim is over a target hitbox (0.3 = 30% slower). */
  slow: number;
  /** Fraction of the target's relative angular motion added while moving and steering. */
  follow: number;
  /** Total ADS-entry pull in degrees. */
  magnetDeg: number;
}
export const ASSIST_TUNE: Record<AssistMode, AssistTune> = {
  off: { slow: 0, follow: 0, magnetDeg: 0 },
  light: { slow: 0.25, follow: 0.2, magnetDeg: 1 },
  standard: { slow: 0.35, follow: 0.35, magnetDeg: 1.5 },
};

/** Hard caps no tune may exceed (also asserted in tests). */
export const ASSIST_CAPS = { slow: 0.35, follow: 0.4, followDegPerSec: 8, magnetDeg: 2 };

export const aimAssistSettings = settings.ns('input.aimAssist', {
  mode: 'light' as AssistMode,
  /** Slowdown stays at full strength within this angle outside the hitbox edge (degrees). */
  innerDeg: 0,
  /** ...and fades smoothly to nothing this far outside the hitbox edge. */
  outerDeg: 3.5,
  /** ADS magnetism only considers targets whose centre is within this cone of the sight line (degrees). */
  magnetConeDeg: 3,
});

export const gyroSettings = settings.ns('input.gyro', {
  enabled: true,
  mode: 'ads' as 'always' | 'ads',
  /** Real-world-to-in-game rotation ratio. */
  sensitivity: 1.6,
  invertYaw: false,
  invertPitch: false,
  /** Small-motion damping threshold (deg/s) below which rotation is attenuated. */
  tightening: 1.5,
});
