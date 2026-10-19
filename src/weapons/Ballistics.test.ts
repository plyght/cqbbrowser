import { beforeAll, describe, expect, test } from 'bun:test';
import { Vector3 } from 'three';
import { Bus, type GameEvents } from '../core/bus';
import type { Context } from '../core/Context';
import { Physics } from '../physics/Physics';
import { Ballistics } from './Ballistics';
import { BASE_WEAPONS, WEAPONS, type WeaponDef } from './defs';

/** Headless router tests on a real Rapier world: walls, steel, the berm, scheduled long-range impacts. */

let physics: Physics;
beforeAll(async () => {
  physics = new Physics();
  await physics.init();
  // Interior wall at z = -5 (2× 12 mm ply on studs, 115 mm thick), steel plate at z = -10, berm far away.
  physics.box(
    { x: 0, y: 1.2, z: -5 },
    { x: 3, y: 1.2, z: 0.0575 },
    { surface: 'plywood', penetrable: 0.024 },
  );
  physics.box(
    { x: 0, y: 1.2, z: -10 },
    { x: 0.3, y: 0.3, z: 0.005 },
    { surface: 'steel_target', targetId: 's' },
  );
  physics.box({ x: 4, y: 1.2, z: -80 }, { x: 1, y: 1, z: 0.5 }, { surface: 'berm' });
  physics.box({ x: 0, y: -0.5, z: 0 }, { x: 200, y: 0.5, z: 200 }, { surface: 'concrete' });
  physics.world.step();
});

function rig() {
  const bus = new Bus();
  const ctx = { physics, bus, tick: 100 } as unknown as Context;
  const b = new Ballistics(ctx, () => undefined);
  const impacts: GameEvents['impact'][] = [];
  bus.on('impact', (e) => impacts.push(e));
  const fire = (weaponId: string, from: Vector3, to: Vector3, def?: WeaponDef) => {
    const s: GameEvents['shot'] = {
      weaponId,
      origin: from,
      dir: to.clone().sub(from).normalize(),
      suppressed: false,
      caliber: '',
      def,
    };
    bus.emit('shot', s);
    return s;
  };
  return { b, bus, ctx, impacts, fire };
}

describe('Ballistics router', () => {
  test('9 mm through a kill-house wall, then rings steel; payload filled', () => {
    const { b, impacts, fire } = rig();
    const s = fire('p17', new Vector3(0, 1.2, 0), new Vector3(0, 1.2, -10));
    expect(s.recoil?.impulseNs).toBeGreaterThan(2.5);
    expect(s.subsonic).toBe(false);
    expect(s.muzzleVelocity).toBe(WEAPONS.p17.velocity);
    const kinds = impacts.map((e) => `${e.surface}${e.exit ? ':exit' : ''}`);
    expect(kinds).toEqual(['plywood', 'plywood:exit', 'steel_target']);
    // Exit is on the far face of the wall; speed drops a little.
    expect(impacts[1].point.z).toBeCloseTo(-5.0575, 2);
    expect(impacts[2].speed!).toBeLessThan(impacts[0].speed!);
    expect(impacts[2].speed!).toBeGreaterThan(0.8 * impacts[0].speed!);
    const t = b.traces().at(-1)!;
    expect(t.events.map((e) => e.kind)).toContain('steel');
  });

  test('deterministic: same tick → same impacts', () => {
    const a = rig(),
      c = rig();
    for (const r of [a, c]) r.fire('sb16', new Vector3(0.1, 1.3, 0), new Vector3(0, 1.2, -10));
    expect(a.impacts.map((e) => e.point.toArray())).toEqual(c.impacts.map((e) => e.point.toArray()));
  });

  test('rounds hit low close in (sight over bore), zero lifts them by 50 m', () => {
    const { impacts, fire } = rig();
    // Aim the sight line dead level at the wall 5 m away: lands ~sight height low relative to the line.
    fire('sb16', new Vector3(2, 1.2, 0), new Vector3(2, 1.2, -5));
    const y = impacts[0].point.y;
    expect(y - 1.2).toBeGreaterThan(-0.002); // starts at bore height, rises on the zero angle…
    expect(y - 1.2).toBeLessThan(0.012); // …by ~1.7 mrad × 5 m ≈ 9 mm: still ~6 cm under the sight line
  });

  test('beyond 50 m the impact waits for its time of flight', () => {
    const { b, ctx, impacts, fire } = rig();
    fire('p17', new Vector3(4, 1.2, 0), new Vector3(4, 1.3, -80));
    expect(impacts.length).toBe(0);
    let ticks = 0;
    while (!impacts.length && ticks < 60) {
      ctx.tick++;
      b.fixedUpdate(1 / 60);
      ticks++;
    }
    expect(impacts[0]?.surface).toBe('berm');
    // ~80 m at ~330 m/s ≈ 0.24 s ≈ 14–15 ticks.
    expect(ticks).toBeGreaterThan(11);
    expect(ticks).toBeLessThan(19);
  });

  test('buckshot: 9 pellets, a pattern, each with its own trajectory', () => {
    const { impacts, fire } = rig();
    const pm12: WeaponDef = {
      ...BASE_WEAPONS.p17,
      id: 'pm12',
      slot: 'primary',
      caliber: '12ga',
      velocity: 395,
      bulletMass: 31.4,
      pellets: 9,
      spreadMoa: 2,
      mass: 3.4,
      sightHeight: 0.025,
      barrelLength: 18.5 * 0.0254,
      model: 'test:pm12',
      build: undefined,
    };
    fire('pm12', new Vector3(-1, 1.2, 0), new Vector3(-1, 1.2, -5), pm12);
    const entries = impacts.filter((e) => !e.exit && e.surface === 'plywood');
    expect(entries.length).toBe(9);
    const xs = entries.map((e) => e.point.x);
    const spread = Math.max(...xs) - Math.min(...xs);
    expect(spread).toBeGreaterThan(0.01); // 5 m, cylinder bore: a few cm
    expect(spread).toBeLessThan(0.25);
  });

  test('shallow shot skips off the concrete floor', () => {
    const { b, fire } = rig();
    fire('p17', new Vector3(-6, 0.6, 0), new Vector3(-6, 0, -8));
    const t = b.traces().at(-1)!;
    expect(t.events[0].kind).toBe('ricochet');
  });
});
