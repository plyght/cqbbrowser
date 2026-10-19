/** Prints the handling characterisation table for every preset build: `bun src/anim/handling/handling.bench.ts` */
import { PRESETS, applyBuild } from '../../weapons/attachments';
import { BASE_WEAPONS } from '../../weapons/defs';
import { characterise, formatTable } from './characterise';

export function presetReports() {
  return Object.entries(PRESETS).map(([id, b]) => characterise(id, applyBuild(BASE_WEAPONS[b.weapon], b)));
}

if (import.meta.main) console.log(formatTable(presetReports()));
