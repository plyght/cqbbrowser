/** Small deterministic helpers shared by the audio code (seeded so offline renders are reproducible). */

export type Rng = () => number;

/** mulberry32: fast 32-bit seeded PRNG in [0, 1). */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const dbToGain = (db: number) => Math.pow(10, db / 20);
export const gainToDb = (g: number) => 20 * Math.log10(Math.max(1e-9, g));
export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * Round-robin variant picker: random order, never the same variant twice in a row, and (with enough
 * variants) avoids the last `floor(n/2)` picks too, so short bursts don't sound machine-gunned.
 */
export class RoundRobin {
  private history: number[] = [];

  constructor(
    readonly size: number,
    private rng: Rng = Math.random,
  ) {}

  next(): number {
    const n = this.size;
    if (n <= 1) return 0;
    const avoid = Math.max(1, Math.floor(n / 2));
    const recent = this.history.slice(-avoid);
    const pool: number[] = [];
    for (let i = 0; i < n; i++) if (!recent.includes(i)) pool.push(i);
    const pick = pool[Math.floor(this.rng() * pool.length)];
    this.history.push(pick);
    if (this.history.length > n) this.history.shift();
    return pick;
  }
}

/** Per-layer variation: pitch ±pct and gain ±db (PRD §9.1: ±3 %, ±1.5 dB). */
export function jitter(rng: Rng, pitchPct = 0.03, gainDb = 1.5) {
  return {
    rate: 1 + (rng() * 2 - 1) * pitchPct,
    gain: dbToGain((rng() * 2 - 1) * gainDb),
  };
}
