/**
 * Procedural sound generators (PRD §10.2 item 4). Every function returns plain Float32Array mono data so it
 * can be unit-tested and cached as an AudioBuffer once at load — never per shot.
 */
import { clamp, type Rng } from './rng';

export type Mount = 'chain' | 'hinge' | 'stand';

const TAU = Math.PI * 2;
const alloc = (sec: number, rate: number) => new Float32Array(Math.max(1, Math.ceil(sec * rate)));

/** Sum of exponentially decaying sines. partials: [freq Hz, amp, T60 s, phase?]. */
export function modal(
  out: Float32Array,
  rate: number,
  partials: [number, number, number][],
  at = 0,
  rng?: Rng,
) {
  const start = Math.floor(at * rate);
  for (const [f, a, t60] of partials) {
    if (f >= rate / 2.2) continue;
    const w = (TAU * f) / rate;
    const d = Math.exp(-6.91 / (t60 * rate));
    const ph = rng ? rng() * TAU : 0;
    let env = a;
    const n = Math.min(out.length - start, Math.ceil(t60 * rate * 1.1));
    for (let i = 0; i < n; i++) {
      // 0.3 ms attack to avoid a click.
      const att = i < 15 ? i / 15 : 1;
      out[start + i] += Math.sin(w * i + ph) * env * att;
      env *= d;
    }
  }
  return out;
}

/** Filtered noise burst added in place: one-pole low-pass + optional high-pass, exponential decay. */
export function burst(
  out: Float32Array,
  rate: number,
  rng: Rng,
  opts: { at?: number; dur: number; gain: number; lp?: number; hp?: number; attack?: number },
) {
  const start = Math.floor((opts.at ?? 0) * rate);
  const n = Math.min(out.length - start, Math.ceil(opts.dur * rate));
  const kl = 1 - Math.exp((-TAU * (opts.lp ?? 18000)) / rate);
  const kh = 1 - Math.exp((-TAU * (opts.hp ?? 20)) / rate);
  const att = Math.max(1, (opts.attack ?? 0.0005) * rate);
  let l = 0,
    h = 0;
  for (let i = 0; i < n; i++) {
    const x = rng() * 2 - 1;
    l += kl * (x - l);
    l += kl * (x - l);
    h += kh * (l - h);
    const env = (i < att ? i / att : 1) * Math.exp((-5 * i) / n);
    out[start + i] += (l - h) * env * opts.gain;
  }
  return out;
}

export function normalisePeak(x: Float32Array, peak = 0.9) {
  let m = 0;
  for (const v of x) m = Math.max(m, Math.abs(v));
  if (m > 0) for (let i = 0; i < x.length; i++) x[i] *= peak / m;
  return x;
}

export function noise(sec: number, rate: number, rng: Rng) {
  const out = alloc(sec, rate);
  for (let i = 0; i < out.length; i++) out[i] = rng() * 2 - 1;
  return out;
}

/**
 * Steel plate modal frequencies (Kirchhoff plate: f ∝ c·h/a²). For a free-ish square AR500 plate the first
 * bending mode is ≈ 3283·h/a² Hz (h, a in metres), e.g. 10 mm × 300 mm ≈ 365 Hz.
 */
export const STEEL_RATIOS = [1, 1.58, 2.18, 2.75, 3.43, 4.12, 5.05, 6.2];

export function steelFundamental(sizeM: number, thicknessMm: number) {
  const a = Math.max(0.1, sizeM);
  return clamp((3283 * (thicknessMm / 1000)) / (a * a), 120, 2400);
}

/** Per-partial [freq, amp, T60]: mount sets decay, hit position (0 centre … 1 edge) sets mode weights. */
export function steelPartials(sizeM: number, thicknessMm: number, mount: Mount, hitPos: number) {
  const f0 = steelFundamental(sizeM, thicknessMm);
  const baseT = mount === 'chain' ? 2.6 : mount === 'stand' ? 1.4 : 0.55;
  // Thicker/smaller plates ring a little shorter (more internal loss per cycle at higher f).
  const sizeT = clamp(0.6 + sizeM, 0.6, 1.4);
  return STEEL_RATIOS.map((r, i): [number, number, number] => {
    // Centre hits excite symmetric (odd-index here) modes; edge hits spread energy up the series.
    const sym = i % 2 === 0 ? 1 : 0.35 + 0.65 * hitPos;
    const amp = (sym * (i === 0 ? 0.55 : 1)) / (1 + i * (0.55 - 0.3 * hitPos));
    const t60 = (baseT * sizeT) / (1 + i * 0.45);
    return [f0 * r, amp, t60];
  });
}

/** One steel hit: modal ring + contact 'spit' transient. */
export function steelHit(
  sizeM: number,
  thicknessMm: number,
  mount: Mount,
  hitPos: number,
  rate: number,
  rng: Rng,
) {
  const parts = steelPartials(sizeM, thicknessMm, mount, hitPos).map(
    ([f, a, t]): [number, number, number] => [f * (1 + (rng() - 0.5) * 0.006), a, t],
  );
  const len = Math.max(...parts.map((p) => p[2])) * 1.05;
  const out = alloc(len, rate);
  modal(out, rate, parts, 0, rng);
  burst(out, rate, rng, { dur: 0.012, gain: 0.9, hp: 2500 });
  if (mount === 'hinge') {
    // Popper: the hinge rattles a beat after the hit.
    modal(out, rate, [[parts[0][0] * 0.6, 0.25, 0.12]], 0.035, rng);
    burst(out, rate, rng, { at: 0.03, dur: 0.04, gain: 0.25, lp: 3000, hp: 400 });
  }
  return normalisePeak(out, 0.9);
}

/** Popper hitting the ground: dull heavy clank + dirt thud + a smaller bounce. */
export function steelFallClank(rate: number, rng: Rng) {
  const out = alloc(0.9, rate);
  const f = 180 + rng() * 60;
  modal(
    out,
    rate,
    [
      [f, 0.6, 0.35],
      [f * 2.31, 0.45, 0.25],
      [f * 3.9, 0.3, 0.16],
      [f * 5.4, 0.18, 0.1],
    ],
    0,
    rng,
  );
  burst(out, rate, rng, { dur: 0.09, gain: 0.8, lp: 500 });
  modal(
    out,
    rate,
    [
      [f * 1.05, 0.25, 0.2],
      [f * 2.4, 0.2, 0.15],
    ],
    0.16 + rng() * 0.05,
    rng,
  );
  burst(out, rate, rng, { at: 0.17, dur: 0.05, gain: 0.3, lp: 700 });
  return normalisePeak(out, 0.9);
}

/** Ricochet whizz: band-limited noise + whine sweeping down (Doppler of a tumbling fragment). */
export function whizz(rate: number, rng: Rng) {
  const dur = 0.22 + rng() * 0.25;
  const out = alloc(dur, rate);
  const f1 = 2600 + rng() * 1800;
  const f2 = f1 * (0.45 + rng() * 0.2);
  let ph = 0,
    bp1 = 0,
    bp2 = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / out.length;
    const f = f1 + (f2 - f1) * t;
    ph += (TAU * f) / rate;
    const env = Math.sin(Math.PI * Math.min(1, t * 1.6)) ** 2 * (1 - t);
    const k = (TAU * f) / rate;
    const x = rng() * 2 - 1;
    bp1 += k * 0.3 * (x - bp1);
    bp2 += k * 0.3 * (bp1 - bp2);
    out[i] = (Math.sin(ph + 0.4 * Math.sin(ph * 0.013)) * 0.5 + (bp1 - bp2) * 2.5) * env;
  }
  return normalisePeak(out, 0.7);
}

/** Spall/fragment spit: a scatter of tiny impulses. */
export function spall(rate: number, rng: Rng) {
  const out = alloc(0.08, rate);
  for (let k = 0; k < 14; k++)
    burst(out, rate, rng, { at: rng() * 0.06, dur: 0.004, gain: 0.3 + rng() * 0.5, hp: 3000 });
  return normalisePeak(out, 0.7);
}

/** Low-frequency pressure pulse: one asymmetric half-cycle with a small rarefaction (no Hollywood boom). */
export function pressurePulse(rate: number) {
  const out = alloc(0.12, rate);
  const pos = 0.012;
  for (let i = 0; i < out.length; i++) {
    const t = i / rate;
    if (t < pos) out[i] = Math.sin((Math.PI * t) / pos);
    else out[i] = -0.35 * Math.sin((Math.PI * (t - pos)) / 0.03) * Math.exp(-(t - pos) / 0.03);
  }
  return out;
}

export type MechKind = 'ar' | 'ak' | 'pistol';

/** Close, dry mechanical layer: bolt carrier / slide clacks, buffer spring twang. */
export function mechanical(kind: MechKind, rate: number, rng: Rng) {
  const out = alloc(0.25, rate);
  const j = () => 1 + (rng() - 0.5) * 0.08;
  if (kind === 'pistol') {
    // Slide back + slide forward/lockup.
    modal(
      out,
      rate,
      [
        [2400 * j(), 0.5, 0.03],
        [3900 * j(), 0.4, 0.025],
        [6100 * j(), 0.3, 0.02],
      ],
      0,
      rng,
    );
    burst(out, rate, rng, { dur: 0.008, gain: 0.8, hp: 1500 });
    modal(
      out,
      rate,
      [
        [1800 * j(), 0.6, 0.04],
        [3100 * j(), 0.45, 0.03],
        [5200 * j(), 0.3, 0.02],
      ],
      0.028,
      rng,
    );
    burst(out, rate, rng, { at: 0.028, dur: 0.01, gain: 0.9, hp: 1000 });
  } else {
    const low = kind === 'ak' ? 0.75 : 1;
    // Carrier hits the buffer, then returns into battery.
    modal(
      out,
      rate,
      [
        [1900 * low * j(), 0.5, 0.05],
        [2850 * low * j(), 0.45, 0.04],
        [4400 * low * j(), 0.35, 0.03],
        [7200 * j(), 0.2, 0.02],
      ],
      0.004,
      rng,
    );
    burst(out, rate, rng, { at: 0.004, dur: 0.012, gain: 0.7, hp: 900 });
    modal(
      out,
      rate,
      [
        [1500 * low * j(), 0.55, 0.06],
        [2600 * low * j(), 0.4, 0.045],
        [3800 * low * j(), 0.3, 0.03],
      ],
      0.05,
      rng,
    );
    burst(out, rate, rng, { at: 0.05, dur: 0.012, gain: 0.9, hp: 700 });
    // Buffer spring twang (AR) / heavier rattle (AK).
    const f = (kind === 'ak' ? 150 : 220) * j();
    let ph = 0;
    for (let i = Math.floor(0.006 * rate); i < out.length; i++) {
      const t = i / rate;
      ph += (TAU * f * (1 + 0.15 * Math.exp(-t / 0.02))) / rate;
      out[i] += Math.sin(ph) * 0.18 * Math.exp(-t / 0.06);
    }
  }
  return normalisePeak(out, 0.9);
}

/** Fallback report if no sample is available: N-wave + broadband blast decay. */
export function reportFallback(rate: number, rng: Rng, suppressed: boolean) {
  const out = alloc(0.3, rate);
  const nw = Math.floor(0.0012 * rate);
  for (let i = 0; i < nw * 2; i++) out[i] += i < nw ? 1 - i / nw : -(1 - (i - nw) / nw) * 0.7;
  if (suppressed) {
    burst(out, rate, rng, { dur: 0.09, gain: 0.7, lp: 2200, hp: 120 });
    burst(out, rate, rng, { dur: 0.04, gain: 0.3, hp: 3000 });
  } else {
    burst(out, rate, rng, { dur: 0.06, gain: 1.4, hp: 300 });
    burst(out, rate, rng, { dur: 0.22, gain: 0.8, lp: 1800 });
  }
  return normalisePeak(out, 0.95);
}

/** Body-borne thump (heel strike through chest rig into the mic): LF knock + strap/pouch rattle. */
export function bodyThump(rate: number, rng: Rng) {
  const out = alloc(0.22, rate);
  modal(
    out,
    rate,
    [
      [52 + rng() * 14, 1, 0.14],
      [110 + rng() * 25, 0.5, 0.08],
    ],
    0,
    rng,
  );
  burst(out, rate, rng, { dur: 0.03, gain: 0.4, lp: 400 });
  for (let k = 0; k < 4; k++)
    burst(out, rate, rng, { at: 0.01 + rng() * 0.08, dur: 0.006, gain: 0.08, hp: 2000 });
  return normalisePeak(out, 0.9);
}

/** Brass/shell hitting a surface. hard: tinkle with bounces; soft: dull tick. */
export function brassTinkle(rate: number, rng: Rng, kind: 'rifle' | 'pistol' | 'shell', hard: boolean) {
  const out = alloc(0.5, rate);
  if (kind === 'shell') {
    // Plastic hull with brass head: hollow knock, one bounce.
    for (const [at, g] of [
      [0, 1],
      [0.11 + rng() * 0.05, 0.4],
    ]) {
      modal(
        out,
        rate,
        [
          [650 + rng() * 150, 0.6 * g, 0.05],
          [1500 + rng() * 300, 0.4 * g, 0.03],
        ],
        at,
        rng,
      );
      burst(out, rate, rng, { at, dur: 0.02, gain: 0.4 * g, lp: hard ? 4000 : 1500 });
    }
    return normalisePeak(out, 0.8);
  }
  const base = (kind === 'pistol' ? 5200 : 3900) * (1 + (rng() - 0.5) * 0.1);
  let at = 0;
  let g = 1;
  for (let b = 0; b < (hard ? 4 : 2); b++) {
    if (hard) {
      modal(
        out,
        rate,
        [
          [base, 0.5 * g, 0.12],
          [base * 1.73, 0.4 * g, 0.08],
          [base * 2.62, 0.25 * g, 0.05],
        ],
        at,
        rng,
      );
      burst(out, rate, rng, { at, dur: 0.004, gain: 0.5 * g, hp: 3000 });
    } else {
      burst(out, rate, rng, { at, dur: 0.018, gain: 0.6 * g, lp: 2500, hp: 300 });
    }
    at += 0.06 + rng() * 0.07 * g;
    g *= 0.45 + rng() * 0.15;
  }
  return normalisePeak(out, 0.8);
}

export type StepClass = 'concrete' | 'wood' | 'carpet' | 'grass' | 'gravel' | 'tile' | 'metal' | 'dirt';

/** Footstep fallback per surface class: heel + toe with surface-shaped noise. */
export function footstep(cls: StepClass, rate: number, rng: Rng) {
  const out = alloc(0.32, rate);
  const toe = 0.05 + rng() * 0.03;
  const shape: Record<StepClass, { lp: number; hp: number; dur: number; knock?: number }> = {
    concrete: { lp: 3500, hp: 150, dur: 0.05, knock: 140 },
    tile: { lp: 6000, hp: 300, dur: 0.035, knock: 220 },
    wood: { lp: 2200, hp: 80, dur: 0.06, knock: 110 },
    carpet: { lp: 900, hp: 60, dur: 0.07 },
    grass: { lp: 4500, hp: 900, dur: 0.12 },
    dirt: { lp: 1800, hp: 120, dur: 0.08 },
    gravel: { lp: 6000, hp: 700, dur: 0.16 },
    metal: { lp: 7000, hp: 200, dur: 0.05, knock: 380 },
  };
  const s = shape[cls];
  for (const [at, g] of [
    [0, 1],
    [toe, 0.6],
  ]) {
    burst(out, rate, rng, { at, dur: s.dur, gain: g, lp: s.lp, hp: s.hp });
    if (s.knock) modal(out, rate, [[s.knock * (1 + rng() * 0.2), 0.5 * g, 0.06]], at, rng);
    if (cls === 'gravel')
      for (let k = 0; k < 18; k++)
        burst(out, rate, rng, { at: at + rng() * 0.12, dur: 0.004, gain: 0.4 * g, hp: 1500 });
    if (cls === 'metal')
      modal(
        out,
        rate,
        [
          [1250, 0.15 * g, 0.2],
          [2900, 0.1 * g, 0.15],
        ],
        at,
        rng,
      );
  }
  return normalisePeak(out, 0.85);
}

/** Pivot/slide scuff: longer friction noise, brighter on hard floors. */
export function scuff(cls: StepClass, rate: number, rng: Rng) {
  const hard = cls === 'concrete' || cls === 'tile' || cls === 'metal' || cls === 'wood';
  const dur = 0.16 + rng() * 0.12;
  const out = alloc(dur, rate);
  const kl = 1 - Math.exp((-TAU * (hard ? 4200 : cls === 'gravel' ? 6500 : 2000)) / rate);
  const kh = 1 - Math.exp((-TAU * (hard ? 700 : 250)) / rate);
  let l = 0,
    h = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / out.length;
    const grain = cls === 'gravel' || cls === 'dirt' ? (rng() < 0.08 ? 3 : 0.5) : 1;
    l += kl * ((rng() * 2 - 1) * grain - l);
    h += kh * (l - h);
    out[i] = (l - h) * Math.sin(Math.PI * t) ** 0.7 * (1 + 0.4 * Math.sin(t * 40));
  }
  return normalisePeak(out, 0.7);
}

/** Generic hard-surface impact (mag drop fallback). */
export function impact(rate: number, rng: Rng, hard: boolean, polymer: boolean) {
  const out = alloc(0.35, rate);
  const f = polymer ? 700 : 1100;
  modal(
    out,
    rate,
    [
      [f * (1 + rng() * 0.2), 0.5, 0.06],
      [f * 2.4, 0.35, 0.04],
      [f * 4.1, polymer ? 0.1 : 0.3, 0.05],
    ],
    0,
    rng,
  );
  burst(out, rate, rng, { dur: 0.03, gain: 0.8, lp: hard ? 5000 : 900 });
  burst(out, rate, rng, { at: 0.07 + rng() * 0.04, dur: 0.02, gain: 0.3, lp: hard ? 4000 : 700 });
  return normalisePeak(out, 0.85);
}

/** Small metallic click (dry fire, mag release, safety). */
export function click(rate: number, rng: Rng, pitch = 1) {
  const out = alloc(0.08, rate);
  modal(
    out,
    rate,
    [
      [3100 * pitch, 0.5, 0.025],
      [5400 * pitch, 0.4, 0.018],
      [8200 * pitch, 0.25, 0.012],
    ],
    0,
    rng,
  );
  burst(out, rate, rng, { dur: 0.004, gain: 0.8, hp: 2000 });
  return normalisePeak(out, 0.8);
}

/** Loose gear rattle (stressed reloads, running): many tiny clicks. */
export function rattle(rate: number, rng: Rng) {
  const out = alloc(0.3, rate);
  for (let k = 0; k < 10; k++)
    modal(out, rate, [[1800 + rng() * 3000, 0.2 + rng() * 0.3, 0.02]], rng() * 0.25, rng);
  return normalisePeak(out, 0.6);
}

/** Fabric/handling rumble for the hand-on-camera muffle. */
export function handling(rate: number, rng: Rng) {
  const out = alloc(0.5, rate);
  burst(out, rate, rng, { dur: 0.45, gain: 1, lp: 600, hp: 40, attack: 0.03 });
  burst(out, rate, rng, { at: 0.05, dur: 0.3, gain: 0.3, lp: 3000, hp: 800, attack: 0.02 });
  return normalisePeak(out, 0.8);
}

/** Outdoor bed fallback: brown-ish noise with slow wind swells (stereo handled by caller via two seeds). */
export function windBed(sec: number, rate: number, rng: Rng) {
  const out = alloc(sec, rate);
  let b = 0,
    s = 0;
  for (let i = 0; i < out.length; i++) {
    b = 0.995 * b + 0.05 * (rng() * 2 - 1);
    s += 0.00002 * ((rng() * 2 - 1) * 40 - s);
    const swell = 0.6 + 0.4 * Math.sin((TAU * i) / out.length) * Math.sin((TAU * 3 * i) / out.length + 1);
    out[i] = b * swell;
  }
  // Seamless loop: crossfade the last 0.5 s into the start.
  const xf = Math.floor(0.5 * rate);
  for (let i = 0; i < xf; i++) {
    const t = i / xf;
    out[i] = out[i] * t + out[out.length - xf + i] * (1 - t);
  }
  return normalisePeak(out.subarray(0, out.length - xf).slice(), 0.5);
}
