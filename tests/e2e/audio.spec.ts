/* eslint-disable @typescript-eslint/no-explicit-any */
import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { boot, play, steps } from './helpers';

const dir = 'screenshots';

/** Envelope (10 ms RMS, dB) of a mono mix of a float32 stereo WAV body. */
function envelope(wav: Buffer, rate = 48000) {
  const f = new Float32Array(wav.buffer.slice(wav.byteOffset + 44, wav.byteOffset + wav.byteLength));
  const hop = rate / 100;
  const out: number[] = [];
  for (let i = 0; i + hop * 2 <= f.length; i += hop * 2) {
    let a = 0;
    for (let j = 0; j < hop * 2; j += 2) a += ((f[i + j] + f[i + j + 1]) / 2) ** 2;
    out.push(10 * Math.log10(a / hop + 1e-12));
  }
  return out;
}

/** Energy (dB, relative to the shot's peak frame) in a window [a, b) seconds after the first shot near 0.4 s. */
function windowDb(env: number[], a: number, b: number) {
  let pk = 35;
  for (let i = 35; i < 60; i++) if (env[i] > env[pk]) pk = i;
  const s = env.slice(pk + a * 100, pk + b * 100);
  const mean = s.reduce((acc, v) => acc + 10 ** (v / 10), 0) / s.length;
  return 10 * Math.log10(mean) - env[pk];
}

/**
 * Shot stats around the first shot in [from, from+0.4) s: sample peak (dBFS), 50 ms RMS after the peak (dBFS),
 * crest (peak − RMS) and the absolute 40–120 Hz energy (dB) of the 150 ms after it.
 */
function shotStats(wav: Buffer, from: number, rate = 48000) {
  const f = new Float32Array(wav.buffer.slice(wav.byteOffset + 44, wav.byteOffset + wav.byteLength));
  const n = f.length / 2;
  const mono = new Float32Array(n);
  for (let i = 0; i < n; i++) mono[i] = (f[2 * i] + f[2 * i + 1]) / 2;
  let pk = Math.floor(from * rate);
  for (let i = pk; i < Math.min(n, (from + 0.4) * rate); i++)
    if (Math.abs(mono[i]) > Math.abs(mono[pk])) pk = i;
  // 50 ms RMS after the peak.
  const w = Math.floor(0.05 * rate);
  let all = 0;
  for (let i = pk; i < Math.min(n, pk + w); i++) all += mono[i] ** 2;
  // 40–120 Hz energy in the 150 ms after the shot (Hann-windowed DFT bins, Goertzel), absolute.
  const len = Math.floor(0.15 * rate);
  const start = Math.max(0, pk - Math.floor(0.01 * rate));
  let low = 0;
  for (let fq = 40; fq <= 120; fq += 1000 / 150) {
    const k = (2 * Math.cos((2 * Math.PI * fq) / rate)) as number;
    let s1 = 0,
      s2 = 0;
    for (let i = 0; i < len && start + i < n; i++) {
      const win = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / len);
      const s0 = mono[start + i] * win + k * s1 - s2;
      s2 = s1;
      s1 = s0;
    }
    low += s1 * s1 + s2 * s2 - k * s1 * s2;
  }
  const db = (x: number) => 10 * Math.log10(x + 1e-12);
  const peakDb = 20 * Math.log10(Math.abs(mono[pk]) + 1e-12);
  const rmsDb = db(all / w);
  return { peakDb, rmsDb, crest: peakDb - rmsDb, lowDb: db(low / len) };
}

test('audio: offline renders (WAV + spectrograms)', async ({ page }) => {
  test.setTimeout(180_000);
  mkdirSync(dir, { recursive: true });
  const errors = await boot(page);
  const names = [
    'rifle-outdoor',
    'rifle-box',
    'rifle-room',
    'steel-25m',
    'pistol-reload-room',
    'pistol-reload-room-v2',
    'rifle-indoor-v2',
    'suppressed-outdoor',
    'auto-room',
    'rifle-room-earpro',
    'rifle-room-noprotect',
    'walkout',
  ];
  const early: Record<string, number> = {};
  const late: Record<string, number> = {};
  const shots: Record<string, ReturnType<typeof shotStats>> = {};
  for (const name of names) {
    const r = await page.evaluate((n) => (window as any).__sb.audio.renderOffline(n), name);
    const wav = Buffer.from(r.wav, 'base64');
    const path = `${dir}/audio-${name}.wav`;
    writeFileSync(path, wav);
    execFileSync('ffmpeg', [
      '-v',
      'error',
      '-y',
      '-i',
      path,
      '-lavfi',
      'showspectrumpic=s=1200x360:legend=1:scale=log:fscale=lin:stop=16000',
      `${dir}/audio-${name}.png`,
    ]);
    execFileSync('ffmpeg', [
      '-v',
      'error',
      '-y',
      '-i',
      path,
      '-lavfi',
      'aformat=channel_layouts=mono,showwavespic=s=1200x200:split_channels=0',
      `${dir}/audio-${name}-wave.png`,
    ]);
    const env = envelope(wav);
    early[name] = windowDb(env, 0.05, 0.15);
    late[name] = windowDb(env, 0.9, 1.6);
    const st = (shots[name] = shotStats(wav, name.endsWith('-v2') ? 0.25 : 0.35));
    console.log(
      `${name}: peak=${r.peak.toFixed(3)} rms=${r.rms.toFixed(4)} clipped=${(r.clipped * 100).toFixed(3)}% ` +
        `early=${early[name].toFixed(1)}dB late=${late[name].toFixed(1)}dB ` +
        `shot peak=${st.peakDb.toFixed(1)} rms50=${st.rmsDb.toFixed(1)} crest=${st.crest.toFixed(1)} ` +
        `low40-120=${st.lowDb.toFixed(1)}dB reverb=${JSON.stringify(r.debug.reverb)} peakVoices=${r.debug.peakVoices} stolen=${r.debug.stolen}`,
    );
    expect(r.nan).toBe(0);
    expect(r.peak).toBeLessThanOrEqual(1);
    expect(r.peak).toBeGreaterThan(0.2);
    expect(r.debug.loaded.open).toBeGreaterThan(50);
    expect(r.debug.peakVoices).toBeLessThanOrEqual(32);
  }
  // Tiny concrete box: dense, compressed early field; open air: weak early field but echoes off the berms
  // and the ambience breathing back late.
  expect(early['rifle-box']).toBeGreaterThan(early['rifle-outdoor'] + 4);
  expect(late['rifle-box']).toBeLessThan(late['rifle-outdoor']);
  // Shots hit hard: near the −1 dBFS ceiling, dense (RMS within ~12 dB of peak), with real low end —
  // more of it indoors than outdoors.
  for (const n of ['rifle-outdoor', 'rifle-box', 'rifle-indoor-v2']) {
    expect(shots[n].peakDb).toBeGreaterThan(-3);
    expect(shots[n].rmsDb).toBeGreaterThan(-16);
  }
  expect(shots['rifle-box'].lowDb).toBeGreaterThan(shots['rifle-outdoor'].lowDb + 3);
  expect(shots['rifle-indoor-v2'].lowDb).toBeGreaterThan(shots['rifle-outdoor'].lowDb + 2);
  // Unsuppressed shots carry a real 40–120 Hz punch; a can takes most of it away.
  expect(shots['rifle-outdoor'].lowDb).toBeGreaterThan(shots['suppressed-outdoor'].lowDb + 10);
  expect(errors).toEqual([]);
});

test('audio: live probe + voices on the range', async ({ page }) => {
  const errors = await boot(page);
  await play(page);
  await steps(page, 30);
  const d0 = await page.evaluate(() => (window as any).__sb.audio.debug);
  console.log('range probe', JSON.stringify(d0));
  expect(d0.enclosure).toBeLessThan(0.4);
  for (let i = 0; i < 3; i++) {
    await steps(page, 2, { down: ['fire'] });
    await steps(page, 6);
  }
  const d1 = await page.evaluate(() => (window as any).__sb.audio.debug);
  expect(d1.voices).toBeLessThanOrEqual(32);
  expect(errors).toEqual([]);
});
