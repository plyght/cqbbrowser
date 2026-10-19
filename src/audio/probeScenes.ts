/**
 * Tiny analytic ray caster over axis-aligned boxes, for unit tests and offline renders of the listener probe
 * without Rapier. Solid boxes block rays; a "room" is six slabs.
 */
import type { Surface } from '../core/bus';
import { PROBE_RANGE, probeDirections, type ProbeRay, type Vec3 } from './acoustics';

export interface Aabb {
  min: Vec3;
  max: Vec3;
  surface: Surface;
}

/** Ray vs AABB slab test; entry distance + entry-face axis, or Infinity. Rays starting inside are ignored. */
export function rayAabb(o: Vec3, d: Vec3, b: Aabb): { t: number; axis: 'x' | 'y' | 'z' } {
  let t0 = -Infinity,
    t1 = Infinity;
  let axis: 'x' | 'y' | 'z' = 'y';
  const miss = { t: Infinity, axis };
  for (const k of ['x', 'y', 'z'] as const) {
    if (Math.abs(d[k]) < 1e-9) {
      if (o[k] < b.min[k] || o[k] > b.max[k]) return miss;
      continue;
    }
    const a = (b.min[k] - o[k]) / d[k];
    const c = (b.max[k] - o[k]) / d[k];
    if (Math.min(a, c) > t0) {
      t0 = Math.min(a, c);
      axis = k;
    }
    t1 = Math.min(t1, Math.max(a, c));
  }
  return t1 >= t0 && t0 > 0 ? { t: t0, axis } : miss;
}

export function castScene(o: Vec3, boxes: Aabb[], dirs = probeDirections(), range = PROBE_RANGE): ProbeRay[] {
  return dirs.map((dir) => {
    let best = Infinity;
    let surface: Surface | undefined;
    let normal: Vec3 | undefined;
    for (const b of boxes) {
      const { t, axis } = rayAabb(o, dir, b);
      if (t < best) {
        best = t;
        surface = b.surface;
        normal = { x: 0, y: 0, z: 0, [axis]: -Math.sign(dir[axis]) };
      }
    }
    return best <= range ? { dir, dist: best, surface, normal } : { dir, dist: Infinity };
  });
}

/** Closed room of inner size w × d × h (x, z, y) with its floor at y = 0, centred on x/z = 0. */
export function room(w: number, d: number, h: number, surface: Surface = 'concrete', t = 0.2): Aabb[] {
  const W = w / 2,
    D = d / 2;
  return [
    { min: { x: -W - t, y: -t, z: -D - t }, max: { x: W + t, y: 0, z: D + t }, surface },
    { min: { x: -W - t, y: h, z: -D - t }, max: { x: W + t, y: h + t, z: D + t }, surface },
    { min: { x: -W - t, y: 0, z: -D - t }, max: { x: -W, y: h, z: D + t }, surface },
    { min: { x: W, y: 0, z: -D - t }, max: { x: W + t, y: h, z: D + t }, surface },
    { min: { x: -W, y: 0, z: -D - t }, max: { x: W, y: h, z: -D }, surface },
    { min: { x: -W, y: 0, z: D }, max: { x: W, y: h, z: D + t }, surface },
  ];
}

/** Room with a doorway (1 m wide, 2.1 m tall) cut into the +z wall. */
export function roomWithDoor(w: number, d: number, h: number, surface: Surface = 'concrete'): Aabb[] {
  const r = room(w, d, h, surface);
  const wall = r.pop()!;
  const D = d / 2;
  return [
    ...r,
    { min: { x: wall.min.x, y: 0, z: D }, max: { x: -0.5, y: h, z: wall.max.z }, surface },
    { min: { x: 0.5, y: 0, z: D }, max: { x: wall.max.x, y: h, z: wall.max.z }, surface },
    { min: { x: -0.5, y: 2.1, z: D }, max: { x: 0.5, y: h, z: wall.max.z }, surface },
  ];
}

/** The outdoor square range: gravel ground, dirt berms 6 m / 4 m high (matches src/world/Range.ts). */
export function outdoorRange(): Aabb[] {
  return [
    { min: { x: -200, y: -1, z: -200 }, max: { x: 200, y: 0, z: 200 }, surface: 'gravel' },
    { min: { x: -30, y: 0, z: -33 }, max: { x: 30, y: 6, z: -27 }, surface: 'berm' },
    { min: { x: -30, y: 0, z: -32 }, max: { x: -26, y: 4, z: 22 }, surface: 'berm' },
    { min: { x: 26, y: 0, z: -32 }, max: { x: 30, y: 4, z: 22 }, surface: 'berm' },
  ];
}
