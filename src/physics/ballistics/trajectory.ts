import type { Cartridge, DragModel } from '../../weapons/ammo/types';
import { muzzleVelocity } from '../../weapons/ammo/interior';
import { ISA, type Atmosphere } from './atmosphere';
import { dragDecel } from './drag';

/**
 * External ballistics: point-mass flight with gravity + standard-model drag, integrated with RK4.
 * Pure math, no three.js; the state is a plain mutable record so the hot path allocates nothing.
 * World frame: metres, y up.
 */

export const G = 9.80665;

export interface FlightParams {
  model: DragModel;
  /** lb/in² for `model`. */
  bc: number;
  density: number;
  soundSpeed: number;
  /** Tumbling/yawed bullets drag more (1 = stable). */
  dragMul: number;
  /** Wind (air velocity), m/s. */
  windX: number;
  windY: number;
  windZ: number;
}

export interface FlightState {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** Time since the muzzle, s. */
  t: number;
  /** Path length flown, m. */
  dist: number;
}

export const newFlightState = (): FlightState => ({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, t: 0, dist: 0 });

export function flightParams(c: Cartridge, atm: Atmosphere = ISA, p?: FlightParams): FlightParams {
  const out = p ?? ({} as FlightParams);
  const has = c.bc[c.drag] !== undefined;
  out.model = has ? c.drag : 'G1';
  out.bc = has ? c.bc[c.drag]! : c.bc.G1;
  out.density = atm.density;
  out.soundSpeed = atm.soundSpeed;
  out.dragMul = 1;
  out.windX = out.windY = out.windZ = 0;
  return out;
}

// RK4 scratch (module-level: single-threaded sim, no allocation).
const K = new Float64Array(24);

function accel(p: FlightParams, vx: number, vy: number, vz: number, out: Float64Array, o: number) {
  const rx = vx - p.windX,
    ry = vy - p.windY,
    rz = vz - p.windZ;
  const v = Math.sqrt(rx * rx + ry * ry + rz * rz);
  const k = v > 1e-6 ? dragDecel(p.model, p.bc, v, p.density, p.soundSpeed, p.dragMul) / v : 0;
  out[o] = -k * rx;
  out[o + 1] = -k * ry - G;
  out[o + 2] = -k * rz;
}

/** One RK4 step of `dt` seconds, in place. */
export function rk4Step(s: FlightState, p: FlightParams, dt: number) {
  const { vx, vy, vz } = s;
  // k1
  accel(p, vx, vy, vz, K, 0);
  const v1x = vx,
    v1y = vy,
    v1z = vz;
  // k2
  const v2x = vx + 0.5 * dt * K[0],
    v2y = vy + 0.5 * dt * K[1],
    v2z = vz + 0.5 * dt * K[2];
  accel(p, v2x, v2y, v2z, K, 3);
  // k3
  const v3x = vx + 0.5 * dt * K[3],
    v3y = vy + 0.5 * dt * K[4],
    v3z = vz + 0.5 * dt * K[5];
  accel(p, v3x, v3y, v3z, K, 6);
  // k4
  const v4x = vx + dt * K[6],
    v4y = vy + dt * K[7],
    v4z = vz + dt * K[8];
  accel(p, v4x, v4y, v4z, K, 9);
  const nx = s.x + (dt / 6) * (v1x + 2 * v2x + 2 * v3x + v4x);
  const ny = s.y + (dt / 6) * (v1y + 2 * v2y + 2 * v3y + v4y);
  const nz = s.z + (dt / 6) * (v1z + 2 * v2z + 2 * v3z + v4z);
  s.dist += Math.hypot(nx - s.x, ny - s.y, nz - s.z);
  s.x = nx;
  s.y = ny;
  s.z = nz;
  s.vx += (dt / 6) * (K[0] + 2 * K[3] + 2 * K[6] + K[9]);
  s.vy += (dt / 6) * (K[1] + 2 * K[4] + 2 * K[7] + K[10]);
  s.vz += (dt / 6) * (K[2] + 2 * K[5] + 2 * K[8] + K[11]);
  s.t += dt;
}

export const speedOf = (s: FlightState) => Math.sqrt(s.vx * s.vx + s.vy * s.vy + s.vz * s.vz);

/**
 * Integrate for `duration` seconds in sub-steps no longer than `maxStepM` metres of flight (drag changes
 * slowly over a few metres, so RK4 at 2.5 m is accurate to well under a millimetre at CQB/range distances).
 */
export function integrate(s: FlightState, p: FlightParams, duration: number, maxStepM = 2.5) {
  let left = duration;
  while (left > 1e-9) {
    const v = Math.max(1, speedOf(s));
    const dt = Math.min(left, maxStepM / v);
    rk4Step(s, p, dt);
    left -= dt;
  }
}

/**
 * Longest time step (s) for which a straight chord stays within `tol` metres of the curved path. Gravity
 * dominates curvature at CQB speeds: sagitta ≈ g·Δt²/8.
 */
export const chordTime = (tol = 0.005) => Math.sqrt((8 * tol) / G);

// ---------------------------------------------------------------- flat-fire 2D solutions (tables, zeroing)

export interface RangePoint {
  /** Height relative to the bore line's origin (m), + up. */
  y: number;
  /** Time of flight (s). */
  tof: number;
  /** Remaining speed (m/s). */
  v: number;
}

const S2 = newFlightState();
const P2 = {} as FlightParams;

/**
 * Fly a shot fired at `angle` (rad above horizontal) with `v0` and report it when it reaches horizontal
 * range `range`. Interpolated within the last sub-step.
 */
export function flyTo(
  c: Cartridge,
  v0: number,
  angle: number,
  range: number,
  atm: Atmosphere = ISA,
): RangePoint {
  flightParams(c, atm, P2);
  const s = S2;
  s.x = s.y = s.z = s.t = s.dist = 0;
  s.vx = 0;
  s.vy = v0 * Math.sin(angle);
  s.vz = -v0 * Math.cos(angle);
  let px = 0,
    py = 0,
    pt = 0,
    pv = v0;
  for (let i = 0; i < 100000 && -s.z < range; i++) {
    px = -s.z;
    py = s.y;
    pt = s.t;
    pv = speedOf(s);
    const dt = Math.min(0.002, 0.5 / Math.max(1, pv));
    rk4Step(s, P2, dt);
  }
  const x1 = -s.z;
  const f = x1 > px ? (range - px) / (x1 - px) : 1;
  return { y: py + (s.y - py) * f, tof: pt + (s.t - pt) * f, v: pv + (speedOf(s) - pv) * f };
}

/**
 * Bore angle (rad, bore above the sight line) that puts the trajectory back on the line of sight at
 * `zero` metres for a sight `sightHeight` m over the bore. The handling/ADS layer tilts the sight line down
 * (or the bore up) by this. `v0` defaults to the cartridge's 16" velocity — pass the build's real one.
 */
export function computeBoreAngle(
  zero: number,
  sightHeight: number,
  ammo: Cartridge,
  v0 = muzzleVelocity(ammo, 16),
  atm: Atmosphere = ISA,
): number {
  // The sight line is horizontal at +sightHeight; find θ so y(zero) = sightHeight. Secant on θ.
  let a0 = 0,
    a1 = Math.atan2(sightHeight, zero) + 0.002;
  let e0 = flyTo(ammo, v0, a0, zero, atm).y - sightHeight;
  let e1 = flyTo(ammo, v0, a1, zero, atm).y - sightHeight;
  for (let i = 0; i < 30 && Math.abs(e1) > 1e-6; i++) {
    const a2 = a1 - (e1 * (a1 - a0)) / (e1 - e0 || 1e-12);
    a0 = a1;
    e0 = e1;
    a1 = a2;
    e1 = flyTo(ammo, v0, a1, zero, atm).y - sightHeight;
  }
  return a1;
}

/**
 * Point of impact relative to the line of sight (m, + = high) at `range` for a zeroed bore angle.
 * Close in, rounds hit about one sight height low (mechanical offset).
 */
export function pointOfImpact(
  range: number,
  sightHeight: number,
  boreAngle: number,
  ammo: Cartridge,
  v0: number,
  atm: Atmosphere = ISA,
): RangePoint {
  const r = flyTo(ammo, v0, boreAngle, range, atm);
  return { y: r.y - sightHeight, tof: r.tof, v: r.v };
}
