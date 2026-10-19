/** Small keyframe-track helpers shared by the beat graph. Pure, allocation-free. */
export type Ease = 'lin' | 'in' | 'out' | 'io' | 'back' | 'snap';

export function ease(e: Ease | undefined, t: number): number {
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  switch (e) {
    case 'lin':
      return t;
    case 'in':
      return t * t;
    case 'out':
      return 1 - (1 - t) * (1 - t);
    case 'back': {
      // Overshoot then settle (stressed, hurried motion).
      const c = 1.9;
      const u = t - 1;
      return 1 + (c + 1) * u * u * u + c * u * u;
    }
    case 'snap':
      return 1 - Math.pow(1 - t, 4);
    default:
      return t * t * (3 - 2 * t);
  }
}

export interface TimedKey {
  /** Normalised time within the beat, 0..1. */
  t: number;
  e?: Ease;
}

export interface Segment {
  /** Index of the key we're coming from; -1 = the beat's start key (previous beat's last key). */
  from: number;
  /** Index of the key we're heading to; equals keys.length - 1 and u = 1 once past the end. */
  to: number;
  /** Eased progress between them. */
  u: number;
}

/** Finds the active segment for normalised beat time `k`. Writes into `out` (no allocation). */
export function segment(keys: readonly TimedKey[], k: number, out: Segment): Segment {
  const n = keys.length;
  for (let i = 0; i < n; i++) {
    const kt = keys[i].t;
    if (k < kt) {
      const t0 = i === 0 ? 0 : keys[i - 1].t;
      out.from = i - 1;
      out.to = i;
      out.u = ease(keys[i].e, kt - t0 > 1e-6 ? (k - t0) / (kt - t0) : 1);
      return out;
    }
  }
  out.from = n - 2;
  out.to = n - 1;
  out.u = 1;
  return out;
}

export interface NumKey extends TimedKey {
  v: number;
}

const _seg: Segment = { from: 0, to: 0, u: 0 };

/** Samples a scalar track; `start` is the value carried in from the previous beat. */
export function sampleNum(keys: readonly NumKey[], k: number, start: number): number {
  if (!keys.length) return start;
  const s = segment(keys, k, _seg);
  const a = s.from < 0 ? start : keys[s.from].v;
  return a + (keys[s.to].v - a) * s.u;
}
