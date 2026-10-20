import { expect, test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { OUT, bootPistol, record } from './pistolAds';

const SCEN: [string, string, number, number][] = [
  ['p17', 'single', 1, 12],
  ['p17', 'fast5', 5, 10],
  ['p17', 'fast10', 10, 10],
  ['p92', 'single', 1, 12],
  ['p92', 'fast5', 5, 10],
];

for (const [weapon, name, shots, every] of SCEN) {
  test(`pistol ads trace ${weapon} ${name}`, async ({ page }) => {
    test.setTimeout(300_000);
    const q = process.env.PISTOL_ADS_Q ?? '';
    const errors = await bootPistol(page, weapon, q);
    const fr = await record(page, shots, every);
    mkdirSync(OUT, { recursive: true });
    writeFileSync(
      `${OUT}/trace-${weapon}-${name}${process.env.PISTOL_ADS_SFX ?? ''}.json`,
      JSON.stringify(fr),
    );
    expect(errors).toEqual([]);
  });
}
