/**
 * Every external sound that goes into the `open` set. CC0 only. `process.ts` reads this list, writes
 * `public/assets/audio/open/manifest.json`, and `assets/ATTRIBUTION.md` lists every origin.
 *
 * Slices were picked by onset analysis + spectrogram inspection (we can't listen in CI); times are seconds.
 */
export type Origin =
  | { kind: 'freesound'; id: number; user: string; title: string }
  | { kind: 'kenney'; pack: 'impact-sounds' | 'rpg-audio'; file: string };

export interface SourceEntry {
  /** Manifest category key (see src/audio/manifest.ts). */
  key: string;
  /** Output basename under public/assets/audio/open/ (no extension). */
  out: string;
  origin: Origin;
  start?: number;
  dur?: number;
  /** Peak target dBFS (one-shots) — or RMS target when `loop` is set. */
  level?: number;
  /** Seconds of fade-out at the end of the slice. */
  fadeOut?: number;
  /** Make a seamless loop (crossfade the tail into the head). Keeps stereo. */
  loop?: boolean;
  /** Extra ffmpeg -af filter chain applied when decoding (e.g. 'highpass=f=80'). */
  af?: string;
}

const fs = (id: number, user: string, title: string) => ({ kind: 'freesound', id, user, title }) as const;
const kenney = (pack: 'impact-sounds' | 'rpg-audio', file: string) =>
  ({ kind: 'kenney', pack, file }) as const;

const FS = {
  ar15: fs(427596, 'michorvath', 'AR15 rifle shot'),
  ar15pistol: fs(427598, 'michorvath', 'AR15 pistol shot'),
  pistol3: fs(385811, 'morganpurkis', 'Single Pistol Gunshot 3.wav'),
  pistol42: fs(391846, 'morganpurkis', 'Single Pistol Gunshot 4.2.wav'),
  pistol2: fs(371440, 'morganpurkis', 'Single Pistol Gunshot 2.wav'),
  ak47: fs(520934, 'ninebilly', 'ak 47 - single shot.mp3'),
  akRange: fs(136399, 'felix.blume', 'Rifle Gun Shot AK47. close recording in a shooting range.'),
  sil1: fs(369781, 'morganpurkis', 'Silenced Gunshot.wav'),
  sil2: fs(380185, 'morganpurkis', 'Silenced Gunshot 2.wav'),
  sil3: fs(381569, 'morganpurkis', 'Silenced Gunshot 3.wav'),
  sil4: fs(396015, 'morganpurkis', 'Silenced Gunshot 4.wav'),
  brass: fs(210102, 'GrayJoy', 'Brass bullet shell casing drop onto concrete, multiple takes'),
  m16reload: fs(725397, 'serøutōnin--deprivəd', 'An M16 Rifle being reloaded while empty; full sequence'),
  glockMag: fs(
    854460,
    'serøutōnin--deprivəd',
    'A Glock handgun having its magazine removed and re-inserted // 3 takes',
  ),
  gravel: fs(521588, 'Fission9', 'Hiking Boot Footsteps on Gravel'),
  tile: fs(834027, 'IENBA', 'Footsteps On Tile'),
  birds: fs(844820, 'rubindaniel', 'Typical spring birdsong'),
  atmos: fs(
    788065,
    'DeeryJ',
    'Early Spring Atmos Outside atmosphere Birds Air Distant Traffic Town 01 Atmospheric Wild Track',
  ),
};

/** Report layers are trimmed short: the space (tail, slap) comes from our reverb, not the recording's. */
const REPORT = { dur: 0.34, fadeOut: 0.22, level: -1 };
const SIL = { dur: 0.3, fadeOut: 0.18, level: -3 };

const range = (n: number) => [...Array(n).keys()];
const ks = (key: string, out: string, pack: 'impact-sounds' | 'rpg-audio', files: string[], level = -3) =>
  files.map((f, i) => ({ key, out: `${out}-${i}`, origin: kenney(pack, f), level, fadeOut: 0.03 }));
const kseq = (prefix: string, n: number) => range(n).map((i) => `${prefix}_00${i}.ogg`);

export const SOURCES: SourceEntry[] = [
  // --- Reports ---------------------------------------------------------------------------------------
  { key: 'report.rifle556.long', out: 'rep-ar15-0', origin: FS.ar15, start: 0.05, ...REPORT },
  { key: 'report.rifle556.short', out: 'rep-ar15p-0', origin: FS.ar15pistol, start: 0.015, ...REPORT },
  // felix.blume: ten clean single AK shots, ~1 s range echo after each (we cut before the echo).
  ...[0.045, 4.61, 10.14, 19.63, 24.1].map((s, i) => ({
    key: 'report.rifle762.short',
    out: `rep-ak-${i}`,
    origin: FS.akRange,
    start: s,
    ...REPORT,
  })),
  { key: 'report.rifle762.short', out: 'rep-ak-5', origin: FS.ak47, start: 1.1, ...REPORT },
  ...[FS.pistol3, FS.pistol42, FS.pistol2].map((o, i) => ({
    key: 'report.pistol9',
    out: `rep-p9-${i}`,
    origin: o,
    start: 0,
    ...REPORT,
    dur: 0.3,
  })),
  ...[FS.sil1, FS.sil2, FS.sil3, FS.sil4].map((o, i) => ({
    key: 'report.suppressed',
    out: `rep-sup-${i}`,
    origin: o,
    start: 0,
    ...SIL,
  })),
  // --- Brass on concrete (six takes, each with its bounces) -------------------------------------------
  ...[0.04, 2.31, 4.08, 5.43, 7.6, 9.92].map((s, i) => ({
    key: 'brass.hard',
    out: `brass-conc-${i}`,
    origin: FS.brass,
    start: s,
    dur: 0.9,
    fadeOut: 0.3,
    level: -3,
  })),
  // --- Reload foley -----------------------------------------------------------------------------------
  { key: 'foley.rifle.magRelease', out: 'rl-r-release-0', origin: FS.m16reload, start: 0.5, dur: 0.18 },
  { key: 'foley.rifle.magOut', out: 'rl-r-out-0', origin: FS.m16reload, start: 0.98, dur: 0.4 },
  { key: 'foley.rifle.magIn', out: 'rl-r-in-0', origin: FS.m16reload, start: 2.1, dur: 0.42 },
  { key: 'foley.rifle.magSeat', out: 'rl-r-seat-0', origin: FS.m16reload, start: 3.08, dur: 0.38 },
  { key: 'foley.rifle.magCheck', out: 'rl-r-check-0', origin: FS.m16reload, start: 4.1, dur: 0.5 },
  { key: 'foley.rifle.boltRelease', out: 'rl-r-bolt-0', origin: FS.m16reload, start: 4.86, dur: 0.42 },
  ...[0.24, 3.47, 6.36].map((s, i) => ({
    key: 'foley.pistol.magOut',
    out: `rl-p-out-${i}`,
    origin: FS.glockMag,
    start: s,
    dur: 0.32,
  })),
  ...[1.7, 4.38, 7.47].map((s, i) => ({
    key: 'foley.pistol.magIn',
    out: `rl-p-in-${i}`,
    origin: FS.glockMag,
    start: s,
    dur: 0.2,
  })),
  ...[1.9, 4.77, 8.0].map((s, i) => ({
    key: 'foley.pistol.magSeat',
    out: `rl-p-seat-${i}`,
    origin: FS.glockMag,
    start: s,
    dur: 0.3,
  })),
  ...ks('foley.any.click', 'click', 'rpg-audio', ['metalClick.ogg', 'metalLatch.ogg']),
  ...ks('foley.cloth', 'cloth', 'rpg-audio', ['cloth1.ogg', 'cloth2.ogg', 'cloth3.ogg', 'cloth4.ogg'], -6),
  // --- Footsteps ----------------------------------------------------------------------------------------
  ...ks('step.concrete', 'step-conc', 'impact-sounds', kseq('footstep_concrete', 5)),
  ...ks('step.wood', 'step-wood', 'impact-sounds', kseq('footstep_wood', 5)),
  ...ks('step.carpet', 'step-carpet', 'impact-sounds', kseq('footstep_carpet', 5)),
  ...ks('step.grass', 'step-grass', 'impact-sounds', kseq('footstep_grass', 5)),
  ...ks('step.dirt', 'step-dirt', 'impact-sounds', kseq('footstep_snow', 5)),
  ...[0.08, 0.84, 1.54, 2.21].map((s, i) => ({
    key: 'step.gravel',
    out: `step-gravel-${i}`,
    origin: FS.gravel,
    start: s,
    dur: 0.36,
    fadeOut: 0.1,
    level: -3,
  })),
  ...[0.0, 0.9].map((s, i) => ({
    key: 'step.tile',
    out: `step-tile-${i}`,
    origin: FS.tile,
    start: s,
    dur: 0.3,
    fadeOut: 0.1,
    level: -3,
  })),
  // --- Mag drops / impacts --------------------------------------------------------------------------------
  ...ks('mag.hard', 'mag-hard', 'impact-sounds', kseq('impactGeneric_light', 5)),
  ...ks('mag.metal', 'mag-metal', 'impact-sounds', kseq('impactMetal_light', 5)),
  ...ks('mag.wood', 'mag-wood', 'impact-sounds', kseq('impactPlank_medium', 5)),
  ...ks('mag.soft', 'mag-soft', 'impact-sounds', kseq('impactSoft_medium', 5)),
  // --- Ambience -------------------------------------------------------------------------------------------
  {
    key: 'amb.outdoor',
    out: 'amb-outdoor-1',
    origin: FS.birds,
    start: 1,
    dur: 38,
    loop: true,
    level: -32,
    af: 'highpass=f=90',
  },
  {
    key: 'amb.outdoor',
    out: 'amb-outdoor-0',
    origin: FS.atmos,
    start: 28,
    dur: 44,
    loop: true,
    level: -30,
  },
];
