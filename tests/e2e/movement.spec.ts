/* eslint-disable @typescript-eslint/no-explicit-any */
import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { boot, play } from './helpers';

/**
 * Movement feel (chest cam + gun): gait bob / sway / bumps recorded as frame sequences and per-frame traces.
 *
 * `MOVE_OUT=<dir>` writes `<dir>/<clip>/f0000.png ...` and `<dir>/<clip>.json` (camera and gun offsets per sim frame)
 * for `tools/` plots and ffmpeg; without it the spec only asserts on the traces (no screenshots).
 */
const OUT = process.env.MOVE_OUT;
/** `MOVE_MOUNT=helmet` records the helmet cam; `MOVE_ONLY=walk,sprint` limits the evidence clips. */
const MOUNT = process.env.MOVE_MOUNT;
const ONLY = process.env.MOVE_ONLY?.split(',');

type Input = { move?: { x: number; y: number }; look?: { yaw: number; pitch: number }; down?: string[] };

interface Clip {
  name: string;
  preset: 'sb16_cqb' | 'p17_std';
  frames: number;
  /** Input for sim frame `i` (undefined = idle). */
  input: (i: number) => Input | undefined;
  /** World pose to start from (default: the spawn). */
  from?: { x: number; z: number; yaw: number; y?: number };
  /** Render (and save) every n-th sim frame. */
  every?: number;
}

const FWD = { move: { x: 0, y: 1 } };
const clips = (preset: Clip['preset']): Clip[] => {
  const tag = preset === 'sb16_cqb' ? 'rifle' : 'pistol';
  // The open lane at x = 4 runs 55 m toward -z (yaw 0 faces -z).
  const lane = { x: 4, z: 12, yaw: 0 };
  return [
    { name: `walk-${tag}`, preset, frames: 150, input: () => FWD, from: lane },
    { name: `sprint-${tag}`, preset, frames: 150, input: () => ({ ...FWD, down: ['sprint'] }), from: lane },
    {
      name: `strafe-${tag}`,
      preset,
      frames: 180,
      input: (i) => ({ move: { x: i < 90 ? 1 : -1, y: 0 } }),
      from: lane,
    },
    {
      name: `startstop-${tag}`,
      preset,
      frames: 180,
      input: (i) =>
        i < 20 || (i >= 80 && i < 100) || i >= 160 ? undefined : i < 80 ? FWD : { ...FWD, down: ['sprint'] },
      from: lane,
    },
    {
      name: `turn-${tag}`,
      preset,
      frames: 150,
      input: (i) => ({
        look: { yaw: i < 30 ? 0 : i < 60 ? 0.035 : i < 90 ? 0 : i < 120 ? -0.045 : 0, pitch: 0 },
      }),
      from: lane,
    },
    {
      name: `crouchwalk-${tag}`,
      preset,
      frames: 150,
      input: (i) => ({ ...FWD, down: i === 0 ? ['crouch'] : [] }),
      from: lane,
    },
    { name: `adswalk-${tag}`, preset, frames: 150, input: () => ({ ...FWD, down: ['aim'] }), from: lane },
    { name: `land-${tag}`, preset, frames: 120, input: () => undefined, from: { ...lane, y: 1.3 } },
  ];
};

async function start(page: Page) {
  if (MOUNT)
    await page.addInitScript((m) => {
      localStorage.setItem('shortbarrel.settings.v1', JSON.stringify({ camera: { mount: m } }));
    }, MOUNT);
  const errors = await boot(page);
  await page.setViewportSize({ width: 960, height: 540 });
  await page.evaluate(() => ((window as any).__sb.renderer.dynres.enabled = false));
  await play(page);
  await page
    .waitForFunction(() => !!(window as any).__sb.weapons.rig, null, { timeout: 60_000 })
    .catch(() => {});
  return errors;
}

/** Run one clip: step `frames` sim frames, screenshot the rendered ones, return the per-frame trace. */
async function record(page: Page, c: Clip) {
  await page.evaluate(
    ([preset, from]) => {
      const g = (window as any).__sb;
      const w = g.weapons;
      const slot = (preset as string).startsWith('p17') ? 1 : 0;
      w.setPreset(slot, preset);
      if (w.loadout[slot] !== w.equipped) w.equipNow(slot);
      const f = from as any;
      g.player.crouchToggle = false;
      g.player.crouch = 0;
      g.player.teleport(new g.player.position.constructor(f.x, 0.02, f.z), f.yaw);
      g.player.ready = 'high';
    },
    [c.preset, c.from ?? { x: 4, z: 12, yaw: 0 }] as const,
  );
  // Settle on the ground (and let auto-exposure adapt: it only adapts on rendered frames), then drop in if asked.
  await page.evaluate(
    ([render, y]) => {
      const g = (window as any).__sb;
      for (let i = 0; i < 70; i++) g.step(1 / 60, (render as boolean) && i > 8);
      if (y) g.player.teleport(g.player.position.clone().setY(y as number), g.player.yaw);
    },
    [!!OUT, c.from?.y ?? 0] as const,
  );
  const every = c.every ?? 2;
  const trace: number[][] = [];
  for (let i = 0; i < c.frames; i++) {
    const row = await page.evaluate(
      ([input, render]) => {
        const g = (window as any).__sb;
        g.test.next = structuredClone(input ?? {});
        g.step(1 / 60, render as boolean);
        g.test.next = {};
        const p = g.player;
        const cam = g.ctx.camera;
        const q = cam.quaternion;
        const e = new (cam.rotation.constructor as any)(0, 0, 0, 'YXZ').setFromQuaternion(q);
        const view = g.weapons.view;
        view.updateMatrixWorld(true);
        // Gun grip in the camera frame (m) and its attitude relative to the camera (rad).
        const local = view.position.clone();
        cam.worldToLocal(local);
        const rel = q.clone().invert().multiply(view.quaternion);
        const er = new (cam.rotation.constructor as any)(0, 0, 0, 'YXZ').setFromQuaternion(rel);
        // Camera in the body frame: height over the feet, lateral/forward offsets from the capsule axis.
        const dx = cam.position.x - p.feet.x,
          dz = cam.position.z - p.feet.z;
        const lat = dx * Math.cos(p.yaw) - dz * Math.sin(p.yaw);
        const fwd = -dx * Math.sin(p.yaw) - dz * Math.cos(p.yaw);
        return [
          g.ctx.time,
          p.speed,
          cam.position.y - p.feet.y,
          lat,
          fwd,
          e.x - p.pitch,
          e.y - p.yaw,
          e.z,
          local.x,
          local.y,
          local.z,
          er.x,
          er.y,
          er.z,
          p.gaitPhase,
          g.weapons.adsBlend,
          p.grounded ? 1 : 0,
          p.feet.y,
          cam.position.y,
        ];
      },
      [c.input(i) ?? null, !!OUT && i % every === every - 1] as const,
    );
    trace.push(row);
    if (OUT && i % every === every - 1) {
      const dir = `${OUT}/${c.name}`;
      if (i === every - 1) mkdirSync(dir, { recursive: true });
      await page.screenshot({ path: `${dir}/f${String(Math.floor(i / every)).padStart(4, '0')}.png` });
    }
  }
  const dir = OUT ?? 'test-results/movement';
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/${c.name}.json`, JSON.stringify(trace));
  return trace;
}

const COL = {
  t: 0,
  speed: 1,
  camY: 2,
  camX: 3,
  camZ: 4,
  pitch: 5,
  yaw: 6,
  roll: 7,
  gunX: 8,
  gunY: 9,
  gunZ: 10,
};
const pp = (xs: number[]) => Math.max(...xs) - Math.min(...xs);
const col = (t: number[][], k: keyof typeof COL, from = 0) => t.slice(from).map((r) => r[COL[k]]);
/** Largest frame-to-frame change of a column. */
const maxStep = (xs: number[]) => Math.max(...xs.slice(1).map((x, i) => Math.abs(x - xs[i])));

test('movement: walk and sprint bob, no discontinuities, rifle and pistol', async ({ page }) => {
  test.setTimeout(OUT ? 900_000 : 120_000);
  const errors = await start(page);
  const rows: string[] = [];
  for (const preset of ['sb16_cqb', 'p17_std'] as const) {
    const [walk, sprint] = clips(preset);
    const w = await record(page, { ...walk, frames: 120 });
    const s = await record(page, { ...sprint, frames: 120 });
    // Chest camera height: 2–4 cm walking, 5–8 cm sprinting (after the start-up, 1.2 s in).
    const wy = pp(col(w, 'camY', 70));
    const sy = pp(col(s, 'camY', 70));
    rows.push(`${preset} walk camY pp ${(wy * 100).toFixed(1)} cm, sprint ${(sy * 100).toFixed(1)} cm`);
    expect(wy).toBeGreaterThan(0.018);
    expect(wy).toBeLessThan(0.05);
    expect(sy).toBeGreaterThan(0.045);
    expect(sy).toBeLessThan(0.1);
    // The camera never jumps: < 1.5 cm and < 1.5 deg per frame, start to sprint.
    for (const t of [w, s]) {
      expect(maxStep(col(t, 'camY'))).toBeLessThan(0.015);
      expect(maxStep(col(t, 'roll'))).toBeLessThan(0.026);
      expect(maxStep(col(t, 'pitch'))).toBeLessThan(0.026);
    }
    // The gun is not locked to the camera: it moves in the camera's frame while walking.
    expect(pp(col(w, 'gunY', 70))).toBeGreaterThan(0.004);
  }
  console.log(rows.join('\n'));
  expect(errors).toEqual([]);
});

test('movement: ADS-walk is quiet next to hip-fire walk', async ({ page }) => {
  test.setTimeout(OUT ? 900_000 : 120_000);
  const errors = await start(page);
  for (const preset of ['sb16_cqb', 'p17_std'] as const) {
    const c = clips(preset);
    const hip = await record(page, { ...c[0], frames: 120 });
    const ads = await record(page, c[6]);
    const h = pp(col(hip, 'gunY', 70));
    const a = pp(col(ads, 'gunY', 90));
    const hr = pp(col(hip, 'roll', 70));
    const ar = pp(col(ads, 'roll', 90));
    console.log(
      `${preset} gunY pp hip ${(h * 100).toFixed(2)} cm vs ADS ${(a * 100).toFixed(2)} cm; roll ${hr.toFixed(4)} vs ${ar.toFixed(4)}`,
    );
    expect(a).toBeLessThan(h * 0.5);
    expect(ar).toBeLessThan(hr * 0.5);
    // Still alive: a small step bump reaches the sight picture.
    expect(pp(col(ads, 'camY', 90))).toBeGreaterThan(0.0003);
  }
  expect(errors).toEqual([]);
});

test('movement: the chest camera stays out of the wall when walking into it looking down', async ({
  page,
}) => {
  const errors = await start(page);
  const gaps = await page.evaluate(() => {
    const g = (window as any).__sb;
    const V = g.player.position.constructor;
    const out: number[] = [];
    for (const pitch of [0, -1.0, -1.45, 1.2]) {
      // The wall across the start lane (z = 1): walk into it, then sprint into it.
      g.player.teleport(new V(0, 0.02, 3), 0);
      g.player.pitch = pitch;
      let gap = 9;
      for (let i = 0; i < 150; i++) {
        g.test.next = { move: { x: 0, y: 1 }, down: i > 70 ? ['sprint'] : [] };
        g.step(1 / 60, false);
        g.player.pitch = pitch;
        const hit = g.ctx.physics.raycast(
          g.ctx.camera.position.clone().setY(1.2),
          new V(0, 0, -1),
          5,
          g.player.rigidBody,
        );
        if (hit) gap = Math.min(gap, hit.distance);
      }
      g.test.next = {};
      out.push(gap);
    }
    return out;
  });
  console.log('camera-to-wall gaps (m) at pitch 0/-1/-1.45/+1.2:', gaps.map((x) => x.toFixed(3)).join(' '));
  // The near plane is 3 cm: the camera never gets closer than 6 cm to the wall.
  for (const gap of gaps) expect(gap).toBeGreaterThan(0.06);
  expect(errors).toEqual([]);
});

test('movement: shoulders catch on a wall brushed while walking, and a stair-less landing dips the camera', async ({
  page,
}) => {
  const errors = await start(page);
  const r = await page.evaluate(() => {
    const g = (window as any).__sb;
    const V = g.player.position.constructor;
    const bumps: { kind: string; side: number; strength: number; f: number }[] = [];
    let f = 0;
    g.ctx.bus.on('bodyBump', (e: any) => bumps.push({ ...e, f }));
    // The side wall at x = 8.35 runs along -z there: walk down it pressing into it with the right shoulder.
    g.player.teleport(new V(7.9, 0.02, -1), 0);
    for (f = 0; f < 150; f++) {
      g.test.next = { move: { x: 0.35, y: 1 } };
      g.step(1 / 60, false);
    }
    g.test.next = {};
    const brush = bumps.filter((b) => b.kind === 'wall');
    // Drop 1.3 m: the camera dips on touchdown and the land bump reaches the gun.
    g.player.teleport(new V(4, 1.3, 12), 0);
    const ys: number[] = [];
    bumps.length = 0;
    for (let i = 0; i < 90; i++) {
      g.step(1 / 60, false);
      ys.push(g.ctx.camera.position.y - g.player.feet.y);
    }
    return {
      brush: brush.length,
      side: brush[0]?.side,
      land: bumps.filter((b) => b.kind === 'land').length,
      dip: Math.max(...ys.slice(-30)) - Math.min(...ys),
    };
  });
  console.log(JSON.stringify(r));
  expect(r.brush).toBeGreaterThan(1);
  expect(r.side).toBe(1);
  expect(r.land).toBe(1);
  expect(r.dip).toBeGreaterThan(0.03);
  expect(errors).toEqual([]);
});

if (OUT) {
  for (const preset of ['sb16_cqb', 'p17_std'] as const) {
    test(`movement evidence: ${preset}`, async ({ page }) => {
      test.setTimeout(1_800_000);
      const errors = await start(page);
      for (const c of clips(preset)) {
        if (ONLY && !ONLY.some((o) => c.name.startsWith(o))) continue;
        await record(page, MOUNT ? { ...c, name: `${c.name}-${MOUNT}` } : c);
      }
      expect(errors).toEqual([]);
    });
  }
}
