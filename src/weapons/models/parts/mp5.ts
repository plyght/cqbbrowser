import type {
  BarrelPart,
  HandguardPart,
  MagazinePart,
  MountPart,
  MuzzlePart,
  StockPart,
} from '../../attachments/types';
import type { Ctx } from '../core';
import {
  boxZ,
  cylZ,
  lathe,
  picatinny,
  profile,
  railMatrix,
  rbox,
  roundRect,
  shape,
  sweep,
  type P2,
} from '../geom';
import { buildBoxMag, buildMuzzle, deg, gripProfile, topRail } from './common';

/** KP-9: roller-delayed 9 mm SMG (MP5-pattern): tube receiver, cocking tube, drum sight, curved mag. */
const RTOP = 0.064;
const CT_Y = 0.052;

export function buildMP5(c: Ctx) {
  receiver(c);
  barrel(c);
  handguard(c);
  lowerGroup(c);
  stock(c);
  mount(c);
  magazine(c);
}

function receiver(c: Ctx) {
  const { s, M } = c;
  const steel = M.blued;
  const sec = shape(roundRect(0, (RTOP + 0.008) / 2, 0.031, RTOP - 0.008, 0.008));
  s.add(sweep(sec, 0.076, -0.1, 0.001), steel);
  // Rear end cap.
  s.add(boxZ(0.033, 0.042, 0.092, 0.074, 0, 0.042, 0.005), steel);
  // Cocking tube + front cap.
  s.add(cylZ(0.0125, -0.095, -0.226, CT_Y, 0, 18), steel);
  s.add(
    lathe(
      [
        [0.0125, -0.226],
        [0.0115, -0.23],
        [0.006, -0.232],
        [0, -0.232],
      ],
      18,
      CT_Y,
    ),
    steel,
  );
  // Side stiffening grooves + ejection port.
  for (const x of [-0.0157, 0.0157]) s.add(boxZ(0.0006, 0.0024, 0.06, -0.09, x, 0.043, 0), M.dark);
  s.add(boxZ(0.0006, 0.012, -0.005, -0.05, 0.0157, 0.03, 0), M.dark);
  // Magwell block.
  s.add(boxZ(0.029, 0.03, -0.026, -0.084, 0, 0.0, 0.004), steel);
  s.add(boxZ(0.031, 0.005, -0.026, -0.084, 0, -0.014, 0.002), steel);
  // Rear drum sight.
  s.add(boxZ(0.022, 0.008, 0.072, 0.038, 0, RTOP + 0.004, 0.002), steel);
  s.add(cylZ(0.0105, 0.063, 0.049, RTOP + 0.017, 0, 18), steel);
  for (const x of [-0.011, 0.011]) s.add(boxZ(0.003, 0.016, 0.068, 0.044, x, RTOP + 0.012, 0.001), steel);
  // Front hooded ring sight.
  s.add(boxZ(0.016, 0.016, -0.204, -0.224, 0, CT_Y + 0.018, 0.003), steel);
  s.add(
    lathe(
      [
        [0.0085, -0.208],
        [0.0108, -0.208],
        [0.0108, -0.22],
        [0.0085, -0.22],
      ],
      20,
      RTOP + 0.02,
    ),
    steel,
  );
  s.add(boxZ(0.0018, 0.009, -0.212, -0.215, 0, RTOP + 0.0145, 0.0004), steel);
  // Charging handle (left, folding) in its slot.
  s.add(boxZ(0.0006, 0.004, -0.11, -0.175, -0.0126, CT_Y, 0), M.dark);
  const ch = c.part('chargingHandle', [-0.013, CT_Y, -0.168]);
  ch.add(boxZ(0.022, 0.006, -0.164, -0.172, -0.022, CT_Y, 0.002).rotateY(0), steel);
  ch.add(cylZ(0.0055, -0.162, -0.176, CT_Y, -0.034, 12), M.polymer);
  c.pivot('bolt', [0, c.B, 0.0]);
  c.socket('chargingHandle', [-0.034, CT_Y, -0.169]);
  c.socket('ejectionPort', [0.016, 0.03, -0.028]);
  c.socket('magwell', [0, -0.02, c.r.platform.frame.magwellZ]);
}

function barrel(c: Ctx) {
  const { s, M, B, l } = c;
  const b = c.r.parts.barrel as BarrelPart;
  const muzzle = c.r.parts.muzzle as MuzzlePart;
  const zm = l.barrelMuzzleZ;
  if (b.integralCan) {
    s.add(
      lathe(
        [
          [0, -0.1],
          [0.0205, -0.1],
          [0.0205, l.muzzleTipZ + 0.006],
          [0.0185, l.muzzleTipZ],
          [0.005, l.muzzleTipZ],
          [0, l.muzzleTipZ + 0.004],
        ],
        24,
        B,
      ),
      M.can,
    );
    s.add(cylZ(0.0045, l.muzzleTipZ + 0.003, l.muzzleTipZ - 0.0005, B, 0, 10), M.dark);
  } else {
    s.add(
      lathe(
        [
          [0, -0.1],
          [0.0095, -0.1],
          [0.0095, zm + 0.032],
          [0.0082, zm + 0.03],
          [0.0082, zm],
          [0.003, zm],
        ],
        18,
        B,
      ),
      M.blued,
    );
    // Tri-lugs.
    for (let i = 0; i < 3; i++) {
      const g = boxZ(0.005, 0.004, zm + 0.028, zm + 0.016, 0, 0.0095, 0.001);
      g.rotateZ((i * 2 * Math.PI) / 3 + Math.PI / 3);
      g.translate(0, B, 0);
      s.add(g, M.blued);
    }
    if (muzzle.kind !== 'bare') buildMuzzle(c, muzzle, zm + 0.02, B, s, 0.009);
    else s.add(cylZ(0.004, zm + 0.001, zm - 0.0004, B, 0, 10), M.dark);
  }
  c.socket('muzzle', [0, B, l.muzzleTipZ]);
}

function handguard(c: Ctx) {
  const { s, M, B, l } = c;
  const hg = c.r.parts.handguard as HandguardPart;
  const { z0, z1 } = l.handguard!;
  c.hgStyle = hg.style;
  if (hg.style === 'quad') {
    const R = 0.021;
    c.hgRadius = R + 0.0094;
    s.add(boxZ(0.042, 0.05, z0, z1, 0, B + 0.006, 0.005), M.finish.black);
    for (const a of [Math.PI / 2, Math.PI, -Math.PI / 2])
      s.add(picatinny(z0 - 0.004, z1 + 0.004, railMatrix(a, R + 0.0094, B)), M.finish.black);
    c.socket('underRail', [0, B - c.hgRadius, z1 + 0.04], [0, 0, Math.PI]);
    c.socket('sideRail', [c.hgRadius, B, z1 + 0.04], [0, 0, -Math.PI / 2]);
    return;
  }
  const wide = hg.style === 'tropical';
  c.hgRadius = wide ? 0.026 : 0.021;
  const pts: P2[] = [
    [z0, CT_Y - 0.006],
    [z1 + 0.012, CT_Y - 0.004],
    [z1, CT_Y - 0.01],
    [z1, B - 0.008],
    [z1 + 0.016, B - 0.02],
    [z0 + 0.02, B - (wide ? 0.03 : 0.024)],
    [z0, B - (wide ? 0.031 : 0.025)],
  ];
  s.add(profile(shape(pts), wide ? 0.052 : 0.042, wide ? 0.01 : 0.009), M.polymer);
  if (wide) s.add(boxZ(0.056, 0.008, z0 - 0.002, z0 - 0.012, 0, B - 0.024, 0.003), M.polymer);
  // Grooves on the slim handguard.
  if (!wide)
    for (const x of [-0.021, 0.021])
      s.add(boxZ(0.0008, 0.003, z0 - 0.015, z1 + 0.02, x, B - 0.004, 0), M.dark);
}

function lowerGroup(c: Ctx) {
  const { s, M } = c;
  const poly = M.polymer;
  // Trigger housing body + guard.
  const body: P2[] = [
    [0.066, 0.009],
    [0.066, -0.006],
    [0.04, -0.013],
    [0.03, -0.044],
    [0.02, -0.05],
    [-0.024, -0.05],
    [-0.03, -0.044],
    [-0.03, -0.012],
    [-0.024, 0.009],
  ];
  const hole: P2[] = [
    [0.024, -0.014],
    [0.024, -0.04],
    [0.017, -0.044],
    [-0.019, -0.044],
    [-0.024, -0.04],
    [-0.024, -0.016],
  ];
  s.add(profile(shape(body, [hole]), 0.028, 0.002), poly);
  const g = gripProfile([0.028, -0.012], 17 * deg, 0.09, 0.045, { swell: 0.003, beaver: 0.006 });
  s.add(profile(shape(g), 0.03, 0.0055), poly);
  // Push-pin.
  s.add(
    cylZ(0.003, 0, -0.033, 0, 0, 10)
      .rotateY(Math.PI / 2)
      .translate(-0.0165, 0.004, 0.058),
    M.steel,
  );
  const trig = c.part('trigger', [0, -0.014, 0.003]);
  trig.add(
    profile(
      shape([
        [0.006, -0.014],
        [0.0, -0.015],
        [-0.004, -0.024],
        [-0.002, -0.035],
        [0.001, -0.035],
        [0.002, -0.024],
        [0.006, -0.019],
      ]),
      0.005,
      0.0007,
    ),
    M.blued,
  );
  const saf = c.part('safety', [-0.0145, -0.002, 0.04]);
  saf.add(
    cylZ(0.0065, 0, -0.002, 0, 0, 14)
      .rotateY(Math.PI / 2)
      .translate(-0.014, -0.002, 0.04),
    poly,
  );
  saf.add(rbox(0.003, 0.004, 0.018, -0.0155, 0.003, 0.034, 0.001), poly);
  const rel = c.part('magRelease', [0, -0.016, -0.022]);
  rel.add(boxZ(0.022, 0.008, -0.02, -0.027, 0, -0.016, 0.002), M.blued);
  c.socket('gripRight', [0, -0.055, 0.052], [17 * deg, 0, 0]);
}

function stock(c: Ctx) {
  const { s, M, l } = c;
  const st = c.r.parts.stock as StockPart;
  const bz = l.buttZ;
  if (st.style === 'retractable') {
    for (const x of [-0.0178, 0.0178])
      s.add(boxZ(0.0035, 0.011, bz - 0.006, bz - 0.3, x, 0.046, 0.0012), M.blued);
    s.add(boxZ(0.042, 0.012, bz - 0.004, bz - 0.022, 0, 0.046, 0.003), M.blued);
    const butt: P2[] = [
      [bz, 0.058],
      [bz - 0.012, 0.062],
      [bz - 0.016, 0.052],
      [bz - 0.013, -0.035],
      [bz - 0.004, -0.052],
      [bz, -0.046],
    ];
    s.add(profile(shape(butt), 0.04, 0.004), M.blued);
    s.add(boxZ(0.042, 0.1, bz + 0.003, bz - 0.006, 0, 0.004, 0.004), M.rubber);
  } else {
    const pts: P2[] = [
      [0.074, 0.062],
      [bz - 0.03, 0.066],
      [bz, 0.07],
      [bz, -0.055],
      [bz - 0.012, -0.06],
      [bz - 0.08, -0.03],
      [0.14, 0.0],
      [0.074, 0.012],
    ];
    s.add(profile(shape(pts), 0.036, 0.006), M.polymer);
    s.add(boxZ(0.038, 0.12, bz + 0.003, bz - 0.005, 0, 0.007, 0.004), M.rubber);
  }
  c.socket('stock', [0, c.B - 0.02, bz]);
}

function mount(c: Ctx) {
  const m = c.r.parts.mount as MountPart;
  if (m.style !== 'claw' || !m.rail) return;
  const { s, M } = c;
  const { z0, z1, y } = m.rail;
  for (const z of [z0 - 0.012, z1 + 0.014]) {
    s.add(boxZ(0.034, 0.012, z + 0.008, z - 0.008, 0, RTOP + 0.002, 0.003), M.finish.black);
    for (const x of [-0.0172, 0.0172])
      s.add(boxZ(0.004, 0.02, z + 0.006, z - 0.006, x, RTOP - 0.008, 0.001), M.finish.black);
  }
  s.add(boxZ(0.022, y - RTOP - 0.012, z0, z1, 0, (y + RTOP) / 2 - 0.002, 0.002), M.finish.black);
  topRail(c, z0, z1, y);
}

function magazine(c: Ctx) {
  const m = c.r.parts.magazine as MagazinePart;
  const col = c.part('mag', [0, 0, 0]);
  const len = m.drop + 0.03;
  const o = {
    top: [-0.031, 0.004] as P2,
    len,
    depthTop: 0.034,
    depthBottom: 0.036,
    curve: 0.034 * (len / 0.2) * (len / 0.2),
    straight: 0.15,
    power: 1.6,
  };
  buildBoxMag(c, col, o, 0.022, c.M.blued, { ribs: [0.5], base: 'mp5' });
}
