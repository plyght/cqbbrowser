import { describe, expect, test } from 'bun:test';
import { BANK } from './acoustics';
import { BANK_SPECS, generateIr, measureRt60 } from './ir';
import { barrelCharacter, pickFormat, SoundBank, weaponSound, type SoundSetManifest } from './manifest';
import { jitter, mulberry32, RoundRobin } from './rng';
import {
  brassTinkle,
  footstep,
  mechanical,
  pressurePulse,
  steelFundamental,
  steelHit,
  steelPartials,
  whizz,
} from './synth';

const RATE = 48000;
const finite = (x: Float32Array) => x.every((v) => Number.isFinite(v));
const peak = (x: Float32Array) => x.reduce((m, v) => Math.max(m, Math.abs(v)), 0);

describe('round robin', () => {
  test('never repeats immediately and covers every variant', () => {
    const rr = new RoundRobin(5, mulberry32(1));
    const seen = new Set<number>();
    let last = -1;
    for (let i = 0; i < 2000; i++) {
      const v = rr.next();
      expect(v).not.toBe(last);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(5);
      seen.add(v);
      last = v;
    }
    expect(seen.size).toBe(5);
  });

  test('avoids the last floor(n/2) picks', () => {
    const rr = new RoundRobin(6, mulberry32(9));
    const h: number[] = [];
    for (let i = 0; i < 500; i++) {
      const v = rr.next();
      expect(h.slice(-3)).not.toContain(v);
      h.push(v);
    }
  });

  test('single variant and two variants', () => {
    expect(new RoundRobin(1).next()).toBe(0);
    const rr = new RoundRobin(2, mulberry32(3));
    const a = rr.next();
    expect(rr.next()).toBe(1 - a);
  });

  test('jitter stays within ±3 % / ±1.5 dB', () => {
    const r = mulberry32(5);
    for (let i = 0; i < 500; i++) {
      const j = jitter(r);
      expect(Math.abs(j.rate - 1)).toBeLessThanOrEqual(0.03);
      expect(Math.abs(20 * Math.log10(j.gain))).toBeLessThanOrEqual(1.5 + 1e-9);
    }
  });
});

describe('impulse responses', () => {
  test('every bank IR is finite, normalised, decays at roughly its spec RT60', () => {
    for (const b of BANK) {
      const spec = BANK_SPECS[b.name];
      const [l, r] = generateIr(spec, RATE, 7);
      expect(finite(l) && finite(r)).toBe(true);
      const e = l.reduce((a, v) => a + v * v, 0);
      expect(e).toBeCloseTo(1, 3);
      if (!spec.echoes) {
        const rt = measureRt60(l, RATE);
        expect(rt).toBeGreaterThan(spec.rt60 * 0.6);
        expect(rt).toBeLessThan(spec.rt60 * 1.6);
      }
    }
  });

  test('booth decays faster than hall, channels are decorrelated', () => {
    const [hall] = generateIr(BANK_SPECS.hall, RATE, 1);
    const [booth, boothR] = generateIr(BANK_SPECS.booth, RATE, 1);
    expect(measureRt60(booth, RATE)).toBeLessThan(measureRt60(hall, RATE));
    let dot = 0;
    for (let i = 0; i < booth.length; i++) dot += booth[i] * boothR[i];
    expect(Math.abs(dot)).toBeLessThan(0.2);
  });
});

describe('procedural sounds', () => {
  test('steel plate fundamental follows thickness / size²', () => {
    expect(steelFundamental(0.3, 10)).toBeCloseTo(365, -1);
    expect(steelFundamental(0.2, 10)).toBeGreaterThan(steelFundamental(0.3, 10) * 2);
    expect(steelFundamental(0.3, 12.7)).toBeGreaterThan(steelFundamental(0.3, 10));
  });

  test('chain-hung gong rings longer than a hinged popper; edge hits are brighter', () => {
    const chain = steelPartials(0.3, 10, 'chain', 0.5);
    const hinge = steelPartials(0.3, 10, 'hinge', 0.5);
    expect(chain[0][2]).toBeGreaterThan(hinge[0][2] * 3);
    const centre = steelPartials(0.3, 10, 'chain', 0);
    const edge = steelPartials(0.3, 10, 'chain', 1);
    const hi = (p: [number, number, number][]) => p.slice(3).reduce((a, x) => a + x[1], 0);
    expect(hi(edge)).toBeGreaterThan(hi(centre));
    const a = steelHit(0.3, 10, 'chain', 0.5, RATE, mulberry32(2));
    const b = steelHit(0.3, 10, 'hinge', 0.5, RATE, mulberry32(2));
    expect(a.length).toBeGreaterThan(b.length * 2);
    expect(finite(a) && peak(a) <= 0.9 + 1e-6).toBe(true);
  });

  test('generators produce finite, bounded audio', () => {
    const r = mulberry32(4);
    for (const x of [
      pressurePulse(RATE),
      mechanical('ar', RATE, r),
      mechanical('pistol', RATE, r),
      whizz(RATE, r),
      brassTinkle(RATE, r, 'rifle', true),
      brassTinkle(RATE, r, 'shell', false),
      footstep('gravel', RATE, r),
      footstep('concrete', RATE, r),
    ]) {
      expect(x.length).toBeGreaterThan(100);
      expect(finite(x)).toBe(true);
      expect(peak(x)).toBeLessThanOrEqual(1.0001);
    }
  });
});

describe('manifest + loader', () => {
  test('weapon profiles: short barrels are harsher; suppressor overrides the report', () => {
    expect(barrelCharacter(10.3).gain).toBeGreaterThan(barrelCharacter(16).gain);
    expect(barrelCharacter(16).presenceDb).toBe(0);
    expect(weaponSound('sb16', '5.56', true).report).toBe('suppressed');
    expect(weaponSound('unknown', '9mm', false).family).toBe('pistol');
  });

  test('pickFormat prefers the first playable format', () => {
    expect(pickFormat(['webm', 'm4a'], (m) => m.includes('webm'))).toBe('webm');
    expect(pickFormat(['webm', 'm4a'], (m) => m.includes('mp4'))).toBe('m4a');
  });

  test('pro set wins over open per key; open fills the rest; synth only fills gaps', async () => {
    const fakeBuf = (name: string) => ({ name }) as unknown as AudioBuffer;
    const ctx = { decodeAudioData: async (d: ArrayBuffer) => fakeBuf(new TextDecoder().decode(d)) };
    const pro: SoundSetManifest = {
      version: 1,
      set: 'pro',
      formats: ['webm'],
      sounds: { 'report.a': ['p1', 'p2'] },
    };
    const open: SoundSetManifest = {
      version: 1,
      set: 'open',
      formats: ['webm', 'm4a'],
      sounds: { 'report.a': ['o1'], 'step.concrete': ['s1', 's2', 's3'] },
    };
    const urls: string[] = [];
    const bank = new SoundBank(mulberry32(1));
    await bank.load(
      ctx,
      [pro, open],
      'assets/audio/',
      async (u) => {
        urls.push(u);
        return new TextEncoder().encode(u).buffer as ArrayBuffer;
      },
      () => true,
    );
    expect(bank.source('report.a')).toBe('pro');
    expect(urls.some((u) => u.includes('open/o1'))).toBe(false);
    expect(bank.source('step.concrete')).toBe('open');
    bank.addSynth('step.concrete', [fakeBuf('synth')]);
    bank.addSynth('step.wood', [fakeBuf('synth')]);
    expect(bank.source('step.concrete')).toBe('open');
    expect(bank.source('step.wood')).toBe('synth');
    expect(bank.pick('nope')).toBeNull();
    // Round-robin through the bank too.
    const a = bank.pick('step.concrete');
    expect(bank.pick('step.concrete')).not.toBe(a);
  });
});
