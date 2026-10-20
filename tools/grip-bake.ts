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
import { bakeGrip, bakeSupportStyle } from '../src/anim/contact/gripBake';
import { fitCollision } from '../src/anim/contact/weaponCollision';
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
  rig.setGripSeat(null);
  rig.detachWeapon();
  // Foregrip styles: the support hold on a build carrying that foregrip.
  if (!model.parts.slide)
    for (const [style, part] of [
      ['vertical', 'fg_vertical'],
      ['angled', 'fg_angled'],
    ] as const) {
      let fm;
      try {
        fm = buildModel({ v: 1, weapon: w as never, parts: { foregrip: part } }, { detailParts: true });
      } catch {
        console.log(`${w}: ${part} does not fit this build`);
        continue;
      }
      rig.attachWeapon(fm, w);
      const L = bakeSupportStyle(rig, fm, truth.gloves, bake, style, (s) =>
        console.log(`${w}/${style}: ${s}`),
      );
      if (L) {
        bake.L[style] = L;
        const T = truth.measure(fm, 'L');
        console.log(`   ${style} L ${fmtPads(T)}  pen ${(T.pen * 1000).toFixed(1)} @${T.worst}`);
      }
      rig.setGripSeat(null);
      rig.detachWeapon();
    }
  data.weapons[w] = bake;
}
if (!args.includes('--dry')) {
  writeFileSync(FILE, JSON.stringify(data, null, 1) + '\n');
  console.log('wrote', FILE);
  // Mesh-fitted collision proxies of each kit weapon (the safe-mode proxy layer), rounded to 0.01 mm.
  const PFILE = 'src/anim/contact/kitProxies.json';
  const proxies = JSON.parse(readFileSync(PFILE, 'utf8')) as Record<string, unknown>;
  const r = (v: number) => Math.round(v * 1e5) / 1e5;
  for (const w of weapons) {
    const m = buildModel(w, { detailParts: true });
    proxies[w] = fitCollision(m).map((p) =>
      p.kind === 'box'
        ? {
            ...p,
            center: p.center.map(r),
            half: p.half.map(r),
            r: r(p.r),
            quat: p.quat?.map((q) => Math.round(q * 1e6) / 1e6),
          }
        : { ...p, a: p.a.map(r), b: p.b.map(r), r: r(p.r) },
    );
  }
  writeFileSync(PFILE, JSON.stringify(proxies) + '\n');
  console.log('wrote', PFILE);
}
