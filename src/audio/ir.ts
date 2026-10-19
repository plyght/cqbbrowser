/**
 * Procedural impulse responses (PRD §9.2): noise × band-limited exponential decays, generated once at load.
 * Pure (Float32Array out) so it can run in tests or a worker.
 */
import { BANK } from './acoustics';
import { clamp, mulberry32, type Rng } from './rng';

export interface IrSpec {
  /** Mid-band RT60, seconds. */
  rt60: number;
  /** RT60 multipliers for the low (<250 Hz) and high (>4 kHz) bands. */
  lowMul: number;
  highMul: number;
  /** Band gains (low, mid, high) of the diffuse tail. */
  bandGain: [number, number, number];
  /** Seconds before the diffuse field is fully dense (sparse early reflections in between). */
  buildUp: number;
  /** Discrete echoes (outdoor slapback off berms, tree lines, buildings): [time s, gain, cutoff Hz]. */
  echoes?: [number, number, number][];
  /** Diffuse tail level relative to the echoes. */
  diffuse?: number;
}

/** Spec per bank entry (same order as BANK in acoustics.ts). */
export const BANK_SPECS: Record<(typeof BANK)[number]['name'], IrSpec> = {
  // Outdoors: mostly dry. A distinct slapback off the berms/baffles, a couple of quieter far echoes and a
  // short, quiet low rumble — not a wash.
  outdoor: {
    rt60: 0.6,
    lowMul: 1.4,
    highMul: 0.35,
    bandGain: [1.0, 0.45, 0.12],
    buildUp: 0.1,
    diffuse: 0.1,
    echoes: [
      [0.12, 0.6, 4500],
      [0.18, 0.75, 4000],
      [0.27, 0.3, 3000],
      [0.42, 0.18, 2200],
      [0.65, 0.1, 1500],
    ],
  },
  covered: {
    rt60: 0.55,
    lowMul: 1.3,
    highMul: 0.5,
    bandGain: [1.0, 0.8, 0.35],
    buildUp: 0.04,
    diffuse: 0.7,
    echoes: [
      [0.09, 0.35, 5000],
      [0.17, 0.3, 3500],
    ],
  },
  // Indoors: short and dense. Small rooms are boomy (long low band) but brief.
  hall: { rt60: 1.0, lowMul: 1.15, highMul: 0.55, bandGain: [1.0, 1.0, 0.55], buildUp: 0.05 },
  room: { rt60: 0.45, lowMul: 1.25, highMul: 0.6, bandGain: [1.2, 1.0, 0.6], buildUp: 0.018 },
  small: { rt60: 0.36, lowMul: 1.45, highMul: 0.55, bandGain: [1.7, 1.0, 0.55], buildUp: 0.008 },
  booth: { rt60: 0.3, lowMul: 1.7, highMul: 0.45, bandGain: [2.4, 1.0, 0.5], buildUp: 0.004 },
};

/** One-pole low-pass coefficient for cutoff fc. */
const onePole = (fc: number, rate: number) => 1 - Math.exp((-2 * Math.PI * fc) / rate);

/** Generate one channel. Energy-normalised so bank entries sit at comparable loudness. */
export function generateIrChannel(spec: IrSpec, rate: number, rng: Rng): Float32Array {
  const lastEcho = spec.echoes?.length ? spec.echoes[spec.echoes.length - 1][0] + 0.25 : 0;
  const len = Math.ceil(clamp(Math.max(spec.rt60 * spec.lowMul * 1.05, lastEcho), 0.2, 2.6) * rate);
  const out = new Float32Array(len);
  const kLo = onePole(250, rate);
  const kHi = onePole(4000, rate);
  const dLo = -6.91 / (spec.rt60 * spec.lowMul * rate);
  const dMid = -6.91 / (spec.rt60 * rate);
  const dHi = -6.91 / (spec.rt60 * spec.highMul * rate);
  const [gLo, gMid, gHi] = spec.bandGain;
  const build = Math.max(1, spec.buildUp * rate);
  const diffuse = spec.diffuse ?? 1;
  let lo = 0,
    lo4 = 0;
  // Running envelopes (cheaper than exp() per sample).
  const mLo = Math.exp(dLo),
    mMid = Math.exp(dMid),
    mHi = Math.exp(dHi);
  let eLo = gLo * diffuse,
    eMid = gMid * diffuse,
    eHi = gHi * diffuse;
  for (let i = 0; i < len; i++) {
    let n = rng() * 2 - 1;
    // Early part: sparse reflections thickening into a dense field.
    if (i < build) {
      const density = (i / build) ** 2;
      n = rng() < 0.02 + density * 0.98 ? n * (1.6 - 0.6 * density) : 0;
    }
    lo += kLo * (n - lo);
    lo4 += kHi * (n - lo4);
    const low = lo;
    const high = n - lo4;
    const mid = lo4 - lo;
    out[i] = low * eLo + mid * eMid + high * eHi;
    eLo *= mLo;
    eMid *= mMid;
    eHi *= mHi;
  }
  // Discrete echoes: short filtered bursts, slightly smeared (a berm isn't a mirror).
  for (const [t, g, fc] of spec.echoes ?? []) {
    const at = Math.floor(t * (1 + (rng() - 0.5) * 0.04) * rate);
    const blen = Math.floor(0.025 * rate);
    const k = onePole(fc, rate);
    let y = 0;
    for (let j = 0; j < blen && at + j < len; j++) {
      const env = j < 24 ? j / 24 : Math.exp((-(j - 24) / blen) * 5);
      y += k * ((rng() * 2 - 1) * env - y);
      out[at + j] += y * g * 6;
    }
  }
  // Fade the last 10 % and normalise energy.
  const fade = Math.floor(len * 0.1);
  for (let i = 0; i < fade; i++) out[len - 1 - i] *= i / fade;
  let e = 0;
  for (let i = 0; i < len; i++) e += out[i] * out[i];
  const norm = 1 / Math.sqrt(Math.max(1e-12, e));
  for (let i = 0; i < len; i++) out[i] *= norm;
  return out;
}

/** Stereo IR (decorrelated channels). */
export function generateIr(spec: IrSpec, rate: number, seed: number): [Float32Array, Float32Array] {
  return [
    generateIrChannel(spec, rate, mulberry32(seed)),
    generateIrChannel(spec, rate, mulberry32(seed * 7 + 1)),
  ];
}

/** Time for the energy envelope to fall 60 dB below its peak (Schroeder backward integration). */
export function measureRt60(ir: Float32Array, rate: number) {
  const n = ir.length;
  const sch = new Float64Array(n);
  let acc = 0;
  for (let i = n - 1; i >= 0; i--) sch[i] = acc += ir[i] * ir[i];
  const top = sch[0];
  // T20-style: fit -5 → -25 dB and extrapolate to 60 dB.
  let t5 = -1,
    t25 = -1;
  for (let i = 0; i < n; i++) {
    const db = 10 * Math.log10(sch[i] / top);
    if (t5 < 0 && db <= -5) t5 = i;
    if (t25 < 0 && db <= -25) {
      t25 = i;
      break;
    }
  }
  if (t5 < 0 || t25 < 0) return NaN;
  return ((t25 - t5) / rate) * 3;
}
