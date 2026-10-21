/* eslint-disable @typescript-eslint/no-explicit-any */
import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { boot, play } from './helpers';

/**
 * Helmet cam framing + ADS (owner: guns sit too low, ADS is way too zoomed in). The helmet lens stays on the helmet
 * and wide in ADS; the gun comes up to the eye line. Assertions: the FOV narrows by at most 5 degrees, the bore stays
 * within 1 degree of the aim point at 7 m and 15 m, the chest cam is unchanged.
 *
 * Evidence modes (all slow under SwiftShader, so opt-in):
 * - HELMET_SHOTS=before|after writes progress/helmet-<weapon>-<hip|ads>-<tag>.png (70+ rendered frames before each
 *   still: auto-exposure only adapts on rendered frames).
 * - HELMET_FRAMES=<dir> records the hip - ADS - hip clip frames for ffmpeg.
 * - HELMET_TUNE=1 [HELMET_SET='{"tilt":0.12,...}'] prints framing metrics for tuning HELMET live.
 */
const OUT =
  process.env.HELMET_OUT ??
  '/tmp/claude-0/-home-user-cqbbrowser/5a21a369-8f5c-58f3-a403-1f3dec329f38/scratchpad/progress';
const TAG = process.env.HELMET_SHOTS;

type Rig = { name: string; slot: number; preset?: string; weapon?: string };
const RIGS: Rig[] = [
  { name: 'sb16-reddot', slot: 0, preset: 'sb16_quad' },
  { name: 'sb16-lpvo3', slot: 0, preset: 'sb16_lpvo3' },
  { name: 'hb300', slot: 0, weapon: 'hb300' },
  { name: 'k47s', slot: 0, weapon: 'k47s' },
  { name: 'p17', slot: 1 },
];

async function setup(page: Page, mount: 'chest' | 'helmet', rig: Rig) {
  await page.addInitScript((mount) => {
    localStorage.setItem('shortbarrel.settings.v1', JSON.stringify({ camera: { mount } }));
  }, mount);
  await page.setViewportSize({ width: 960, height: 540 });
  const errors = await boot(page);
  await page.evaluate(() => ((window as any).__sb.renderer.dynres.enabled = false));
  await play(page);
  await page.waitForFunction(() => !!(window as any).__sb.weapons.rig, null, { timeout: 90_000 });
  await page.evaluate((rig) => {
    const g = (window as any).__sb;
    if (rig.weapon)
      g.applyLoadout(
        {
          id: 't',
          name: 't',
          primary: { v: 1, weapon: rig.weapon, parts: {} },
          sidearm: { v: 1, weapon: 'p17', parts: {} },
          gear: { carrier: 'plate', rifleMags: 4, pistolMags: 4, dumpPouch: true, flashbangs: 0, nvg: false },
        },
        true,
      );
    if (rig.preset) g.weapons.setPreset(rig.slot, rig.preset);
    g.weapons.equipNow(rig.slot);
    g.weapons.aimIndex = 0;
  }, rig);
  return errors;
}

/** Step n frames holding ADS or not; the last `draw` frames are rendered (all of them by default). */
function run(page: Page, n: number, aim: boolean, draw = n) {
  return page.evaluate(
    ([n, aim, draw]) => {
      const g = (window as any).__sb;
      for (let i = 0; i < (n as number); i++) {
        g.test.next = aim ? { down: ['aim'] } : {};
        g.step(1 / 60, i >= (n as number) - (draw as number));
      }
      g.test.next = {};
    },
    [n, aim, draw] as const,
  );
}

/** Screen position (% from the left / up from the bottom, undistorted) of gun points, plus the aim errors. */
function measure(page: Page) {
  return page.evaluate(() => {
    const g = (window as any).__sb;
    const w = g.weapons;
    const cam = g.ctx.camera;
    cam.updateMatrixWorld();
    const e = w.equipped;
    const gm = w.gunMatrix;
    const V = cam.position.constructor as any;
    const r1 = (x: number) => Math.round(x * 10) / 10;
    const proj = (v: any) => {
      const p = v.clone().project(cam);
      return [r1((p.x * 0.5 + 0.5) * 100), r1((p.y * 0.5 + 0.5) * 100)];
    };
    const si = Math.min(w.aimIndex, e.sightLocal.length - 1);
    const muzzle = proj(e.muzzleLocal.clone().applyMatrix4(gm));
    const sightPt = e.sightLocal[si].clone().applyMatrix4(gm);
    const sight = proj(sightPt);
    const opticObj = e.model.parts.optic;
    let optic: number[] | null = null;
    if (opticObj) {
      const b = new V();
      opticObj.updateWorldMatrix(true, false);
      b.setFromMatrixPosition(opticObj.matrixWorld);
      optic = proj(b);
    }
    const camDir = new V(0, 0, -1).applyQuaternion(cam.quaternion);
    const r = w.shotRay();
    const D = 180 / Math.PI;
    // Angle at the camera between the camera's centre ray point at d and where the bore passes that depth.
    const err = (d: number) => {
      const c = cam.position.clone().addScaledVector(camDir, d);
      const t = c.clone().sub(r.origin).dot(camDir) / r.dir.dot(camDir);
      const hit = r.origin.clone().addScaledVector(r.dir, t);
      const a = hit.clone().sub(cam.position).normalize();
      return Math.acos(Math.min(1, a.dot(camDir))) * D;
    };
    const rel = sightPt.clone().sub(cam.position).applyQuaternion(cam.quaternion.clone().invert());
    const dot = document.querySelector('.aimdot') as HTMLElement | null;
    return {
      blend: w.adsBlend as number,
      fov: cam.fov as number,
      muzzle,
      sight,
      optic,
      sightRelCam: [rel.x, rel.y, rel.z].map((x) => Math.round(x * 1000) / 1000),
      err7: err(7),
      err15: err(15),
      mount: g.player.mount as string,
      dotOpacity: Number(dot?.style.opacity ?? 0),
    };
  });
}

if (TAG) {
  for (const rig of RIGS) {
    test(`helmet shots ${rig.name} ${TAG}`, async ({ page }) => {
      test.setTimeout(300_000);
      const errors = await setup(page, 'helmet', rig);
      mkdirSync(OUT, { recursive: true });
      await run(page, 70, false);
      await page.screenshot({ path: `${OUT}/helmet-${rig.name}-hip-${TAG}.png` });
      await run(page, 90, true);
      await page.screenshot({ path: `${OUT}/helmet-${rig.name}-ads-${TAG}.png` });
      expect(errors).toEqual([]);
    });
  }
  test(`chest ads shot ${TAG}`, async ({ page }) => {
    test.setTimeout(300_000);
    const errors = await setup(page, 'chest', RIGS[0]);
    mkdirSync(OUT, { recursive: true });
    await run(page, 70, false);
    await run(page, 90, true);
    await page.screenshot({ path: `${OUT}/chest-sb16-reddot-ads-${TAG}.png` });
    expect(errors).toEqual([]);
  });
}

if (process.env.HELMET_TUNE) {
  for (const rig of RIGS) {
    test(`helmet tune ${rig.name}`, async ({ page }) => {
      test.setTimeout(300_000);
      const errors = await setup(page, 'helmet', rig);
      mkdirSync(OUT, { recursive: true });
      await page.evaluate(
        (o) => {
          const h = (window as any).__sb.player.helmet;
          for (const [k, v] of Object.entries(o)) {
            if (Array.isArray(v)) h[k].set(...v);
            else h[k] = v;
          }
        },
        JSON.parse(process.env.HELMET_SET ?? '{}'),
      );
      await run(page, 70, false, 4);
      console.log(rig.name, 'hip', JSON.stringify(await measure(page)));
      await page.screenshot({ path: `${OUT}/tune-${rig.name}-hip.png` });
      await run(page, 90, true, 4);
      console.log(rig.name, 'ads', JSON.stringify(await measure(page)));
      await page.screenshot({ path: `${OUT}/tune-${rig.name}-ads.png` });
      expect(errors).toEqual([]);
    });
  }
}

for (const rig of RIGS) {
  test(`helmet ADS keeps the wide lens and the bore on the aim point: ${rig.name}`, async ({ page }) => {
    test.setTimeout(240_000);
    const errors = await setup(page, 'helmet', rig);
    await run(page, 60, false, 3);
    const hip = await measure(page);
    await run(page, 90, true, 3);
    const ads = await measure(page);
    console.log(
      rig.name,
      `fov ${hip.fov} -> ${ads.fov}`,
      `aim error 7 m ${ads.err7.toFixed(2)} deg, 15 m ${ads.err15.toFixed(2)} deg`,
    );
    expect(ads.blend).toBeGreaterThan(0.999);
    // No scope-like zoom: the helmet lens narrows by at most 5 degrees.
    expect(hip.fov - ads.fov).toBeLessThanOrEqual(5);
    expect(hip.fov - ads.fov).toBeGreaterThanOrEqual(0);
    // Shots go where the player aims.
    expect(ads.err7).toBeLessThanOrEqual(1);
    expect(ads.err15).toBeLessThanOrEqual(1);
    // The gun is in the lower part of the picture, not through the optic.
    expect(ads.muzzle[1]).toBeLessThan(60);
    // The hint dot is on while aiming and off at the hip.
    expect(ads.dotOpacity).toBeGreaterThan(0.5);
    expect(hip.dotOpacity).toBe(0);
    expect(errors).toEqual([]);
  });
}

test('chest cam ADS is unchanged: the lens goes to the sight and narrows', async ({ page }) => {
  test.setTimeout(240_000);
  const errors = await setup(page, 'chest', RIGS[0]);
  await run(page, 60, false, 3);
  const hip = await measure(page);
  await run(page, 90, true, 3);
  const ads = await page.evaluate(() => {
    const g = (window as any).__sb;
    const cam = g.ctx.camera;
    return { fov: cam.fov, near: cam.near, dist: cam.position.distanceTo(g.weapons.eyeWorld) };
  });
  const after = await measure(page);
  expect(hip.fov).toBe(92);
  // 1x red dot: the 75 degree sight picture, camera at the sight's eye point, no helmet aim dot.
  expect(ads.fov).toBeCloseTo(75, 1);
  expect(ads.dist).toBeLessThan(0.005);
  expect(ads.near).toBeGreaterThan(0.03);
  expect(after.dotOpacity).toBe(0);
  expect(errors).toEqual([]);
});

/** Hip - ADS - hip on the helmet cam, 30 fps frames into $HELMET_FRAMES for ffmpeg. */
test('helmet cam hip-ADS-hip clip', async ({ page }) => {
  test.skip(!process.env.HELMET_FRAMES, 'set HELMET_FRAMES=<dir> to record');
  test.setTimeout(900_000);
  const dir = process.env.HELMET_FRAMES!;
  mkdirSync(dir, { recursive: true });
  const errors = await setup(page, 'helmet', RIGS[0]);
  await run(page, 70, false);
  let n = 0;
  for (const [aim, frames] of [
    [false, 30],
    [true, 90],
    [false, 80],
  ] as [boolean, number][]) {
    for (let i = 0; i < frames; i++) {
      await run(page, 1, aim);
      if (i % 2 === 0) await page.screenshot({ path: `${dir}/f${String(n++).padStart(4, '0')}.png` });
    }
  }
  expect(errors).toEqual([]);
});
