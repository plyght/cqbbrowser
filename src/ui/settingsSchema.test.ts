import { describe, expect, test } from 'bun:test';
import {
  groupDefs,
  readSetting,
  registerSettings,
  settingsFor,
  TABS,
  writeSetting,
  type SliderDef,
} from './settingsSchema';

describe('settings schema', () => {
  test('every tab has built-in entries', () => {
    for (const t of TABS) expect(settingsFor(t.id).length).toBeGreaterThan(0);
  });

  test('append, replace, read/write through Settings namespaces', () => {
    const def: SliderDef = {
      tab: 'audio',
      group: 'Test',
      ns: 'test.ui',
      key: 'level',
      label: 'Level',
      kind: 'slider',
      min: 0,
      max: 1,
      step: 0.1,
      default: 0.4,
    };
    registerSettings([def]);
    expect(readSetting(def)).toBe(0.4);
    writeSetting(def, 0.7);
    expect(readSetting(def)).toBe(0.7);
    registerSettings([{ ...def, label: 'Level (renamed)' }]);
    const mine = settingsFor('audio').filter((d) => d.ns === 'test.ui');
    expect(mine.map((d) => d.label)).toEqual(['Level (renamed)']);
    expect(groupDefs(settingsFor('audio')).map((g) => g.group)).toContain('Test');
  });
});
