import { expect, test } from 'bun:test';
import { buildSheet, groupOf } from './contact-sheet';

test('groups by prefix, skipping numeric ordinals', () => {
  expect(groupOf('ui-main-menu.png')).toBe('ui');
  expect(groupOf('01-range-idle.png')).toBe('range');
  expect(groupOf('00-menu.png')).toBe('menu');
});

test('sheet embeds every shot and escapes names', () => {
  const html = buildSheet(
    [
      { name: 'ui-a.png', dataUri: 'data:image/png;base64,AA', bytes: 2048 },
      { name: 'x-<b>.png', dataUri: 'data:image/png;base64,BB', bytes: 10 },
    ],
    'meta',
  );
  expect(html).toContain('data:image/png;base64,AA');
  expect(html).toContain('x-&lt;b&gt;.png');
  expect(html.match(/<figure>/g)!.length).toBe(2);
});
