/* eslint-disable @typescript-eslint/no-explicit-any */
import { expect, test, type Page } from '@playwright/test';
import { boot, play, steps } from './helpers';

const dir = 'screenshots';

/** Bench configs: [preset, view, file suffix]. */
const SHOTS: [string, string, string][] = [
  ['sb16_cqb', 'threeq', 'sb16-103-holo-light'],
  ['sb16_cqb', 'side', 'sb16-103-holo-light-side'],
  ['sb16_lpvo', 'threeq', 'sb16-145-lpvo-offset'],
  ['sb16_supp', 'side', 'sb16-115-supp-holo-magnifier'],
  ['sb16_quad', 'threeq', 'sb16-103-quad-vfg'],
  ['hb300_int', 'side', 'hb300-integral'],
  ['hb300_int', 'threeq', 'hb300-integral-3q'],
  ['hb300_sbr', 'side', 'hb300-9in-sbr'],
  ['k47s_wood', 'side', 'k47s-wood'],
  ['k47s_railed', 'threeq', 'k47s-railed-polymer'],
  ['k47s_lpvo', 'side', 'k47s-sidemount-lpvo'],
  ['kp9_std', 'side', 'kp9'],
  ['kp9_rail', 'threeq', 'kp9-railed-suppressed'],
  ['p17_std', 'side', 'p17'],
  ['p17_dot', 'threeq', 'p17-dot-light'],
  ['p17_comp', 'side', 'p17-comp-stick'],
];

async function bench(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto('/bench.html?ui=0');
  await page.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 60_000 });
  return errors;
}

test('weapon bench renders every preset within the perf budget', async ({ page }) => {
  test.setTimeout(240_000);
  const errors = await bench(page);
  for (const [preset, view, name] of SHOTS) {
    const r = await page.evaluate(
      ([p, v]) => {
        const b = (window as any).__bench;
        return b.setBuildByPreset(p, v);
      },
      [preset, view] as const,
    );
    expect(r.errors, preset).toEqual([]);
    // Owner budget: ~6–12 draw calls (≤ 14 with every optic/light), 15–40k triangles max.
    expect(r.drawCalls, preset).toBeLessThanOrEqual(14);
    // The K-47S is the owner-supplied BURNER Krinkov at full resolution (~54k triangles, 4 draw calls).
    expect(r.triangles, preset).toBeLessThanOrEqual(preset.startsWith('k47s') ? 56_000 : 40_000);
    console.log(`${preset}: ${r.drawCalls} draw calls, ${r.triangles} tris`);
    await page.waitForTimeout(150);
    await page.screenshot({ path: `${dir}/weapons-${name}.png` });
  }
  expect(errors).toEqual([]);
});

test('bench UI panel', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/bench.html?preset=sb16_lpvo&view=threeq');
  await page.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 60_000 });
  // Toggle a slot through the UI: AK optic without a rail shows the dependency error.
  await page.selectOption('#panel select >> nth=0', 'k47s');
  await page
    .locator('#panel label', { hasText: /^optic/ })
    .locator('select')
    .selectOption('opt_reddot');
  await expect(page.locator('#panel .errors')).toContainText('top rail');
  await page
    .locator('#panel label', { hasText: /^mount/ })
    .locator('select')
    .selectOption('ak_mount_side');
  await expect(page.locator('#panel .errors')).toHaveCount(0);
  await page.screenshot({ path: `${dir}/weapons-bench-ui.png` });
  expect(errors).toEqual([]);
});

test('in-game chest-cam frame with the configured SB-16', async ({ page }) => {
  test.setTimeout(300_000);
  const errors = await boot(page);
  await play(page);
  await steps(page, 45);
  const info = await page.evaluate(() => {
    const m = (window as any).__sb.weapons.equipped.model;
    return {
      calls: m.stats.drawCalls,
      tris: m.stats.triangles,
      parts: Object.keys(m.parts),
      sockets: Object.keys(m.sockets),
    };
  });
  expect(info.parts).toContain('mag');
  expect(info.sockets).toEqual(
    expect.arrayContaining(['muzzle', 'gripRight', 'gripLeft', 'magwell', 'optic']),
  );
  await page.screenshot({ path: `${dir}/weapons-ingame-chest.png` });
  // Look slightly down: the configured weapon fills the lower right of the bodycam frame.
  await steps(page, 1, { look: { yaw: 0, pitch: -0.35 } });
  await steps(page, 25);
  await page.screenshot({ path: `${dir}/weapons-ingame-chest-low.png` });
  expect(errors).toEqual([]);
});
