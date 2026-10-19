import { expect, test } from '@playwright/test';
import { boot, play, steps } from './helpers';

const dir = 'screenshots';

test('menu', async ({ page }) => {
  const errors = await boot(page);
  await page.screenshot({ path: `${dir}/00-menu.png` });
  expect(errors).toEqual([]);
});

test('range: idle, ADS, firing, ammo check', async ({ page }) => {
  const errors = await boot(page);
  await play(page);
  await steps(page, 90);
  await page.screenshot({ path: `${dir}/01-range-idle.png` });

  await steps(page, 40, { down: ['aim'] });
  await page.screenshot({ path: `${dir}/02-range-ads.png` });

  // Fire a few shots at the poppers.
  for (let i = 0; i < 4; i++) {
    await steps(page, 2, { down: ['aim', 'fire'] });
    await steps(page, 8, { down: ['aim'] });
  }
  await steps(page, 2, { down: ['aim', 'fire'] });
  await page.screenshot({ path: `${dir}/03-range-fire.png` });

  // Hold reload → ammo check HUD.
  await steps(page, 30, { down: ['reload'] });
  await page.screenshot({ path: `${dir}/04-ammo-check.png` });
  await steps(page, 2);

  // Quick turn: view leads, weapon follows.
  await steps(page, 1, { look: { yaw: 0.6, pitch: 0 } });
  await steps(page, 2);
  await page.screenshot({ path: `${dir}/05-turn-lag.png` });
  expect(errors).toEqual([]);
});
