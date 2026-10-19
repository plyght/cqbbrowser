/* eslint-disable @typescript-eslint/no-explicit-any */
import { expect, test, type Page } from '@playwright/test';
import { boot, play } from './helpers';

const dir = 'screenshots';
test.setTimeout(240_000);

/**
 * Advance the sim, drawing only the last few frames (SwiftShader is slow); skipped frames still advance the
 * camera's temporal state (boot, exposure, codec).
 */
async function sim(page: Page, n: number) {
  await page.evaluate((n) => {
    const g = (window as any).__sb;
    for (let i = 0; i < n; i++) g.step(1 / 60, i >= n - 3);
  }, n);
}

async function ready(page: Page) {
  await page.evaluate(() => (window as any).__sb.world.ready);
  await play(page);
  await sim(page, 20);
}

/** Fire `weapon` from → to (world coords) through the real ballistics; returns the newest trace. */
async function shoot(page: Page, from: number[], to: number[], weapon: string) {
  return page.evaluate(
    ([from, to, weapon]) => {
      const g = (window as any).__sb;
      const V = g.player.position.constructor;
      g.world.testShot(new V(...(from as number[])), new V(...(to as number[])), weapon);
      const t = g.ballistics.traces();
      return t[t.length - 1];
    },
    [from, to, weapon] as const,
  );
}

async function freeCam(page: Page, pos: number[], look: number[]) {
  await page.evaluate(
    ([pos, look]) => {
      const g = (window as any).__sb;
      const V = g.player.position.constructor;
      g.world.setFreeCam(new V(...pos), new V(...look));
    },
    [pos, look],
  );
}

test('kill house: rounds through walls and a closed door', async ({ page }) => {
  const errors = await boot(page, '/?map=killhouse&ballistics&roof=0');
  await ready(page);
  const O = { x: -158, z: -6 };
  const at = (x: number, y: number, z: number) => [O.x + x, y, O.z + z];
  // Cross hall → through the hall wall, both entry-hall walls, into Room 2 (t4).
  const a = await shoot(page, at(1.5, 1.35, 5.4), at(12.2, 1.25, 11.3), 'sb16');
  const b = await shoot(page, at(1.5, 1.2, 5.3), at(12.2, 1.1, 11.3), 'p17');
  // From the start mat: exterior wall, the hall walls and the closed door D3 into Room 3.
  const c = await shoot(page, at(8, 1.45, 14.2), at(3, 1.0, 1), 'p17');
  const exits = (t: any) => t.events.filter((e: any) => e.kind === 'exit').length;
  console.log('kill house exits', exits(a), exits(b), exits(c));
  expect(exits(a)).toBeGreaterThanOrEqual(3);
  expect(exits(b)).toBeGreaterThanOrEqual(3);
  expect(exits(c)).toBeGreaterThanOrEqual(3);
  await freeCam(page, at(-2.5, 6.5, 16), at(7, 0.6, 6.5));
  await sim(page, 24);
  await page.screenshot({ path: `${dir}/ballistics-killhouse.png` });
  // Closer, at eye height in the hall: exit holes on the far side of the hall wall.
  await freeCam(page, at(0.4, 1.6, 5.1), at(6, 1.3, 9));
  await sim(page, 24);
  await page.screenshot({ path: `${dir}/ballistics-killhouse-hall.png` });
  expect(errors).toEqual([]);
});

test('steel park: ricochet, spall and the popper knockdown matrix', async ({ page }) => {
  const errors = await boot(page, '/?map=steel&ballistics');
  await ready(page);
  const S = 150;
  const aim = (id: string) =>
    page.evaluate((id) => {
      const p = (window as any).__sb.world.targets.get(id).aimPoint();
      return [p.x, p.y, p.z];
    }, id);

  // Knockdown matrix (9 m, at the aim point above the calibration line).
  const weapons = ['p17', 'kp9', 'sb16', 'hb300', 'k47s'];
  const matrix: Record<string, [boolean, boolean]> = {};
  for (const w of weapons) {
    await page.evaluate(() => {
      const t = (window as any).__sb.world.targets;
      t.get('steel.popper.0').reset();
      t.get('steel.popper.heavy').reset();
    });
    await sim(page, 2); // meshes re-sync to the reset bodies
    for (const id of ['steel.popper.0', 'steel.popper.heavy']) {
      const p = await aim(id);
      // From 9 m, a few metres off-axis so no other popper of the field is in the line of fire.
      await shoot(page, [p[0] + 3, 1.4, p[2] + 8.5], p, w);
    }
    await sim(page, 60);
    const [d0, dh, hits] = await page.evaluate(() => {
      const t = (window as any).__sb.world.targets;
      const h = t.get('steel.popper.heavy');
      return [t.get('steel.popper.0').down, h.down, h.hits];
    });
    expect(hits).toBeGreaterThan(0); // the round really struck the heavy popper
    matrix[w] = [d0, dh];
  }
  console.log('knockdown matrix [standard, heavy]', JSON.stringify(matrix));
  for (const w of weapons) expect(matrix[w][0]).toBe(true);
  expect(matrix.p17[1]).toBe(false);
  expect(matrix.kp9[1]).toBe(false);
  expect(matrix.sb16[1]).toBe(false);
  expect(matrix.hb300[1]).toBe(true);
  expect(matrix.k47s[1]).toBe(true);

  // Matrix scene: reset, 9 mm drops standard poppers, rings the heavy; .300 BLK sub drops it.
  await page.evaluate(() => {
    const g = (window as any).__sb;
    for (const id of ['steel.popper.0', 'steel.popper.1', 'steel.popper.2', 'steel.popper.heavy'])
      g.world.targets.get(id).reset();
    g.ballistics.log.clear();
  });
  await sim(page, 2);
  for (const [id, w] of [
    ['steel.popper.0', 'p17'],
    ['steel.popper.1', 'kp9'],
    ['steel.popper.heavy', 'p17'],
  ] as const) {
    const p = await aim(id);
    await shoot(page, [p[0] + 3, 1.4, p[2] + 8.5], p, w);
  }
  await freeCam(page, [S - 17.6, 1.35, -6.2], [S - 21.6, 0.7, -10.6]);
  await sim(page, 50);
  await page.screenshot({ path: `${dir}/ballistics-poppers-9mm.png` });
  const heavyDown = () =>
    page.evaluate(() => (window as any).__sb.world.targets.get('steel.popper.heavy').down);
  expect(await heavyDown()).toBe(false);
  const p = await aim('steel.popper.heavy');
  await shoot(page, [p[0] + 3.2, 1.4, p[2] + 8.5], p, 'hb300');
  await sim(page, 20);
  expect(await heavyDown()).toBe(true);
  await page.screenshot({ path: `${dir}/ballistics-poppers-blk.png` });

  // Ricochet: a shallow shot glances off a 5-to-go plate; a low shot skips off the concrete pad.
  await page.evaluate(() => (window as any).__sb.ballistics.log.clear());
  const g0 = await aim('steel.5tg.0');
  const rico = await shoot(page, [g0[0] + 7, g0[1] + 0.2, g0[2] + 1.6], g0, 'p17');
  const head = await shoot(page, [g0[0], 1.4, g0[2] + 9], g0, 'sb16');
  const skip = await shoot(page, [S + 3, 1.2, 9.5], [S + 15, 0, 9.5], 'p17');
  const kinds = (t: any) => t.events.map((e: any) => e.kind);
  console.log('ricochet', kinds(rico), 'head-on', kinds(head), 'floor skip', kinds(skip));
  expect(kinds(rico)).toContain('ricochet');
  expect(kinds(head)).toContain('spall');
  expect(kinds(skip)).toContain('ricochet');
  await freeCam(page, [g0[0] + 3.5, 2.2, g0[2] + 4.5], [g0[0] + 0.5, 1.1, g0[2]]);
  await sim(page, 24);
  await page.screenshot({ path: `${dir}/ballistics-ricochet.png` });
  expect(errors).toEqual([]);
});
