import { expect, test } from 'bun:test';
import { cameraSettings } from '../player/Player';
import { settingsFor, TABS } from './settingsSchema';

/**
 * Regression: the Camera mount / Camera shake / Stable horizon / Auto-fix camera rows wrote to namespaces nobody
 * read (gameplay / video / a11y), so the helmet cam, the shake slider and stable horizon did nothing. They must
 * write the namespace the player reads, with matching defaults.
 */
test('camera settings rows drive the player camera settings', () => {
  const all = TABS.flatMap((t) => settingsFor(t.id));
  for (const label of [
    'Camera mount',
    'Camera shake',
    'Stable horizon',
    'Auto-fix camera',
    'Helmet cam aim dot',
  ]) {
    const def = all.find((d) => d.label === label);
    expect(def?.ns).toBe('camera');
    const defaults = cameraSettings.defaults as Record<string, unknown>;
    expect(def && def.key in defaults).toBe(true);
    expect(def && (def as { default: unknown }).default).toBe(def && defaults[def.key]);
  }
});
