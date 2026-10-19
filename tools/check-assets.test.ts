import { describe, expect, test } from 'bun:test';
import { check, globToRegExp, parseAttribution } from './check-assets';

const MD = `# Attribution

| Path | Source | License | Set |
| --- | --- | --- | --- |
| \`public/assets/fonts/oswald-*\` | https://example.org/oswald | OFL-1.1 | open |
| \`public/assets/audio/open/**/*.ogg\` | https://freesound.org/x | CC0-1.0 | open |
| \`public/assets/audio/pro/\` | Sonniss GDC 2026 | Sonniss | pro |

Some text.

| Not a path table | x |
| --- | --- |
| foo | bar |
`;

describe('check-assets', () => {
  test('parses only Path tables', () => {
    const rows = parseAttribution(MD);
    expect(rows.map((r) => r.pattern)).toEqual([
      'public/assets/fonts/oswald-*',
      'public/assets/audio/open/**/*.ogg',
      'public/assets/audio/pro/',
    ]);
    expect(rows[0].license).toBe('OFL-1.1');
    expect(rows[2].set).toBe('pro');
  });

  test('globs', () => {
    expect(globToRegExp('a/*.png').test('a/b.png')).toBe(true);
    expect(globToRegExp('a/*.png').test('a/x/b.png')).toBe(false);
    expect(globToRegExp('a/**/*.ogg').test('a/b.ogg')).toBe(true);
    expect(globToRegExp('a/**/*.ogg').test('a/x/y/b.ogg')).toBe(true);
    expect(globToRegExp('a/').test('a/x/y')).toBe(true);
    expect(globToRegExp('f.{woff,woff2}').test('f.woff2')).toBe(true);
    expect(globToRegExp('f.woff').test('fXwoff')).toBe(false);
  });

  test('flags unlisted files and bad licenses', () => {
    const rows = parseAttribution(MD).slice(0, 2);
    const rep = check(['public/assets/fonts/oswald-700.woff2', 'public/assets/tex/brick.ktx2'], rows, true);
    expect(rep.errors).toEqual(['public/assets/tex/brick.ktx2: not listed in assets/ATTRIBUTION.md']);
    const bad = check([], parseAttribution(MD), false);
    expect(bad.errors.some((e) => e.includes('license "Sonniss"'))).toBe(true);
  });

  test('pro files fail only while public', () => {
    const rows = parseAttribution(MD.replace('| Sonniss | pro |', '| CC0 | pro |'));
    const f = ['public/assets/audio/pro/shot.opus'];
    expect(check(f, rows, true).errors).toEqual([
      'public/assets/audio/pro/shot.opus: "pro" (Sonniss) file present while the repo is public',
    ]);
    expect(check(f, rows, false).errors).toEqual([]);
  });

  test('audio/pro paths count as pro even if mislabelled', () => {
    const rows = parseAttribution(
      '| Path | S | L | Set |\n|-|-|-|-|\n| `assets/audio/pro/**` | x | CC0 | open |',
    );
    expect(check(['assets/audio/pro/a.wav'], rows, true).errors.length).toBe(1);
  });
});
