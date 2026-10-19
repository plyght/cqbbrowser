/**
 * Dev helper: screenshot bench presets against a running dev server.
 *   bunx vite --port 5179 &
 *   bun tools/bench-shot.ts <outDir> preset[:view] [preset[:view] ...]
 */
import { chromium } from '@playwright/test';

const [outDir, ...specs] = process.argv.slice(2);
const base = process.env.BENCH_URL ?? 'http://localhost:5179/bench.html';
const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.error('pageerror', e));
page.on('console', (m) => m.type() === 'error' && console.error('console', m.text()));
for (const spec of specs) {
  const [preset, view = 'side'] = spec.split(':');
  await page.goto(`${base}?preset=${preset}&view=${view}&ui=0`);
  await page.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 60_000 });
  await page.waitForTimeout(300);
  const stats = await page.evaluate(
    () => (window as unknown as { __bench: { stats: unknown } }).__bench.stats,
  );
  console.log(spec, JSON.stringify(stats));
  await page.screenshot({ path: `${outDir}/${preset}-${view}.png` });
}
await browser.close();
