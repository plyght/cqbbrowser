/**
 * Dev helper: bench screenshots of default builds (or `weapon:view`) assembled from the kit, plus material info.
 *   bunx vite preview --port 4490 &   (after bun run build)
 *   bun tools/blender/weapons/kit-shot.ts <outDir> sb16:side p17:threeq ...
 */
import { chromium } from '@playwright/test';

const [outDir, ...specs] = process.argv.slice(2);
const base = process.env.BENCH_URL ?? 'http://localhost:4490/bench.html';
const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.error('pageerror', e));
page.on('console', (m) => m.type() !== 'debug' && console.log('console', m.text()));
await page.goto(`${base}?ui=0`);
await page.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 90_000 });
for (const spec of specs) {
  const [w, view = 'side', json] = spec.split(':');
  const info = await page.evaluate(
    ([w, v, json]) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const b = (window as any).__bench;
      const build = json ? JSON.parse(json) : { v: 1, weapon: w, parts: {} };
      const r = b.setBuild(build, v);
      const mats: string[] = [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      b.model.root.traverse((o: any) => {
        if (!o.isMesh) return;
        const m = o.material;
        o.geometry.computeBoundingBox();
        const bb = o.geometry.boundingBox;
        mats.push(
          `${o.parent.name}/${m.name} r=${m.roughness} m=${m.metalness} env=${!!m.envMap} bb=${bb.min.toArray().map((x: number) => x.toFixed(2))}..${bb.max.toArray().map((x: number) => x.toFixed(2))}`,
        );
      });
      return { ...r, kit: !!b.model.root.userData.kit, mats };
    },
    [w, view, json] as const,
  );
  console.log(spec, JSON.stringify(info, null, 1));
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${outDir}/${w}-${view}.png` });
}
await browser.close();
