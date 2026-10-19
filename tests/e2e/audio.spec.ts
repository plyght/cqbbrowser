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
    'suppressed-outdoor',
    'auto-room',
    'rifle-room-earpro',
    'rifle-room-noprotect',
    'walkout',
  ];
  const early: Record<string, number> = {};
  const late: Record<string, number> = {};
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
    console.log(
      `${name}: peak=${r.peak.toFixed(3)} rms=${r.rms.toFixed(4)} clipped=${(r.clipped * 100).toFixed(3)}% ` +
        `early=${early[name].toFixed(1)}dB late=${late[name].toFixed(1)}dB reverb=${JSON.stringify(r.debug.reverb)} peakVoices=${r.debug.peakVoices} stolen=${r.debug.stolen}`,
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
