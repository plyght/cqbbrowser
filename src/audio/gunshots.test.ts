/**
 * Gunshot stacks per weapon, measured without Web Audio: the real AudioEngine runs on a stub context and every
 * voice it starts is recorded (buffer × gain). With no recorded sets loaded every layer is its procedural
 * stand-in, so this checks the engine's layering and levels, not the samples: rifles must out-weigh the pistol
 * (and carry far more crack), suppressed fire must stay a real report with a loud action, and the HB-300 with
 * a muzzle device must not take the suppressed path.
 */
import { describe, expect, test } from 'bun:test';
import { PerspectiveCamera } from 'three';
import { AudioEngine } from './AudioEngine';
import { OUTDOOR, type Acoustics } from './acoustics';
import { weaponSound } from './manifest';
import { MAX_VOICES, SAFE_KNEE, SAFE_MAX, safetyCurve } from './Mixer';
import { CORE_SPECS, coreSpec, rifleCore } from './synth';

const RATE = 48000;

class FakeBuffer {
  private data: Float32Array[];
  constructor(
    readonly numberOfChannels: number,
    readonly length: number,
    readonly sampleRate: number,
  ) {
    this.data = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
  }
  get duration() {
    return this.length / this.sampleRate;
  }
  getChannelData(c: number) {
    return this.data[c];
  }
  copyToChannel(src: Float32Array, c: number) {
    this.data[c].set(src);
  }
}

/** Universal stand-in for nodes/params: every property is callable and chainable. */
function node(): unknown {
  const target = function () {} as unknown as Record<string | symbol, unknown>;
  return new Proxy(target, {
    get: (t, k) => {
      if (k === 'connect') return (dst: unknown) => dst ?? node();
      if (
        k === 'value' ||
        k === 'gain' ||
        k === 'frequency' ||
        k === 'Q' ||
        k === 'delayTime' ||
        k === 'pan'
      ) {
        if (!(k in t)) t[k] = k === 'value' ? 0 : node();
        return t[k];
      }
      if (k in t) return t[k];
      return () => node();
    },
    set: (t, k, v) => {
      t[k] = v;
      return true;
    },
  });
}

function fakeContext() {
  const base = {
    sampleRate: RATE,
    currentTime: 0,
    destination: node(),
    createBuffer: (ch: number, len: number, rate: number) => new FakeBuffer(ch, len, rate),
  };
  return new Proxy(base as Record<string | symbol, unknown>, {
    get: (t, k) => (k in t ? t[k] : () => node()),
  }) as unknown as BaseAudioContext;
}

interface Voice {
  energy: number;
  /** 4–10 kHz-ish proxy: energy of the first difference (HF-weighted), × gain². */
  bright: number;
  gain: number;
}

const ROOM: Acoustics = { ...OUTDOOR, enclosure: 0.9, bass: 0.4, roomMode: 70 };

function engine() {
  const cam = new PerspectiveCamera();
  const e = new AudioEngine(null, cam, {
    ctx: fakeContext(),
    sets: [],
    seed: 7,
    settings: { neighbours: false, mode: 'footage', ambience: 0, micArtifacts: 0 },
  });
  const voices: Voice[] = [];
  e.mixer.play = ((buf: AudioBuffer, o: { gain?: number; rate?: number } = {}) => {
    const g = o.gain ?? 1;
    const n = Math.min(buf.length, Math.floor((0.05 * RATE) / (o.rate ?? 1)));
    let en = 0,
      hf = 0;
    for (let c = 0; c < buf.numberOfChannels; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < n; i++) {
        en += d[i] * d[i];
        if (i) hf += (d[i] - d[i - 1]) ** 2;
      }
    }
    const k = (g * g) / (buf.numberOfChannels * 0.05 * RATE);
    voices.push({ energy: en * k, bright: hf * k, gain: g });
    return node() as GainNode;
  }) as typeof e.mixer.play;
  return { e, voices };
}

const db = (x: number) => 10 * Math.log10(x + 1e-20);

/** One shot's direct stack: total 50 ms energy (dB), HF-weighted energy (dB), voice count and per-voice list. */
function shot(
  weaponId: string,
  caliber: string,
  o: { suppressed?: boolean; subsonic?: boolean; muzzle?: string; barrel?: number; room?: boolean } = {},
) {
  const { e, voices } = engine();
  if (o.room) e.setAcoustics(ROOM, true);
  e.gunshot({
    weaponId,
    caliber,
    suppressed: !!o.suppressed,
    subsonic: o.subsonic,
    def: o.muzzle ? { muzzleDevice: o.muzzle, barrelLength: (o.barrel ?? 9) * 0.0254 } : undefined,
    at: 0,
  });
  const sum = (k: 'energy' | 'bright') => voices.reduce((a, v) => a + v[k], 0);
  return { total: db(sum('energy')), bright: db(sum('bright')), voices };
}

describe('gunshot stacks', () => {
  test('rifles out-weigh the pistol: more energy and much more crack', () => {
    const p17 = shot('p17', '9mm');
    for (const [id, cal] of [
      ['sb16', '5.56'],
      ['k47s', '7.62x39'],
    ]) {
      const r = shot(id, cal);
      expect(r.total - p17.total).toBeGreaterThan(3);
      expect(r.bright - p17.bright).toBeGreaterThan(6);
    }
    // Indoors too (the pressure/thump layers grow for both).
    expect(
      shot('sb16', '5.56', { room: true }).total - shot('p17', '9mm', { room: true }).total,
    ).toBeGreaterThan(2);
  });

  test('the SMG sits between the pistol and the rifles', () => {
    const p17 = shot('p17', '9mm');
    const kp9 = shot('kp9', '9mm');
    const sb16 = shot('sb16', '5.56');
    expect(kp9.total).toBeGreaterThan(p17.total);
    expect(kp9.total).toBeLessThan(sb16.total);
    expect(kp9.bright).toBeLessThan(sb16.bright - 3);
  });

  test('HB-300 with a muzzle device is an unsuppressed .300 SBR, comp/brake louder than a flash hider', () => {
    const sup = shot('hb300', '300blk', { suppressed: true, subsonic: true, muzzle: 'integral', barrel: 6 });
    const fh = shot('hb300', '300blk', { subsonic: true, muzzle: 'flashHider' });
    const comp = shot('hb300', '300blk', { subsonic: true, muzzle: 'comp' });
    const brake = shot('hb300', '300blk', { subsonic: true, muzzle: 'brake' });
    expect(fh.total - sup.total).toBeGreaterThan(12);
    expect(comp.total).toBeGreaterThan(fh.total + 0.5);
    expect(brake.total).toBeGreaterThan(comp.total);
    // Even on subsonic ammo it's a rifle blast, well over the pistol.
    expect(fh.total - shot('p17', '9mm').total).toBeGreaterThan(3);
  });

  test('suppressed fire is a real report (not a whisper) with a loud action', () => {
    const p17 = shot('p17', '9mm');
    const sb16 = shot('sb16', '5.56');
    const sub = shot('hb300', '300blk', { suppressed: true, subsonic: true });
    const sup = shot('hb300', '300blk', { suppressed: true, subsonic: false });
    // Physically ~130 dB vs ~160 dB, but through a clipping body-cam mic: well under, never silent.
    expect(sub.total).toBeGreaterThan(sb16.total - 30);
    expect(sub.total).toBeLessThan(p17.total - 6);
    // Supersonic ammo still cracks downrange: one more voice, and a bright one (within 6 dB of the brightest).
    expect(sup.voices.length).toBe(sub.voices.length + 1);
    const crack = sup.voices[sup.voices.length - 2]; // played just before the trailing pressure layer
    expect(db(crack.bright)).toBeGreaterThan(Math.max(...sup.voices.map((v) => db(v.bright))) - 6);
    expect(sup.bright).toBeGreaterThan(sub.bright);
    // The action is a big part of it: the loudest voice is within 10 dB of the whole stack.
    const loud = Math.max(...sub.voices.map((v) => v.energy));
    const action = sub.voices[0];
    expect(db(action.energy)).toBeGreaterThan(db(loud) - 10);
    expect(db(action.energy)).toBeGreaterThan(sub.total - 12);
  });

  test('a long-gun shot costs few voices, so an 850 rpm string fits the budget', () => {
    const r = shot('sb16', '5.56');
    expect(r.voices.length).toBeLessThanOrEqual(8);
    // ≤ 8 voices whose tails last ≤ 0.75 s → ≤ ~8 × 0.75 / (60/850) ≈ 85 voice-shots… but most layers are short;
    // the e2e render (auto-room) checks stealing; here: the budget must exceed one long-gun second of overlap.
    expect(MAX_VOICES).toBeGreaterThanOrEqual(40);
  });
});

describe('weapon profiles follow the build', () => {
  test('HB-300: integral can → suppressed; comp/brake/flash hider → unsuppressed', () => {
    const sup = weaponSound('hb300', '300blk', true, { muzzleDevice: 'integral', barrelLength: 6 * 0.0254 });
    expect(sup.suppressed).toBe(true);
    expect(sup.muzzle).toBe('integral');
    expect(weaponSound('hb300', '300blk', true).muzzle).toBe('integral');
    for (const [dev, cls] of [
      ['comp', 'comp'],
      ['brake', 'brake'],
      ['flashHider', 'flash'],
      ['bare', 'open'],
    ]) {
      const p = weaponSound('hb300', '300blk', false, { muzzleDevice: dev, barrelLength: 9 * 0.0254 });
      expect(p.suppressed).toBe(false);
      expect(p.report).not.toBe('suppressed');
      expect(p.muzzle).toBe(cls as typeof p.muzzle);
      expect(p.core).toBe('300');
      expect(p.barrelIn).toBeCloseTo(9, 3);
    }
  });

  test('SB-16 with a QD can is suppressed; KP-9 is an MP5-style SMG', () => {
    expect(weaponSound('sb16', '5.56', true, { muzzleDevice: 'suppressor' }).muzzle).toBe('can');
    const kp9 = weaponSound('kp9', '9mm', false);
    expect(kp9.family).toBe('smg');
    expect(kp9.mech).toBe('mp5');
  });
});

describe('blast cores', () => {
  const R = RATE;
  const bandDb = (x: Float32Array, lo: number, hi: number, len = 0.03) => {
    const n = Math.floor(len * R);
    let e = 0;
    for (let f = lo; f < hi; f += 50) {
      const k = 2 * Math.cos((2 * Math.PI * f) / R);
      let s1 = 0,
        s2 = 0;
      for (let i = 0; i < n; i++) {
        const s0 = x[i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n)) + k * s1 - s2;
        s2 = s1;
        s1 = s0;
      }
      e += s1 * s1 + s2 * s2 - k * s1 * s2;
    }
    return db(e);
  };
  const rng = (() => {
    let s = 3;
    return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
  })();

  test('5.56 is brighter than .300 BLK, .300 has more low-mid body; subsonic loses the crack', () => {
    const r556 = rifleCore(coreSpec('556', 'flash', false), R, rng)[0];
    const r300 = rifleCore(coreSpec('300', 'flash', true), R, rng)[0];
    const tilt = (x: Float32Array) => bandDb(x, 4000, 10000) - bandDb(x, 120, 600);
    expect(tilt(r556) - tilt(r300)).toBeGreaterThan(4);
    expect(coreSpec('300', 'flash', true).crack).toBeLessThan(CORE_SPECS['300'].crack * 0.5);
  });

  test('comps and brakes add a decorrelated side blast', () => {
    const [l, r] = rifleCore(coreSpec('300', 'brake', true), R, rng);
    let d = 0;
    for (let i = 0; i < 2000; i++) d += Math.abs(l[i] - r[i]);
    expect(d).toBeGreaterThan(1);
    // Without a side blast the core is mono.
    expect(rifleCore(coreSpec('300', 'flash', true), R, rng)).toHaveLength(1);
  });

  test('output safety: identity under the knee, bounded above it', () => {
    const c = safetyCurve();
    const at = (x: number) => c[Math.round(((x + 1) / 2) * (c.length - 1))];
    expect(at(0.5)).toBeCloseTo(0.5, 3);
    expect(at(SAFE_KNEE - 0.01)).toBeCloseTo(SAFE_KNEE - 0.01, 3);
    expect(Math.max(...c)).toBeLessThanOrEqual(SAFE_MAX);
    expect(at(1)).toBeGreaterThan(SAFE_KNEE);
  });
});
