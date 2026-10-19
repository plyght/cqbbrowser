/**
 * Dev helper: time game steps and grab a chest-cam frame from a running dev server.
 *   bun tools/game-shot.ts <out.png> [steps] [weaponIndex]
 */
import { chromium } from '@playwright/test';

const [out, n = '60', idx = '0', pitch = '0'] = process.argv.slice(2);
const base = process.env.GAME_URL ?? 'http://localhost:5179/';
const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.error('pageerror', e));
await page.goto(base);
await page.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 90_000 });
const ms = await page.evaluate(
  ([n, idx, pitch]) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const g = (window as any).__sb;
    g.allowUnlocked = true;
    g.manual = true;
    g.enter();
    g.weapons.equip(Number(idx));
    const t0 = performance.now();
    for (let i = 0; i < Number(n); i++) {
      if (i === 0) g.test.next = { look: { yaw: 0, pitch: Number(pitch) } };
      g.step(1 / 60);
    }
    return (performance.now() - t0) / Number(n);
  },
  [n, idx, pitch] as const,
);
console.log('ms/step', ms.toFixed(1));
await page.screenshot({ path: out, timeout: 180_000 });
await browser.close();
