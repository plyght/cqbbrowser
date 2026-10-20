/* eslint-disable @typescript-eslint/no-explicit-any */
import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { boot, play } from './helpers';

/**
 * Mag check on every weapon (hold R): the mag leaves the well completely, is presented to the chest cam with the
 * rounds visible (top round at the lips, witness holes / window where the real mag has them), then goes back in and
 * seats. Frames go to `screenshots/magcheck/<preset>/` (or `$MAGCHECK_OUT`); the frame sequence is rendered every
 * frame (auto-exposure adapts on rendered frames). Counts: full, half and one round.
 */
const OUT = process.env.MAGCHECK_OUT ?? 'screenshots/magcheck';
const WEAPONS = (process.env.MAGCHECK_WEAPONS ?? 'p17,p92,sb16,hb300,k47s,kp9').split(',');

/** `MAGCHECK_FAST=1`: iterate quickly (smaller frames, only the last few frames before each still rendered). */
const FAST = !!process.env.MAGCHECK_FAST;

async function run(page: Page, n: number, input: Record<string, unknown> | null, render: boolean) {
  await page.evaluate(
    ([n, input, render, fast]) => {
      const g = (window as any).__sb;
      for (let i = 0; i < (n as number); i++) {
        if (input) g.test.next = structuredClone(input);
        g.step(1 / 60, (render as boolean) && (!fast || i >= (n as number) - 4));
      }
      g.test.next = {};
    },
    [n, input, render, FAST] as const,
  );
}

/** Default build of `weapon` in hand (a loadout with it), `rounds` in the mag. Returns the capacity. */
const equip = (page: Page, weapon: string, rounds: number, load = false) =>
  page.evaluate(
    ([id, rounds, load]) => {
      const g = (window as any).__sb;
      const w = g.weapons;
      const side = id === 'p17' || id === 'p92';
      if (load) {
        g.applyLoadout(
          {
            id: 'magcheck',
            name: 'magcheck',
            primary: { v: 1, weapon: side ? 'sb16' : id, parts: {} },
            sidearm: { v: 1, weapon: side ? id : 'p17', parts: {} },
            gear: {
              carrier: 'plate',
              rifleMags: 4,
              pistolMags: 2,
              dumpPouch: true,
              flashbangs: 0,
              nvg: false,
            },
          },
          true,
        );
        w.equipNow(side ? 1 : 0);
      }
      w.equipped.mags.inGun.rounds = rounds;
      return w.equipped.def.magCapacity as number;
    },
    [weapon, rounds, load] as const,
  );

const state = (page: Page) =>
  page.evaluate(() => {
    const w = (window as any).__sb.weapons;
    const m = w.equipped.mag;
    const rounds = w.equipped.model.root.getObjectByName('magRounds');
    return {
      kind: w.reload.kind as string,
      out: m
        ? m.obj.getWorldPosition(m.rest.clone()).distanceTo(m.obj.parent.localToWorld(m.rest.clone()))
        : 0,
      shown: rounds?.visible ? (rounds.count as number) : 0,
      hud: (document.querySelector('.mag .count, #mag-count, [data-mag-count]')?.textContent ?? '') as string,
    };
  });

test.describe.configure({ timeout: 2_400_000 });

for (const preset of WEAPONS)
  test(`mag check: ${preset}`, async ({ page }) => {
    await page.setViewportSize(FAST ? { width: 640, height: 360 } : { width: 960, height: 540 });
    const errors = await boot(page);
    await page.evaluate(() => ((window as any).__sb.renderer.dynres.enabled = false));
    await play(page);
    await page.waitForFunction(() => !!(window as any).__sb.weapons.rig, null, { timeout: 60_000 });
    await run(page, 30, null, false);
    const cap = await equip(page, preset, 1, true);
    const dir = `${OUT}/${preset}`;
    mkdirSync(dir, { recursive: true });
    for (const [label, rounds] of [
      ['full', cap],
      ['half', Math.ceil(cap / 2)],
      ['one', 1],
    ] as const) {
      await equip(page, preset, rounds);
      // Exposure settles on rendered frames.
      await run(page, 60, null, true);
      // Hold R: render every frame, keep stills at the phases.
      const phases = label === 'full' ? [8, 22, 34, 46, 62, 90, 130] : [90];
      let f = 0;
      let maxOut = 0;
      for (const at of phases) {
        await run(page, at - f, { down: ['reload'] }, true);
        f = at;
        await page.screenshot({ path: `${dir}/${label}-${String(at).padStart(3, '0')}.png` });
        const s = await state(page);
        maxOut = Math.max(maxOut, s.out);
        if (label === 'full') console.log(preset, at, JSON.stringify(s));
        if (at === 90) {
          expect(s.kind).toBe('check');
          expect(s.shown).toBe(rounds);
        }
      }
      // Release: back in, seat, tug, hands back on the gun.
      if (label === 'full')
        for (const at of [12, 24, 36, 60]) {
          await run(page, at - (f - 130), null, true);
          f = 130 + at;
          await page.screenshot({ path: `${dir}/${label}-${String(f).padStart(3, '0')}.png` });
        }
      await run(page, 150, null, false);
      const s = await state(page);
      expect(s.kind).toBe('idle');
      expect(s.out).toBeLessThan(1e-4);
      if (label === 'full') expect(maxOut).toBeGreaterThan(0.08);
    }
    expect(errors).toEqual([]);
  });
