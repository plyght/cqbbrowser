import { CylinderGeometry } from 'three';
import type {
  BarrelPart,
  GripPart,
  HandguardPart,
  MagazinePart,
  MuzzlePart,
  ProfilePart,
  StockPart,
} from '../../attachments/types';
import type { Ctx } from '../core';
import {
  boxZ,
  cylZ,
  lathe,
  mlokPlate,
  picatinny,
  profile,
  railMatrix,
  rbox,
  shape,
  sweep,
  xform,
  type P2,
} from '../geom';
import {
  buildBoxMag,
  buildMuzzle,
  bufferTube,
  deg,
  gripProfile,
  magMaterial,
  topRail,
  tubeStock,
} from './common';

/** SB-16 / HB-300: AR-15 lower + flat-top upper, barrels, handguards, stocks, mags. */
export function buildAR(c: Ctx) {
  lower(c);
  upper(c);
  barrel(c);
  handguard(c);
  stock(c);
  grip(c);
  magazine(c);
}

function lower(c: Ctx) {
  const { s, fin, M } = c;
  const body: P2[] = [
    [0.084, 0.0125],
    [0.089, 0.003],
    [0.083, -0.011],
    [0.07, -0.0195],
    [-0.0362, -0.0195],
    [-0.0365, -0.012],
    [-0.1, -0.012],
    [-0.106, -0.006],
    [-0.113, -0.001],
    [-0.113, 0.0125],
  ];
  s.add(profile(shape(body), 0.0225, 0.0012), fin);
  // Trigger guard: separate, narrower loop with the "enhanced" drop at the rear.
  const guard = shape(
    [
      [0.0365, -0.017],
      [0.0365, -0.029],
      [0.031, -0.039],
      [0.02, -0.0505],
      [0.009, -0.048],
      [-0.022, -0.0465],
      [-0.031, -0.0415],
      [-0.0362, -0.031],
      [-0.0362, -0.017],
    ],
    [
      [
        [0.031, -0.0205],
        [0.031, -0.029],
        [0.0265, -0.0365],
        [0.018, -0.0448],
        [0.009, -0.0428],
        [-0.021, -0.0415],
        [-0.0275, -0.038],
        [-0.031, -0.03],
        [-0.031, -0.0205],
      ],
    ],
  );
  s.add(profile(guard, 0.0108, 0.0012), fin);
  // Magwell: flared walls, slightly wider than the receiver, with the flare lip.
  const well: P2[] = [
    [-0.0355, 0.0],
    [-0.0355, -0.051],
    [-0.039, -0.057],
    [-0.0985, -0.059],
    [-0.1015, -0.053],
    [-0.1005, 0.0],
  ];
  s.add(profile(shape(well), 0.0268, 0.0018), fin);
  s.add(boxZ(0.0288, 0.0042, -0.037, -0.101, 0, -0.057, 0.0016), fin);
  // Mag-release fence (right) and bolt-catch ears (left).
  const fence: P2[] = [
    [-0.024, 0.002],
    [-0.024, -0.017],
    [-0.038, -0.017],
    [-0.038, -0.012],
    [-0.0275, -0.012],
    [-0.0275, 0.002],
  ];
  s.add(profile(shape(fence), 0.0034, 0.0008, 0.0124), fin);
  s.add(
    profile(
      shape([
        [-0.035, 0.0105],
        [-0.051, 0.0105],
        [-0.051, 0.006],
        [-0.035, 0.006],
      ]),
      0.0034,
      0.0008,
      -0.0124,
    ),
    fin,
  );
  s.add(
    profile(
      shape([
        [-0.035, -0.012],
        [-0.051, -0.012],
        [-0.051, -0.016],
        [-0.035, -0.016],
      ]),
      0.0034,
      0.0008,
      -0.0124,
    ),
    fin,
  );
  // Takedown + pivot pins through both sides (heads proud, detent dot).
  for (const [z, y] of [
    [0.077, 0.006],
    [-0.106, 0.004],
  ]) {
    s.add(
      new CylinderGeometry(0.0032, 0.0032, 0.0246, 14).rotateZ(Math.PI / 2).translate(0, y, z),
      M.phosphate,
    );
    for (const x of [-0.0124, 0.0124])
      s.add(
        cylZ(0.0011, 0.0004, -0.0004, 0, 0, 8)
          .rotateY(Math.PI / 2)
          .translate(x * 1.003, y, z),
        M.dark,
      );
  }
  // Pistol-grip screw boss and the receiver's rear "tang" detail.
  s.add(
    cylZ(0.0026, 0, -0.001, 0, 0, 8)
      .rotateX(Math.PI / 2)
      .translate(0, -0.0195, 0.06),
    M.dark,
  );
  // Trigger.
  const trig = c.part('trigger', [0, -0.012, 0.004]);
  trig.add(
    profile(
      shape([
        [0.007, -0.0135],
        [0.0005, -0.0145],
        [-0.0035, -0.022],
        [-0.003, -0.033],
        [0.0004, -0.0365],
        [0.0018, -0.0335],
        [0.0016, -0.024],
        [0.0065, -0.0185],
      ]),
      0.0045,
      0.0006,
    ),
    M.phosphate,
  );
  // Selector: detent disc + forward-pointing lever (left), short ambi lever (right).
  const SP: P2 = [0.046, 0.0005];
  const saf = c.part('safety', [0, SP[1], SP[0]]);
  const lever = (len: number): P2[] => [
    [SP[0] + 0.004, SP[1] + 0.0028],
    [SP[0] - len, SP[1] + 0.0042],
    [SP[0] - len - 0.0035, SP[1] + 0.0012],
    [SP[0] - len - 0.0035, SP[1] - 0.0016],
    [SP[0] - len, SP[1] - 0.004],
    [SP[0] + 0.004, SP[1] - 0.0028],
  ];
  for (const sx of [-1, 1]) {
    saf.add(
      cylZ(0.0056, 0.0009, -0.0009, 0, 0, 16)
        .rotateY(Math.PI / 2)
        .translate(sx * 0.0122, SP[1], SP[0]),
      M.phosphate,
    );
    saf.add(profile(shape(lever(sx < 0 ? 0.017 : 0.01)), 0.0022, 0.0006, sx * 0.0137), M.phosphate);
  }
  // Mag release button (right).
  const rel = c.part('magRelease', [0.012, -0.007, -0.031]);
  rel.add(
    cylZ(0.0044, 0.0, -0.0036, 0, 0, 14)
      .rotateY(Math.PI / 2)
      .translate(0.0122, -0.0068, -0.0315),
    M.phosphate,
  );
  // Bolt release paddle (left): upper striker + lower paddle, ribbed.
  const bc = c.part('boltCatch', [-0.0135, 0.004, -0.043]);
  const paddle: P2[] = [
    [-0.0385, 0.0098],
    [-0.0475, 0.0098],
    [-0.0488, 0.004],
    [-0.0466, -0.004],
    [-0.0498, -0.0135],
    [-0.0445, -0.0178],
    [-0.0392, -0.011],
    [-0.0392, 0.003],
  ];
  bc.add(profile(shape(paddle), 0.0026, 0.0007, -0.0151), M.phosphate);
  for (let i = 0; i < 3; i++)
    bc.add(boxZ(0.0012, 0.0008, -0.0405, -0.048, -0.0165, -0.0085 - i * 0.0026, 0.0002), M.phosphate);
  c.socket('magwell', [0, c.r.platform.frame.magTopY - 0.045, c.r.platform.frame.magwellZ]);
}

function upper(c: Ctx) {
  const { s, fin, M, B } = c;
  const top = 0.0516;
  s.add(
    profile(
      shape([
        [0.084, 0.0125],
        [0.084, top],
        [-0.1045, top],
        [-0.1045, 0.017],
        [-0.099, 0.0125],
      ]),
      0.0245,
      0.0012,
    ),
    fin,
  );
  // Upper/lower parting line.
  s.add(boxZ(0.0254, 0.0008, 0.083, -0.099, 0, 0.0125, 0), M.dark);
  // Round barrel-nut boss at the front.
  s.add(cylZ(0.0158, -0.088, -0.1048, B, 0, 20), fin);
  const rail = c.r.platform.frame.receiverRail!;
  topRail(c, rail.z0, -0.104, rail.y);
  // Forward assist: tapered housing angled out to the rear, plunger with a grooved face.
  const a = 0.42;
  const fa = lathe(
    [
      [0, -0.002],
      [0.0082, -0.002],
      [0.0074, 0.018],
      [0.0078, 0.0185],
      [0.0078, 0.0245],
      [0.0072, 0.0255],
      [0, 0.0255],
    ],
    18,
  );
  s.add(xform(fa, { rot: [0, a, 0], pos: [0.0085, B + 0.0065, 0.058] }), fin);
  const groove = lathe(
    [
      [0.0045, 0.0257],
      [0.0062, 0.0257],
      [0.0062, 0.0259],
      [0.0045, 0.0259],
    ],
    16,
  );
  s.add(xform(groove, { rot: [0, a, 0], pos: [0.0085, B + 0.0065, 0.058] }), M.dark);
  // Brass deflector: wedge behind the port.
  const defl = shape([
    [0.0118, B - 0.001],
    [0.0192, B + 0.0055],
    [0.0192, B + 0.0095],
    [0.0118, B + 0.019],
  ]);
  s.add(sweep(defl, 0.021, 0.003, 0.0012), fin);
  // Ejection port: dark opening, bolt carrier visible inside (bolt part), dust cover hanging open.
  s.add(boxZ(0.0006, 0.0172, -0.002, -0.068, 0.01245, B + 0.0016, 0), M.dark);
  const bolt = c.part('bolt', [0, B, 0.0]);
  bolt.add(boxZ(0.0016, 0.0118, -0.004, -0.058, 0.0121, B + 0.002, 0.0006), M.phosphate);
  bolt.add(boxZ(0.0014, 0.0068, -0.056, -0.066, 0.0122, B + 0.0005, 0.0005), M.phosphate);
  for (let i = 0; i < 6; i++) {
    const z = -0.008 - i * 0.0024;
    bolt.add(boxZ(0.0005, 0.007, z, z - 0.0009, 0.01292, B + 0.003, 0), M.dark);
  }
  const hinge: [number, number] = [0.0129, B - 0.0072];
  const dc = c.part('dustCover', [hinge[0], hinge[1], -0.035]);
  const cover = boxZ(0.0012, 0.0168, -0.003, -0.067, 0, 0.0084, 0.0005);
  const rib = boxZ(0.0015, 0.0026, -0.006, -0.064, 0.0012, 0.0128, 0.0006);
  const latch = boxZ(0.0016, 0.004, -0.06, -0.066, 0.0012, 0.0155, 0.0006);
  for (const g of [cover, rib, latch]) {
    g.rotateZ(-1.95);
    g.translate(hinge[0], hinge[1], 0);
    dc.add(g, M.phosphate);
  }
  s.add(cylZ(0.0011, -0.001, -0.069, hinge[1], hinge[0], 8), M.steel);
  // Charging handle (rear, top) with latch.
  const ch = c.part('chargingHandle', [0, top - 0.004, 0.085]);
  ch.add(boxZ(0.011, 0.0055, 0.098, 0.07, 0, top - 0.004, 0.0012), fin);
  ch.add(rbox(0.04, 0.0066, 0.0075, 0, top - 0.004, 0.0935, 0.0022), fin);
  ch.add(rbox(0.013, 0.0064, 0.011, -0.0165, top - 0.0042, 0.0895, 0.002), fin);
  c.socket('chargingHandle', [0, top - 0.002, 0.096]);
  c.socket('ejectionPort', [0.013, B + 0.002, -0.035]);
}

function barrel(c: Ctx) {
  const { s, M, B, l } = c;
  const b = c.r.parts.barrel as BarrelPart;
  const prof = (c.r.parts.barrelProfile as ProfilePart | undefined)?.radius ?? 0.0093;
  const muzzle = c.r.parts.muzzle as MuzzlePart;
  const zm = l.barrelMuzzleZ;
  const threads = b.threaded && muzzle.kind !== 'integral' ? 0.013 : 0;
  s.add(
    lathe(
      [
        [0, -0.09],
        [0.0118, -0.09],
        [0.0118, -0.125],
        [prof, -0.13],
        [prof, zm + threads + 0.002],
        [prof - 0.0012, zm + threads],
        [threads ? 0.0074 : prof * 0.9, zm + threads],
        [threads ? 0.0074 : prof * 0.9, zm],
        [0.003, zm],
      ],
      18,
      B,
    ),
    M.phosphate,
  );
  // Low-profile gas block.
  s.add(boxZ(0.021, 0.026, l.gasZ + 0.011, l.gasZ - 0.011, 0, B + 0.002, 0.003), M.phosphate);
  if (muzzle.kind === 'integral') {
    // The can inside the shroud (seen through the slots).
    s.add(cylZ(0.0165, zm + 0.11, l.muzzleTipZ + 0.02, B, 0, 16), M.can);
  } else buildMuzzle(c, muzzle, zm, B);
  c.socket('muzzle', [0, B, l.muzzleTipZ]);
}

function octRing(R: number, inner: number) {
  const pts: P2[] = [];
  const hole: P2[] = [];
  for (let i = 0; i < 8; i++) {
    const a = Math.PI / 8 + (i * Math.PI) / 4;
    const k = 1 / Math.cos(Math.PI / 8);
    pts.push([Math.sin(a) * R * k, Math.cos(a) * R * k]);
    hole.push([Math.sin(a) * inner * k, Math.cos(a) * inner * k]);
  }
  return shape(pts, [hole]);
}

function handguard(c: Ctx) {
  const { s, fin, M, B, l } = c;
  const hg = c.r.parts.handguard as HandguardPart;
  const { z0, z1 } = l.handguard!;
  const railY = c.r.platform.frame.railY;
  c.hgStyle = hg.style;
  if (hg.style === 'quad') {
    const R = 0.0218;
    c.hgRadius = R + 0.0094;
    const sq = 0.0225;
    const body = shape(
      [
        [-sq, -sq + 0.006],
        [-sq + 0.006, -sq],
        [sq - 0.006, -sq],
        [sq, -sq + 0.006],
        [sq, sq - 0.006],
        [sq - 0.006, sq],
        [-sq + 0.006, sq],
        [-sq, sq - 0.006],
      ],
      [roundRectPts(0.017)],
    );
    const g = sweep(body, z0, z1, 0.0008);
    g.translate(0, B, 0);
    s.add(g, fin);
    for (let i = 0; i < 4; i++)
      s.add(picatinny(z0 - 0.004, z1 + 0.002, railMatrix((i * Math.PI) / 2, railY - B, B)), fin);
    // Rear clamp band with screws on the bottom.
    s.add(boxZ(0.05, 0.05, z0, z0 - 0.012, 0, B, 0.004), fin);
    // Heat-shield vents on the 45° faces (dark slots).
    for (let z = z0 - 0.03; z > z1 + 0.02; z -= 0.022)
      for (const a of [Math.PI / 4, -Math.PI / 4, (3 * Math.PI) / 4, (-3 * Math.PI) / 4]) {
        const v = boxZ(0.007, 0.0012, z, z - 0.012, 0, 0.0285, 0.0003);
        v.rotateZ(-a);
        v.translate(0, B, 0);
        s.add(v, M.dark);
      }
    c.socket('underRail', [0, B - (railY - B), z1 + 0.06], [0, 0, Math.PI]);
    c.socket('sideRail', [railY - B, B, z1 + 0.05], [0, 0, -Math.PI / 2]);
    return;
  }
  const R = hg.style === 'integral' ? 0.0205 : 0.0213;
  c.hgRadius = R;
  const t = 0.0022;
  const w = 2 * R * Math.tan(Math.PI / 8) + 0.0016;
  const slotted = hg.style === 'mlok' ? [2, 3, 4, 5, 6] : [2, 4, 6];
  for (let k = 0; k < 8; k++) {
    s.add(mlokPlate(z0, z1, w, t, (k * Math.PI) / 4, R, B, slotted.includes(k), 0.022), fin);
  }
  // End rings, front chamfer.
  const ring0 = sweep(octRing(R + 0.0006, R - 0.0035), z0 + 0.001, z0 - 0.008, 0.0005);
  ring0.translate(0, B, 0);
  s.add(ring0, fin);
  if (hg.style === 'integral') {
    // Rounded nose cap with the muzzle exit.
    s.add(
      lathe(
        [
          [R * 1.04, z1 + 0.004],
          [R * 1.04, z1],
          [R * 0.92, z1 - 0.008],
          [R * 0.7, z1 - 0.013],
          [0.0062, z1 - 0.0145],
          [0.006, z1 - 0.01],
          [0, z1 - 0.01],
        ],
        24,
        B,
      ),
      fin,
    );
    s.add(cylZ(0.0058, z1 - 0.009, z1 - 0.0142, B, 0, 12), M.dark);
    c.socket('muzzle', [0, B, z1 - 0.0145]);
  } else {
    const ring1 = sweep(octRing(R + 0.0004, R - 0.003), z1 + 0.006, z1, 0.0006);
    ring1.translate(0, B, 0);
    s.add(ring1, fin);
  }
  // Rail standoff + top rail.
  s.add(boxZ(0.014, 0.004, z0, z1 + 0.002, 0, B + R + 0.0006, 0.0005), fin);
  topRail(c, z0 - 0.001, z1 + 0.002, railY);
  // QD sling socket (left rear).
  s.add(
    cylZ(0.0058, 0, -0.006, 0, 0, 14)
      .rotateY(Math.PI / 2)
      .translate(-R - 0.001, B - 0.004, z0 - 0.03),
    M.phosphate,
  );
  c.socket('underRail', [0, B - R, z1 + 0.06], [0, 0, Math.PI]);
  c.socket('sideRail', [R, B, z1 + 0.05], [0, 0, -Math.PI / 2]);
}

function roundRectPts(h: number): P2[] {
  const out: P2[] = [];
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    out.push([Math.cos(a) * h, Math.sin(a) * h]);
  }
  return out;
}

function stock(c: Ctx) {
  const { s, M, B, l } = c;
  const st = c.r.parts.stock as StockPart;
  const rear = c.r.platform.frame.receiverRearZ;
  if (st.style === 'pdw') {
    // Short-buffer housing + twin rods + skeletal butt.
    s.add(boxZ(0.026, 0.032, rear + 0.001, rear + 0.03, 0, B + 0.002, 0.006), c.fin);
    s.add(cylZ(0.0145, rear + 0.03, rear + 0.04, B + 0.002, 0, 18), c.fin);
    const bz = l.buttZ;
    for (const x of [-0.0115, 0.0115])
      s.add(cylZ(0.0042, rear + 0.002, bz - 0.012, B + 0.009, x, 10), M.steel);
    s.add(boxZ(0.036, 0.016, bz - 0.006, bz - 0.032, 0, B + 0.01, 0.005), c.fin);
    const butt: P2[] = [
      [bz, B + 0.02],
      [bz, B - 0.088],
      [bz - 0.008, B - 0.094],
      [bz - 0.016, B - 0.086],
      [bz - 0.014, B - 0.004],
      [bz - 0.03, B + 0.004],
      [bz - 0.03, B + 0.018],
    ];
    s.add(profile(shape(butt), 0.034, 0.003), c.fin);
    s.add(boxZ(0.036, 0.098, bz + 0.002, bz - 0.006, 0, B - 0.04, 0.003), M.rubber);
    c.socket('stock', [0, B - 0.03, bz]);
    return;
  }
  const tubeEnd = rear + (st.style === 'brace' ? 0.19 : 0.185);
  bufferTube(c, rear, tubeEnd);
  tubeStock(c, l.buttZ, st.style === 'sopmod' ? 'sopmod' : st.style === 'brace' ? 'brace' : 'carbine');
  c.socket('stock', [0, B - 0.03, l.buttZ]);
}

function grip(c: Ctx) {
  const g = c.r.parts.grip as GripPart;
  const angle = g.style === 'a2' ? 25 * deg : g.style === 'ergo' ? 19 * deg : 11 * deg;
  const pts = gripProfile([0.0345, -0.017], angle, 0.098, g.style === 'a2' ? 0.04 : 0.044, {
    nub: g.style === 'a2',
    swell: g.style === 'ergo' ? 0.004 : 0.0015,
    beaver: g.style === 'a2' ? 0.004 : 0.008,
  });
  c.s.add(profile(shape(pts), g.style === 'a2' ? 0.0255 : 0.028, 0.0055), c.M.polymerGrip);
  const mid = 0.045;
  c.socket(
    'gripRight',
    [0, -0.017 - Math.cos(angle) * mid, 0.0345 + Math.sin(angle) * mid + 0.02],
    [angle, 0, 0],
  );
}

function magazine(c: Ctx) {
  const m = c.r.parts.magazine as MagazinePart;
  const col = c.part('mag', [0, 0, 0]);
  const len = m.drop + 0.032;
  const metal = m.material !== 'polymer';
  const o = {
    top: [-0.0385, 0.0045] as P2,
    len,
    depthTop: 0.0605,
    depthBottom: 0.0615,
    straight: m.capacity <= 20 ? 0.55 : 0.3,
    radius: m.capacity <= 20 ? 0.45 : 0.3,
  };
  buildBoxMag(c, col, o, metal ? 0.0222 : 0.0248, magMaterial(c, m), {
    ribs: metal ? [0.22, 0.78] : [],
    base: metal ? 'gi' : 'pmag',
    texture: !metal,
  });
}
