/* eslint-disable @typescript-eslint/no-explicit-any */
import { expect, test, type Page } from '@playwright/test';
import { boot, steps } from './helpers';

const dir = 'screenshots';

/** Open the loadout screen through the main menu (keyboard), with the turntable held still. */
async function openLoadout(page: Page) {
  await page.evaluate(() => localStorage.removeItem('shortbarrel.loadouts.v1'));
  await page.evaluate(() => {
    const g = (window as any).__sb;
    g.manual = true; // the range behind the menu stays still (and cheap) while we screenshot
    g.menu.loadout.turntable.auto = false;
    (document.querySelector('[data-act="loadout"]') as HTMLElement).click();
  });
  await expect(page.locator('.screen.loadout')).toBeVisible();
}

/** Select a saved loadout by id and redraw the turntable synchronously. */
async function selectLoadout(page: Page, id: string, tab: 'primary' | 'sidearm' | 'gear' = 'primary') {
  await page.evaluate(
    ([id, tab]) => {
      const s = (window as any).__sb.menu.loadout;
      s.select(id);
      s.setTab(tab);
    },
    [id, tab],
  );
  await settle(page);
}

async function settle(page: Page) {
  await page.waitForTimeout(250);
  await page.evaluate(() => (window as any).__sb.menu.loadout.turntable.renderNow());
}

test('loadout screen: builds, dependency reasons, sidearm, gear', async ({ page }) => {
  const errors = await boot(page);
  await openLoadout(page);

  // SB-16 CQB build.
  await selectLoadout(page, 'cqb-sbr');
  await expect(page.locator('.lo-row[data-key="row:barrel"]')).toContainText('10.3');
  await page.screenshot({ path: `${dir}/loadout-sb16.png` });

  // Open the optic slot on the K-47S: the LPVO needs a rail it doesn't have → disabled with the reason.
  await selectLoadout(page, 'krink');
  await page.evaluate(() => (window as any).__sb.menu.loadout.openOptions('optic'));
  const lpvo = page.locator('.lo-opt[data-opt="opt_lpvo"]');
  await expect(lpvo).toHaveClass(/bad/);
  await expect(lpvo.locator('.lo-reason')).not.toBeEmpty();
  await lpvo.focus();
  await settle(page);
  await page.screenshot({ path: `${dir}/loadout-invalid.png` });
  // Selecting it does nothing; B/Esc returns to the slot list.
  await page.keyboard.press('Enter');
  await expect(page.locator('.lo-opt').first()).toBeVisible();
  await page.keyboard.down('Escape');
  await page.keyboard.up('Escape');
  await expect(page.locator('.lo-row[data-key="row:optic"]')).toBeVisible();

  // Focus a part option: stats show a delta vs the current build.
  await selectLoadout(page, 'quiet-pdw');
  await page.evaluate(() => (window as any).__sb.menu.loadout.openOptions('optic'));
  await page.locator('.lo-opt[data-opt="opt_lpvo"]').focus();
  await expect(page.locator('.lo-stat.down[data-stat="mass"]')).toBeVisible();
  await settle(page);
  await page.screenshot({ path: `${dir}/loadout-hb300.png` });
  await page.locator('.lo-opt[data-opt="opt_lpvo"]').click();
  await expect(page.locator('.lo-row[data-key="row:optic"]')).toContainText('LPVO');

  // Sidearm tab via E (RB on a pad).
  await page.keyboard.press('KeyE');
  await expect(page.locator('.lo-tabs .tab.on')).toContainText('Sidearm');
  await settle(page);
  await page.screenshot({ path: `${dir}/loadout-sidearm.png` });

  // Gear: mags step with ←/→ (axis rows).
  await page.keyboard.press('KeyE');
  await page.locator('.lo-row[data-key="row:rifleMags"]').focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.lo-row[data-key="row:rifleMags"]')).toContainText('4 /');
  await settle(page);
  await page.screenshot({ path: `${dir}/loadout-gear.png` });

  // Saved: duplicate + rename persists in localStorage.
  await page.locator('[data-key="act:dup"]').click();
  await page.locator('[data-key="act:rename"]').click();
  await page.keyboard.type('Night shift');
  await page.keyboard.press('Enter');
  await expect(page.locator('.lo-head h2')).toHaveText('Night shift');
  const saved = await page.evaluate(() => localStorage.getItem('shortbarrel.loadouts.v1') ?? '');
  expect(saved).toContain('Night shift');

  expect(errors).toEqual([]);
});

test('equip a non-default build and spawn with it (try in range)', async ({ page }) => {
  const errors = await boot(page);
  await openLoadout(page);
  await selectLoadout(page, 'krink');
  await page.locator('[data-key="equip"]').click();
  await expect(page.locator('.lo-badge')).toHaveText('Equipped');
  // Play screen shows the active loadout.
  await page.evaluate(() => {
    const m = (window as any).__sb.menu;
    m.loadout.back();
    m.push(m.play);
  });
  await expect(page.locator('.drill-detail .lo-pick')).toContainText('Krink');
  await page.locator('.drill-detail .lo-pick').focus();
  await page.screenshot({ path: `${dir}/loadout-play.png` });
  await page.evaluate(() => (window as any).__sb.menu.pop());
  await page.evaluate(() => (window as any).__sb.menu.push((window as any).__sb.menu.loadout));

  // Try in range: equips, enters free practice with the build in hand.
  await page.evaluate(() => {
    (window as any).__sb.allowUnlocked = true;
  });
  await page.locator('[data-key="try"]').click();
  await page.waitForFunction(() => !(window as any).__sb.paused);
  const w = await page.evaluate(() => {
    const c = (window as any).__sb.weapons;
    return {
      id: c.equipped.def.id,
      spares: c.equipped.mags.pouches.length,
      count: c.loadout.length,
      model: c.equipped.def.model as string,
    };
  });
  expect(w.id).toBe('k47s');
  expect(w.spares).toBe(5);
  expect(w.count).toBe(2);
  expect(w.model).toContain('ak_stock_triangle');
  await steps(page, 150);
  await page.screenshot({ path: `${dir}/loadout-ingame.png` });
  await steps(page, 40, { down: ['aim'] });
  await page.screenshot({ path: `${dir}/loadout-ingame-ads.png` });
  expect(errors).toEqual([]);
});

test('controller: RB tab, A opens a slot, B closes, Y randomizes', async ({ page }) => {
  await page.addInitScript(() => {
    const pad = { buttons: new Array(17).fill(false), axes: [0, 0, 0, 0] };
    (window as any).__pad = pad;
    navigator.getGamepads = () =>
      [
        {
          index: 0,
          id: 'Xbox Wireless Controller (STANDARD GAMEPAD)',
          connected: true,
          mapping: 'standard',
          axes: pad.axes,
          buttons: pad.buttons.map((p: boolean) => ({ pressed: p, value: p ? 1 : 0, touched: p })),
        },
      ] as any;
  });
  const frames = () =>
    page.evaluate(
      () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null)))),
    );
  const tap = async (i: number) => {
    await page.evaluate((i) => ((window as any).__pad.buttons[i] = true), i);
    await frames();
    await page.evaluate((i) => ((window as any).__pad.buttons[i] = false), i);
    await frames();
  };
  const errors = await boot(page);
  await openLoadout(page);
  await frames();
  await tap(5); // RB → sidearm
  await expect(page.locator('.lo-tabs .tab.on')).toContainText('Sidearm');
  await tap(13); // D-pad down → preset row
  await tap(0); // A → open presets
  await expect(page.locator('.lo-crumb')).toContainText('Preset');
  await tap(1); // B → back to the slot list (not out of the screen)
  await expect(page.locator('.lo-row[data-key="row:preset"]')).toBeFocused();
  const sidearm = () =>
    page.evaluate(() => JSON.stringify((window as any).__sb.menu.loadout.loadout.sidearm));
  const before = await sidearm();
  await tap(3); // Y → random build
  expect(await sidearm()).not.toBe(before);
  await tap(1); // B → main menu
  await expect(page.locator('.screen.main')).toBeVisible();
  expect(errors).toEqual([]);
});
