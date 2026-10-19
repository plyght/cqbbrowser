import { Matrix4, type Material } from 'three';
import type {
  GripPart,
  HandguardPart,
  MagazinePart,
  MountPart,
  MuzzlePart,
  StockPart,
} from '../../attachments/types';
import { Ctx } from '../core';
import {
  boxZ,
  Collector,
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

/** K-47S: short stamped-receiver AK (krinkov-ish), 7.62×39. */
export function buildAK(c: Ctx) {
  receiver(c);
  topCover(c);
  barrelAndFront(c);
  handguard(c);
  mount(c);
  stock(c);
  grip(c);
  magazine(c);
}

const TOP = 0.061; // receiver rail top
const BOT = -0.006;

function receiver(c: Ctx) {
  const { s, M } = c;
  const steel = M.blued;
  const body: P2[] = [
    [0.104, TOP],
    [0.104, 0.022],
    [0.112, 0.012],
    [0.11, 0.0],
    [0.098, BOT - 0.002],
    [-0.151, BOT],
    [-0.152, 0.004],
    [-0.152, TOP],
  ];
  s.add(profile(shape(body), 0.031, 0.0012), steel);
  // Front trunnion bulge + rivets (bright points read as "AK" instantly).
  s.add(boxZ(0.0322, 0.03, -0.112, -0.152, 0, 0.014, 0.0012), steel);
  for (const [z, y] of [
    [-0.118, 0.006],
    [-0.13, 0.022],
    [-0.145, 0.006],
    [-0.145, 0.022],
    [0.085, 0.006],
    [0.098, 0.018],
    [0.06, 0.0],
  ])
    for (const x of [-0.0162, 0.0162])
      s.add(
        cylZ(0.0018, 0, -0.001, 0, 0, 8)
          .rotateY(Math.PI / 2)
          .translate(x, y, z),
        M.steel,
      );
  // Magazine-guide dimples.
  for (const x of [-0.0158, 0.0158]) s.add(rbox(0.001, 0.006, 0.014, x, 0.003, -0.032, 0.0005), M.dark);
  // Side rail plate (left).
  s.add(boxZ(0.004, 0.024, 0.07, -0.02, -0.0172, 0.034, 0.001), steel);
  for (let z = 0.066; z > -0.018; z -= 0.012)
    s.add(boxZ(0.0012, 0.022, z, z - 0.006, -0.0195, 0.034, 0.0003), steel);
  // Ejection port + selector slot (right side).
  s.add(boxZ(0.0006, 0.013, -0.025, -0.11, 0.0157, 0.041, 0), M.dark);
  // Trigger guard (stamped loop) + mag catch.
  const guard = shape(
    [
      [0.03, BOT],
      [0.03, -0.028],
      [0.024, -0.034],
      [-0.02, -0.034],
      [-0.03, -0.03],
      [-0.034, BOT],
    ],
    [
      [
        [0.026, BOT - 0.002],
        [0.026, -0.027],
        [0.021, -0.0305],
        [-0.018, -0.0305],
        [-0.027, -0.027],
        [-0.03, BOT - 0.002],
      ],
    ],
  );
  s.add(profile(guard, 0.009, 0.0008), steel);
  const rel = c.part('magRelease', [0, -0.012, -0.036]);
  rel.add(boxZ(0.014, 0.012, -0.034, -0.042, 0, -0.016, 0.002), steel);
  const trig = c.part('trigger', [0, -0.006, 0.005]);
  trig.add(
    profile(
      shape([
        [0.007, BOT],
        [0.0, BOT],
        [-0.004, -0.016],
        [-0.002, -0.026],
        [0.001, -0.026],
        [0.002, -0.016],
        [0.007, -0.01],
      ]),
      0.005,
      0.0006,
    ),
    steel,
  );
  // Selector lever (right): long stamped plate pivoting at the rear.
  const saf = c.part('safety', [0.0165, 0.032, 0.08]);
  saf.add(
    profile(
      shape([
        [0.092, 0.031],
        [0.074, 0.039],
        [0.07, 0.034],
        [0.0, 0.031],
        [-0.038, 0.04],
        [-0.044, 0.036],
        [-0.04, 0.028],
        [0.0, 0.025],
        [0.07, 0.024],
        [0.092, 0.024],
      ]),
      0.0016,
      0.0004,
      0.0168,
    ),
    steel,
  );
  // Bolt carrier + charging handle (right side, reciprocates).
  const bolt = c.part('bolt', [0.012, 0.042, -0.06]);
  bolt.add(boxZ(0.006, 0.01, -0.025, -0.1, 0.0128, 0.041, 0.001), M.steel);
  bolt.add(boxZ(0.012, 0.006, -0.095, -0.103, 0.021, 0.044, 0.0015), M.steel);
  bolt.add(
    lathe(
      [
        [0, 0.0],
        [0.0048, 0.0],
        [0.0052, -0.003],
        [0.0048, -0.012],
        [0, -0.012],
      ],
      12,
    )
      .rotateY(-Math.PI / 2)
      .translate(0.027, 0.044, -0.099),
    M.steel,
  );
  c.pivot('chargingHandle', [0.034, 0.044, -0.099]);
  c.socket('chargingHandle', [0.036, 0.044, -0.099]);
  c.socket('ejectionPort', [0.016, 0.041, -0.07]);
  c.socket('magwell', [0, BOT - 0.04, c.r.platform.frame.magwellZ]);
}

function topCover(c: Ctx) {
  const { s, M } = c;
  const mount = c.r.parts.mount as MountPart;
  const railed = mount.style === 'topCover';
  // Arched cover from the rear-sight hinge back.
  const arch: P2[] = [];
  for (let i = 0; i <= 10; i++) {
    const a = Math.PI * (i / 10);
    arch.push([Math.cos(a) * 0.0155, TOP + Math.sin(a) * 0.0075]);
  }
  arch.push([-0.0155, TOP - 0.004], [0.0155, TOP - 0.004]);
  s.add(sweep(shape(arch), 0.1, -0.128, 0.0008), M.blued);
  // Stiffening ribs.
  for (const x of [-0.008, 0.008]) s.add(boxZ(0.003, 0.004, 0.09, -0.115, x, TOP + 0.006, 0.0012), M.blued);
  // Recoil-spring latch button at the rear.
  s.add(boxZ(0.008, 0.009, 0.112, 0.1, 0, TOP + 0.001, 0.0015), M.blued);
  // Rear sight block (krink: flip sight at the front of the cover, on the trunnion).
  s.add(boxZ(0.026, 0.014, -0.128, -0.152, 0, TOP + 0.005, 0.002), M.blued);
  if (!railed) {
    s.add(boxZ(0.016, 0.012, -0.132, -0.146, 0, TOP + 0.017, 0.0015), M.blued);
    s.add(boxZ(0.004, 0.006, -0.135, -0.143, 0, TOP + 0.026, 0.0008), M.blued);
  } else {
    topRail(c, 0.084, -0.124, 0.084, M.blued);
    s.add(boxZ(0.022, 0.012, 0.084, -0.124, 0, 0.0715, 0.002), M.blued);
  }
}

function barrelAndFront(c: Ctx) {
  const { s, M, B, l } = c;
  const zm = l.barrelMuzzleZ;
  s.add(
    lathe(
      [
        [0, -0.15],
        [0.0118, -0.15],
        [0.0118, -0.168],
        [0.0096, -0.172],
        [0.0096, zm + 0.014],
        [0.008, zm + 0.012],
        [0.008, zm],
        [0.003, zm],
      ],
      18,
      B,
    ),
    M.blued,
  );
  // Gas block + front sight (krink combo block).
  const g = l.gasZ;
  s.add(boxZ(0.024, 0.032, g + 0.024, g - 0.022, 0, B + 0.012, 0.004), M.blued);
  s.add(cylZ(0.0105, g + 0.024, g - 0.022, B, 0, 18), M.blued);
  for (const x of [-0.009, 0.009])
    s.add(boxZ(0.0035, 0.026, g + 0.004, g - 0.02, x, B + 0.038, 0.001), M.blued);
  s.add(boxZ(0.0022, 0.016, g - 0.006, g - 0.0095, 0, B + 0.036, 0.0005), M.blued);
  // Gas tube (under the upper handguard).
  s.add(cylZ(0.0085, -0.15, g + 0.02, B + 0.022, 0, 14), M.blued);
  const muzzle = c.r.parts.muzzle as MuzzlePart;
  buildMuzzle(c, muzzle, zm, B, s, 0.008);
  c.socket('muzzle', [0, B, l.muzzleTipZ]);
}

function woodLower(z0: number, z1: number, B: number): P2[] {
  return [
    [z0, B + 0.006],
    [z1, B + 0.006],
    [z1 - 0.003, B - 0.006],
    [z1 + 0.004, B - 0.022],
    [z1 + 0.018, B - 0.026],
    [(z0 + z1) / 2, B - 0.028],
    [z0 - 0.015, B - 0.031],
    [z0, B - 0.03],
  ];
}

function handguard(c: Ctx) {
  const { s, M, B, l } = c;
  const hg = c.r.parts.handguard as HandguardPart;
  c.hgStyle = hg.style;
  const z0 = -0.153;
  const z1 = l.gasZ + 0.026;
  const mat: Material = hg.style === 'wood' ? M.wood : hg.id === 'ak_hg_plum' ? M.plum : M.polymer;
  if (hg.style === 'wood' || hg.style === 'polymer') {
    c.hgRadius = 0.022;
    s.add(profile(shape(woodLower(z0, z1, B)), 0.04, 0.006), mat);
    // Upper gas-tube cover.
    const up: P2[] = [
      [z0, B + 0.012],
      [z1 + 0.004, B + 0.012],
      [z1 + 0.012, B + 0.031],
      [z0 + 0.01, B + 0.034],
      [z0, B + 0.032],
    ];
    s.add(profile(shape(up), 0.026, 0.006), mat);
    // Retainer lever.
    s.add(boxZ(0.0334, 0.008, z0 + 0.004, z0 - 0.006, 0, B + 0.004, 0.0015), M.blued);
    return;
  }
  // Railed: aluminium body around the barrel with rails, plus a gas-tube rail on top.
  const R = 0.022;
  c.hgRadius = hg.style === 'quad' ? R + 0.0094 : R;
  if (hg.style === 'quad') {
    s.add(boxZ(0.044, 0.04, z0, z1, 0, B - 0.004, 0.005), c.M.finish.black);
    for (const a of [Math.PI / 2, Math.PI, -Math.PI / 2])
      s.add(picatinny(z0 - 0.004, z1 + 0.003, railMatrix(a, R + 0.0094, B)), c.M.finish.black);
  } else {
    const w = 2 * R * Math.tan(Math.PI / 8) + 0.0016;
    for (let k = 2; k <= 6; k++)
      s.add(mlokPlate(z0, z1, w, 0.0022, (k * Math.PI) / 4, R, B, true, 0.004), c.M.finish.black);
  }
  // Gas tube rail (scout position).
  s.add(boxZ(0.022, 0.012, z0 - 0.002, z1, 0, B + 0.028, 0.003), c.M.finish.black);
  topRail(c, z0 - 0.004, Math.max(z1, z0 - 0.1), c.r.platform.frame.railY);
  c.socket('underRail', [0, B - c.hgRadius, z1 + 0.04], [0, 0, Math.PI]);
  c.socket('sideRail', [c.hgRadius, B, z1 + 0.04], [0, 0, -Math.PI / 2]);
}

function mount(c: Ctx) {
  const m = c.r.parts.mount as MountPart;
  if (m.style !== 'sideMount' || !m.rail) return;
  const { s, M } = c;
  const fin = M.finish.black;
  const { z0, z1, y } = m.rail;
  // Clamp on the left-side rail plate, arm over the cover, picatinny on top.
  s.add(boxZ(0.012, 0.03, 0.062, -0.012, -0.024, 0.04, 0.003), fin);
  s.add(xform(rbox(0.009, 0.02, 0.016, 0, 0, 0, 0.002), { pos: [-0.031, 0.034, 0.025] }), fin);
  const arm: P2[] = [
    [-0.03, 0.05],
    [-0.03, y - 0.008],
    [0.012, y - 0.008],
    [0.012, y - 0.016],
    [-0.016, y - 0.02],
    [-0.018, 0.052],
  ];
  const g = sweep(shape(arm), 0.058, -0.008, 0.001);
  s.add(g, fin);
  s.add(boxZ(0.024, 0.01, z0, z1, 0, y - 0.012, 0.002), fin);
  topRail(c, z0, z1, y);
}

function stock(c: Ctx) {
  const { M, B, l } = c;
  const st = c.r.parts.stock as StockPart;
  const hinge: [number, number, number] = [-0.0175, B, 0.106];
  const col = c.part('stock', hinge);
  // Hinge block (static).
  c.s.add(boxZ(0.012, 0.05, 0.116, 0.1, -0.012, 0.025, 0.003), M.blued);
  const bz = l.stockFolded ? st.collapsedZ + (st.positions > 1 ? 0 : 0) : l.buttZ;
  const tmp = new Collector();
  if (st.style === 'triangle') {
    const bar = (z0: number, y0: number, z1: number, y1: number) => {
      const len = Math.hypot(z1 - z0, y1 - y0);
      const g = rbox(0.008, 0.0055, len, 0, 0, 0, 0.002);
      g.rotateX(Math.atan2(-(y1 - y0), z1 - z0));
      g.translate(0, (y0 + y1) / 2, (z0 + z1) / 2);
      tmp.add(g, M.blued);
    };
    bar(0.112, 0.05, bz - 0.006, 0.054);
    bar(0.112, 0.004, bz - 0.006, -0.064);
    tmp.add(boxZ(0.026, 0.13, bz, bz - 0.01, 0, -0.005, 0.004), M.blued);
    tmp.add(boxZ(0.02, 0.11, bz + 0.002, bz - 0.002, 0, -0.005, 0.003), M.blued);
  } else if (st.style === 'polyFolder') {
    const pts: P2[] = [
      [0.11, 0.058],
      [bz - 0.04, 0.058],
      [bz, 0.062],
      [bz, -0.07],
      [bz - 0.012, -0.076],
      [bz - 0.1, -0.03],
      [0.11, 0.0],
    ];
    const hole: P2[] = [
      [bz - 0.03, 0.04],
      [bz - 0.03, -0.035],
      [bz - 0.085, -0.012],
      [0.15, 0.025],
      [0.15, 0.04],
    ];
    tmp.add(profile(shape(pts, [hole]), 0.03, 0.004), M.polymer);
    tmp.add(boxZ(0.032, 0.13, bz + 0.002, bz - 0.008, 0, -0.004, 0.003), M.rubber);
  } else {
    // Folding adapter → buffer tube → AR stock or brace.
    tmp.add(boxZ(0.03, 0.04, 0.12, 0.105, 0, B, 0.004), M.finish.black);
    const sub = new Ctx(c.r, c.l, c.opts);
    bufferTube(sub, 0.12, 0.12 + 0.185);
    tubeStock(sub, bz, st.style === 'brace' ? 'brace' : 'carbine');
    sub.s.drain(tmp);
  }
  // Fold to the left around the hinge: rotate -180° about y.
  if (l.stockFolded) {
    const m = new Matrix4()
      .makeTranslation(hinge[0], 0, hinge[2])
      .multiply(new Matrix4().makeRotationY(Math.PI * 0.985))
      .multiply(new Matrix4().makeTranslation(-hinge[0], 0, -hinge[2]))
      .premultiply(new Matrix4().makeTranslation(-0.019, 0, 0));
    tmp.drain(col, m);
  } else tmp.drain(col);
  c.socket('stock', [0, B - 0.03, l.buttZ]);
}

function grip(c: Ctx) {
  const g = c.r.parts.grip as GripPart;
  const angle = g.style === 'ergo' ? 18 * deg : 22 * deg;
  const pts = gripProfile([0.04, BOT - 0.004], angle, 0.092, g.style === 'ergo' ? 0.042 : 0.036, {
    swell: g.style === 'ergo' ? 0.004 : 0.002,
    beaver: 0.003,
    grooves: g.style === 'ak' ? 0 : 0,
  });
  c.s.add(profile(shape(pts), 0.027, 0.006), g.style === 'akWood' ? c.M.wood : c.M.polymerGrip);
  c.socket('gripRight', [0, BOT - 0.045, 0.06], [angle, 0, 0]);
}

function magazine(c: Ctx) {
  const m = c.r.parts.magazine as MagazinePart;
  const col = c.part('mag', [0, 0, 0]);
  const len = m.drop + 0.04;
  const o = {
    top: [-0.044, 0.004] as P2,
    len,
    depthTop: 0.064,
    depthBottom: 0.074,
    straight: 0,
    radius: 0.26,
    tilt: 0.07,
  };
  const mat = magMaterial(c, m);
  buildBoxMag(c, col, o, 0.027, mat, {
    ribs: m.material === 'steel' ? [0.18, 0.5, 0.82] : [0.5],
    base: 'ak',
  });
  // Front locking lug.
  col.add(
    boxZ(
      0.018,
      0.008,
      o.top[0] - o.depthTop + 0.002,
      o.top[0] - o.depthTop - 0.004,
      0,
      o.top[1] - 0.004,
      0.0015,
    ),
    mat,
  );
}
