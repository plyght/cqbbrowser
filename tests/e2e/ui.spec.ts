/* eslint-disable @typescript-eslint/no-explicit-any */
import { expect, test, type Page } from '@playwright/test';
import { boot, play, steps } from './helpers';

const dir = 'screenshots';

/** Fake standard-mapping gamepad driven from the test (window.__pad.buttons[i] = true). */
async function fakePad(page: Page) {
  await page.addInitScript(() => {
    const pad = { buttons: new Array(17).fill(false), axes: [0, 0, 0, 0] };
    (window as any).__pad = pad;
    navigator.getGamepads = () =>
      [
        {
          index: 0,
          id: 'DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)',
          connected: true,
          mapping: 'standard',
          axes: pad.axes,
          buttons: pad.buttons.map((p: boolean) => ({ pressed: p, value: p ? 1 : 0, touched: p })),
        },
      ] as any;
  });
}

/** Wait for the menu's rAF gamepad poll to run a couple of times. */
const frames = (page: Page) =>
  page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null)))));

async function tapPad(page: Page, i: number) {
  await page.evaluate((i) => ((window as any).__pad.buttons[i] = true), i);
  await frames(page);
  await page.evaluate((i) => ((window as any).__pad.buttons[i] = false), i);
  await frames(page);
}

const focused = (page: Page) =>
  page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    return (
      el?.dataset.act ?? el?.dataset.tab ?? el?.dataset.drill ?? el?.dataset.key ?? el?.textContent ?? ''
    );
  });

test('patch close-up', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 600 });
  await page.goto('/');
  await page.setContent(`<body style="margin:0;height:100vh;display:flex;gap:40px;align-items:center;justify-content:center;
    background:#2a2b26 radial-gradient(ellipse at 40% 40%,#3b3c35,#1d1e1a)">
    <img src="brand/umbra-patch.svg" style="height:520px">
    <div style="display:flex;flex-direction:column;gap:28px;align-items:center">
      <img src="brand/umbra-mark.svg" style="height:120px;opacity:.85">
      <img src="brand/favicon.svg" style="height:64px">
      <img src="brand/shortbarrel-wordmark.svg" style="width:260px">
    </div></body>`);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${dir}/ui-patch.png` });
});

test('main menu, settings tabs, keyboard nav', async ({ page }) => {
  const errors = await boot(page);
  await page.evaluate(() => ((window as any).__sb.manual = true));
  await steps(page, 20);
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${dir}/ui-main-menu.png` });
  expect(await focused(page)).toBe('play');

  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  expect(await focused(page)).toBe('settings');
  await page.keyboard.press('Enter');
  await expect(page.locator('.screen.settings')).toBeVisible();

  // Tabs via E, then a slider adjusts with ArrowRight and persists.
  for (const tab of ['controls', 'gameplay', 'video', 'audio', 'accessibility']) {
    await page.click(`[data-tab="${tab}"]`);
    await page.mouse.move(5, 5);
    await page.screenshot({ path: `${dir}/ui-settings-${tab}.png` });
  }
  await page.click('[data-tab="audio"]');
  await page.keyboard.press('ArrowDown');
  expect(await focused(page)).toBe('audio.master');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  const stored = await page.evaluate(
    () => JSON.parse(localStorage.getItem('shortbarrel.settings.v1')!).audio.master,
  );
  expect(stored).toBeCloseTo(0.8, 5);
  await page.keyboard.press('KeyQ');
  await expect(page.locator('[data-tab="video"].on')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(page.locator('.screen.main')).toBeVisible();
  expect(errors).toEqual([]);
});

test('play flow, pause menu, results (controller)', async ({ page }) => {
  await fakePad(page);
  const errors = await boot(page);
  await page.evaluate(() => {
    const g = (window as any).__sb;
    g.manual = true;
    g.allowUnlocked = true;
  });
  await steps(page, 10);
  // A on Play → drill list; RB switches facility; D-pad down moves through drills.
  await tapPad(page, 0);
  await expect(page.locator('.screen.play')).toBeVisible();
  expect(await focused(page)).toBe('sq-bill');
  await tapPad(page, 13);
  expect(await focused(page)).toBe('sq-elpres');
  // PlayStation pad → PlayStation glyphs in the hints.
  await expect(page.locator('.screen.play .hints-row.pad kbd').first()).toHaveText('✕');
  await page.waitForTimeout(100);
  await page.screenshot({ path: `${dir}/ui-play.png` });
  await tapPad(page, 5);
  await expect(page.locator('[data-facility="Steel Bay"].on')).toHaveCount(1);
  await tapPad(page, 4);
  await tapPad(page, 0); // GO
  await expect(page.locator('.menu')).toBeHidden();

  // In-run → pause shows the pause menu (not the main menu).
  await play(page);
  await steps(page, 30);
  await page.screenshot({ path: `${dir}/ui-hud.png`, clip: { x: 0, y: 0, width: 520, height: 110 } });
  await page.evaluate(() => (window as any).__sb.pause());
  await expect(page.locator('.screen.pause')).toBeVisible();
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${dir}/ui-pause.png` });
  await tapPad(page, 1); // B resumes
  await expect(page.locator('.menu')).toBeHidden();

  await page.evaluate(() =>
    (window as any).__sb.showResults({
      drillId: 'sq-elpres',
      drillName: 'El Presidente',
      facility: 'Square Range',
      time: 8.73,
      par: 10,
      hits: 11,
      shots: 12,
      penalties: [{ label: 'Miss · T2', seconds: 0.5 }],
      splits: [1.42, 0.31, 0.62, 0.29, 0.58, 0.33, 2.21, 0.71, 0.3, 0.6, 0.28, 0.58],
      medal: 'gold',
      previousBest: 9.42,
      hasFootage: true,
    }),
  );
  await expect(page.locator('.screen.results')).toBeVisible();
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${dir}/ui-results.png` });
  expect(await focused(page)).toBe('Retry');
  expect(errors).toEqual([]);
});

test('input integration: trackpad prompt, typing tip, gyro button', async ({ page }) => {
  const errors = await boot(page);
  await page.evaluate(() => ((window as any).__sb.manual = true));
  await steps(page, 5);
  // The trackpad heuristic fires once → one-time prompt on top of the menu.
  await page.evaluate(() => (window as any).__sb.trackpad.onDetected());
  await expect(page.locator('.screen.prompt')).toBeVisible();
  await page.waitForTimeout(150);
  await page.screenshot({ path: `${dir}/ui-trackpad-prompt.png` });
  await page.keyboard.press('Enter');
  await expect(page.locator('.screen.prompt')).toBeHidden();
  const mode = await page.evaluate(
    () => JSON.parse(localStorage.getItem('shortbarrel.settings.v1')!)['input.trackpad'].mode,
  );
  expect(mode).toBe('on');
  // Asked once: a second detection does not prompt again.
  await page.evaluate(() => (window as any).__sb.trackpad.onDetected());
  await expect(page.locator('.screen.prompt')).toBeHidden();

  // Windows typing-suppression tip shows in Controls once suspected.
  await page.evaluate(() => ((window as any).__sb.trackpad.typing.suspected = true));
  await page.click('[data-act="settings"]');
  await expect(page.locator('.settings .notice')).toBeVisible();
  const hasHid = await page.evaluate(() => 'hid' in navigator);
  if (hasHid) await expect(page.locator('[data-key="input.gyro.connect"]')).toBeVisible();
  await page.mouse.move(5, 5);
  await page.screenshot({ path: `${dir}/ui-settings-controls-tips.png` });
  expect(errors).toEqual([]);
});
