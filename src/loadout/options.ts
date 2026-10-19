/**
 * Slot options for the loadout screen: every part for a slot with whether it can go on, why not, and which
 * other parts would be swapped to make it fit (e.g. a 10.3" barrel takes the 13" rail down to a 9.5").
 */
import { ammoForCaliber, cartridge, muzzleState, type AmmoId } from '../weapons/ammo';
import {
  computeStats,
  defaultBuild,
  partsFor,
  PLATFORMS,
  resolveBuild,
  validateBuild,
  type BuildError,
  type PartDef,
  type SlotId,
  type StockPart,
  type WeaponBuild,
  type WeaponId,
} from '../weapons/attachments';

export interface SlotChange {
  slot: SlotId;
  from: string;
  to: string;
}

export interface TryResult {
  build: WeaponBuild;
  ok: boolean;
  /** Why it can't go on (first relevant validator message). */
  reason?: string;
  /** Other slots swapped automatically to make it valid. */
  changes: SlotChange[];
}

const set = (b: WeaponBuild, slot: SlotId, id: string): WeaponBuild => ({
  ...b,
  parts: { ...b.parts, [slot]: id },
});
const partOf = (b: WeaponBuild, slot: SlotId) => b.parts[slot] ?? PLATFORMS[b.weapon].defaults[slot] ?? '';

function pickReason(errors: BuildError[], slot: SlotId) {
  return (errors.find((e) => e.slot === slot) ?? errors[0])?.message;
}

/**
 * Put `id` in `slot`. If that breaks other slots, try swapping each broken slot for the closest part that
 * fits (default first, then catalog order); never touches `slot` itself. `ok` = the result validates.
 */
export function tryPart(build: WeaponBuild, slot: SlotId, id: string, autoFix = true): TryResult {
  let b = set(build, slot, id);
  let errors = validateBuild(b);
  if (!errors.length) return { build: b, ok: true, changes: [] };
  const reason = pickReason(errors, slot);
  if (!autoFix) return { build: b, ok: false, reason, changes: [] };
  const fixed = new Set<SlotId>([slot]);
  for (let pass = 0; pass < 3 && errors.length; pass++) {
    // Only slots the validator blames are swapped. A missing dependency of the chosen part itself ("needs a
    // top rail") stays a disabled option with its reason, so the player learns what unlocks it.
    const targets = [...new Set(errors.map((e) => e.slot).filter((s): s is SlotId => !!s && !fixed.has(s)))];
    let progressed = false;
    for (const s of targets) {
      const def = PLATFORMS[b.weapon].defaults[s];
      const cands = partsFor(b.weapon, s)
        .map((p) => p.id)
        .sort((x, y) => (x === def ? -1 : y === def ? 1 : 0));
      let best: { b: WeaponBuild; n: number } | null = null;
      for (const c of cands) {
        if (c === partOf(b, s)) continue;
        const nb = set(b, s, c);
        const n = validateBuild(nb).length;
        if (n < errors.length && (!best || n < best.n)) best = { b: nb, n };
        if (n === 0) break;
      }
      if (best) {
        b = best.b;
        fixed.add(s);
        errors = validateBuild(b);
        progressed = true;
        if (!errors.length) break;
      }
    }
    if (!progressed) break;
  }
  if (errors.length) return { build: set(build, slot, id), ok: false, reason, changes: [] };
  const changes: SlotChange[] = [];
  for (const s of PLATFORMS[b.weapon].slots)
    if (s !== slot && partOf(b, s) !== partOf(build, s))
      changes.push({ slot: s, from: partOf(build, s), to: partOf(b, s) });
  return { build: b, ok: true, changes };
}

export interface SlotOption {
  part: PartDef;
  current: boolean;
  result: TryResult;
}

export function slotOptions(build: WeaponBuild, slot: SlotId): SlotOption[] {
  const cur = partOf(build, slot);
  return partsFor(build.weapon, slot).map((part) => ({
    part,
    current: part.id === cur,
    result: part.id === cur ? { build, ok: true, changes: [] } : tryPart(build, slot, part.id),
  }));
}

export interface AmmoOption {
  id: AmmoId;
  name: string;
  /** Muzzle velocity from this build's barrel. */
  velocity: number;
  subsonic: boolean;
  current: boolean;
}

export function ammoOptions(build: WeaponBuild): AmmoOption[] {
  const r = resolveBuild(build);
  const s = computeStats(r);
  const barrel = r.parts.barrel as { velocityMul?: number } | undefined;
  return ammoForCaliber(r.platform.caliber).map((id) => {
    const ms = muzzleState(cartridge(id), s.barrelInches, barrel?.velocityMul ?? 1);
    return {
      id,
      name: cartridge(id).name,
      velocity: ms.velocity,
      subsonic: ms.subsonic,
      current: id === s.ammo,
    };
  });
}

/** Switch weapon platform: keeps nothing but the name-less default build (parts don't carry across). */
export const switchWeapon = (w: WeaponId): WeaponBuild => defaultBuild(w);

export const stockOf = (b: WeaponBuild) => resolveBuild(b).parts.stock as StockPart | undefined;

/** Deterministic PRNG for randomize (mulberry32). */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A random valid build of a weapon (slot order shuffled; each pick must keep the build valid). */
export function randomBuild(weapon: WeaponId, seed = Date.now()): WeaponBuild {
  const rand = rng(seed);
  let b = defaultBuild(weapon);
  const slots = [...PLATFORMS[weapon].slots].sort(() => rand() - 0.5);
  for (const slot of slots) {
    const opts = partsFor(weapon, slot);
    for (let tries = 0; tries < 4; tries++) {
      const p = opts[Math.floor(rand() * opts.length)];
      const r = tryPart(b, slot, p.id, false);
      if (r.ok) {
        b = r.build;
        break;
      }
    }
  }
  const st = stockOf(b);
  const ammo = ammoForCaliber(PLATFORMS[weapon].caliber);
  b.params = {
    ...(st && st.positions > 1 ? { stockPosition: Math.floor(rand() * st.positions) } : {}),
    ammo: ammo[Math.floor(rand() * ammo.length)],
  };
  return validateBuild(b).length ? defaultBuild(weapon) : b;
}
