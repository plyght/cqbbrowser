/** Pure render metrics for offline checks (crest factor, decay time, wet/dry ratio). Mono Float32 input. */

const db = (x: number) => 10 * Math.log10(x + 1e-20);

/** Index of the largest |x| in [from, to) seconds. */
export function peakIndex(x: Float32Array, rate: number, from: number, to: number) {
  let pk = Math.floor(from * rate);
  const end = Math.min(x.length, Math.floor(to * rate));
  for (let i = pk; i < end; i++) if (Math.abs(x[i]) > Math.abs(x[pk])) pk = i;
  return pk;
}

/** Crest factor: sample peak vs RMS over `win` seconds from the peak (dB). */
export function crestDb(x: Float32Array, rate: number, pk: number, win = 0.05) {
  const n = Math.floor(win * rate);
  let e = 0;
  for (let i = pk; i < Math.min(x.length, pk + n); i++) e += x[i] * x[i];
  return 20 * Math.log10(Math.abs(x[pk]) + 1e-20) - db(e / n);
}

/**
 * Decay time (RT60 estimate) from Schroeder backward integration over [pk, pk + win): fit −5 → −25 dB (T20) and
 * extrapolate ×3. Returns NaN if the energy never falls 25 dB inside the window.
 */
export function decayRt60(x: Float32Array, rate: number, pk: number, win = 1.6) {
  const end = Math.min(x.length, pk + Math.floor(win * rate));
  const sch = new Float64Array(end - pk);
  let acc = 0;
  for (let i = end - 1; i >= pk; i--) sch[i - pk] = acc += x[i] * x[i];
  const top = sch[0];
  let t5 = -1;
  for (let i = 0; i < sch.length; i++) {
    const d = db(sch[i] / top);
    if (t5 < 0 && d <= -5) t5 = i;
    if (d <= -25) return t5 < 0 ? NaN : ((i - t5) / rate) * 3;
  }
  return NaN;
}

/** Wet/dry energy ratio (dB) over [pk, pk + win), from a wet-only and a dry-only render of the same events. */
export function wetDryDb(wet: Float32Array, dry: Float32Array, rate: number, pk: number, win = 1.0) {
  let ew = 0,
    ed = 0;
  const end = Math.min(wet.length, dry.length, pk + Math.floor(win * rate));
  for (let i = pk; i < end; i++) {
    ew += wet[i] * wet[i];
    ed += dry[i] * dry[i];
  }
  return db(ew) - db(ed);
}

export const mono = (l: Float32Array, r: Float32Array) => {
  const m = new Float32Array(l.length);
  for (let i = 0; i < l.length; i++) m[i] = (l[i] + r[i]) / 2;
  return m;
};
