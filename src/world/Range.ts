import { Vector3 } from 'three';
import { berm, floor, signBoard, type Facility, type FacilityEnv } from './facility';
import { Gong } from './steel/Gong';
import { makePopper } from './steel/Knockdown';
import { PaperTarget } from './targets';

/** Firing line z (front edge of the covered concrete pad); distances are measured from here. */
export const RANGE_LINE_Z = 6;
const BAYS = [-16.75, 0, 16.75];

/**
 * Outdoor square range (3–50 m): three bays split by gravel-filled baffle walls, a covered concrete
 * firing line, shaped dirt berms, distance stakes, signage and a range flag.
 */
export function buildRange(env: FacilityEnv): Facility {
  const { batch, mats, signs } = env;
  const line = RANGE_LINE_Z;

  floor(batch, mats.gravel, 0, -17, 58, 64);
  // Concrete firing-line pad + painted line.
  batch.box(mats.concrete, 0, 0, 9, 52, 0.06, 6, { tag: { surface: 'concrete' } });
  batch.box(mats.paintYellow, 0, 0.06, line + 0.1, 52, 0.002, 0.1);

  // Berms: back stop (7 m) and side berms.
  berm(env, 0, -53, 76, 14, 7, 3, 0, 1);
  berm(env, -31.5, -19, 68, 10, 4.5, 2, Math.PI / 2, 2);
  berm(env, 31.5, -19, 68, 10, 4.5, 2, Math.PI / 2, 3);

  // Bay baffles: double plywood skins on 4x4 posts, gravel-filled (stop rounds).
  for (const x of [-8.5, 8.5]) {
    const z0 = -4,
      z1 = line + 0.4;
    const len = z1 - z0;
    const zc = (z0 + z1) / 2;
    batch.box(mats.plywood, x, 0, zc, 0.3, 2.4, len, {
      cast: true,
      tag: { surface: 'plywood' },
    });
    batch.box(mats.lumber, x, 2.4, zc, 0.34, 0.06, len + 0.04, { cast: true });
    for (let z = z0; z <= z1 + 0.01; z += len / 4) {
      for (const s of [-1, 1]) batch.box(mats.lumber, x + s * 0.19, 0, z, 0.09, 2.46, 0.09);
    }
  }

  // Covered firing line: posts, beams, galvanised roof sloping back.
  const roofFront = line + 0.6,
    roofBack = 12.4;
  for (const x of [-25.5, -8.5, 8.5, 25.5]) {
    batch.box(mats.lumber, x, 0.06, roofFront, 0.14, 3.0, 0.14, { cast: true, tag: { surface: 'wood' } });
    batch.box(mats.lumber, x, 0.06, roofBack, 0.14, 2.7, 0.14, { cast: true, tag: { surface: 'wood' } });
  }
  batch.box(mats.lumber, 0, 2.9, roofFront, 52, 0.2, 0.1, { cast: true });
  batch.box(mats.lumber, 0, 2.6, roofBack, 52, 0.2, 0.1, { cast: true });
  const roofLen = Math.hypot(roofBack - roofFront, 0.3) + 0.6;
  batch.box(mats.galvanized, 0, 2.93, (roofFront + roofBack) / 2, 53, 0.03, roofLen, {
    cast: true,
    pitch: Math.atan2(0.3, roofBack - roofFront),
  });

  // Shooting tables and bench rest per bay.
  for (const bx of BAYS) {
    const tx = bx - 1.5,
      tz = line + 1.2;
    batch.box(mats.plywood, tx, 0.86, tz, 1.2, 0.04, 0.6, { cast: true, tag: { surface: 'wood' } });
    for (const sx of [-0.55, 0.55])
      for (const sz of [-0.25, 0.25]) batch.box(mats.lumber, tx + sx, 0.06, tz + sz, 0.07, 0.8, 0.07);
  }

  // Distance stakes on the left of each bay (3–25 m; 50 m in bay 3).
  for (const [i, bx] of BAYS.entries()) {
    const sx = bx - 7.6;
    const dists = i === 2 ? [3, 5, 7, 10, 15, 25, 50] : [3, 5, 7, 10, 15, 25];
    for (const d of dists) {
      signBoard(
        env,
        { lines: [`${d}`], bg: '#f4f1e6', fg: '#b3201b', px: [96, 64], border: '#222' },
        new Vector3(sx, 0, line - d),
        0.3,
        0.2,
        0,
        0.45,
      );
    }
    // Bay boards on the inside face of the left baffle.
    signBoard(
      env,
      {
        lines: [`BAY ${i + 1}`, i === 2 ? 'RIFLE · 3–50 M' : 'PISTOL / CARBINE · 3–25 M'],
        bg: '#1f3b63',
        fg: '#f4f1e6',
        px: [256, 128],
      },
      new Vector3(bx - 7.2, 0, line - 1.2),
      0.9,
      0.45,
      Math.PI / 2 - 0.35,
      1.1,
    );
  }

  // Rules board behind the line and the facility sign.
  signBoard(
    env,
    {
      lines: [
        'AXIS-7 SECURITY TRAINING CENTER',
        'RANGE 1 · SQUARE RANGE',
        'EYE & EAR PROTECTION REQUIRED',
        'COLD RANGE UNTIL RSO CALLS HOT',
      ],
      bg: '#efece2',
      fg: '#1a1a1a',
      px: [512, 256],
      border: '#b3201b',
    },
    new Vector3(4, 0, 14.5),
    2.2,
    1.1,
    Math.PI,
    1.0,
  );

  // Range flag (hot).
  batch.box(mats.galvanized, 28.4, 0, 9, 0.06, 6, 0.06, { cast: true });
  signs.place(
    batch,
    { lines: [], bg: '#c0201a', px: [96, 64] },
    new Vector3(28.95, 5.6, 9),
    1.0,
    0.65,
    0,
    true,
  );

  // --- Targets ---
  // Bay 2: papers at 7 m, poppers at 14 m, steel at 18/26 m.
  for (const [k, x] of [-2, 0, 2].entries())
    new PaperTarget(env, `range.b2.p${k}`, new Vector3(x, 0, 8 - 7), 0); // 7 m from the bay 2 spawn
  for (const [k, x] of [-4, -2, 0, 2, 4].entries())
    makePopper(env, `range.b2.popper${k}`, new Vector3(x, 0, -6));
  new Gong(env, 'range.b2.gong0', new Vector3(-5.5, 0, -12), { w: 0.3 });
  new Gong(env, 'range.b2.gong1', new Vector3(5.5, 0, -12), { w: 0.25, round: false });
  new Gong(env, 'range.b2.gong2', new Vector3(0, 0, -20), { w: 0.45, thicknessMm: 12, hookY: 1.7 });

  // Bay 1: El Presidente — three papers 1 m apart, 9 m from the line.
  for (const [k, dx] of [-1, 0, 1].entries())
    new PaperTarget(env, `range.b1.p${k}`, new Vector3(BAYS[0] + dx, 0, 8 - 9.1), 0);

  // Bay 3: long line — 15 / 25 m paper, 50 m gong.
  new PaperTarget(env, 'range.b3.p15', new Vector3(BAYS[2] - 1, 0, 8 - 15), 0);
  new PaperTarget(env, 'range.b3.p25', new Vector3(BAYS[2] + 1.5, 0, 8 - 25), 0);
  new Gong(env, 'range.b3.gong50', new Vector3(BAYS[2], 0, line - 50), {
    w: 0.5,
    thicknessMm: 12,
    hookY: 1.8,
  });

  const spawn = (x: number, yaw = 0) => ({ pos: new Vector3(x, 0.06, 8), yaw });
  return {
    id: 'range',
    name: 'Square Range',
    group: env.parent as never,
    spawns: {
      'range.bay2': spawn(0),
      'range.bay1': spawn(BAYS[0]),
      'range.bay1.uprange': spawn(BAYS[0], Math.PI),
      'range.bay3': spawn(BAYS[2]),
    },
    defaultSpawn: 'range.bay2',
  };
}
