/* eslint-disable @typescript-eslint/no-explicit-any */
import { expect, test, type Page } from '@playwright/test';
import { boot, play } from './helpers';

/**
 * Pistol firing trace (owner report: "stuttering and glitching when I shoot the pistol"). Fires 30 P17 shots in
 * manual stepping, rendering every frame, and records per frame: the sim step and render times, per-system update
 * times, the hand-contact solver cost, newly compiled GL programs, and the support hand / firing hand / gun world
 * positions. Jitter is the second difference of each position in the camera frame and in the gun frame (mm per
 * frame²): a smooth recoil curve has a small one, a hand that snaps between two poses frame to frame has a large one.
 */

export interface Trace {
  step: number[];
  render: number[];
  contact: number[];
  sys: Record<string, number[]>;
  programs: number[];
  /** Names of the GL programs compiled after the first shot. */
  newPrograms: string[];
  calls: number[];
  shots: number[];
  /** Positions (m): support hand / firing hand / gun, camera frame and support hand in the gun frame. */
  L: number[][];
  R: number[][];
  G: number[][];
  LG: number[][];
}

export async function fireTrace(page: Page, shots = 30, every = 12, adsFrames = 30): Promise<Trace> {
  return page.evaluate(
    ([shots, every, adsFrames]) => {
      const g = (window as any).__sb;
      const w = g.weapons;
      const tr: Trace = {
        step: [],
        render: [],
        contact: [],
        sys: {},
        programs: [],
        newPrograms: [],
        calls: [],
        shots: [],
        L: [],
        R: [],
        G: [],
        LG: [],
      };
      // Per-system update timings.
      const names = ['Player', 'Weapons', 'Ballistics', 'World', 'Drills', 'Fx', 'Gear'];
      const timed: [string, any][] = g.systems.map((s: any, i: number) => [names[i] ?? `sys${i}`, s]);
      timed.push(['Audio', g.audio], ['Haptics', g.haptics], ['Hud', g.hud]);
      for (const [n, s] of timed) {
        if (!s.update) continue;
        const orig = s.update.bind(s);
        tr.sys[n] = [];
        s.__t = 0;
        s.update = (...a: unknown[]) => {
          const t0 = performance.now();
          orig(...a);
          s.__t = performance.now() - t0;
        };
      }
      const rend = g.renderer;
      const info = rend.renderer.info;
      const THREE_V = (rend.camera.position.constructor as any).prototype.constructor;
      const v = new THREE_V();
      const inv = rend.camera.matrixWorld.clone();
      const gunInv = rend.camera.matrixWorld.clone();
      const rec = (out: number[][], o: any, m: any) => {
        o.getWorldPosition(v);
        v.applyMatrix4(m);
        out.push([v.x, v.y, v.z]);
      };
      const total = adsFrames + shots * every + 30;
      for (let i = 0; i < total; i++) {
        const k = i - adsFrames;
        const fire = k >= 0 && k < shots * every && k % every < 2;
        if (fire && k % every === 0) tr.shots.push(i);
        g.test.next = { down: fire ? ['aim', 'fire'] : ['aim'] };
        const p0 = info.programs?.length ?? 0;
        const t0 = performance.now();
        g.step(1 / 60, false);
        const t1 = performance.now();
        rend.render(0);
        const t2 = performance.now();
        tr.step.push(t1 - t0);
        tr.render.push(t2 - t1);
        tr.programs.push((info.programs?.length ?? 0) - p0);
        tr.calls.push(info.render.calls);
        if (k >= 0)
          for (const pr of (info.programs ?? []).slice(p0))
            tr.newPrograms.push(`${i}:${pr.name}:${pr.cacheKey.slice(0, 60)}`);
        tr.contact.push(w.contact?.enabled ? w.contact.stats.ms : 0);
        for (const [n, s] of timed) if (s.update) tr.sys[n]?.push(s.__t);
        inv.copy(rend.camera.matrixWorld).invert();
        const rig = w.rig;
        rec(tr.L, rig.bones.handL, inv);
        rec(tr.R, rig.bones.handR, inv);
        rec(tr.G, w.equipped.model.root, inv);
        gunInv.copy(w.equipped.model.root.matrixWorld).invert();
        rec(tr.LG, rig.bones.handL, gunInv);
      }
      g.test.next = {};
      return tr;
    },
    [shots, every, adsFrames] as const,
  );
}

const pct = (a: number[], p: number) => {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
};

/** Max second difference (mm/frame²) of a position track over frames [a, b). */
export function jitter(track: number[][], a = 0, b = track.length): number {
  let m = 0;
  for (let i = Math.max(1, a); i < Math.min(b, track.length) - 1; i++) {
    const d = [0, 1, 2].map((k) => track[i + 1][k] - 2 * track[i][k] + track[i - 1][k]);
    m = Math.max(m, Math.hypot(...d) * 1000);
  }
  return m;
}

export function summarise(tr: Trace, label: string) {
  const a = tr.shots[0] - 2;
  const fr = tr.step.slice(a);
  const sum = fr.map((s, i) => s + tr.render[a + i]);
  const out = {
    label,
    stepP99: pct(fr, 0.99),
    stepMax: Math.max(...fr),
    frameP99: pct(sum, 0.99),
    frameMax: Math.max(...sum),
    contactMean: tr.contact.slice(a).reduce((x, y) => x + y, 0) / fr.length,
    contactMax: Math.max(...tr.contact.slice(a)),
    programsAfterFirstShot: tr.programs.slice(tr.shots[0]).reduce((x, y) => x + y, 0),
    newPrograms: tr.newPrograms,
    jitterL: jitter(tr.L, a),
    jitterR: jitter(tr.R, a),
    jitterG: jitter(tr.G, a),
    jitterLinGun: jitter(tr.LG, a),
    sysMax: Object.fromEntries(
      Object.entries(tr.sys).map(([n, s]) => [n, +Math.max(...s.slice(a)).toFixed(2)]),
    ),
    sysP99: Object.fromEntries(
      Object.entries(tr.sys).map(([n, s]) => [n, +pct(s.slice(a), 0.99).toFixed(2)]),
    ),
  };
  console.log(JSON.stringify(out, (_k, x) => (typeof x === 'number' ? +x.toFixed(3) : x)));
  return out;
}

async function bootPistol(page: Page, q: string) {
  // Small viewport: SwiftShader renders every frame of the trace.
  await page.setViewportSize({ width: 320, height: 180 });
  const errors = await boot(page, `/${q}`);
  await page.evaluate(() => ((window as any).__sb.renderer.dynres.enabled = false));
  await play(page);
  await page.waitForFunction(() => !!(window as any).__sb.weapons.rig, null, { timeout: 90_000 });
  await page.evaluate(() => {
    const g = (window as any).__sb;
    g.weapons.equipNow(1);
    for (let i = 0; i < 60; i++) g.step(1 / 60, i >= 57);
  });
  return errors;
}

test('pistol: 30 shots, contact on vs ?handcontact=off — frame times, hand jitter, no shader compile', async ({
  page,
}) => {
  test.setTimeout(400_000);
  const errors = await bootPistol(page, '?handcontact=off');
  const off = summarise(await fireTrace(page), 'handcontact=off');
  const errors2 = await bootPistol(page, '');
  const tr = await fireTrace(page);
  const on = summarise(tr, 'default (pistol contact safe)');
  if (process.env.TRACE_OUT) {
    const { writeFileSync } = await import('node:fs');
    writeFileSync(process.env.TRACE_OUT, JSON.stringify(tr));
  }
  expect(errors).toEqual([]);
  expect(errors2).toEqual([]);
  void off;
  void on;
});
