/* eslint-disable @typescript-eslint/no-explicit-any */
import { expect, test, type Page } from '@playwright/test';
import { boot, play } from './helpers';

const dir = 'screenshots';

// SwiftShader renders the full CAM04 chain at ~1–2 fps; give these specs room.
test.setTimeout(300_000);

/** Advance `seconds` of game time in frames of `dt` (coarser dt = fewer slow SwiftShader renders). */
async function run(page: Page, seconds: number, dt = 1 / 10, input?: Record<string, unknown>) {
  await page.evaluate(
    ([seconds, dt, input]) => {
      const g = (window as any).__sb;
      const n = Math.max(1, Math.round((seconds as number) / (dt as number)));
      for (let i = 0; i < n; i++) {
        if (input) g.test.next = structuredClone(input);
        g.step(dt);
      }
      g.test.next = {};
    },
    [seconds, dt, input ?? null] as const,
  );
}

async function shot(page: Page, name: string) {
  await page.screenshot({ path: `${dir}/render-${name}.png` });
}

async function start(page: Page) {
  const errors = await boot(page);
  await page.evaluate(() => {
    // Fixed-dt stepping in SwiftShader would otherwise read as "slow GPU" and drop the resolution.
    (window as any).__sb.renderer.dynres.enabled = false;
  });
  await play(page);
  return errors;
}

async function teleport(page: Page, x: number, z: number, yaw: number, pitch = 0) {
  await page.evaluate(
    ([x, z, yaw, pitch]) => {
      const g = (window as any).__sb;
      g.player.teleport(g.player.position.clone().set(x, 0, z), yaw);
      g.player.pitch = pitch;
    },
    [x, z, yaw, pitch] as const,
  );
}

/** Fire `n` semi-auto shots, `gap` seconds apart, holding `input` (e.g. aim). */
async function fire(page: Page, n: number, gap = 0.2, hold: string[] = []) {
  for (let i = 0; i < n; i++) {
    await run(page, 1 / 60, 1 / 60, { down: [...hold, 'fire'] });
    await run(page, gap, 1 / 30, { down: hold });
  }
}

test('render: power-on, idle, muzzle flash, fast-yaw starvation', async ({ page }) => {
  const errors = await start(page);
  await run(page, 0.13, 1 / 60);
  await shot(page, 'boot-0.13s');
  await run(page, 0.2, 1 / 60);
  await shot(page, 'boot-0.33s');
  await run(page, 1.8);
  await shot(page, 'idle');
  const stats = await page.evaluate(() => {
    const r = (window as any).__sb.renderer.renderer;
    return { calls: r.info.render.calls, tris: r.info.render.triangles };
  });
  console.log('range idle draw calls / triangles:', stats);

  // Muzzle flash: the frame right after the trigger press.
  await run(page, 1 / 60, 1 / 60, { down: ['fire'] });
  await shot(page, 'flash');
  await run(page, 0.4);
  await shot(page, 'after-shot');

  // Fast yaw: codec starvation + shutter blur + rolling shutter.
  await run(page, 4 / 60, 1 / 60, { look: { yaw: 0.16, pitch: 0 } });
  await shot(page, 'fast-yaw');
  await run(page, 0.6);
  await shot(page, 'after-yaw');
  expect(errors).toEqual([]);
});

test('render: impacts on steel, berm and plywood', async ({ page }) => {
  const errors = await start(page);
  await run(page, 0.5);
  // Steel: 4 m from the x=2 popper.
  await teleport(page, 2, -2.5, 0, -0.2);
  await run(page, 0.6);
  await fire(page, 2, 0.25);
  await run(page, 1 / 60, 1 / 60, { down: ['fire'] });
  await run(page, 1 / 30, 1 / 30);
  await shot(page, 'impact-steel');
  // Berm: 3.5 m from the back berm face.
  await teleport(page, 0, -23.5, 0, -0.18);
  await run(page, 0.6);
  await fire(page, 3, 0.2);
  await run(page, 1 / 60, 1 / 60, { down: ['fire'] });
  await run(page, 1 / 30, 1 / 30);
  await shot(page, 'impact-berm');
  await run(page, 1.5);
  await shot(page, 'decals-berm');
  // Plywood baffle close up: decals + splinters.
  await teleport(page, 10.3, 3, -Math.PI / 2, -0.05);
  await run(page, 0.6);
  await fire(page, 4, 0.18);
  await run(page, 1 / 60, 1 / 60, { down: ['fire'] });
  await run(page, 1 / 30, 1 / 30);
  await shot(page, 'impact-plywood');
  await run(page, 1.2);
  await shot(page, 'decals-plywood');
  const brass = await page.evaluate(
    () => (window as any).__sb.fx.brass.casings.filter((c: any) => c.state !== 0).length,
  );
  expect(brass).toBeGreaterThan(5);
  expect(errors).toEqual([]);
});

test('render: dark room exposure adaptation, noise, weapon light', async ({ page }) => {
  const errors = await start(page);
  await run(page, 1.5);
  await page.evaluate(() => (window as any).__sb.fx.debugDarkRoom(true));
  await run(page, 1 / 30);
  await shot(page, 'dark-0.0s');
  await run(page, 0.5);
  await shot(page, 'dark-0.5s');
  await run(page, 1.0);
  await shot(page, 'dark-1.5s');
  await run(page, 1.5);
  await shot(page, 'dark-3.0s');
  // Muzzle flash in the dark.
  await run(page, 1 / 60, 1 / 60, { down: ['fire'] });
  await shot(page, 'dark-flash');
  await run(page, 0.5);
  // Weapon light on.
  await run(page, 1 / 60, 1 / 60, { down: ['light'] });
  await run(page, 1.5);
  await shot(page, 'dark-light');
  // Back out into daylight: blowout then pull-down.
  await page.evaluate(() => (window as any).__sb.fx.debugDarkRoom(false));
  await run(page, 1 / 30);
  await shot(page, 'bright-0.0s');
  await run(page, 0.5);
  await shot(page, 'bright-0.5s');
  await run(page, 1.0);
  await shot(page, 'bright-1.5s');
  expect(errors).toEqual([]);
});

test('render: ?perf overlay', async ({ page }) => {
  await page.goto('/?perf');
  await page.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 60_000 });
  await play(page);
  await run(page, 0.4);
  const text = await page.locator('[data-perf]').textContent();
  expect(text).toContain('calls');
  expect(text).toContain('scale');
});
