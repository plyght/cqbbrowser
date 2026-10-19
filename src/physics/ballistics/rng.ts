/**
 * Small deterministic RNG (mulberry32) for replays: every shot reseeds from (tick, shot index, pellet),
 * so a replay that feeds the same ticks reproduces every round's dispersion, deflection and ricochet.
 */
export class Rng {
  private s = 1;
  private spare = NaN;

  constructor(seed = 1) {
    this.seed(seed);
  }

  seed(n: number) {
    this.s = n >>> 0 || 0x9e3779b9;
    this.spare = NaN;
    return this;
  }

  /** Uniform [0, 1). */
  next(): number {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Standard normal (Box–Muller, pairs cached). */
  gauss(): number {
    if (!Number.isNaN(this.spare)) {
      const s = this.spare;
      this.spare = NaN;
      return s;
    }
    const u = Math.max(1e-12, this.next());
    const v = this.next();
    const r = Math.sqrt(-2 * Math.log(u));
    this.spare = r * Math.sin(2 * Math.PI * v);
    return r * Math.cos(2 * Math.PI * v);
  }
}

/** Integer hash for seeding (tick, counter, salt) → u32. */
export function hashSeed(a: number, b = 0, c = 0): number {
  let h = Math.imul(a | 0, 0x9e3779b1) ^ Math.imul(b | 0, 0x85ebca77) ^ Math.imul(c | 0, 0xc2b2ae3d);
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return h >>> 0;
}
