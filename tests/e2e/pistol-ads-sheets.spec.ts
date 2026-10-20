/* eslint-disable @typescript-eslint/no-explicit-any */
import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { OUT, bootPistol } from './pistolAds';

/**
 * Pistol ADS frame sequences for the owner's eyes: ~70 rendered frames at ADS first (auto-exposure only adapts on
 * rendered frames; steps() renders only the last 3), then one screenshot per frame around a shot (single, or a
 * 5-shot string), assembled into contact sheets at $OUT/$PISTOL_ADS_SHEETS-<weapon>-<name>.png.
 * Run with PISTOL_ADS_SHEETS=pistolads-<n>.
 */
const SHEETS = process.env.PISTOL_ADS_SHEETS;

for (const [weapon, name, shots, every, frames, stride] of [
  ['p17', 'single', 1, 12, 24, 1],
  ['p17', 'string', 5, 10, 60, 3],
  ['p92', 'single', 1, 12, 24, 1],
] as [string, string, number, number, number, number][]) {
  test(`pistol ads sheet ${weapon} ${name}`, async ({ page }) => {
    test.skip(!SHEETS, 'set PISTOL_ADS_SHEETS to render contact sheets');
    test.setTimeout(400_000);
    await page.setViewportSize({ width: 640, height: 360 });
    const errors = await bootPistol(page, weapon);
    await page.setViewportSize({ width: 640, height: 360 });
    await page.evaluate(() => {
      const g = (window as any).__sb;
      g.renderer.dynres.enabled = false;
      for (let i = 0; i < 70; i++) {
        g.test.next = { down: ['aim'] };
        g.step(1 / 60, true);
        g.renderer.render(0);
      }
    });
    const pngs: string[] = [];
    for (let i = 0; i < frames; i++) {
      const fire = i >= 3 && i < 3 + shots * every && (i - 3) % every < 2;
      await page.evaluate(
        ([fire]) => {
          const g = (window as any).__sb;
          g.test.next = { down: fire ? ['aim', 'fire'] : ['aim'] };
          g.step(1 / 60, true);
          g.renderer.render(0);
        },
        [fire] as const,
      );
      if (i % stride === 0) pngs.push((await page.locator('canvas').first().screenshot()).toString('base64'));
    }
    const cols = 4;
    const cells = pngs
      .map(
        (b, k) =>
          '<div style="position:relative"><img width=320 src="data:image/png;base64,' +
          b +
          '"><span style="position:absolute;left:4px;top:2px;color:#ff0;font:12px monospace">f' +
          k * stride +
          '</span></div>',
      )
      .join('');
    await page.setViewportSize({ width: cols * 322, height: Math.ceil(pngs.length / cols) * 182 });
    await page.setContent(
      '<body style="margin:0;background:#111;display:grid;grid-template-columns:repeat(' +
        cols +
        ',320px);gap:2px">' +
        cells +
        '</body>',
    );
    mkdirSync(OUT, { recursive: true });
    await page.screenshot({ path: OUT + '/' + SHEETS + '-' + weapon + '-' + name + '.png', fullPage: true });
    expect(errors).toEqual([]);
  });
}
