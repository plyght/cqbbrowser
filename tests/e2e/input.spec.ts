/* eslint-disable @typescript-eslint/no-explicit-any */
import { expect, test, type Page } from '@playwright/test';
import { boot, play, steps } from './helpers';

/**
 * Gamepad input end-to-end: a fake standard-mapping pad is injected by overriding navigator.getGamepads, then the
 * sim is stepped deterministically. Verifies RS turns, LS moves, X hold opens the ammo-check HUD.
 */

const X = 2;

async function setPad(page: Page, axes: number[], buttons: Record<number, number> = {}) {
  await page.evaluate(
    ([axes, buttons]) => {
      const p = (window as any).__pad;
      p.axes = axes;
      p.buttons = p.buttons.map((_: unknown, i: number) => {
        const v = (buttons as Record<number, number>)[i] ?? 0;
        return { pressed: v > 0.5, touched: v > 0, value: v };
      });
    },
    [axes, buttons] as const,
  );
}

const player = (page: Page) =>
  page.evaluate(() => {
    const p = (window as any).__sb.player;
    return { yaw: p.yaw as number, x: p.position.x as number, z: p.position.z as number };
  });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const pad = {
      id: 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)',
      index: 0,
      connected: true,
      mapping: 'standard',
      timestamp: 0,
      axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })),
    };
    (window as any).__pad = pad;
    Object.defineProperty(navigator, 'getGamepads', {
      value: () => [(window as any).__pad, null, null, null],
    });
  });
});

test('gamepad: RS turns, LS moves, X hold shows ammo check', async ({ page }) => {
  test.setTimeout(180_000); // ~200 SwiftShader frames
  const errors = await boot(page);
  await play(page);
  await steps(page, 10);
  const start = await player(page);

  // Right stick full right → yaw decreases (turning right), ramp kicks in.
  await setPad(page, [0, 0, 1, 0]);
  await steps(page, 20);
  const turned = await player(page);
  expect(start.yaw - turned.yaw).toBeGreaterThan(0.4);
  expect(await page.evaluate(() => (window as any).__sb.ctx.input.frame.activeDevice)).toBe('gamepad');

  // Turn back, then push left stick forward → player moves.
  await setPad(page, [0, 0, -1, 0]);
  await steps(page, 20);
  await setPad(page, [0, -1, 0, 0]);
  await steps(page, 40);
  const moved = await player(page);
  expect(Math.hypot(moved.x - turned.x, moved.z - turned.z)).toBeGreaterThan(0.5);
  expect(Math.abs(moved.yaw - start.yaw)).toBeLessThan(0.05);

  // Back up to the firing line so the HUD screenshot faces the range.
  await setPad(page, [0, 1, 0, 0]);
  await steps(page, 40);

  // X / □ hold → ammo check readout.
  await setPad(page, [0, 0, 0, 0]);
  await steps(page, 10);
  await setPad(page, [0, 0, 0, 0], { [X]: 1 });
  await steps(page, 20);
  await expect(page.locator('.mag-tag.show')).toBeVisible();
  await page.waitForTimeout(400); // HUD opacity transition
  await page.screenshot({ path: 'screenshots/input-gamepad-ammo.png' });

  // Release → readout hides again.
  await setPad(page, [0, 0, 0, 0]);
  await steps(page, 5);
  await expect(page.locator('.mag-tag.show')).toHaveCount(0);

  // LT (analog) aims down sights.
  await setPad(page, [0, 0, 0, 0], { 6: 1 });
  await steps(page, 25);
  await page.screenshot({ path: 'screenshots/input-gamepad-ads.png' });
  expect(await page.evaluate(() => (window as any).__sb.player.aiming)).toBe(true);
  expect(errors).toEqual([]);
});
