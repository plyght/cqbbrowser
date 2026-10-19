import type { BeatLibrary } from '../beats';
import { PISTOL_BEATS } from './pistol';
import { RIFLE_BEATS } from './rifle';

export type WeaponClass = 'rifle' | 'pistol';
export type ReloadKind = 'tactical' | 'speed';

export const LIBRARIES: Record<WeaponClass, BeatLibrary> = { rifle: RIFLE_BEATS, pistol: PISTOL_BEATS };

/**
 * Beat order for a reload. Empty guns always drop the empty mag (nothing worth retaining) and add the
 * bolt / slide beat; rifles pick bolt-catch slap or charging handle at random.
 */
export function reloadNames(
  cls: WeaponClass,
  kind: ReloadKind,
  empty: boolean,
  rand: () => number,
): string[] {
  if (empty) {
    const charge = cls === 'rifle' ? (rand() < 0.6 ? 'boltRelease' : 'chargingHandle') : 'slideRelease';
    return ['magRelease', 'magDraw', 'magIndex', 'magSeat', charge, 'handReturn'];
  }
  if (kind === 'speed') return ['magRelease', 'magDraw', 'magIndex', 'magSeat', 'handReturn'];
  return ['magGrab', 'magOut', 'magStow', 'magDraw', 'magIndex', 'magSeat', 'handReturn'];
}

/** Mag check while the reload button is held. */
export const CHECK_NAMES = ['magCheck', 'checkPull', 'checkHold', 'checkSeat', 'handReturn'];
export const CAM_FIX_NAMES = ['camReach', 'camAdjust', 'camLetGo'];

/**
 * Double-tap upgrade (tactical → dump): if the mag hasn't been stowed yet, the hand lets go instead.
 * Returns the replacement tail, or null when it's too late to branch.
 */
export function dumpUpgradeTail(tail: readonly string[]): string[] | null {
  const i = tail.indexOf('magStow');
  if (i < 0) return null;
  return [...tail.slice(0, i), 'magDump', ...tail.slice(i + 1)];
}
