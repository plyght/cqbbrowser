import { BORE_Y, layoutBuild, resolveBuild } from '../../weapons/attachments';
import type { WeaponDef } from '../../weapons/defs';
import type { RigParams } from './sim';

/** Rigid-body parameters from a weapon def (derived build stats + layout: support hand, butt pad). */
export function rigParams(def: WeaponDef): RigParams {
  const pistol = def.slot === 'sidearm';
  const balance = def.handling?.balance ?? def.balance ?? (pistol ? 0.012 : 0.05);
  const moment = def.handling?.moment ?? def.mass * (balance * balance + (def.length * def.length) / 14);
  let support: [number, number, number] = pistol ? [-0.018, BORE_Y - 0.06, 0.012] : [0, BORE_Y - 0.02, -0.22];
  let stock: [number, number, number] | null = pistol ? null : [0, BORE_Y - 0.01, 0.3];
  if (def.build) {
    try {
      const l = layoutBuild(resolveBuild(def.build));
      support = l.supportHand;
      if (!pistol) stock = [0, l.boreY - 0.012, l.buttZ];
    } catch {
      /* hand-written def without a valid build: keep the defaults */
    }
  }
  return {
    mass: def.mass,
    balance,
    moment,
    boreY: BORE_Y,
    // Grip, trigger group and mag sit below the bore: the COM is low (pistols: mag in the grip).
    comY: pistol ? -0.028 : BORE_Y - 0.03,
    support,
    stock,
  };
}
