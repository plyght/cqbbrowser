import { Matrix4, Quaternion, Vector3, type Bone, type SkinnedMesh } from 'three';
import type { WeaponModel } from '../../weapons/models';
import type { ArmsRig } from '../rig/ArmsRig';
import {
  applySupport,
  type GripBake,
  type JointDelta,
  type SupportBake,
  type SupportGrip,
  type V3,
} from './grip';
import { faceOf } from './gripAudit';
import { FINGERS, type Side } from './handProxy';
import {
  HandObstacle,
  closest,
  triField,
  type Closest,
  type GloveRegions,
  type Region,
  type TriField,
} from './truth';

/**
 * Baked per-weapon grip solve against the **true meshes** (glove skin vs the weapon's render triangles), run
 * offline (`bun tools/grip-bake.ts`) into `gripData.json`; the runtime only blends the result in (HandContact).
 *
 * With the rig at idle frame 0:
 *  1. **Seat** — a rigid correction of the gun relative to the firing hand (≤ 5 mm, ≤ 3°) that takes the palm out
 *     of the grip and leaves it touching the backstrap / right panel.
 *  2. **Firing fingers** (hand-poser): open just enough to clear, then close all joints together; a phalanx that
 *     touches freezes its joint and the ones before it, a distal phalanx that touches first rolls back, so the
 *     finger wraps the front strap instead of stopping at the tip. Anatomical joint limits throughout. A finger
 *     that finds nothing to touch keeps the clip's angles (never curls into air). The index lies along the frame
 *     (straightened until clear, knuckle closed to touch) and gets a separate trigger-pull curl to the blade.
 *  3. **Support hand** per grip style — the hold offset/turn (two-bone IK target) that clears the palm and keeps
 *     it on the handguard (or foregrip / magwell), then the same finger wrap.
 *
 * Joint deltas are stored as (bone, axis in the parent bone's frame, angle): the runtime rotates the clip's pose by
 * them each frame, weighted by the hold, so they follow the authored motion.
 */

/** What a finger should touch (per phalanx pad weight), on which faces, how close to the clip / straight. */
export interface FingerGoal {
  contact: [number, number, number];
  /** Cost of the distal pad's contact face (absent faces cost 40). */
  faces?: Record<string, number>;
  straight?: [number, number, number];
  reg?: number;
  /** Contact by the single closest pad vertex instead of the pad area (the trigger blade). */
  point?: boolean;
  /** Allowed press of the middle / distal phalanx into the surface (mm, default 0.3). */
  press?: number;
  /** Joints kept at the clip (e.g. the thumb's metacarpal: it drags the web of the hand into the grip). */
  lock?: [boolean, boolean, boolean];
  /** Largest contact gap that still pulls (mm, default 10). */
  cap?: number;
  /** Start (and regularisation centre) delta, incl. abduction; default the clip. */
  start?: number[];
  /** Fit the knuckle's side-to-side too (within ± abdMax rad, default 0.25). */
  abd?: boolean;
  abdMax?: number;
  /** Field the contact pads aim at (default the whole weapon; e.g. the trigger blade). */
  contactField?: TriField;
  /** Extra cost factor for opening PIP / DIP (default 2.5). */
  openCost?: number;
  /** Penetration weight per phalanx (the thumb metacarpal is mostly the seat's job). */
  penW?: [number, number, number];
  /** Count any vertex of the phalanx as its contact (a finger lying along a frame touches with its side). */
  anyVertex?: [boolean, boolean, boolean];
}

const MAXD = 0.025;
/** Firing-finger fit style (GRIP_STYLE=knuckle keeps the knuckles near the clip and lets the base phalanx press). */
const FIRING_STYLE: Partial<FingerGoal> =
  typeof process !== 'undefined' && process.env?.GRIP_STYLE === 'knuckle'
    ? { openCost: 10, penW: [0.15, 1, 1] }
    : {};
const SEAT_ROT = Number((typeof process !== 'undefined' && process.env?.GRIP_SEAT_ROT) || 0.05);
const KNUCKLE_W = Number((typeof process !== 'undefined' && process.env?.GRIP_KNUCKLE) || 1);
/** Largest gun move in the firing hand (mm); GRIP_SEAT_MM overrides it for registration experiments. */
const SEAT_MM = Number((typeof process !== 'undefined' && process.env?.GRIP_SEAT_MM) || 5);

/** Per-joint anatomical flexion range (absolute, rad; + = curl), MCP / PIP / DIP. Thumb: CMC / MCP / IP. */
const ABS: Record<string, [number, number][]> = {
  finger: [
    [-0.35, 1.65],
    [-0.05, 1.9],
    [-0.1, 1.4],
  ],
  thumb: [
    [-0.6, 1.0],
    [-0.3, 1.2],
    [-0.3, 1.3],
  ],
};
/** Largest change relative to the clip per joint (keeps the authored character), rad. */
const REL: [number, number][] = [
  [-0.7, 0.6],
  [-1.0, 0.9],
  [-0.9, 0.8],
];

const _v = new Vector3();
const _w = new Vector3();
const _q = new Quaternion();
const _q2 = new Quaternion();
const _hit: Closest = { d: 0, q: new Vector3(), n: new Vector3(), tri: -1 };

interface Joint {
  bone: Bone;
  /** Authored local rotation (clip, idle frame 0). */
  q0: Quaternion;
  /** Flexion axis in the parent bone's frame (+ = curl toward the palm). */
  axis: Vector3;
  /** Authored absolute flexion (rad). */
  flex0: number;
  lim: [number, number];
}

export interface Chain {
  side: Side;
  finger: number;
  joints: Joint[];
  /** Collision vertices per phalanx (knuckle excluded) and pad vertices per phalanx. */
  verts: number[][];
  pads: number[][];
  delta: number[];
  /** Knuckle abduction axis (parent frame). */
  abd: Vector3;
}

export class GripSolver {
  readonly mesh: SkinnedMesh;
  toWeapon = new Matrix4();
  field: TriField;
  /** Trigger blade only (the index pad target while firing). */
  trigField?: TriField;
  readonly chains: Record<Side, Chain[]>;
  evals = 0;

  constructor(
    readonly rig: ArmsRig,
    readonly model: WeaponModel,
    readonly gloves: Record<Side, GloveRegions>,
  ) {
    this.mesh = rig.meshes[0];
    this.sync();
    this.field = triField(model.root, this.toWeapon);
    const trig = model.parts.trigger;
    if (trig) this.trigField = triField(trig, this.toWeapon);
    this.chains = { R: this.makeChains('R'), L: this.makeChains('L') };
  }

  sync() {
    this.rig.root.updateMatrixWorld(true);
    this.toWeapon.copy(this.model.root.matrixWorld).invert();
  }

  bone(side: Side, name: string): Bone {
    const b = this.rig.boneMap.get(`${side === 'R' ? 'Right' : 'Left'}${name}`);
    if (!b) throw new Error(`grip bake: no bone ${name}`);
    return b;
  }

  /** World palm normal (out of the palm, toward curled fingertips), as HandProxy. */
  palmNormal(side: Side, out: Vector3): Vector3 {
    const o = this.bone(side, 'Hand').getWorldPosition(new Vector3());
    const u = this.bone(side, 'HandMiddle1').getWorldPosition(new Vector3()).sub(o).normalize();
    const w = this.bone(side, 'HandIndex1')
      .getWorldPosition(new Vector3())
      .sub(this.bone(side, 'HandPinky1').getWorldPosition(new Vector3()));
    w.addScaledVector(u, -w.dot(u)).normalize();
    return out
      .crossVectors(u, w)
      .multiplyScalar(side === 'R' ? -1 : 1)
      .normalize();
  }

  private makeChains(side: Side): Chain[] {
    const g = this.gloves[side];
    return FINGERS.map((f, fi) => {
      const joints: Joint[] = [];
      for (let j = 0; j < 3; j++) {
        const bone = this.bone(side, `Hand${f}${j + 1}`);
        joints.push({
          bone,
          q0: bone.quaternion.clone(),
          axis: new Vector3(),
          flex0: 0,
          lim: (fi === 0 ? ABS.thumb : ABS.finger)[j],
        });
      }
      const verts: number[][] = [];
      const pads: number[][] = [];
      for (let j = 0; j < 3; j++) {
        const r = `${f}${j + 1}` as Region;
        let all = g.all.get(r) ?? [];
        if (j === 0) {
          // The knuckle belongs to the rigid hand: skip vertices within 11 mm of the MCP joint.
          const c = joints[0].bone.getWorldPosition(new Vector3());
          all = all.filter((i) => this.vertWorld(i, _v).distanceTo(c) > 0.011);
          // Palm skin the knuckle drags along (≥ 10 % weight on this phalanx): it must stay out of the grip too.
          const bi = this.mesh.skeleton.bones.indexOf(joints[0].bone);
          const SI = this.mesh.geometry.attributes.skinIndex,
            SW = this.mesh.geometry.attributes.skinWeight;
          for (const i of fi > 0 ? (g.all.get('palm') ?? []) : [])
            for (let k = 0; k < 4; k++)
              if (SI.getComponent(i, k) === bi && SW.getComponent(i, k) >= 0.1) all.push(i);
        }
        verts.push(all);
        pads.push(g.pads.get(r) ?? []);
      }
      const ch: Chain = { side, finger: fi, joints, verts, pads, delta: [0, 0, 0], abd: new Vector3() };
      this.measureAxes(ch);
      return ch;
    });
  }

  /** Flexion axes (parent frame) and authored absolute flexion of a chain at its current pose. */
  private measureAxes(ch: Chain) {
    const n = this.palmNormal(ch.side, new Vector3());
    const hand = this.bone(ch.side, 'Hand');
    const dirs: Vector3[] = [];
    const prevs: Vector3[] = [];
    // The curl sense: the chain's own bends (a finger round a grip is flexed), else the palm normal.
    const ref = new Vector3();
    for (let j = 0; j < 3; j++) {
      const a = ch.joints[j].bone.getWorldPosition(new Vector3());
      dirs.push(this.nextJoint(ch, j, new Vector3()).sub(a).normalize());
      prevs.push(
        j === 0
          ? a.clone().sub(hand.getWorldPosition(new Vector3())).normalize()
          : a
              .clone()
              .sub(ch.joints[j - 1].bone.getWorldPosition(new Vector3()))
              .normalize(),
      );
      if (j > 0 || ch.finger === 0) ref.add(new Vector3().crossVectors(prevs[j], dirs[j]));
    }
    const across = this.bone(ch.side, 'HandIndex1')
      .getWorldPosition(new Vector3())
      .sub(this.bone(ch.side, 'HandPinky1').getWorldPosition(new Vector3()))
      .normalize();
    const nref = new Vector3().crossVectors(n, dirs[1]);
    if (ref.length() < 0.2) ref.copy(nref);
    for (let j = 0; j < 3; j++) {
      const J = ch.joints[j];
      const dir = dirs[j],
        prev = prevs[j];
      // Fingers hinge about the knuckle line (index → pinky), made perpendicular to the phalanx: a palm-normal
      // based axis degenerates once a finger is curled 90° round a grip. The thumb keeps the palm-normal axis.
      const axis =
        ch.finger > 0
          ? across.clone().addScaledVector(dir, -across.dot(dir))
          : new Vector3().crossVectors(n, dir);
      if (axis.lengthSq() < 1e-8) axis.copy(ref);
      axis.normalize();
      if (axis.dot(ref) < 0) axis.negate();
      // Absolute flexion: signed angle prev → dir about the axis.
      const s = new Vector3().crossVectors(prev, dir).dot(axis);
      J.flex0 = Math.atan2(s, prev.dot(dir));
      J.bone.parent!.getWorldQuaternion(_q);
      J.axis.copy(axis).applyQuaternion(_q.invert());
      // Knuckle side-to-side (abduction): about the palm normal.
      if (j === 0) ch.abd.copy(n).applyQuaternion(_q);
    }
  }

  private nextJoint(ch: Chain, j: number, out: Vector3): Vector3 {
    if (j < 2) return ch.joints[j + 1].bone.getWorldPosition(out);
    const b = ch.joints[2].bone;
    const tip = b.children.find((c) => (c as Bone).isBone) as Bone | undefined;
    if (tip) return tip.getWorldPosition(out);
    b.updateMatrixWorld(true);
    return out.set(0, 0.017, 0).applyMatrix4(b.matrixWorld);
  }

  /** Pose a chain at `delta` (curl, rad, per joint) on top of the clip. */
  setChain(ch: Chain, delta: number[]) {
    for (let j = 0; j < 3; j++) {
      const J = ch.joints[j];
      _q.setFromAxisAngle(J.axis, delta[j]);
      if (j === 0 && delta[3]) _q.multiply(_q2.setFromAxisAngle(ch.abd, delta[3]));
      J.bone.quaternion.copy(_q).multiply(J.q0);
    }
    ch.joints[0].bone.updateMatrixWorld(true);
    ch.delta = delta.slice();
  }

  /** Re-read the clip pose (after the rig moved: seat, support IK) as the base of every chain. */
  rebase(side: Side) {
    for (const ch of this.chains[side]) {
      for (const J of ch.joints) J.q0.copy(J.bone.quaternion);
      ch.delta = [0, 0, 0];
      this.measureAxes(ch);
    }
  }

  vertWorld(i: number, out: Vector3): Vector3 {
    this.mesh.getVertexPosition(i, out);
    return out.applyMatrix4(this.mesh.matrixWorld);
  }

  /** Signed truth distance of a glove vertex (weapon frame), clamped to MAXD. */
  dist(i: number, field = this.field, xf?: Matrix4): number {
    this.evals++;
    this.vertWorld(i, _v).applyMatrix4(this.toWeapon);
    if (xf) _v.applyMatrix4(xf);
    const d = closest(field, _v, MAXD, _hit) ? _hit.d : MAXD;
    return this.extra && field === this.field ? Math.min(d, this.extra(_v)) : d;
  }

  /** Largest knuckle abduction of the current fit (rad). */
  abdMax = 0.25;

  /** Extra obstacle (the firing hand, for the support hand), signed distance at a weapon-frame point. */
  extra?: (p: Vector3) => number;

  /** Per phalanx j0..2: max penetration (all collision vertices) and min pad gap. */
  chainState(ch: Chain, j0 = 0, field = this.field) {
    const pen = [-MAXD, -MAXD, -MAXD];
    const gap = [MAXD, MAXD, MAXD];
    for (let j = j0; j < 3; j++) {
      for (let k = 0; k < ch.verts[j].length; k += 2) {
        const d = this.dist(ch.verts[j][k], field);
        pen[j] = Math.max(pen[j], -d);
      }
      for (const i of ch.pads[j]) gap[j] = Math.min(gap[j], this.dist(i, field));
    }
    return { pen, gap };
  }

  /** Worst penetration of a chain against the whole weapon. */
  chainPen(ch: Chain, j0 = 0): number {
    let p = -MAXD;
    for (let j = j0; j < 3; j++)
      for (let k = 0; k < ch.verts[j].length; k += 2) p = Math.max(p, -this.dist(ch.verts[j][k]));
    return p;
  }

  private within(ch: Chain, delta: number[]): boolean {
    for (let j = 0; j < 3; j++) {
      const J = ch.joints[j];
      const f = J.flex0 + delta[j];
      // A clip pose already outside the range may stay there, never go further out.
      const lo = Math.min(J.lim[0], J.flex0),
        hi = Math.max(J.lim[1], J.flex0);
      if (f < lo || f > hi || delta[j] < REL[j][0] || delta[j] > REL[j][1]) return false;
    }
    return Math.abs(delta[3] ?? 0) <= this.abdMax;
  }

  /**
   * Finger fit (3 joint deltas): no penetration (hard), pads touching where `goal.contact` asks (≤ 0.5 mm), the
   * distal contact on an allowed face, close to the clip (and optionally straight). Coarse grid, then pattern
   * search from the best few. A finger that can reach nothing ends at the least change that clears it (no curl
   * into air). Leaves the chain posed at the result.
   */
  fitFinger(ch: Chain, goal: FingerGoal, faceOf: (n: Vector3) => string): { d: number[]; cost: number } {
    const reg = goal.reg ?? 8;
    const s0 = goal.start ?? [0, 0, 0, 0];
    const cf = goal.contactField ?? this.field;
    const cost = (d: number[]) => {
      if (!this.within(ch, d)) return Infinity;
      if (goal.lock?.some((l, j) => l && Math.abs((d[j] ?? 0) - (s0[j] ?? 0)) > 1e-9)) return Infinity;
      this.setChain(ch, d);
      let c = 0;
      for (let j = 0; j < 3; j++) {
        let pen = -MAXD;
        const V = ch.verts[j];
        for (let k = 0; k < V.length; k += j > 0 ? 1 : 2) pen = Math.max(pen, -this.dist(V[k]));
        // A pad may press ≤ ~1 mm into the surface (a gripping finger flattens); the knuckle phalanx not.
        const p = Math.max(0, pen * 1000 - (j === 2 ? (goal.press ?? 0.3) : 0.3));
        c += (j > 0 ? 150 : 60) * (goal.penW?.[j] ?? 1) * p * p;
        const w = goal.contact[j];
        if (w > 0) {
          // Pad contact as an area: the mean of the closest quarter of the pad (a fingertip that only grazes a
          // corner does not count as holding).
          let face = '';
          const P = goal.anyVertex?.[j] ? V : ch.pads[j];
          const ds: number[] = [];
          let gmin = MAXD;
          for (let k = 0; k < P.length; k += 2) {
            const d0 = this.dist(P[k], cf);
            ds.push(d0);
            if (d0 < gmin) {
              gmin = d0;
              if (j === 2 && goal.faces) face = faceOf(_hit.n);
            }
          }
          ds.sort((x, y) => x - y);
          const q = Math.max(1, Math.ceil(ds.length / 4));
          let g = 0;
          for (let k = 0; k < q; k++) g += ds[k] ?? MAXD;
          g = goal.point ? gmin : g / q;
          const e = Math.min(goal.cap ?? 10, Math.max(0, g * 1000 - 0.5));
          c += w * e * e;
          if (goal.faces && j === 2 && gmin < 0.004) c += goal.faces[face] ?? 40;
        }
      }
      for (let j = 0; j < 4; j++) {
        const x = (d[j] ?? 0) - (s0[j] ?? 0);
        // Opening the knuckle (the finger swings off the grip, the hand reads as a claw) costs more than
        // opening the middle / tip joints or closing any.
        const k = j === 0 && x < 0 ? (goal.openCost ?? 3) : 1;
        c += reg * k * x * x;
        const st = j < 3 ? (goal.straight?.[j] ?? 0) : 0;
        if (st) c += st * (ch.joints[j].flex0 + d[j]) ** 2;
      }
      return c;
    };
    const cand: { d: number[]; c: number }[] = [];
    this.abdMax = goal.abdMax ?? 0.25;
    const am = this.abdMax;
    const abd = goal.abd ? [-am, -am / 2, 0, am / 2, am] : [0];
    for (let a = goal.lock?.[0] ? 0 : -0.5; a <= (goal.lock?.[0] ? 0 : 0.41); a += 0.15)
      for (let b = -0.8; b <= 0.81; b += 0.2)
        for (let e = -0.6; e <= 0.61; e += 0.2)
          for (const ab of abd) {
            const d = [(s0[0] ?? 0) + a, (s0[1] ?? 0) + b, (s0[2] ?? 0) + e, (s0[3] ?? 0) + ab];
            const c = cost(d);
            if (c < Infinity) cand.push({ d, c });
          }
    cand.push({ d: s0.slice(), c: cost(s0) });
    cand.sort((x, y) => x.c - y.c);
    let best = { d: s0.slice(), c: Infinity };
    const n = goal.abd ? 4 : 3;
    for (const sd of cand.slice(0, 3)) {
      const x = sd.d.slice(0, n);
      const c = patternSearch(cost, x, [2, 2, 2, am].slice(0, n), [0.06, 0.06, 0.06, 0.05].slice(0, n), 30);
      if (c < best.c) best = { d: x, c };
    }
    this.setChain(ch, best.d);
    return { d: best.d, cost: best.c };
  }

  /** Joint deltas of a side's chains (only the ones that moved). */
  deltas(side: Side): JointDelta[] {
    const out: JointDelta[] = [];
    for (const ch of this.chains[side])
      ch.joints.forEach((J, j) => {
        // Abduction first: the runtime premultiplies in order (flex · abd · clip, as in setChain).
        if (j === 0 && Math.abs(ch.delta[3] ?? 0) > 1e-4)
          out.push({
            bone: canonName(this.rig, J.bone),
            axis: ch.abd.toArray() as V3,
            a: round(ch.delta[3]),
          });
        if (Math.abs(ch.delta[j]) > 1e-4)
          out.push({
            bone: canonName(this.rig, J.bone),
            axis: J.axis.toArray() as V3,
            a: round(ch.delta[j]),
          });
      });
    return out;
  }

  // ---------------------------------------------------------------------------------------- rigid hand fits

  /**
   * Rigid-hand samples in the weapon frame: the palm (all vertices, weight 1), the thenar (thumb metacarpal,
   * weight 1), the proximal finger phalanges past the knuckle (weight 0.3: the fingers can still move them), and
   * the palm pads (contact).
   */
  palmPoints(side: Side, thenar = 0, fingers = 0): { all: Vector3[]; w: number[]; pads: Vector3[] } {
    const g = this.gloves[side];
    const at = (i: number) => this.vertWorld(i, new Vector3()).applyMatrix4(this.toWeapon);
    const all: Vector3[] = [];
    const w: number[] = [];
    const add = (l: number[], wt: number) => {
      for (const i of l) {
        all.push(at(i));
        w.push(wt);
      }
    };
    add(g.all.get('palm')!, 1);
    if (thenar) add(this.chains[side][0].verts[0], thenar);
    if (fingers)
      for (let f = 1; f < 5; f++)
        add(
          this.chains[side][f].verts[0].filter((_, k) => k % 2 === 0),
          fingers,
        );
    return { all, w, pads: g.pads.get('palm')!.map(at) };
  }

  /** Pad vertices of the proximal phalanges of fingers `fs` (weapon frame): the knuckle side of the wrap. */
  knucklePads(side: Side, fs: number[]): Vector3[] {
    return fs.flatMap((f) =>
      this.chains[side][f].pads[0].map((i) => this.vertWorld(i, new Vector3()).applyMatrix4(this.toWeapon)),
    );
  }

  /** Penetration / contact cost of rigidly moved points (`xf` maps the points, weapon frame). */
  rigidCost(
    pts: { all: Vector3[]; w: number[]; pads: Vector3[] },
    xf: Matrix4,
    gapGoal = 0.0005,
    knuckle?: Vector3[],
    knuckleW = 1,
  ): { cost: number; pen: number; gap: number } {
    let pen = 0,
      cost = 0,
      gap = MAXD;
    for (let k = 0; k < pts.all.length; k++) {
      this.evals++;
      _w.copy(pts.all[k]).applyMatrix4(xf);
      let d = closest(this.field, _w, MAXD, _hit) ? _hit.d : MAXD;
      if (this.extra) d = Math.min(d, this.extra(_w));
      if (pts.w[k] === 1 && -d > pen) pen = -d;
      const e = Math.max(0, -d - 0.0003) * 1000;
      cost += 10 * pts.w[k] * e * e;
    }
    for (const p of pts.pads) {
      this.evals++;
      _w.copy(p).applyMatrix4(xf);
      let d = closest(this.field, _w, MAXD, _hit) ? _hit.d : MAXD;
      if (this.extra) d = Math.min(d, this.extra(_w));
      gap = Math.min(gap, d);
    }
    const g = Math.max(0, gap - gapGoal) * 1000;
    cost += 2 * g * g;
    if (knuckle?.length) {
      // The proximal phalanges lie on the near panel / front corner (area: mean of the closest quarter).
      const ds = knuckle.map((p) => {
        _w.copy(p).applyMatrix4(xf);
        return closest(this.field, _w, MAXD, _hit) ? _hit.d : MAXD;
      });
      ds.sort((a, b) => a - b);
      const q = Math.max(1, Math.ceil(ds.length / 4));
      let m = 0;
      for (let k = 0; k < q; k++) m += Math.max(0, ds[k]);
      const e = Math.min(10, (m / q) * 1000 - 0.5);
      if (e > 0) cost += knuckleW * e * e;
    }
    return { cost, pen, gap };
  }
}

/** Pattern search over x (bounded), minimising f. */
export function patternSearch(
  f: (x: number[]) => number,
  x: number[],
  lim: number[],
  step: number[],
  rounds = 40,
) {
  let best = f(x);
  const s = step.slice();
  for (let r = 0; r < rounds; r++) {
    let improved = false;
    for (let k = 0; k < x.length; k++)
      for (const sg of [1, -1]) {
        const old = x[k];
        x[k] = Math.max(-lim[k], Math.min(lim[k], old + sg * s[k]));
        const c = f(x);
        if (c < best - 1e-9) {
          best = c;
          improved = true;
        } else x[k] = old;
      }
    if (!improved) {
      for (let k = 0; k < s.length; k++) s[k] *= 0.5;
      if (s[0] < step[0] / 32) break;
    }
  }
  return best;
}

export function canonName(rig: ArmsRig, b: Bone): string {
  for (const [n, x] of rig.boneMap) if (x === b) return n;
  return b.name;
}

const round = (x: number, d = 4) => Math.round(x * 10 ** d) / 10 ** d;

/** Rigid transform about `c`: R(euler x[3..5]) and translation x[0..2] (weapon frame). */
export function rigid(x: number[], c: Vector3, out: Matrix4): Matrix4 {
  _q2.setFromAxisAngle(_v.set(1, 0, 0), x[3]);
  _q.setFromAxisAngle(_v.set(0, 1, 0), x[4]).multiply(_q2);
  _q2.setFromAxisAngle(_v.set(0, 0, 1), x[5]);
  _q2.multiply(_q);
  out.makeRotationFromQuaternion(_q2);
  _v.copy(c).applyMatrix4(out);
  out.setPosition(c.x - _v.x + x[0], c.y - _v.y + x[1], c.z - _v.z + x[2]);
  return out;
}

// ------------------------------------------------------------------------------------------ the bake

export interface BakeOptions {
  /** Support grip styles to bake (the default handguard hold always). */
  styles?: SupportGrip[];
  log?: (s: string) => void;
}

/**
 * Bake one weapon build (rig attached, raw clip at idle frame 0; no contact layer). Leaves the rig posed with the
 * result applied (seat set on the rig) so the caller can measure it.
 */
export function bakeGrip(
  rig: ArmsRig,
  model: WeaponModel,
  gloves: Record<Side, GloveRegions>,
  opts: BakeOptions = {},
): GripBake {
  const log = opts.log ?? (() => {});
  rig.setGripSeat(null);
  rig.play('idle', { fade: 0 });
  rig.update(0);
  const s = new GripSolver(rig, model, gloves);
  // 1. Seat.
  const pivot = (model.sockets.gripRight?.getWorldPosition(new Vector3()) ?? new Vector3()).applyMatrix4(
    s.toWeapon,
  );
  const pts = s.palmPoints('R');
  const kn = s.knucklePads('R', [2, 3, 4]);
  const S = new Matrix4();
  const Si = new Matrix4();
  const seatCost = (x: number[]) => {
    rigid(x, pivot, S);
    Si.copy(S).invert();
    const c = s.rigidCost(pts, Si, 0.0005, kn, KNUCKLE_W);
    const t = Math.hypot(x[0], x[1], x[2]) * 1000;
    const r = Math.hypot(x[3], x[4], x[5]);
    // The gun moves at most ~5 mm in the hand.
    const over = Math.max(0, t - SEAT_MM);
    return c.cost + 0.05 * t * t + 400 * r * r + 200 * over * over;
  };
  const x = [0, 0, 0, 0, 0, 0];
  const before = s.rigidCost(pts, new Matrix4());
  const L = SEAT_MM / 1000;
  patternSearch(
    seatCost,
    x,
    [L, L, L, SEAT_ROT, SEAT_ROT, SEAT_ROT],
    [0.002, 0.002, 0.002, 0.02, 0.02, 0.02],
  );
  rigid(x, pivot, S);
  const after = s.rigidCost(pts, Si.copy(S).invert());
  log(
    `seat t ${mm(x.slice(0, 3))} mm r ${x
      .slice(3)
      .map((v) => v.toFixed(3))
      .join(
        ',',
      )} | palm pen ${mm([before.pen])}→${mm([after.pen])} gap ${mm([before.gap])}→${mm([after.gap])} mm`,
  );
  rig.setGripSeat(S);
  rig.update(0);
  s.sync();
  s.rebase('R');
  s.rebase('L');
  // 2. Firing fingers.
  const R = s.chains.R;
  const gripAngle = Math.abs(model.sockets.gripRight?.rotation.x ?? 0.33);
  const fR = (n: Vector3) => faceOf(n, gripAngle);
  for (const fi of [2, 3, 4])
    fitLog(
      s,
      R[fi],
      {
        contact: [0.3, 1, 1],
        faces: { left: 0, front: 6, bottom: fi === 2 ? 6 : 20 },
        press: 1,
        abd: true,
        ...FIRING_STYLE,
      },
      fR,
      log,
    );
  fitLog(
    s,
    R[1],
    {
      contact: [0, 0.3, 0.3],
      anyVertex: [false, true, true],
      straight: [0, 1.5, 1.5],
      openCost: 1,
      point: true,
    },
    fR,
    log,
  );
  fitLog(
    s,
    R[0],
    { contact: [0, 0.3, 1], faces: { left: 0, top: 0 }, penW: [0, 1, 1], openCost: 1, reg: 30 },
    fR,
    log,
  );
  const rest = R[1].delta.slice();
  const trigger: JointDelta[] = [];
  if (s.trigField) {
    const ch = R[1];
    // Index pad onto the blade: flex + knuckle abduction from the rest pose, nothing else penetrated.
    const r = s.fitFinger(
      ch,
      {
        contact: [0, 0.5, 1],
        contactField: s.trigField,
        start: [...rest, 0],
        abd: true,
        abdMax: 0.7,
        reg: 2,
        openCost: 1,
        cap: 30,
        point: true,
      },
      () => '',
    );
    const d = r.d.concat([0]).slice(0, 4);
    let tg = MAXD;
    for (const j of [1, 2]) for (const i of ch.pads[j]) tg = Math.min(tg, s.dist(i, s.trigField));
    const pen = s.chainPen(ch);
    const found = tg < 0.003 && pen < 0.003;
    if (found) {
      if (Math.abs(d[3]) > 1e-4)
        trigger.push({
          bone: canonName(rig, ch.joints[0].bone),
          axis: ch.abd.toArray() as V3,
          a: round(d[3]),
        });
      ch.joints.forEach((J, j) => {
        if (Math.abs(d[j] - rest[j]) > 1e-4)
          trigger.push({
            bone: canonName(rig, J.bone),
            axis: J.axis.toArray() as V3,
            a: round(d[j] - rest[j]),
          });
      });
    }
    log(
      `trigger ${found ? 'on' : 'MISS'} d ${d.map((v, j) => (v - (rest[j] ?? 0)).toFixed(2)).join(',')} pad gap ${(tg * 1000).toFixed(1)} pen ${(pen * 1000).toFixed(1)} mm`,
    );
    s.setChain(ch, [...rest]);
  }
  const bake: GripBake = { seat: S.toArray().map((v) => round(v, 6)), R: s.deltas('R'), trigger, L: {} };
  // 3. Support hand: the weapon and the (final) firing hand are its obstacles.
  const hand = new HandObstacle((n) => rig.boneMap.get(n)!);
  hand.update(s.toWeapon);
  s.extra = hand.sdf;
  for (const style of opts.styles ?? ['handguard']) {
    if (style !== 'handguard') continue;
    bake.L[style] = supportFit(s, log);
  }
  return bake;
}

function fitLog(
  s: GripSolver,
  ch: Parameters<GripSolver['fitFinger']>[0],
  goal: FingerGoal,
  face: (n: Vector3) => string,
  log: (s: string) => void,
) {
  const r = s.fitFinger(ch, goal, face);
  const st = s.chainState(ch);
  log(
    `  ${ch.side}.${FINGERS[ch.finger]} d ${r.d.map((v) => v.toFixed(2)).join(',')} cost ${r.cost.toFixed(1)} pen ${mm(st.pen)} gap ${mm(st.gap)}`,
  );
}

const mm = (v: number[]) => v.map((x) => (x * 1000).toFixed(1)).join(',');

function supportFit(s: GripSolver, log: (s: string) => void): SupportBake {
  const rig = s.rig;
  const pts = s.palmPoints('L');
  const o = rig.bones.handL.getWorldPosition(new Vector3()).applyMatrix4(s.toWeapon);
  const X = new Matrix4();
  const cost = (x: number[]) => {
    rigid(x, o, X);
    const c = s.rigidCost(pts, X);
    const t = Math.hypot(x[0], x[1], x[2]) * 1000;
    const r = Math.hypot(x[3], x[4], x[5]);
    return c.cost + 0.01 * t * t + 30 * r * r;
  };
  const before = s.rigidCost(pts, new Matrix4());
  // Multi-start: the clip pose, and backed off the palm (down / out of the handguard) by 6–24 mm.
  const n = s.palmNormal('L', new Vector3()).transformDirection(s.toWeapon);
  let x = [0, 0, 0, 0, 0, 0],
    best = Infinity;
  for (const k of [0, 0.006, 0.012, 0.018, 0.024]) {
    const x0 = [-n.x * k, -n.y * k, -n.z * k, 0, 0, 0];
    const c = patternSearch(
      cost,
      x0,
      [0.03, 0.03, 0.03, 0.3, 0.3, 0.3],
      [0.004, 0.004, 0.004, 0.04, 0.04, 0.04],
    );
    if (c < best) {
      best = c;
      x = x0;
    }
  }
  // Refine on the real arm: the IK swings the forearm too, and wrist vertices are partly skinned to it.
  const bones = [rig.bones.armL, rig.bones.foreArmL, rig.bones.handL];
  const q0 = bones.map((b) => b.quaternion.clone());
  const I = new Matrix4();
  const pose = (x: number[]) => {
    bones.forEach((b, i) => b.quaternion.copy(q0[i]));
    rig.bones.armL.updateMatrixWorld(true);
    rigid(x, o, X);
    const tq = new Quaternion().setFromRotationMatrix(X).toArray() as [number, number, number, number];
    applySupport(rig, s.model, [x[0], x[1], x[2]], tq, 1);
    return tq;
  };
  const exact = (x: number[]) => {
    pose(x);
    const c = s.rigidCost(s.palmPoints('L'), I);
    const t = Math.hypot(x[0], x[1], x[2]) * 1000;
    const r = Math.hypot(x[3], x[4], x[5]);
    return c.cost + 0.01 * t * t + 30 * r * r;
  };
  patternSearch(exact, x, [0.03, 0.03, 0.03, 0.3, 0.3, 0.3], [0.002, 0.002, 0.002, 0.02, 0.02, 0.02], 25);
  const offset = [x[0], x[1], x[2]].map((v) => round(v)) as V3;
  const tq = pose(x).map((v) => round(v, 6)) as [number, number, number, number];
  s.sync();
  const after = s.rigidCost(s.palmPoints('L'), I);
  log(
    `support t ${mm(x.slice(0, 3))} mm r ${x
      .slice(3)
      .map((v) => v.toFixed(3))
      .join(
        ',',
      )} | palm pen ${mm([before.pen])}→${mm([after.pen])} gap ${mm([before.gap])}→${mm([after.gap])} mm`,
  );
  s.rebase('L');
  const L = s.chains.L;
  const fL = (n: Vector3) => faceOf(n, null);
  for (const fi of [1, 2, 3, 4])
    fitLog(
      s,
      L[fi],
      { contact: [0.3, 1, 1], faces: { right: 0, bottom: 4, top: fi === 1 ? 4 : 20 } },
      fL,
      log,
    );
  fitLog(
    s,
    L[0],
    { contact: [0, 0.3, 1], faces: { left: 0, top: 0 }, penW: [0.2, 1, 1], openCost: 1 },
    fL,
    log,
  );
  return { offset, turn: tq, joints: s.deltas('L') };
}
