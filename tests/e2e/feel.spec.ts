/* eslint-disable @typescript-eslint/no-explicit-any */
import { expect, test, type Page } from '@playwright/test';
import { boot, play } from './helpers';

/**
 * Feel pass (owner playtest): gun in frame on the chest cam for every weapon and stance, unmistakable recoil
 * (5-shot strip), walking that feels like a person wearing a chest cam, punchy reloads and an animated mag check.
 */
const dir = 'screenshots';
const shot = (page: Page, name: string) => page.screenshot({ path: `${dir}/feel-${name}.png` });

/** Advance the sim, rendering every `every` frames and the last one (SwiftShader is slow); `every` ≤ 0 = no render. */
async function sim(page: Page, n: number, input?: Record<string, unknown>, every = 15) {
  await page.evaluate(
    ([n, input, every]) => {
      const g = (window as any).__sb;
      for (let i = 0; i < (n as number); i++) {
        if (input) g.test.next = structuredClone(input);
        const e = every as number;
        g.step(1 / 60, e > 0 && (i === (n as number) - 1 || i % e === e - 1));
      }
      g.test.next = {};
    },
    [n, input ?? null, every] as const,
  );
}

async function start(page: Page) {
  const errors = await boot(page);
  await page.evaluate(() => ((window as any).__sb.renderer.dynres.enabled = false));
  await play(page);
  await sim(page, 120);
  return errors;
}

const equip = (page: Page, preset: string) =>
  page.evaluate((p) => {
    const w = (window as any).__sb.weapons;
    const slot = p.startsWith('p17') ? 1 : 0;
    w.setPreset(slot, p);
    if (w.loadout[slot] !== w.equipped) w.equipNow(slot);
  }, preset);

/** Weapon model screen footprint (NDC bbox, clamped) and the muzzle's NDC position. */
const framing = (page: Page) =>
  page.evaluate(() => {
    const g = (window as any).__sb;
    const w = g.weapons;
    const cam = g.ctx.camera;
    const root = w.equipped.model.root;
    root.updateMatrixWorld(true);
    let x0 = 1,
      x1 = -1,
      y0 = 1,
      y1 = -1;
    root.traverse((o: any) => {
      if (!o.isMesh || !o.visible) return;
      o.geometry.computeBoundingBox();
      const b = o.geometry.boundingBox;
      for (let i = 0; i < 8; i++) {
        const v = b.min.clone();
        if (i & 1) v.x = b.max.x;
        if (i & 2) v.y = b.max.y;
        if (i & 4) v.z = b.max.z;
        v.applyMatrix4(o.matrixWorld);
        if (v.clone().applyMatrix4(cam.matrixWorldInverse).z > -0.02) continue;
        v.project(cam);
        x0 = Math.min(x0, Math.max(-1, v.x));
        x1 = Math.max(x1, Math.min(1, v.x));
        y0 = Math.min(y0, Math.max(-1, v.y));
        y1 = Math.max(y1, Math.min(1, v.y));
      }
    });
    const m = w.muzzleWorld().origin.clone().project(cam);
    return { area: (Math.max(0, x1 - x0) * Math.max(0, y1 - y0)) / 4, top: y1, mx: m.x, my: m.y };
  });

test.describe.configure({ timeout: 420_000 });

test('feel: weapon framing on the chest cam (every weapon, every stance)', async ({ page }) => {
  const errors = await start(page);
  for (const p of ['sb16_cqb', 'hb300_int', 'k47s_railed', 'kp9_rail', 'p17_std']) {
    await equip(page, p);
    await sim(page, 60);
    const f = await framing(page);
    console.log(p, JSON.stringify(f));
    await shot(page, `chest-${p}`);
    // In frame, below the horizon, muzzle toward the aim point (lower centre).
    expect(f.area).toBeGreaterThan(p.startsWith('p17') ? 0.008 : 0.06);
    expect(f.top).toBeGreaterThan(-0.2);
    expect(Math.abs(f.mx)).toBeLessThan(0.25);
    expect(f.my).toBeLessThan(0);
    expect(f.my).toBeGreaterThan(-0.4);
  }
  for (const p of ['sb16_cqb', 'p17_std']) {
    await equip(page, p);
    await sim(page, 40);
    await sim(page, 1, { down: ['readyDown'] });
    await sim(page, 40);
    await shot(page, `stance-${p}-low`);
    expect((await framing(page)).area).toBeGreaterThan(p.startsWith('p17') ? 0.004 : 0.03);
    await sim(page, 1, { down: ['readyUp'] });
    await sim(page, 2);
    await sim(page, 1, { down: ['readyUp'] });
    await sim(page, 40);
    await shot(page, `stance-${p}-compressed`);
    expect((await framing(page)).area).toBeGreaterThan(p.startsWith('p17') ? 0.004 : 0.03);
    await sim(page, 1, { down: ['readyDown'] });
    await sim(page, 2);
    await sim(page, 1, { down: ['crouch'] });
    await sim(page, 50);
    await shot(page, `stance-${p}-crouch`);
    await sim(page, 1, { down: ['crouch'] });
    await sim(page, 2);
    await sim(page, 45, { down: ['leanLeft'] });
    await shot(page, `stance-${p}-lean`);
    await sim(page, 40);
    await sim(page, 40, { down: ['aim'] });
    await shot(page, `ads-${p}`);
    await sim(page, 30);
  }
  expect(errors).toEqual([]);
});

test('feel: recoil strip (5-shot string, frames 0/2/4/8/16 after the last shot)', async ({ page }) => {
  const errors = await start(page);
  const pose = () =>
    page.evaluate(() => {
      const g = (window as any).__sb;
      const cam = g.ctx.camera;
      const d = g.weapons.muzzleWorld().dir;
      const c = cam.position.clone().set(0, 0, -1).applyQuaternion(cam.quaternion);
      return {
        muzzle: (Math.asin(d.y) * 180) / Math.PI,
        cam: (Math.asin(c.y) * 180) / Math.PI,
        fov: cam.fov,
      };
    });
  for (const p of ['sb16_cqb', 'k47s_railed', 'kp9_rail', 'hb300_int', 'p17_std']) {
    await equip(page, p);
    await sim(page, 60);
    const base = await pose();
    for (let s = 0; s < 4; s++) {
      await sim(page, 1, { down: ['fire'] });
      await sim(page, 5);
    }
    const before = await pose();
    await sim(page, 1, { down: ['fire'] });
    await shot(page, `recoil-${p}-f0`);
    let peak = { muzzle: -99, cam: -99, fov: 0 };
    let at = 0;
    for (const f of [2, 4, 8, 16]) {
      await sim(page, f - at, undefined, 99);
      at = f;
      const q = await pose();
      peak = {
        muzzle: Math.max(peak.muzzle, q.muzzle),
        cam: Math.max(peak.cam, q.cam),
        fov: Math.max(peak.fov, q.fov),
      };
      await shot(page, `recoil-${p}-f${f}`);
    }
    await sim(page, 60);
    const after = await pose();
    console.log(p, JSON.stringify({ base, before, peak, after }));
    // Rise that stacks over the string, a visible per-shot kick, camera kick, FOV punch — and recovery.
    expect(before.muzzle - base.muzzle).toBeGreaterThan(0.3);
    expect(peak.muzzle - before.muzzle).toBeGreaterThan(0.5);
    expect(peak.cam - base.cam).toBeGreaterThan(0.12);
    expect(peak.fov - base.fov).toBeGreaterThan(0.3);
    expect(Math.abs(after.muzzle - base.muzzle)).toBeLessThan(0.6);
  }
  expect(errors).toEqual([]);
});

test('feel: walking — responsive accel, planted stops, subtle chest bob', async ({ page }) => {
  const errors = await start(page);
  const rec = (n: number, input: Record<string, unknown>) =>
    page.evaluate(
      ([n, input]) => {
        const g = (window as any).__sb;
        const out: number[][] = [];
        if ((input as any).tp) g.player.teleport(g.player.position.clone().set(0, 0, 8), Math.PI);
        for (let i = 0; i < (n as number); i++) {
          g.test.next = structuredClone(input);
          g.step(1 / 60, false);
          out.push([g.player.speed, g.ctx.camera.position.y - g.player.feet.y]);
        }
        g.test.next = {};
        return out;
      },
      [n, input] as const,
    );
  const walk = await rec(90, { move: { x: 0, y: 1 }, tp: 1 });
  const stop = await rec(30, {});
  const reach = walk.findIndex((r) => r[0] > 2.2 * 0.9) / 60;
  const halt = stop.findIndex((r) => r[0] < 0.2) / 60;
  const ys = walk.slice(40).map((r) => r[1]);
  const bob = Math.max(...ys) - Math.min(...ys);
  const sprint = await rec(120, { move: { x: 0, y: 1 }, down: ['sprint'], tp: 1 });
  await rec(40, {});
  const slow = await rec(90, { move: { x: 0, y: 1 }, down: ['slowWalk'], tp: 1 });
  console.log(JSON.stringify({ reach, halt, bob, sprint: sprint.at(-1)![0], slow: slow.at(-1)![0] }));
  expect(Math.max(...walk.map((r) => r[0]))).toBeCloseTo(2.2, 1);
  expect(reach).toBeLessThan(0.16);
  expect(halt).toBeLessThan(0.13);
  expect(Math.max(...walk.map((r) => r[0]))).toBeLessThan(2.25); // no overshoot
  expect(bob).toBeGreaterThan(0.002);
  expect(bob).toBeLessThan(0.012);
  expect(Math.max(...sprint.map((r) => r[0]))).toBeCloseTo(5, 1);
  expect(slow.at(-1)![0]).toBeCloseTo(1, 1);
  await sim(page, 20, { move: { x: 0, y: 1 } });
  await shot(page, 'walk');
  expect(errors).toEqual([]);
});

test('feel: punchy reload, animated mag check (out → show → back in → seat), abort, switch', async ({
  page,
}) => {
  const errors = await start(page);
  await page.evaluate(() => {
    const g = (window as any).__sb;
    g.__beats = [];
    g.ctx.bus.on('weaponBeat', (e: { beat: string }) => g.__beats.push(e.beat));
  });
  const beats = () => page.evaluate(() => (window as any).__sb.__beats.splice(0) as string[]);
  const state = () =>
    page.evaluate(() => {
      const w = (window as any).__sb.weapons;
      const m = w.equipped.mag;
      return {
        beat: w.beats.current?.name as string | undefined,
        kind: w.reload.kind as string,
        // World distance of the mag from its seated place in the well.
        out: m
          ? m.obj.getWorldPosition(m.rest.clone()).distanceTo(m.obj.parent.localToWorld(m.rest.clone()))
          : 0,
      };
    });
  for (const p of ['sb16_cqb', 'p17_std']) {
    await equip(page, p);
    await sim(page, 40);
    await beats();
    // Hold reload: the mag comes out of the well and is held up to the lens; the HUD count floats at it.
    let at = 0;
    for (const [f, name] of [
      [20, 'grab'],
      [36, 'out'],
      [70, 'hold'],
    ] as const) {
      await sim(page, f - at, { down: ['reload'] }, 99);
      at = f;
      await shot(page, `check-${p}-${name}`);
    }
    const held = await state();
    expect(held.kind).toBe('check');
    expect(held.beat).toBe('checkHold');
    expect(held.out).toBeGreaterThan(p.startsWith('p17') ? 0.03 : 0.1);
    // Release: straight back in, seated with a slap + tug.
    await sim(page, 16, undefined, 99);
    await shot(page, `check-${p}-in`);
    await sim(page, 80);
    expect((await state()).kind).toBe('idle');
    expect((await state()).out).toBeLessThan(1e-4);
    expect((await beats()).filter((b) => b.startsWith('mag'))).toEqual([
      'magCheck',
      'magCheckOut',
      'magCheckIn',
      'magSeat',
    ]);
    // Fire during a check: aborts with a fast reinsert, then the gun is back up.
    await sim(page, 50, { down: ['reload'] }, 99);
    await sim(page, 2, { down: ['fire'] });
    await sim(page, 40);
    expect((await state()).kind).toBe('idle');
    expect((await state()).out).toBeLessThan(1e-4);
    await beats();
    // Tactical reload: capture the seat contact frame.
    await sim(page, 1, { down: ['fire'] });
    await sim(page, 12);
    await sim(page, 2, { down: ['reload'] });
    for (let i = 0; i < 160; i++) {
      await sim(page, 1, undefined, -1); // no render while searching
      if ((await state()).beat === 'magSeat') break;
    }
    await sim(page, 3, undefined, 99);
    await shot(page, `reload-${p}-seat`);
    await sim(page, 90);
    expect((await state()).kind).toBe('idle');
    expect(await beats()).toContain('magSeat');
  }
  // Switch: pressing switch again mid-swap reverses it; a full switch lands on the other gun.
  await equip(page, 'sb16_cqb');
  await sim(page, 30);
  const id = () => page.evaluate(() => (window as any).__sb.weapons.equipped.def.id as string);
  await sim(page, 1, { down: ['switchWeapon'] });
  await sim(page, 6);
  await sim(page, 1, { down: ['switchWeapon'] });
  await sim(page, 60);
  expect(await id()).toBe('sb16');
  await sim(page, 1, { down: ['switchWeapon'] });
  await sim(page, 80);
  expect(await id()).toBe('p17');
  expect(errors).toEqual([]);
});
