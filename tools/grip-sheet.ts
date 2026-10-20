/**
 * Per-weapon grip evidence sheet (raw clip vs the contact layer), headless Chromium against a dev server:
 * first person in game (hip + ADS, exposure settled, 60 rendered frames before each still), then close-ups of the
 * canonical rig on the kit weapon (right, left, below, support hand, a cut across the grip, a cut across the
 * handguard at the support hand). Writes <outDir>/grip-<weapon>-<tag>.png.
 *
 *   bunx vite --port 5191 &
 *   bun tools/grip-sheet.ts <outDir> <tag> sb16,kp9
 */
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { chromium } from '@playwright/test';

const [dir, tag = 'v1', list = 'sb16,hb300,k47s,kp9,p17,p92'] = process.argv.slice(2);
const base = process.env.GRIP_URL ?? 'http://localhost:5191';
const weapons = list.split(',');
const tmp = `${dir}/.tiles`;
spawnSync('mkdir', ['-p', tmp]);

const fp = spawnSync('bun', ['tools/grip-fp.ts', tmp, list, 'raw,contact'], { stdio: 'inherit' });
if (fp.status) throw new Error('fp failed');
const VIEWS = 'right,left,leftfront,below,support,gsec:25,bsec:70';
for (const w of weapons) {
  const r = spawnSync(
    'bun',
    [
      'tools/grip-shot.ts',
      `${tmp}/rig-${w}.png`,
      `weapons=${w}&views=${VIEWS}&modes=raw,contact&tw=274&th=280`,
    ],
    { stdio: 'inherit' },
  );
  if (r.status) throw new Error('rig tiles failed');
}
const b64 = (f: string) => `data:image/png;base64,${readFileSync(f).toString('base64')}`;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1200 } });
for (const w of weapons) {
  const fpImg = (aim: string, mode: string) =>
    `<img src="${b64(`${tmp}/fp-${w}-${aim}-${mode}.png`)}" width="480">`;
  await page.setContent(
    `<body style="margin:0;background:#111;color:#ddd;font:15px monospace">
      <div style="padding:6px">${w} grip ${tag} — row 1: first person hip raw | hip contact | ADS raw | ADS contact.
      Rows 2–3: rig close-ups raw (top) / contact (bottom): right, left (support arm cut away), front-left, below, support hand, cut across the grip
      (25 mm up), cut across the handguard (70 mm ahead of the support wrist; red = weapon, yellow = glove)</div>
      <div>${fpImg('hip', 'raw')}${fpImg('hip', 'contact')}${fpImg('ads', 'raw')}${fpImg('ads', 'contact')}</div>
      <img src="${b64(`${tmp}/rig-${w}.png`)}" width="1920">
    </body>`,
  );
  await page.screenshot({ path: `${dir}/grip-${w}-${tag}.png`, fullPage: true });
  console.log(`${dir}/grip-${w}-${tag}.png`);
}
await browser.close();
void base;
