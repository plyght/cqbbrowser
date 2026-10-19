/* eslint-disable @typescript-eslint/no-explicit-any */
import { expect, test, type Page } from '@playwright/test';

/**
 * Canonical arms contact sheets (anim.html): every weapon family on the same restyled arms.
 * Rows = weapons, columns = actions at a normalised time (see src/anim/rig/dev/rigSheet.ts).
 */
const dir = 'screenshots';

async function sheet(page: Page, query: string, file: string, w: number, h: number) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.setViewportSize({ width: w, height: h });
  await page.goto(`/anim.html?${query}`);
  await page.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 120_000 });
  const info = await page.evaluate(() => {
    const a = (window as any).__anim;
    return { ready: !!a.ready, drawCalls: a.drawCalls, beats: a.beats as string[] };
  });
  await page.screenshot({ path: `${dir}/${file}.png` });
  expect(errors).toEqual([]);
  expect(info.ready).toBe(true);
  return info;
}

const ALL = 'k47s,sb16,hb300,kp9,p17';

test('idle + reloads on the same arms (all weapons)', async ({ page }) => {
  test.setTimeout(300_000);
  const info = await sheet(
    page,
    `mode=rig&weapons=${ALL}&actions=idle@0,reloadTactical@0.3,reloadTactical@0.6,reloadEmpty@0.3,reloadEmpty@0.6,reloadEmpty@0.78&cols=6&tw=320&th=200&cam=-0.02,0.0,0.02&fov=50&look=0.05,-0.16,-0.4`,
    'anims-reloads',
    1920,
    1000,
  );
  // One skinned mesh, two materials.
  expect(info.drawCalls).toBeLessThanOrEqual(3);
  expect(info.beats.some((b) => b.endsWith(':magSeat'))).toBe(true);
});

test('empty-reload finishers differ: AK rack / AR bolt-release slap / HK slap / pistol slide release', async ({
  page,
}) => {
  test.setTimeout(300_000);
  const info = await sheet(
    page,
    'mode=rig&weapons=k47s,sb16,kp9,p17&actions=reloadEmpty@0.62,reloadEmpty@0.7,reloadEmpty@0.76,reloadEmpty@0.82&cols=4&tw=400&th=260&fov=42&look=0.04,-0.15,-0.38',
    'anims-empty-finishers',
    1600,
    1040,
  );
  for (const b of ['boltRelease', 'slideRelease', 'chargingHandle'])
    expect(info.beats.some((x) => x.endsWith(':' + b))).toBe(true);
});

test('mag check hold and swaps', async ({ page }) => {
  test.setTimeout(300_000);
  const info = await sheet(
    page,
    `mode=rig&weapons=${ALL}&actions=magCheck@0.5+hold,swapOut@0.3,swapOut@1,swapIn@0.3,swapIn@0.7&cols=5&tw=320&th=200&fov=55`,
    'anims-magcheck-swaps',
    1600,
    1000,
  );
  for (const b of ['magCheckOut', 'slingDrop', 'swapMid', 'holsterClear'])
    expect(info.beats.some((x) => x.endsWith(':' + b))).toBe(true);
});
