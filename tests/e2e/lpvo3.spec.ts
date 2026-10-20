/* eslint-disable @typescript-eslint/no-explicit-any */
import { expect, test, type Page } from '@playwright/test';
import { boot, play } from './helpers';

/**
 * Compact 1-3x LPVO: hip / ADS 1x / ADS 3x on the SB-16 and HB-300, sight-line alignment at both powers, and a
 * bench side view next to the 1-6x for scale. Screenshots: $SB_SHOTS (default screenshots/) lpvo3-*.png.
 */
const dir = process.env.SB_SHOTS ?? 'screenshots';

/** Step n frames, rendering the last `render` (auto-exposure only adapts on rendered frames). */
async function sim(page: Page, n: number, input?: Record<string, unknown>, render = 0) {
  await page.evaluate(
    ([n, input, render]) => {
      const g = (window as any).__sb;
      for (let i = 0; i < (n as number); i++) {
        if (input) g.test.next = structuredClone(input);
        g.step(1 / 60, i >= (n as number) - (render as number) || i % 15 === 14);
      }
      g.test.next = {};
    },
    [n, input ?? null, render] as const,
  );
}

/**
 * At ADS: angle (deg) between the reticle centre and the sight line's point at D m, seen from the eye, and where
 * the bullet crosses the camera ray at D (m).
 */
function alignment(page: Page) {
  return page.evaluate(() => {
    const g = (window as any).__sb;
    const w = g.weapons;
    const cam = g.ctx.camera;
    const sl = w.sightLine;
    const ret = w.scope.circleDot.visible ? w.scope.circleDot : w.scope.root;
    const rc = cam.position.clone();
    ret.getWorldPosition(rc);
    const toRet = rc.sub(cam.position).normalize();
    const i = Math.min(w.aimIndex, w.equipped.sightLocal.length - 1);
    const sp = w.equipped.sightLocal[i].clone().applyMatrix4(w.gunMatrix);
    const fwd = cam.position.clone().set(0, 0, -1).applyQuaternion(w.gunQuat);
    const camDir = cam.position.clone().set(0, 0, -1).applyQuaternion(cam.quaternion);
    const r = w.shotRay();
    const out: Record<string, number | string | boolean> = {
      mode: sl?.mode.id ?? 'none',
      blend: w.adsBlend,
      mag: w.magnification,
      fov: cam.fov,
      scope: w.scope.root.visible,
      ring: w.scope.ring.scale.x,
      opticHidden: w.equipped.model.parts.optic ? !w.equipped.model.parts.optic.visible : false,
    };
    for (const D of [7, 25]) {
      const P = sp.clone().addScaledVector(fwd, D).sub(cam.position).normalize();
      out['aimErrDeg' + D] = (Math.acos(Math.min(1, P.dot(toRet))) * 180) / Math.PI;
      const C = cam.position.clone().addScaledVector(camDir, D);
      const t = C.clone().sub(r.origin).dot(camDir) / r.dir.dot(camDir);
      out['bullet' + D] = C.distanceTo(r.origin.clone().addScaledVector(r.dir, t));
    }
    return out;
  });
}

const shot = (page: Page, name: string) => page.screenshot({ path: `${dir}/lpvo3-${name}.png` });

test.describe.configure({ timeout: 1_800_000 });

for (const [slot, preset, gun] of [
  [0, 'sb16_lpvo3', 'sb16'],
  [0, 'hb300_lpvo3', 'hb300'],
] as const) {
  test(`compact LPVO on the ${gun}: hip, ADS 1x, ADS 3x, aligned`, async ({ page }) => {
    const errors = await boot(page);
    await page.evaluate(() => ((window as any).__sb.renderer.dynres.enabled = false));
    await play(page);
    await page
      .waitForFunction(() => !!(window as any).__sb.weapons.rig, null, { timeout: 60_000 })
      .catch(() => {});
    await page.evaluate(
      ([slot, preset]) => {
        const w = (window as any).__sb.weapons;
        w.setPreset(slot, preset);
        if (w.loadout[slot] !== w.equipped) w.equipNow(slot);
        w.aimIndex = 0;
      },
      [slot, preset] as const,
    );
    await sim(page, 120, undefined, 60);
    await shot(page, `${gun}-hip`);

    // ADS at 1x: both eyes open (optic hidden, no tube shadow in view), true 1x field of view.
    await sim(page, 90, { down: ['aim'] }, 60);
    const a1 = await alignment(page);
    console.log(gun, '1x', JSON.stringify(a1));
    await shot(page, `${gun}-ads1x`);
    expect(a1.blend).toBeGreaterThan(0.999);
    expect(a1.mag).toBeCloseTo(1, 3);
    expect(a1.opticHidden).toBe(true);
    expect(a1.ring as number).toBeGreaterThan(2);

    // Throw the power ring (magnifier bind), still aiming: 3x.
    await sim(page, 2, { down: ['aim', 'magnifier'] });
    await sim(page, 90, { down: ['aim'] }, 60);
    const a3 = await alignment(page);
    console.log(gun, '3x', JSON.stringify(a3));
    await shot(page, `${gun}-ads3x`);
    expect(a3.mag).toBeCloseTo(3, 3);
    // 3x: the view's FOV is a third of the 1x ADS view's tangent (75° → ~28.7°).
    expect(a3.fov as number).toBeCloseTo(
      (2 * Math.atan(Math.tan((37.5 * Math.PI) / 180) / 3) * 180) / Math.PI,
      1,
    );
    expect(a3.ring as number).toBeLessThan(1);
    expect(a3.opticHidden).toBe(false);

    for (const a of [a1, a3]) {
      expect(a.scope).toBe(true);
      expect(a.aimErrDeg7 as number).toBeLessThan(0.2);
      expect(a.aimErrDeg25 as number).toBeLessThan(0.2);
      // Zeroed at 25 m.
      expect(a.bullet25 as number).toBeLessThan(0.02);
    }
    // Back to 1x, release ADS.
    await sim(page, 2, { down: ['aim', 'magnifier'] });
    await sim(page, 30, { down: ['aim'] });
    expect(await page.evaluate(() => (window as any).__sb.weapons.magnification)).toBeCloseTo(1, 3);
    expect(errors).toEqual([]);
  });
}

test('compact LPVO beside the 1-6x (bench side view)', async ({ page }) => {
  await page.goto('/bench.html?ui=0');
  await page.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 90_000 });
  const base = {
    v: 1,
    weapon: 'sb16',
    parts: { barrel: 'ar_b145', handguard: 'ar_hg_mlok13', buis: 'buis_none' },
  };
  for (const [name, optic] of [
    ['big', 'opt_lpvo'],
    ['small', 'opt_lpvo3'],
  ] as const) {
    const r = await page.evaluate(
      ([b, optic]) =>
        (window as any).__bench.setBuild({ ...b, parts: { ...(b as any).parts, optic } }, 'side'),
      [base, optic] as const,
    );
    expect(r.errors).toEqual([]);
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${dir}/lpvo3-bench-${name}.png` });
  }
});
