/** Frame-rate independent exponential smoothing factor for a given half-life (seconds). */
export function damp(halfLife: number, dt: number): number {
  return halfLife <= 0 ? 1 : 1 - Math.pow(2, -dt / halfLife);
}

export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Wrap angle to [-PI, PI]. */
export function wrapAngle(a: number): number {
  a = (a + Math.PI) % (Math.PI * 2);
  if (a < 0) a += Math.PI * 2;
  return a - Math.PI;
}

/**
 * Critically-damped / under-damped spring on a scalar, integrated semi-implicitly.
 * `freq` in Hz, `zeta` damping ratio (1 = critical, <1 overshoots).
 */
export class Spring {
  value = 0;
  velocity = 0;
  constructor(
    public freq = 8,
    public zeta = 1,
  ) {}

  step(target: number, dt: number): number {
    // Sub-step for stability on long frames (semi-implicit Euler is unstable when w*dt is large).
    const w = 2 * Math.PI * this.freq;
    const n = Math.max(1, Math.ceil((dt * w) / 0.25));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      const accel = w * w * (target - this.value) - 2 * this.zeta * w * this.velocity;
      this.velocity += accel * h;
      this.value += this.velocity * h;
    }
    return this.value;
  }

  impulse(v: number) {
    this.velocity += v;
  }

  reset(v = 0) {
    this.value = v;
    this.velocity = 0;
  }
}

/** Deterministic PRNG (mulberry32) — use for anything that must replay identically. */
export function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Cheap smooth 1D value noise in [-1, 1]. */
export function noise1(x: number, seed = 0): number {
  const i = Math.floor(x);
  const f = x - i;
  const h = (n: number) => {
    const s = Math.sin((n + seed * 57.13) * 127.1) * 43758.5453;
    return (s - Math.floor(s)) * 2 - 1;
  };
  const u = f * f * (3 - 2 * f);
  return h(i) * (1 - u) + h(i + 1) * u;
}
