import { CatmullRomCurve3, CylinderGeometry, Matrix4, RingGeometry, TubeGeometry, Vector3 } from 'three';
import type { Placement } from '../../attachments/build';
import type { ForegripPart, LightPart, OpticPart, SlingPart } from '../../attachments/types';
import type { Ctx } from '../core';
import { boxZ, Collector, cylZ, lathe, profile, rbox, shape, sweep, xform, type P2 } from '../geom';

/** Rail clamp block common to all rail mounts. */
function clamp(c: Ctx, col: Collector, z0: number, z1: number, railY: number, w = 0.026) {
  col.add(boxZ(w, 0.011, z0, z1, 0, railY - 0.0035, 0.0018), c.M.finish.black);
  col.add(
    rbox(
      0.0035,
      0.009,
      Math.min(0.022, (z0 - z1) * 0.6),
      -w / 2 - 0.0015,
      railY - 0.004,
      (z0 + z1) / 2,
      0.0012,
    ),
    c.M.phosphate,
  );
}

// ------------------------------------------------------------------ micro red dot

export function redDot(c: Ctx, p: Placement, col: Collector = c.s) {
  const { M } = c;
  const fin = M.finish.black;
  const zc = (p.z0 + p.z1) / 2;
  const ro = 0.0136,
    ri = 0.0099;
  const zb0 = zc + 0.0225,
    zb1 = zc - 0.0225;
  clamp(c, col, p.z0, p.z1, p.railY);
  // Riser up to the housing.
  const riserTop = p.axisY - ro + 0.003;
  col.add(
    boxZ(0.02, riserTop - p.railY, p.z0 - 0.002, p.z1 + 0.002, 0, (riserTop + p.railY) / 2, 0.0015),
    fin,
  );
  col.add(boxZ(0.023, 0.011, zb0 - 0.004, zb1 + 0.004, 0, p.axisY - ro + 0.005, 0.002), fin);
  col.add(
    lathe(
      [
        [ri, zb0],
        [ro - 0.0006, zb0],
        [ro, zb0 - 0.0015],
        [ro, zb1 + 0.0035],
        [ro + 0.0009, zb1 + 0.002],
        [ro + 0.0009, zb1],
        [ri, zb1],
        [ri, zb0],
      ],
      24,
      p.axisY,
    ),
    fin,
  );
  // Turrets: elevation top, windage right, battery left.
  col.add(
    new CylinderGeometry(0.0052, 0.0052, 0.006, 14).translate(0, p.axisY + ro + 0.001, zc + 0.003),
    fin,
  );
  col.add(
    new CylinderGeometry(0.0052, 0.0052, 0.006, 14)
      .rotateZ(Math.PI / 2)
      .translate(ro + 0.001, p.axisY, zc + 0.003),
    fin,
  );
  col.add(
    new CylinderGeometry(0.0068, 0.0068, 0.005, 14)
      .rotateZ(Math.PI / 2)
      .translate(-ro - 0.0005, p.axisY - 0.002, zc + 0.002),
    fin,
  );
  col.add(cylZ(ri, zb1 + 0.0028, zb1 + 0.0018, p.axisY, 0, 20), M.lensCoat);
  col.add(cylZ(ri, zb0 - 0.001, zb0 - 0.0018, p.axisY, 0, 20), M.glass);
  col.add(rbox(0.0011, 0.0011, 0.0004, 0, p.axisY, zb1 + 0.004, 0), M.reticle);
}

// ------------------------------------------------------------------ holographic

export function holo(c: Ctx, p: Placement, col: Collector = c.s) {
  const { M } = c;
  const fin = M.finish.black;
  const rail = p.railY;
  const za = p.z0 - 0.034; // rear of the window
  clamp(c, col, p.z0, p.z1, rail, 0.03);
  col.add(boxZ(0.044, 0.015, p.z0, p.z1, 0, rail + 0.0055, 0.003), fin);
  // Rear housing (buttons) and the battery cap on the front right.
  col.add(boxZ(0.042, 0.03, p.z0, za + 0.002, 0, rail + 0.016, 0.004), fin);
  for (const x of [-0.008, 0.008])
    col.add(rbox(0.009, 0.006, 0.002, x, rail + 0.022, p.z0 + 0.0005, 0.001), M.rubber);
  col.add(
    new CylinderGeometry(0.008, 0.008, 0.008, 16)
      .rotateZ(Math.PI / 2)
      .translate(0.025, rail + 0.006, p.z1 + 0.014),
    fin,
  );
  // Hood: top plate + tapered ears.
  const top = p.axisY + 0.0175;
  col.add(boxZ(0.046, 0.0035, za, p.z1, 0, top, 0.0012), fin);
  const ear: P2[] = [
    [za, rail + 0.01],
    [p.z1 - 0.001, rail + 0.01],
    [p.z1 + 0.004, top + 0.0015],
    [za, top + 0.0015],
  ];
  for (const x of [-0.0215, 0.0215]) col.add(profile(shape(ear), 0.004, 0.0008, x), fin);
  // Windows (front coated, rear clear) and reticle (65 MOA ring + dot).
  col.add(rbox(0.039, 0.029, 0.0012, 0, p.axisY + 0.001, p.z1 + 0.006, 0), M.lensCoat);
  col.add(rbox(0.039, 0.028, 0.0012, 0, p.axisY + 0.001, za - 0.002, 0), M.glass);
  const ring = new RingGeometry(0.0052, 0.0058, 28);
  ring.translate(0, p.axisY, (za + p.z1) / 2);
  col.add(ring, M.reticle);
  col.add(rbox(0.0009, 0.0009, 0.0003, 0, p.axisY, (za + p.z1) / 2, 0), M.reticle);
  // QD levers on the left.
  for (const z of [p.z0 - 0.02, p.z1 + 0.02])
    col.add(rbox(0.003, 0.007, 0.018, -0.0235, rail - 0.002, z, 0.001), M.phosphate);
}

// ------------------------------------------------------------------ LPVO

export function lpvo(c: Ctx, p: Placement, col: Collector = c.s) {
  const { M } = c;
  const fin = M.finish.black;
  const ax = p.axisY;
  clamp(c, col, p.z0, p.z1, p.railY);
  col.add(boxZ(0.02, 0.008, p.z0, p.z1, 0, p.railY + 0.002, 0.002), fin);
  // Cantilever mount: two rings.
  for (const zr of [p.z0 - 0.014, p.z1 + 0.004]) {
    const h = ax - 0.017 - p.railY;
    col.add(boxZ(0.017, h, zr + 0.0075, zr - 0.0075, 0, p.railY + h / 2 + 0.002, 0.002), fin);
    col.add(
      lathe(
        [
          [0.0151, zr + 0.008],
          [0.0186, zr + 0.008],
          [0.019, zr + 0.006],
          [0.019, zr - 0.006],
          [0.0186, zr - 0.008],
          [0.0151, zr - 0.008],
        ],
        24,
        ax,
      ),
      fin,
    );
    col.add(rbox(0.012, 0.004, 0.012, 0, ax + 0.019, zr, 0.0015), fin);
  }
  const r0 = p.z0 + 0.06;
  col.add(
    lathe(
      [
        [0, r0],
        [0.019, r0],
        [0.0222, r0 - 0.004],
        [0.0222, r0 - 0.062],
        [0.0205, r0 - 0.068],
        [0.016, r0 - 0.09],
        [0.0153, r0 - 0.094],
        [0.0153, r0 - 0.19],
        [0.0178, r0 - 0.212],
        [0.0192, r0 - 0.22],
        [0.0192, r0 - 0.252],
        [0.0182, r0 - 0.256],
        [0, r0 - 0.256],
      ],
      28,
      ax,
    ),
    fin,
  );
  // Magnification ring knurl + throw lever.
  for (let i = 0; i < 4; i++) {
    const z = r0 - 0.03 - i * 0.006;
    col.add(
      lathe(
        [
          [0.0222, z + 0.002],
          [0.0231, z + 0.001],
          [0.0231, z - 0.001],
          [0.0222, z - 0.002],
        ],
        24,
        ax,
      ),
      M.rubber,
    );
  }
  col.add(rbox(0.007, 0.018, 0.009, 0.0235, ax + 0.008, r0 - 0.04, 0.002), fin);
  // Turret saddle + turrets.
  const zt = r0 - 0.138;
  col.add(boxZ(0.034, 0.034, zt + 0.02, zt - 0.02, 0, ax, 0.008), fin);
  col.add(new CylinderGeometry(0.0118, 0.0118, 0.013, 20).translate(0, ax + 0.023, zt), fin);
  col.add(new CylinderGeometry(0.0118, 0.0118, 0.013, 20).rotateZ(Math.PI / 2).translate(0.023, ax, zt), fin);
  col.add(new CylinderGeometry(0.0092, 0.0092, 0.01, 20).rotateZ(Math.PI / 2).translate(-0.02, ax, zt), fin);
  col.add(cylZ(0.0178, r0 - 0.2555, r0 - 0.2565, ax, 0, 24), M.lensCoat);
  col.add(cylZ(0.0185, r0 + 0.0005, r0 - 0.0005, ax, 0, 24), M.glass);
}

// ------------------------------------------------------------------ magnifier (flip, animated part)

export function magnifier(c: Ctx, p: Placement) {
  const { M } = c;
  const fin = M.finish.black;
  clamp(c, c.s, p.z0, p.z1, p.railY);
  const hingeY = p.axisY - 0.012;
  c.s.add(
    boxZ(0.012, hingeY - p.railY + 0.004, p.z0 - 0.004, p.z1 + 0.004, -0.012, (hingeY + p.railY) / 2, 0.002),
    fin,
  );
  const col = c.part('magnifier', [-0.019, hingeY, (p.z0 + p.z1) / 2]);
  const r0 = p.z0 + 0.04;
  col.add(
    lathe(
      [
        [0, r0],
        [0.0175, r0],
        [0.019, r0 - 0.004],
        [0.019, r0 - 0.03],
        [0.0165, r0 - 0.036],
        [0.0165, r0 - 0.1],
        [0.0172, r0 - 0.106],
        [0, r0 - 0.106],
      ],
      24,
      p.axisY,
    ),
    fin,
  );
  col.add(boxZ(0.014, 0.012, p.z0 - 0.004, p.z1 + 0.004, -0.014, hingeY + 0.002, 0.002), fin);
  col.add(cylZ(0.0168, r0 + 0.0005, r0 - 0.0005, p.axisY, 0, 20), M.glass);
  col.add(cylZ(0.0158, r0 - 0.1055, r0 - 0.1065, p.axisY, 0, 20), M.lensCoat);
}

// ------------------------------------------------------------------ RMR-style dot (pistol + 45° offset)

/** RMR housing with its base on y = baseY, footprint z0 → z1. */
export function rmr(c: Ctx, col: Collector, z0: number, z1: number, baseY: number) {
  const { M } = c;
  const fin = M.finish.black;
  const len = z0 - z1;
  col.add(boxZ(0.026, 0.008, z0, z1, 0, baseY + 0.004, 0.0018), fin);
  col.add(boxZ(0.019, 0.009, z0, z0 - len * 0.32, 0, baseY + 0.011, 0.003), fin);
  const zf = z1 + 0.0145;
  const hoop = shape(
    [
      [-0.013, baseY + 0.006],
      [0.013, baseY + 0.006],
      [0.0095, baseY + 0.026],
      [-0.0095, baseY + 0.026],
    ],
    [
      [
        [-0.0098, baseY + 0.0085],
        [0.0098, baseY + 0.0085],
        [0.0072, baseY + 0.0232],
        [-0.0072, baseY + 0.0232],
      ],
    ],
  );
  col.add(sweep(hoop, zf, z1, 0.0008), fin);
  col.add(
    xform(rbox(0.019, 0.015, 0.0008, 0, 0, 0, 0), {
      rot: [-0.12, 0, 0],
      pos: [0, baseY + 0.0158, zf - 0.006],
    }),
    M.lensCoat,
  );
  col.add(rbox(0.0008, 0.0008, 0.0003, 0, baseY + 0.0155, zf - 0.004, 0), M.reticle);
}

export function offsetDot(c: Ctx, p: Placement & { side: 'left' | 'right' }) {
  const tmp = new Collector();
  const s = p.side === 'right' ? 1 : -1;
  // Local frame: origin at rail centre, +y = out along the 45° line.
  tmp.add(boxZ(0.02, 0.022, p.z0, p.z1, 0, 0.012, 0.0025), c.M.finish.black);
  rmr(c, tmp, p.z0 + 0.008, p.z1 - 0.008, 0.024);
  const m = new Matrix4().makeRotationZ((-s * Math.PI) / 4);
  m.setPosition(0, p.railY - 0.005, 0);
  tmp.drain(c.s, m);
}

// ------------------------------------------------------------------ BUIS

export function buisRear(c: Ctx, p: Placement) {
  const { M } = c;
  clamp(c, c.s, p.z0, p.z1, p.railY, 0.024);
  const y0 = p.railY + 0.002,
    ay = p.axisY;
  const zp = (p.z0 + p.z1) / 2;
  const plate = shape(
    [
      [-0.0085, y0],
      [0.0085, y0],
      [0.0085, ay + 0.0045],
      [0.005, ay + 0.0065],
      [-0.005, ay + 0.0065],
      [-0.0085, ay + 0.0045],
    ],
    [
      Array.from({ length: 10 }, (_, i) => {
        const a = (i / 10) * Math.PI * 2;
        return [Math.cos(a) * 0.0013, ay + Math.sin(a) * 0.0013] as P2;
      }),
    ],
  );
  c.s.add(sweep(plate, zp + 0.002, zp - 0.002, 0.0005), M.finish.black);
  for (const x of [-0.0105, 0.0105])
    c.s.add(
      boxZ(0.003, ay + 0.007 - y0, zp + 0.005, zp - 0.005, x, (ay + 0.007 + y0) / 2, 0.001),
      M.finish.black,
    );
}

export function buisFront(c: Ctx, p: Placement) {
  const { M } = c;
  clamp(c, c.s, p.z0, p.z1, p.railY, 0.024);
  const y0 = p.railY + 0.002,
    ay = p.axisY;
  const zp = (p.z0 + p.z1) / 2;
  const tower = shape(
    [
      [-0.0115, y0],
      [0.0115, y0],
      [0.0085, ay + 0.009],
      [-0.0085, ay + 0.009],
    ],
    [
      [
        [-0.0068, y0 + 0.004],
        [0.0068, y0 + 0.004],
        [0.0052, ay + 0.0065],
        [-0.0052, ay + 0.0065],
      ],
    ],
  );
  c.s.add(sweep(tower, zp + 0.003, zp - 0.003, 0.0006), M.finish.black);
  c.s.add(
    boxZ(0.0017, ay - y0 - 0.004, zp + 0.001, zp - 0.001, 0, (ay + y0 + 0.004) / 2, 0.0004),
    M.phosphate,
  );
}

/** Dispatch the primary optic. */
export function primaryOptic(c: Ctx, part: OpticPart, p: Placement) {
  if (part.kind === 'reddot') redDot(c, p);
  else if (part.kind === 'holo') holo(c, p);
  else if (part.kind === 'lpvo') lpvo(c, p);
}

// ------------------------------------------------------------------ accessories

/** Point on a circle of radius d around the bore at angle a (0 = top, + = right). */
function around(c: Ctx, a: number, d: number): [number, number] {
  return [Math.sin(a) * d, c.B + Math.cos(a) * d];
}

export function light(c: Ctx, part: LightPart) {
  const { M, l } = c;
  if (!l.light || part.style === 'none') return;
  const zf = l.light.zFront;
  const s = l.light.side === 'left' ? -1 : 1;
  const quad = c.hgStyle === 'quad';
  if (part.style === 'scout') {
    const a = s * (quad ? Math.PI / 2 : (52 * Math.PI) / 180);
    const d = c.hgRadius + (quad ? 0.0135 : 0.0165);
    const [x, y] = around(c, a, d);
    c.s.add(
      lathe(
        [
          [0, zf + 0.118],
          [0.0085, zf + 0.118],
          [0.0098, zf + 0.112],
          [0.0098, zf + 0.098],
          [0.0091, zf + 0.094],
          [0.0091, zf + 0.04],
          [0.0118, zf + 0.03],
          [0.0128, zf + 0.026],
          [0.0128, zf + 0.004],
          [0.0122, zf],
          [0, zf],
        ],
        20,
        y,
        x,
      ),
      M.finish.black,
    );
    c.s.add(cylZ(0.0108, zf + 0.0006, zf - 0.0004, y, x, 20), M.lightLens);
    // Mount between light and rail/handguard.
    const [mx, my] = around(c, a, c.hgRadius + 0.004);
    c.s.add(
      xform(boxZ(0.012, 0.012, zf + 0.085, zf + 0.055, 0, 0, 0.002), {
        rot: [0, 0, -a],
        pos: [(mx + x) / 2, (my + y) / 2, 0],
      }),
      M.finish.black,
    );
    // Tape switch on the tailcap.
    c.s.add(rbox(0.006, 0.006, 0.01, x - s * 0.006, y - 0.006, zf + 0.112, 0.002), M.rubber);
    c.socket('light', [x, y, zf]);
  } else {
    const a = s * (Math.PI / 2);
    const d = c.hgRadius + 0.017;
    const [x, y] = around(c, a, d);
    c.s.add(
      xform(rbox(0.026, 0.03, 0.068, 0, 0, 0, 0.005), { rot: [0, 0, -a], pos: [x, y, zf + 0.036] }),
      M.polymer,
    );
    c.s.add(
      lathe(
        [
          [0, zf + 0.012],
          [0.0128, zf + 0.012],
          [0.0135, zf + 0.004],
          [0.0132, zf],
          [0, zf],
        ],
        20,
        y,
        x,
      ),
      M.finish.black,
    );
    c.s.add(cylZ(0.011, zf + 0.0006, zf - 0.0004, y, x, 20), M.lightLens);
    c.socket('light', [x, y, zf]);
  }
}

export function laser(c: Ctx, part: LightPart) {
  const { M, l } = c;
  if (!l.laser || part.style === 'none') return;
  const zf = l.laser.zFront;
  const a = -Math.PI / 2;
  const d = c.hgRadius + 0.018;
  const [x, y] = around(c, a, d);
  c.s.add(boxZ(0.032, 0.034, zf + 0.078, zf, x, y, 0.004), M.finish.fde);
  for (const [dx, dy] of [
    [0, 0.008],
    [0, -0.008],
  ])
    c.s.add(cylZ(0.0045, zf + 0.0006, zf - 0.0006, y + dy, x + dx, 12), M.dark);
  c.s.add(boxZ(0.008, 0.012, zf + 0.05, zf + 0.03, x + d * 0.0 + 0.012, y, 0.002), M.finish.black);
}

export function foregrip(c: Ctx, part: ForegripPart) {
  const { M, l } = c;
  if (!l.foregrip || part.style === 'none') return;
  const z = l.foregrip.z;
  const bottom = c.B - c.hgRadius - (c.hgStyle === 'quad' ? 0 : 0.002);
  const mat = M.polymer;
  c.s.add(boxZ(0.024, 0.008, z + 0.022, z - 0.022, 0, bottom - 0.002, 0.002), mat);
  if (part.style === 'vertical') {
    const g = new CylinderGeometry(0.0138, 0.0128, 0.088, 18);
    g.translate(0, -0.044, 0);
    g.rotateX(-0.08);
    g.translate(0, bottom - 0.004, z);
    c.s.add(g, mat);
    c.s.add(
      new CylinderGeometry(0.0145, 0.0135, 0.006, 18).rotateX(-0.08).translate(0, bottom - 0.093, z - 0.007),
      mat,
    );
  } else if (part.style === 'angled') {
    const pts: P2[] = [
      [z + 0.045, bottom],
      [z - 0.04, bottom],
      [z - 0.04, bottom - 0.01],
      [z - 0.012, bottom - 0.03],
      [z + 0.006, bottom - 0.034],
      [z + 0.02, bottom - 0.028],
      [z + 0.045, bottom - 0.006],
    ];
    c.s.add(profile(shape(pts), 0.027, 0.004), mat);
  } else if (part.style === 'handstop') {
    const pts: P2[] = [
      [z + 0.014, bottom],
      [z - 0.016, bottom],
      [z - 0.012, bottom - 0.011],
      [z - 0.002, bottom - 0.017],
      [z + 0.006, bottom - 0.013],
    ];
    c.s.add(profile(shape(pts), 0.022, 0.003), mat);
  }
}

export function sling(c: Ctx, part: SlingPart, rearZ: number) {
  const { M, B, l } = c;
  if (part.style === 'none') return;
  const start = new Vector3(-0.022, B - 0.004, rearZ + 0.006);
  c.s.add(
    new CylinderGeometry(0.006, 0.006, 0.006, 12)
      .rotateZ(Math.PI / 2)
      .translate(-0.018, B - 0.004, rearZ + 0.006),
    M.phosphate,
  );
  let pts: Vector3[];
  if (part.style === 'single')
    pts = [
      start,
      new Vector3(-0.026, B - 0.02, rearZ + 0.012),
      new Vector3(-0.028, B - 0.045, rearZ + 0.014),
      new Vector3(-0.024, B - 0.06, rearZ + 0.03),
    ];
  else {
    const fz = l.handguard ? l.handguard.z1 + 0.04 : rearZ - 0.3;
    const mid = (rearZ + fz) / 2;
    pts = [
      start,
      new Vector3(-0.03, B - 0.08, rearZ - 0.02),
      new Vector3(-0.034, B - 0.085, mid),
      new Vector3(-0.03, B - 0.07, fz + 0.04),
      new Vector3(-0.024, B - 0.01, fz),
    ];
  }
  const tube = new TubeGeometry(new CatmullRomCurve3(pts), 14, 0.0055, 4, false);
  c.s.add(tube, M.rubber);
}
