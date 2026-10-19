/** Static weapon definitions. Attachments modify these via `applyBuild` (see attachments.ts). */
export type FireMode = 'semi' | 'auto' | 'burst' | 'pump';
export type ReloadKind = 'mag' | 'tube' | 'cylinder';

export interface WeaponDef {
  id: string;
  name: string;
  slot: 'primary' | 'sidearm';
  caliber: string;
  /** Muzzle velocity m/s, bullet mass grams → energy for steel and penetration. */
  velocity: number;
  bulletMass: number;
  pellets?: number;
  spreadMoa: number;
  rpm: number;
  modes: FireMode[];
  reload: ReloadKind;
  magCapacity: number;
  /** Mags carried (plate carrier pouches) not counting the one in the gun. */
  spareMags: number;
  /** kg — drives inertia/weapon lag and sway. */
  mass: number;
  /** Overall length m — drives muzzle tuck and lag. */
  length: number;
  /** Recoil impulse: vertical, horizontal wander, roll, rearward (unitless; tuned). */
  recoil: { up: number; side: number; roll: number; back: number };
  /** Sight height over bore (m). */
  sightHeight: number;
  /** Seconds for reload phases (calm). Stressed reloads scale by ~0.85 and add fumble chance. */
  reloadTimes: { tactical: number; speed: number; emptyExtra: number; perRound?: number };
  suppressed?: boolean;
  /** Builder recipe key for the procedural model. */
  model: string;
}

export const WEAPONS: Record<string, WeaponDef> = {
  sb16: {
    id: 'sb16',
    name: 'SB-16 10.3"',
    slot: 'primary',
    caliber: '5.56',
    velocity: 790,
    bulletMass: 4.0,
    spreadMoa: 3,
    rpm: 850,
    modes: ['semi', 'auto'],
    reload: 'mag',
    magCapacity: 30,
    spareMags: 4,
    mass: 2.9,
    length: 0.74,
    recoil: { up: 1.0, side: 0.45, roll: 0.3, back: 1.0 },
    sightHeight: 0.066,
    reloadTimes: { tactical: 2.3, speed: 1.7, emptyExtra: 0.35 },
    model: 'ar',
  },
  hb300: {
    id: 'hb300',
    name: 'HB-300 PDW (.300 BLK, integral can)',
    slot: 'primary',
    caliber: '300blk',
    velocity: 310,
    bulletMass: 14.3,
    spreadMoa: 3.5,
    rpm: 800,
    modes: ['semi', 'auto'],
    reload: 'mag',
    magCapacity: 30,
    spareMags: 4,
    mass: 2.7,
    length: 0.66,
    recoil: { up: 0.85, side: 0.35, roll: 0.25, back: 0.9 },
    sightHeight: 0.066,
    reloadTimes: { tactical: 2.3, speed: 1.7, emptyExtra: 0.35 },
    suppressed: true,
    model: 'pdw',
  },
  k47s: {
    id: 'k47s',
    name: 'K-47S (short AK, 7.62x39)',
    slot: 'primary',
    caliber: '7.62x39',
    velocity: 650,
    bulletMass: 8.0,
    spreadMoa: 4,
    rpm: 650,
    modes: ['semi', 'auto'],
    reload: 'mag',
    magCapacity: 30,
    spareMags: 4,
    mass: 3.1,
    length: 0.73,
    recoil: { up: 1.35, side: 0.7, roll: 0.45, back: 1.25 },
    sightHeight: 0.06,
    reloadTimes: { tactical: 2.6, speed: 1.9, emptyExtra: 0.5 },
    model: 'ak',
  },
  p17: {
    id: 'p17',
    name: 'P-17 (9mm)',
    slot: 'sidearm',
    caliber: '9mm',
    velocity: 360,
    bulletMass: 7.5,
    spreadMoa: 6,
    rpm: 900,
    modes: ['semi'],
    reload: 'mag',
    magCapacity: 17,
    spareMags: 2,
    mass: 0.9,
    length: 0.2,
    recoil: { up: 1.5, side: 0.5, roll: 0.6, back: 0.6 },
    sightHeight: 0.02,
    reloadTimes: { tactical: 1.8, speed: 1.3, emptyExtra: 0.25 },
    model: 'pistol',
  },
};
