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
  // Real suppressed fire at a range (the old morganpurkis "Silenced Gunshot" set was a movie-style "pew").
  supRange: fs(779237, 'YannSauvin', 'Gunshots machine gun with silencer in a shooting range'),
  brass: fs(210102, 'GrayJoy', 'Brass bullet shell casing drop onto concrete, multiple takes'),
  // Foley v2: isolated, close-mic'd clicks/clacks with short decays (the earlier M16/Glock sequences were
  // smeared, scrape-heavy slices that read as "watery").
  m4hw: fs(393732, 'jackthemurray', 'AR15 M4 Gun Hardware Magazine Movement Sounds'),
  arReload: fs(815879, 'qubodup', 'Assault Rifle Reload'),
  g17_01: fs(844184, 'qubodup', 'G17 Handling 01'),
  g17_02: fs(844185, 'qubodup', 'G17 Handling 02'),
  g17_03: fs(844186, 'qubodup', 'G17 Handling 03'),
  g17_04: fs(844187, 'qubodup', 'G17 Handling 04'),
  g17_06: fs(844189, 'qubodup', 'G17 Handling 06'),
  g17_07: fs(844190, 'qubodup', 'G17 Handling 07'),
  g17_08: fs(844191, 'qubodup', 'G17 Handling 08'),
  taurusMag: fs(589845, 'NoonerBear', 'Taurus G2c Magazine Release'),
  taurusSlide: fs(589849, 'NoonerBear', 'Taurus G2c Slide Racking'),
  magHit: fs(444402, 'MootMcnoodles', 'Magazine Hitting Surface.wav'),
  hammer: fs(151068, 'vabadus', 'Beretta M9 hammer click'),
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
const SIL = { dur: 0.15, fadeOut: 0.08, level: -1 };

const range = (n: number) => [...Array(n).keys()];
const ks = (key: string, out: string, pack: 'impact-sounds' | 'rpg-audio', files: string[], level = -3) =>
  files.map((f, i) => ({ key, out: `${out}-${i}`, origin: kenney(pack, f), level, fadeOut: 0.03 }));
const kseq = (prefix: string, n: number) => range(n).map((i) => `${prefix}_00${i}.ogg`);
/** Tight foley slices: start just before each onset, short, quick fade so no smeared tails overlap. */
const foley = (key: string, out: string, origin: Origin, starts: number[], dur = 0.26) =>
  starts.map((st, i) => ({
    key,
    out: `${out}-${i}`,
    origin,
    start: Math.max(0, st - 0.015),
    dur,
    fadeOut: Math.min(0.08, dur * 0.4),
    level: -3,
  }));

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
  // Two single shots and five from the burst (155 ms apart → 0.15 s slices end before the next round).
  ...[1.15, 4.57, 10.635, 10.965, 11.29, 11.605, 11.76].map((st, i) => ({
    key: 'report.suppressed',
    out: `rep-sup-${i}`,
    origin: FS.supRange,
    start: st,
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
  // --- Reload foley (tight slices: onset − 15 ms, ≤ 0.3 s, short fade) ---------------------------------
  ...foley('foley.rifle.magRelease', 'rl-r-release', FS.m4hw, [3.05, 4.61]),
  ...foley('foley.rifle.magOut', 'rl-r-out', FS.m4hw, [1.37, 9.17]),
  ...foley('foley.rifle.magOut', 'rl-r-out-q', FS.arReload, [0.0], 0.4),
  ...foley('foley.rifle.magIn', 'rl-r-in', FS.m4hw, [6.93, 13.98]),
  ...foley('foley.rifle.magIn', 'rl-r-in-q', FS.arReload, [0.58], 0.36),
  ...foley('foley.rifle.magSeat', 'rl-r-seat', FS.m4hw, [4.98, 16.63]),
  ...foley('foley.rifle.magSeat', 'rl-r-seat-q', FS.arReload, [1.35], 0.2),
  ...foley('foley.rifle.magCheck', 'rl-r-check', FS.m4hw, [11.06, 15.07]),
  ...foley('foley.rifle.boltRelease', 'rl-r-bolt', FS.m4hw, [5.52, 18.09]),
  ...foley('foley.rifle.boltRelease', 'rl-r-bolt-q', FS.arReload, [1.66], 0.21),
  // Pistol: Taurus G2c release+drop clusters and slide drops, Glock 17 handling clicks.
  ...foley('foley.pistol.magRelease', 'rl-p-release', FS.g17_02, [0], 0.12),
  ...foley('foley.pistol.magRelease', 'rl-p-release-t', FS.taurusMag, [0.09, 2.81], 0.12),
  ...foley('foley.pistol.magOut', 'rl-p-out', FS.taurusMag, [4.74, 6.43, 9.06], 0.3),
  ...foley('foley.pistol.magOut', 'rl-p-out-g', FS.g17_07, [0.05], 0.2),
  ...foley('foley.pistol.magIn', 'rl-p-in', FS.g17_08, [0], 0.09),
  ...foley('foley.pistol.magIn', 'rl-p-in-g3', FS.g17_03, [0], 0.25),
  ...foley('foley.pistol.magSeat', 'rl-p-seat', FS.g17_06, [0], 0.25),
  ...foley('foley.pistol.magSeat', 'rl-p-seat-t', FS.taurusMag, [8.27, 11.88], 0.18),
  ...foley('foley.pistol.boltRelease', 'rl-p-slide', FS.taurusSlide, [1.84, 4.65, 11.94, 16.92], 0.25),
  ...foley('foley.pistol.boltRelease', 'rl-p-slide-g', FS.g17_01, [0], 0.3),
  ...foley('foley.pistol.magCheck', 'rl-p-check', FS.g17_04, [0], 0.25),
  ...foley('foley.any.dryFire', 'dry', FS.hammer, [0], 0.18),
  ...ks('foley.any.click', 'click', 'rpg-audio', ['metalClick.ogg', 'metalLatch.ogg']),
  ...ks('foley.cloth', 'cloth', 'rpg-audio', ['cloth1.ogg', 'cloth2.ogg', 'cloth3.ogg', 'cloth4.ogg'], -6),
  // --- Footsteps ----------------------------------------------------------------------------------------
  ...ks('step.concrete', 'step-conc', 'impact-sounds', kseq('footstep_concrete', 5)),
  ...ks('step.wood', 'step-wood', 'impact-sounds', kseq('footstep_wood', 5)),
  ...ks('step.carpet', 'step-carpet', 'impact-sounds', kseq('footstep_carpet', 5)),
  ...ks('step.grass', 'step-grass', 'impact-sounds', kseq('footstep_grass', 5)),
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
  { key: 'mag.hard', out: 'mag-hard-mag', origin: FS.magHit, start: 0, dur: 0.3, fadeOut: 0.08, level: -3 },
  ...ks('mag.metal', 'mag-metal', 'impact-sounds', kseq('impactMetal_light', 5)),
  ...ks('mag.wood', 'mag-wood', 'impact-sounds', kseq('impactPlank_medium', 5)),
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
