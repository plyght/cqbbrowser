/**
 * Builds a self-contained HTML contact sheet of every Playwright screenshot (PRD §12.3).
 *
 *   bun tools/contact-sheet.ts [screenshotsDir=screenshots] [out=<dir>/contact-sheet.html]
 *
 * Images are inlined as data URIs so the single file works when downloaded from the CI artifact. Shots are grouped
 * by filename prefix (`ui-*`, `audio-*`, `01-range-*` → "range", …).
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export function groupOf(file: string): string {
  const base = file.replace(/\.(png|jpe?g|webp)$/i, '');
  const parts = base.split('-').filter((p) => !/^\d+$/.test(p));
  return parts[0] ?? base;
}

const esc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export function buildSheet(shots: { name: string; dataUri: string; bytes: number }[], meta: string): string {
  const groups = new Map<string, typeof shots>();
  for (const s of shots) {
    const g = groupOf(s.name);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(s);
  }
  const sections = [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(
      ([g, list]) =>
        `<section><h2>${esc(g)} <small>${list.length}</small></h2><div class="grid">${list
          .map(
            (s) =>
              `<figure><a href="${s.dataUri}" target="_blank"><img loading="lazy" src="${s.dataUri}" alt="${esc(s.name)}"></a>` +
              `<figcaption>${esc(s.name)} <span>${(s.bytes / 1024).toFixed(0)} KB</span></figcaption></figure>`,
          )
          .join('')}</div></section>`,
    )
    .join('\n');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>SHORTBARREL screenshots</title><style>
:root{--bg:#111210;--fg:#e8e4da;--dim:#8f8a7e;--ac:#c1aa7c}
@media (prefers-color-scheme: light){:root{--bg:#f3f1ea;--fg:#1b1c17;--dim:#6b675d;--ac:#7a6438}}
body{margin:0;padding:24px 16px;background:var(--bg);color:var(--fg);font:14px/1.4 ui-monospace,Menlo,Consolas,monospace}
h1{font:700 22px/1.2 system-ui,sans-serif;letter-spacing:.08em;margin:0 0 4px}
.meta{color:var(--dim);margin-bottom:24px}
h2{font-size:13px;letter-spacing:.2em;text-transform:uppercase;color:var(--ac);border-bottom:1px solid #8884;padding-bottom:6px}
h2 small{color:var(--dim)}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,360px),1fr));gap:14px}
figure{margin:0}img{width:100%;display:block;border:1px solid #8884;background:#000}
figcaption{display:flex;justify-content:space-between;gap:8px;padding:4px 2px;color:var(--fg);word-break:break-all}
figcaption span{color:var(--dim);white-space:nowrap}
</style></head><body><h1>SHORTBARREL · screenshots</h1><div class="meta">${esc(meta)}</div>
${sections || '<p>No screenshots found.</p>'}</body></html>`;
}

if (import.meta.main) {
  const dir = process.argv[2] ?? 'screenshots';
  const out = process.argv[3] ?? join(dir, 'contact-sheet.html');
  const names = existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => /\.(png|jpe?g|webp)$/i.test(f))
        .sort()
    : [];
  const shots = names.map((name) => {
    const p = join(dir, name);
    const buf = readFileSync(p);
    const type = name.endsWith('.png') ? 'png' : name.endsWith('.webp') ? 'webp' : 'jpeg';
    return { name, bytes: statSync(p).size, dataUri: `data:image/${type};base64,${buf.toString('base64')}` };
  });
  const sha = process.env.GITHUB_SHA?.slice(0, 7);
  const meta = `${shots.length} shots · ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC${sha ? ` · ${sha}` : ''}${process.env.GITHUB_REF_NAME ? ` · ${process.env.GITHUB_REF_NAME}` : ''}`;
  writeFileSync(out, buildSheet(shots, meta));
  console.log(`contact sheet: ${shots.length} screenshots → ${out}`);
}
