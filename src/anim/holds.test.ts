import { expect, test } from 'bun:test';
import { CFG } from './holds';

/**
 * At ADS the camera rides the sight, so an ADS hold rotation tilts the whole view off the point of aim (the
 * rifle's old 0.084 rad pitch jumped the view ~5° up on every ADS and shots went over the target). At high
 * ready a pitch/yaw offset throws hip shots off the converged aim point.
 */
test('aim-defining hold rotations are zero', () => {
  for (const [cls, cfg] of Object.entries(CFG)) {
    expect({ cls, r: cfg.holds.ads.r }).toEqual({ cls, r: [0, 0, 0] });
    expect({ cls, r: cfg.holds.high.r.slice(0, 2) }).toEqual({ cls, r: [0, 0] });
  }
});
