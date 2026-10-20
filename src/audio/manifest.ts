/**
 * Sound manifest + loader (PRD §10.3): sounds are addressed by category key, never by file name, so the `open`
 * (CC0 + procedural, committed) and `pro` (Sonniss, private repo only) sets swap as data.
 *
 * Resolution per key: `pro` set → `open` set → procedural synthesis (the engine's fallback). Each set is a
 * `manifest.json` (written by tools/audio/process.ts) next to its files in public/assets/audio/<set>/.
 */
import type { Surface } from '../core/bus';
import type { MechKind, StepClass } from './synth';
import { RoundRobin, type Rng } from './rng';

export type SoundSetName = 'pro' | 'open';

export interface SoundSetManifest {
  version: 1;
  set: SoundSetName;
  /** Encoded formats available, in preference order (e.g. webm = Opus, m4a = AAC for Safari). */
  formats: string[];
  /** Category key → file basenames (variants for round-robin). */
  sounds: Record<string, string[]>;
}

/** Category keys used by the engine (any set may provide any subset). */
export const KEYS = {
  report: (profile: string) => `report.${profile}`,
  foley: (family: string, beat: string) => `foley.${family}.${beat}`,
  step: (cls: StepClass) => `step.${cls}`,
  mag: (cls: MagClass) => `mag.${cls}`,
  brass: (hard: boolean) => (hard ? 'brass.hard' : 'brass.soft'),
  click: 'foley.any.click',
  cloth: 'foley.cloth',
  ambOutdoor: 'amb.outdoor',
  ambIndoor: 'amb.indoor',
} as const;

// --- Weapons: report profile per weapon / caliber + barrel length ----------------------------------------

/** What the muzzle does to the blast: open (bare), flash hider / AK booster, comp, brake, can, integral can. */
export type MuzzleClass = 'open' | 'flash' | 'comp' | 'brake' | 'can' | 'integral';

/** Calibre family of the procedural blast core (crack + muzzle blast + low-mid body). */
export type CoreCal = '556' | 'ak' | '300' | '9';

export interface WeaponSound {
  /** Report profile key (manifest `report.<profile>`). */
  report: string;
  /** Fallback profiles tried in order if the set lacks `report`. */
  fallbacks: string[];
  mech: MechKind;
  /** pistol = handgun stack (tuned against the 9 mm reference pack); smg = pistol calibre, long-gun action. */
  family: 'rifle' | 'pistol' | 'smg';
  barrelIn: number;
  suppressed: boolean;
  /** Playback-rate bias by caliber (bigger case → lower). */
  pitch: number;
  /** Relative blast energy (muzzle energy-ish), 1 = 5.56 carbine. */
  energy: number;
  /** Blast core calibre (rifles/SMGs). */
  core: CoreCal;
  muzzle: MuzzleClass;
  /** Low-pass on the recorded report (darker calibres). */
  reportLp?: number;
  /** What a suppressed shot is when no build says otherwise (the HB-300's stock can is integral). */
  canAs?: 'can' | 'integral';
}

export const WEAPON_SOUNDS: Record<string, WeaponSound> = {
  sb16: {
    report: 'rifle556.short',
    fallbacks: ['rifle556.long', 'rifle762.short'],
    mech: 'ar',
    family: 'rifle',
    barrelIn: 10.3,
    suppressed: false,
    pitch: 1,
    energy: 1,
    core: '556',
    muzzle: 'flash',
  },
  // Default build: 6" barrel + integral can (the event says it's suppressed). With a 5.5"/9" barrel and a
  // muzzle device it is an unsuppressed .300 BLK SBR: deeper, more low-mid body than 5.56.
  hb300: {
    // The darker AK range recordings, pitched down, carry .300's low-mid boom better than the bright 5.56 ones.
    report: 'rifle762.short',
    fallbacks: ['rifle556.short', 'rifle556.long'],
    reportLp: 5500,
    mech: 'ar',
    family: 'rifle',
    barrelIn: 9,
    suppressed: false,
    pitch: 0.9,
    energy: 1.05,
    core: '300',
    muzzle: 'flash',
    canAs: 'integral',
  },
  k47s: {
    report: 'rifle762.short',
    fallbacks: ['rifle556.short'],
    mech: 'ak',
    family: 'rifle',
    barrelIn: 8.5,
    suppressed: false,
    pitch: 0.97,
    energy: 1.15,
    core: 'ak',
    muzzle: 'flash',
  },
  kp9: {
    report: 'pistol9',
    fallbacks: [],
    reportLp: 5000,
    mech: 'mp5',
    family: 'smg',
    barrelIn: 8.9,
    suppressed: false,
    pitch: 1,
    energy: 0.62,
    core: '9',
    muzzle: 'open',
  },
  p17: {
    report: 'pistol9',
    fallbacks: [],
    mech: 'pistol',
    family: 'pistol',
    barrelIn: 4.5,
    suppressed: false,
    pitch: 1,
    energy: 0.55,
    core: '9',
    muzzle: 'open',
  },
};

/** The parts of a built weapon def the audio cares about (WeaponDef satisfies it). */
export interface ShotBuild {
  muzzleDevice?: string;
  barrelLength?: number;
}

const MUZZLE_CLASS: Record<string, MuzzleClass> = {
  bare: 'open',
  flashHider: 'flash',
  booster: 'flash',
  comp: 'comp',
  brake: 'brake',
  suppressor: 'can',
  integral: 'integral',
};

/**
 * Profile for the weapon actually fired: table entry (else derived from caliber), then the build. The event's
 * `suppressed` flag is authoritative (an HB-300 with its shroud swapped for a comp is NOT suppressed), the muzzle
 * device picks the blast character and the barrel length the short-barrel harshness.
 */
export function weaponSound(
  weaponId: string,
  caliber: string,
  suppressed: boolean,
  build?: ShotBuild,
): WeaponSound {
  let base = WEAPON_SOUNDS[weaponId] ?? byCaliber(caliber);
  if (build) {
    const muzzle = MUZZLE_CLASS[build.muzzleDevice ?? ''] ?? base.muzzle;
    const barrelIn = build.barrelLength ? build.barrelLength / 0.0254 : base.barrelIn;
    base = { ...base, muzzle, barrelIn };
  }
  if (suppressed) {
    const muzzle = base.muzzle === 'integral' || (!build && base.canAs === 'integral') ? 'integral' : 'can';
    if (base.suppressed) return { ...base, muzzle };
    return {
      ...base,
      report: 'suppressed',
      fallbacks: [],
      suppressed: true,
      energy: base.energy * 0.8,
      muzzle,
    };
  }
  // An unsuppressed shot never keeps a can class (e.g. a stale def).
  if (base.muzzle === 'can' || base.muzzle === 'integral') base = { ...base, muzzle: 'open' };
  return base;
}

function byCaliber(caliber: string): WeaponSound {
  const c = caliber.toLowerCase();
  if (c.includes('9mm') || c.includes('45') || c.includes('40'))
    return { ...WEAPON_SOUNDS.p17, pitch: c.includes('45') ? 0.92 : 1 };
  if (c.includes('300')) return WEAPON_SOUNDS.hb300;
  if (c.includes('7.62') || c.includes('308') || c.includes('5.45')) return WEAPON_SOUNDS.k47s;
  if (c.includes('12')) return { ...WEAPON_SOUNDS.k47s, pitch: 0.85, energy: 1.4, barrelIn: 14 };
  return WEAPON_SOUNDS.sb16;
}

/**
 * Barrel-length character (PRD §9.1): shorter = louder, harsher, more concussive.
 * Returns report gain, presence boost (dB @ ~3 kHz) and pressure multiplier.
 */
export function barrelCharacter(barrelIn: number) {
  const h = Math.max(0, Math.min(1, (16 - barrelIn) / 12));
  return { gain: 1 + 0.35 * h, presenceDb: 4 * h, pressure: 1 + 0.6 * h, harshness: h };
}

// --- Surfaces → sound classes -------------------------------------------------------------------------------

export type MagClass = 'hard' | 'metal' | 'wood' | 'soft';

export const STEP_CLASS: Record<Surface, StepClass> = {
  concrete: 'concrete',
  concrete_dusty: 'concrete',
  wood: 'wood',
  plywood: 'wood',
  drywall: 'wood',
  carpet: 'carpet',
  tile: 'tile',
  gravel: 'gravel',
  dirt: 'dirt',
  grass: 'grass',
  metal: 'metal',
  steel_target: 'metal',
  paper_target: 'dirt',
  berm: 'dirt',
};

export const MAG_CLASS: Record<StepClass, MagClass> = {
  concrete: 'hard',
  tile: 'hard',
  metal: 'metal',
  wood: 'wood',
  carpet: 'soft',
  grass: 'soft',
  dirt: 'soft',
  gravel: 'soft',
};

export const isHardSurface = (s: Surface) => MAG_CLASS[STEP_CLASS[s]] !== 'soft';

// --- Loader -------------------------------------------------------------------------------------------------

/** Minimal surface of BaseAudioContext the loader needs (so tests can fake it). */
export interface DecodeContext {
  decodeAudioData(data: ArrayBuffer): Promise<AudioBuffer>;
}

export type Fetcher = (url: string) => Promise<ArrayBuffer | null>;

/** Choose the first format this browser can decode. */
export function pickFormat(formats: string[], canPlay: (mime: string) => boolean) {
  const mime: Record<string, string> = {
    webm: 'audio/webm; codecs="opus"',
    m4a: 'audio/mp4; codecs="mp4a.40.2"',
  };
  return formats.find((f) => canPlay(mime[f] ?? `audio/${f}`)) ?? formats[formats.length - 1];
}

export interface SoundVariant {
  buffer: AudioBuffer;
  set: SoundSetName | 'synth';
  /** Source URL (load order is async; variants are re-sorted by this so picks are reproducible). */
  src?: string;
}

/**
 * Holds decoded variants per key with a round-robin picker. Keys are resolved pro → open; anything missing
 * is filled by `addSynth` (procedural fallback) by the engine.
 */
export class SoundBank {
  private variants = new Map<string, SoundVariant[]>();
  private rr = new Map<string, RoundRobin>();
  loadedFrom: Partial<Record<SoundSetName, number>> = {};

  constructor(private rng: Rng = Math.random) {}

  has(key: string) {
    return (this.variants.get(key)?.length ?? 0) > 0;
  }

  /** Which set provided a key (for debugging/tests). */
  source(key: string) {
    return this.variants.get(key)?.[0]?.set;
  }

  add(key: string, v: SoundVariant) {
    let list = this.variants.get(key);
    if (!list) this.variants.set(key, (list = []));
    // Recorded variants replace a procedural stand-in that was generated before loading finished.
    if (v.set !== 'synth' && list.length && list.every((x) => x.set === 'synth')) list.length = 0;
    list.push(v);
    this.rr.set(key, new RoundRobin(list.length, this.rng));
  }

  /** Procedural fallback, only if no recorded variant exists. */
  addSynth(key: string, buffers: AudioBuffer[]) {
    if (this.has(key)) return;
    for (const b of buffers) this.add(key, { buffer: b, set: 'synth' });
  }

  /** Next variant (no immediate repeats), or null if the key is unknown. */
  pick(key: string): AudioBuffer | null {
    const list = this.variants.get(key);
    if (!list?.length) return null;
    return list[this.rr.get(key)!.next()].buffer;
  }

  /** First key in the list that has variants. */
  pickAny(keys: string[]) {
    for (const k of keys) {
      const b = this.pick(k);
      if (b) return b;
    }
    return null;
  }

  keys() {
    return [...this.variants.keys()];
  }

  /**
   * Load sets in priority order. A key present in an earlier set is not loaded from later ones.
   * `base` is the URL prefix of public/assets/audio/.
   */
  async load(
    ctx: DecodeContext,
    sets: SoundSetManifest[],
    base: string,
    fetcher: Fetcher,
    canPlay: (mime: string) => boolean,
    concurrency = 8,
  ) {
    const jobs: { key: string; url: string; set: SoundSetName }[] = [];
    const claimed = new Set<string>();
    for (const m of sets) {
      const fmt = pickFormat(m.formats, canPlay);
      for (const [key, files] of Object.entries(m.sounds)) {
        if (claimed.has(key) || !files.length) continue;
        claimed.add(key);
        for (const f of files) jobs.push({ key, url: `${base}${m.set}/${f}.${fmt}`, set: m.set });
      }
    }
    let next = 0;
    const worker = async () => {
      while (next < jobs.length) {
        const j = jobs[next++];
        try {
          const data = await fetcher(j.url);
          if (!data) continue;
          const buffer = await ctx.decodeAudioData(data);
          this.add(j.key, { buffer, set: j.set, src: j.url });
          this.loadedFrom[j.set] = (this.loadedFrom[j.set] ?? 0) + 1;
        } catch {
          /* undecodable/missing file → synth fallback covers the key */
        }
      }
    };
    await Promise.all(Array.from({ length: concurrency }, worker));
    for (const list of this.variants.values()) list.sort((a, b) => (a.src ?? '').localeCompare(b.src ?? ''));
  }
}
