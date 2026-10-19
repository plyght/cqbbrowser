/* eslint-disable @typescript-eslint/no-explicit-any */
import { expect, test, type Page } from '@playwright/test';
import { boot, play } from './helpers';

const dir = 'screenshots';
const shot = (page: Page, name: string) => page.screenshot({ path: `${dir}/handling-${name}.png` });

/**
 * Like `steps`, but only renders the last frame (SwiftShader is slow; the sim is what we want to advance).
 */
async function sim(page: Page, n: number, input?: Record<string, unknown>) {
  await page.evaluate(
    ([n, input]) => {
      const g = (window as any).__sb;
      const r = g.renderer;
      const render = r.render;
      r.render = () => {};
      for (let i = 0; i < (n as number); i++) {
        if (input) g.test.next = structuredClone(input);
        if (i === (n as number) - 1) r.render = render;
        g.step(1 / 60);
      }
      r.render = render;
      g.test.next = {};
    },
    [n, input ?? null] as const,
  );
}

const kind = (page: Page) => page.evaluate(() => (window as any).__sb.weapons.reload.kind as string);

async function start(page: Page) {
  const errors = await boot(page);
  await play(page);
  await sim(page, 60);
  return errors;
}

test.describe.configure({ timeout: 180_000 });

test('handling: high ready, ADS, fast turn lag', async ({ page }) => {
  const errors = await start(page);
  await shot(page, 'high-ready');
  await sim(page, 40, { down: ['aim'] });
  await shot(page, 'ads');
  await sim(page, 30);
  // Fast turn: the view arrives first, the muzzle a beat later.
  await sim(page, 1, { look: { yaw: 0.35, pitch: 0 } });
  await sim(page, 1, { look: { yaw: 0.35, pitch: 0 } });
  await shot(page, 'turn-lag');
  expect(errors).toEqual([]);
});

test('handling: tactical reload, mag check, speed reload drops a mag', async ({ page }) => {
  const errors = await start(page);
  for (let i = 0; i < 3; i++) {
    await sim(page, 2, { down: ['fire'] });
    await sim(page, 6);
  }
  await sim(page, 30);
  await sim(page, 2, { down: ['reload'] });
  await sim(page, 24);
  await shot(page, 'reload-mag-out');
  await sim(page, 60);
  expect(await kind(page)).toBe('reload');
  await shot(page, 'reload-index');
  await sim(page, 100);
  expect(await kind(page)).toBe('idle');
  expect(await page.evaluate(() => (window as any).__sb.weapons.equipped.mags.dump.length)).toBe(1);

  // Hold reload: the mag check pulls the mag into the chest cam's view.
  await sim(page, 55, { down: ['reload'] });
  expect(await kind(page)).toBe('check');
  await shot(page, 'mag-check');
  await sim(page, 60);
  expect(await kind(page)).toBe('idle');

  // Double tap: speed reload, physical mag hits the floor and stays there.
  const drops = () => page.evaluate(() => (window as any).__sb.weapons.drops.items.length as number);
  await sim(page, 2, { down: ['fire'] });
  await sim(page, 20);
  await page.evaluate(() => {
    const g = (window as any).__sb;
    g.__magDrops = 0;
    g.ctx.bus.on('magDrop', () => g.__magDrops++);
  });
  await sim(page, 2, { down: ['reload'] });
  await sim(page, 3);
  await sim(page, 2, { down: ['reload'] });
  await sim(page, 12);
  await shot(page, 'speed-reload');
  await sim(page, 120);
  expect(await drops()).toBe(1);
  expect(await page.evaluate(() => (window as any).__sb.__magDrops)).toBe(1);

  // Fix camera: the left hand reaches to the chest cam (mic muffles while the hand is on it).
  await page.evaluate(() => {
    const g = (window as any).__sb;
    g.__camHand = [];
    g.ctx.bus.on('camHand', (e: { active: boolean }) => g.__camHand.push(e.active));
    g.player.knockMount(1);
  });
  await sim(page, 1, { down: ['fixCam'] });
  await sim(page, 22);
  expect(await kind(page)).toBe('camFix');
  await shot(page, 'cam-fix');
  await sim(page, 60);
  expect(await page.evaluate(() => (window as any).__sb.__camHand)).toEqual([true, false]);
  expect(await page.evaluate(() => (window as any).__sb.player.knock)).toBeLessThan(0.01);
  expect(await kind(page)).toBe('idle');
  expect(errors).toEqual([]);
});

test('handling: look down at carrier and legs, lean, pistol', async ({ page }) => {
  const errors = await start(page);
  await sim(page, 1, { look: { yaw: 0, pitch: -1.4 } });
  await sim(page, 30, { move: { x: 0, y: 0.6 } });
  await shot(page, 'look-down');
  await sim(page, 1, { look: { yaw: 0, pitch: 1.4 } });
  await sim(page, 30);
  await sim(page, 45, { down: ['leanRight'] });
  await shot(page, 'lean');
  await sim(page, 40);
  await sim(page, 1, { down: ['switchWeapon'] });
  await sim(page, 70);
  await shot(page, 'pistol');
  await sim(page, 35, { down: ['aim'] });
  await shot(page, 'pistol-ads');
  expect(errors).toEqual([]);
});
