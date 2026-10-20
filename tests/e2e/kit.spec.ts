/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { boot, play, steps } from './helpers';

/**
 * Blender parts kit (src/weapons/models/kit.ts): the default builds assembled from the GLB kit on the bench, one
 * contact sheet, plus chest-cam idle / ADS frames in game. Screenshots: screenshots/kit-*.png.
 */
const dir = 'screenshots';
const BUILDS: [string, string][] = [
  ['sb16', 'side'],
  ['hb300', 'side'],
  ['k47s', 'side'],
  ['kp9', 'side'],
  ['p17', 'side'],
  ['p92', 'side'],
];

/** Render ~60 consecutive frames so the camera auto-exposure (which adapts on rendered frames) settles. */
async function settle(page: Page, input?: Record<string, unknown>) {
  await page.evaluate((input) => {
    const g = (window as any).__sb;
    for (let i = 0; i < 60; i++) {
      if (input) g.test.next = structuredClone(input);
      g.step(1 / 60, true);
    }
    g.test.next = {};
  }, input ?? null);
}

async function sheet(page: Page, files: string[], out: string, cols = 3) {
  const imgs = files
    .map((f) => `<img src="data:image/png;base64,${readFileSync(f).toString('base64')}">`)
    .join('');
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.setContent(
    `<style>body{margin:0;background:#111;display:grid;grid-template-columns:repeat(${cols},1fr);gap:4px}
     img{width:100%;display:block}</style>${imgs}`,
  );
  await page.waitForTimeout(200);
  await page.screenshot({ path: out, fullPage: true });
}

test('kit: default builds load from the GLB kit on the bench', async ({ page }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto('/bench.html?ui=0&kit=all');
  await page.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 90_000 });
  const files: string[] = [];
  for (const [w, view] of BUILDS) {
    const r = await page.evaluate(
      ([w, v]) => {
        const b = (window as any).__bench;
        const out = b.setBuild({ v: 1, weapon: w, parts: {} }, v);
        return { ...out, kit: !!b.model.root.userData.kit };
      },
      [w, view] as const,
    );
    console.log(`${w}: kit=${r.kit} ${r.drawCalls} draw calls, ${r.triangles} tris`);
    expect(r.errors, w).toEqual([]);
    expect(r.drawCalls, w).toBeLessThanOrEqual(14);
    // Budget 15–40k; the K-47S is the owner-supplied BURNER Krinkov at full resolution (~54k, 4 draw calls).
    expect(r.triangles, w).toBeLessThanOrEqual(w === 'k47s' ? 56_000 : 45_000);
    expect(r.kit, w).toBe(true);
    await page.waitForTimeout(150);
    const f = `${dir}/kit-bench-${w}.png`;
    await page.screenshot({ path: f });
    files.push(f);
  }
  await sheet(page, files, `${dir}/kit-sheet-builds.png`);
  expect(errors).toEqual([]);
});

test('kit: chest cam idle + ADS in game', async ({ page }) => {
  test.setTimeout(900_000);
  const errors = await boot(page, '/?kit=all');
  await page.evaluate(() => ((window as any).__sb.renderer.dynres.enabled = false));
  await play(page);
  await page
    .waitForFunction(() => !!(window as any).__sb.weapons.rig, null, { timeout: 60_000 })
    .catch(() => {});
  const files: string[] = [];
  for (const [slot, model] of [
    [1, 'p17'],
    [0, 'sb16'],
    [0, 'k47s'],
  ] as const) {
    await page.evaluate(
      ([slot, model]) => {
        const w = (window as any).__sb.weapons;
        // Default build of `model` in this slot (the def keeps its stats; only the model key changes).
        const defs = w.loadout.map((e: any) => e.def);
        if (defs[slot].model !== model) {
          defs[slot] = { ...defs[slot], model };
          w.setLoadout(defs);
        }
        w.equipNow(slot);
      },
      [slot, model] as const,
    );
    await steps(page, 140); // swap-in done
    await settle(page);
    const idle = `${dir}/kit-ingame-${model}-idle.png`;
    await page.screenshot({ path: idle });
    await steps(page, 40, { down: ['aim'] });
    await settle(page, { down: ['aim'] });
    const ads = `${dir}/kit-ingame-${model}-ads.png`;
    await page.screenshot({ path: ads });
    files.push(idle, ads);
    const kit = await page.evaluate(() => !!(window as any).__sb.weapons.equipped.model.root.userData.kit);
    expect(kit, model).toBe(true);
  }
  await sheet(page, files, `${dir}/kit-sheet-ingame.png`, 2);
  expect(errors).toEqual([]);
});
