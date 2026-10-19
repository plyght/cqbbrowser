import { Euler, Quaternion, Vector3 } from 'three';
import type { WeaponDef } from '../../weapons/defs';
import { rigParams } from './params';
import { recoilFor } from './recoil';
import { WeaponRigidBody, gainsFor } from './sim';

export interface HandlingReport {
  id: string;
  mass: number;
  /** Follow half-life (s) for a small (1°) step of the torso aim. */
  halfLife: number;
  /** 90° flick in 150 ms: peak lag (deg), overshoot past the target (deg), settle to 0.25° after the turn (s). */
  peakLag: number;
  overshoot: number;
  settle: number;
  /** 5-shot string at 0.15 s: mean muzzle rise per shot (deg) and recovery to 0.25° after the last (s). */
  risePerShot: number;
  recovery: number;
}

const DT = 1 / 240;
const HOLD = new Vector3(0.03, -0.2, -0.33);
const _e = new Euler(0, 0, 0, 'YXZ');
const _v = new Vector3();
const _w = new Vector3();
const _tq = new Quaternion();

function setTarget(b: WeaponRigidBody, yaw: number, pitch = 0) {
  _e.set(pitch, yaw, 0);
  _tq.setFromEuler(_e);
  b.targetQ.copy(_tq);
  b.targetPos.copy(HOLD).applyQuaternion(_tq);
}

/** Angle (deg) between the weapon's bore direction and the target's. */
function aimError(b: WeaponRigidBody, signed = false): number {
  _v.set(0, 0, -1).applyQuaternion(b.q);
  _w.set(0, 0, -1).applyQuaternion(b.targetQ);
  const a = (Math.acos(Math.min(1, Math.max(-1, _v.dot(_w)))) * 180) / Math.PI;
  if (!signed) return a;
  // Sign: positive when the bore lags (hasn't reached) a turn to the right (−yaw).
  return _v.clone().cross(_w).y >= 0 ? a : -a;
}

function pitchError(b: WeaponRigidBody): number {
  _v.set(0, 0, -1).applyQuaternion(b.q);
  _w.set(0, 0, -1).applyQuaternion(b.targetQ);
  return ((Math.asin(_v.y) - Math.asin(_w.y)) * 180) / Math.PI;
}

function makeBody(def: WeaponDef, ads = 0) {
  const b = new WeaponRigidBody(rigParams(def));
  b.gains = gainsFor({ ads, fatigue: 0, inertia: 1, crouch: 0 });
  setTarget(b, 0);
  b.reset();
  return b;
}

export function characterise(id: string, def: WeaponDef): HandlingReport {
  // Half-life: 1° step.
  let b = makeBody(def);
  const step = (1 * Math.PI) / 180;
  setTarget(b, -step);
  let halfLife = 0;
  for (let t = 0; t < 1; t += DT) {
    b.step(DT);
    if (aimError(b) <= 0.5) {
      halfLife = t + DT;
      break;
    }
  }

  // 90° flick to the right in 150 ms.
  b = makeBody(def);
  const T = 0.15;
  const goal = -Math.PI / 2;
  let peakLag = 0,
    overshoot = 0,
    t = 0;
  for (; t < T; t += DT) {
    setTarget(b, goal * Math.min(1, (t + DT) / T));
    b.step(DT);
    peakLag = Math.max(peakLag, aimError(b));
  }
  setTarget(b, goal);
  let lastOut = 0;
  for (let s = 0; s < 1.5; s += DT) {
    b.step(DT);
    const e = aimError(b, true);
    peakLag = Math.max(peakLag, e);
    overshoot = Math.max(overshoot, -e);
    if (Math.abs(e) > 0.25) lastOut = s + DT;
  }
  const settle = lastOut;

  // 5-shot string.
  b = makeBody(def);
  const rec = recoilFor(def);
  let rise = 0;
  let after = 0;
  for (let shot = 0; shot < 5; shot++) {
    b.recoil(rec.profile, rec.impulseNs, 0);
    let peak = 0;
    const gap = shot < 4 ? 0.15 : 1.5;
    for (let s = 0; s < gap; s += DT) {
      b.step(DT);
      peak = Math.max(peak, s < 0.15 ? pitchError(b) : 0);
      if (shot === 4 && aimError(b) > 0.25) after = s + DT;
    }
    rise += peak;
  }
  return {
    id,
    mass: def.mass,
    halfLife,
    peakLag,
    overshoot,
    settle,
    risePerShot: rise / 5,
    recovery: after,
  };
}

export function formatTable(rows: HandlingReport[]): string {
  const h =
    '| build | kg | half-life ms | 90° peak lag ° | overshoot ° | settle ms | rise/shot ° | recovery ms |';
  const sep = '|---|---|---|---|---|---|---|---|';
  const lines = rows.map(
    (r) =>
      `| ${r.id} | ${r.mass.toFixed(2)} | ${(r.halfLife * 1000).toFixed(0)} | ${r.peakLag.toFixed(1)} | ${r.overshoot.toFixed(2)} | ${(r.settle * 1000).toFixed(0)} | ${r.risePerShot.toFixed(2)} | ${(r.recovery * 1000).toFixed(0)} |`,
  );
  return [h, sep, ...lines].join('\n');
}
