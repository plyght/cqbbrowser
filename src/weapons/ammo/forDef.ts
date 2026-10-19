import type { WeaponDef } from '../defs';
import { resolveAmmo } from './cartridges';
import type { Cartridge } from './types';

/** The load a weapon def fires: its build's `params.ammo`, else the caliber default. */
export const ammoOf = (def: Pick<WeaponDef, 'caliber' | 'build'>): Cartridge =>
  resolveAmmo(def.caliber, def.build?.params?.ammo);
