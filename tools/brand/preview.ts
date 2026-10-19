import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
const root = process.argv[2];
const out = process.argv[3];
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1100, height: 560 }, deviceScaleFactor: 2 });
const svg = (n: string) =>
  'data:image/svg+xml;base64,' + Buffer.from(readFileSync(`${root}/public/brand/${n}`)).toString('base64');
await p.setContent(`<body style="margin:0;background:#2d2e2a;display:flex;gap:24px;align-items:center;padding:20px;font-family:sans-serif">
<img src="${svg('umbra-patch.svg')}" style="width:400px">
<div style="display:flex;flex-direction:column;gap:20px;align-items:center">
<img src="${svg('umbra-mark.svg')}" style="width:140px;opacity:.8">
<div style="display:flex;gap:10px;align-items:end"><img src="${svg('favicon.svg')}" style="width:64px"><img src="${svg('favicon.svg')}" style="width:32px"><img src="${svg('favicon.svg')}" style="width:16px"></div>
</div>
<div style="display:flex;flex-direction:column;gap:20px;background:#111;padding:20px">
<img src="${svg('shortbarrel-wordmark.svg')}" style="width:380px">
<img src="${svg('shortbarrel-wordmark-mono.svg')}" style="width:240px">
</div></body>`);
await p.waitForTimeout(500);
await p.screenshot({ path: `${out}/brand-sheet.png` });
await p.setViewportSize({ width: 340, height: 420 });
await p.setContent(
  `<body style="margin:0;background:#2d2e2a"><img src="${svg('umbra-patch.svg')}" style="width:320px;margin:10px"></body>`,
);
await p.waitForTimeout(300);
await p.screenshot({ path: `${out}/patch-zoom.png`, clip: { x: 90, y: 110, width: 160, height: 200 } });
await b.close();
