/**
 * Asset license check (PRD §10.3). Run: `bun run check:assets`.
 *
 * Every file under `public/assets/**`, `public/brand/**` (and the private-only `assets/audio/pro/**`) must be covered by a row of the
 * table in `assets/ATTRIBUTION.md`:
 *
 *   | Path (file or glob) | Source | License | Set |
 *   | `public/assets/fonts/oswald-*` | https://… | OFL-1.1 | open |
 *
 * The check fails when
 *   1. a file is not covered by any row,
 *   2. a row's license is not one we accept: CC0, CC-BY (any version), OFL, MIT, or `generated` (made by our own
 *      code/tools in this repo),
 *   3. a row's set is not `open` or `pro`,
 *   4. the repo is public (`SHORTBARREL_PUBLIC=1`, the default and what CI sets) and any `pro` file exists.
 *
 * Why 4: the Sonniss GDC bundles (our "pro" sound set) may be embedded in a game but must not be redistributed as
 * standalone files. A public repo holding raw Sonniss audio reads as redistribution, so pro files may only be
 * committed once the repo is private (then CI runs with SHORTBARREL_PUBLIC=0). Paths under `audio/pro/` count as pro
 * even if a row claims otherwise.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

export interface Row {
  pattern: string;
  source: string;
  license: string;
  set: string;
  line: number;
}

const LICENSES = /^(CC0(-1\.0)?|CC-BY(-\d\.\d)?|OFL(-1\.1)?|MIT|generated)$/i;

/** Parse the attribution table(s): any markdown table whose first header cell is "Path". */
export function parseAttribution(md: string): Row[] {
  const rows: Row[] = [];
  let inTable = false;
  md.split('\n').forEach((raw, i) => {
    const line = raw.trim();
    if (!line.startsWith('|')) {
      inTable = false;
      return;
    }
    const cells = line
      .replace(/^\||\|$/g, '')
      .split('|')
      .map((c) => c.trim().replace(/^`|`$/g, ''));
    if (/^path\b/i.test(cells[0])) {
      inTable = true;
      return;
    }
    if (!inTable || /^:?-+:?$/.test(cells[0])) return;
    const [pattern, source = '', license = '', set = ''] = cells;
    if (pattern) rows.push({ pattern, source, license, set: set.toLowerCase(), line: i + 1 });
  });
  return rows;
}

/** Minimal glob → RegExp: `**`, `*`, `?`, `{a,b}`. A pattern ending in `/` matches everything below it. */
export function globToRegExp(glob: string): RegExp {
  let g = glob.endsWith('/') ? glob + '**' : glob;
  g = g.replace(/^\.\//, '');
  let re = '';
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === '*' && g[i + 1] === '*') {
      if (g[i + 2] === '/') {
        re += '(?:.*/)?';
        i += 2;
      } else {
        re += '.*';
        i += 1;
      }
    } else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else if (c === '{') re += '(?:';
    else if (c === '}') re += ')';
    else if (c === ',') re += '|';
    else re += c.replace(/[.+^$()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

export const isPro = (path: string, row?: Row) => row?.set === 'pro' || /(^|\/)audio\/pro\//.test(path);

export interface Report {
  errors: string[];
  warnings: string[];
  covered: number;
}

export function check(files: string[], rows: Row[], isPublic: boolean): Report {
  const errors: string[] = [];
  const warnings: string[] = [];
  const compiled = rows.map((r) => ({ r, re: globToRegExp(r.pattern) }));
  for (const { r } of compiled) {
    if (!LICENSES.test(r.license))
      errors.push(
        `ATTRIBUTION.md:${r.line} \`${r.pattern}\`: license "${r.license}" is not CC0/CC-BY/OFL/MIT/generated`,
      );
    if (r.set !== 'open' && r.set !== 'pro')
      errors.push(`ATTRIBUTION.md:${r.line} \`${r.pattern}\`: set must be "open" or "pro" (got "${r.set}")`);
    if (!r.source) errors.push(`ATTRIBUTION.md:${r.line} \`${r.pattern}\`: missing source`);
  }
  let covered = 0;
  const used = new Set<Row>();
  for (const f of files) {
    const hit = compiled.find(({ re }) => re.test(f));
    if (!hit) {
      errors.push(`${f}: not listed in assets/ATTRIBUTION.md`);
      if (isPublic && isPro(f)) errors.push(`${f}: "pro" (Sonniss) file present while the repo is public`);
      continue;
    }
    covered++;
    used.add(hit.r);
    if (isPublic && isPro(f, hit.r))
      errors.push(`${f}: "pro" (Sonniss) file present while the repo is public`);
  }
  for (const { r } of compiled)
    if (!used.has(r)) warnings.push(`ATTRIBUTION.md:${r.line} \`${r.pattern}\` matches no file`);
  return { errors, warnings, covered };
}

function walk(dir: string, root: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name === '.DS_Store' || name === '.gitkeep') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, root, out);
    else out.push(relative(root, p).split('\\').join('/'));
  }
  return out;
}

if (import.meta.main) {
  const root = process.cwd();
  const isPublic = (process.env.SHORTBARREL_PUBLIC ?? '1') !== '0';
  const md = existsSync('assets/ATTRIBUTION.md') ? readFileSync('assets/ATTRIBUTION.md', 'utf8') : '';
  const files = ['public/assets', 'public/brand', 'assets/audio/pro'].flatMap((d) =>
    walk(join(root, d), root),
  );
  const rep = check(files, parseAttribution(md), isPublic);
  for (const w of rep.warnings) console.warn(`warn  ${w}`);
  for (const e of rep.errors) console.error(`error ${e}`);
  console.log(
    `check:assets: ${files.length} files, ${rep.covered} covered, ${rep.errors.length} errors ` +
      `(repo ${isPublic ? 'public: pro set forbidden' : 'private: pro set allowed'})`,
  );
  process.exit(rep.errors.length ? 1 : 0);
}
