/**
 * Grip evidence sheets (grip.html) to PNG, headless Chromium (SwiftShader) against a running dev server:
 *
 *   bunx vite --port 5191 &   # once
 *   bun tools/grip-shot.ts out.png 'weapons=sb16&views=fp,right,left,below,support&modes=raw,contact'
 *
 * GRIP_URL overrides the server (default http://localhost:5191).
 */
import { chromium } from '@playwright/test';

const [out, query = ''] = process.argv.slice(2);
if (!out) throw new Error('usage: bun tools/grip-shot.ts out.png "<query>"');
const base = process.env.GRIP_URL ?? 'http://localhost:5191';
const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 400, height: 300 } });
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text());
});
await page.goto(`${base}/grip.html?${query}`);
await page.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 600_000 });
const size = await page.evaluate(() => {
  const c = document.querySelector('canvas');
  return c ? { width: c.width, height: c.height } : { width: 400, height: 300 };
});
await page.setViewportSize(size);
await page.screenshot({ path: out });
const stats = await page.evaluate(() => (window as unknown as { __grip: { stats?: unknown } }).__grip.stats);
console.log(out, JSON.stringify(stats));
if (errors.length) console.log('page messages:', errors.slice(0, 8).join('\n'));
await browser.close();
