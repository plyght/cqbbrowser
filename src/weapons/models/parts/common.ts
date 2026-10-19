import { Matrix4, type Material } from 'three';
import type { MagazinePart, MuzzlePart } from '../../attachments/types';
import type { Ctx } from '../core';
import {
  boxZ,
  cylZ,
  lathe,
  merge,
  picatinny,
  profile,
  rbox,
  shape,
  sweep,
  xform,
  type Collector,
  type P2,
} from '../geom';

/** Shared builders used by several platforms: grips, magazines, muzzle devices, buffer-tube stocks. */

export const deg = Math.PI / 180;

/** Top rail at height y from z0 to z1. */
export function topRail(
  c: Ctx,
  z0: number,
  z1: number,
  y: number,
  m: Material = c.fin,
  col: Collector = c.s,
) {
  col.add(picatinny(z0, z1, new Matrix4().makeTranslation(0, y, 0)), m);
}

/**
 * Pistol grip side profile: front strap starts at (z, y) = top, raked back by `angle`.
 * `nub` adds the A2 finger nub, `swell` a palm swell.
 */
export function gripProfile(
  top: P2,
  angle: number,
  len: number,
  depth: number,
  opts: { nub?: boolean; swell?: number; beaver?: number; grooves?: number } = {},
): P2[] {
  const d: P2 = [Math.sin(angle), -Math.cos(angle)];
  const n: P2 = [Math.cos(angle), Math.sin(angle)];
  const at = (t: number, o: number): P2 => [
    top[0] + d[0] * len * t + n[0] * o,
    top[1] + d[1] * len * t + n[1] * o,
  ];
  const pts: P2[] = [];
  // Front strap, top → bottom.
  const steps = 10;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    let o = 0;
    if (opts.nub) o -= Math.exp(-((t - 0.42) ** 2) / 0.004) * 0.0045;
    if (opts.grooves) o += Math.abs(Math.sin(t * Math.PI * opts.grooves)) * 0.0025 - 0.0012;
    o += t > 0.92 ? -(t - 0.92) * 0.05 : 0;
    pts.push(at(t, o));
  }
  // Bottom.
  pts.push(at(1.02, depth * 0.35));
  pts.push(at(1.0, depth * 0.85));
  // Back strap, bottom → top.
  for (let i = steps; i >= 0; i--) {
    const t = i / steps;
    let o = depth;
    if (opts.swell) o += Math.sin(Math.PI * Math.min(1, Math.max(0, (t - 0.25) / 0.6))) * opts.swell;
    pts.push(at(t, o));
  }
  // Beavertail hooking up under the receiver.
  const bv = opts.beaver ?? 0.006;
  const b = at(0, depth);
  pts.push([b[0] + bv * 0.7, b[1] + bv]);
  pts.push([top[0] + 0.004, top[1] + bv + 0.001]);
  return pts;
}

// ------------------------------------------------------------------ magazines

export interface MagShapeOpts {
  /** Rear-top corner (z, y). */
  top: P2;
  /** Length along the rear edge (m). */
  len: number;
  depthTop: number;
  depthBottom: number;
  /** Fraction of the length that stays straight before curving. */
  straight: number;
  /** Radius of the forward curve after the straight section (Infinity = straight mag). */
  radius: number;
  /** Initial forward lean of the rear edge (rad). */
  tilt?: number;
}

/** Rear-edge point, tangent angle and forward normal at fraction t of the mag length. */
function magFrame(o: MagShapeOpts, t: number): { p: P2; phi: number; n: P2 } {
  const s = t * o.len;
  const t0 = o.tilt ?? 0;
  const s0 = o.straight * o.len;
  const sl = Math.min(s, s0);
  let z = o.top[0] - Math.sin(t0) * sl;
  let y = o.top[1] - Math.cos(t0) * sl;
  let phi = t0;
  if (s > s0 && Number.isFinite(o.radius)) {
    phi = t0 + (s - s0) / o.radius;
    z += o.radius * (Math.cos(phi) - Math.cos(t0));
    y -= o.radius * (Math.sin(phi) - Math.sin(t0));
  } else if (s > s0) {
    z -= Math.sin(t0) * (s - s0);
    y -= Math.cos(t0) * (s - s0);
  }
  return { p: [z, y], phi, n: [-Math.cos(phi), Math.sin(phi)] };
}

export function magOutline(o: MagShapeOpts, steps = 12): { pts: P2[]; bottomAngle: number; bottom: P2 } {
  const rear: P2[] = [];
  const front: P2[] = [];
  let phi = 0;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const f = magFrame(o, t);
    phi = f.phi;
    const depth = o.depthTop + (o.depthBottom - o.depthTop) * t;
    rear.push(f.p);
    // Top edge stays horizontal (it sits in the magwell); below that the front follows the normal.
    const n = i === 0 ? ([-1, 0] as P2) : f.n;
    front.push([f.p[0] + n[0] * depth, f.p[1] + n[1] * depth]);
  }
  const b0 = rear[steps],
    b1 = front[steps];
  return {
    pts: [...rear, ...front.reverse()],
    bottomAngle: phi,
    bottom: [(b0[0] + b1[0]) / 2, (b0[1] + b1[1]) / 2],
  };
}

/** Band following the mag curve at a fraction across its depth (for stamped ribs / texture panels). */
export function magBand(o: MagShapeOpts, at: number, w: number, t0: number, t1: number, steps = 8): P2[] {
  const a: P2[] = [];
  const b: P2[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = t0 + ((t1 - t0) * i) / steps;
    const f = magFrame(o, t);
    const depth = o.depthTop + (o.depthBottom - o.depthTop) * t;
    const z = f.p[0] + f.n[0] * depth * at;
    const y = f.p[1] + f.n[1] * depth * at;
    a.push([z - (f.n[0] * w) / 2, y - (f.n[1] * w) / 2]);
    b.push([z + (f.n[0] * w) / 2, y + (f.n[1] * w) / 2]);
  }
  return [...a, ...b.reverse()];
}

export function magMaterial(c: Ctx, m: MagazinePart): Material {
  if (m.material === 'steel') return c.r.platform.platform === 'ar' ? c.M.phosphate : c.M.blued;
  if (m.material === 'bakelite') return c.M.bakelite;
  if (m.material === 'aluminum') return c.M.finish.grey;
  return c.M.polymer;
}

/** Box/stick magazine with ribs and base plate into `col` (mag part). */
export function buildBoxMag(
  _c: Ctx,
  col: Collector,
  o: MagShapeOpts,
  width: number,
  mat: Material,
  opts: { ribs?: number[]; base?: 'pmag' | 'gi' | 'ak' | 'mp5'; texture?: boolean } = {},
) {
  const out = magOutline(o);
  col.add(profile(shape(out.pts), width, 0.0012), mat);
  for (const at of opts.ribs ?? [])
    col.add(profile(shape(magBand(o, at, 0.0035, 0.12, 0.93)), width + 0.0016, 0.0005), mat);
  if (opts.texture) {
    for (let i = 0; i < 4; i++) {
      const t = 0.8 + i * 0.035;
      col.add(
        profile(shape(magBand(o, 0.5, o.depthTop * 0.75, t, t + 0.012, 1)), width + 0.0012, 0.0004),
        mat,
      );
    }
  }
  const [bz, by] = out.bottom;
  const depth = o.depthBottom;
  const base = opts.base ?? 'gi';
  if (base === 'pmag') {
    col.add(
      xform(rbox(width + 0.004, 0.012, depth + 0.008, 0, -0.004, -0.002, 0.003), {
        rot: [out.bottomAngle, 0, 0],
        pos: [0, by, bz],
      }),
      mat,
    );
  } else if (base === 'ak') {
    col.add(
      xform(rbox(width + 0.003, 0.008, depth + 0.004, 0, -0.002, 0, 0.0015), {
        rot: [out.bottomAngle, 0, 0],
        pos: [0, by, bz],
      }),
      mat,
    );
  } else {
    col.add(
      xform(rbox(width + 0.002, 0.006, depth + 0.004, 0, -0.001, 0, 0.0012), {
        rot: [out.bottomAngle, 0, 0],
        pos: [0, by, bz],
      }),
      mat,
    );
  }
  // Follower/top rounds glint at the feed lips.
  col.add(
    boxZ(width * 0.7, 0.004, o.top[0] - 0.006, o.top[0] - o.depthTop * 0.7, 0, o.top[1] + 0.0015, 0.001),
    mat,
  );
}

// ------------------------------------------------------------------ muzzle devices

/** Muzzle device on a barrel ending at z0 (barrel muzzle) along the bore at y. */
export function buildMuzzle(
  c: Ctx,
  m: MuzzlePart,
  z0: number,
  y: number,
  col: Collector = c.s,
  threadR = 0.0075,
) {
  const M = c.M;
  const L = m.length;
  const R = m.radius;
  const z1 = z0 - L;
  switch (m.kind) {
    case 'bare':
      if (L > 0)
        col.add(
          lathe(
            [
              [0, z0],
              [R * 0.9, z0],
              [R * 0.9, z1 + 0.002],
              [R * 0.75, z1],
              [0.003, z1],
            ],
            16,
            y,
          ),
          M.phosphate,
        );
      break;
    case 'flashHider': {
      const prong = m.id.includes('3p') || m.id === 'ak_fh';
      if (prong) {
        col.add(
          lathe(
            [
              [0, z0],
              [R * 0.95, z0],
              [R, z0 - 0.004],
              [R, z0 - 0.018],
              [R * 0.85, z0 - 0.02],
              [0.004, z0 - 0.02],
            ],
            18,
            y,
          ),
          M.phosphate,
        );
        for (let i = 0; i < 3; i++) {
          const a = (i * 2 * Math.PI) / 3;
          const g = boxZ(0.0058, 0.0052, z0 - 0.018, z1, 0, R * 0.7, 0.001);
          g.rotateZ(a);
          g.translate(0, y, 0);
          col.add(g, M.phosphate);
        }
        col.add(cylZ(R * 0.42, z0 - 0.019, z1 + 0.012, y, 0, 10), M.dark);
      } else {
        col.add(
          lathe(
            [
              [0, z0],
              [R * 0.92, z0],
              [R, z0 - 0.006],
              [R, z1 + 0.004],
              [R * 0.85, z1],
              [R * 0.45, z1],
              [R * 0.45, z1 + 0.01],
              [0, z1 + 0.01],
            ],
            18,
            y,
          ),
          M.phosphate,
        );
        for (let i = 0; i < 5; i++) {
          const a = -Math.PI / 2 + (i - 2) * 0.62 + Math.PI;
          const g = boxZ(0.0028, 0.0015, z0 - 0.02, z1 + 0.006, 0, R - 0.0004, 0.0003);
          g.rotateZ(a);
          g.translate(0, y, 0);
          col.add(g, M.dark);
        }
      }
      break;
    }
    case 'brake':
    case 'comp': {
      const w = R * 1.9;
      col.add(boxZ(w, w, z0, z1, 0, y, w * 0.28), M.phosphate);
      const ports = m.kind === 'brake' ? 3 : 2;
      for (let i = 0; i < ports; i++) {
        const zz = z0 - L * (0.25 + i * 0.22);
        if (m.kind === 'brake')
          for (const s of [-1, 1])
            col.add(boxZ(0.002, w * 0.6, zz, zz - L * 0.12, s * (w / 2 - 0.0007), y, 0.0004), M.dark);
        col.add(boxZ(w * 0.5, 0.002, zz, zz - L * 0.1, 0, y + w / 2 - 0.0007, 0.0004), M.dark);
      }
      col.add(cylZ(0.0035, z1 + 0.002, z1 - 0.0004, y, 0, 10), M.dark);
      break;
    }
    case 'booster':
      col.add(
        lathe(
          [
            [0, z0],
            [R * 0.62, z0],
            [R * 0.66, z0 - L * 0.25],
            [R * 0.86, z0 - L * 0.62],
            [R, z0 - L * 0.86],
            [R, z1],
            [R * 0.6, z1],
            [R * 0.5, z1 + 0.006],
            [0, z1 + 0.006],
          ],
          20,
          y,
        ),
        M.blued,
      );
      col.add(
        lathe(
          [
            [R * 0.66, z0 - 0.01],
            [R * 0.72, z0 - 0.012],
            [R * 0.66, z0 - 0.014],
          ],
          16,
          y,
        ),
        M.blued,
      );
      break;
    case 'suppressor':
    case 'integral': {
      const collar = m.kind === 'suppressor' ? 0.03 : 0;
      const cr = R * 0.8;
      col.add(
        lathe(
          [
            [0, z0 + 0.002],
            [threadR + 0.003, z0 + 0.002],
            [cr, z0 - 0.002],
            [cr, z0 - collar + 0.002],
            [R * 0.94, z0 - collar],
            [R, z0 - collar - 0.004],
            [R, z1 + 0.006],
            [R * 0.9, z1],
            [0.0055, z1],
            [0.0045, z1 + 0.004],
            [0, z1 + 0.004],
          ],
          24,
          y,
        ),
        M.can,
      );
      if (collar > 0)
        for (let i = 0; i < 3; i++)
          col.add(
            lathe(
              [
                [cr, z0 - 0.008 - i * 0.006],
                [cr + 0.0009, z0 - 0.009 - i * 0.006],
                [cr, z0 - 0.01 - i * 0.006],
              ],
              20,
              y,
            ),
            M.can,
          );
      col.add(cylZ(0.0046, z1 + 0.0035, z1 + 0.0005, y, 0, 10), M.dark);
      break;
    }
  }
}

// ------------------------------------------------------------------ buffer tube + AR-style stocks

export function bufferTube(c: Ctx, z0: number, z1: number) {
  const { M, B } = c;
  c.s.add(
    lathe(
      [
        [0, z0],
        [0.0146, z0],
        [0.0146, z1 + 0.003],
        [0.0136, z1],
        [0, z1],
      ],
      20,
      B,
    ),
    M.finish.black,
  );
  // Castle nut + end plate.
  c.s.add(
    lathe(
      [
        [0.0146, z0 + 0.0095],
        [0.0178, z0 + 0.009],
        [0.0178, z0 + 0.001],
        [0.0146, z0],
      ],
      20,
      B,
    ),
    M.phosphate,
  );
  c.s.add(rbox(0.03, 0.036, 0.0025, 0, B - 0.004, z0 + 0.001, 0.002), M.phosphate);
  // QD sling cup on the end plate (left).
  c.s.add(cylZ(0.0062, z0 + 0.0065, z0 - 0.0005, B - 0.012, -0.0135, 14), M.phosphate);
  c.s.add(cylZ(0.0036, z0 + 0.0068, z0 + 0.006, B - 0.012, -0.0135, 10), M.dark);
  // Keyway rib along the bottom (stock lock).
  c.s.add(boxZ(0.0075, 0.005, z0 + 0.008, z1 + 0.004, 0, B - 0.0148, 0.0008), M.finish.black);
}

/** Carbine/battery-box/brace stock on a buffer tube, butt rear at bz. */
export function tubeStock(c: Ctx, bz: number, style: 'carbine' | 'sopmod' | 'brace', col: Collector = c.s) {
  const { M, B } = c;
  const y0 = B; // tube axis
  if (style === 'brace') {
    const pts: P2[] = [
      [bz - 0.165, y0 + 0.017],
      [bz - 0.02, y0 + 0.021],
      [bz, y0 + 0.017],
      [bz, y0 - 0.062],
      [bz - 0.012, y0 - 0.08],
      [bz - 0.05, y0 - 0.062],
      [bz - 0.09, y0 - 0.03],
      [bz - 0.165, y0 - 0.019],
    ];
    const hole: P2[] = [
      [bz - 0.016, y0 - 0.03],
      [bz - 0.016, y0 - 0.062],
      [bz - 0.04, y0 - 0.052],
      [bz - 0.06, y0 - 0.03],
    ];
    col.add(profile(shape(pts, [hole]), 0.036, 0.004), M.polymer);
    for (const s of [-1, 1])
      col.add(
        xform(rbox(0.004, 0.06, 0.07, 0, 0, 0, 0.0015), {
          pos: [s * 0.02, y0 - 0.04, bz - 0.04],
          rot: [0, s * 0.12, 0],
        }),
        M.rubber,
      );
    return;
  }
  const pts: P2[] = [
    [bz - 0.152, y0 + 0.0165],
    [bz - 0.03, y0 + 0.0205],
    [bz - 0.006, y0 + 0.022],
    [bz, y0 + 0.019],
    [bz, y0 - 0.086],
    [bz - 0.007, y0 - 0.093],
    [bz - 0.03, y0 - 0.086],
    [bz - 0.072, y0 - 0.048],
    [bz - 0.1, y0 - 0.031],
    [bz - 0.152, y0 - 0.021],
  ];
  const hole: P2[] = [
    [bz - 0.02, y0 - 0.066],
    [bz - 0.02, y0 - 0.025],
    [bz - 0.06, y0 - 0.025],
  ];
  col.add(profile(shape(pts, [hole]), 0.038, 0.0045), M.polymer);
  col.add(boxZ(0.0395, 0.108, bz + 0.0025, bz - 0.008, 0, y0 - 0.034, 0.003), M.rubber);
  // Lock lever.
  col.add(boxZ(0.012, 0.006, bz - 0.115, bz - 0.15, 0, y0 - 0.023, 0.0015), M.polymer);
  if (style === 'sopmod')
    for (const s of [-1, 1]) {
      col.add(
        lathe(
          [
            [0, bz - 0.03],
            [0.0095, bz - 0.032],
            [0.0095, bz - 0.135],
            [0.006, bz - 0.148],
            [0, bz - 0.148],
          ],
          14,
          y0 + 0.003,
          s * 0.017,
        ),
        M.polymer,
      );
    }
}

export function mergeInto(col: Collector, gs: Parameters<typeof merge>[0], m: Material) {
  col.add(merge(gs), m);
}

export { sweep };
