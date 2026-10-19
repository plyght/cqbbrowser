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
export const CHECK_NAMES = ['magCheck', 'magCheckOut', 'checkHold', 'magCheckIn', 'magSeat', 'handReturn'];

/**
 * Fire pressed during a mag check: the remaining beats become a fast reinsert. Before the mag is out the hand just
 * lets go; once it's out it goes straight back in and is seated. Null = nothing to change (already seating).
 */
export function checkAbortTail(current: string): string[] | null {
  if (current === 'magCheck') return ['checkRelease', 'handReturn'];
  if (current === 'magCheckOut' || current === 'checkHold') return ['magCheckIn', 'magSeat', 'handReturn'];
  return null;
}
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

/**
 * Seam for the authored arms rig (`src/anim/rig` ArmsRig, when it lands): every hand plan the WeaponController
 * starts maps onto one rig action. The rig's `onEvent(beat)` replaces `BeatSink.hit` (→ `weaponBeat` + contact
 * kicks: magSeat / boltRelease / chargingHandle / slideRelease), `hold` + `releaseHold()` replace
 * `BeatPlayer.holding` for the mag check, and the inventory events (magToHand / magHide / drop / chamber) come from
 * the rig's markers. The switch state machine maps out/in to `swapOut` / `swapIn` with `swapMid` at the change.
 */
export const RIG_ACTION = {
  tactical: 'reloadTactical',
  speed: 'reloadEmpty',
  empty: 'reloadEmpty',
  check: 'magCheck',
  swapOut: 'swapOut',
  swapIn: 'swapIn',
} as const;
