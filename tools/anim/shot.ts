/**
 * Dev helper: screenshot anim.html contact sheets against a running dev server.
 *   bunx vite --port 4461 &
 *   bun tools/anim/shot.ts <out.png> '<query string>' [width height]
 */
import { chromium } from '@playwright/test';

const [out, query, w = '1280', h = '720'] = process.argv.slice(2);
const base = process.env.ANIM_URL ?? 'http://localhost:4461/anim.html';
const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: Number(w), height: Number(h) } });
page.on('pageerror', (e) => console.error('pageerror', e));
page.on('console', (m) => (m.type() === 'error' || m.type() === 'log') && console.log('console', m.text()));
await page.goto(`${base}?${query}`);
await page.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 120_000 });
await page.waitForTimeout(200);
await page.screenshot({ path: out });
await browser.close();
