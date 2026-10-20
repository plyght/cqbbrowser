/* eslint-disable @typescript-eslint/no-explicit-any */
import { expect, test, type Page } from '@playwright/test';
import { boot, play } from './helpers';

/**
 * Illuminated reticles at ADS: day, dark room (AE gain up), dark room + NVG (tube gain). The dot must stay a few
 * px with a modest glow in all three (it used to bloom into a blob once the exposure / tube gain rose).
 * Screenshots: screenshots/reticle-<optic>-<light>.png (+ a 3x centre crop).
 */
const dir = process.env.SB_SHOTS ?? 'screenshots';

/** Step n frames, rendering the last `render` of them (auto-exposure only adapts on rendered frames). */
async function sim(page: Page, n: number, input?: Record<string, unknown>, render = 0) {
  await page.evaluate(
    ([n, input, render]) => {
      const g = (window as any).__sb;
      for (let i = 0; i < (n as number); i++) {
        if (input) g.test.next = structuredClone(input);
        g.step(1 / 60, i >= (n as number) - (render as number) || i % 15 === 14);
      }
      g.test.next = {};
    },
    [n, input ?? null, render] as const,
  );
}

/** Red-dominant bright pixels near the screen centre (the reticle + its glow), and their extent. */
function redBlob(page: Page) {
  return page.evaluate(() => {
    const src = (window as any).__sb.renderer.renderer.domElement as HTMLCanvasElement;
    const c = document.createElement('canvas');
    c.width = src.width;
    c.height = src.height;
    const x = c.getContext('2d')!;
    x.drawImage(src, 0, 0);
    const R = Math.round(src.height * 0.12);
    const cx = Math.round(src.width / 2) - R,
      cy = Math.round(src.height / 2) - R;
    const d = x.getImageData(cx, cy, 2 * R, 2 * R).data;
    let n = 0,
      x0 = 1e9,
      x1 = -1,
      y0 = 1e9,
      y1 = -1;
    for (let j = 0; j < 2 * R; j++)
      for (let i = 0; i < 2 * R; i++) {
        const k = (j * 2 * R + i) * 4;
        const r = d[k],
          g = d[k + 1],
          b = d[k + 2];
        if (r > 140 && r > g * 1.6 && r > b * 1.6) {
          n++;
          x0 = Math.min(x0, i);
          x1 = Math.max(x1, i);
          y0 = Math.min(y0, j);
          y1 = Math.max(y1, j);
        }
      }
    return { px: n, w: x1 >= 0 ? x1 - x0 + 1 : 0, h: y1 >= 0 ? y1 - y0 + 1 : 0, height: src.height };
  });
}

async function shoot(page: Page, name: string) {
  await page.screenshot({ path: `${dir}/reticle-${name}.png` });
  const vp = page.viewportSize()!;
  await page.screenshot({
    path: `${dir}/reticle-${name}-crop.png`,
    clip: { x: vp.width / 2 - 64, y: vp.height / 2 - 40, width: 128, height: 80 },
    scale: 'css',
  });
}

test.describe.configure({ timeout: 1_800_000 });

const CASES: [number, string, string, number][] = [
  [0, 'sb16_cqb', 'holo', 0],
  [0, 'sb16_quad', 'reddot', 0],
  [0, 'sb16_lpvo', 'lpvo', 0],
  [0, 'sb16_lpvo', 'offset', 1],
  [1, 'p17_dot', 'rmr', 0],
];

for (const light of ['day', 'dark', 'nvg'] as const) {
  test(`reticles (${light}): realistic size, modest glow`, async ({ page }) => {
    const errors = await boot(page);
    await page.evaluate(() => ((window as any).__sb.renderer.dynres.enabled = false));
    await play(page);
    await page
      .waitForFunction(() => !!(window as any).__sb.weapons.rig, null, { timeout: 60_000 })
      .catch(() => {});
    await sim(page, 120);
    if (light !== 'day') await page.evaluate(() => (window as any).__sb.fx.debugDarkRoom(true));
    if (light === 'nvg')
      await page.evaluate(() => {
        const g = (window as any).__sb;
        g.test.next = { down: ['nvg'] };
        g.step(1 / 60, false);
        g.test.next = {};
      });
    for (const [slot, preset, name, mode] of CASES) {
      await page.evaluate(
        ([slot, preset, mode]) => {
          const w = (window as any).__sb.weapons;
          w.setPreset(slot, preset);
          if (w.loadout[slot] !== w.equipped) w.equipNow(slot);
          w.aimIndex = mode;
        },
        [slot, preset, mode] as const,
      );
      await sim(page, 90, { down: ['aim'] }, 60);
      await shoot(page, `${name}-${light}`);
      const blob = await redBlob(page);
      const st = await page.evaluate(() => {
        const w = (window as any).__sb.weapons;
        return { blend: w.adsBlend, mode: w.sightLine?.mode.id, optic: w.sightLine?.mode.optic };
      });
      console.log(name, light, JSON.stringify(blob), JSON.stringify(st));
      expect(st.blend).toBeGreaterThan(0.99);
      // A few px across at 720p (glow included), never a blob; the dot must still be there. (Under NVG the
      // phosphor is monochrome: screenshots only.)
      if (light !== 'nvg') {
        const scale = blob.height / 720;
        expect(blob.px).toBeGreaterThan(0);
        const maxW = (name === 'holo' ? 22 : 12) * scale;
        expect(blob.w).toBeLessThan(maxW);
        expect(blob.h).toBeLessThan(maxW);
      }
      await sim(page, 20);
    }
    expect(errors).toEqual([]);
  });
}
