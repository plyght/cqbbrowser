/**
 * Builds the committed `open` sound set from `sources.ts`:
 *   fetch (Freesound CC0 previews, Kenney CC0 packs) → trim → fades → peak/RMS normalise → loop crossfade
 *   → encode Opus (.webm) + AAC (.m4a, Safari fallback) → public/assets/audio/open/manifest.json
 *
 *   bun tools/audio/process.ts
 *
 * Needs ffmpeg (libopus) and unzip on PATH. Raw downloads are cached in tools/audio/.cache (gitignored).
 */
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CACHE, fetchSound } from './freesound';
import { SOURCES, type SourceEntry } from './sources';

const ROOT = join(import.meta.dir, '..', '..');
const OUT = join(ROOT, 'public', 'assets', 'audio', 'open');
const RATE = 48000;

const KENNEY: Record<string, string> = {
  'impact-sounds':
    'https://kenney.nl/media/pages/assets/impact-sounds/87b4ddecda-1677589768/kenney_impact-sounds.zip',
  'rpg-audio': 'https://kenney.nl/media/pages/assets/rpg-audio/8e99002d76-1677590336/kenney_rpg-audio.zip',
};

function run(cmd: string[], stdin?: Uint8Array) {
  const p = Bun.spawnSync(cmd, { stdin: stdin ?? 'ignore', stdout: 'pipe', stderr: 'pipe' });
  if (p.exitCode !== 0) throw new Error(`${cmd[0]} failed: ${p.stderr.toString().slice(-400)}`);
  return p.stdout;
}

async function kenneyFile(pack: string, file: string) {
  const dir = join(CACHE, `kenney-${pack}`);
  if (!existsSync(dir)) {
    const zip = join(CACHE, `kenney-${pack}.zip`);
    const res = await fetch(KENNEY[pack]);
    if (!res.ok) throw new Error(`kenney ${pack}: HTTP ${res.status}`);
    writeFileSync(zip, new Uint8Array(await res.arrayBuffer()));
    run(['unzip', '-q', '-o', zip, '-d', dir]);
  }
  return join(dir, 'Audio', file);
}

async function sourcePath(s: SourceEntry) {
  const o = s.origin;
  return o.kind === 'freesound' ? fetchSound(o.id, o.user) : kenneyFile(o.pack, o.file);
}

function decode(path: string, s: SourceEntry, channels: number) {
  const args = ['ffmpeg', '-v', 'error'];
  if (s.start) args.push('-ss', String(s.start));
  if (s.dur) args.push('-t', String(s.dur + (s.loop ? 3 : 0)));
  args.push('-i', path, '-ac', String(channels), '-ar', String(RATE));
  args.push('-af', ['highpass=f=25', s.af].filter(Boolean).join(','));
  args.push('-f', 'f32le', '-');
  const raw = run(args);
  return new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4).slice();
}

/** Interleaved DSP helpers. */
function fades(x: Float32Array, ch: number, fadeIn: number, fadeOut: number) {
  const n = x.length / ch;
  const fi = Math.round(fadeIn * RATE);
  const fo = Math.min(n, Math.round(fadeOut * RATE));
  for (let i = 0; i < n; i++) {
    let g = 1;
    if (i < fi) g *= i / fi;
    if (i >= n - fo) g *= 0.5 + 0.5 * Math.cos((Math.PI * (i - (n - fo))) / fo);
    for (let c = 0; c < ch; c++) x[i * ch + c] *= g;
  }
}

function loopCrossfade(x: Float32Array, ch: number, xf: number) {
  const n = x.length / ch;
  const m = Math.round(xf * RATE);
  const len = n - m;
  const out = new Float32Array(len * ch);
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < ch; c++) {
      let v = x[i * ch + c];
      if (i < m) {
        const t = i / m;
        v = v * Math.sin((t * Math.PI) / 2) + x[(len + i) * ch + c] * Math.cos((t * Math.PI) / 2);
      }
      out[i * ch + c] = v;
    }
  }
  return out;
}

function normalise(x: Float32Array, level: number, rms: boolean) {
  let acc = 0;
  for (const v of x) acc = rms ? acc + v * v : Math.max(acc, Math.abs(v));
  const cur = rms ? Math.sqrt(acc / x.length) : acc;
  if (cur < 1e-6) throw new Error('silent slice');
  const g = Math.pow(10, level / 20) / cur;
  for (let i = 0; i < x.length; i++) x[i] = Math.max(-1, Math.min(1, x[i] * g));
}

function encode(x: Float32Array, ch: number, base: string) {
  const tmp = join(CACHE, 'tmp.f32');
  writeFileSync(tmp, new Uint8Array(x.buffer, x.byteOffset, x.byteLength));
  const input = [
    'ffmpeg',
    '-v',
    'error',
    '-y',
    '-f',
    'f32le',
    '-ar',
    String(RATE),
    '-ac',
    String(ch),
    '-i',
    tmp,
  ];
  const kbps = ch === 2 ? 64 : 48;
  run([...input, '-c:a', 'libopus', '-b:a', `${kbps}k`, '-application', 'audio', `${base}.webm`]);
  run([...input, '-c:a', 'aac', '-b:a', `${kbps + 16}k`, '-movflags', '+faststart', `${base}.m4a`]);
}

async function main() {
  mkdirSync(CACHE, { recursive: true });
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  const sounds: Record<string, string[]> = {};
  for (const s of SOURCES) {
    const path = await sourcePath(s);
    const ch = s.loop ? 2 : 1;
    let x = decode(path, s, ch);
    if (s.loop) x = loopCrossfade(x, ch, 3);
    else fades(x, ch, s.start ? 0.0004 : 0, s.fadeOut ?? 0.06);
    normalise(x, s.level ?? -3, !!s.loop);
    encode(x, ch, join(OUT, s.out));
    (sounds[s.key] ??= []).push(s.out);
    console.log(`${s.key.padEnd(26)} ${s.out}  ${(x.length / ch / RATE).toFixed(2)}s`);
  }
  const manifest = { version: 1, set: 'open', formats: ['webm', 'm4a'], sounds };
  writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  const bytes = readdirSync(OUT).reduce((a, f) => a + statSync(join(OUT, f)).size, 0);
  console.log(`\n${SOURCES.length} sounds, ${(bytes / 1e6).toFixed(2)} MB in ${OUT}`);
}

await main();
