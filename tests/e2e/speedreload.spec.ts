/* eslint-disable @typescript-eslint/no-explicit-any */
import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { boot, play } from './helpers';

/**
 * Rifle speed reloads (double-tap R on a partial mag) and empty reloads with their finisher (AR bolt-catch slap, AK
 * rack, HK slap). Every frame of the reload is rendered (auto-exposure adapts on rendered frames) and written to
 * `screenshots/speedreload/<weapon>/<kind>-NNN.png` (or `$SPEEDRELOAD_OUT`) for contact sheets / video. After the
 * seat the gun fires and aims again straight away.
 */
const OUT = process.env.SPEEDRELOAD_OUT ?? 'screenshots/speedreload';
const WEAPONS = (process.env.SPEEDRELOAD_WEAPONS ?? 'sb16,hb300,k47s,kp9').split(',');
/** Keep every n-th frame as a still (1 = every frame, for video). */
const EVERY = Number(process.env.SPEEDRELOAD_EVERY ?? 1);

const step = (page: Page, n: number, input: Record<string, unknown> | null, render = true) =>
  page.evaluate(
    ([n, input, render]) => {
      const g = (window as any).__sb;
      for (let i = 0; i < (n as number); i++) {
        if (input) g.test.next = structuredClone(input);
        g.step(1 / 60, render as boolean);
      }
      g.test.next = {};
    },
    [n, input, render] as const,
  );

const state = (page: Page) =>
  page.evaluate(() => {
    const w = (window as any).__sb.weapons;
    return {
      kind: w.reload.kind as string,
      action: w.rig?.action as string,
      rounds: w.equipped.mags.inGun?.rounds as number,
      chambered: w.equipped.mags.chambered as boolean,
      drops: w.drops.items.length as number,
      live: !!w.reloadLive,
    };
  });

test.describe.configure({ timeout: 2_400_000 });

for (const id of WEAPONS)
  test(`speed reload: ${id}`, async ({ page }) => {
    await page.setViewportSize(
      process.env.SPEEDRELOAD_SMALL ? { width: 640, height: 360 } : { width: 960, height: 540 },
    );
    const errors = await boot(page);
    await page.evaluate(() => ((window as any).__sb.renderer.dynres.enabled = false));
    await play(page);
    await page.waitForFunction(() => !!(window as any).__sb.weapons.rig, null, { timeout: 60_000 });
    await page.evaluate((id) => {
      const g = (window as any).__sb;
      g.applyLoadout(
        {
          id: 'speedreload',
          name: 'speedreload',
          primary: { v: 1, weapon: id, parts: {} },
          sidearm: { v: 1, weapon: 'p17', parts: {} },
          gear: { carrier: 'plate', rifleMags: 4, pistolMags: 2, dumpPouch: true, flashbangs: 0, nvg: false },
        },
        true,
      );
      g.__beats = [];
      g.ctx.bus.on('weaponBeat', (e: { beat: string }) => g.__beats.push(e.beat));
    }, id);
    const dir = `${OUT}/${id}`;
    mkdirSync(dir, { recursive: true });
    for (const kind of ['speed', 'empty'] as const) {
      await page.evaluate((kind) => {
        const w = (window as any).__sb.weapons;
        const m = w.equipped.mags;
        m.inGun.rounds = kind === 'empty' ? 0 : 11;
        m.chambered = kind !== 'empty';
        if (kind === 'empty') w.equipped.boltLocked = true;
        (window as any).__sb.__beats.length = 0;
      }, kind);
      // Exposure settles on rendered frames.
      await step(page, 60, null);
      const before = await state(page);
      // Double tap (speed) or a single tap on an empty gun.
      let f = 0;
      const shot = async () => {
        if (f % EVERY === 0)
          await page.screenshot({ path: `${dir}/${kind}-${String(f).padStart(3, '0')}.png` });
        f++;
      };
      const seq: (Record<string, unknown> | null)[] =
        kind === 'speed'
          ? [{ down: ['reload'] }, { down: ['reload'] }, null, null, { down: ['reload'] }, null]
          : [{ down: ['reload'] }, null];
      for (const input of seq) {
        await step(page, 1, input);
        await shot();
      }
      const total = kind === 'speed' ? 72 : 150;
      let live = -1;
      while (f < total) {
        await step(page, 1, null);
        await shot();
        const s = await state(page);
        if (live < 0 && s.live) live = f;
      }
      const s = await state(page);
      const beats = await page.evaluate(() => (window as any).__sb.__beats.slice() as string[]);
      console.log(id, kind, 'live at frame', live, JSON.stringify(s), beats.join(','));
      expect(beats).toContain('magOut');
      expect(beats).toContain('magSeat');
      if (kind === 'empty')
        expect(beats.some((b) => b === 'boltRelease' || b === 'chargingHandle')).toBe(true);
      // Fresh mag in, chambered; the old one is on the floor.
      expect(s.rounds).toBeGreaterThanOrEqual(29);
      expect(s.chambered).toBe(true);
      expect(s.drops).toBeGreaterThan(before.drops);
      // Speed reloads: live (seated + chambered) in under a second.
      if (kind === 'speed') expect(live).toBeLessThan(60);
      await step(page, 40, null, false);
    }
    // Fire right after the seat: cuts the clip's return-to-ready tail and shoots.
    await page.evaluate(() => {
      const m = (window as any).__sb.weapons.equipped.mags;
      m.inGun.rounds = 11;
    });
    await step(page, 1, { down: ['reload'] }, false);
    await step(page, 3, null, false);
    await step(page, 1, { down: ['reload'] }, false);
    for (let i = 0; i < 90 && !(await state(page)).live; i++) await step(page, 1, null, false);
    const atSeat = await state(page);
    expect(atSeat.live).toBe(true);
    await step(page, 3, { down: ['fire'] }, false);
    await step(page, 6, null, false);
    const after = await state(page);
    expect(after.rounds).toBeLessThan(atSeat.rounds);
    expect(after.kind).toBe('idle');
    expect(errors).toEqual([]);
  });
