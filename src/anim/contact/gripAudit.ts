import { readFileSync } from 'node:fs';
import { Matrix4, Vector3, type Bone } from 'three';
import type { WeaponModel } from '../../weapons/models';
import { GRIP_SHIP } from './grip';
import type { ArmsRig } from '../rig/ArmsRig';
import type { HandContact } from './HandContact';
import type { Side } from './handProxy';
import {
  HandObstacle,
  gloveRegions,
  measureGlove,
  triField,
  type GloveRegions,
  type Region,
  type RegionTruth,
} from './truth';

/**
 * Grip truth audit (headless): the kit weapons, the real rig, true glove-mesh vs weapon-mesh distances per hand
 * region at idle, ADS and under fire — raw clip vs the contact layer. Also judges the hold **side-aware**: each
 * holding pad must be on the right face of the gun (firing middle/ring/pinky on the front strap or the far
 * panel, never the near panel or the backstrap; the thumb over the far panel; the support fingers up the far side
 * of the handguard), with its normal opposed to that face.
 */

export const GRIP_WEAPONS = ['sb16', 'hb300', 'k47s', 'kp9', 'p17', 'p92'];
/** Weapons whose baked grip passed the visual gate (shipping on by default; CI holds them to the wrap rules). */
export const GRIP_SHIPPED: string[] = [...GRIP_SHIP];

/** Load the kit families from disk (headless), so `buildModel` assembles the Blender kit meshes. */
export async function loadHeadlessKit() {
  const { preloadWeaponAssets } = await import('../../weapons/models');
  const warn = console.warn;
  console.warn = () => {};
  await preloadWeaponAssets('public/', (p) => {
    const b = readFileSync(p);
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
  }).finally(() => (console.warn = warn));
}

/** Weapon face a normal points along, in the grip frame (firing hand) or the bore frame (support hand). */
export type Face = 'right' | 'left' | 'back' | 'front' | 'top' | 'bottom' | 'hand';

export function faceOf(n: Vector3, gripAngle: number | null): Face {
  const x = n.x;
  let fwd: number, up: number;
  if (gripAngle === null) {
    fwd = -n.z;
    up = n.y;
  } else {
    // Grip frame: up the grip (0, cos a, -sin a), back (0, sin a, cos a).
    up = n.y * Math.cos(gripAngle) - n.z * Math.sin(gripAngle);
    fwd = -(n.y * Math.sin(gripAngle) + n.z * Math.cos(gripAngle));
  }
  const ax = Math.abs(x),
    af = Math.abs(fwd),
    au = Math.abs(up);
  if (ax >= af && ax >= au) return x > 0 ? 'right' : 'left';
  if (af >= au) return fwd > 0 ? 'front' : 'back';
  return up > 0 ? 'top' : 'bottom';
}

export interface Pad {
  region: Region;
  d: number;
  face: Face;
  /** Pad normal · surface normal (≤ −0.3 = facing it). */
  facing: number;
  near: boolean;
}

/** The faces each holding region should touch (side-aware wrap rules). */
export const WRAP_RULES: Record<Side, Partial<Record<Region, Face[]>>> = {
  // Firing hand on the pistol grip: middle/ring/pinky round the front strap onto the far (left) panel, the thumb
  // over the left panel, the palm on the backstrap / right panel.
  R: {
    palm: ['back', 'right', 'bottom'],
    // Middle phalanges cross the front strap (its finger grooves / nub face up or down, the front-right corner
    // faces right); the tips end on the front strap or round on the far panel — never the backstrap / near panel.
    Middle2: ['front', 'left', 'right', 'top', 'bottom'],
    Middle3: ['front', 'left', 'top', 'bottom'],
    Ring2: ['front', 'left', 'right', 'top', 'bottom'],
    Ring3: ['front', 'left', 'top', 'bottom'],
    Pinky2: ['front', 'left', 'right', 'top', 'bottom'],
    Pinky3: ['front', 'left', 'top', 'bottom'],
    // The thumb tip rests on the far panel / over the top, or against the selector or bolt catch ahead of it.
    Thumb3: ['left', 'top', 'front'],
  },
  // Support hand on a handguard: fingers up the far (right) side, palm under or along the near side.
  L: {
    palm: ['bottom', 'left', 'right'],
    Index3: ['right', 'bottom', 'top'],
    Middle3: ['right', 'bottom'],
    // The ring and pinky follow the clip's style (curled under, or up the far side): not ruled.
  },
};

export interface HandTruth {
  side: Side;
  pads: Pad[];
  /** Worst penetration over every region (m, ≥ 0), and where. */
  pen: number;
  worst?: string;
}

export class GripTruth {
  readonly gloves: Record<Side, GloveRegions>;

  constructor(readonly rig: ArmsRig) {
    const canon = new Map<Bone, string>();
    for (const [n, b] of rig.boneMap) canon.set(b, n);
    const mesh = rig.meshes[0];
    this.gloves = { R: gloveRegions(mesh, canon, 'R'), L: gloveRegions(mesh, canon, 'L') };
    this.hand = new HandObstacle((n) => rig.boneMap.get(n)!);
  }

  readonly hand: HandObstacle;

  private field?: { model: WeaponModel; f: ReturnType<typeof triField> };

  /** Rebuild the weapon triangle field (weapon frame) for the model's current part pose. */
  refresh(model: WeaponModel) {
    model.root.updateMatrixWorld(true);
    const inv = new Matrix4().copy(model.root.matrixWorld).invert();
    this.field = { model, f: triField(model.root, inv) };
  }

  /**
   * Truth of one hand. The support hand also sees the firing hand as an obstacle (`withHand`, default on): a
   * two-hand pistol hold must not sink into the firing fingers either.
   */
  measure(model: WeaponModel, side: Side, withHand = side === 'L'): HandTruth {
    if (!this.field || this.field.model !== model) this.refresh(model);
    const inv = new Matrix4().copy(model.root.matrixWorld).invert();
    let extra: ((p: Vector3) => number) | undefined;
    if (withHand) {
      this.hand.update(inv);
      extra = this.hand.sdf;
    }
    const m = measureGlove(this.gloves[side], this.field!.f, inv, 0.03, extra);
    const gr = model.sockets.gripRight;
    const angle = side === 'R' ? (gr ? Math.abs(gr.rotation.x) : 0.33) : null;
    const pads: Pad[] = [];
    let pen = 0;
    let worst = '';
    for (const [region, t] of m) {
      pads.push(pad(region, t, angle));
      if (t.near && -t.d > pen) {
        pen = -t.d;
        worst = region;
      }
    }
    return { side, pads, pen, worst };
  }
}

function pad(region: Region, t: RegionTruth, angle: number | null): Pad {
  const hand = t.n.lengthSq() === 0;
  return {
    region,
    d: t.d,
    face: hand ? 'hand' : faceOf(t.n, angle),
    facing: hand ? -1 : t.pad.dot(t.n),
    near: t.near,
  };
}

/**
 * Side-aware wrap check of one hand: every ruled region within `gap` of one of its faces (penetration ≤ `pen`),
 * pad facing it. Returns the failures (empty = holding).
 */
export function wrapFailures(h: HandTruth, gap = 0.003, pen = 0.002): string[] {
  const out: string[] = [];
  const rules = WRAP_RULES[h.side];
  for (const p of h.pads) {
    const faces = rules[p.region];
    if (!faces) continue;
    const mm = (p.d * 1000).toFixed(1);
    if (!p.near || p.d > gap) out.push(`${h.side}.${p.region} gap ${mm} mm`);
    // The palm is soft: it may compress ~4.5 mm on the backstrap / handguard; finger pads ≤ `pen`.
    // A middle phalanx crossing the front-strap corner may press ≤ 3 mm.
    else if (p.d < -(p.region === 'palm' ? 0.0045 : p.region.endsWith('2') ? 0.003 : pen))
      out.push(`${h.side}.${p.region} pen ${mm} mm`);
    else if (!faces.includes(p.face)) out.push(`${h.side}.${p.region} on ${p.face}`);
    // Facing is judged on the tips (a middle phalanx's nearest vertex sits on its side at a groove).
    else if (p.region.endsWith('3') && p.facing > -0.3)
      out.push(`${h.side}.${p.region} not facing (${p.facing.toFixed(2)})`);
  }
  return out;
}

export type State = 'idle' | 'ads' | 'fire';

/** Pose the rig for a state (from rest) and run `each` per frame after the update (+ contact when enabled). */
export function runState(rig: ArmsRig, c: HandContact, state: State, each: (frame: number) => void) {
  const dt = 1 / 60;
  rig.play('idle', { fade: 0 });
  rig.update(0);
  if (c.enabled) c.apply(dt);
  const n = state === 'fire' ? 72 : 30;
  for (let i = 0; i < n; i++) {
    if (state === 'fire' && i % 6 === 0 && i < 60) rig.play('shoot');
    if (state === 'ads') {
      const k = Math.min(1, i / 15);
      rig.root.position.set(-0.11 * k, 0.08 * k, 0.06 * k);
      rig.root.updateMatrixWorld(true);
    }
    rig.update(dt);
    if (c.enabled) c.apply(dt);
    each(i);
  }
  rig.root.position.set(0, 0, 0);
  rig.root.updateMatrixWorld(true);
}

export interface StateRow {
  weapon: string;
  state: State;
  mode: string;
  /** Last frame's pads per hand, and the worst penetration over the run. */
  R: HandTruth;
  L: HandTruth;
  pen: number;
  fails: string[];
}

export function fmtPads(h: HandTruth): string {
  return h.pads
    .filter((p) => WRAP_RULES[h.side][p.region] || p.region === 'Index3' || p.region === 'Thumb2')
    .map(
      (p) =>
        `${p.region}:${p.near ? (p.d * 1000).toFixed(1) : '—'}${p.face[0]}${p.facing <= -0.3 ? '' : '!'}`,
    )
    .join(' ');
}
