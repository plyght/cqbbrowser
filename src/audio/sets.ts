/**
 * Sound sets known at build time. `pro` (Sonniss, gitignored while the repo is public) is picked up
 * automatically when its manifest exists; otherwise only `open` ships. Order = priority.
 */
import type { SoundSetManifest } from './manifest';

const found = import.meta.glob<SoundSetManifest>('../../public/assets/audio/*/manifest.json', {
  eager: true,
  import: 'default',
});

export const SOUND_SETS: SoundSetManifest[] = Object.values(found).sort(
  (a, b) => (a.set === 'pro' ? 0 : 1) - (b.set === 'pro' ? 0 : 1),
);

export const AUDIO_BASE = `${import.meta.env.BASE_URL}assets/audio/`;
