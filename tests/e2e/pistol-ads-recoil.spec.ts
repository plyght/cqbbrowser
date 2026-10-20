import { expect, test } from '@playwright/test';
import { bootPistol, record, type Frame } from './pistolAds';

/**
 * Pistol ADS recoil cycle (owner report: "huge jolt, separate from the recoil"). P-17 and P-92 held at ADS, a single
 * shot and a 5-shot string at 6 rounds/s. Pass criteria, per shot:
 *  - one crisp flip of at most 8 deg that rises in the first frames (no second rise after the peak: the additive
 *    shot clip used to lift the gun another ~8 deg and roll it ~3 deg ~100 ms after the shot);
 *  - single shot: the sight is back within 2 deg of the point of aim 250 ms after the shot and within 1 deg after 450 ms;
 *  - no view roll, the gun never cants against the handling pose, ADS never drops;
 *  - the support wrist stays within 2.5 mm of its place relative to the firing wrist through the string;
 *  - the bore lands within 2 cm of the camera's centre ray at 7 m and 15 m.
 */
const FRAME_MS = 1000 / 60;

function shotsOf(fr: Frame[]) {
  const s: number[] = [];
  for (let i = 1; i < fr.length; i++) if (fr[i].fire && !fr[i - 1].fire) s.push(i);
  return s;
}

const CASES: [string, string, number, number][] = [
  ['p17', 'single', 1, 12],
  ['p17', 'string at 6/s', 5, 10],
  ['p92', 'single', 1, 12],
  ['p92', 'string at 6/s', 5, 10],
];

for (const [weapon, name, count, every] of CASES) {
  test(`pistol ADS recoil cycle: ${weapon} ${name}`, async ({ page }) => {
    test.setTimeout(240_000);
    const errors = await bootPistol(page, weapon);
    const fr = await record(page, count, every);
    const shots = shotsOf(fr);
    expect(shots.length).toBe(count);
    const first = shots[0];
    const lastShot = shots[shots.length - 1];

    // Per-shot flip and no second rise.
    shots.forEach((s, k) => {
      const next = k + 1 < shots.length ? shots[k + 1] : Math.min(fr.length, s + 40);
      const pre = fr[s - 1].cpitch;
      let peak = -99;
      let peakAt = s;
      for (let i = s; i < Math.min(next, s + 8); i++)
        if (fr[i].cpitch > peak) {
          peak = fr[i].cpitch;
          peakAt = i;
        }
      expect(peak - pre).toBeGreaterThan(3);
      expect(peak - pre).toBeLessThan(8);
      expect(peakAt - s).toBeLessThanOrEqual(3);
      let low = peak;
      for (let i = peakAt; i < next; i++) {
        low = Math.min(low, fr[i].cpitch);
        expect(fr[i].cpitch - low).toBeLessThan(0.5);
      }
    });

    // Single shot returns to the point of aim.
    if (count === 1) {
      const pre = fr[first - 1].cpitch;
      expect(Math.abs(fr[first + Math.round(250 / FRAME_MS)].cpitch - pre)).toBeLessThan(2);
      expect(Math.abs(fr[first + Math.round(450 / FRAME_MS)].cpitch - pre)).toBeLessThan(1);
    }

    // Roll, gun cant, ADS, FOV, camera jump.
    let maxRoll = 0;
    let maxCant = 0;
    let adsMin = 1;
    let maxFov = 0;
    let maxSep = 0;
    const sep0 = fr[first - 1].wSep * 1000;
    for (let i = first; i < fr.length; i++) {
      maxRoll = Math.max(maxRoll, Math.abs(fr[i].croll));
      maxCant = Math.max(maxCant, Math.abs(fr[i].clipEul[2]), Math.abs(fr[i].clipEul[0]));
      adsMin = Math.min(adsMin, fr[i].ads);
      maxFov = Math.max(maxFov, Math.abs(fr[i].fov - fr[first - 1].fov));
      if (i <= lastShot + 8) maxSep = Math.max(maxSep, Math.abs(fr[i].wSep * 1000 - sep0));
    }
    console.log(
      `${weapon} ${name}: roll ${maxRoll.toFixed(2)} deg, gun-vs-pose ${maxCant.toFixed(2)} deg, wrist sep drift ${maxSep.toFixed(2)} mm`,
    );
    expect(maxRoll).toBeLessThan(1);
    expect(maxCant).toBeLessThan(0.5);
    expect(adsMin).toBe(1);
    expect(maxFov).toBeLessThan(1);
    expect(maxSep).toBeLessThan(2.5);

    // The shot lands where the dot is.
    const pre = fr[first - 1];
    expect(Math.hypot(pre.land7[0], pre.land7[1])).toBeLessThan(2);
    expect(Math.hypot(pre.land15[0], pre.land15[1])).toBeLessThan(2);
    expect(errors).toEqual([]);
  });
}
