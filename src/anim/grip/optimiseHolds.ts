/**
 * Anatomical hold optimiser: `bun src/anim/grip/optimiseHolds.ts`
 *
 * Jointly adjusts the validated hold poses (high / ADS / low / compressed) of each weapon class so that, for the
 * solved grips of every preset build, both arms reach their hands with the wrist and elbow inside anatomical
 * ranges (3° margin). The support-hand wrap is a free variable per build (best of its candidate family); the
 * hold stays close to the authored look (quadratic regulariser; low ready keeps its muzzle-down pitch).
 * Prints the suggested holds for `src/anim/holds.ts`; the grip tests then confirm them.
 */
import { Matrix4, Vector3 } from 'three';
import { CFG, holdShiftZ, type HoldName } from '../holds';
import { armContexts, armMetrics, armViolation, VALIDATED_HOLDS } from './arm';
import { installHeadlessCanvas } from './headlessDom';
import { gripShapes } from './shapes';
import { solveFiring, supportCandidates, supportScore } from './solve';

/** Hold rotation axes ([pitch, yaw, roll] indices) that must stay zero: they define where the gun aims. */
const AIM_PINNED: [HoldName, number[]][] = [
  ['ads', [0, 1, 2]],
  ['high', [0, 1]],
];

export async function optimiseHolds(log = console.log) {
  installHeadlessCanvas();
  const { buildModel } = await import('../../weapons/models');
  const { PRESETS, layoutBuild, resolveBuild } = await import('../../weapons/attachments');
  const ONE = new Vector3(1, 1, 1);
  for (const cls of ['rifle', 'pistol'] as const) {
    const cfg = CFG[cls];
    const data = Object.entries(PRESETS)
      .filter(([, b]) => (b.weapon === 'p17') === (cls === 'pistol'))
      .map(([id, b]) => {
        const g = gripShapes(buildModel(id));
        const dz = holdShiftZ(cfg, layoutBuild(resolveBuild(b)).buttZ);
        const fire = solveFiring(g, false);
        return {
          R: new Matrix4().compose(fire.pos, fire.quat, ONE),
          cands: supportCandidates(g, fire),
          pistol: g.pistol,
          dz,
        };
      });
    const x0 = VALIDATED_HOLDS.flatMap((p) => [...cfg.holds[p].p, ...cfg.holds[p].r]);
    const set = (v: number[]) =>
      VALIDATED_HOLDS.forEach((p, k) => {
        cfg.holds[p].p = [v[k * 6], v[k * 6 + 1], v[k * 6 + 2]];
        cfg.holds[p].r = [v[k * 6 + 3], v[k * 6 + 4], v[k * 6 + 5]];
      });
    let viol = 0;
    const cost = (v: number[]) => {
      set(v);
      let c = 0;
      for (const d of data) {
        const R = armContexts(cfg, 1, d.dz),
          L = armContexts(cfg, -1, d.dz);
        for (const ctx of R) c += armViolation(armMetrics(ctx.shoulder, ctx.natural, d.R, 1, ctx.up), 3);
        let best = Infinity;
        for (const s of d.cands) best = Math.min(best, supportScore(s, L, d.pistol));
        c += best;
      }
      viol = c;
      for (let i = 0; i < v.length; i++) c += (i % 6 < 3 ? 300 : 3) * (v[i] - x0[i]) ** 2;
      // The aim-defining rotations stay pinned: at ADS the camera rides the sight, so any ADS pitch/yaw/roll
      // tilts the whole view off the point of aim; at high ready pitch/yaw would throw hip shots off it.
      for (const [pose, axes] of AIM_PINNED) {
        const k = VALIDATED_HOLDS.indexOf(pose) * 6 + 3;
        for (const a of axes) c += 1e5 * v[k + a] ** 2;
      }
      const low = VALIDATED_HOLDS.indexOf('low') * 6 + 3;
      if (cls === 'rifle') c += 400 * Math.max(0, v[low] + 0.38) ** 2;
      return c;
    };
    const x = [...x0];
    let best = cost(x);
    log(cls, 'score before', viol.toFixed(2));
    let step = 0.02;
    for (let it = 0; it < 200 && step > 0.001; it++) {
      let moved = false;
      for (let i = 0; i < x.length; i++)
        for (const sgn of [1, -1]) {
          const y = [...x];
          y[i] += sgn * step * (i % 6 >= 3 ? 3 : 1);
          const c = cost(y);
          if (c < best - 1e-9) {
            best = c;
            x.splice(0, x.length, ...y);
            moved = true;
          }
        }
      if (!moved) step *= 0.5;
    }
    cost(x);
    log(cls, 'score after', viol.toFixed(2));
    VALIDATED_HOLDS.forEach((p, k) =>
      log(
        `  ${cls}.${p}: { p: [${x.slice(k * 6, k * 6 + 3).map((v) => +v.toFixed(3))}], r: [${x
          .slice(k * 6 + 3, k * 6 + 6)
          .map((v) => +v.toFixed(3))}] }`,
      ),
    );
  }
}

if (import.meta.main) await optimiseHolds();
