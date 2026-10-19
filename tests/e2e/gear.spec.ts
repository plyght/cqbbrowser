/* eslint-disable @typescript-eslint/no-explicit-any */
import { expect, test, type Page } from '@playwright/test';
import { boot, play, steps } from './helpers';

const dir = 'screenshots';
test.setTimeout(900_000);

const O = { x: -158, z: -6 };

async function ready(page: Page) {
  await page.evaluate(() => (window as any).__sb.world.ready);
  await play(page);
  await steps(page, 50);
}

/** Place the player (kill-house layout x/z, yaw, pitch) without moving targets. */
async function place(page: Page, x: number, z: number, yaw: number, pitch = 0) {
  await page.evaluate(
    ([x, z, yaw, pitch]) => {
      const g = (window as any).__sb;
      const V = g.player.position.constructor;
      g.player.teleport(new V(x, 0.02, z), yaw);
      g.player.pitch = pitch;
    },
    [O.x + x, O.z + z, yaw, pitch],
  );
}

async function freeCam(page: Page, pos: number[] | null, look?: number[]) {
  await page.evaluate(
    ([pos, look, ox, oz]) => {
      const g = (window as any).__sb;
      const V = g.player.position.constructor;
      if (!pos) return g.world.setFreeCam(null);
      const p = pos as number[];
      const l = look as number[];
      g.world.setFreeCam(new V(ox + p[0], p[1], oz + p[2]), new V(ox + l[0], l[1], oz + l[2]));
    },
    [pos, look ?? null, O.x, O.z] as const,
  );
}

async function drawCalls(page: Page): Promise<number> {
  return page.evaluate(() => {
    const g = (window as any).__sb;
    const info = g.renderer.renderer.info;
    info.reset();
    g.renderer.render(1 / 60);
    return info.render.calls;
  });
}

test('kill house roof: exterior + dark interior with practical lights', async ({ page }) => {
  const errors = await boot(page, '/?map=killhouse');
  await ready(page);
  const roofed = await page.evaluate(() => (window as any).__sb.world.killhouse.roofed);
  expect(roofed).toBe(true);
  const graph = await page.evaluate(() =>
    (window as any).__sb.world.roomGraph().rooms.map((r: any) => [r.openTop, r.ceilingHeight]),
  );
  expect(graph.every((r: any) => r[0] === false && r[1] > 2.5)).toBe(true);

  await freeCam(page, [24, 9, 22], [8, 1, 6]);
  await steps(page, 6);
  await page.screenshot({ path: `${dir}/gear-roof-exterior.png` });
  await freeCam(page, null);

  // Cross hall looking east: two bulbs (one flickering), the dark Room 2 door, the work light glow in R3.
  await place(page, 1.0, 5.4, -Math.PI / 2);
  await steps(page, 70);
  const calls = await drawCalls(page);
  console.log('draw calls roofed killhouse (hall):', calls);
  await page.screenshot({ path: `${dir}/gear-roof-hall.png` });

  // Room 1 from its door: bulb + daylight through window W1.
  await place(page, 3.7, 6.6, Math.PI * 0.72, -0.05);
  await steps(page, 60);
  await page.screenshot({ path: `${dir}/gear-roof-room1.png` });

  // Room 3 (work light) through the open door D3.
  await page.evaluate(() => (window as any).__sb.world.door('D3').setOpen(1));
  await place(page, 4.75, 4.3, 0.55, -0.08);
  await steps(page, 60);
  await page.screenshot({ path: `${dir}/gear-roof-room3.png` });
  expect(calls).toBeLessThan(150);
  expect(errors).toEqual([]);
});

/**
 * Step `n` frames, drawing every `every`th and the last two (skipped frames still advance the post chain's
 * temporal state on the next draw). SwiftShader frames of the lit kill house cost seconds: keep draws rare.
 */
async function run(page: Page, n: number, every = 1000, input?: Record<string, unknown>) {
  await page.evaluate(
    ([n, every, input]) => {
      const g = (window as any).__sb;
      for (let i = 0; i < (n as number); i++) {
        if (input) g.test.next = structuredClone(input);
        g.step(1 / 60, (i > 0 && i % (every as number) === 0) || i >= (n as number) - 2);
      }
      g.test.next = {};
    },
    [n, every, input ?? null] as const,
  );
}

async function press(page: Page, action: string) {
  await page.evaluate((a) => {
    const g = (window as any).__sb;
    g.test.next = { down: [a] };
    g.step(1 / 60, false);
    g.test.next = {};
    g.step(1 / 60, false);
  }, action);
}

test('night vision: mono green, white phosphor, dual tube, IR laser', async ({ page }) => {
  const errors = await boot(page, '/?map=killhouse');
  await ready(page);
  // Room 2 is unlit: only the window and the hall spill.
  await page.evaluate(() => (window as any).__sb.world.door('D2').setOpen(1));
  await place(page, 9.4, 6.5, -Math.PI * 0.72, -0.04);
  await run(page, 40);
  await page.screenshot({ path: `${dir}/gear-nvg-off.png` });
  await press(page, 'nvg');
  await run(page, 14);
  await page.screenshot({ path: `${dir}/gear-nvg-flip.png` });
  await run(page, 70);
  expect(await page.evaluate(() => (window as any).__sb.renderer.nvg.active)).toBe(true);
  await page.screenshot({ path: `${dir}/gear-nvg-green.png` });

  await page.evaluate(() => (window as any).__sb.gear.settings.set({ phosphor: 'white' }));
  await run(page, 20);
  await page.screenshot({ path: `${dir}/gear-nvg-white.png` });

  await page.evaluate(() => (window as any).__sb.gear.settings.set({ phosphor: 'green', nvgTubes: 'dual' }));
  await run(page, 20);
  await page.screenshot({ path: `${dir}/gear-nvg-dual.png` });
  await page.evaluate(() => (window as any).__sb.gear.settings.set({ nvgTubes: 'mono' }));

  // IR laser + illuminator, aimed down Room 2.
  await press(page, 'ir');
  await run(page, 30);
  expect(await page.evaluate(() => (window as any).__sb.gear.ir.beam.visible)).toBe(true);
  await page.screenshot({ path: `${dir}/gear-nvg-ir.png` });
  console.log('draw calls under NVG:', await drawCalls(page));
  // Flip up: the tube powers off and the pass turns off once it's out of view.
  await press(page, 'nvg');
  await run(page, 40);
  expect(await page.evaluate(() => (window as any).__sb.renderer.nvg.active)).toBe(false);
  await page.evaluate(() => (window as any).__sb.gear.settings.reset());
  expect(errors).toEqual([]);
});

test('flashbang: throw, mid-air, indoor white-out, recovery', async ({ page }) => {
  const errors = await boot(page, '/?map=killhouse');
  await ready(page);
  await page.evaluate(() => {
    const w = window as any;
    w.__flinch = 0;
    w.__sb.ctx.bus.on('flinch', (e: any) => (w.__flinch = e.strength));
  });
  // Cross hall facing east: wind up and lob one down the hall.
  await place(page, 1.2, 5.4, -Math.PI / 2, 0.02);
  await run(page, 30);
  const before = await page.evaluate(() => (window as any).__sb.gear.flashbangs);
  await run(page, 32, 1000, { down: ['throw'] });
  await run(page, 9);
  expect(await page.evaluate(() => (window as any).__sb.gear.flashbangs)).toBe(before - 1);
  await page.screenshot({ path: `${dir}/gear-flash-midair.png` });
  // Fuse: ~1.5 s after release.
  await page.evaluate(() => {
    const g = (window as any).__sb;
    for (let i = 0; i < 150 && g.gear.whiteout < 0.3; i++) g.step(1 / 60, false);
  });
  await run(page, 2);
  const white = await page.evaluate(() => (window as any).__sb.gear.whiteout);
  console.log('white-out', white, 'flinch', await page.evaluate(() => (window as any).__flinch));
  expect(white).toBeGreaterThan(0.6);
  await page.screenshot({ path: `${dir}/gear-flash-whiteout.png` });
  await run(page, 90);
  await page.screenshot({ path: `${dir}/gear-flash-recovery.png` });
  expect(await page.evaluate(() => (window as any).__sb.gear.whiteout)).toBeLessThan(white);
  expect(errors).toEqual([]);
});
