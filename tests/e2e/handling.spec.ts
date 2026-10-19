/* eslint-disable @typescript-eslint/no-explicit-any */
import { expect, test, type Page } from '@playwright/test';
import { boot, play } from './helpers';

const dir = 'screenshots';
const shot = (page: Page, name: string) => page.screenshot({ path: `${dir}/handling-${name}.png` });

/**
 * Like `steps`, but only renders the last frame (SwiftShader is slow; the sim is what we want to advance).
 */
async function sim(page: Page, n: number, input?: Record<string, unknown>) {
  await page.evaluate(
    ([n, input]) => {
      const g = (window as any).__sb;
      for (let i = 0; i < (n as number); i++) {
        if (input) g.test.next = structuredClone(input);
        g.step(1 / 60, i === (n as number) - 1);
      }
      g.test.next = {};
    },
    [n, input ?? null] as const,
  );
}

const kind = (page: Page) => page.evaluate(() => (window as any).__sb.weapons.reload.kind as string);

async function start(page: Page) {
  const errors = await boot(page);
  await play(page);
  await sim(page, 60);
  return errors;
}

test.describe.configure({ timeout: 180_000 });

test('handling: high ready, ADS, fast turn lag', async ({ page }) => {
  const errors = await start(page);
  await shot(page, 'high-ready');
  await sim(page, 40, { down: ['aim'] });
  await shot(page, 'ads');
  await sim(page, 30);
  // Fast turn: the view arrives first, the muzzle a beat later.
  await sim(page, 1, { look: { yaw: 0.35, pitch: 0 } });
  await sim(page, 1, { look: { yaw: 0.35, pitch: 0 } });
  await shot(page, 'turn-lag');
  expect(errors).toEqual([]);
});

test('handling: tactical reload, mag check, speed reload drops a mag', async ({ page }) => {
  const errors = await start(page);
  for (let i = 0; i < 3; i++) {
    await sim(page, 2, { down: ['fire'] });
    await sim(page, 6);
  }
  await sim(page, 30);
  await sim(page, 2, { down: ['reload'] });
  await sim(page, 24);
  await shot(page, 'reload-mag-out');
  await sim(page, 60);
  expect(await kind(page)).toBe('reload');
  await shot(page, 'reload-index');
  await sim(page, 100);
  expect(await kind(page)).toBe('idle');
  expect(await page.evaluate(() => (window as any).__sb.weapons.equipped.mags.dump.length)).toBe(1);

  // Hold reload: the mag check pulls the mag into the chest cam's view.
  await sim(page, 55, { down: ['reload'] });
  expect(await kind(page)).toBe('check');
  await shot(page, 'mag-check');
  // The mag is pulled into the chest cam's view: lower centre, ~0.35–0.5 m out (the HUD tag anchors to it).
  const mag = await page.evaluate(() => {
    const g = (window as any).__sb;
    const cam = g.ctx.camera;
    // The HUD tag anchors to the magwell socket (the pulled mag sits just under it).
    const m = g.weapons.equipped.model.sockets.magwell;
    const p = cam.position.clone().setFromMatrixPosition(m.matrixWorld);
    const dist = p.distanceTo(cam.position);
    p.project(cam);
    return { dist, x: p.x, y: p.y };
  });
  console.log('mag in view', JSON.stringify(mag));
  expect(mag.dist).toBeGreaterThan(0.3);
  expect(mag.dist).toBeLessThan(0.55);
  expect(Math.abs(mag.x)).toBeLessThan(0.45);
  expect(mag.y).toBeLessThan(0.1);
  await sim(page, 60);
  expect(await kind(page)).toBe('idle');

  // Double tap: speed reload, physical mag hits the floor and stays there.
  const drops = () => page.evaluate(() => (window as any).__sb.weapons.drops.items.length as number);
  await sim(page, 2, { down: ['fire'] });
  await sim(page, 20);
  await page.evaluate(() => {
    const g = (window as any).__sb;
    g.__magDrops = 0;
    g.ctx.bus.on('magDrop', () => g.__magDrops++);
  });
  await sim(page, 2, { down: ['reload'] });
  await sim(page, 3);
  await sim(page, 2, { down: ['reload'] });
  await sim(page, 12);
  await shot(page, 'speed-reload');
  await sim(page, 120);
  expect(await drops()).toBe(1);
  expect(await page.evaluate(() => (window as any).__sb.__magDrops)).toBe(1);

  // Fix camera: the left hand reaches to the chest cam (mic muffles while the hand is on it).
  await page.evaluate(() => {
    const g = (window as any).__sb;
    g.__camHand = [];
    g.ctx.bus.on('camHand', (e: { active: boolean }) => g.__camHand.push(e.active));
    g.player.knockMount(1);
  });
  await sim(page, 1, { down: ['fixCam'] });
  await sim(page, 22);
  expect(await kind(page)).toBe('camFix');
  await shot(page, 'cam-fix');
  await sim(page, 60);
  expect(await page.evaluate(() => (window as any).__sb.__camHand)).toEqual([true, false]);
  expect(await page.evaluate(() => (window as any).__sb.player.knock)).toBeLessThan(0.01);
  expect(await kind(page)).toBe('idle');
  expect(errors).toEqual([]);
});

test('handling: look down at carrier and legs, lean, pistol', async ({ page }) => {
  const errors = await start(page);
  await sim(page, 1, { look: { yaw: 0, pitch: -1.4 } });
  await sim(page, 30, { move: { x: 0, y: 0.6 } });
  await shot(page, 'look-down');
  await sim(page, 1, { look: { yaw: 0, pitch: 1.4 } });
  await sim(page, 30);
  await sim(page, 45, { down: ['leanRight'] });
  await shot(page, 'lean');
  await sim(page, 40);
  await sim(page, 1, { down: ['switchWeapon'] });
  await sim(page, 70);
  await shot(page, 'pistol');
  await sim(page, 35, { down: ['aim'] });
  await shot(page, 'pistol-ads');
  expect(errors).toEqual([]);
});

/** At full ADS: where the camera (sight eye through the reticle) and the bullet meet at distance `d`. */
async function zeroError(page: Page) {
  return page.evaluate(() => {
    const g = (window as any).__sb;
    const w = g.weapons;
    const cam = g.ctx.camera;
    const o = cam.position.clone();
    const d = o.clone().set(0, 0, -1).applyQuaternion(cam.quaternion);
    const r = w.shotRay();
    const mo = r.origin.clone();
    const md = r.dir.clone();
    const sl = w.sightLine;
    const out: Record<string, number | string> = {
      mode: sl?.mode.id ?? 'none',
      sightHeight: sl?.mode.sightHeight ?? 0,
      blend: w.adsBlend,
    };
    for (const D of [10, 25]) {
      const P = o.clone().addScaledVector(d, D);
      const t = P.clone().sub(mo).dot(d) / md.dot(d);
      const Q = mo.clone().addScaledVector(md, t);
      out['err' + D] = P.distanceTo(Q);
    }
    return out;
  });
}

test('handling: ADS sight pictures per optic, zeroed bore', async ({ page }) => {
  const errors = await start(page);
  const cases: [number, string][] = [
    [0, 'sb16'],
    [0, 'sb16_cqb'],
    [0, 'sb16_lpvo'],
    [1, 'p17_dot'],
    [1, 'p17_std'],
  ];
  for (const [slot, preset] of cases) {
    await page.evaluate(
      ([slot, preset]) => {
        const w = (window as any).__sb.weapons;
        if (preset !== 'sb16') w.setPreset(slot, preset);
        if (w.loadout[slot] !== w.equipped) w.equipNow(slot);
      },
      [slot, preset] as const,
    );
    const modes = await page.evaluate(
      () => (window as any).__sb.weapons.equipped.model.sightLines.length as number,
    );
    for (let m = 0; m < modes; m++) {
      await page.evaluate((m) => ((window as any).__sb.weapons.aimIndex = m), m);
      await sim(page, 50, { down: ['aim'] });
      const z = await zeroError(page);
      console.log(preset, JSON.stringify(z));
      await shot(page, `ads-${preset}-${z.mode}`);
      expect(z.blend).toBeGreaterThan(0.999);
      // Exactly on at the zero; up close the bullet hits the mechanical offset (sight height) below.
      expect(z.err25 as number).toBeLessThan(0.02);
      const expected10 = (z.sightHeight as number) * (1 - 10 / 25);
      expect(Math.abs((z.err10 as number) - expected10)).toBeLessThan(0.02);
      await sim(page, 30);
    }
  }
  expect(errors).toEqual([]);
});
