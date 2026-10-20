/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { boot, play } from './helpers';

/**
 * ADS hands per weapon (src/anim/contact): one evidence sheet each — first-person ADS in game (exposure settled
 * over 3 s of sim), external left and below/front cameras of the canonical rig, raw clip vs contact layer.
 * In the rig, ADS moves only the rig root (handling layer), so the hands-on-gun pose is the idle hold.
 */
const dir = 'screenshots';
const WEAPONS = ['sb16', 'k47s', 'hb300', 'kp9', 'p17'];

async function sim(page: Page, n: number, input?: Record<string, unknown>, every = 15) {
  await page.evaluate(
    ([n, input, every]) => {
      const g = (window as any).__sb;
      for (let i = 0; i < (n as number); i++) {
        if (input) g.test.next = structuredClone(input);
        const e = every as number;
        g.step(1 / 60, e > 0 && (i === (n as number) - 1 || i % e === e - 1));
      }
      g.test.next = {};
    },
    [n, input ?? null, every] as const,
  );
}

async function rigTile(page: Page, w: string, view: string, file: string) {
  await page.setViewportSize({ width: 800, height: 340 });
  await page.goto(
    `/anim.html?mode=rig&weapons=${w}&actions=idle@0&contact=both&cols=2&tw=400&th=340&${view}`,
  );
  await page.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 240_000 });
  await page.screenshot({ path: file });
}

const b64 = (f: string) => `data:image/png;base64,${readFileSync(f).toString('base64')}`;

test('ADS evidence sheets: first person + left + below/front, raw vs contact', async ({ page }) => {
  test.setTimeout(1_200_000);
  const errors = await boot(page);
  await page.evaluate(() => ((window as any).__sb.renderer.dynres.enabled = false));
  await play(page);
  await page.waitForFunction(() => !!(window as any).__sb.weapons.rig, null, { timeout: 90_000 });
  await sim(page, 180); // auto-exposure settles
  for (const w of WEAPONS) {
    await page.evaluate((p) => {
      const ws = (window as any).__sb.weapons;
      const slot = p === 'p17' ? 1 : 0;
      ws.setPreset(slot, p);
      if (ws.loadout[slot] !== ws.equipped) ws.equipNow(slot);
    }, w);
    for (const on of [false, true]) {
      await page.evaluate((v) => ((window as any).__sb.weapons.contact.enabled = v), on);
      await sim(page, 180, { down: ['aim'] });
      await page.screenshot({ path: `${dir}/contact-ads-${w}-fp-${on ? 'contact' : 'raw'}.png` });
    }
  }
  expect(errors).toEqual([]);
  const ctx = page.context();
  const p2 = await ctx.newPage();
  for (const w of WEAPONS) {
    await rigTile(p2, w, 'at=grip&az=90&el=5&dist=0.45', `${dir}/contact-ads-${w}-left.png`);
    await rigTile(p2, w, 'at=grip&az=-30&el=-45&dist=0.45', `${dir}/contact-ads-${w}-below.png`);
    await rigTile(p2, w, 'at=support&az=60&el=25&dist=0.45', `${dir}/contact-ads-${w}-support.png`);
    await p2.setViewportSize({ width: 1280, height: 1700 });
    await p2.setContent(
      `<body style="margin:0;background:#111;color:#fff;font:14px monospace">
        <div style="padding:4px">${w} ADS — row 1: first person raw | contact · row 2: left raw | contact · row 3: below/front raw | contact · row 4: support hand raw | contact</div>
        <img src="${b64(`${dir}/contact-ads-${w}-fp-raw.png`)}" width="640"><img src="${b64(`${dir}/contact-ads-${w}-fp-contact.png`)}" width="640">
        <img src="${b64(`${dir}/contact-ads-${w}-left.png`)}" width="1280">
        <img src="${b64(`${dir}/contact-ads-${w}-below.png`)}" width="1280">
        <img src="${b64(`${dir}/contact-ads-${w}-support.png`)}" width="1280">
      </body>`,
    );
    await p2.screenshot({ path: `${dir}/contact-ads-${w}-v3.png`, fullPage: true });
  }
});
