/**
 * Offline grip bake (headless, bun): solves every kit weapon's two-hand grip against the true meshes and writes
 * src/anim/contact/gripData.json (see src/anim/contact/gripBake.ts, README).
 *
 *   bun tools/grip-bake.ts            # all weapons, write the data
 *   bun tools/grip-bake.ts sb16 --dry # one weapon, print only
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { loadHeadlessRig } from '../src/anim/contact/audit';
import type { GripBake } from '../src/anim/contact/grip';
import { bakeGrip } from '../src/anim/contact/gripBake';
import {
  GRIP_WEAPONS,
  GripTruth,
  fmtPads,
  loadHeadlessKit,
  wrapFailures,
} from '../src/anim/contact/gripAudit';

const args = process.argv.slice(2);
const ids = args.filter((a) => !a.startsWith('--'));
const weapons = ids.length ? ids : GRIP_WEAPONS;
const FILE = 'src/anim/contact/gripData.json';

const rig = await loadHeadlessRig();
await loadHeadlessKit();
const { buildModel } = await import('../src/weapons/models');
const truth = new GripTruth(rig);
const data = JSON.parse(readFileSync(FILE, 'utf8')) as { version: number; weapons: Record<string, GripBake> };

for (const w of weapons) {
  const model = buildModel(w, { detailParts: true });
  rig.attachWeapon(model, w);
  const t0 = performance.now();
  const bake = bakeGrip(rig, model, truth.gloves, { log: (s) => console.log(`${w}: ${s}`) });
  const R = truth.measure(model, 'R'),
    L = truth.measure(model, 'L');
  console.log(`${w}: baked in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
  console.log(`   R ${fmtPads(R)}  pen ${(R.pen * 1000).toFixed(1)} @${R.worst}`);
  console.log(`   L ${fmtPads(L)}  pen ${(L.pen * 1000).toFixed(1)} @${L.worst}`);
  const fails = [...wrapFailures(R), ...(model.parts.slide ? [] : wrapFailures(L))];
  if (fails.length) console.log(`   ✗ ${fails.join('; ')}`);
  data.weapons[w] = bake;
  rig.setGripSeat(null);
  rig.detachWeapon();
}
if (!args.includes('--dry')) {
  writeFileSync(FILE, JSON.stringify(data, null, 1) + '\n');
  console.log('wrote', FILE);
}
