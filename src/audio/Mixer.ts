/**
 * The Web Audio graph. Two paths into the CAM04 microphone stage:
 *   shot path: report/crack/thump/pressure/mechanical + reverb tail → wide-band capsule (keeps the 40–120 Hz
 *              punch), never compressed, so the transient survives;
 *   bed path:  ambience, foley, footsteps, wind, body thumps → small-capsule EQ → AGC duck (pumps down on
 *              every shot and breathes back over ~1 s).
 * Both → handling muffle → parallel saturation (clean + tanh-driven) → soft ceiling at −1 dBFS → out.
 *
 * Budget (60–120 fps owner requirement): ≤ 2 convolvers, ≤ MAX_VOICES one-shot voices with stealing, all
 * buffers made once at load. Native nodes only: 4×-oversampled WaveShapers do the clipping and the AGC is a
 * scheduled gain envelope, so an AudioWorklet would add setup cost without an audible gain.
 */
import { BANK, convolverMix, bankPosition, wetLevel, type Acoustics } from './acoustics';
import { clamp, dbToGain } from './rng';
import type { ListeningMode } from './settings';

/**
 * One-shot voice budget. A long-gun shot is ~7 voices (action, report ×2, blast core, roll, thump, pressure)
 * whose tails run 0.2–0.7 s, so an 850 rpm string holds ~32 at once; 48 lets strings overlap without stealing
 * tails (brass and foley included).
 */
export const MAX_VOICES = 48;
const TAPS = 6;

export interface PlayOpts {
  /** Absolute context time; default now. */
  at?: number;
  gain?: number;
  rate?: number;
  /** -1..1 */
  pan?: number;
  /** Reverb + early-reflection send amount (post-fader). */
  send?: number;
  /** Tail-only send (convolver, no ER taps): close foley gets a little room without comb filtering. */
  room?: number;
  /** Low-pass cutoff Hz (distance/air absorption, occlusion, muffling). */
  lp?: number;
  hp?: number;
  /** Peaking boost at ~3 kHz in dB (barrel harshness). */
  presenceDb?: number;
  /** Resonant boost [freq, dB, Q] (pressure layer room mode). */
  peak?: [number, number, number];
  /** shot = uncompressed wide-band gunshot path; dry (default) = bed path (foley, steps); thump/amb. */
  bus?: 'shot' | 'dry' | 'thump' | 'amb' | 'ui';
  /** Higher survives voice stealing. */
  prio?: number;
  loop?: boolean;
}

interface Voice {
  src: AudioBufferSourceNode;
  out: GainNode;
  start: number;
  end: number;
  prio: number;
}

/** Waveshaper input is pre-scaled by 1/HEADROOM so ±HEADROOM of signal maps onto the curve. */
const HEADROOM = 4;
/** −1 dBFS. */
export const CEILING = 0.891;

/** Soft ceiling: unity gain for small signals, tanh knee into ±CEILING (lookahead-free limiter). */
export function ceilingCurve(n = 4096) {
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = ((i / (n - 1)) * 2 - 1) * HEADROOM;
    c[i] = CEILING * Math.tanh(x / CEILING);
  }
  return c;
}

export const SAFE_KNEE = 0.8;
export const SAFE_MAX = 0.98;
/**
 * Output safety curve over the shaper's ±1 input range (inputs beyond ±1 hold the end value): identity up to
 * SAFE_KNEE, then a tanh knee towards ±SAFE_MAX.
 */
export function safetyCurve(n = 8193) {
  const c = new Float32Array(n);
  const room = SAFE_MAX - SAFE_KNEE;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    const a = Math.abs(x);
    c[i] = Math.sign(x) * (a <= SAFE_KNEE ? a : SAFE_KNEE + room * Math.tanh((a - SAFE_KNEE) / room));
  }
  return c;
}

/** Saturation for the parallel "overloaded capsule" path: unity small-signal gain, saturates at 1/drive. */
export function saturationCurve(drive: number, n = 4096) {
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = ((i / (n - 1)) * 2 - 1) * HEADROOM;
    c[i] = Math.tanh(x * drive) / drive;
  }
  return c;
}

/**
 * Asymmetric capsule-overload curve: unity small-signal gain, the positive half saturates earlier than the
 * negative one (diaphragm/preamp asymmetry → even harmonics). drive 0 = identity.
 */
export function overloadCurve(drive: number, n = 4096) {
  const c = new Float32Array(n);
  const b = 0.3;
  const k = Math.max(1e-3, drive);
  const slope = k * (1 - Math.tanh(k * b) ** 2);
  for (let i = 0; i < n; i++) {
    const x = ((i / (n - 1)) * 2 - 1) * HEADROOM;
    c[i] = drive <= 0 ? x : (Math.tanh(k * (x + b)) - Math.tanh(k * b)) / slope;
  }
  return c;
}

interface ModeSpec {
  /** Small-capsule EQ amount on the bed path (0 = flat). */
  eq: number;
  /** Shot path level, dB. */
  shotDb: number;
  /** Bed path level, dB. */
  bedDb: number;
  /** AGC duck depth on a full-energy close shot (dB) and its recovery time constant (s). */
  duckDb: number;
  duckTau: number;
  /** Parallel saturation mix (0..1) and drive. */
  sat: number;
  drive: number;
  /** Shot-path capsule overload drive (asymmetric soft clip); 0 = clean. */
  overload: number;
  artifacts: number;
}

const MODES: Record<ListeningMode, ModeSpec> = {
  // What CAM04 records: shots slam into the soft ceiling, everything else ducks and breathes back.
  footage: {
    eq: 1,
    shotDb: 5,
    bedDb: 0,
    duckDb: 14,
    duckTau: 0.32,
    sat: 0.7,
    drive: 3.5,
    overload: 1.0,
    artifacts: 1,
  },
  // Electronic ear-pro: shots clamped, quiet sounds lifted, fast protective release.
  earpro: {
    eq: 0.15,
    shotDb: -9,
    bedDb: 5,
    duckDb: 16,
    duckTau: 0.12,
    sat: 0,
    drive: 1,
    overload: 0,
    artifacts: 0.2,
  },
  // Bare ears: no mic, little saturation; dulling + tinnitus come from exposure().
  noprotect: {
    eq: 0,
    shotDb: 3,
    bedDb: 0,
    duckDb: 3,
    duckTau: 0.5,
    sat: 0.2,
    drive: 1.5,
    overload: 0.4,
    artifacts: 0,
  },
};

export class Mixer {
  readonly dry: GainNode;
  readonly send: GainNode;
  readonly thump: GainNode;
  readonly amb: GainNode;
  readonly wind: GainNode;
  private sfx: GainNode;
  private wet: GainNode;
  private predelay: DelayNode;
  private conv: [ConvolverNode, ConvolverNode];
  private convGain: [GainNode, GainNode];
  private convIndex: [number, number] = [-1, -1];
  private irs: AudioBuffer[] = [];
  private roomBoost: BiquadFilterNode;
  private taps: { delay: DelayNode; lp: BiquadFilterNode; gain: GainNode; pan: StereoPannerNode }[] = [];
  private eq: { hp: BiquadFilterNode; presence: BiquadFilterNode; shelf: BiquadFilterNode };
  private artifacts: GainNode;
  readonly shot: GainNode;
  private shotLevel: GainNode;
  private bedLevel: GainNode;
  private duckGain: GainNode;
  private muffleLp: BiquadFilterNode;
  private muffleGain: GainNode;
  private cleanMix: GainNode;
  private satMix: GainNode;
  private saturator: WaveShaperNode;
  private dull: BiquadFilterNode;
  private tailSend: GainNode;
  /** Everything reflected (tail + early taps); offline metrics mute it to measure the dry part. */
  readonly wetOut: GainNode;
  /** Direct (unreflected) shot-path voices; offline metrics mute it to measure the wet part alone. */
  readonly direct: GainNode;
  /** Non-diegetic UI sounds: straight to master, past the mic. */
  readonly ui: GainNode;
  private sfxShot: GainNode;
  private overload!: WaveShaperNode;
  /** Fixed 30–80 ms early cluster (ground + nearby baffles): gives every shot its size, outdoors too. */
  private cluster: GainNode;
  readonly master: GainNode;
  private tinnitus: GainNode;
  private windL: GainNode;
  private windR: GainNode;
  private windSrc?: AudioBufferSourceNode;
  private voices: Voice[] = [];
  mode: ListeningMode = 'footage';
  artifactLevel = 1;
  /** Count of voices stolen (perf telemetry/tests). */
  stolen = 0;
  dropped = 0;
  /** Highest concurrent one-shot voice count seen. */
  peakVoices = 0;

  constructor(readonly ctx: BaseAudioContext) {
    const c = ctx;
    const g = (v = 1) => {
      const n = c.createGain();
      n.gain.value = v;
      return n;
    };
    const bq = (type: BiquadFilterType, f: number, q = 0.707, gain = 0) => {
      const n = c.createBiquadFilter();
      n.type = type;
      n.frequency.value = f;
      n.Q.value = q;
      n.gain.value = gain;
      return n;
    };

    // --- Output chain (built from the end backwards) ---------------------------------------------------
    this.master = g(0.8);
    // Output safety: the soft ceiling's 4× resampling filters can overshoot it by a few dB on dense, bright
    // clipped blasts (rifle full auto), and the master slider sits after it. Identity below SAFE_KNEE, so normal
    // material (every pistol shot) passes untouched; overs bend smoothly into ±SAFE_MAX instead of hard clipping.
    const safety = c.createWaveShaper();
    safety.curve = safetyCurve();
    this.master.connect(safety).connect(c.destination);
    this.ui = g(1);
    this.ui.connect(this.master);
    const ceiling = c.createWaveShaper();
    ceiling.oversample = '4x';
    ceiling.curve = ceilingCurve();
    ceiling.connect(this.master);
    this.dull = bq('lowpass', 20000, 0.5);
    const ceilPre = g(1 / HEADROOM);
    this.dull.connect(ceilPre).connect(ceiling);
    // Parallel saturation: the clean path keeps the transient, the driven path adds overload density.
    const satSum = g(1);
    satSum.connect(this.dull);
    this.cleanMix = g(1);
    this.cleanMix.connect(satSum);
    this.saturator = c.createWaveShaper();
    this.saturator.oversample = '4x';
    this.saturator.curve = saturationCurve(MODES.footage.drive);
    this.satMix = g(0);
    const satPre = g(1 / HEADROOM);
    satPre.connect(this.saturator).connect(this.satMix).connect(satSum);
    this.muffleGain = g(1);
    this.muffleGain.connect(this.cleanMix);
    this.muffleGain.connect(satPre);
    this.muffleLp = bq('lowpass', 20000, 0.6);
    this.muffleLp.connect(this.muffleGain);
    const mix = g(1);
    mix.connect(this.muffleLp);

    // Tinnitus (no-protection mode): a quiet high whine, post-mic.
    const osc = c.createOscillator();
    osc.frequency.value = 6800;
    this.tinnitus = g(0);
    osc.connect(this.tinnitus).connect(this.master);
    osc.start();

    // --- Shot path: wide-band (the capsule overloads; low end survives), never compressed ----------------
    this.shotLevel = g(1);
    this.shotLevel.connect(mix);
    this.shot = g(1);
    const shotHp = bq('highpass', 32, 0.7);
    const shotPresence = bq('peaking', 3400, 1, 2.5);
    // Capsule overload: asymmetric soft clip (even + odd harmonics) on the shot path only, before the shared
    // parallel saturator — this is where a bodycam gunshot gets its dense, slightly torn texture.
    const overloadPre = g(1 / HEADROOM);
    const dcBlock = bq('highpass', 22, 0.7); // asymmetric clipping makes DC on loud shots
    this.overload = c.createWaveShaper();
    this.overload.oversample = '4x';
    this.overload.curve = overloadCurve(MODES.footage.overload);
    this.shot
      .connect(shotHp)
      .connect(shotPresence)
      .connect(overloadPre)
      .connect(this.overload)
      .connect(dcBlock)
      .connect(this.shotLevel);

    // --- Bed path: small-capsule EQ → AGC duck ------------------------------------------------------------
    this.bedLevel = g(1);
    this.bedLevel.connect(mix);
    this.duckGain = g(1);
    this.duckGain.connect(this.bedLevel);
    const micIn = g(1);
    this.eq = {
      hp: bq('highpass', 120, 0.8),
      presence: bq('peaking', 3200, 1.1, 5),
      shelf: bq('highshelf', 9000, 0.7, -5),
    };
    micIn.connect(this.eq.hp).connect(this.eq.presence).connect(this.eq.shelf).connect(this.duckGain);

    // Mic artefacts (wind on the capsule, body-borne thumps) skip the acoustic EQ but still pump.
    this.artifacts = g(1);
    this.artifacts.connect(this.duckGain);
    this.wind = g(1);
    this.wind.connect(this.artifacts);
    this.thump = g(1);
    const thumpLp = bq('lowpass', 900, 0.7);
    this.thump.connect(thumpLp).connect(this.artifacts);

    // --- SFX: dry (bed) + shot path; reverb tail joins the shot path (thinner) -------------------------
    this.sfx = g(1);
    this.sfx.connect(micIn);
    this.dry = g(1);
    this.dry.connect(this.sfx);
    this.sfxShot = g(1);
    this.wetOut = g(1);
    this.wetOut.connect(this.sfxShot);
    this.sfxShot.connect(this.shot);
    this.direct = g(1);
    this.direct.connect(this.sfxShot);
    this.wet = g(0.4);
    this.roomBoost = bq('peaking', 100, 1.5, 0);
    const wetHp = bq('highpass', 70, 0.7);
    this.wet.connect(this.roomBoost).connect(wetHp).connect(this.wetOut);
    this.send = g(1);
    this.tailSend = g(1);
    this.predelay = c.createDelay(0.2);
    this.predelay.delayTime.value = 0.01;
    this.send.connect(this.predelay);
    this.tailSend.connect(this.predelay);
    this.conv = [c.createConvolver(), c.createConvolver()];
    this.convGain = [g(0), g(0)];
    for (let i = 0; i < 2; i++) {
      this.conv[i].normalize = false;
      this.predelay.connect(this.conv[i]).connect(this.convGain[i]).connect(this.wet);
    }
    // Early reflections: fixed pool of taps re-tuned by the probe (fed by `send`, not by `room`).
    const erIn = g(1);
    this.send.connect(erIn);
    for (let i = 0; i < TAPS; i++) {
      const delay = c.createDelay(1);
      delay.delayTime.value = 0.01 + i * 0.005;
      const lp = bq('lowpass', 8000, 0.5);
      const gain = g(0);
      const pan = c.createStereoPanner();
      erIn.connect(delay).connect(lp).connect(gain).connect(pan).connect(this.wetOut);
      this.taps.push({ delay, lp, gain, pan });
    }
    this.cluster = g(0.8);
    this.cluster.connect(this.wetOut);
    for (const [d, gn, p, lpf] of [
      [0.031, 0.3, -0.45, 6500],
      [0.043, 0.24, 0.4, 5500],
      [0.058, 0.17, -0.2, 4500],
      [0.077, 0.11, 0.3, 3500],
    ]) {
      const delay = c.createDelay(0.1);
      delay.delayTime.value = d;
      const lp = bq('lowpass', lpf, 0.5);
      const gain = g(gn);
      const pan = c.createStereoPanner();
      pan.pan.value = p;
      erIn.connect(delay).connect(lp).connect(gain).connect(pan).connect(this.cluster);
    }

    // --- Ambience (heard through the same mic, so the AGC ducks it after shots) -------------------------
    this.amb = g(1);
    this.amb.connect(micIn);

    // --- Wind: decorrelated stereo noise, per-side gain ----------------------------------------------
    this.windL = g(0);
    this.windR = g(0);
    const merger = c.createChannelMerger(2);
    this.windL.connect(merger, 0, 0);
    this.windR.connect(merger, 0, 1);
    merger.connect(this.wind);

    this.setMode('footage');
  }

  /** Wind source: a looping stereo noise buffer split into two band-passed sides. */
  startWind(noise: AudioBuffer) {
    const c = this.ctx;
    const src = c.createBufferSource();
    src.buffer = noise;
    src.loop = true;
    const split = c.createChannelSplitter(2);
    src.connect(split);
    for (const [ch, out] of [
      [0, this.windL],
      [1, this.windR],
    ] as const) {
      const bp = c.createBiquadFilter();
      bp.type = 'lowpass';
      bp.frequency.value = 520;
      bp.Q.value = 0.5;
      const hp = c.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 35;
      split.connect(bp, ch).connect(hp).connect(out);
    }
    src.start();
    this.windSrc = src;
  }

  /** Per-side wind gain (0..1), smoothed. */
  setWind(left: number, right: number, at = this.ctx.currentTime) {
    this.windL.gain.setTargetAtTime(left, at, 0.12);
    this.windR.gain.setTargetAtTime(right, at, 0.12);
  }

  setReverbBank(irs: AudioBuffer[]) {
    this.irs = irs;
    this.convIndex = [-1, -1];
  }

  /**
   * Drive reverb + early reflections from (smoothed) acoustics. Convolver buffers are swapped only on the
   * convolver whose weight is ~0 (even/odd assignment, see convolverMix).
   */
  applyAcoustics(a: Acoustics, opts: { snap?: boolean; at?: number } = {}) {
    const t = opts.at ?? this.ctx.currentTime;
    const tau = opts.snap ? 0.001 : 0.08;
    const mix = convolverMix(bankPosition(a));
    const parts = [mix.a, mix.b];
    for (let i = 0; i < 2; i++) {
      const p = parts[i];
      // Swap only while this convolver is (nearly) silent: at its zero-weight point, or after it was muted
      // because smoothing jumped past that point.
      const silent = p.gain < 0.02 || this.convGain[i].gain.value < 0.02 || this.convIndex[i] < 0;
      if (this.irs.length && this.convIndex[i] !== p.index && (silent || opts.snap)) {
        this.conv[i].buffer = this.irs[p.index];
        this.convIndex[i] = p.index;
      }
      const ok = this.convIndex[i] === p.index;
      this.convGain[i].gain.setTargetAtTime(ok ? p.gain : 0, t, tau);
    }
    this.wet.gain.setTargetAtTime(wetLevel(a), t, tau);
    this.predelay.delayTime.setTargetAtTime(a.predelay, t, tau);
    this.roomBoost.frequency.setTargetAtTime(clamp(a.roomMode * 1.2, 40, 220), t, tau);
    this.roomBoost.gain.setTargetAtTime(a.bass * 10, t, tau);
    // ER taps: outdoors they are the slapback off berms; indoors the dense first reflections.
    const erScale = 0.6 * (0.35 + 0.65 * Math.max(a.enclosure, 0.4));
    // The fixed size cluster dominates outdoors; indoors the probe's own taps take over.
    this.cluster.gain.setTargetAtTime(0.9 - 0.45 * a.enclosure, t, tau);
    for (let i = 0; i < TAPS; i++) {
      const tap = a.taps[i];
      const n = this.taps[i];
      if (!tap) {
        n.gain.gain.setTargetAtTime(0, t, tau);
        continue;
      }
      n.delay.delayTime.setTargetAtTime(Math.min(0.99, tap.delay), t, opts.snap ? 0.001 : 0.15);
      n.lp.frequency.setTargetAtTime(tap.cutoff, t, tau);
      n.gain.gain.setTargetAtTime(tap.gain * erScale, t, tau);
      n.pan.pan.setTargetAtTime(tap.pan, t, tau);
    }
  }

  /** Bank of IR names (for debugging). */
  get reverbState() {
    return { a: BANK[this.convIndex[0]]?.name, b: BANK[this.convIndex[1]]?.name };
  }

  setMode(mode: ListeningMode) {
    this.mode = mode;
    const m = MODES[mode];
    const t = this.ctx.currentTime;
    this.eq.hp.frequency.setValueAtTime(20 + 100 * m.eq, t);
    this.eq.presence.gain.setValueAtTime(5 * m.eq, t);
    this.eq.shelf.gain.setValueAtTime(-5 * m.eq, t);
    this.shotLevel.gain.setValueAtTime(dbToGain(m.shotDb), t);
    this.bedLevel.gain.setValueAtTime(dbToGain(m.bedDb), t);
    this.saturator.curve = saturationCurve(m.drive);
    this.overload.curve = overloadCurve(m.overload);
    this.satMix.gain.setValueAtTime(m.sat, t);
    this.cleanMix.gain.setValueAtTime(1 - m.sat * 0.5, t);
    this.applyArtifacts();
    if (mode !== 'noprotect') this.exposure(0, 0);
  }

  /** Measurement only: bypass every saturator and scale the shot path down so the chain is linear. */
  setLinear(level: number) {
    const t = this.ctx.currentTime;
    this.satMix.gain.setValueAtTime(0, t);
    this.cleanMix.gain.setValueAtTime(1, t);
    this.overload.curve = overloadCurve(0);
    this.shotLevel.gain.setValueAtTime(level, t);
  }

  /**
   * AGC pumping: the bed (ambience, foley, wind) ducks on a loud close sound and breathes back up.
   * `amount` 0..1 scales the mode's depth (shot energy × closeness).
   */
  duck(amount: number, at = this.ctx.currentTime) {
    const m = MODES[this.mode];
    const depth = dbToGain(-m.duckDb * clamp(amount, 0, 1.3));
    const p = this.duckGain.gain;
    p.cancelScheduledValues(at);
    p.setTargetAtTime(depth, at, 0.003);
    p.setTargetAtTime(1, at + 0.05, m.duckTau);
  }

  setArtifactLevel(v: number) {
    this.artifactLevel = v;
    this.applyArtifacts();
  }

  private applyArtifacts() {
    this.artifacts.gain.setValueAtTime(MODES[this.mode].artifacts * this.artifactLevel, this.ctx.currentTime);
  }

  setLevels(master: number, sfx: number, ambience: number) {
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(master, t, 0.02);
    this.sfx.gain.setTargetAtTime(sfx, t, 0.02);
    this.sfxShot.gain.setTargetAtTime(sfx, t, 0.02);
    this.amb.gain.setTargetAtTime(ambience, t, 0.02);
  }

  /** Hand on camera: low-pass + dip (PRD §9.6). */
  muffle(active: boolean, at = this.ctx.currentTime) {
    this.muffleLp.frequency.setTargetAtTime(active ? 750 : 20000, at, active ? 0.04 : 0.12);
    this.muffleGain.gain.setTargetAtTime(active ? 0.55 : 1, at, 0.06);
  }

  /** No-protection hearing: tinnitus whine level and temporary dulling (0 = none … 1 = heavy). */
  exposure(level: number, recover: number, at = this.ctx.currentTime) {
    const l = clamp(level, 0, 1);
    this.tinnitus.gain.cancelScheduledValues(at);
    this.tinnitus.gain.setTargetAtTime(0.012 * l, at, 0.05);
    this.dull.frequency.cancelScheduledValues(at);
    this.dull.frequency.setTargetAtTime(20000 / (1 + 14 * l), at, 0.03);
    if (recover > 0) {
      this.tinnitus.gain.setTargetAtTime(0, at + 0.4, recover);
      this.dull.frequency.setTargetAtTime(20000, at + 0.3, recover * 0.6);
    }
  }

  /** Start a one-shot (or loop) voice. Returns the voice output gain (for loops the caller keeps it). */
  play(buffer: AudioBuffer, o: PlayOpts = {}): GainNode {
    const c = this.ctx;
    const at = Math.max(c.currentTime, o.at ?? c.currentTime);
    const rate = o.rate ?? 1;
    // Over budget and everything playing matters more → drop this one (returns a detached gain).
    if (!o.loop && !this.reserve(at, o.prio ?? 1)) return c.createGain();
    const src = c.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = rate;
    src.loop = !!o.loop;
    let node: AudioNode = src;
    if (o.hp) {
      const f = c.createBiquadFilter();
      f.type = 'highpass';
      f.frequency.value = o.hp;
      node = node.connect(f);
    }
    if (o.lp && o.lp < 19000) {
      const f = c.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = o.lp;
      f.Q.value = 0.6;
      node = node.connect(f);
    }
    if (o.presenceDb) {
      const f = c.createBiquadFilter();
      f.type = 'peaking';
      f.frequency.value = 3000;
      f.Q.value = 0.9;
      f.gain.value = o.presenceDb;
      node = node.connect(f);
    }
    if (o.peak) {
      const f = c.createBiquadFilter();
      f.type = 'peaking';
      [f.frequency.value, f.gain.value, f.Q.value] = o.peak;
      node = node.connect(f);
    }
    const out = c.createGain();
    out.gain.value = o.gain ?? 1;
    node.connect(out);
    let tail: AudioNode = out;
    if (o.pan) {
      const p = c.createStereoPanner();
      p.pan.value = clamp(o.pan, -1, 1);
      tail = out.connect(p);
    }
    const bus =
      o.bus === 'thump'
        ? this.thump
        : o.bus === 'amb'
          ? this.amb
          : o.bus === 'shot'
            ? this.direct
            : o.bus === 'ui'
              ? this.ui
              : this.dry;
    tail.connect(bus);
    const sends = bus === this.dry || bus === this.direct;
    if (o.send && sends) {
      const s = c.createGain();
      s.gain.value = o.send;
      tail.connect(s).connect(this.send);
    }
    if (o.room && sends) {
      const s = c.createGain();
      s.gain.value = o.room;
      tail.connect(s).connect(this.tailSend);
    }
    src.start(at);
    if (!o.loop) {
      const end = at + buffer.duration / rate;
      this.voices.push({ src, out, start: at, end, prio: o.prio ?? 1 });
    }
    return out;
  }

  /** Keep one-shot voices ≤ MAX_VOICES: drop finished, then steal lowest-priority/oldest with a short fade. */
  private reserve(at: number, prio: number): boolean {
    // `at` (not currentTime) so offline renders that schedule ahead count overlap correctly.
    this.voices = this.voices.filter((v) => v.end > at);
    while (this.voices.length >= MAX_VOICES) {
      let victim = 0;
      for (let i = 1; i < this.voices.length; i++) {
        const v = this.voices[i];
        const w = this.voices[victim];
        if (v.prio < w.prio || (v.prio === w.prio && v.start < w.start)) victim = i;
      }
      const v = this.voices[victim];
      if (v.prio > prio) {
        this.dropped++;
        return false; // never steal a more important sound for a minor one
      }
      v.out.gain.cancelScheduledValues(at);
      v.out.gain.setTargetAtTime(0, at, 0.006);
      try {
        v.src.stop(at + 0.04);
      } catch {
        /* already stopped */
      }
      this.voices.splice(victim, 1);
      this.stolen++;
    }
    this.peakVoices = Math.max(this.peakVoices, this.voices.length + 1);
    return true;
  }

  get activeVoices() {
    const now = this.ctx.currentTime;
    return this.voices.filter((v) => v.end > now).length;
  }

  dispose() {
    this.windSrc?.stop();
  }
}
