/* eslint-disable @typescript-eslint/no-explicit-any */
import { expect, test, type Page } from '@playwright/test';
import { boot, play } from './helpers';

/**
 * Hand–weapon hard contact (src/anim/contact): close-up turntable tiles of the canonical rig, raw clip vs the
 * contact layer (anim.html `contact=both`, `at=` camera), plus the `?contact` proxy overlay in game.
 */
const dir = 'screenshots';

async function sheet(page: Page, query: string, file: string, w: number, h: number) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.setViewportSize({ width: w, height: h });
  await page.goto(`/anim.html?mode=rig&${query}`);
  await page.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 240_000 });
  await page.screenshot({ path: `${dir}/${file}.png` });
  expect(errors).toEqual([]);
  return page.evaluate(() => (window as any).__anim.worst as Record<string, number> | undefined);
}

const TILE = 'cols=4&tw=400&th=340';

test('firing-hand grip wrap: raw vs contact (right and left side)', async ({ page }) => {
  test.setTimeout(400_000);
  await sheet(
    page,
    `weapons=sb16,kp9&actions=idle@0&contact=both&${TILE}&at=grip&az=-90&el=5&dist=0.42`,
    'contact-grip-right',
    1600,
    340,
  );
  await sheet(
    page,
    `weapons=sb16,p17&actions=idle@0&contact=both&${TILE}&at=grip&az=90&el=5&dist=0.42`,
    'contact-grip-left',
    1600,
    340,
  );
});

test('support hand on the mag mid-reload and on the KP-9 magwell: raw vs contact', async ({ page }) => {
  test.setTimeout(400_000);
  await sheet(
    page,
    `weapons=sb16,kp9&actions=reloadTactical@0.45,reloadEmpty@0.5&contact=both&${TILE}&at=mag&az=-100&el=10&dist=0.38`,
    'contact-reload-mag',
    1600,
    680,
  );
  await sheet(
    page,
    `weapons=k47s,sb16&actions=idle@0&contact=both&${TILE}&at=support&az=60&el=25&dist=0.42`,
    'contact-support',
    1600,
    340,
  );
});

test('proxy overlay: capsules / palm / wrist coloured by distance, weapon boxes', async ({ page }) => {
  test.setTimeout(400_000);
  const worst = await sheet(
    page,
    `weapons=sb16,p17&actions=idle@0,reloadTactical@0.45&contact=1&overlay=1&${TILE}&at=grip&az=-110&el=15&dist=0.45`,
    'contact-overlay',
    1600,
    340,
  );
  expect(worst && Object.keys(worst).length).toBeGreaterThan(0);
  // Safe mode leaves the firing palm where the clip puts it (no seat move): the overlay shows what remains.
  console.log('overlay worst (m)', JSON.stringify(worst));
});

test('in game: ?contact overlay on the live viewmodel', async ({ page }) => {
  test.setTimeout(200_000);
  const errors = await boot(page, '/?contact');
  await page.evaluate(() => ((window as any).__sb.renderer.dynres.enabled = false));
  await play(page);
  await page.waitForFunction(() => !!(window as any).__sb.weapons.rig, null, { timeout: 90_000 });
  // ~3 s of sim, rendering every 15th frame, so auto-exposure settles before the capture.
  await page.evaluate(() => {
    const g = (window as any).__sb;
    for (let i = 0; i < 180; i++) g.step(1 / 60, i % 15 === 14 || i === 179);
  });
  const ms = await page.evaluate(() => (window as any).__sb.weapons.contact?.stats.ms ?? -1);
  await page.screenshot({ path: `${dir}/contact-ingame.png` });
  expect(ms).toBeGreaterThanOrEqual(0);
  expect(errors).toEqual([]);
});
