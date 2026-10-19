/**
 * The Web Audio graph: voices → dry/send buses → (2 crossfaded convolvers + parametric early reflections) →
 * CAM04 microphone stage (capsule EQ, wind, body thumps, AGC pumping, handling muffle, soft clipper) → out.
 *
 * Budget (60–120 fps owner requirement): ≤ 2 convolvers, ≤ MAX_VOICES one-shot voices with stealing, all
 * buffers made once at load. Native nodes only — WaveShaper (4× oversampled) clips and DynamicsCompressor
 * pumps well enough that an AudioWorklet would add main-thread setup cost without an audible gain.
 */
import { BANK, convolverMix, bankPosition, wetLevel, type Acoustics } from './acoustics';
import { clamp, dbToGain } from './rng';
import type { ListeningMode } from './settings';

export const MAX_VOICES = 32;
const TAPS = 6;

export interface PlayOpts {
  /** Absolute context time; default now. */
  at?: number;
  gain?: number;
  rate?: number;
  /** -1..1 */
  pan?: number;
  /** Reverb/ER send amount (post-fader). */
  send?: number;
  /** Low-pass cutoff Hz (distance/air absorption, occlusion, muffling). */
  lp?: number;
  hp?: number;
  /** Peaking boost at ~3 kHz in dB (barrel harshness). */
  presenceDb?: number;
  /** Resonant boost [freq, dB, Q] (pressure layer room mode). */
  peak?: [number, number, number];
  bus?: 'dry' | 'thump' | 'amb';
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

/** tanh soft clipper curve; input is pre-scaled by 1/HEADROOM so ±HEADROOM maps onto the curve. */
const HEADROOM = 4;
function clipCurve(drive: number) {
  const n = 4096;
  const c = new Float32Array(n);
  const norm = Math.tanh(drive * HEADROOM);
  for (let i = 0; i < n; i++) {
    const x = ((i / (n - 1)) * 2 - 1) * HEADROOM;
    c[i] = (Math.tanh(x * drive) / norm) * 0.97;
  }
  return c;
}

const MODES: Record<
  ListeningMode,
  {
    eq: number;
    thr: number;
    ratio: number;
    attack: number;
    release: number;
    makeupDb: number;
    drive: number;
    artifacts: number;
  }
> = {
  // Note: DynamicsCompressorNode adds its own automatic makeup gain ((1/full-range gain)^0.6), so these
  // makeups are on top of that: footage ≈ +14 dB total, earpro ≈ +24 dB into a hard
  // 12:1 limiter (quiet sounds lifted, shots held down), noprotect ≈ +6 dB, nearly uncompressed.
  footage: { eq: 1, thr: -18, ratio: 6, attack: 0.003, release: 0.9, makeupDb: 5, drive: 1.5, artifacts: 1 },
  earpro: {
    eq: 0.15,
    thr: -30,
    ratio: 12,
    attack: 0.001,
    release: 0.15,
    makeupDb: 8,
    drive: 0.6,
    artifacts: 0.2,
  },
  noprotect: {
    eq: 0,
    thr: -6,
    ratio: 2,
    attack: 0.003,
    release: 0.25,
    makeupDb: 4,
    drive: 0.6,
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
  private agc: DynamicsCompressorNode;
  private makeup: GainNode;
  private muffleLp: BiquadFilterNode;
  private muffleGain: GainNode;
  private clipPre: GainNode;
  private clipper: WaveShaperNode;
  private dull: BiquadFilterNode;
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
    this.master.connect(c.destination);
    this.dull = bq('lowpass', 20000, 0.5);
    this.dull.connect(this.master);
    this.clipper = c.createWaveShaper();
    this.clipper.oversample = '4x';
    this.clipper.curve = clipCurve(MODES.footage.drive);
    this.clipper.connect(this.dull);
    this.clipPre = g(1 / HEADROOM);
    this.clipPre.connect(this.clipper);
    this.muffleGain = g(1);
    this.muffleGain.connect(this.clipPre);
    this.muffleLp = bq('lowpass', 20000, 0.6);
    this.muffleLp.connect(this.muffleGain);
    this.makeup = g(dbToGain(MODES.footage.makeupDb));
    this.makeup.connect(this.muffleLp);
    this.agc = c.createDynamicsCompressor();
    this.agc.connect(this.makeup);
    const agcIn = g(1);
    agcIn.connect(this.agc);

    // Tinnitus (no-protection mode): a quiet high whine, post-mic.
    const osc = c.createOscillator();
    osc.frequency.value = 6800;
    this.tinnitus = g(0);
    osc.connect(this.tinnitus).connect(this.master);
    osc.start();

    // --- Capsule EQ: thin lows, peaky presence, rolled-off air -----------------------------------------
    const micIn = g(1);
    this.eq = {
      hp: bq('highpass', 120, 0.8),
      presence: bq('peaking', 3200, 1.1, 5),
      shelf: bq('highshelf', 9000, 0.7, -5),
    };
    micIn.connect(this.eq.hp).connect(this.eq.presence).connect(this.eq.shelf).connect(agcIn);

    // Mic artefacts (wind on the capsule, body-borne thumps) skip the acoustic EQ and hit the AGC directly.
    this.artifacts = g(1);
    this.artifacts.connect(agcIn);
    this.wind = g(1);
    this.wind.connect(this.artifacts);
    this.thump = g(1);
    const thumpLp = bq('lowpass', 900, 0.7);
    this.thump.connect(thumpLp).connect(this.artifacts);

    // --- SFX: dry + wet --------------------------------------------------------------------------------
    this.sfx = g(1);
    this.sfx.connect(micIn);
    this.dry = g(1);
    this.dry.connect(this.sfx);
    this.wet = g(0.4);
    this.roomBoost = bq('peaking', 100, 1.5, 0);
    this.wet.connect(this.roomBoost).connect(this.sfx);
    this.send = g(1);
    this.predelay = c.createDelay(0.2);
    this.predelay.delayTime.value = 0.01;
    this.send.connect(this.predelay);
    this.conv = [c.createConvolver(), c.createConvolver()];
    this.convGain = [g(0), g(0)];
    for (let i = 0; i < 2; i++) {
      this.conv[i].normalize = false;
      this.predelay.connect(this.conv[i]).connect(this.convGain[i]).connect(this.wet);
    }
    // Early reflections: fixed pool of taps re-tuned by the probe.
    const erIn = g(1);
    this.send.connect(erIn);
    for (let i = 0; i < TAPS; i++) {
      const delay = c.createDelay(1);
      delay.delayTime.value = 0.01 + i * 0.005;
      const lp = bq('lowpass', 8000, 0.5);
      const gain = g(0);
      const pan = c.createStereoPanner();
      erIn.connect(delay).connect(lp).connect(gain).connect(pan).connect(this.sfx);
      this.taps.push({ delay, lp, gain, pan });
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
    const erScale = 0.35 + 0.65 * Math.max(a.enclosure, 0.4);
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
    this.agc.threshold.setValueAtTime(m.thr, t);
    this.agc.knee.setValueAtTime(6, t);
    this.agc.ratio.setValueAtTime(m.ratio, t);
    this.agc.attack.setValueAtTime(m.attack, t);
    this.agc.release.setValueAtTime(m.release, t);
    this.makeup.gain.setValueAtTime(dbToGain(m.makeupDb), t);
    this.clipper.curve = clipCurve(m.drive);
    this.applyArtifacts();
    if (mode !== 'noprotect') this.exposure(0, 0);
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
    const bus = o.bus === 'thump' ? this.thump : o.bus === 'amb' ? this.amb : this.dry;
    tail.connect(bus);
    if (o.send && bus === this.dry) {
      const s = c.createGain();
      s.gain.value = o.send;
      tail.connect(s).connect(this.send);
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
