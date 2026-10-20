import { Euler, Matrix4, Quaternion, Vector3, type Bone } from 'three';
import type { WeaponModel } from '../../weapons/models';
import type { ArmsRig } from '../rig/ArmsRig';
import { HandProxy, PALM, WRIST, type Side } from './handProxy';
import { solveSeat, type SeatAnchor } from './seat';
import { WeaponCollision, collect, type Group } from './weaponCollision';

/**
 * Hard-contact layer for the authored arms rig: runs after `ArmsRig.update` (mixer, gun track, anchor IK) and
 * before rendering. Nothing of the hands may sink into the weapon.
 *
 *  1. Firing hand (the gun rides it): the palm/wrist never move (that would move the gun) — the **gun** is
 *     offset out of the palm instead (bounded, eased out).
 *  2. Support hand (and the firing hand while it is off the grip): palm/wrist pushed out along the SDF gradient
 *     (min translation), arm re-solved by two-bone IK so the elbow follows; the held mag follows the hand.
 *  3. Mag rules: a held/travelling mag may not pass through the receiver — the magwell is an opening in the
 *     collision set, so the mag is pushed back toward the well axis; seated, it is part of the gun.
 *  4. Fingers + thumb, proximal → distal: a penetrating phalanx opens its joint (bisection) until clear; fingers
 *     near a surface (wrap intent, with hysteresis) curl back to contact. Openings apply at once (hard block)
 *     and release with a ~25 ms critically damped ease; curls ease in. No allocation per frame.
 */

/** Baked per-weapon grip (see `HandContact.bakeGrip`). */
export interface Baked {
  seat: Matrix4;
  /** Support-hand hold offset (weapon frame). */
  lOff: Vector3;
  /** Per-joint finger angles (5 fingers × MCP/PIP/DIP, + opens) on top of the clip, firing / support hand. */
  dR: Float32Array;
  dL: Float32Array;
}
const BAKED = new Map<string, Baked | null>();

/**
 * Hand-tuned two-hand pistol hold (support hand), applied on top of the clip while the support hand is on the
 * gun (`grip` anchor weight): a weapon-frame wrist offset, a weapon-frame turn (XYZ euler, rad) and per-joint
 * finger angles (5 × MCP/PIP/DIP, + opens). Tuned visually from the sheets (anim.html `loff`, `lturn`, `lfing`).
 */
export interface SupportPose {
  offset: [number, number, number];
  turn: [number, number, number];
  fingers: number[];
}
export const PISTOL_SUPPORT: Record<string, SupportPose> = {
  p17: {
    offset: [-0.017, 0.012, 0.006],
    turn: [0, 0, 0.2],
    fingers: [0, 0, 0, 0.1, 0.1, 0.05, 0.1, 0.1, 0.05, 0.1, 0.1, 0.05, 0.1, 0.1, 0.05],
  },
};

export const CONTACT = {
  /** Clearance the solver aims for (sampling margin), m. */
  clear: 0.0015,
  /** Wrap: curl a finger to contact when its gap is under `wrapIn`, release above `wrapOut`. */
  wrapIn: 0.012,
  wrapOut: 0.016,
  /** Gap after the curl (≤ 3 mm contact). */
  touch: 0.001,
  maxOpen: 1.3,
  maxCurl: 1.5,
  /** Firing-palm gun offset / support-hand push bounds (m). */
  maxGun: 0.005,
  maxPush: 0.05,
  maxMag: 0.04,
  /** Support-hand back-off for a finger nothing else clears (m). */
  maxBack: 0.02,
  /** Release time constant (s). */
  tau: 0.025,
  /** Finger opening: ease in / release time constants (s) and the largest change per frame (rad). */
  tauOpen: 0.03,
  tauRelease: 0.08,
  maxOpenStep: 0.06,
};

/** Finger synergy weights per joint (MCP, PIP, DIP): opening (knuckle-led) and wrap curl (PIP/DIP-led). */
const SO = [1, 0.35, 0.15];
const SC = [0.25, 1, 0.8];
const PALM_NU = 5,
  PALM_NW = 4,
  SEG_N = 4;

interface ChainState {
  open: Float32Array; // eased opening per joint (rad)
  curl: Float32Array; // eased curl per joint (rad)
  wrap: boolean;
  /** Index trigger curl (eased). */
  trig: number;
  /** Best-effort clearance when no opening clears (−1 = not stuck). */
  stuck: number;
  intent: boolean;
}

interface HandState {
  proxy: HandProxy;
  chains: ChainState[];
  push: Vector3; // eased translation (weapon frame)
  dir: number; // last separation direction (warm start)
  dist?: number;
}

/** Critically damped ease of `x` toward `target` (scalar), time constant `tau`. */
function ease(x: number, target: number, dt: number, tau = CONTACT.tau) {
  return target + (x - target) * Math.exp(-dt / tau);
}

const _p = new Vector3();
const _p2 = new Vector3();
const _g = new Vector3();
const _d = new Vector3();
const _ax = new Vector3();
const _t = new Vector3();
const _q = new Quaternion();
const _e = new Euler();
const _m = new Matrix4();
const _qw = new Quaternion();
const _qb = new Quaternion();
const _qp = new Quaternion();
const _s = new Vector3();
const _pos = new Vector3();
const PA = [new Vector3(), new Vector3(), new Vector3()];
const PB = [new Vector3(), new Vector3(), new Vector3()];
const AX = [new Vector3(), new Vector3(), new Vector3()];
const ANG = [0, 0, 0];
const DIRS = Array.from({ length: 6 }, () => new Vector3());

export interface ContactStats {
  ms: number;
  gunOffset: number;
  push: { L: number; R: number };
  magOffset: number;
  /** Largest wrist miss of an IK reach this frame (arm out of reach), m. */
  reachMiss: number;
  /** Accumulated ms per phase (intent, hands, mag, fingers) since construction — profiling. */
  phases: Float64Array;
}

export class HandContact {
  enabled = true;
  /**
   * `safe` (default, ships): no grip seat, the gun never moves in the hand, fingers only open to clear a
   * penetration and ease back to the clip's angle, the support hand only depenetrates through arm IK.
   * `full`: the baked grip solve (seat, hold offset, hand-poser fingers, wrap curls, gun give-way ≤ 5 mm).
   */
  static defaultMode: 'safe' | 'full' = 'safe';

  /** In-game override: `?handcontact=off|safe|full` (null = no override: per-weapon default). */
  static urlMode(): 'off' | 'safe' | 'full' | null {
    try {
      const v = new URLSearchParams(location.search).get('handcontact');
      return v === null ? null : v === 'full' ? 'full' : v === 'off' || v === '0' ? 'off' : 'safe';
    } catch {
      return null;
    }
  }

  /** Per-weapon on/off, evaluated on every attach (e.g. on for pistols only). */
  autoEnable?: (weaponId: string) => boolean;
  mode: 'safe' | 'full' = HandContact.defaultMode;
  readonly hands: Record<Side, HandState>;
  col?: WeaponCollision;
  readonly toWeapon = new Matrix4();
  readonly stats: ContactStats = {
    ms: 0,
    gunOffset: 0,
    push: { L: 0, R: 0 },
    magOffset: 0,
    reachMiss: 0,
    phases: new Float64Array(4),
  };
  private model?: WeaponModel;
  private cache = new Map<WeaponModel, { col: WeaponCollision; magPts: Float32Array<ArrayBufferLike> }>();
  private magPts: Float32Array<ArrayBufferLike> = new Float32Array(0);
  private gunOff = new Vector3();
  private magOff = new Vector3();
  private skipL: Group | null = null;
  private heldPush = new Vector3();
  /** Baked grip of the current weapon (see `bakeGrip`). */
  bake: Baked | null = null;
  private baseD = [0, 0, 0];
  private frame = 0;
  /** Set by solveOpen's best-effort scan: the least penetration it reached (else NaN). */
  private stuckGap = NaN;
  /** Each hand's min finger clearance after its last finger solve (cheap residual check). */
  private minGap = { R: 0, L: 0 };
  private gunHint: { dir: number; dist?: number } = { dir: 0 };
  private heldHint: { dir: number; dist?: number } = { dir: 0 };

  constructor(readonly rig: ArmsRig) {
    const bone = (n: string) => {
      const b = rig.boneMap.get(n);
      if (!b) throw new Error(`HandContact: missing bone ${n}`);
      return b;
    };
    const mk = (side: Side): HandState => ({
      proxy: new HandProxy(side, bone),
      chains: Array.from({ length: 5 }, () => ({
        open: new Float32Array(3),
        curl: new Float32Array(3),
        wrap: false,
        trig: 0,
        stuck: -1,
        intent: false,
      })),
      push: new Vector3(),
      dir: 0,
    });
    this.hands = { R: mk('R'), L: mk('L') };
    rig.seatProvider = (_r, model, id) => {
      this.bake = null;
      this.weaponId = id;
      if (this.autoEnable) this.enabled = this.autoEnable(id);
      if (!this.enabled || !this.seats || this.mode === 'safe' || !this.ensure()) return null;
      const key = id + JSON.stringify(model.build);
      const hit = BAKED.get(key);
      if (hit !== undefined) {
        this.bake = hit;
        return hit?.seat ?? null;
      }
      // Regression gate: the solved hold must score better than the raw clip (penetration + contact gaps at
      // idle), else this weapon runs raw — logged, never shipped worse.
      const raw = this.holdScore();
      const baked = this.bakeGrip(model, key);
      this.bake = baked;
      for (let i = 0; i < 4; i++) {
        rig.setGripSeat(baked.seat);
        rig.update(0);
        this.apply(1 / 60);
      }
      const solved = this.holdScore();
      this.gate.set(key, { raw, solved });
      if (solved > raw) {
        console.warn(
          `HandContact: ${id} solved hold (${solved.toFixed(1)}) worse than raw (${raw.toFixed(1)}) — raw`,
        );
        BAKED.set(key, null);
        this.bake = null;
        return null;
      }
      return baked.seat;
    };
  }

  /** Per weapon build: idle hold score raw vs solved (lower is better; see `holdScore`). */
  readonly gate = new Map<string, { raw: number; solved: number }>();

  /**
   * Hold quality at the current pose, mm: worst penetration of either hand (×2) + firing palm gap to the
   * grip + mean firing middle/ring/pinky gap (each clamped to 30 mm).
   */
  holdScore(): number {
    this.sync();
    const col = this.col!;
    let pen = 0;
    for (const side of ['R', 'L'] as const) {
      const h = this.hands[side].proxy;
      this.selectHand(h);
      pen = Math.max(pen, this.bodyPen(h, null, null, null, _pos));
      for (const ph of h.phalanges) pen = Math.max(pen, this.capsulePen(ph.a, ph.b, ph.r, null, 5));
      col.unselect();
    }
    const R = this.hands.R.proxy;
    this.selectHand(R);
    let palm = Infinity;
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 3; j++) {
        _p.set((j - 1) * (R.palmHalf.x - PALM.halfN), 0, (i - 1) * (R.palmHalf.z - PALM.halfN)).applyMatrix4(
          R.palm,
        );
        palm = Math.min(palm, col.sdf(_p, null, null, 0.05) - PALM.halfN);
      }
    let fing = 0;
    for (let f = 2; f < 5; f++) {
      let g = Infinity;
      for (const ph of R.chains[f]) g = Math.min(g, -this.capsulePen(ph.a, ph.b, ph.r, null, 5));
      fing += Math.min(0.03, Math.max(0, g)) / 3;
    }
    col.unselect();
    return (2 * Math.max(0, pen) + Math.min(0.03, Math.max(0, palm)) + fing) * 1000;
  }

  /** Solve a per-weapon grip seat on attach (see seat.ts). */
  seats = true;

  /** Collision set for the rig's current weapon (fitted once per model). */
  private ensure(): boolean {
    const model = this.rig.weaponModel;
    if (!model) return false;
    if (model !== this.model) {
      let c = this.cache.get(model);
      if (!c) {
        // Fit at rest: parts back to their rest pose is the model's own state before the rig drives it; the rig
        // keeps part rest transforms, so fit from a fresh traversal (parts are fitted in their own frames).
        const col = new WeaponCollision(model);
        const pts: { p: number[] } = { p: [] };
        const mag = model.parts.mag;
        if (mag) {
          mag.updateMatrixWorld(true);
          collect(mag, mag.matrixWorld.clone().invert(), () => false, pts, 0.012);
        }
        // Keep ~96 evenly strided mag surface samples (mag-local).
        const n = pts.p.length / 3;
        const k = Math.max(1, Math.floor(n / 96));
        const arr: number[] = [];
        for (let i = 0; i < n; i += k) arr.push(pts.p[i * 3], pts.p[i * 3 + 1], pts.p[i * 3 + 2]);
        c = { col, magPts: Float32Array.from(arr) };
        this.cache.set(model, c);
      }
      this.col = c.col;
      this.magPts = c.magPts;
      this.model = model;
      this.reset();
    }
    return true;
  }

  /** Forget all eased / warm-started solver state (a new weapon in the hands). */
  reset() {
    this.gunOff.set(0, 0, 0);
    this.magOff.set(0, 0, 0);
    this.heldPush.set(0, 0, 0);
    this.gunHint = { dir: 0 };
    this.heldHint = { dir: 0 };
    this.frame = 0;
    for (const s of ['L', 'R'] as const) {
      const h = this.hands[s];
      h.push.set(0, 0, 0);
      h.dir = 0;
      h.dist = undefined;
      this.resOff[s].set(0, 0, 0);
      this.resGoal[s].set(0, 0, 0);
      for (const ch of h.chains) {
        ch.open.fill(0);
        ch.curl.fill(0);
        ch.wrap = false;
        ch.trig = 0;
        ch.stuck = -1;
        ch.intent = false;
      }
    }
  }

  /** Refresh the weapon-frame view of the weapon and both hands (no resolution). */
  sync() {
    if (!this.ensure()) return false;
    const col = this.col!;
    col.update();
    this.toWeapon.copy(this.model!.root.matrixWorld).invert();
    this.hands.R.proxy.update(this.toWeapon);
    this.hands.L.proxy.update(this.toWeapon);
    this.handShape();
    const ms = this.rig.magState(0);
    this.skipL = ms.held > 0.5 ? (col.mag ?? null) : null;
    return true;
  }

  /** The tuned two-hand pistol hold for the current weapon, if any. */
  supportPose(): SupportPose | undefined {
    return this.weaponId ? PISTOL_SUPPORT[this.weaponId] : undefined;
  }

  /** Weapon id of the attached model (set on attach). */
  weaponId = '';

  /** Resolve this frame. Call after `rig.update(dt)` (and any arm layers), before rendering. */
  apply(dt: number) {
    if (!this.enabled) return;
    const t0 = performance.now();
    this.stats.reachMiss = 0;
    if (!this.sync()) return;
    // Wrap intent from the authored pose (before any correction moves the hands): fingers the clip puts on
    // (or into) a surface mean to hold it, so they re-close to contact after the hand is pushed out.
    // Re-evaluated every 4th frame (intent changes slowly; hysteresis covers the lag).
    for (const side of this.frame++ % 4 === 0 ? (['R', 'L'] as const) : ([] as const)) {
      const h = this.hands[side].proxy;
      this.selectHand(h);
      for (let fi = 0; fi < 5; fi++) {
        const cs = this.hands[side].chains[fi];
        const g = this.synergy(h, fi, 0, 0, null);
        cs.intent = cs.intent ? g < CONTACT.wrapOut : g < CONTACT.wrapIn;
      }
      this.col!.unselect();
    }
    const rig = this.rig;
    const col = this.col!;
    const onHand = rig.gunOnHand > 0.5;
    const ph = this.stats.phases;
    let tp = t0;
    const lap = (k: number) => {
      const now = performance.now();
      ph[k] += now - tp;
      tp = now;
    };
    lap(0);
    // 1. Firing palm → gun offset.
    const safe = this.mode === 'safe';
    if (onHand && !safe) this.firingPalm(dt);
    else this.gunOff.set(0, 0, 0);
    // Firing-hand fingers first: the support hand then yields to the final firing hand (hand↔hand).
    this.hands.L.proxy.update(this.toWeapon);
    this.hands.R.proxy.update(this.toWeapon);
    // Safe mode: the firing hand stays exactly as the clip while it holds the gun.
    if (!(safe && onHand)) this.fingers('R', dt);
    // Firing-hand residual (e.g. the thumb against a stock during an inspect): the gun gives way (on the hand)
    // or the hand backs off by IK (off the grip), then the fingers re-solve.
    for (let it = 0; it < (safe && onHand ? 0 : 1); it++) {
      if (this.minGap.R >= -0.001) break;
      const pen = this.fingerResidual('R', _pos);
      if (pen <= 0.001) break;
      this.col!.gradient(_pos, _g, this.col!.hand ?? null);
      const amt = Math.min(pen + CONTACT.clear, 0.012);
      if (onHand) {
        _d.copy(_g).multiplyScalar(-amt);
        rig.offsetGun(_d);
        col.update();
        this.toWeapon.copy(this.model!.root.matrixWorld).invert();
        this.hands.L.proxy.update(this.toWeapon);
      } else {
        _d.copy(_g).transformDirection(this.model!.root.matrixWorld).multiplyScalar(amt);
        rig.bones.handR.getWorldPosition(_p2).add(_d);
        rig.reachHand('R', _p2);
      }
      this.hands.R.proxy.update(this.toWeapon);
      this.fingers('R', 0);
    }
    this.handShape();
    // 2. Support hand: the baked hold offset (two-bone IK, weighted by the handguard contact), then the
    // residual push of both free hands.
    const bake = this.bake;
    const wl = Math.min(1, Math.max(0, rig.anchorWeight('L', 'grip')));
    const sp = this.supportPose();
    if (sp && wl > 0.001) {
      // Two-hand pistol hold: tuned wrist offset + turn (weapon frame) through the arm IK, weighted.
      this.model!.root.matrixWorld.decompose(_s, _qw, _s);
      _e.set(sp.turn[0] * wl, sp.turn[1] * wl, sp.turn[2] * wl);
      _qb.setFromEuler(_e);
      _q.copy(_qw).multiply(_qb).multiply(_qp.copy(_qw).invert());
      _d.set(sp.offset[0] * wl, sp.offset[1] * wl, sp.offset[2] * wl).transformDirection(
        this.model!.root.matrixWorld,
      );
      _d.multiplyScalar(Math.hypot(sp.offset[0], sp.offset[1], sp.offset[2]) * wl);
      rig.bones.handL.getWorldPosition(_p2).add(_d);
      rig.reachHand('L', _p2, _q);
      this.hands.L.proxy.update(this.toWeapon);
    }
    if (bake && wl > 0.001 && bake.lOff.lengthSq() > 1e-10) {
      _d.copy(bake.lOff)
        .transformDirection(this.model!.root.matrixWorld)
        .multiplyScalar(bake.lOff.length() * wl);
      rig.bones.handL.getWorldPosition(_p2).add(_d);
      rig.reachHand('L', _p2);
      this.hands.L.proxy.update(this.toWeapon);
    }
    this.pushHand('L', dt);
    if (!onHand) this.pushHand('R', dt);
    else this.hands.R.push.set(0, 0, 0);
    lap(1);
    // 3. Mag rules (after the support hand moved: the held mag follows it).
    rig.refreshParts();
    col.update();
    this.magRules(dt);
    // The mag stayed where the rules put it: the support hand now clears the mag it holds (no part refresh).
    if (this.skipL) this.pushHand('L', dt, true);
    else this.heldPush.set(0, 0, 0);
    lap(2);
    // 4. Support-hand fingers (the firing hand is already final: hand↔hand obstacle).
    // Support-hand fingers that no joint motion clears (a tip deep in a surface) back the whole hand off along
    // the surface normal (two-bone IK). The back-off is persistent state, eased and with hysteresis: it grows
    // while a finger is still > 1 mm in, holds inside the band, and only lets go once every finger is clear by
    // > 3 mm. (It used to be re-solved from scratch every frame: up to 2 cm on or off depending on which side
    // of 1 mm the deepest tip landed and on which surface's gradient it read, so under recoil the support hand
    // flicked between two poses ~3 cm apart — the pistol "glitching".)
    this.hands.L.proxy.update(this.toWeapon);
    this.handShape();
    this.fingers('L', dt);
    this.updateBackOff('L', dt);
    if (this.backOff('L')) {
      this.hands.L.proxy.update(this.toWeapon);
      this.fingers('L', 0);
    }
    lap(3);
    this.stats.ms = performance.now() - t0;
  }

  /**
   * Baked grip solve, once per weapon build (the rig is at idle frame 0): (1) firing-hand seat — the gun frame
   * relative to the hand (seat.ts); (2) support-hand hold offset off the handguard (two-bone IK target);
   * (3) per-finger synergy for both hands — open until clear, then curl joint chain to first touch. Runtime
   * blends these in by the hold weights and only solves the residual.
   */
  private bakeGrip(model: WeaponModel, key: string): Baked {
    this.sync();
    const gr = model.sockets.gripRight;
    const pivot = gr ? gr.getWorldPosition(new Vector3()).applyMatrix4(this.toWeapon) : new Vector3();
    this.col!.mute = this.col!.hand ?? null;
    const seat = solveSeat(this.col!, this.hands.R.proxy, pivot, key, this.backstrap() ?? undefined);
    this.col!.mute = null;
    const rig = this.rig;
    rig.setGripSeat(seat);
    rig.update(0);
    this.sync();
    const L = this.hands.L.proxy;
    this.selectHand(L, 0.06);
    const lOff = this.separate(L, null, 0.06, new Vector3(), { dir: 0 }).clone();
    this.col!.unselect();
    if (lOff.lengthSq() > 0) {
      _d.copy(lOff).transformDirection(model.root.matrixWorld).multiplyScalar(lOff.length());
      rig.bones.handL.getWorldPosition(_p2).add(_d);
      rig.reachHand('L', _p2);
      this.sync();
    }
    const baked: Baked = { seat, lOff, dR: new Float32Array(15), dL: new Float32Array(15) };
    for (const side of ['R', 'L'] as const) {
      const h = this.hands[side].proxy;
      const D = side === 'R' ? baked.dR : baked.dL;
      this.selectHand(h);
      for (let fi = 0; fi < 5; fi++) {
        const hold = fi !== 0 && !(side === 'R' && fi === 1) && this.synergy(h, fi, 0, 0, null) < 0.02;
        this.bakeFinger(h, fi, hold, D, fi * 3, side === 'R' && fi === 1);
      }
      this.col!.unselect();
    }
    BAKED.set(key, baked);
    return baked;
  }

  /**
   * Grip socket from the grip proxies themselves: the back face of the grip slice nearest the firing palm
   * (backstrap, outward normal) and the palm's contact point / normal.
   */
  private backstrap(): SeatAnchor | null {
    const col = this.col!;
    const R = this.hands.R.proxy;
    const pc = new Vector3().setFromMatrixPosition(R.palm).addScaledVector(R.normal, PALM.halfN + 0.0015);
    let best: SeatAnchor | null = null,
      bd = Infinity;
    for (const g of col.groups) {
      if (g.obj) continue;
      for (const sh of g.shapes) {
        if (sh.kind !== 'box' || sh.name !== 'grip') continue;
        _m.copy(sh.inv).invert();
        const nb = new Vector3().setFromMatrixColumn(_m, 2).normalize();
        const b = new Vector3().setFromMatrixPosition(_m).addScaledVector(nb, sh.half.z);
        const d = b.distanceTo(pc);
        if (d < bd) {
          bd = d;
          best = { b, nb, pc, pn: R.normal.clone() };
        }
      }
    }
    return best;
  }

  // ------------------------------------------------------------------------------------------ measurement

  /** Penetration (m, > 0 = inside) of a sphere at weapon-frame `p` with radius `r`. */
  pen(p: Vector3, r: number, skip: Group | null): number {
    return r - this.col!.sdf(p, skip, this.onlyGroup, r + 0.02);
  }

  /** Restricts finger queries to one group (the trigger, for the index pad). */
  private onlyGroup: Group | null = null;

  /** Deepest penetration of a capsule (sampled `n` points). Leaves the deepest point in `at`. */
  capsulePen(a: Vector3, b: Vector3, r: number, skip: Group | null, n = SEG_N, at?: Vector3): number {
    let worst = -Infinity;
    for (let i = 0; i < n; i++) {
      _p.lerpVectors(a, b, n === 1 ? 0.5 : i / (n - 1));
      const d = this.pen(_p, r, skip);
      if (d > worst) {
        worst = d;
        if (at) at.copy(_p);
      }
    }
    return worst;
  }

  /**
   * Rigid hand body (palm = sphere-swept rectangle on a 5 × 4 grid, wrist, the four knuckles, the thumb's
   * metacarpal): the part of the hand that finger joints can't rotate out of a surface. Optional offset `off`
   * (weapon frame) and `only` group. Leaves the deepest sample in `at`.
   */
  bodyPen(h: HandProxy, skip: Group | null, only: Group | null, off: Vector3 | null, at: Vector3): number {
    let worst = -Infinity;
    const col = this.col!;
    const sph = (r: number) => {
      if (off) _p.add(off);
      const d = r - col.sdf(_p, skip, only, r + 0.02);
      if (d > worst) {
        worst = d;
        at.copy(_p);
      }
    };
    const r = PALM.halfN;
    const hx = h.palmHalf.x - r,
      hz = h.palmHalf.z - r;
    for (let i = 0; i < PALM_NU; i++)
      for (let j = 0; j < PALM_NW; j++) {
        _p.set(-hx + (2 * hx * j) / (PALM_NW - 1), 0, -hz + (2 * hz * i) / (PALM_NU - 1)).applyMatrix4(
          h.palm,
        );
        sph(r);
      }
    for (let i = 0; i < 3; i++) {
      _p.lerpVectors(h.wristA, h.wristB, i / 2);
      sph(WRIST.r);
    }
    for (let f = 1; f < 5; f++) {
      _p.copy(h.chains[f][0].a);
      sph(h.chains[f][0].r);
    }
    const t = h.chains[0][0];
    // Firing hand: the thenar moves with the thumb (its synergy), never the gun.
    for (let i = 0; i < (h.side === 'L' ? 3 : 0); i++) {
      _p.lerpVectors(t.a, t.b, i * 0.2);
      sph(t.r);
    }
    return worst;
  }

  /** Broadphase around a hand (fingers + wrist). */
  private selectHand(h: HandProxy, extra = 0) {
    _p.copy(h.origin).addScaledVector(h.along, 0.07);
    this.col!.select(_p, 0.13 + extra);
    // The firing hand never collides with itself (it is an obstacle for the support hand only).
    this.col!.mute = h.side === 'R' ? (this.col!.hand ?? null) : null;
  }

  /** Refresh the firing hand as the support hand's obstacle (hand↔hand). */
  private handShape() {
    const R = this.hands.R.proxy;
    this.col!.setHand(R.phalanges, R.palm, R.palmInv, R.palmHalf, PALM.halfN);
  }

  /**
   * Hand offset (weapon frame) that clears the rigid hand body: preferably straight back along the palm
   * normal (the way a hand comes off a handguard or grip, never sideways through it), bisected to the
   * smallest clearing distance; else min-translation steps along the SDF gradient.
   */
  /** Candidate separation direction k (0–4): off the palm, tilted toward wrist / fingers / sides. */
  private palmDir(h: HandProxy, k: number, out: Vector3): Vector3 {
    out.copy(h.normal).negate();
    if (k === 1) out.addScaledVector(h.along, -0.6);
    else if (k === 2) out.addScaledVector(h.along, 0.6);
    else if (k === 3) out.addScaledVector(h.across, 0.6);
    else if (k === 4) out.addScaledVector(h.across, -0.6);
    return out.normalize();
  }

  private separate(
    h: HandProxy,
    skip: Group | null,
    max: number,
    out: Vector3,
    hint: { dir: number; dist?: number },
  ): Vector3 {
    out.set(0, 0, 0);
    const pen0 = this.bodyPen(h, skip, null, null, _pos);
    if (pen0 <= 0) {
      hint.dist = 0;
      return out;
    }
    // Warm start: last frame's direction and distance still clear, and 1.5 mm less doesn't → keep (2 evals).
    const hd = hint.dist ?? 0;
    if (hd > 0 && hint.dir < 5) {
      this.palmDir(h, hint.dir, _ax);
      _d.copy(_ax).multiplyScalar(hd);
      const clears = this.bodyPen(h, skip, null, _d, _pos) <= 0;
      if (clears) {
        _d.copy(_ax).multiplyScalar(Math.max(0, hd - 0.0015));
        if (this.bodyPen(h, skip, null, _d, _pos) > 0) return out.copy(_ax).multiplyScalar(hd);
      }
      // Same direction, re-bracketed: shrink toward 0 if it over-clears, grow toward `max` if it no longer does.
      let lo = clears ? 0 : hd,
        hi = clears ? hd : max;
      _d.copy(_ax).multiplyScalar(hi);
      if (clears || this.bodyPen(h, skip, null, _d, _pos) <= 0) {
        for (let i = 0; i < 5; i++) {
          const mid = (lo + hi) / 2;
          _d.copy(_ax).multiplyScalar(mid);
          if (this.bodyPen(h, skip, null, _d, _pos) <= 0) hi = mid;
          else lo = mid;
        }
        hint.dist = hi + CONTACT.clear * 0.5;
        return out.copy(_ax).multiplyScalar(hint.dist);
      }
    }
    // Candidate directions: straight off the palm, off the palm tilted toward the wrist / fingers / sides,
    // and the SDF gradient at the deepest sample. Shortest clearing distance wins.
    this.col!.gradient(_pos, _g, skip);
    for (let k = 0; k < 5; k++) this.palmDir(h, k, DIRS[k]);
    DIRS[5].copy(_g);
    let best = Infinity;
    for (let kk = 0; kk < DIRS.length; kk++) {
      // Last frame's winner first: if it still clears, keep it (stable and cheap).
      const k = kk === 0 ? hint.dir : kk === hint.dir ? 0 : kk;
      const dir = DIRS[k];
      _d.copy(dir).multiplyScalar(Math.min(max, best));
      if (this.bodyPen(h, skip, null, _d, _pos) > 0) continue;
      let lo = Math.min(pen0, max) * 0.5,
        hi = Math.min(max, best);
      _d.copy(dir).multiplyScalar(lo);
      if (this.bodyPen(h, skip, null, _d, _pos) <= 0) lo = 0;
      for (let i = 0; i < 6; i++) {
        const mid = (lo + hi) / 2;
        _d.copy(dir).multiplyScalar(mid);
        if (this.bodyPen(h, skip, null, _d, _pos) <= 0) hi = mid;
        else lo = mid;
      }
      if (hi < best) {
        best = hi;
        out.copy(dir).multiplyScalar(hi + CONTACT.clear);
        hint.dir = k;
        hint.dist = hi + CONTACT.clear;
        if (kk === 0) break;
      }
    }
    if (best < Infinity) return out;
    // Nothing clears within `max` along a straight line: min-translation steps.
    for (let it = 0; it < 5; it++) {
      const pen = this.bodyPen(h, skip, null, out, _pos);
      if (pen <= 0) break;
      this.col!.gradient(_pos, _g, skip);
      out.addScaledVector(_g, pen + CONTACT.clear);
    }
    return out;
  }

  // ------------------------------------------------------------------------------------------ 1. firing palm

  private firingPalm(dt: number) {
    const h = this.hands.R.proxy;
    this.selectHand(h, CONTACT.maxGun);
    // The gun moves by gunOff: equivalently the hand moves by -gunOff in the (old) weapon frame.
    // The gun moves out of the palm: the opposite of the hand's separation.
    const need = this.separate(h, this.skipL, CONTACT.maxGun, _t, this.gunHint).negate();
    this.col!.unselect();
    clampLen(need, CONTACT.maxGun);
    // Hard: at least `need` along its own direction; the rest eases out.
    easeVec(this.gunOff, need, dt);
    this.stats.gunOffset = this.gunOff.length();
    if (this.gunOff.lengthSq() > 1e-12) {
      this.rig.offsetGun(this.gunOff);
      this.col!.update();
      this.toWeapon.copy(this.model!.root.matrixWorld).invert();
      this.hands.R.proxy.update(this.toWeapon);
      this.hands.L.proxy.update(this.toWeapon);
    }
  }

  // ------------------------------------------------------------------------------------------ 2. free hands

  private pushHand(side: Side, dt: number, held = false) {
    const hs = this.hands[side];
    const h = hs.proxy;
    const skip = side === 'L' && !held ? this.skipL : null;
    const state = held ? this.heldPush : hs.push;
    this.selectHand(h, CONTACT.maxPush);
    const need = this.separate(h, skip, CONTACT.maxPush, _t, held ? this.heldHint : hs);
    this.col!.unselect();
    clampLen(need, CONTACT.maxPush);
    easeVec(state, need, dt);
    this.stats.push[side] = Math.max(held ? this.stats.push[side] : 0, state.length());
    if (state.lengthSq() < 1e-12) return;
    const hand = side === 'L' ? this.rig.bones.handL : this.rig.bones.handR;
    // Weapon-frame offset → world.
    _d.copy(state).transformDirection(this.model!.root.matrixWorld).multiplyScalar(state.length());
    hand.getWorldPosition(_p2).add(_d);
    this.rig.reachHand(side, _p2);
    hand.getWorldPosition(_p);
    this.stats.reachMiss = Math.max(this.stats.reachMiss, _p.distanceTo(_p2));
    h.update(this.toWeapon);
  }

  /** Apply the support hand's eased finger-residual back-off (weapon frame) through the arm IK. */
  private backOff(side: Side): boolean {
    const r = this.resOff[side];
    if (r.lengthSq() < 1e-12) return false;
    const hand = side === 'L' ? this.rig.bones.handL : this.rig.bones.handR;
    _d.copy(r).transformDirection(this.model!.root.matrixWorld).multiplyScalar(r.length());
    hand.getWorldPosition(_p2).add(_d);
    this.rig.reachHand(side, _p2);
    return true;
  }

  /**
   * This frame's back-off from this frame's finger residual: grows (τ 50 ms) toward clearing a finger still
   * > 1 mm in, holds while the worst finger is within −1…+3 mm, releases (τ 250 ms) once all are clear by 3 mm.
   */
  private updateBackOff(side: Side, dt: number) {
    const r = this.resOff[side];
    const t = this.resGoal[side];
    const g = this.minGap[side];
    if (g < -0.001) {
      const pen = this.fingerResidual(side, _pos);
      if (pen > 0.001) {
        this.col!.gradient(_pos, _g, null);
        t.copy(r).addScaledVector(_g, pen + CONTACT.clear);
        clampLen(t, CONTACT.maxBack);
      }
    } else if (g > 0.003) t.set(0, 0, 0);
    else t.copy(r);
    const k = 1 - Math.exp(-dt / (t.lengthSq() >= r.lengthSq() ? 0.05 : 0.25));
    r.lerp(t, k);
    if (r.lengthSq() < 1e-10 && t.lengthSq() === 0) r.set(0, 0, 0);
  }

  private resOff: Record<Side, Vector3> = { L: new Vector3(), R: new Vector3() };
  private resGoal: Record<Side, Vector3> = { L: new Vector3(), R: new Vector3() };

  // ------------------------------------------------------------------------------------------ 3. mag rules

  private magRules(dt: number) {
    const col = this.col!;
    const g = col.mag;
    const mag = this.model!.parts.mag;
    const st = this.rig.magState(0);
    const need = _t.set(0, 0, 0);
    if (g && mag && g.enabled && st.visible && st.travel > 0.002) {
      const L = this.hands.L.proxy;
      // (a) The support palm may not sink into the mag it holds: the mag moves out of the palm.
      if (st.held > 0.5) {
        for (let it = 0; it < 4; it++) {
          _d.copy(need).negate();
          // Either hand's body (the firing palm too: a pistol mag goes in right under it).
          let pp = this.bodyPen(L, null, g, _d, _pos);
          const pr = this.bodyPen(this.hands.R.proxy, null, g, _d, _p2);
          if (pr > pp) {
            pp = pr;
            _pos.copy(_p2);
          }
          if (pp <= 0) break;
          col.gradient(_pos, _g, null, g);
          need.addScaledVector(_g, -(pp + CONTACT.clear));
        }
      }
      // (b) Mag vs receiver: only the well opening admits it (mag surface samples vs the static set).
      const M = mag.matrixWorld;
      // Pistols: the grip is the well (the mag slides up the grip axis inside it).
      const pistol = !!this.model!.parts.slide;
      _p2.setFromMatrixPosition(M).applyMatrix4(this.toWeapon);
      col.select(_p2, 0.3);
      col.mute = col.plug ?? null;
      // Pistols: the whole grip is the well and the mag top sits inside the frame — no rule there (gap).
      for (let it = 0; it < (pistol ? 0 : 4); it++) {
        let worst = 0;
        for (let i = 0; i < this.magPts.length; i += 3) {
          _p.set(this.magPts[i], this.magPts[i + 1], this.magPts[i + 2])
            .applyMatrix4(M)
            .applyMatrix4(this.toWeapon)
            .add(need);
          const d = col.sdf(_p, g, null, 0.01);
          const n = col.hitGroup;
          if (d < -worst && n && n.name === 'static' && !(pistol && col.hit?.name === 'grip')) {
            worst = -d;
            _pos.copy(_p);
          }
        }
        if (worst < 0.0003) break;
        col.gradient(_pos, _g, g);
        need.addScaledVector(_g, worst + 0.0003);
      }
      col.unselect();
      col.mute = null;
      clampLen(need, CONTACT.maxMag);
    }
    easeVec(this.magOff, need, dt);
    this.stats.magOffset = this.magOff.length();
    if (mag && this.magOff.lengthSq() > 1e-12) {
      // Weapon frame offset; the mag's parent is the model root (weapon frame).
      if (mag.parent === this.model!.root) mag.position.add(this.magOff);
      else {
        _d.copy(this.magOff)
          .transformDirection(this.model!.root.matrixWorld)
          .multiplyScalar(this.magOff.length());
        mag.parent!.worldToLocal(mag.getWorldPosition(_p).add(_d));
        mag.position.copy(_p);
      }
      mag.updateMatrixWorld(true);
      col.update();
    }
  }

  // ------------------------------------------------------------------------------------------ 4. fingers

  /**
   * Finger pose from two synergies on top of the clip (and the baked grip, `this.base*`): `o` opens/closes
   * mostly at the knuckle (MCP) — how a hand opens around a thicker object — and `k` curls mostly the middle
   * and tip joints (PIP/DIP) — how it then wraps. Joint j turns by o·SO[j] + k·SC[j] about its flexion axis
   * (+ opens, − curls), proximal → distal. Writes posed points (PA/PB), axes (AX) and angles (ANG); returns
   * the chain's min clearance.
   */
  private synergy(h: HandProxy, fi: number, o: number, k: number, skip: Group | null): number {
    const chain = h.chains[fi];
    for (let j = 0; j < 3; j++) {
      PA[j].copy(chain[j].a);
      PB[j].copy(chain[j].b);
    }

    for (let j = 0; j < 3; j++) {
      _d.subVectors(PB[j], PA[j]).normalize();
      AX[j].crossVectors(h.normal, _d);
      if (AX[j].lengthSq() < 1e-10) AX[j].set(1, 0, 0);
      AX[j].normalize();
      const ang = this.baseD[j] + o * SO[j] + k * SC[j];
      ANG[j] = ang;
      if (ang !== 0) {
        _q.setFromAxisAngle(AX[j], ang);
        _p2.copy(PA[j]);
        for (let m = j; m < 3; m++) {
          PA[m].sub(_p2).applyQuaternion(_q).add(_p2);
          PB[m].sub(_p2).applyQuaternion(_q).add(_p2);
        }
      }
    }
    // The first phalanx starts beyond its knuckle sphere (the knuckle is rigid hand body, which no finger
    // rotation can move): sample it from 40 % of its length.
    _p2.lerpVectors(PA[0], PB[0], 0.4);
    let gap = -this.capsulePen(_p2, PB[0], chain[0].r, skip, 3);
    for (let j = 1; j < 3; j++) gap = Math.min(gap, -this.capsulePen(PA[j], PB[j], chain[j].r, skip));
    return gap;
  }

  /**
   * Bake one finger (hand poser): clear it first (open), then — for a holding finger — close every joint in
   * small steps; when a phalanx touches (≤ 1 mm) its joint and the ones before it freeze, the distal joints
   * keep closing, so the finger wraps the surface instead of stopping at the first fingertip contact.
   * Writes the joint deltas (rad, + opens) to `out[o..o+2]`.
   */
  private bakeFinger(h: HandProxy, fi: number, hold: boolean, out: Float32Array, o: number, rest = false) {
    const d = this.baseD;
    d.fill(0);
    const gapOf = (j: number) => {
      this.synergy(h, fi, 0, 0, null);
      const ch = h.chains[fi];
      if (j === 0) {
        _p2.lerpVectors(PA[0], PB[0], 0.4);
        return -this.capsulePen(_p2, PB[0], ch[0].r, null, 3);
      }
      return -this.capsulePen(PA[j], PB[j], ch[j].r, null);
    };
    const chainGap = () => Math.min(gapOf(0), gapOf(1), gapOf(2));
    const maxO = fi === 0 ? 0.9 : CONTACT.maxOpen;
    // 1. Clear: open (knuckle-led) just enough.
    if (chainGap() < CONTACT.clear) {
      const op = this.solveOpen(h, fi, null, maxO, 0);
      for (let j = 0; j < 3; j++) d[j] = op * SO[j];
    }
    // 2. Wrap: close each joint until its phalanx (or a distal one) touches.
    if (hold) {
      const step = 0.03;
      const frozen = [false, false, false];
      const start = [d[0], d[1], d[2]];
      let touched = false;
      // Joint ranges relative to the clip (keeps every joint inside its anatomical range: no PIP kink).
      const lim = [-0.6, -1.2, -1.0];
      for (let it = 0; it < 80 && !(frozen[0] && frozen[1] && frozen[2]); it++) {
        let moved = false;
        for (let j = 0; j < 3; j++) {
          if (frozen[j] || d[j] - step < lim[j]) {
            frozen[j] = true;
            continue;
          }
          d[j] -= step;
          // A distal phalanx that this step pushes into the surface rolls back (its own joint opens), so the
          // finger keeps wrapping around the surface; the joint stops when its own phalanx touches.
          const keep = [d[0], d[1], d[2]];
          for (let m = 2; m > j; m--)
            for (let r = 0; r < 4 && gapOf(m) < CONTACT.touch && d[m] + step <= 0.6; r++) d[m] += step;
          let blocked = gapOf(j) < CONTACT.touch;
          for (let m = j + 1; m < 3 && !blocked; m++) blocked = gapOf(m) < CONTACT.touch;
          if (blocked) {
            d[0] = keep[0];
            d[1] = keep[1];
            d[2] = keep[2];
            d[j] += step;
            frozen[j] = true;
            touched = true;
          } else moved = true;
        }
        if (!moved) break;
      }
      // Nothing to wrap within the joint ranges: keep the clip's curl (never close a fist on air).
      if (!touched || chainGap() > 0.003) for (let j = 0; j < 3; j++) d[j] = start[j];
    }
    // Trigger discipline: the firing index lies straight along the frame — the knuckle-led synergy closes it
    // onto the receiver side until it touches (≤ 1 mm), joints stay straight.
    if (rest) {
      for (let it = 0; it < 30 && chainGap() > CONTACT.touch; it++) {
        for (let j = 0; j < 3; j++) d[j] -= 0.02 * SO[j];
        if (chainGap() < CONTACT.touch * 0.5 || d[0] < -0.6) {
          for (let j = 0; j < 3; j++) d[j] += 0.02 * SO[j];
          break;
        }
      }
    }
    for (let j = 0; j < 3; j++) out[o + j] = d[j];
    d.fill(0);
  }

  /** Deepest finger-phalanx penetration of a hand (m); the deepest point in `at`. */
  private fingerResidual(side: Side, at: Vector3): number {
    const h = this.hands[side].proxy;
    let worst = -Infinity;
    this.selectHand(h);
    for (const ph of h.phalanges) {
      const p = this.capsulePen(ph.a, ph.b, ph.r, null, SEG_N, _p2);
      if (p > worst) {
        worst = p;
        at.copy(_p2);
      }
    }
    this.col!.unselect();
    return worst;
  }

  /** Open synergy that clears the chain: smallest |o| along `dir` (bisection, warm-started), else best effort. */
  private solveOpen(h: HandProxy, fi: number, skip: Group | null, maxO: number, prev: number): number {
    const C = CONTACT.clear;
    for (const dir of this.mode === 'safe' ? ([1] as const) : ([1, -1] as const)) {
      const max = dir > 0 ? maxO : 0.4;
      if (this.synergy(h, fi, max * dir, 0, skip) < C) continue;
      let lo = 0,
        hi = max,
        n = 8;
      const p = prev * dir;
      if (p > 0.02 && p < max - 0.02) {
        const a = Math.max(0, p - 0.06),
          b = Math.min(max, p + 0.06);
        if (
          this.synergy(h, fi, b * dir, 0, skip) >= C &&
          (a === 0 || this.synergy(h, fi, a * dir, 0, skip) < C)
        ) {
          lo = a;
          hi = b;
          n = 5;
        }
      }
      for (let i = 0; i < n; i++) {
        const mid = (lo + hi) / 2;
        if (this.synergy(h, fi, mid * dir, 0, skip) >= C) hi = mid;
        else lo = mid;
      }
      return hi * dir;
    }
    // Nothing clears: the least penetrating opening (coarse scan).
    let best = -Infinity,
      out = 0;
    for (let o = this.mode === 'safe' ? 0 : -0.4; o <= maxO + 1e-6; o += 0.1) {
      const g = this.synergy(h, fi, o, 0, skip);
      if (g > best + 1e-4) {
        best = g;
        out = o;
      }
    }
    this.stuckGap = best;
    return out;
  }

  /** Wrap curl (k ≥ 0 means curling by k) to first touch at opening `o`; 0 if the curl can't reach a surface. */
  private solveCurl(h: HandProxy, fi: number, o: number, skip: Group | null, target: number): number {
    if (this.synergy(h, fi, o, 0, skip) <= target) return 0;
    if (this.synergy(h, fi, o, -CONTACT.maxCurl, skip) > target) return 0;
    let lo = 0,
      hi = CONTACT.maxCurl;
    for (let i = 0; i < 7; i++) {
      const mid = (lo + hi) / 2;
      if (this.synergy(h, fi, o, -mid, skip) > target) lo = mid;
      else hi = mid;
    }
    return lo;
  }

  private fingers(side: Side, dt: number) {
    const hs = this.hands[side];
    const h = hs.proxy;
    const skip: Group | null = null; // fingers wrap the held mag too: never through it
    const firing = side === 'R' && this.rig.gunOnHand > 0.5;
    const bake = this.bake;
    const w =
      side === 'R' ? this.rig.gunOnHand : Math.min(1, Math.max(0, this.rig.anchorWeight('L', 'grip')));
    this.selectHand(h);
    let minG = Infinity;
    for (let fi = 0; fi < 5; fi++) {
      const cs = hs.chains[fi];
      // Baked grip pose blended in by the hold weight; the solve below is the residual on top of it.
      const spF = side === 'L' ? this.supportPose()?.fingers : undefined;
      const D = spF ?? (bake ? (side === 'R' ? bake.dR : bake.dL) : null);
      for (let j = 0; j < 3; j++) this.baseD[j] = D ? D[fi * 3 + j] * w : 0;
      // The thumb's synergy axis only approximates its flexion: keep its corrections small.
      // Safe mode: a finger opens by at most 15° at its knuckle (the synergy is knuckle-led) to clear.
      const maxO = this.mode === 'safe' ? 0.26 : fi === 0 ? 0.9 : CONTACT.maxOpen;
      // Wrap intent (from the authored pose; not the trigger finger, not the thumb).
      cs.wrap = this.mode === 'full' && fi !== 0 && !(firing && fi === 1) && cs.intent;
      // Steady state (one evaluation): last frame's correction still clears and, when wrapping, still touches —
      // keep it. Most hold frames end here.
      const gPrev = this.synergy(h, fi, cs.open[0], -cs.curl[0], skip);
      const idle = cs.open[0] === 0 && cs.curl[0] === 0;
      // A finger nothing clears (best effort last frame) stays put while that is still as good as it gets.
      const stuck = cs.stuck > -1 && gPrev >= cs.stuck - 0.0005 && gPrev < CONTACT.clear * 0.5;
      const steady =
        stuck ||
        (gPrev >= CONTACT.clear * 0.5 &&
          (cs.wrap ? gPrev <= CONTACT.touch + 0.002 || (idle && gPrev > CONTACT.wrapOut) : idle));
      if (!steady) {
        // 1. Open on penetration: hard (at once); releases ease out.
        let open = 0;
        this.stuckGap = NaN;
        if (this.synergy(h, fi, 0, 0, skip) < CONTACT.clear * 0.5)
          open = this.solveOpen(h, fi, skip, maxO, cs.open[0]);
        cs.stuck = Number.isNaN(this.stuckGap) ? -1 : this.stuckGap;
        // Eased both ways and rate-limited: a hard (same-frame) opening flicked a finger 15–45° in one frame
        // whenever recoil or the clip brushed it into the grip, then let it fall back — finger jitter under fire.
        // A few mm of penetration for 2–3 frames reads far better than a flick.
        const prev = cs.open[0];
        const want = Math.abs(open) > Math.abs(prev) ? ease(prev, open, dt, CONTACT.tauOpen) : ease(prev, open, dt, CONTACT.tauRelease);
        cs.open[0] = prev + Math.max(-CONTACT.maxOpenStep, Math.min(CONTACT.maxOpenStep, want - prev));
        if (Math.abs(cs.open[0]) < 1e-5) cs.open[0] = 0;
        // 2. Wrap: curl the middle/tip joints to the first touch (eased in), never into a surface.
        const curlT = cs.wrap ? this.solveCurl(h, fi, cs.open[0], skip, CONTACT.touch) : 0;
        cs.curl[0] = ease(cs.curl[0], curlT, dt);
        if (cs.curl[0] > 1e-4 && this.synergy(h, fi, cs.open[0], -cs.curl[0], skip) < CONTACT.clear * 0.5)
          cs.curl[0] = this.solveCurl(h, fi, cs.open[0], skip, CONTACT.clear * 0.5);
        if (cs.curl[0] < 1e-5) cs.curl[0] = 0;
      }
      // Index on the trigger while firing (fire state = the trigger channel): its pad curls onto the trigger
      // blade (first touch), eased in/out; at rest it lies along the frame (baked).
      if (firing && fi === 1 && this.mode === 'full') {
        const pull = this.rig.triggerPull;
        const trig = this.col!.groups.find((g) => g.part === 'trigger') ?? null;
        let k = 0;
        if (pull > 0.02 && trig) {
          this.onlyGroup = trig;
          k = this.solveCurl(h, fi, cs.open[0], null, CONTACT.touch);
          this.onlyGroup = null;
        }
        cs.trig = ease(cs.trig, k * Math.min(1, pull * 4), dt);
        if (
          cs.trig > 1e-4 &&
          this.synergy(h, fi, cs.open[0], -(cs.curl[0] + cs.trig), skip) >= CONTACT.clear * 0.5
        )
          cs.curl[0] = Math.max(cs.curl[0], cs.trig);
      }
      if (
        cs.open[0] === 0 &&
        cs.curl[0] === 0 &&
        this.baseD[0] === 0 &&
        this.baseD[1] === 0 &&
        this.baseD[2] === 0
      ) {
        minG = Math.min(minG, gPrev);
        continue;
      }
      // Steady: the pose from `gPrev` is the final one (no re-evaluation).
      const reuse = steady && !(firing && fi === 1);
      minG = Math.min(minG, reuse ? gPrev : this.synergy(h, fi, cs.open[0], -cs.curl[0], skip));
      const chain = h.chains[fi];
      for (let j = 0; j < 3; j++) {
        if (Math.abs(ANG[j]) < 1e-6) continue;
        _ax.copy(AX[j]);
        this.commit(chain[j].bone, ANG[j]);
      }
      for (let j = 0; j < 3; j++) {
        chain[j].a.copy(PA[j]);
        chain[j].b.copy(PB[j]);
      }
    }
    this.col!.unselect();
    this.baseD.fill(0);
    this.minGap[side] = minG;
  }

  /** Apply a weapon-frame rotation (about `_ax`, `ang`) to a bone's world orientation; update its subtree. */
  private commit(bone: Bone, ang: number) {
    const W = this.model!.root.matrixWorld;
    W.decompose(_s, _qw, _s);
    _q.setFromAxisAngle(_ax, ang);
    // World rotation = Qw · R · Qw⁻¹.
    _q.premultiply(_qw).multiply(_qp.copy(_qw).invert());
    bone.matrixWorld.decompose(_s, _qb, _s);
    bone.parent!.matrixWorld.decompose(_s, _qp, _s);
    bone.quaternion.copy(_qp.invert().multiply(_q).multiply(_qb));
    bone.updateMatrixWorld(true);
  }

  /** Release cached collision sets. */
  forget(model: WeaponModel) {
    this.cache.delete(model);
    if (this.model === model) this.model = undefined;
  }
}

function clampLen(v: Vector3, max: number) {
  const l = v.length();
  if (l > max) v.multiplyScalar(max / l);
}

/** Eased vector toward `need`, but never less than `need` along `need`'s direction (hard constraint). */
function easeVec(state: Vector3, need: Vector3, dt: number) {
  const k = Math.exp(-dt / CONTACT.tau);
  state.sub(need).multiplyScalar(k).add(need);
  const l2 = need.lengthSq();
  if (l2 > 1e-12) {
    const along = state.dot(need) / l2;
    if (along < 1) state.addScaledVector(need, 1 - along);
  }
}
