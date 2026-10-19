import type {
  BarrelPart,
  FinishPart,
  LightPart,
  MagazinePart,
  MuzzlePart,
  OpticPart,
  SlidePart,
} from '../../attachments/types';
import type { Ctx } from '../core';
import { boxZ, cylZ, lathe, profile, rbox, shape, xform, type P2 } from '../geom';
import { buildMuzzle, deg, gripProfile } from './common';
import { rmr } from './optics';

/** P-17: polymer-frame striker pistol, 9 mm. Origin at the web of the hand, bore at y = B. */
const SLIDE_TOP = 0.046;
const SLIDE_BOT = 0.0165;
const SLIDE_REAR = 0.028;
const SLIDE_FRONT = -0.158;
const GRIP_ANGLE = 21 * deg;
const GRIP_TOP: P2 = [0.004, -0.028];

export function buildGlock(c: Ctx) {
  slide(c);
  frame(c);
  magazine(c);
  pistolLight(c);
}

function gripMat(c: Ctx) {
  const f = (c.r.parts.finish as FinishPart | undefined)?.finish ?? 'black';
  return f === 'fde' ? c.M.polymerFdeGrip : f === 'od' ? c.M.finish.od : c.M.polymerGrip;
}

function frameMat(c: Ctx) {
  const f = (c.r.parts.finish as FinishPart | undefined)?.finish ?? 'black';
  return f === 'fde' ? c.M.polymerFde : f === 'od' ? c.M.finish.od : c.M.polymer;
}

function slide(c: Ctx) {
  const { M, B, l } = c;
  const col = c.part('slide', [0, 0, 0]);
  const steel = M.phosphate;
  const sp = c.r.parts.slide as SlidePart;
  const pts: P2[] = [
    [SLIDE_REAR, SLIDE_BOT],
    [SLIDE_REAR, SLIDE_TOP - 0.002],
    [SLIDE_REAR - 0.003, SLIDE_TOP],
    [SLIDE_FRONT + 0.006, SLIDE_TOP],
    [SLIDE_FRONT, SLIDE_TOP - 0.006],
    [SLIDE_FRONT, SLIDE_BOT + 0.003],
    [SLIDE_FRONT + 0.003, SLIDE_BOT],
  ];
  // Core slide (inset 0.8 mm per side) + side skins with real serration windows and bevelled ridges.
  const W = 0.0255,
    SK = 0.0008;
  col.add(profile(shape(pts), W - 2 * SK, 0.0028), steel);
  const y0 = SLIDE_BOT + 0.0006,
    y1 = SLIDE_TOP - 0.003;
  const wy0 = SLIDE_BOT + 0.0028,
    wy1 = SLIDE_TOP - 0.0052;
  const slant = 0.0022; // tops of the serrations lean forward
  const windows: [number, number][] = [
    [0.0255, 0.0025],
    [-0.111, -0.134],
  ];
  const win = (za: number, zb: number): P2[] => [
    [za, wy0],
    [za - slant, wy1],
    [zb - slant, wy1],
    [zb, wy0],
  ];
  const skinOuter: P2[] = [
    [SLIDE_REAR - 0.0004, y0],
    [SLIDE_REAR - 0.0004, y1],
    [SLIDE_FRONT + 0.0045, y1],
    [SLIDE_FRONT + 0.0004, y1 - 0.004],
    [SLIDE_FRONT + 0.0004, y0 + 0.002],
    [SLIDE_FRONT + 0.002, y0],
  ];
  for (const sx of [-1, 1]) {
    const x = sx * (W / 2 - SK / 2);
    col.add(
      profile(
        shape(
          skinOuter,
          windows.map(([a, b]) => win(a, b)),
        ),
        SK,
        0.0003,
        x,
      ),
      steel,
    );
    for (const [za, zb] of windows) {
      // Groove floor reads dark; ridges catch the light on their bevels.
      col.add(profile(shape(win(za, zb)), 0.0003, 0, sx * (W / 2 - SK - 0.00012)), M.dark);
      const n = Math.floor((za - zb) / 0.0028);
      const pitch = (za - zb) / n;
      for (let i = 0; i < n; i++) {
        const z = za - (i + 0.5) * pitch;
        const r: P2[] = [
          [z + 0.00068, wy0],
          [z + 0.00068 - slant, wy1],
          [z - 0.00068 - slant, wy1],
          [z - 0.00068, wy0],
        ];
        col.add(profile(shape(r), SK, 0.00028, x), steel);
      }
    }
  }
  // Ejection port with the barrel hood showing.
  col.add(boxZ(0.0007, 0.0115, -0.01, -0.05, 0.0126, SLIDE_TOP - 0.0065, 0), M.dark);
  col.add(boxZ(0.0009, 0.0085, -0.012, -0.048, 0.0127, SLIDE_TOP - 0.0055, 0.0003), M.blued);
  col.add(boxZ(0.0165, 0.0018, -0.011, -0.049, 0.0028, SLIDE_TOP + 0.0002, 0.0005), M.steel);
  // Sights.
  col.add(boxZ(0.0036, 0.0055, -0.147, -0.153, 0, SLIDE_TOP + 0.0026, 0.0007), steel);
  col.add(boxZ(0.0016, 0.0016, -0.1468, -0.1472, 0, SLIDE_TOP + 0.0035, 0), M.white);
  for (const x of [-0.0045, 0.0045])
    col.add(boxZ(0.0058, 0.0058, 0.024, 0.016, x, SLIDE_TOP + 0.0027, 0.0008), steel);
  col.add(boxZ(0.0156, 0.0025, 0.024, 0.016, 0, SLIDE_TOP + 0.001, 0.0006), steel);
  // Optic cut: dot or cover plate.
  const optic = c.r.parts.optic as OpticPart;
  if (sp.rmrCut) {
    if (optic.kind === 'rmr') rmr(c, col, 0.012, -0.033, SLIDE_TOP - 0.0015);
    else col.add(boxZ(0.022, 0.003, 0.012, -0.033, 0, SLIDE_TOP + 0.0004, 0.001), steel);
  }
  // Barrel crown + guide rod at the muzzle face; muzzle device on threaded barrels.
  const barrel = c.r.parts.barrel as BarrelPart;
  const zm = l.barrelMuzzleZ;
  col.add(
    lathe(
      [
        [0.0068, SLIDE_FRONT + 0.002],
        [0.0068, zm],
        [0.0042, zm],
        [0.0042, zm + 0.002],
      ],
      16,
      B,
    ),
    M.steel,
  );
  col.add(cylZ(0.0042, zm + 0.0015, zm - 0.0003, B, 0, 12), M.dark);
  col.add(cylZ(0.0035, SLIDE_FRONT + 0.001, SLIDE_FRONT - 0.0004, SLIDE_BOT + 0.0045, 0, 10), M.dark);
  if (barrel.threaded)
    col.add(
      lathe(
        [
          [0.0062, zm + 0.0002],
          [0.0062, zm - 0.0001],
        ],
        16,
        B,
      ),
      M.steel,
    );
  const muzzle = c.r.parts.muzzle as MuzzlePart;
  if (muzzle.length > 0) buildMuzzle(c, muzzle, zm, B, col, 0.0062);
  c.socket('muzzle', [0, B, l.muzzleTipZ]);
  c.socket('optic', [0, SLIDE_TOP, -0.01], undefined, 'slide');
  c.socket('chargingHandle', [0, B + 0.004, 0.016], undefined, 'slide');
  c.socket('ejectionPort', [0.013, SLIDE_TOP - 0.006, -0.03], undefined, 'slide');
}

function frame(c: Ctx) {
  const { M } = c;
  const mat = frameMat(c);
  const pts: P2[] = [
    [-0.151, SLIDE_BOT],
    [-0.1535, 0.004],
    [-0.149, -0.0045],
    [-0.078, -0.0045],
    [-0.068, -0.007],
    [-0.0675, -0.0235],
    [-0.0702, -0.0285],
    [-0.0668, -0.0332],
    [-0.0605, -0.0345],
    [-0.02, -0.0345],
    [0.004, -0.031],
    [0.03, -0.03],
    [0.047, -0.012],
    [0.051, 0.004],
    [0.042, SLIDE_BOT],
  ];
  const guard: P2[] = [
    [-0.0605, -0.007],
    [-0.0605, -0.0265],
    [-0.0555, -0.0302],
    [-0.008, -0.0302],
    [-0.0035, -0.0265],
    [-0.0035, -0.007],
  ];
  c.s.add(profile(shape(pts, [guard]), 0.026, 0.0022), mat);
  const g = gripProfile([GRIP_TOP[0], GRIP_TOP[1] - 0.002], GRIP_ANGLE, 0.072, 0.046, {
    grooves: 3,
    beaver: 0.001,
    swell: 0.004,
  });
  c.s.add(profile(shape(g), 0.0305, 0.0062), gripMat(c));
  // Front-strap mag cut-out at the bottom, slide/frame parting line, accessory-rail grooves.
  // Rear frame block above the grip, as wide as the grip so the stippled panel reads as an inset border.
  const block: P2[] = [
    [0.0015, SLIDE_BOT],
    [0.0015, -0.0305],
    [0.03, -0.0295],
    [0.047, -0.012],
    [0.051, 0.004],
    [0.042, SLIDE_BOT],
  ];
  c.s.add(profile(shape(block), 0.0299, 0.0045), mat);
  c.s.add(boxZ(0.0262, 0.0006, SLIDE_REAR - 0.001, SLIDE_FRONT + 0.004, 0, SLIDE_BOT, 0), M.dark);
  c.s.add(boxZ(0.0264, 0.0011, -0.079, -0.149, 0, -0.0012, 0), M.dark);
  // Rail slots under the dust cover.
  for (const z of [-0.096, -0.106, -0.116])
    c.s.add(boxZ(0.0262, 0.0024, z, z - 0.004, 0, -0.0034, 0), M.dark);
  // Takedown lever + slide stop + mag release + trigger with its safety blade.
  for (const x of [-0.0131, 0.0131])
    c.s.add(boxZ(0.0012, 0.0035, -0.052, -0.06, x, 0.012, 0.0005), M.phosphate);
  const bc = c.part('boltCatch', [-0.0135, 0.0125, -0.02]);
  bc.add(boxZ(0.002, 0.0038, -0.016, -0.034, -0.0137, 0.0128, 0.0008), M.phosphate);
  const rel = c.part('magRelease', [0, -0.012, 0.004]);
  rel.add(boxZ(0.0305, 0.0085, 0.0075, 0.0005, 0, -0.012, 0.0015), mat);
  const trig = c.part('trigger', [0, 0.004, -0.026]);
  trig.add(
    profile(
      shape([
        [-0.024, 0.005],
        [-0.0305, -0.002],
        [-0.033, -0.012],
        [-0.0315, -0.021],
        [-0.0285, -0.0215],
        [-0.0275, -0.012],
        [-0.025, -0.004],
        [-0.021, 0.002],
      ]),
      0.0068,
      0.0012,
    ),
    mat,
  );
  trig.add(boxZ(0.0018, 0.012, -0.029, -0.0325, 0, -0.011, 0.0004), M.dark);
  const angle = GRIP_ANGLE;
  c.socket(
    'gripRight',
    [0, GRIP_TOP[1] - 0.035 * Math.cos(angle), GRIP_TOP[0] + 0.035 * Math.sin(angle) + 0.025],
    [angle, 0, 0],
  );
  c.socket('underRail', [0, -0.0045, -0.12], [0, 0, Math.PI]);
}

function magazine(c: Ctx) {
  const m = c.r.parts.magazine as MagazinePart;
  const col = c.part('mag', [0, 0, 0]);
  const a = GRIP_ANGLE;
  const down: P2 = [Math.sin(a), -Math.cos(a)];
  const midTop: P2 = [GRIP_TOP[0] + Math.cos(a) * 0.0235, GRIP_TOP[1] + Math.sin(a) * 0.0235];
  const p = (t: number): P2 => [midTop[0] + down[0] * t, midTop[1] + down[1] * t];
  const top = -0.03,
    base = 0.0765 + m.drop;
  const len = base - top;
  const [cz, cy] = p((top + base) / 2);
  const mat = c.M.polymer;
  col.add(xform(rbox(0.0215, len, 0.031, 0, 0, 0, 0.002), { rot: [-a, 0, 0], pos: [0, cy, cz] }), mat);
  const [bz, by] = p(base + 0.003);
  col.add(xform(rbox(0.0262, 0.008, 0.05, 0, 0, -0.002, 0.0025), { rot: [-a, 0, 0], pos: [0, by, bz] }), mat);
  if (m.drop > 0.01)
    col.add(
      xform(rbox(0.0285, 0.012, 0.046, 0, 0.004, -0.001, 0.003), { rot: [-a, 0, 0], pos: [0, by, bz] }),
      mat,
    );
  const [mz, my] = p(base);
  c.socket('magwell', [0, my, mz]);
}

function pistolLight(c: Ctx) {
  const { M, l } = c;
  const lp = c.r.parts.light as LightPart | undefined;
  if (!lp || lp.style === 'none' || !l.light) return;
  const zf = l.light.zFront;
  const y = -0.022;
  c.s.add(boxZ(0.024, 0.006, zf + 0.07, zf + 0.012, 0, -0.0068, 0.0012), M.polymer);
  c.s.add(boxZ(0.03, 0.029, zf + 0.074, zf + 0.008, 0, y, 0.0055), M.finish.black);
  c.s.add(
    lathe(
      [
        [0, zf + 0.012],
        [0.0142, zf + 0.012],
        [0.0146, zf + 0.004],
        [0.0142, zf],
        [0, zf],
      ],
      20,
      y,
    ),
    M.finish.black,
  );
  c.s.add(cylZ(0.0122, zf + 0.0006, zf - 0.0004, y, 0, 20), M.lightLens);
  if (lp.style === 'pistolCombo') {
    c.s.add(boxZ(0.012, 0.01, zf + 0.03, zf + 0.002, 0, y - 0.018, 0.002), M.finish.black);
    c.s.add(cylZ(0.0025, zf + 0.0026, zf + 0.0016, y - 0.018, 0, 10), M.reticle);
  }
  // Paddle switches at the rear.
  for (const x of [-0.016, 0.016])
    c.s.add(rbox(0.003, 0.012, 0.01, x, y - 0.004, zf + 0.07, 0.0012), M.polymer);
  c.socket('light', [0, y, zf]);
}
