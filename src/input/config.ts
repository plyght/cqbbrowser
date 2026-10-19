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
  aimAssist: false,
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

export type AssistLevel = 'arcade' | 'standard' | 'hardcore' | 'custom';
export const ASSIST_PRESET: Record<Exclude<AssistLevel, 'custom'>, number> = {
  arcade: 0.6,
  standard: 0.35,
  hardcore: 0,
};

export const aimAssistSettings = settings.ns('input.aimAssist', {
  level: 'standard' as AssistLevel,
  /** 0..1, used when level = custom. */
  custom: 0.35,
  /** Full friction inside this cone (degrees from the weapon aim ray). */
  innerDeg: 1.2,
  /** Friction fades to zero at this cone. */
  outerDeg: 4.5,
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
