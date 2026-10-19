import { settings } from '../settings/Settings';
import type { SettingDef } from '../ui/settingsSchema';

/**
 * Listening modes (PRD §9.6):
 * - footage: what CAM04 records (capsule EQ, AGC pumping, clipping, wind, body thumps)
 * - earpro: your ears with electronic hearing protection (clean, protective compressor, quiet sounds lifted)
 * - noprotect: bare ears (hardcore): no mic artefacts, tinnitus + temporary dulling after loud indoor shots
 */
export type ListeningMode = 'footage' | 'earpro' | 'noprotect';

export interface AudioSettings extends Record<string, unknown> {
  master: number;
  sfx: number;
  ambience: number;
  /** 0..1 scale for wind, body thumps, handling noise. */
  micArtifacts: number;
  mode: ListeningMode;
  /** Distant neighbour-bay gunfire on outdoor ranges. */
  neighbours: boolean;
  /** Optional UI-ish "hit confirm" tick on target hits (default off; always on with the Arcade preset). */
  hitTick: boolean;
}

export const AUDIO_DEFAULTS: AudioSettings = {
  master: 0.8,
  sfx: 1,
  ambience: 0.7,
  micArtifacts: 1,
  mode: 'footage',
  neighbours: true,
  hitTick: false,
};

export const audioSettings = () => settings.ns('audio', AUDIO_DEFAULTS);

/** Settings-screen entries owned by audio (registered from AudioEngine so the UI module stays optional). */
export const AUDIO_SETTING_ENTRIES: SettingDef[] = [
  {
    tab: 'audio',
    group: 'Hearing',
    ns: 'audio',
    key: 'mode',
    label: 'Hearing',
    kind: 'select',
    options: [
      { value: 'footage', label: 'Body-cam footage' },
      { value: 'earpro', label: 'Electronic ear protection' },
      { value: 'noprotect', label: 'No protection (hardcore)' },
    ],
    default: 'footage',
    hint: 'Footage: what CAM04 records. Ear-pro: clean, shots clamped. No protection: tinnitus after shots.',
  },
  {
    tab: 'audio',
    group: 'Hearing',
    ns: 'audio',
    key: 'hitTick',
    label: 'Hit confirm tick',
    kind: 'toggle',
    default: false,
    hint: 'A small UI tick when a round hits a target (always on with the Arcade realism preset).',
  },
  {
    tab: 'audio',
    group: 'Hearing',
    ns: 'audio',
    key: 'neighbours',
    label: 'Neighbouring bays',
    kind: 'toggle',
    default: true,
  },
];
