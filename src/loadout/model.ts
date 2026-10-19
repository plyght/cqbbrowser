/**
 * Loadout data model (PRD §2.5): a named primary build + sidearm build + gear. Pure data (no DOM, no three.js),
 * so validation, presets and the WeaponDef conversion are unit-testable and shared by the menu and the game.
 */
import {
  applyBuild,
  defaultBuild,
  PLATFORMS,
  PRESETS,
  validateBuild,
  type WeaponBuild,
  type WeaponId,
} from '../weapons/attachments';
import { BASE_WEAPONS, type WeaponDef } from '../weapons/defs';

export type CarrierId = 'slick' | 'plate' | 'chest';

/** Plate carrier / rig: fixed pouch slots (PRD §6.5) and the weight it adds. */
export interface Carrier {
  id: CarrierId;
  name: string;
  rifleSlots: number;
  pistolSlots: number;
  /** kg (empty, plates included). */
  mass: number;
  blurb: string;
}

export const CARRIERS: Record<CarrierId, Carrier> = {
  slick: {
    id: 'slick',
    name: 'Slick belt rig',
    rifleSlots: 2,
    pistolSlots: 2,
    mass: 1.1,
    blurb: 'Belt only. Light and quick, little to reload from.',
  },
  plate: {
    id: 'plate',
    name: 'Plate carrier',
    rifleSlots: 4,
    pistolSlots: 2,
    mass: 6.8,
    blurb: 'Triple rifle flap plus one on the belt, two pistol. The standard.',
  },
  chest: {
    id: 'chest',
    name: 'Carrier + chest rig',
    rifleSlots: 6,
    pistolSlots: 3,
    mass: 8.4,
    blurb: 'Six rifle mags up front. Heavy and slower to move.',
  },
};

export interface Gear {
  carrier: CarrierId;
  /** Spare rifle mags in pouches (≤ carrier.rifleSlots). */
  rifleMags: number;
  /** Spare pistol mags in pouches (≤ carrier.pistolSlots). */
  pistolMags: number;
  /** Belt dump pouch for tactical reloads (placeholder: always on in game today). */
  dumpPouch: boolean;
  /** Placeholder until gadgets land. */
  flashbangs: number;
  /** Placeholder until night facilities land. */
  nvg: boolean;
}

export interface Loadout {
  id: string;
  name: string;
  primary: WeaponBuild | null;
  sidearm: WeaponBuild | null;
  gear: Gear;
}

export type LoadoutSlot = 'primary' | 'sidearm';

export interface LoadoutError {
  where: LoadoutSlot | 'gear' | 'name';
  message: string;
}

export const MAX_FLASHBANGS = 3;
export const NAME_MAX = 28;

export const PRIMARY_WEAPONS: WeaponId[] = (Object.keys(PLATFORMS) as WeaponId[]).filter(
  (w) => BASE_WEAPONS[w]?.slot === 'primary',
);
export const SIDEARM_WEAPONS: WeaponId[] = (Object.keys(PLATFORMS) as WeaponId[]).filter(
  (w) => BASE_WEAPONS[w]?.slot === 'sidearm',
);
export const weaponsFor = (slot: LoadoutSlot) => (slot === 'primary' ? PRIMARY_WEAPONS : SIDEARM_WEAPONS);

export const defaultGear = (): Gear => ({
  carrier: 'plate',
  rifleMags: 4,
  pistolMags: 2,
  dumpPouch: true,
  flashbangs: 0,
  nvg: false,
});

const clone = <T>(v: T): T => structuredClone(v);
const preset = (id: string, ammo?: string): WeaponBuild => {
  const b = clone(PRESETS[id]);
  if (ammo) b.params = { ...b.params, ammo };
  return b;
};

/** Built-in starter loadouts. Copied into the saved list on first run (so they are editable). */
export const LOADOUT_PRESETS: Loadout[] = [
  {
    id: 'standard',
    name: 'Standard issue',
    primary: defaultBuild('sb16'),
    sidearm: defaultBuild('p17'),
    gear: defaultGear(),
  },
  {
    id: 'cqb-sbr',
    name: 'CQB SBR',
    primary: preset('sb16_cqb', 'm193'),
    sidearm: preset('p17_std'),
    gear: { ...defaultGear(), rifleMags: 3 },
  },
  {
    id: 'quiet-pdw',
    name: 'Quiet PDW',
    primary: preset('hb300_int', 'blk220'),
    sidearm: {
      v: 1,
      weapon: 'p17',
      name: 'P-17 suppressed',
      parts: {
        slide: 'p17_slide_rmr',
        optic: 'p17_rmr',
        barrel: 'p17_b_thread',
        muzzle: 'p17_supp',
        light: 'p17_light',
      },
      params: { ammo: 'p9_147' },
    },
    gear: { ...defaultGear(), rifleMags: 3 },
  },
  {
    id: 'krink',
    name: 'Krink',
    primary: {
      v: 1,
      weapon: 'k47s',
      name: 'K-47S krink',
      parts: {
        handguard: 'ak_hg_wood',
        grip: 'ak_grip_wood',
        stock: 'ak_stock_triangle',
        muzzle: 'ak_booster',
        magazine: 'ak_mag_bake30',
        optic: 'opt_none',
      },
    },
    sidearm: preset('p17_std'),
    gear: { ...defaultGear(), carrier: 'chest', rifleMags: 5, pistolMags: 1 },
  },
  {
    id: 'subgun',
    name: 'Subgun',
    primary: preset('kp9_rail', 'p9_147'),
    sidearm: preset('p17_std'),
    gear: { ...defaultGear(), carrier: 'chest', rifleMags: 6 },
  },
  {
    id: 'pistol-only',
    name: 'Pistol only',
    primary: null,
    sidearm: preset('p17_dot'),
    gear: { ...defaultGear(), carrier: 'slick', rifleMags: 0, pistolMags: 2 },
  },
];

/** Every problem with a loadout (empty = valid). Build problems come from the attachments validator. */
export function validateLoadout(l: Loadout): LoadoutError[] {
  const errors: LoadoutError[] = [];
  if (!l.name.trim()) errors.push({ where: 'name', message: 'name is empty' });
  if (!l.primary && !l.sidearm)
    errors.push({ where: 'primary', message: 'no weapons: pick a primary or sidearm' });
  for (const slot of ['primary', 'sidearm'] as const) {
    const b = l[slot];
    if (!b) continue;
    if (!weaponsFor(slot).includes(b.weapon)) {
      errors.push({ where: slot, message: `${PLATFORMS[b.weapon]?.name ?? b.weapon} is not a ${slot}` });
      continue;
    }
    for (const e of validateBuild(b)) errors.push({ where: slot, message: e.message });
  }
  const c = CARRIERS[l.gear.carrier];
  if (!c) errors.push({ where: 'gear', message: `unknown carrier '${l.gear.carrier}'` });
  else {
    if (l.gear.rifleMags < 0 || l.gear.rifleMags > c.rifleSlots)
      errors.push({ where: 'gear', message: `${c.name} holds ${c.rifleSlots} rifle mags` });
    if (l.gear.pistolMags < 0 || l.gear.pistolMags > c.pistolSlots)
      errors.push({ where: 'gear', message: `${c.name} holds ${c.pistolSlots} pistol mags` });
  }
  if (l.gear.flashbangs < 0 || l.gear.flashbangs > MAX_FLASHBANGS)
    errors.push({ where: 'gear', message: `up to ${MAX_FLASHBANGS} flashbangs` });
  return errors;
}

const int = (v: unknown, lo: number, hi: number, d: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : d;

/** Clamp gear to what the carrier can hold. */
export function fitGear(g: Gear): Gear {
  const c = CARRIERS[g.carrier] ?? CARRIERS.plate;
  return {
    carrier: c.id,
    rifleMags: int(g.rifleMags, 0, c.rifleSlots, Math.min(4, c.rifleSlots)),
    pistolMags: int(g.pistolMags, 0, c.pistolSlots, Math.min(2, c.pistolSlots)),
    dumpPouch: g.dumpPouch !== false,
    flashbangs: int(g.flashbangs, 0, MAX_FLASHBANGS, 0),
    nvg: !!g.nvg,
  };
}

function sanitizeBuild(raw: unknown, slot: LoadoutSlot): WeaponBuild | null {
  if (raw === null) return null;
  const b = raw as WeaponBuild;
  if (!b || typeof b !== 'object' || !weaponsFor(slot).includes(b.weapon))
    return defaultBuild(weaponsFor(slot)[0]);
  const build: WeaponBuild = {
    v: 1,
    weapon: b.weapon,
    ...(typeof b.name === 'string' ? { name: b.name } : {}),
    parts: b.parts && typeof b.parts === 'object' ? { ...b.parts } : {},
    ...(b.params && typeof b.params === 'object' ? { params: { ...b.params } } : {}),
  };
  // A part removed from the catalog (or a stale dependency) falls back to the weapon's default build.
  return validateBuild(build).length ? defaultBuild(b.weapon) : build;
}

/** Repair untrusted (persisted) data into a valid loadout; null if it isn't a loadout at all. */
export function sanitizeLoadout(raw: unknown): Loadout | null {
  const r = raw as Partial<Loadout> | null;
  if (!r || typeof r !== 'object' || typeof r.id !== 'string' || !r.id) return null;
  const l: Loadout = {
    id: r.id,
    name: (typeof r.name === 'string' && r.name.trim() ? r.name.trim() : 'Loadout').slice(0, NAME_MAX),
    primary: sanitizeBuild(r.primary ?? null, 'primary'),
    sidearm: sanitizeBuild(r.sidearm ?? null, 'sidearm'),
    gear: fitGear({ ...defaultGear(), ...(r.gear ?? {}) }),
  };
  if (!l.primary && !l.sidearm) l.sidearm = defaultBuild('p17');
  return l;
}

/** Stable identity of what the player carries (used to skip re-applying an unchanged loadout). */
export const loadoutKey = (l: Loadout) => JSON.stringify([l.primary, l.sidearm, l.gear]);

/**
 * Weapon defs the controller equips, primary first. Spare mags come from the pouches; the loadout name
 * labels nothing in game (each def keeps its build-derived name unless the build is named).
 */
export function loadoutDefs(l: Loadout): WeaponDef[] {
  const out: WeaponDef[] = [];
  if (l.primary)
    out.push({ ...applyBuild(BASE_WEAPONS[l.primary.weapon], l.primary), spareMags: l.gear.rifleMags });
  if (l.sidearm)
    out.push({ ...applyBuild(BASE_WEAPONS[l.sidearm.weapon], l.sidearm), spareMags: l.gear.pistolMags });
  return out;
}
