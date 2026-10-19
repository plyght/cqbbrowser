/**
 * Image-intensifier automatic brightness control (ABC) + bright-source protection (BSP), as a pure function.
 * The GPU state pass in NvgEffect runs exactly this per frame (see `ABC_GLSL`); this mirror is what the unit
 * tests exercise and what CPU-side code (audio whine pitch, HUD) can use for estimates.
 *
 * Gain is in EV (log2 of the amplification applied to scene luminance). The tube aims to output a constant
 * screen brightness: gain falls quickly when the scene brightens (ABC is fast, ~80 ms) and climbs back slowly
 * (~0.35 s), and it's capped at the tube's maximum gain — in a truly black room the image stays dark and
 * noisy instead of being normalised up. A very bright source (flashbang, white light at close range) drives
 * the gain below 0 (BSP) and it takes a moment to recover.
 */
export interface AbcParams {
  /** Target output luminance (scene-linear, before phosphor tint). */
  target: number;
  /** Max tube gain (EV). */
  maxEv: number;
  /** Min gain (EV), BSP floor. */
  minEv: number;
  /** Time constants (s) for the gain going down (brighter scene) / up (darker scene). */
  tauDown: number;
  tauUp: number;
  /** User gain knob in EV (manual gain on the housing, ±). */
  userEv: number;
}

export const ABC_DEFAULTS: AbcParams = {
  target: 0.32,
  maxEv: 9.5,
  minEv: -3,
  tauDown: 0.08,
  tauUp: 0.35,
  userEv: 0,
};

/** Desired gain (EV) for a metered log2 luminance. */
export function abcTarget(meterLog2: number, p: AbcParams = ABC_DEFAULTS): number {
  const want = Math.log2(p.target) - meterLog2 + p.userEv;
  return Math.min(p.maxEv + p.userEv, Math.max(p.minEv, want));
}

/** One controller step: returns the new gain (EV). */
export function abcStep(ev: number, meterLog2: number, dt: number, p: AbcParams = ABC_DEFAULTS): number {
  const tgt = abcTarget(meterLog2, p);
  const tau = tgt < ev ? p.tauDown : p.tauUp;
  return ev + (tgt - ev) * (1 - Math.exp(-dt / Math.max(tau, 1e-3)));
}

/** Noise level 0..1 the image shows at a given gain (scintillation grows as the tube works harder). */
export function abcNoise(ev: number, p: AbcParams = ABC_DEFAULTS): number {
  return Math.min(1, Math.max(0, (ev - 2) / (p.maxEv - 2)));
}

/** GLSL twin of abcTarget/abcStep (uniform vec4 uAbc = target, maxEv, minEv, userEv; vec2 uTau = down, up). */
export const ABC_GLSL = /* glsl */ `
float abcTarget(float meterLog2) {
  float want = log2(uAbc.x) - meterLog2 + uAbc.w;
  return clamp(want, uAbc.z, uAbc.y + uAbc.w);
}
float abcStep(float ev, float meterLog2, float dt) {
  float tgt = abcTarget(meterLog2);
  float tau = tgt < ev ? uTau.x : uTau.y;
  return ev + (tgt - ev) * (1.0 - exp(-dt / max(tau, 1e-3)));
}
`;
