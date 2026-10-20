import {
  Bone,
  BufferAttribute,
  BufferGeometry,
  Euler,
  Group,
  Matrix4,
  Object3D,
  Quaternion,
  SkinnedMesh,
  Vector3,
  type Material,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { clone as skeletonClone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { WeaponModel } from '../../weapons/models';
import { magInfo, type MagInfo } from '../../weapons/models/magGeom';
import { roundsOn } from '../../weapons/models/magRounds';
import { solveTwoBone } from '../ik';
import { compose, keyAt, smoothKeyAt } from '../library/compose';
import { weaponAnims, type ArmsAction, type WeaponAnims } from '../library/library';
import { ANCHORS, type ClipsFile } from './clipData';
import { armsMaterials } from './materials';
import {
  addPose,
  blendPose,
  decodeClip,
  makeLayout,
  samplePose,
  type Clip,
  type ClipPresent,
  type HandKey,
  type Layout,
} from './pose';
import { canonicalBoneName } from './retarget';
import { loadSourceGltf } from './sourceAssets';

/**
 * One canonical pair of first-person arms (the AK pack's Ch08 arms restyled as gloves + combat shirt) for every
 * weapon. Clips come from public/assets/anims/clips.json (baked by tools/anim/build.ts) and are composed per
 * weapon by the library (src/anim/library). See README.md for the contract.
 *
 * `root` is rig space: origin at the eye, -z forward. The handling layer moves/rotates `root`; the weapon model
 * is parented under `root` and placed every update from the firing hand (or the rig while the firing hand is
 * off the grip). Order inside `update`: sample/crossfade → additive shoot → bones → weapon → support-hand IK
 * (anchor offsets + authored overrides) → parts (bolt/slide, trigger, safety, mags).
 */

export type RigAction = ArmsAction;

export interface PlayOptions {
  /** Time scale (> 1 faster). */
  speed?: number;
  /** Called for each event marker (`magOut`, `boltRelease`, `swapMid`, …) at its frame. */
  onEvent?: (beat: string) => void;
  /** Mag check: loop the hold section until `releaseHold()`. */
  hold?: boolean;
  /** Crossfade time from the current pose (s). */
  fade?: number;
}

interface Layer {
  clip: Clip;
  t: number;
  speed: number;
  onEvent?: (beat: string) => void;
  done: boolean;
}

const ANCHOR_SOCKET: Record<(typeof ANCHORS)[number], string> = {
  grip: 'gripLeft',
  well: 'magwell',
  charge: 'chargingHandle',
};
const CANCELLABLE: string[] = ['draw', 'swapIn', 'inspect', 'idle'];

const _v = new Vector3();
const _v2 = new Vector3();
const _q = new Quaternion();
const _q2 = new Quaternion();
const _m = new Matrix4();
const _m2 = new Matrix4();
const _s = new Vector3();
const ONE = new Vector3(1, 1, 1);

function readXf(a: ArrayLike<number>, o: number, p: Vector3, q: Quaternion) {
  p.set(a[o], a[o + 1], a[o + 2]);
  q.set(a[o + 3], a[o + 4], a[o + 5], a[o + 6]).normalize();
}

export class ArmsRig {
  /** Fade-out of a shot's kick when the next shot cuts in (s). */
  static SHOT_XFADE = 0.07;
  /** Fire cancelling a draw / inspect: crossfade back to the idle hold (s). */
  static CANCEL_XFADE = 0.14;
  /** Crossfade from the swap-out's held last pose into the next weapon's draw (s). */
  static SWAP_XFADE = 0.2;
  /** Dev toggles (anim.html?noik=1&nomerge=1). */
  static debug: {
    noIK: boolean;
    noMerge: boolean;
    /** Tuning: override the mag-check presentation pose ({ p, r } in the camera frame). */
    present?: { p: [number, number, number]; r: [number, number, number] };
    grip?: { turn: number; shift: [number, number, number] };
  } = { noIK: false, noMerge: false };
  /** Rig space (eye). Add to the scene / camera; the handling layer moves this. */
  readonly root = new Group();
  /** Canonical bones by name (Mixamo names without prefix): RightHand, LeftForeArm, RightHandIndex1, … */
  readonly boneMap = new Map<string, Bone>();
  readonly bones: {
    handR: Bone;
    handL: Bone;
    foreArmR: Bone;
    foreArmL: Bone;
    armR: Bone;
    armL: Bone;
    shoulderR: Bone;
    shoulderL: Bone;
  };
  /** The arms mesh(es); one skinned mesh with two material groups when the merge succeeds. */
  readonly meshes: SkinnedMesh[];
  /** Global listener for every event marker (in addition to per-play `onEvent`). */
  onBeat?: (beat: string, action: string) => void;

  private readonly layout: Layout;
  private readonly base: Record<string, Clip> = {};
  private readonly composed = new Map<string, Record<ArmsAction, Clip>>();
  private readonly pose: Float32Array;
  private readonly from: Float32Array;
  private readonly tmp: Float32Array;
  private addRef: Float32Array;
  private layer?: Layer;
  private fade = 0;
  private fadeDur = 0;
  /**
   * The clip being faded out keeps playing during the crossfade (its pose is sampled into `from` every frame).
   * A frozen snapshot stopped the outgoing motion dead on the fade's first frame — idle sway froze, and a
   * cancelled inspect / finished reload jerked (a velocity pop) into the next clip.
   */
  private outgoing?: { clip: Clip; t: number; speed: number };
  private shot?: Layer;
  /** The shot a newer shot cut into: keeps playing while it fades out (no snap of its kick back to zero). */
  private shotPrev?: Layer;
  private shotPrevW = 0;
  private prevRef: Float32Array;
  private holding = false;
  private lockedBack = false;
  private boneList: (Bone | undefined)[];
  private armLen = { R: [0, 0], L: [0, 0] };

  private weapon?: WeaponModel;
  private anims?: WeaponAnims;
  private clips?: Record<ArmsAction, Clip>;
  private sockets = new Map<string, Vector3>();
  private refSockets = new Map<string, Vector3>();
  private partRest = new Map<string, { p: Vector3; q: Quaternion }>();
  private spareMag?: Object3D;
  private pendingSwap?: { model: WeaponModel; id: string; opts: PlayOptions };
  private gunWorld = new Matrix4();
  private gunQ = new Quaternion();
  private magGeo: MagInfo | null = null;
  /**
   * Mag check: where the chest cam sits in rig space (root → camera). The presented mag is placed relative to it.
   * The controller keeps it current outside the check (it is frozen while the mag is out, so the mag rides the
   * hands, not a camera that may update a frame late). Default: measured idle rifle cam.
   */
  readonly presentOffset = new Matrix4().makeTranslation(0.025, 0, -0.17);
  /** This frame's mag-check layer: mag transform (model frame), hand weight, active. */
  private present = {
    on: false,
    hand: 0,
    m: new Matrix4(),
    travel: 0,
    turn: new Quaternion(),
    turnValid: false,
  };

  static async load(url = 'assets/anims/clips.json'): Promise<ArmsRig> {
    const [file, gltf] = await Promise.all([
      fetch(url).then((r) => r.json() as Promise<ClipsFile>),
      loadSourceGltf('ak'),
    ]);
    const mats = await armsMaterials();
    return new ArmsRig(file, skeletonClone(gltf.scene), mats);
  }

  /** Build from already-loaded data (headless tools/tests: the clips file + the AK glb scene, any materials). */
  static fromData(file: ClipsFile, scene: Object3D, mats: { gloves: Material; sleeves: Material }): ArmsRig {
    return new ArmsRig(file, skeletonClone(scene), mats);
  }

  private constructor(
    readonly file: ClipsFile,
    src: Object3D,
    mats: { gloves: Material; sleeves: Material },
  ) {
    this.root.name = 'ArmsRig';
    const xf = file.skeleton.root;
    src.position.set(xf[0], xf[1], xf[2]);
    src.quaternion.set(xf[3], xf[4], xf[5], xf[6]);
    // Keep only the arms.
    const drop: Object3D[] = [];
    src.traverse((o) => {
      if (o.name === 'Gun' || o.name.startsWith('Gun_')) drop.push(o);
    });
    for (const o of drop) o.removeFromParent();
    const body = src.getObjectByName('Ch08_Body') as SkinnedMesh;
    const sleeves = src.getObjectByName('Ch08_Hoodie') as SkinnedMesh;
    this.meshes = this.mergeArms(body, sleeves, mats);
    this.root.add(src);
    src.traverse((o) => {
      if ((o as Bone).isBone) this.boneMap.set(canonicalBoneName(o.name), o as Bone);
    });
    const b = (n: string) => {
      const x = this.boneMap.get(n);
      if (!x) throw new Error(`ArmsRig: missing bone ${n}`);
      return x;
    };
    this.bones = {
      handR: b('RightHand'),
      handL: b('LeftHand'),
      foreArmR: b('RightForeArm'),
      foreArmL: b('LeftForeArm'),
      armR: b('RightArm'),
      armL: b('LeftArm'),
      shoulderR: b('RightShoulder'),
      shoulderL: b('LeftShoulder'),
    };
    this.layout = makeLayout(file.skeleton.bones);
    this.boneList = this.layout.bones.map((n) => this.boneMap.get(n));
    for (const [id, j] of Object.entries(file.clips)) this.base[id] = decodeClip(j, this.layout);
    this.pose = new Float32Array(this.layout.stride);
    this.from = new Float32Array(this.layout.stride);
    this.tmp = new Float32Array(this.layout.stride);
    this.addRef = new Float32Array(this.layout.stride);
    this.prevRef = new Float32Array(this.layout.stride);
    this.root.updateMatrixWorld(true);
    const wp = (x: Bone) => x.getWorldPosition(new Vector3());
    this.armLen.R = [
      wp(this.bones.armR).distanceTo(wp(this.bones.foreArmR)),
      wp(this.bones.foreArmR).distanceTo(wp(this.bones.handR)),
    ];
    this.armLen.L = [
      wp(this.bones.armL).distanceTo(wp(this.bones.foreArmL)),
      wp(this.bones.foreArmL).distanceTo(wp(this.bones.handL)),
    ];
  }

  /** Merge hands + sleeves into one skinned mesh (2 material groups = 2 draw calls). */
  private mergeArms(body: SkinnedMesh, sleeves: SkinnedMesh, mats: { gloves: Material; sleeves: Material }) {
    // De-interleave and de-quantize (meshopt/KHR_mesh_quantization) so the two meshes can merge.
    const keep = (g: SkinnedMesh['geometry']) => {
      const c = new BufferGeometry();
      for (const k of ['position', 'normal', 'uv', 'skinIndex', 'skinWeight']) {
        const a = g.getAttribute(k);
        if (!a) continue;
        const n = a.itemSize;
        const arr = k === 'skinIndex' ? new Uint16Array(a.count * n) : new Float32Array(a.count * n);
        for (let i = 0; i < a.count; i++) for (let j = 0; j < n; j++) arr[i * n + j] = a.getComponent(i, j);
        c.setAttribute(k, new BufferAttribute(arr, n));
      }
      if (g.index) c.setIndex(Array.from(g.index.array as ArrayLike<number>));
      return c;
    };
    // Same bones, possibly in a different order: remap the sleeves onto the body's skeleton.
    const sg = keep(sleeves.geometry);
    const remap = sleeves.skeleton.bones.map((b) => body.skeleton.bones.indexOf(b));
    const si = sg.attributes.skinIndex;
    for (let i = 0; i < si.count; i++)
      for (let k = 0; k < 4; k++) si.setComponent(i, k, Math.max(0, remap[si.getComponent(i, k)]));
    // gltfpack folds each mesh's dequantisation into its inverse bind matrices: bring the sleeves into the
    // body's quantised space (a uniform scale + offset, identical for every bone).
    const j0 = remap.indexOf(0);
    if (j0 >= 0)
      sg.applyMatrix4(
        body.skeleton.boneInverses[0].clone().invert().multiply(sleeves.skeleton.boneInverses[j0]),
      );
    const merged =
      ArmsRig.debug.noMerge || remap.includes(-1) ? null : mergeGeometries([keep(body.geometry), sg], true);
    if (merged) {
      const mesh = new SkinnedMesh(merged, [mats.gloves, mats.sleeves]);
      mesh.name = 'Arms';
      mesh.position.copy(body.position);
      mesh.quaternion.copy(body.quaternion);
      mesh.scale.copy(body.scale);
      body.parent!.add(mesh);
      mesh.bind(body.skeleton, body.bindMatrix);
      mesh.frustumCulled = false;
      body.removeFromParent();
      sleeves.removeFromParent();
      return [mesh];
    }
    body.material = mats.gloves;
    sleeves.material = mats.sleeves;
    body.frustumCulled = sleeves.frustumCulled = false;
    return [body, sleeves];
  }

  // ------------------------------------------------------------------------------------------ weapon

  /** Clips composed for a weapon (cached). */
  clipsFor(weaponId: string): Record<ArmsAction, Clip> {
    let c = this.composed.get(weaponId);
    if (!c) {
      const a = weaponAnims(weaponId);
      c = {} as Record<ArmsAction, Clip>;
      for (const [action, recipe] of Object.entries(a.clips))
        c[action as ArmsAction] = compose(`${weaponId}.${action}`, action, recipe, this.base);
      this.composed.set(weaponId, c);
    }
    return c;
  }

  /** Parent `model` under the rig; it follows the firing hand via the clip's gun track from now on. */
  attachWeapon(model: WeaponModel, weaponId: string, opts: { keepAction?: boolean } = {}): void {
    if (this.weapon) this.detachWeapon();
    this.weapon = model;
    this.anims = weaponAnims(weaponId);
    this.clips = this.clipsFor(weaponId);
    this.lockedBack = false;
    this.root.add(model.root);
    model.root.updateMatrixWorld(true);
    const inv = _m.copy(model.root.matrixWorld).invert();
    this.sockets.clear();
    for (const [k, o] of Object.entries(model.sockets))
      if (o) this.sockets.set(k, o.getWorldPosition(new Vector3()).applyMatrix4(inv));
    for (const [k, o] of Object.entries(model.parts))
      if (o && !this.sockets.has(k)) this.sockets.set(k, o.getWorldPosition(new Vector3()).applyMatrix4(inv));
    const pack = this.file.packs[this.anims.pack];
    this.refSockets.clear();
    for (const [k, v] of Object.entries(pack?.refSockets ?? {})) this.refSockets.set(k, new Vector3(...v));
    this.partRest.clear();
    for (const [k, o] of Object.entries(model.parts))
      if (o) this.partRest.set(k, { p: o.position.clone(), q: o.quaternion.clone() });
    const mag = model.parts.mag;
    this.magGeo = null;
    if (mag) {
      this.magGeo = magInfo(model);
      this.spareMag = mag.clone(true);
      this.spareMag.name = 'spareMag';
      this.spareMag.visible = false;
      // The clone is the old mag falling out of an empty reload: no rounds in it.
      const r = roundsOn(this.spareMag);
      if (r) {
        r.count = 0;
        r.visible = false;
      }
      mag.parent!.add(this.spareMag);
    }
    this.present.on = false;
    this.seat.identity();
    this.seatIdentity = true;
    if (this.seatProvider) {
      // Measure the idle hold of this weapon without the seat, then restore the playback state.
      const s = this.atIdle(() => this.seatProvider!(this, model, weaponId));
      if (s) this.setGripSeat(s);
    }
    // A direct attach (loadout change, equipNow) starts this weapon's idle: the playing layer belongs to the
    // previous weapon's clip set (a rifle idle on the pistol stretched the support arm out and dropped the
    // gun). Only the swap chain keeps its swap-out layer, to crossfade it into this weapon's draw.
    const own = !!this.layer && Object.values(this.clips).includes(this.layer.clip);
    if (!this.layer || (!own && !opts.keepAction)) {
      this.shot = this.shotPrev = undefined;
      this.outgoing = undefined;
      this.fadeDur = 0;
      this.holding = false;
      this.play('idle', { fade: 0 });
    }
  }

  /**
   * Run `fn` with the rig posed at idle frame 0 (no events), then restore the playback state exactly — layer,
   * shot layers, crossfade, hold — and put the restored pose back on the bones and the weapon. Measurements made
   * mid-action (a mid-swap attach, the controller's idle gun frame) must never show the idle hold for a frame.
   */
  atIdle<T>(fn: () => T): T {
    const keep = {
      layer: this.layer,
      shot: this.shot,
      shotPrev: this.shotPrev,
      shotPrevW: this.shotPrevW,
      fadeDur: this.fadeDur,
      fade: this.fade,
      outgoing: this.outgoing,
      holding: this.holding,
      lockedBack: this.lockedBack,
    };
    const pose = this.pose.slice();
    const from = this.from.slice();
    const onBeat = this.onBeat;
    this.onBeat = undefined;
    this.shot = this.shotPrev = undefined;
    this.play('idle', { fade: 0 });
    this.update(0);
    try {
      return fn();
    } finally {
      this.onBeat = onBeat;
      Object.assign(this, keep);
      this.pose.set(pose);
      this.from.set(from);
      if (keep.layer) {
        this.applyBones();
        this.syncWeapon();
      }
    }
  }

  /**
   * Contact-layer hook, called on every attach with the rig posed at idle frame 0 (no seat): returns the grip
   * seat for this weapon (gun frame correction relative to the firing hand, weapon frame), or null.
   */
  seatProvider?: (rig: ArmsRig, model: WeaponModel, weaponId: string) => Matrix4 | null;
  private seat = new Matrix4();
  private seatIdentity = true;
  /** This frame's world change of the gun frame due to the seat (applied to an anchored support hand). */
  private seatDelta = new Matrix4();
  private seatMoved = false;

  /** Gun frame correction relative to the firing hand (weapon frame), applied while the hand holds the grip. */
  setGripSeat(m: Matrix4 | null): void {
    this.seat.copy(m ?? _m.identity());
    this.seatIdentity = !m;
  }

  detachWeapon(): void {
    if (!this.weapon) return;
    this.spareMag?.removeFromParent();
    this.spareMag = undefined;
    for (const [k, r] of this.partRest) {
      const o = this.weapon.parts[k as keyof WeaponModel['parts']];
      if (o) {
        o.position.copy(r.p);
        o.quaternion.copy(r.q);
        o.visible = true;
      }
    }
    this.weapon.root.removeFromParent();
    this.weapon = undefined;
  }

  get weaponModel(): WeaponModel | undefined {
    return this.weapon;
  }

  /**
   * Swap weapons: current weapon's `swapOut`, `swapMid` (the visible weapon changes), new weapon's `swapIn`.
   * Calling it again mid-swap retargets the pending weapon.
   */
  swapTo(model: WeaponModel, weaponId: string, opts: PlayOptions = {}): void {
    if (!this.weapon) {
      this.attachWeapon(model, weaponId);
      this.emit('swapMid', opts.onEvent);
      this.play('swapIn', { ...opts, fade: 0 });
      return;
    }
    this.pendingSwap = { model, id: weaponId, opts };
    if (this.layer?.clip.action !== 'swapOut') this.play('swapOut', opts);
  }

  // ------------------------------------------------------------------------------------------ playback

  get action(): string {
    return this.layer?.clip.action ?? 'idle';
  }

  /** True while a non-idle action is playing (a finished swapOut also counts: the weapon is away). */
  get busy(): boolean {
    const l = this.layer;
    if (!l) return false;
    if (l.clip.action === 'idle') return false;
    return !l.done || !!l.clip.holdLast;
  }

  /** True while an additive shot layer is still kicking. */
  get shooting(): boolean {
    return !!this.shot && !this.shot.done;
  }

  /** Current action time / duration (0..1). */
  get progress(): number {
    const l = this.layer;
    return l ? Math.min(1, l.t / Math.max(1e-6, l.clip.duration)) : 0;
  }

  duration(action: ArmsAction, weaponId?: string): number {
    const c = weaponId ? this.clipsFor(weaponId) : this.clips;
    return c ? c[action].duration : 0;
  }

  play(action: ArmsAction, opts: PlayOptions = {}): void {
    if (!this.clips) return;
    const clip = this.clips[action];
    if (!clip) return;
    if (clip.additive) {
      // Fire cancels draws/inspects (but not reloads — the controller gates those).
      if (this.layer && CANCELLABLE.includes(this.layer.clip.action) && this.layer.clip.action !== 'idle')
        this.play('idle', { fade: ArmsRig.CANCEL_XFADE });
      // A shot still kicking hands over to a fade-out slot: its delta eases to zero over SHOT_XFADE instead of
      // snapping back when the new shot restarts the layer.
      if (this.shot) {
        this.shotPrev = this.shot;
        this.shotPrevW = 1;
        const r = this.prevRef;
        this.prevRef = this.addRef;
        this.addRef = r;
      }
      samplePose(clip, 0, this.addRef);
      this.shot = { clip, t: 0, speed: opts.speed ?? 1, onEvent: opts.onEvent, done: false };
      if (action === 'shootLast' && this.anims?.locksBack) this.lockedBack = true;
      this.fireEvents(this.shot, -1, 0);
      return;
    }
    if (action !== 'idle' && action !== 'swapOut')
      this.lockedBack = action === 'reloadEmpty' ? false : this.lockedBack;
    if (action.startsWith('reload') || action === 'swapIn') this.lockedBack = false;
    const fade = opts.fade ?? 0.15;
    if (this.layer && fade > 0) {
      // Mid-fade the outgoing pose is itself a blend: freeze that; otherwise keep the outgoing clip playing.
      this.from.set(this.pose);
      const l = this.layer;
      this.outgoing = this.fadeDur > 0 ? undefined : { clip: l.clip, t: l.t, speed: l.speed };
      this.fade = 0;
      this.fadeDur = fade;
    } else {
      this.fadeDur = 0;
      this.outgoing = undefined;
    }
    this.layer = { clip, t: 0, speed: opts.speed ?? 1, onEvent: opts.onEvent, done: false };
    this.holding = !!opts.hold && !!clip.hold;
    this.fireEvents(this.layer, -1, 0);
  }

  /** Speed up the clip that's playing (a tactical reload upgraded to a speed reload mid-way). */
  hurry(k: number): void {
    if (this.layer && !this.layer.done) this.layer.speed *= k;
  }

  /** Mag check: leave the hold loop → reinsert + seat. */
  releaseHold(): void {
    this.holding = false;
  }

  private emit(beat: string, cb?: (b: string) => void) {
    cb?.(beat);
    this.onBeat?.(beat, this.action);
  }

  private fireEvents(l: Layer, t0: number, t1: number) {
    // Half-open (t0, t1]: consecutive frames share their boundary, so a marker fires exactly once. (A 1e-9
    // slack here fired a marker on a frame boundary twice: magOut at 0.100 s fired at 0.100 and 0.117.)
    for (const e of l.clip.events) if (e.t > t0 && e.t <= t1) this.emit(e.name, l.onEvent);
  }

  update(dt: number): void {
    if (!this.layer || !this.clips) return;
    const L = this.layout;
    const l = this.layer;
    // Advance the base layer (hold loop, events, end).
    if (!l.done) {
      const t0 = l.t;
      let t1 = t0 + dt * l.speed;
      if (this.holding && l.clip.hold && t0 <= l.clip.hold[1] && t1 > l.clip.hold[1]) {
        this.fireEvents(l, t0, l.clip.hold[1]);
        t1 = l.clip.hold[0] + (t1 - l.clip.hold[1]);
        l.t = t1;
      } else {
        if (l.clip.loop && t1 > l.clip.duration) {
          this.fireEvents(l, t0, l.clip.duration);
          t1 -= l.clip.duration;
          this.fireEvents(l, -1e-9, t1);
        } else this.fireEvents(l, t0, Math.min(t1, l.clip.duration));
        l.t = t1;
      }
      if (!l.clip.loop && l.t >= l.clip.duration) {
        l.t = l.clip.duration;
        l.done = true;
      }
    }
    samplePose(l.clip, l.t, this.pose);
    if (this.fadeDur > 0) {
      const o = this.outgoing;
      if (o) {
        o.t += dt * o.speed;
        o.t = o.clip.loop ? o.t % o.clip.duration : Math.min(o.t, o.clip.duration);
        samplePose(o.clip, o.t, this.from);
      }
      this.fade += dt;
      const k = Math.min(1, this.fade / this.fadeDur);
      blendPose(L, this.tmp, this.from, 0, this.pose, 0, k * k * (3 - 2 * k));
      this.pose.set(this.tmp);
      if (k >= 1) {
        this.fadeDur = 0;
        this.outgoing = undefined;
      }
    }
    // Additive shot on top.
    const s = this.shot;
    if (s) {
      const st = s.t + dt * s.speed;
      this.fireEvents(s, s.t, st);
      s.t = st;
      if (s.t >= s.clip.duration) this.shot = undefined;
      else {
        samplePose(s.clip, s.t, this.tmp);
        addPose(L, this.pose, this.addRef, this.tmp, 1);
      }
    }
    const sp = this.shotPrev;
    if (sp) {
      sp.t += dt * sp.speed;
      this.shotPrevW -= dt / ArmsRig.SHOT_XFADE;
      if (this.shotPrevW <= 0 || sp.t >= sp.clip.duration) this.shotPrev = undefined;
      else {
        const k = this.shotPrevW;
        samplePose(sp.clip, sp.t, this.tmp);
        addPose(L, this.pose, this.prevRef, this.tmp, k * k * (3 - 2 * k));
      }
    }
    if (this.lockedBack) this.pose[L.ch.bolt] = Math.max(this.pose[L.ch.bolt], 1);
    this.applyBones();
    this.syncWeapon();
    // Chain finished actions.
    if (l.done && this.layer === l) {
      if (l.clip.action === 'swapOut' && this.pendingSwap) {
        const p = this.pendingSwap;
        this.pendingSwap = undefined;
        this.attachWeapon(p.model, p.id, { keepAction: true });
        this.emit('swapMid', p.opts.onEvent);
        // The swap-out's last pose and the draw's first are far apart (≈ 60 cm at the support hand): a 0.06 s
        // fade moved the arm through view in 3–4 frames. Both ends are below the frame; 0.2 s keeps it continuous.
        this.play('swapIn', { ...p.opts, fade: ArmsRig.SWAP_XFADE });
      } else if (!l.clip.holdLast && !l.clip.loop) this.play('idle', { fade: 0.2 });
    }
  }

  private applyBones() {
    const P = this.pose;
    const L = this.layout;
    for (let i = 0; i < this.boneList.length; i++) {
      const b = this.boneList[i];
      if (!b) continue;
      const o = L.rot + i * 4;
      b.quaternion.set(P[o], P[o + 1], P[o + 2], P[o + 3]);
    }
    for (const [n, o] of Object.entries(L.pos)) {
      const b = this.boneMap.get(n);
      if (b && (P[o] || P[o + 1] || P[o + 2])) b.position.set(P[o], P[o + 1], P[o + 2]);
    }
    this.root.updateMatrixWorld(true);
  }

  /**
   * Place the weapon from the current bone pose, run the support/firing-hand IK and drive the parts.
   * Call again if a later layer (grip correction) moves the hand bones after `update`.
   */
  syncWeapon(): void {
    const model = this.weapon;
    const a = this.anims;
    if (!model || !a || !this.layer) return;
    const P = this.pose;
    const L = this.layout;
    // Gun frame: firing hand × gunHand blended with root × gunRoot.
    const w = Math.max(0, Math.min(1, P[L.gunW]));
    const pH = _v;
    const qH = _q;
    readXf(P, L.gunHand, pH, qH);
    _m.compose(pH, qH, ONE);
    this.bones.handR.matrixWorld.decompose(_v2, _q2, _s);
    _m2.compose(_v2, _q2, ONE).multiply(_m);
    const handGun = _m2.clone();
    readXf(P, L.gunRoot, pH, qH);
    _m.compose(pH, qH, ONE).premultiply(this.root.matrixWorld);
    const pA = new Vector3();
    const qA = new Quaternion();
    const pB = new Vector3();
    const qB = new Quaternion();
    handGun.decompose(pA, qA, _s);
    _m.decompose(pB, qB, _s);
    pB.lerp(pA, w);
    qB.slerp(qA, w);
    this.gunWorld.compose(pB, qB, ONE).multiply(_m.makeTranslation(-a.grip[0], -a.grip[1], -a.grip[2]));
    // Per-weapon grip seat (contact layer): the gun frame corrected relative to the hand, blended by gunW.
    this.seatMoved = false;
    if (w > 0.001 && !this.seatIdentity) {
      this.seatDelta.copy(this.gunWorld).invert();
      this.seatMoved = true;
      if (w >= 0.999) this.gunWorld.multiply(this.seat);
      else {
        this.seat.decompose(pA, qA, _s);
        pA.multiplyScalar(w);
        qA.slerp(_q.identity(), 1 - w);
        this.gunWorld.multiply(_m.compose(pA, qA, ONE));
      }
      this.gunWorld.decompose(pB, qB, _s);
      this.seatDelta.premultiply(this.gunWorld);
    }
    this.gunQ.copy(qB);
    _m.copy(this.root.matrixWorld).invert().multiply(this.gunWorld);
    _m.decompose(model.root.position, model.root.quaternion, _s);
    model.root.updateMatrixWorld(true);

    // Hands onto this weapon's anchors.
    if (ArmsRig.debug.noIK) return this.driveParts();
    this.handIK('L', L.wL, this.layer.clip.handL);
    if (w < 0.99 || this.layer.clip.handR) this.handIK('R', L.wR, this.layer.clip.handR);
    this.presentLayer(this.layer.clip.present);
    this.driveParts();
  }

  // ------------------------------------------------------------------------------------------ mag check layer

  private pv = {
    pA: new Vector3(),
    pB: new Vector3(),
    qA: new Quaternion(),
    qB: new Quaternion(),
    m: new Matrix4(),
    m2: new Matrix4(),
    grip: new Matrix4(),
    e: new Euler(),
    v: new Vector3(),
    x: new Vector3(1, 0, 0),
    o1: new Matrix4(),
    o2: new Matrix4(),
    oq: new Quaternion(),
    ov: new Vector3(),
  };

  /** Mag offset (mag frame → model frame) at path value v ∈ [0, 1]: out of the well along its axis (AK: rock first). */
  private magOut(pr: ClipPresent, g: MagInfo, v: number, out: Matrix4): Matrix4 {
    const r = this.pv;
    const rock = pr.rock;
    if (rock) {
      const span = pr.rockSpan;
      const th = rock * Math.min(1, v / span);
      // Rotate about the front lug, then slide down the rocked axis.
      r.oq.setFromAxisAngle(r.x, th);
      out
        .makeTranslation(g.lug.x, g.lug.y, g.lug.z)
        .multiply(r.o1.makeRotationFromQuaternion(r.oq))
        .multiply(r.o2.makeTranslation(-g.lug.x, -g.lug.y, -g.lug.z));
      const d = Math.max(0, (v - span) / (1 - span)) * g.travel;
      r.ov.copy(g.axis).applyQuaternion(r.oq).multiplyScalar(d);
      return out.premultiply(r.o1.makeTranslation(r.ov.x, r.ov.y, r.ov.z));
    }
    r.ov.copy(g.axis).multiplyScalar(v * g.travel);
    return out.makeTranslation(r.ov.x, r.ov.y, r.ov.z);
  }

  /**
   * Mag check (after the hand IK, before the parts): the mag follows its path — out of the well with a clear gap,
   * then up to the camera — and the support hand rides it (two-bone IK onto the clip's grip on the mag).
   */
  private presentLayer(pr?: ClipPresent) {
    const st = this.present;
    st.on = false;
    const g = this.magGeo;
    const t = this.layer!.t;
    if (!pr || !g || !this.weapon?.parts.mag || t < pr.t0 || t > pr.t1) {
      st.turnValid = false;
      return;
    }
    const r = this.pv;
    const v = Math.max(0, smoothKeyAt(pr.path, t));
    const hw = Math.min(1, Math.max(0, smoothKeyAt(pr.hand, t)));
    // World transform of the mag along its path.
    const out = this.magOut(pr, g, Math.min(1, v), r.m2.identity());
    const world = new Matrix4().multiplyMatrices(this.gunWorld, out);
    if (v > 1) {
      const u = Math.min(1, v - 1);
      world.decompose(r.pA, r.qA, _s);
      // Presented: mag centre at pose.p in the camera frame, turned by pose.r.
      const pose = ArmsRig.debug.present ?? pr.pose;
      r.m.copy(this.root.matrixWorld).multiply(this.presentOffset);
      r.m.multiply(_m.makeTranslation(pose.p[0], pose.p[1], pose.p[2]));
      r.m.multiply(_m.makeRotationFromEuler(r.e.set(pose.r[0], pose.r[1], pose.r[2])));
      r.m.multiply(_m.makeTranslation(-g.centre.x, -g.centre.y, -g.centre.z));
      r.m.decompose(r.pB, r.qB, _s);
      const k = u * u * (3 - 2 * u);
      r.pA.lerp(r.pB, k);
      r.qA.slerp(r.qB, k);
      // Swing out around the gun on the way (camera-frame offset, peaks mid-leg).
      const arc = Math.sin(Math.PI * u);
      if (arc > 1e-4) {
        r.v.set(pr.arc[0], pr.arc[1], pr.arc[2]).multiplyScalar(arc);
        r.m.copy(this.root.matrixWorld).multiply(this.presentOffset);
        r.v.transformDirection(r.m).multiplyScalar(Math.hypot(...pr.arc) * arc);
        r.pA.add(r.v);
      }
      world.compose(r.pA, r.qA, ONE);
    }
    // Support hand onto the mag (grip = the source clip's mag-in-hand transform).
    const gp = pr.grip;
    r.grip.compose(r.v.set(gp[0], gp[1], gp[2]), r.qB.set(gp[3], gp[4], gp[5], gp[6]).normalize(), ONE);
    const gt = ArmsRig.debug.grip?.turn ?? pr.gripTurn;
    const sh = ArmsRig.debug.grip?.shift ?? pr.gripShift;
    if (gt || sh.some((x) => x)) {
      // grip' = grip · A⁻¹ with A = T(shift) · T(c) · Ry(turn) · T(-c) acting on the hand in the mag frame.
      const c = g.centre;
      r.o1
        .makeTranslation(sh[0] + c.x, sh[1] + c.y, sh[2] + c.z)
        .multiply(r.o2.makeRotationY(gt))
        .multiply(_m.makeTranslation(-c.x, -c.y, -c.z));
      r.grip.multiply(r.o1.invert());
    }
    if (hw <= 0.001) st.turnValid = false;
    if (hw > 0.001) {
      const hand = this.bones.handL;
      r.m.copy(world).multiply(_m.copy(r.grip).invert());
      r.m.decompose(r.pB, r.qB, _s);
      hand.getWorldPosition(r.pA);
      hand.getWorldQuaternion(r.qA);
      r.pA.lerp(r.pB, hw);
      // Turn (world) taking the animated hand to the grip orientation, weighted. Kept on last frame's hemisphere
      // and scaled by angle (not shortest-arc slerp), so a turn passing 180° while the clip hand swings doesn't flip.
      const full = r.qB.multiply(r.qA.invert()).normalize();
      if (st.turnValid && full.dot(st.turn) < 0) full.set(-full.x, -full.y, -full.z, -full.w);
      st.turn.copy(full);
      st.turnValid = true;
      const ang = 2 * Math.acos(Math.max(-1, Math.min(1, full.w)));
      const sn = Math.sin(ang / 2);
      if (sn > 1e-6) r.v.set(full.x / sn, full.y / sn, full.z / sn);
      else r.v.set(1, 0, 0);
      const turn = _q.setFromAxisAngle(r.v, ang * hw);
      this.reachHand('L', r.pA, turn);
      // The mag sits in the hand where the hand actually got to (IK reach limits).
      hand.updateMatrixWorld(true);
      hand.matrixWorld.decompose(r.pA, r.qA, _s);
      r.m.compose(r.pA, r.qA, ONE).multiply(r.grip);
      r.m.decompose(r.pB, r.qB, _s);
      world.decompose(r.pA, r.qA, _s);
      // Only once the hand has it (mid-reach the hand is still on its way: the mag stays on its path).
      const k = hw ** 8;
      r.pA.lerp(r.pB, k);
      r.qA.slerp(r.qB, k);
      world.compose(r.pA, r.qA, ONE);
    }
    st.m.copy(this.gunWorld).invert().multiply(world);
    st.hand = hw;
    st.travel = r.v.setFromMatrixPosition(st.m).length();
    st.on = true;
  }

  private anchorDelta(socket: string, out: Vector3): boolean {
    const mine = this.sockets.get(socket);
    const ref = this.refSockets.get(socket);
    if (!mine || !ref) return false;
    out.subVectors(mine, ref);
    return true;
  }

  private handIK(side: 'L' | 'R', wIdx: Layout['wL'], keys?: HandKey[]) {
    const P = this.pose;
    const hand = side === 'L' ? this.bones.handL : this.bones.handR;
    const fore = side === 'L' ? this.bones.foreArmL : this.bones.foreArmR;
    const arm = side === 'L' ? this.bones.armL : this.bones.armR;
    const wrist = hand.getWorldPosition(new Vector3());
    const target = wrist.clone();
    // Anchor offsets (this weapon's socket − the pack reference weapon's), weighted by contact.
    const delta = new Vector3();
    let wsum = 0;
    for (const an of ANCHORS) {
      const wv = P[wIdx[an]];
      if (wv <= 0.001 || !this.anchorDelta(ANCHOR_SOCKET[an], _v)) continue;
      delta.addScaledVector(_v, wv);
      wsum += wv;
    }
    if (wsum > 1) delta.divideScalar(wsum);
    // A support hand on the gun follows the grip seat's correction of the gun (weighted by its contact).
    let seatTurn: Quaternion | undefined;
    const sw = side === 'L' && this.seatMoved ? Math.min(1, wsum) : 0;
    if (sw > 0.001) {
      target.lerp(_v.copy(wrist).applyMatrix4(this.seatDelta), sw);
      this.seatDelta.decompose(_v2, _q2, _s);
      seatTurn = new Quaternion().slerp(_q2, sw);
    }
    target.add(delta.applyQuaternion(this.gunQ));
    // Authored overrides.
    let turn: Quaternion | undefined;
    if (keys?.length) {
      const t = this.layer!.t;
      if (t >= keys[0].t && t <= keys[keys.length - 1].t) {
        const kw = keyAt(keys, t, (k) => k.w);
        if (kw > 0.001) {
          let i = keys.findIndex((k) => k.t >= t);
          if (i < 0) i = keys.length - 1;
          const at = keys[Math.max(0, i)].at;
          const base = this.sockets.get(at) ?? new Vector3();
          const off = new Vector3(
            keyAt(keys, t, (k) => k.off[0]),
            keyAt(keys, t, (k) => k.off[1]),
            keyAt(keys, t, (k) => k.off[2]),
          );
          const goal = base.clone().add(off).applyMatrix4(this.gunWorld);
          target.lerp(goal, kw);
          if (keys.some((k) => k.turn)) {
            const e = new Euler(
              keyAt(keys, t, (k) => k.turn?.[0] ?? 0),
              keyAt(keys, t, (k) => k.turn?.[1] ?? 0),
              keyAt(keys, t, (k) => k.turn?.[2] ?? 0),
            );
            // Rotation about weapon axes, applied on top of the animated hand orientation.
            turn = this.gunQ
              .clone()
              .multiply(new Quaternion().setFromEuler(e))
              .multiply(this.gunQ.clone().invert());
          }
        }
      }
    }
    if (target.distanceToSquared(wrist) < 1e-8 && !turn && !seatTurn) return;
    // Two-bone solve keeping the hand's world rotation and the current bend plane.
    const handQ = hand.getWorldQuaternion(new Quaternion());
    if (seatTurn) handQ.premultiply(seatTurn);
    if (turn) handQ.premultiply(turn);
    const sh = arm.getWorldPosition(new Vector3());
    const el = fore.getWorldPosition(new Vector3());
    const pole = el.clone().add(el.clone().sub(sh.clone().lerp(wrist, 0.5)));
    const [l1, l2] = this.armLen[side];
    const mid = new Vector3();
    const end = new Vector3();
    solveTwoBone(sh, target, pole, l1, l2, mid, end);
    this.aim(arm, el, mid);
    arm.updateMatrixWorld(true);
    this.aim(fore, hand.getWorldPosition(new Vector3()), end);
    fore.updateMatrixWorld(true);
    // Restore the hand's world rotation.
    const parentQ = fore.getWorldQuaternion(new Quaternion());
    hand.quaternion.copy(parentQ.invert().multiply(handQ));
    hand.updateMatrixWorld(true);
  }

  /** Rotate `bone` so its child currently at `childNow` moves to `childGoal`. */
  private aim(bone: Bone, childNow: Vector3, childGoal: Vector3) {
    const o = bone.getWorldPosition(new Vector3());
    const a = childNow.clone().sub(o).normalize();
    const b = childGoal.clone().sub(o).normalize();
    const d = new Quaternion().setFromUnitVectors(a, b);
    const wq = bone.getWorldQuaternion(new Quaternion());
    const pq = bone.parent!.getWorldQuaternion(new Quaternion());
    bone.quaternion.copy(pq.invert().multiply(d.multiply(wq)));
  }

  private driveParts() {
    const model = this.weapon!;
    const a = this.anims!;
    const P = this.pose;
    const L = this.layout;
    const rest = (k: string) => this.partRest.get(k);
    const bolt = P[L.ch.bolt];
    for (const d of a.drive) {
      const o = model.parts[d.part];
      const r = rest(d.part);
      if (!o || !r) continue;
      o.position.set(r.p.x, r.p.y, r.p.z + bolt * d.travel);
    }
    const trig = model.parts.trigger;
    if (trig && rest('trigger'))
      trig.quaternion
        .copy(rest('trigger')!.q)
        .multiply(_q.setFromEuler(new Euler(P[L.ch.trigger] * a.triggerRad, 0, 0)));
    const saf = model.parts.safety;
    if (saf && rest('safety') && a.safetyRad)
      saf.quaternion
        .copy(rest('safety')!.q)
        .multiply(_q.setFromEuler(new Euler(P[L.ch.safety] * a.safetyRad, 0, 0)));
    // Mags: blend gun-relative and support-hand-relative transforms (model frame).
    const invGun = _m2.copy(this.gunWorld).invert();
    const parts = [model.parts.mag, this.spareMag];
    L.mag.forEach((m, k) => {
      const o = parts[k];
      const r = rest('mag');
      if (!o || !r) return;
      if (k === 0 && this.present.on) {
        o.visible = true;
        this.present.m.decompose(o.position, o.quaternion, _s);
        o.position.add(r.p);
        o.quaternion.multiply(r.q);
        return;
      }
      const vis = P[m.vis] > 0.5;
      o.visible = k === 0 ? vis : vis;
      if (!vis) return;
      const pg = new Vector3();
      const qg = new Quaternion();
      readXf(P, m.gun, pg, qg);
      const hw = Math.max(0, Math.min(1, P[m.w]));
      if (hw > 0.001) {
        const ph = new Vector3();
        const qh = new Quaternion();
        readXf(P, m.hand, ph, qh);
        this.bones.handL.matrixWorld.decompose(_v2, _q2, _s);
        _m.compose(_v2, _q2, ONE)
          .multiply(new Matrix4().compose(ph, qh, ONE))
          .premultiply(invGun);
        _m.decompose(ph, qh, _s);
        pg.lerp(ph, hw);
        qg.slerp(qh, hw);
      }
      const style = this.layer?.clip.magStyle;
      if (style === 'straight') {
        const d = pg.length();
        if (d < 0.15) {
          const k2 = 1 - d / 0.15;
          qg.slerp(_q.identity(), k2);
          pg.x *= 1 - k2;
          pg.z *= 1 - k2;
        }
      }
      o.position.copy(r.p).add(pg);
      o.quaternion.copy(r.q).premultiply(qg);
    });
  }

  // ------------------------------------------------------------------------------------------ contact layer API

  /** 0..1: the gun rides the firing hand (1) or the rig (0) this frame. */
  /** 0..1 trigger channel this frame (the shot layer pulls it). */
  get triggerPull(): number {
    return this.layer ? Math.max(0, Math.min(1, this.pose[this.layout.ch.trigger])) : 0;
  }

  get gunOnHand(): number {
    return this.layer ? Math.max(0, Math.min(1, this.pose[this.layout.gunW])) : 1;
  }

  /** Mag slot `k` (0 = the model's mag): support-hand weight, visibility and distance from its seat (m). */
  magState(k = 0): { held: number; visible: boolean; travel: number } {
    if (k === 0 && this.present.on)
      return { held: this.present.hand, visible: true, travel: this.present.travel };
    const m = this.layout.mag[k];
    const P = this.pose;
    const o = m.gun;
    return {
      held: Math.max(0, Math.min(1, P[m.w])),
      visible: P[m.vis] > 0.5,
      travel: Math.hypot(P[o], P[o + 1], P[o + 2]),
    };
  }

  /** Anchor-contact weight of a hand this frame (`grip`, `well`, `charge`). */
  anchorWeight(side: 'L' | 'R', anchor: (typeof ANCHORS)[number]): number {
    return this.pose[(side === 'L' ? this.layout.wL : this.layout.wR)[anchor]];
  }

  /**
   * Shift the weapon by `d` (weapon frame, metres) relative to where the hand track put it, then re-drive the
   * parts. Contact layer: moves the gun out of the firing palm.
   */
  offsetGun(d: Vector3): void {
    const model = this.weapon;
    if (!model) return;
    this.gunWorld.multiply(_m.makeTranslation(d.x, d.y, d.z));
    _m.copy(this.root.matrixWorld).invert().multiply(this.gunWorld);
    _m.decompose(model.root.position, model.root.quaternion, _s);
    model.root.updateMatrixWorld(true);
    this.driveParts();
  }

  /** Re-drive bolt/slide/trigger/mags from the current bones (after a later layer moved the support hand). */
  refreshParts(): void {
    if (this.weapon && this.anims && this.layer) this.driveParts();
  }

  /**
   * Two-bone arm solve putting `side`'s wrist on `target` (world), keeping the hand's world rotation (optionally
   * turned by `turn`, world) and the current elbow bend plane. Allocation-free.
   */
  reachHand(side: 'L' | 'R', target: Vector3, turn?: Quaternion): void {
    const hand = side === 'L' ? this.bones.handL : this.bones.handR;
    const fore = side === 'L' ? this.bones.foreArmL : this.bones.foreArmR;
    const arm = side === 'L' ? this.bones.armL : this.bones.armR;
    const r = this.reach;
    hand.getWorldQuaternion(r.hq);
    if (turn) r.hq.premultiply(turn);
    arm.getWorldPosition(r.sh);
    fore.getWorldPosition(r.el);
    hand.getWorldPosition(r.wr);
    r.mid.copy(r.sh).lerp(r.wr, 0.5);
    r.pole.copy(r.el).sub(r.mid).add(r.el);
    const [l1, l2] = this.armLen[side];
    solveTwoBone(r.sh, target, r.pole, l1, l2, r.mid, r.end);
    this.aimTo(arm, r.el, r.mid);
    arm.updateMatrixWorld(true);
    hand.getWorldPosition(r.wr);
    this.aimTo(fore, r.wr, r.end);
    fore.updateMatrixWorld(true);
    fore.getWorldQuaternion(r.pq);
    hand.quaternion.copy(r.pq.invert().multiply(r.hq));
    hand.updateMatrixWorld(true);
  }

  private reach = {
    hq: new Quaternion(),
    pq: new Quaternion(),
    wq: new Quaternion(),
    sh: new Vector3(),
    el: new Vector3(),
    wr: new Vector3(),
    mid: new Vector3(),
    end: new Vector3(),
    pole: new Vector3(),
    a: new Vector3(),
    b: new Vector3(),
    o: new Vector3(),
  };

  /** Allocation-free `aim`. */
  private aimTo(bone: Bone, childNow: Vector3, childGoal: Vector3) {
    const r = this.reach;
    bone.getWorldPosition(r.o);
    r.a.copy(childNow).sub(r.o).normalize();
    r.b.copy(childGoal).sub(r.o).normalize();
    _q2.setFromUnitVectors(r.a, r.b);
    bone.getWorldQuaternion(r.wq);
    bone.parent!.getWorldQuaternion(r.pq);
    bone.quaternion.copy(r.pq.invert().multiply(_q2.multiply(r.wq)));
  }

  /** For tests/debug: the weapon socket world position. */
  socketWorld(name: string, out = new Vector3()): Vector3 | undefined {
    const s = this.sockets.get(name);
    return s ? out.copy(s).applyMatrix4(this.gunWorld) : undefined;
  }

  get drawCalls(): number {
    let n = 0;
    for (const m of this.meshes) n += Array.isArray(m.material) ? m.material.length : 1;
    return n;
  }

  dispose(): void {
    this.detachWeapon();
    for (const m of this.meshes) m.geometry.dispose();
  }
}
