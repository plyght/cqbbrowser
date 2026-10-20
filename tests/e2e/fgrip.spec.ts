/* eslint-disable @typescript-eslint/no-explicit-any */
import { expect, test, type Page } from '@playwright/test';
import { boot, play } from './helpers';

/**
 * SBR foregrips (stubby vertical, wedge angled) on the SB-16 and HB-300: hip, ADS and a side close-up with the
 * support hand on the gun; `?contact` side views draw the collision proxies. The support hand's bones must stay
 * out of the grip. Screenshots: $SB_SHOTS (default screenshots/) fgrip-*.png.
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

/** A view from beside the gun (left side: the support hand), then the camera goes back. */
async function sideShot(page: Page, path: string, side = -1) {
  await page.evaluate((side) => {
    const g = (window as any).__sb;
    const cam = g.ctx.camera;
    const w = g.weapons;
    const save = { p: cam.position.clone(), q: cam.quaternion.clone(), fov: cam.fov, near: cam.near };
    const root = w.equipped.model.root;
    const hand = w.rig?.bones.handL;
    const target = cam.position.clone();
    if (hand) hand.getWorldPosition(target);
    else root.getWorldPosition(target);
    // Aim between the hand and the grip ahead of it.
    target.add(
      cam.position
        .clone()
        .set(0, -0.01, -0.04)
        .applyQuaternion(root.getWorldQuaternion(cam.quaternion.clone())),
    );
    // Weapon frame axes: right (+x), up (+y).
    const q = root.getWorldQuaternion(cam.quaternion.clone());
    const off = cam.position
      .clone()
      .set(side * 0.46, -0.02, -0.05)
      .applyQuaternion(q);
    cam.position.copy(target).add(off);
    cam.up.set(0, 1, 0).applyQuaternion(q);
    cam.lookAt(target);
    cam.fov = 32;
    // Clip the forearm on the camera side (it runs from the hand back toward the lens's side of the gun).
    cam.near = 0.38;
    cam.updateProjectionMatrix();
    for (let i = 0; i < 12; i++) g.renderer.render(1 / 60); // let the exposure settle on this view
    cam.position.copy(save.p);
    cam.quaternion.copy(save.q);
    cam.up.set(0, 1, 0);
    cam.fov = save.fov;
    cam.near = save.near;
    cam.updateProjectionMatrix();
  }, side);
  await page.screenshot({ path });
}

/**
 * Support-hand clearance from the grip, weapon frame: every left-hand bone (wrist, palm, finger joints) vs the
 * grip's box, minus a finger radius. > 0 = clear (m).
 */
function clearance(page: Page) {
  return page.evaluate(() => {
    const g = (window as any).__sb;
    const w = g.weapons;
    const rig = w.rig;
    const model = w.equipped.model;
    const boxes = (model.collision ?? [])
      .filter((c: any) => c.kind === 'box' && /^acc_fg_(stubby|wedge)/.test(c.name))
      .map((c: any) => ({
        min: c.center.map((v: number, k: number) => v - c.half[k]),
        max: c.center.map((v: number, k: number) => v + c.half[k]),
      }));
    if (!rig || !boxes.length) return { min: NaN, bone: 'none', boxes: 0 };
    const inv = model.root.matrixWorld.clone().invert();
    let min = Infinity,
      bone = '';
    for (const [name, b] of rig.boneMap as Map<string, any>) {
      if (!name.startsWith('LeftHand')) continue;
      const p = b.getWorldPosition(model.root.position.clone()).applyMatrix4(inv);
      for (const box of boxes) {
        const dx = Math.max(box.min[0] - p.x, 0, p.x - box.max[0]);
        const dy = Math.max(box.min[1] - p.y, 0, p.y - box.max[1]);
        const dz = Math.max(box.min[2] - p.z, 0, p.z - box.max[2]);
        // Inside: negative depth to the nearest face.
        const inside = dx === 0 && dy === 0 && dz === 0;
        const d = inside
          ? -Math.min(
              p.x - box.min[0],
              box.max[0] - p.x,
              p.y - box.min[1],
              box.max[1] - p.y,
              p.z - box.min[2],
              box.max[2] - p.z,
            )
          : Math.hypot(dx, dy, dz);
        const r = /Thumb|Index|Middle|Ring|Pinky/.test(name) ? 0.009 : 0.016;
        if (d - r < min) [min, bone] = [d - r, name];
      }
    }
    return { min, bone, boxes: boxes.length };
  });
}

test.describe.configure({ timeout: 3_600_000 });

const CASES: [string, string, string, Record<string, unknown>][] = [
  [
    'sb16_sbr',
    'sb16',
    'stubby',
    {
      v: 1,
      weapon: 'sb16',
      parts: {
        barrel: 'ar_b103',
        muzzle: 'ar_fh_3p',
        handguard: 'ar_hg_mlok7',
        optic: 'opt_holo',
        buis: 'buis_flip',
        light: 'light_scout',
        foregrip: 'fg_stubby',
        stock: 'ar_stock_carbine',
        grip: 'ar_grip_ergo',
        magazine: 'ar_mag_p30',
      },
      params: { stockPosition: 2 },
    },
  ],
  [
    'sb16_sbr_wedge',
    'sb16',
    'wedge',
    {
      v: 1,
      weapon: 'sb16',
      parts: {
        barrel: 'ar_b103',
        muzzle: 'ar_fh_a2',
        handguard: 'ar_hg_quad9',
        optic: 'opt_reddot',
        buis: 'buis_flip',
        light: 'light_compact',
        foregrip: 'fg_wedge',
        magazine: 'ar_mag_p30',
      },
      params: { stockPosition: 2 },
    },
  ],
  [
    'hb300_stubby',
    'hb300',
    'stubby',
    {
      v: 1,
      weapon: 'hb300',
      parts: {
        barrel: 'hb_b9',
        muzzle: 'ar_fh_3p',
        handguard: 'hb_hg_mlok8',
        optic: 'opt_reddot',
        foregrip: 'fg_stubby',
        light: 'light_compact',
        magazine: 'ar_mag_p30',
      },
      params: { stockPosition: 1 },
    },
  ],
  [
    'hb300_wedge',
    'hb300',
    'wedge',
    {
      v: 1,
      weapon: 'hb300',
      parts: {
        barrel: 'hb_b9',
        muzzle: 'ar_fh_3p',
        handguard: 'hb_hg_mlok5',
        optic: 'opt_holo',
        foregrip: 'fg_wedge',
        light: 'light_compact',
        magazine: 'ar_mag_p30',
      },
      params: { stockPosition: 1 },
    },
  ],
];

for (const contact of [false, true])
  test(`SBR foregrips: support hand on the grip${contact ? ' (?contact)' : ''}`, async ({ page }) => {
    const errors = await boot(page, contact ? '/?contact' : '/');
    await page.evaluate(() => ((window as any).__sb.renderer.dynres.enabled = false));
    await play(page);
    await page
      .waitForFunction(() => !!(window as any).__sb.weapons.rig, null, { timeout: 60_000 })
      .catch(() => {});
    const only = process.env.FG_ONLY?.split(',');
    for (const [preset, gun, grip, build] of CASES.filter((c) => !only || only.includes(c[0]))) {
      const info = await page.evaluate((build) => {
        const g = (window as any).__sb;
        const w = g.weapons;
        // Equip the build through a loadout (rifle first, so it is in hand).
        const gear = {
          carrier: 'plate',
          rifleMags: 3,
          pistolMags: 2,
          dumpPouch: true,
          flashbangs: 0,
          nvg: false,
        };
        const sidearm = { v: 1, weapon: 'p17', parts: {} };
        g.applyLoadout({ id: 'fgrip', name: 'fgrip', primary: build, sidearm, gear }, true);
        w.aimIndex = 0;
        const model = w.equipped.model;
        return {
          weapon: model.weapon,
          proxies: (model.collision ?? []).filter((c: any) => /^acc_fg_/.test(c.name)).length,
        };
      }, build);
      console.log(preset, JSON.stringify(info));
      expect(info.weapon).toBe(gun);
      expect(info.proxies).toBeGreaterThan(0);
      await sim(page, 100, undefined, contact ? 3 : 60);
      const hip = await clearance(page);
      if (!contact) await page.screenshot({ path: `${dir}/fgrip-${gun}-${grip}-hip.png` });
      await sim(page, 90, { down: ['aim'] }, contact ? 3 : 60);
      const ads = await clearance(page);
      if (!contact) await page.screenshot({ path: `${dir}/fgrip-${gun}-${grip}-ads.png` });
      await sideShot(page, `${dir}/fgrip-${gun}-${grip}-side${contact ? '-contact' : ''}.png`);
      console.log(preset, 'clearance', JSON.stringify({ hip, ads }));
      await sim(page, 30);
      if (!Number.isNaN(hip.min)) {
        expect(hip.min).toBeGreaterThan(-0.002);
        expect(ads.min).toBeGreaterThan(-0.002);
      }
    }
    expect(errors).toEqual([]);
  });
