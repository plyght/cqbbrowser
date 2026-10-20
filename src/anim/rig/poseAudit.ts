import { Matrix4, Quaternion, Vector3, type Object3D } from 'three';
import type { WeaponModel } from '../../weapons/models';
import type { ArmsAction } from '../library/library';
import type { ArmsRig } from './ArmsRig';

/**
 * Pose-continuity audit (headless): drives the ArmsRig through scripted scenarios at 60 Hz — every clip, loop
 * wraps, shot strings, shots that cut into shots, fire out of an inspect / reload, mag checks with a hold, swaps
 * and a reversed swap — and measures every arm / hand / finger bone and the gun in the rig-root frame (so arm IK,
 * the contact layer and the gun placement all count):
 *
 *  - ω: angular velocity, deg/frame; for the hands and the gun also the linear velocity, mm/frame.
 *  - **pop**: how much faster a frame moves than the motion two frames either side,
 *    `v[t] − max(v[t−2], v[t+2])`. A one-frame discontinuity (loop seam, a layer that restarts or drops, a
 *    crossfade that snaps, a solver flipping between two answers) is a large pop; fast authored motion (a slap,
 *    a mag strip) is fast on its neighbours too and pops little.
 *  - |Δω|: the rotation-vector second difference, deg/frame², printed for reference.
 */

export interface Step {
  /** Frame index at which to call `act`. */
  at: number;
  act: (rig: ArmsRig) => void;
}

export interface Scenario {
  name: string;
  frames: number;
  steps: Step[];
}

export interface SpikeRow {
  weapon: string;
  scenario: string;
  /** Largest angular pop (deg/frame) over all tracked bones and the gun, and where. */
  pop: number;
  popAt: string;
  popFrame: number;
  /** Largest linear pop of the hands / gun (mm/frame), and where. */
  popMm: number;
  popMmAt: string;
  popMmFrame: number;
  /** Largest |Δω| (deg/frame²) and ω (deg/frame). */
  maxAcc: number;
  maxVel: number;
  /** Per frame (when requested): the largest angular pop and its bone, the largest linear pop. */
  frames?: { pop: number; bone: string; mm: number; at: string; action: string }[];
}

const play =
  (a: ArmsAction, o: Parameters<ArmsRig['play']>[1] = {}) =>
  (r: ArmsRig) =>
    r.play(a, o);

/** Scenarios for one weapon (60 Hz frames). `other` builds a second model for swaps. */
export function scenarios(rig: ArmsRig, weaponId: string, other: () => WeaponModel): Scenario[] {
  const f = (a: ArmsAction) => Math.ceil(rig.duration(a, weaponId) * 60);
  const pistol = weaponId === 'p17';
  const cadence = pistol ? 10 : 6;
  const shots = (n: number, from: number, every = cadence): Step[] =>
    Array.from({ length: n }, (_, i) => ({ at: from + i * every, act: play('shoot') }));
  const one = (a: ArmsAction, o?: Parameters<ArmsRig['play']>[1]): Scenario => ({
    name: a,
    frames: f(a) + 40,
    steps: [{ at: 10, act: play(a, o) }],
  });
  return [
    { name: 'idle (3 loops)', frames: Math.max(240, f('idle') * 3 + 10), steps: [] },
    one('shoot'),
    one('shootLast'),
    { name: 'shot string', frames: 30 * cadence + 40, steps: shots(30, 10) },
    // Fast follow-ups: every shot cuts into the previous one's kick.
    { name: 'rapid string', frames: 20 * 4 + 40, steps: shots(20, 10, 4) },
    one('reloadTactical'),
    one('reloadEmpty'),
    {
      name: 'magCheck (hold)',
      frames: f('magCheck') + 100,
      steps: [
        { at: 10, act: play('magCheck', { hold: true }) },
        { at: 10 + Math.round(f('magCheck') / 2) + 40, act: (r) => r.releaseHold() },
      ],
    },
    one('inspect'),
    { name: 'inspect → fire', frames: 120, steps: [{ at: 10, act: play('inspect') }, ...shots(3, 50)] },
    {
      name: 'reload → fire',
      frames: f('reloadTactical') + 60,
      steps: [{ at: 10, act: play('reloadTactical') }, ...shots(3, f('reloadTactical') + 14)],
    },
    {
      name: 'swap out → in',
      frames: f('swapOut') + f('swapIn') + 60,
      steps: [{ at: 10, act: (r) => r.swapTo(other(), weaponId) }],
    },
    {
      name: 'swap reversed mid-way',
      frames: f('swapOut') + f('swapIn') + 80,
      steps: [
        { at: 10, act: (r) => r.swapTo(other(), weaponId) },
        { at: 10 + Math.floor(f('swapOut') / 2), act: (r) => r.swapTo(other(), weaponId) },
      ],
    },
  ];
}

const DEG = 180 / Math.PI;
const _q = new Quaternion();
const _qi = new Quaternion();
const _p = new Vector3();
const _s = new Vector3();
const _w = new Vector3();
const _inv = new Matrix4();
const _m = new Matrix4();

/** Rotation vector (axis × angle, rad) of q (shortest arc). */
function rotVec(q: Quaternion, out: Vector3): Vector3 {
  const sign = q.w < 0 ? -1 : 1;
  const w = Math.min(1, Math.abs(q.w));
  const s = Math.sqrt(Math.max(0, 1 - w * w));
  if (s < 1e-9) return out.set(0, 0, 0);
  const k = (2 * Math.acos(w) * sign) / s;
  return out.set(q.x * k, q.y * k, q.z * k);
}

interface Track {
  name: string;
  obj: () => Object3D | undefined;
  q: Quaternion;
  p: Vector3;
  w: Vector3;
  /** Per frame: angular velocity (deg/frame), linear velocity (mm/frame), |Δω| (deg/frame²). */
  vel: number[];
  lin: number[];
  acc: number[];
  linear: boolean;
}

/**
 * Run one scenario and measure it. `post(dt)` runs after `rig.update` every frame (the contact layer, arm
 * layers) — what the game renders.
 */
export function runScenario(
  rig: ArmsRig,
  weaponId: string,
  model: WeaponModel,
  sc: Scenario,
  post?: (dt: number) => void,
  perFrame = false,
): SpikeRow {
  rig.attachWeapon(model, weaponId);
  rig.play('idle', { fade: 0 });
  rig.update(0);
  post?.(1 / 60);
  const mk = (name: string, obj: () => Object3D | undefined, linear = false): Track => ({
    name,
    obj,
    q: new Quaternion(),
    p: new Vector3(),
    w: new Vector3(),
    vel: [],
    lin: [],
    acc: [],
    linear,
  });
  const tracks: Track[] = [];
  for (const [n, b] of rig.boneMap)
    if (/Arm|Hand|Shoulder/.test(n)) tracks.push(mk(n, () => b, n === 'LeftHand' || n === 'RightHand'));
  tracks.push(mk('gun', () => rig.weaponModel?.root, true));
  const actions: string[] = [];
  for (let i = 0; i < sc.frames; i++) {
    for (const s of sc.steps) if (s.at === i) s.act(rig);
    rig.update(1 / 60);
    post?.(1 / 60);
    actions.push(rig.action);
    _inv.copy(rig.root.matrixWorld).invert();
    for (const t of tracks) {
      const o = t.obj();
      if (!o) {
        t.vel.push(0);
        t.lin.push(0);
        t.acc.push(0);
        continue;
      }
      _m.multiplyMatrices(_inv, o.matrixWorld);
      _m.decompose(_p, _q, _s);
      if (i === 0) {
        t.vel.push(0);
        t.lin.push(0);
        t.acc.push(0);
      } else {
        _qi.copy(t.q).invert().premultiply(_q);
        rotVec(_qi, _w);
        t.vel.push(_w.length() * DEG);
        t.lin.push(_p.distanceTo(t.p) * 1000);
        t.acc.push(i > 1 ? _s.subVectors(_w, t.w).length() * DEG : 0);
        t.w.copy(_w);
      }
      t.q.copy(_q);
      t.p.copy(_p);
    }
  }
  const row: SpikeRow = {
    weapon: weaponId,
    scenario: sc.name,
    pop: 0,
    popAt: '',
    popFrame: -1,
    popMm: 0,
    popMmAt: '',
    popMmFrame: -1,
    maxAcc: 0,
    maxVel: 0,
    frames: perFrame ? actions.map((action) => ({ pop: 0, bone: '', mm: 0, at: '', action })) : undefined,
  };
  const popOf = (v: number[], i: number) => v[i] - Math.max(v[i - 2] ?? 0, v[i + 2] ?? 0);
  // The swap's weapon change replaces the gun object: its own frame-to-frame jump is not a pose pop.
  const swapFrames = new Set<number>();
  for (let i = 1; i < actions.length; i++) if (actions[i] === 'swapIn' && actions[i - 1] !== 'swapIn') swapFrames.add(i);
  for (const t of tracks)
    for (let i = 2; i < sc.frames; i++) {
      if (t.name === 'gun' && swapFrames.has(i)) continue;
      row.maxVel = Math.max(row.maxVel, t.vel[i]);
      row.maxAcc = Math.max(row.maxAcc, t.acc[i]);
      const a = popOf(t.vel, i);
      if (a > row.pop) {
        row.pop = a;
        row.popAt = t.name;
        row.popFrame = i;
      }
      const fr = row.frames?.[i];
      if (fr && a > fr.pop) {
        fr.pop = a;
        fr.bone = t.name;
      }
      if (!t.linear) continue;
      const l = popOf(t.lin, i);
      if (l > row.popMm) {
        row.popMm = l;
        row.popMmAt = t.name;
        row.popMmFrame = i;
      }
      if (fr && l > fr.mm) {
        fr.mm = l;
        fr.at = t.name;
      }
    }
  return row;
}

export function formatSpikes(rows: SpikeRow[], title: string): string {
  const lines = [
    title,
    'weapon  scenario                   pop °/f  bone@frame                pop mm/f  at@frame      max|Δω| °/f²  max ω °/f',
  ];
  for (const r of rows)
    lines.push(
      `${r.weapon.padEnd(7)} ${r.scenario.padEnd(25)} ${r.pop.toFixed(2).padStart(8)}  ${`${r.popAt}@${r.popFrame}`.padEnd(24)} ${r.popMm.toFixed(2).padStart(9)}  ${`${r.popMmAt}@${r.popMmFrame}`.padEnd(13)} ${r.maxAcc.toFixed(2).padStart(12)} ${r.maxVel.toFixed(2).padStart(10)}`,
    );
  return lines.join('\n');
}
