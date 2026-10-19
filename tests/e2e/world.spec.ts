/* eslint-disable @typescript-eslint/no-explicit-any */
import { expect, test, type Page } from '@playwright/test';
import { boot, play } from './helpers';

const dir = 'screenshots';
test.setTimeout(240_000);

/**
 * Advance the sim without rendering every frame (SwiftShader frames cost ~2 s here); one final render
 * happens on the last step.
 */
async function sim(page: Page, n: number, input?: Record<string, unknown>) {
  await page.evaluate(
    ([n, input]) => {
      const g = (window as any).__sb;
      const r = g.renderer;
      const render = r.render;
      r.render = () => {};
      for (let i = 0; i < (n as number); i++) {
        if (input) g.test.next = structuredClone(input);
        if (i === (n as number) - 1) r.render = render;
        g.step(1 / 60);
      }
      r.render = render;
      g.test.next = {};
    },
    [n, input ?? null] as const,
  );
}

/** Wait for PBR textures, then let physics settle. */
async function ready(page: Page) {
  await page.evaluate(() => (window as any).__sb.world.ready);
  await play(page);
  await sim(page, 20);
}

/** Render once with draw-call accounting (shadow + main + post passes). */
async function drawCalls(page: Page): Promise<number> {
  return page.evaluate(() => {
    const g = (window as any).__sb;
    const info = g.renderer.renderer.info;
    info.autoReset = false;
    info.reset();
    g.renderer.render(1 / 60);
    const calls = info.render.calls;
    info.autoReset = true;
    return calls;
  });
}

/** Place the player (world x/z, yaw) without moving targets. */
async function place(page: Page, x: number, z: number, yaw: number, pitch = 0) {
  await page.evaluate(
    ([x, z, yaw, pitch]) => {
      const g = (window as any).__sb;
      const V = g.player.position.constructor;
      g.player.teleport(new V(x, 0.02, z), yaw);
      g.player.pitch = pitch;
    },
    [x, z, yaw, pitch],
  );
}

test('range from the firing line', async ({ page }) => {
  const errors = await boot(page, '/?map=range');
  await ready(page);
  await sim(page, 40);
  await page.screenshot({ path: `${dir}/world-range.png` });
  const calls = await drawCalls(page);
  console.log('draw calls range:', calls);
  // Turn around: covered line, rules board.
  await sim(page, 1, { look: { yaw: Math.PI * 0.75, pitch: 0.05 } });
  await sim(page, 20);
  await page.screenshot({ path: `${dir}/world-range-behind.png` });
  expect(calls).toBeLessThan(250);
  expect(errors).toEqual([]);
});

test('steel park: plate rack + texas star mid-spin', async ({ page }) => {
  const errors = await boot(page, '/?map=steel');
  await ready(page);
  const calls = await drawCalls(page);
  console.log('draw calls steel:', calls);
  // Shoot two rack plates and two star plates through the real ballistics.
  await page.evaluate(() => {
    const g = (window as any).__sb;
    const w = g.world;
    const V = g.player.position.constructor;
    const eye = new V(-0.5, 1.4, 9.2).add(new V(150, 0, 0));
    const rack = ['steel.rack.p1', 'steel.rack.p4'].map((id: string) => w.targets.get(id).mesh);
    for (const m of rack) {
      const p = new V();
      m.getWorldPosition(p);
      w.testShot(eye, p.add(new V(0, 0.13, 0)), 'p17');
    }
    const star = w.targets.get('steel.star');
    star.hub.updateMatrixWorld(true);
    for (const i of [0, 1]) {
      const p = new V();
      star.plates[i].mesh.getWorldPosition(p);
      w.testShot(eye, p, 'p17');
    }
  });
  await sim(page, 45);
  await page.screenshot({ path: `${dir}/world-steel-park.png` });
  // Close-up of the plate rack and the star mid-spin (free camera between the two stages).
  await page.evaluate(() => {
    const g = (window as any).__sb;
    const V = g.player.position.constructor;
    g.world.setFreeCam(new V(149.5, 1.6, 3.6), new V(149.5, 1.15, -1.5));
  });
  await sim(page, 2);
  await page.screenshot({ path: `${dir}/world-steel.png` });
  await page.evaluate(() => (window as any).__sb.world.setFreeCam(null));
  const state = await page.evaluate(() => {
    const w = (window as any).__sb.world;
    return {
      rackDown: ['steel.rack.p1', 'steel.rack.p4'].map((id: string) => w.targets.get(id).down),
      starLeft: w.targets.get('steel.star').remaining(),
      starSpin: w.targets.get('steel.star').hub.rotation.z,
    };
  });
  console.log('steel state', JSON.stringify(state));
  expect(state.rackDown).toEqual([true, true]);
  expect(state.starLeft).toBe(3);

  // Poppers are calibrated on momentum: 9 mm drops a standard popper but only rings the heavy one.
  const shoot = (id: string, weapon: string) =>
    page.evaluate(
      ([id, weapon]) => {
        const g = (window as any).__sb;
        const w = g.world;
        const aim = w.targets.get(id).aimPoint();
        const V = aim.constructor;
        w.testShot(new V(aim.x, 1.4, aim.z + 9), aim, weapon);
      },
      [id, weapon],
    );
  await shoot('steel.popper.0', 'p17');
  await shoot('steel.popper.heavy', 'p17');
  await sim(page, 60);
  const down = () =>
    page.evaluate(() => {
      const w = (window as any).__sb.world;
      return [w.targets.get('steel.popper.0').down, w.targets.get('steel.popper.heavy').down];
    });
  expect(await down()).toEqual([true, false]);
  await shoot('steel.popper.heavy', 'hb300');
  await sim(page, 60);
  expect(await down()).toEqual([true, true]);
  expect(calls).toBeLessThan(250);
  expect(errors).toEqual([]);
});

test('kill house: exterior, hallway, half-open door', async ({ page }) => {
  const errors = await boot(page, '/?map=killhouse');
  await ready(page);
  const calls = await drawCalls(page);
  console.log('draw calls killhouse:', calls);
  const O = { x: -158, z: -6 };
  // Exterior overview from a high free camera.
  await page.evaluate(
    ([ox, oz]) => {
      const g = (window as any).__sb;
      const V = g.player.position.constructor;
      g.world.setFreeCam(new V(ox + 22, 13, oz + 22), new V(ox + 8, 0, oz + 6));
    },
    [O.x, O.z],
  );
  await sim(page, 2);
  await page.screenshot({ path: `${dir}/world-killhouse-overview.png` });
  await page.evaluate(() => (window as any).__sb.world.setFreeCam(null));

  // Inside the cross hall (H2) looking east along it, chest cam.
  await place(page, O.x + 1.0, O.z + 5.4, -Math.PI / 2);
  await sim(page, 30);
  await page.screenshot({ path: `${dir}/world-killhouse-hall.png` });

  // Door D3 half open into Room 3, seen from the hall.
  await page.evaluate(() => (window as any).__sb.world.door('D3').setOpen(0.5));
  await place(page, O.x + 4.95, O.z + 5.85, 0.18, -0.05);
  await sim(page, 30);
  await page.screenshot({ path: `${dir}/world-killhouse-door.png` });
  const open = await page.evaluate(() => (window as any).__sb.world.door('D3').openAmount());
  expect(open).toBeGreaterThan(0.3);

  // `interact` opens a closed door; walking into the entry door pushes it open.
  await page.evaluate(() => (window as any).__sb.world.door('D3').setOpen(0));
  await place(page, O.x + 4.5, O.z + 5.55, 0, -0.1);
  await sim(page, 2);
  await sim(page, 1, { down: ['interact'] });
  await sim(page, 60);
  const d3 = await page.evaluate(() => (window as any).__sb.world.door('D3').openAmount());
  expect(d3).toBeGreaterThan(0.6);
  await place(page, O.x + 8, O.z + 13.4, 0);
  await sim(page, 150, { move: { x: 0, y: 1 } });
  const d0 = await page.evaluate(() => (window as any).__sb.world.door('D0').openAmount());
  const portal = await page.evaluate(
    () => (window as any).__sb.world.roomGraph().portals.find((p: any) => p.id === 'khA.D0').open,
  );
  console.log('door D3', d3, 'D0 pushed', d0, 'portal', portal);
  expect(d0).toBeGreaterThan(0.3);
  expect(portal).toBeCloseTo(d0, 2);
  expect(calls).toBeLessThan(250);
  expect(errors).toEqual([]);
});

test('drill: bill drill runs, beeps and scores', async ({ page }) => {
  const errors = await boot(page, '/?map=range');
  await ready(page);
  const beeps = await page.evaluate(() => {
    const g = (window as any).__sb;
    const log: string[] = [];
    g.ctx.bus.on('timerBeep', (e: any) => log.push(e.kind));
    g.ctx.bus.on('drillState', (e: any) => log.push(e.state));
    (window as any).__log = log;
    g.drills.start('bill', { seed: 7 });
    return log;
  });
  expect(beeps).toEqual(['standby']);
  await sim(page, 60 * 4.2);
  const res = await page.evaluate(() => {
    const g = (window as any).__sb;
    const w = g.world;
    const V = g.player.position.constructor;
    const t = w.targets.get('range.b2.p1').mesh;
    const p = new V();
    t.getWorldPosition(p);
    const render = g.renderer.render;
    g.renderer.render = () => {};
    for (let i = 0; i < 6; i++) {
      w.testShot(new V(0, 1.4, 7.9), p.clone().add(new V(0.01 * i - 0.02, 0.06, 0)), 'p17');
      for (let k = 0; k < 12; k++) g.step(1 / 60);
    }
    g.renderer.render = render;
    return { log: (window as any).__log, state: g.drills.state };
  });
  console.log('bill result', JSON.stringify(res.state.result?.score));
  expect(res.log).toEqual(['standby', 'start', 'running', 'stop', 'finished']);
  expect(res.state.phase).toBe('finished');
  expect(res.state.result.score.alphas).toBeGreaterThanOrEqual(5);
  expect(res.state.result.shots.length).toBe(6);
  expect(errors).toEqual([]);
});
