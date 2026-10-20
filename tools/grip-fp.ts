/**
 * First-person grip evidence in game (dev server, headless Chromium): per weapon, hip and ADS, raw clip vs the
 * contact layer, ~3 s of sim with every 15th frame rendered (auto-exposure settles) and the last 60 frames
 * rendered before each still.
 *
 *   bun tools/grip-fp.ts <outDir> sb16,kp9 [raw,contact]
 */
import { chromium } from '@playwright/test';

const [dir, list = 'sb16,hb300,k47s,kp9,p17,p92', modesArg = 'raw,contact'] = process.argv.slice(2);
const base = process.env.GRIP_URL ?? 'http://localhost:5191';
const browser = await chromium.launch({
  args: [
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--autoplay-policy=no-user-gesture-required',
  ],
});
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(`${base}/${process.env.GRIP_QUERY ?? ''}`);
await page.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 300_000 });
await page.evaluate(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const g = (window as any).__sb;
  g.renderer.dynres.enabled = false;
  g.allowUnlocked = true;
  g.manual = true;
  g.enter();
});
await page.waitForFunction(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  () => !!(window as any).__sb.weapons.rig,
  null,
  { timeout: 300_000 },
);
const sim = (n: number, aim: boolean, every = 15) =>
  page.evaluate(
    ([n, aim, every]) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const g = (window as any).__sb;
      for (let i = 0; i < (n as number); i++) {
        g.test.next = aim ? { down: ['aim'] } : {};
        g.step(1 / 60, i >= (n as number) - 60 || i % (every as number) === (every as number) - 1);
      }
      g.test.next = {};
    },
    [n, aim, every] as const,
  );
await sim(180, false);
for (const w of list.split(',')) {
  for (const mode of modesArg.split(',')) {
    await page.evaluate(
      ([w, mode]) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const win = window as any;
        const g = win.__sb;
        const ws = g.weapons;
        ws.contact.autoEnable = () => mode !== 'raw';
        const pistol = /^p\d/.test(w);
        const base = win.__loadoutPresets[0];
        g.applyLoadout(
          {
            ...base,
            primary: { v: 1, weapon: pistol ? 'sb16' : w, parts: {} },
            sidearm: { v: 1, weapon: pistol ? w : 'p17', parts: {} },
          },
          true,
        );
        ws.equipNow(pistol ? 1 : 0);
      },
      [w, mode] as const,
    );
    for (const aim of [false, true]) {
      await sim(150, aim);
      await page.screenshot({ path: `${dir}/fp-${w}-${aim ? 'ads' : 'hip'}-${mode}.png`, timeout: 300_000 });
    }
  }
}
console.log('done', errors.slice(0, 5));
await browser.close();
