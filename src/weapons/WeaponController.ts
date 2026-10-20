import { Euler, Group, Matrix4, Object3D, Quaternion, Vector3 } from 'three';
import type { Context, System } from '../core/Context';
import { Spring, clamp, damp, noise1, rng } from '../core/math';
import { ReloadGesture } from '../input/ReloadGesture';
import { CHEST_MOUNT, type Player } from '../player/Player';
import { ScopeOverlay } from '../player/ScopeOverlay';
import { settings } from '../settings/Settings';
import { CFG, type ClassCfg, type Hold } from '../anim/holds';
import {
  BeatPlayer,
  VariantPicker,
  fumbleChance,
  planSequence,
  type Anchor,
  type BeatEventName,
  type BeatKick,
  type BeatSink,
  type FumbleMode,
  type HandKey,
  type HandSegment,
  type PlannedBeat,
  type PoseSegment,
  type V3,
} from '../anim/beats';
import {
  CAM_FIX_NAMES,
  CHECK_NAMES,
  LIBRARIES,
  checkAbortTail,
  dumpUpgradeTail,
  reloadNames,
  type WeaponClass,
} from '../anim/data/sequences';
import { HAND_POSES, blendPose, POSE_SIZE } from '../anim/handPoses';
import { ease } from '../anim/tracks';
import type { ArmRig } from '../body/ArmRig';
import { BodyRig } from '../body/BodyRig';
import { DroppedMags } from '../body/DroppedMags';
import { applyBuild, PRESETS } from './attachments';
import { BASE_WEAPONS, WEAPONS, type FireMode, type WeaponDef } from './defs';
import { Magazines } from './Magazines';
import { buildModel, type SightLine, type WeaponModel } from './models';
import { rigParams } from '../anim/handling/params';
import { armSwivel } from '../anim/grip/arm';
import { WRIST } from '../anim/grip/hand';
import { GripOverlay } from '../anim/grip/GripOverlay';
import {
  anchorBasis,
  basisQuat,
  BASES,
  resolveHandContact,
  weaponAnchor,
  weaponRig,
  type WeaponRig,
} from '../anim/grip/anchors';
import { recoilFor, type RecoilFeel, type RecoilProfile } from '../anim/handling/recoil';
import { FOV_SPRING } from '../anim/handling/characterise';
import { WeaponRigidBody, gainsFor } from '../anim/handling/sim';
import { ArmsRig } from '../anim/rig/ArmsRig';
import { weaponAnims } from '../anim/library/library';
import { ContactOverlay } from '../anim/contact/ContactOverlay';
import { HandContact } from '../anim/contact/HandContact';
import { solveTwoBone } from '../anim/ik';

const _aq = new Quaternion();
const _aq2 = new Quaternion();
const _ao = new Vector3();
const _aa = new Vector3();
const _ab = new Vector3();
/** Rotate `bone` (world) so its child at `childNow` swings to `childGoal`. */
function aimBone(bone: Object3D, childNow: Vector3, childGoal: Vector3) {
  bone.getWorldPosition(_ao);
  _aa.subVectors(childNow, _ao).normalize();
  _ab.subVectors(childGoal, _ao).normalize();
  _aq.setFromUnitVectors(_aa, _ab).multiply(bone.getWorldQuaternion(_aq2));
  bone.parent!.getWorldQuaternion(_aq2).invert();
  bone.quaternion.copy(_aq2.multiply(_aq));
}

/** Kept for HUD/tests: what the hands are busy with. */
export type ReloadState = { kind: 'idle' | 'reload' | 'check' | 'camFix' | 'switch' };

/** Settings → Advanced → Weapon handling (PRD §6.3.8). */
export const handlingSettings = settings.ns('gameplay.handling', {
  /** "Weapon inertia" master: 0 = arcade-locked gun, 1 = default, 1.5 = heavy. */
  weaponInertia: 1,
  /** Recoil strength multiplier on every feel channel (kick, climb, camera, view). */
  recoil: 1,
  /** Realism preset gate for reload fumbles (§6.7). */
  fumbles: 'rare' as FumbleMode,
});

interface Part {
  obj: Object3D;
  rest: Vector3;
}

interface Equipped {
  def: WeaponDef;
  cls: WeaponClass;
  cfg: ClassCfg;
  mags: Magazines;
  model: WeaponModel;
  mode: FireMode;
  /** Socket positions in the weapon frame. */
  sockets: Record<string, Vector3>;
  mag: Part | null;
  bolt: Part | null;
  slide: Part | null;
  charging: Part | null;
  /** Mag rest rotation (weapon frame). */
  magRestQ: Quaternion;
  boltLocked: boolean;
  /** Grip surfaces + solved hand placements (anim/grip). */
  grip: WeaponRig;
  /** Rigid-body handling sim for this build. */
  body: WeaponRigidBody;
  recoilProfile: RecoilProfile;
  /** Feel gains on top of the physical recoil (anim/handling/recoil.ts). */
  feel: RecoilFeel;
  /** Muzzle tip in the weapon frame (bullets leave the barrel, not the screen centre). */
  muzzleLocal: Vector3;
  /** Rear-of-sight point per aim mode, weapon frame. */
  sightLocal: Vector3[];
  /** Recoil instability → how soon grip readjusts happen. */
  adjustAfter: number;
  /** ArmsRig: inverse of this weapon's idle gun frame in rig space (root = handling pose × this). */
  rigRefInv: Matrix4 | null;
}

const DEFAULT_LEFT: HandKey = { t: 1, at: 'handguard', pose: 'support' };
const DEFAULT_RIGHT: HandKey = { t: 1, at: 'grip', pose: 'grip' };
const ZERO3: V3 = [0, 0, 0];
const X_AXIS = new Vector3(1, 0, 0);
const CAM_GRIP = new Vector3(-0.07, 0.015, 0.012);
/** Minimum arm centre-line distance from the chest-cam lens the elbow swivel aims for (m). */
const ARM_CLEAR = 0.2;
/** Rig camera fix: wrist target relative to the chest-cam mount (torso frame): just left of and below the lens. */
const CAM_REACH = new Vector3(-0.05, -0.06, -0.09);
/** Pistol mag check (rig): support wrist under and behind the dropped mag's base (weapon frame). */
const MAG_CUP = new Vector3(-0.015, -0.16, 0.07);

// Scratch (no per-frame allocation).
const _v = new Vector3();
const _v2 = new Vector3();
const _v3 = new Vector3();
const _q = new Quaternion();
const _q2 = new Quaternion();
const _e = new Euler(0, 0, 0, 'YXZ');
const _m = new Matrix4();
const _m2 = new Matrix4();
const _one = new Vector3(1, 1, 1);
const _fwd = new Vector3();
const _camDir = new Vector3();
const _posA = new Vector3();
const _posB = new Vector3();
const _qA = new Quaternion();
const _qB = new Quaternion();
const _poseA = new Float32Array(POSE_SIZE);
const _poseB = new Float32Array(POSE_SIZE);
const _poseC = new Float32Array(POSE_SIZE);
const _hw = new Matrix4();
const _invView = new Matrix4();
const CONTACT_ANCHORS = new Set<Anchor>(['well', 'charging', 'boltCatch', 'slide']);
const _seg: HandSegment = { a: DEFAULT_LEFT, b: DEFAULT_LEFT, u: 1, mid: 0 };
const _pseg: PoseSegment = { a: null, b: null, u: 1 };

/**
 * Owns the held weapon and the hands: pose (view leads, weapon follows), firing, recoil, procedural reload
 * beat graphs, mag checks, weapon switches, grip readjusts and the camera-fix reach. Drives the BodyRig IK.
 */
export class WeaponController implements System {
  readonly view = new Group();
  readonly body = new BodyRig();
  readonly drops: DroppedMags;
  equipped: Equipped;
  loadout: Equipped[];
  reload: ReloadState = { kind: 'idle' };
  gesture = new ReloadGesture();
  /** 0..1.5 master on weapon lag/inertia (settings "Weapon inertia"). */
  inertia = 1;
  fumbleMode: FumbleMode = 'rare';
  /** Shown by the HUD while true. */
  checking = false;
  readonly beats = new BeatPlayer();
  /** Beat libraries (exposed for the dev tools / live tuning). */
  readonly libraries = LIBRARIES;
  /** What the current plan is for. */
  planKind: 'reload' | 'check' | 'camFix' | 'micro' | null = null;
  /** 0..1 hand fatigue from sustained fire. */
  fatigue = 0;
  private reloadVariant: 'tactical' | 'speed' = 'tactical';
  private rifle: Equipped | undefined;
  private pistol: Equipped | undefined;
  private picker = new VariantPicker();
  private swapped = false;
  private drawPending = false;
  private magHeld = false;
  private magVisible = true;
  /**
   * Weapon switch state machine (rig-agnostic: today the procedural sling/holster pose, later ArmsRig
   * `swapOut` / `swapIn` clips with the `swapMid` event): out → swapMid (the visible weapon changes) → in.
   * `w` is the away blend (0 = in hand, 1 = slung/holstered). Firing is allowed once `in` is ~80% done; firing
   * during `in` hurries it; pressing switch mid-swap reverses it.
   */
  private switching: { phase: 'out' | 'in'; w: number; to: number; from: number; hurry: boolean } | null =
    null;
  private switchW = 0;
  private cooldown = 0;
  private triggerHeld = false;
  private triggerW = 0;
  private ads = 0;
  private wLow = 0;
  private wComp = 0;
  private wSprint = 0;
  private tuck = 0;
  private shotsInString = 0;
  private lastString = 0;
  private sinceShot = 10;
  private idleTime = 0;
  private cycle = 0;
  private rand = rng(1337);
  private readonly aimTarget = new Vector3();
  private readonly drift = new Vector3();
  private readonly driftTarget = new Vector3();
  private readonly hold = new Vector3();
  private readonly holdR = new Vector3();
  private readonly shoulderW = new Vector3();

  constructor(
    private ctx: Context,
    private player: Player,
    ids = ['sb16', 'p17'],
  ) {
    this.loadout = ids.map((id) => this.make(WEAPONS[id]));
    this.equipped = this.loadout[0];
    this.rifle = this.loadout.find((x) => x.cls === 'rifle');
    this.pistol = this.loadout.find((x) => x.cls === 'pistol');
    this.mount(this.equipped);
    ctx.scene.add(this.view, ...this.body.objects);
    // Authored arms rig (src/anim/rig); the procedural arms + beat graph stay as the fallback until it loads
    // (and with `?procarms`).
    if (typeof location !== 'undefined' && !location.search.includes('procarms')) {
      // Keep the viewmodel hidden while the rig loads (no flash of the procedural arms); fall back on failure.
      this.rigPending = true;
      this.setProceduralVisible(false);
      ArmsRig.load()
        .then((rig) => this.useRig(rig))
        .catch((err) => {
          console.warn('ArmsRig unavailable, procedural arms', err);
          this.rigPending = false;
          this.setProceduralVisible(true);
        });
    }
    this.drops = new DroppedMags(ctx);
    this.scope = new ScopeOverlay(ctx.scene);
    if (GripOverlay.enabled()) this.gripOverlay = new GripOverlay(ctx.scene);
    const apply = (s: ReturnType<typeof handlingSettings.get>) => {
      this.inertia = clamp(s.weaponInertia, 0, 1.5);
      this.fumbleMode = s.fumbles;
    };
    apply(handlingSettings.get());
    handlingSettings.onChange(apply);
    // Flashbang / blast flinch: the support arm comes up to shield the face, the weapon dips.
    ctx.bus.on('flinch', (ev) => {
      this.flinchTarget = Math.max(this.flinchTarget, clamp(ev.strength, 0, 1));
      this.flinchHold = 0.12 + 0.25 * ev.strength;
      this.player.kick(-0.25 * ev.strength, (this.rand() - 0.5) * 0.2, (this.rand() - 0.5) * 0.3, 0.04);
    });
  }

  private make(def: WeaponDef): Equipped {
    const cls: WeaponClass = def.slot === 'sidearm' ? 'pistol' : 'rifle';
    const cfg = CFG[cls];
    const model = buildModel(def.model, { detailParts: true });
    const root = model.root;
    root.updateMatrixWorld(true);
    const inv = new Matrix4().copy(root.matrixWorld).invert();
    // Sockets, mag frame, grip surfaces and the solved hand placements (anim/grip).
    const rig = weaponRig(model, cfg);
    const sockets = rig.sockets;
    const part = (name: string): Part | null => {
      const obj = (model.parts as Record<string, Object3D | undefined>)[name] ?? root.getObjectByName(name);
      return obj ? { obj, rest: obj.position.clone() } : null;
    };
    const mag = part('mag');
    const rec = recoilFor(def);
    const instability = clamp((def.recoil.up * 0.6 + def.recoil.side * 0.4) / (def.mass * 0.6), 0, 2);
    // Sight lines at rest in the weapon frame (immune to slide travel on pistols).
    const sightLocal = model.sightLines.map((l) =>
      new Vector3().setFromMatrixPosition(l.node.matrixWorld).applyMatrix4(inv),
    );
    const muzzle = model.sockets.muzzle;
    const muzzleLocal = muzzle
      ? new Vector3().setFromMatrixPosition(muzzle.matrixWorld).applyMatrix4(inv)
      : new Vector3(0, model.boreY ?? 0.03, model.muzzleZ);
    return {
      def,
      cls,
      cfg,
      mags: new Magazines(def.magCapacity, def.spareMags),
      model,
      mode: def.modes[0],
      sockets,
      mag,
      bolt: part('bolt'),
      slide: part('slide'),
      charging: part('chargingHandle'),
      magRestQ: rig.magRestQ,
      boltLocked: false,
      muzzleLocal,
      sightLocal,
      grip: rig,
      body: new WeaponRigidBody(rigParams(def)),
      recoilProfile: rec.profile,
      feel: rec.feel,
      adjustAfter: Math.max(1, Math.round(5 - instability * 2)),
      rigRefInv: null,
    };
  }

  private get busy(): boolean {
    if (this.rig) return this.planKind === 'reload' || this.planKind === 'check';
    return this.beats.active && this.planKind !== 'micro';
  }

  // ---------------------------------------------------------------- authored arms rig

  /** The authored arms rig once loaded (null = procedural fallback). */
  rig: ArmsRig | null = null;

  /** Rig reload past the point the gun can fire again (mag seated + chambered). */
  private reloadLive = false;

  /** True while ArmsRig.load() is in flight (viewmodel hidden). */
  rigPending = false;

  private setProceduralVisible(v: boolean) {
    this.body.left.mesh.visible = this.body.right.mesh.visible = v;
    this.view.visible = v;
  }

  /** Hard hand–weapon contact on the rig (src/anim/contact); `?contact` draws its proxies. */
  contact: HandContact | null = null;
  private contactOverlay: ContactOverlay | null = null;

  private useRig(rig: ArmsRig) {
    this.rig = rig;
    // Per weapon: on for pistols (safe mode + the tuned two-hand hold), off for rifles/SMGs until their
    // grips/handguards match the clips' hand envelope (README). `?handcontact=off|safe|full` overrides;
    // `?contact` draws the proxies.
    this.contact = new HandContact(rig);
    const hc = HandContact.urlMode();
    if (hc && hc !== 'off') this.contact.mode = hc;
    this.contact.autoEnable = (id) => (hc ? hc !== 'off' : weaponAnims(id).family === 'pistol');
    if (ContactOverlay.enabled()) this.contactOverlay = new ContactOverlay(this.ctx.scene);
    this.rigPending = false;
    this.view.visible = true;
    this.stopPlan();
    this.switching = null;
    this.ctx.scene.add(rig.root);
    this.body.left.mesh.visible = this.body.right.mesh.visible = false;
    for (const m of rig.meshes) m.frustumCulled = false;
    this.view.remove(this.equipped.model.root);
    this.mount(this.equipped);
  }

  /** Put a weapon in the hands: under the rig (measuring its idle gun frame once) or on the procedural view. */
  private mount(e: Equipped) {
    const rig = this.rig;
    if (!rig) {
      this.view.add(e.model.root);
      return;
    }
    rig.attachWeapon(e.model, e.def.id);
    this.measureRigRef(e);
  }

  private unmount(e: Equipped) {
    if (this.rig) {
      if (this.rig.weaponModel === e.model) this.rig.detachWeapon();
    } else this.view.remove(e.model.root);
  }

  /** Idle gun frame in rig space → the rig root follows the handling sim so the idle gun sits on our hold. */
  private measureRigRef(e: Equipped) {
    const rig = this.rig!;
    if (e.rigRefInv) return;
    const keepP = rig.root.position.clone();
    const keepQ = rig.root.quaternion.clone();
    rig.root.position.set(0, 0, 0);
    rig.root.quaternion.identity();
    rig.root.updateMatrixWorld(true);
    // Mid-swap (swapMid) this runs between the swap-out and the draw: measure at idle without disturbing them.
    rig.atIdle(() => {
      e.model.root.updateMatrixWorld(true);
      e.rigRefInv = new Matrix4().copy(e.model.root.matrixWorld).invert();
    });
    rig.root.position.copy(keepP);
    rig.root.quaternion.copy(keepQ);
    rig.root.updateMatrixWorld(true);
  }

  /** World matrix of the drawn weapon frame (grip origin, -z muzzle): the rig's gun, else the handling view. */
  private get gunMatrix(): Matrix4 {
    return this.rig ? this.equipped.model.root.matrixWorld : this.view.matrixWorld;
  }

  private readonly gunQ = new Quaternion();
  private get gunQuat(): Quaternion {
    return this.rig ? this.equipped.model.root.getWorldQuaternion(this.gunQ) : this.view.quaternion;
  }

  /** Rig events → `weaponBeat` (audio / haptics) + inventory + contact jolts. */
  private lastRigBeat = '';
  private lastRigBeatT = -1;
  private onRigEvent = (beat: string) => {
    const e = this.equipped;
    if (beat === 'fire') return;
    // Clip markers can double up on adjacent frames: one foley hit per contact.
    const now = this.ctx.time;
    if (beat === this.lastRigBeat && now - this.lastRigBeatT < 0.08) return;
    this.lastRigBeat = beat;
    this.lastRigBeatT = now;
    if (beat === 'swapMid') return this.onRigSwapMid();
    this.emitBeat(beat, this.player.stress > 0.45);
    const lib = LIBRARIES[e.cls];
    switch (beat) {
      case 'magOut':
        if (this.planKind === 'reload' && !this.swapped) {
          const retain = this.reloadVariant === 'tactical';
          if (!retain && e.mag?.obj.visible) this.spawnDrop();
          e.mags.swap(retain);
          this.swapped = true;
        }
        break;
      case 'magSeat': {
        if (this.planKind === 'reload' && e.mags.chambered) this.reloadLive = true;
        const k = lib.magSeat.calm[0].kick;
        if (k) this.applyKick(k, 1);
        break;
      }
      case 'boltRelease':
      case 'chargingHandle':
      case 'slideRelease': {
        if (this.planKind === 'reload') {
          e.mags.chamber();
          e.boltLocked = false;
          this.reloadLive = true;
        }
        const k = (lib[beat] ?? lib.slideRelease ?? lib.boltRelease)?.calm[0].kick;
        if (k) this.applyKick(k, 1);
        break;
      }
    }
  };

  private onRigSwapMid() {
    const s = this.switching;
    const next = s ? this.loadout[s.to] : undefined;
    if (!s || !next) return;
    if (next !== this.equipped) {
      this.equipped = next;
      this.aimIndex = 0;
      this.simReset = true;
      this.measureRigRef(next);
      this.emitBeat('swapMid', false);
    }
    s.phase = 'in';
    this.emitBeat(next.cls === 'pistol' ? 'draw' : 'unsling', false);
  }

  private readonly rs = {
    sh: new Vector3(),
    el: new Vector3(),
    wr: new Vector3(),
    tg: new Vector3(),
    pole: new Vector3(),
    e2: new Vector3(),
    w2: new Vector3(),
  };

  /** 0..1 pistol mag-check lift (rig). */
  private checkLift = 0;
  /** Rig camera-fix timeline (s) and whether the mount was straightened this time. */
  private camFixT = 0;
  private camFixed = false;
  /** 0..1 eased weight of the rig camera-fix reach (also dips the weapon). */
  private camFixW = 0;

  private updateRigCamFix(dt: number) {
    if (this.planKind !== 'camFix') {
      this.camFixW = 0;
      return;
    }
    const T = (this.camFixT += dt);
    // Reach 0.3 s → hold/adjust 0.4 s (fix at 0.45) → let go 0.3 s.
    this.camFixW = T < 0.3 ? ease('io', T / 0.3) : T < 0.7 ? 1 : 1 - ease('io', (T - 0.7) / 0.3);
    if (T >= 0.28 && T < 0.7) this.setCamHand(true);
    if (T >= 0.45 && !this.camFixed) {
      this.camFixed = true;
      this.emitBeat('camFix', false);
      this.player.fixMount();
    }
    if (T >= 0.7) this.setCamHand(false);
    if (T >= 1) {
      this.planKind = null;
      this.camFixW = 0;
    }
  }

  /**
   * Support-arm IK layer on the rig (after the mixer): flinch shield (hand to the face), throw (up beside the
   * head), camera fix (hand on the mount). A two-bone solve swings upper arm + forearm toward the blended wrist
   * target; the gun is untouched. Gaps: hand orientation follows the forearm.
   */
  private rigArmLayer(rig: ArmsRig) {
    const f = ease('out', this.flinch);
    const t = ease('io', this.throwDip) * 0.85;
    const c = this.camFixW;
    // Pistol mag check: the support hand comes up under the dropped mag (the clip leaves it at the hip).
    const m = this.equipped.cls === 'pistol' ? ease('io', this.checkLift) : 0;
    const k = Math.max(f, t, c, m);
    if (k < 1e-3) return;
    const { armL, foreArmL, handL } = rig.bones;
    const r = this.rs;
    armL.getWorldPosition(r.sh);
    foreArmL.getWorldPosition(r.el);
    handL.getWorldPosition(r.wr);
    const l1 = r.sh.distanceTo(r.el),
      l2 = r.el.distanceTo(r.wr);
    const tw = this.player.torso.matrixWorld;
    if (m >= f && m >= t && m >= c) r.tg.copy(MAG_CUP).applyMatrix4(this.equipped.model.root.matrixWorld);
    else if (c >= f && c >= t) r.tg.copy(this.player.camLocal).add(CAM_REACH).applyMatrix4(tw);
    else if (f >= t) r.tg.set(-0.05, 0.2, -0.26).applyMatrix4(tw);
    else r.tg.set(-0.22, 0.2, -0.1).applyMatrix4(tw);
    r.tg.lerpVectors(r.wr, r.tg, k);
    r.pole.set(-0.6, -0.8, 0.1).transformDirection(tw).add(r.sh);
    solveTwoBone(r.sh, r.tg, r.pole, l1, l2, r.e2, r.w2);
    aimBone(armL, r.el, r.e2);
    armL.updateMatrixWorld(true);
    handL.getWorldPosition(r.wr);
    aimBone(foreArmL, r.wr, r.w2);
    foreArmL.updateMatrixWorld(true);
  }

  /** Root = handling pose × inverse idle gun frame; then the rig samples, places the gun and IKs the hands. */
  private updateRig(dt: number) {
    const rig = this.rig!;
    const e = this.equipped;
    if (rig.weaponModel !== e.model && !this.switching) this.mount(e);
    if (e.rigRefInv) {
      _m.copy(this.view.matrixWorld).multiply(e.rigRefInv);
      _m.decompose(rig.root.position, rig.root.quaternion, _v);
    }
    rig.root.updateMatrixWorld(true);
    // Mag seated (and chambered): the gun works, so trigger or aim cuts the clip's return-to-ready tail short
    // (it held the gun ~0.65 s past the seat, unable to fire or aim).
    if (this.planKind === 'reload' && this.reloadLive) {
      const f = this.ctx.input.frame;
      if (f.down.has('fire') || this.player.aiming) rig.play('idle', { fade: ArmsRig.CANCEL_XFADE });
    }
    rig.update(dt);
    this.updateRigCamFix(dt);
    this.rigArmLayer(rig);
    // Hands may not sink into the weapon: after every arm layer, before rendering.
    if (this.contact) {
      this.contact.apply(dt);
      this.contactOverlay?.update(this.contact);
    }
    // Empty reloads: the rig's falling clone of the old mag is replaced by our physical floor mag.
    const spare = e.model.root.getObjectByName('spareMag');
    if (spare && this.planKind === 'reload') spare.visible = false;
    // Plans finish when the rig goes back to idle.
    if ((this.planKind === 'reload' || this.planKind === 'check') && !rig.busy) {
      if (this.planKind === 'reload') {
        if (!this.swapped) e.mags.swap(this.reloadVariant === 'tactical');
        if (!e.mags.chambered) e.mags.chamber();
        e.boltLocked = false;
      }
      this.planKind = null;
      this.checking = false;
    }
    if (this.switching && this.switching.phase === 'in' && rig.action !== 'swapIn') this.switching = null;
  }

  /** Start a sling/holster → draw switch (or reverse one in progress). */
  equip(i: number) {
    if (this.rig) return this.equipRig(i);
    const s = this.switching;
    if (s) {
      // Switch pressed again mid-swap: reverse.
      if (s.phase === 'out') {
        s.phase = 'in';
        s.to = s.from;
        this.emitBeat(this.equipped.cls === 'pistol' ? 'draw' : 'unsling', false);
      } else {
        const back = s.from;
        s.from = this.loadout.indexOf(this.equipped);
        s.to = back;
        s.phase = 'out';
        this.emitBeat(this.equipped.cls === 'pistol' ? 'holster' : 'sling', false);
      }
      s.hurry = false;
      return;
    }
    const next = this.loadout[i];
    // A switch interrupts anything but a reload (mag check, cam fix, grip readjust).
    if (!next || next === this.equipped || this.planKind === 'reload') return;
    this.stopPlan();
    this.switching = { phase: 'out', w: 0, to: i, from: this.loadout.indexOf(this.equipped), hurry: false };
    this.emitBeat(this.equipped.cls === 'pistol' ? 'holster' : 'sling', false);
  }

  /** Rig switch: swapOut → swapMid → swapIn; switching again mid-swap retargets (reverses). */
  private equipRig(i: number) {
    const rig = this.rig!;
    const s = this.switching;
    if (s) {
      const back = s.phase === 'out' ? this.loadout.indexOf(this.equipped) : s.from;
      s.from = this.loadout.indexOf(this.equipped);
      s.to = back;
      s.phase = 'out';
      const t = this.loadout[back];
      rig.swapTo(t.model, t.def.id, { onEvent: this.onRigEvent });
      return;
    }
    const next = this.loadout[i];
    if (!next || next === this.equipped || this.planKind === 'reload') return;
    if (this.planKind === 'check') this.planKind = null;
    this.checking = false;
    this.switching = { phase: 'out', w: 0, to: i, from: this.loadout.indexOf(this.equipped), hurry: false };
    this.emitBeat(this.equipped.cls === 'pistol' ? 'holster' : 'sling', false);
    rig.swapTo(next.model, next.def.id, { onEvent: this.onRigEvent });
  }

  /** Can the trigger break during a switch? Not on the way out; once the draw is ~80% done. */
  private get switchAllowsFire(): boolean {
    const s = this.switching;
    if (!s) return true;
    if (this.rig)
      return s.phase === 'in' && (this.rig.progress >= 0.8 || (s.hurry && this.rig.progress >= 0.45));
    return s.phase === 'in' && s.w <= 0.2;
  }

  /** Swap a loadout slot for a build preset (e.g. 'sb16_lpvo'); equips it if that slot is in hand. */
  setPreset(slot: number, presetId: string) {
    const build = PRESETS[presetId];
    if (!build) return;
    const next = this.make(applyBuild(BASE_WEAPONS[build.weapon], build));
    const wasEquipped = this.loadout[slot] === this.equipped;
    this.loadout[slot] = next;
    this.rifle = this.loadout.find((x) => x.cls === 'rifle');
    this.pistol = this.loadout.find((x) => x.cls === 'pistol');
    if (wasEquipped) {
      this.unmount(this.equipped);
      this.equipped = next;
      this.mount(next);
      this.aimIndex = 0;
      this.stopPlan();
    }
  }

  /**
   * Replace the whole loadout with custom defs (from `applyBuild`, e.g. `src/loadout` → `loadoutDefs`), primary
   * first; equips the first one immediately with fresh mags.
   */
  setLoadout(defs: WeaponDef[]) {
    if (!defs.length) return;
    this.stopPlan();
    this.switching = null;
    this.unmount(this.equipped);
    for (const w of this.loadout) w.model.dispose();
    this.loadout = defs.map((d) => this.make(d));
    this.rifle = this.loadout.find((x) => x.cls === 'rifle');
    this.pistol = this.loadout.find((x) => x.cls === 'pistol');
    this.equipped = this.loadout[0];
    this.mount(this.equipped);
    this.aimIndex = 0;
    this.simReset = true;
  }

  /** Fresh mags for a new drill: cancels any hand plan so nothing is mid-swap. */
  resupply() {
    this.stopPlan();
    for (const w of this.loadout) {
      w.mags = new Magazines(w.def.magCapacity, w.def.spareMags);
      w.boltLocked = false;
    }
  }

  /** Immediate equip without animation (tests/tools). */
  equipNow(i: number) {
    const next = this.loadout[i];
    if (!next || next === this.equipped) return;
    this.unmount(this.equipped);
    this.equipped = next;
    this.mount(next);
    this.aimIndex = 0;
    this.simReset = true;
    this.stopPlan();
  }

  fixedUpdate() {
    this.drops.fixedUpdate();
  }

  update(dt: number) {
    const f = this.ctx.input.frame;
    const p = this.player;
    const e = this.equipped;
    const d = e.def;

    // Reload button gestures (tap/double/hold — latency-free branching lives in ReloadGesture).
    for (const intent of this.gesture.update(f.down.has('reload'), dt)) this.onReloadIntent(intent);
    if (f.pressed.has('switchWeapon')) this.equip(this.loadout.indexOf(e) === 0 ? 1 : 0);
    // Fire during the draw hurries it (the shooter punches the gun out).
    if (f.down.has('fire') && this.switching?.phase === 'in') this.switching.hurry = true;
    if (f.pressed.has('fireMode')) e.mode = d.modes[(d.modes.indexOf(e.mode) + 1) % d.modes.length];
    this.maybeFixCam(f.pressed.has('fixCam'), dt);

    // Pose blends.
    const busy = this.busy || !!this.switching;
    const hd = d.handling ? d.handling.adsTime / 3.3 : 0.06 + d.mass * 0.012;
    // Linear ramp over the build's ADS time; everything reads the eased `adsBlend`.
    const adsTime = d.handling?.adsTime ?? 0.25 + d.mass * 0.04;
    const adsWant = p.aiming && !busy ? 1 : 0;
    if (adsWant !== this.adsWantPrev) {
      this.adsWantPrev = adsWant;
      this.ctx.bus.emit('ads', { on: adsWant === 1 });
    }
    this.ads = clamp(this.ads + Math.sign(adsWant - this.ads) * (dt / Math.max(0.08, adsTime)), 0, 1);
    if (Math.abs(adsWant - this.ads) < 1e-3) this.ads = adsWant;
    void hd;
    if (f.pressed.has('aimMode')) this.cycleAimMode();
    if (f.pressed.has('magnifier')) this.toggleMagnifier();
    this.wSprint += ((p.sprinting && !this.beats.active ? 1 : 0) - this.wSprint) * damp(0.1, dt);
    this.wLow += ((p.ready === 'low' ? 1 : 0) - this.wLow) * damp(0.09, dt);
    this.wComp += ((p.ready === 'compressed' ? 1 : 0) - this.wComp) * damp(0.08, dt);
    this.updateSwitch(dt);
    this.updateFlinch(dt);

    // Aim point: where the camera centre ray lands (weapon converges on it). Raycast 1/2.
    const cam = this.ctx.camera;
    _camDir.set(0, 0, -1).applyQuaternion(cam.quaternion);
    const hit = this.ctx.physics.raycast(cam.position, _camDir, 60, p.rigidBody);
    this.aimTarget.copy(cam.position).addScaledVector(_camDir, hit ? Math.max(hit.distance, 2) : 25);

    // Hold position (torso-local) from the blended ready / ADS / beat / switch poses.
    this.composeHold(dt);

    // Muzzle tuck: probe from the shoulder along the barrel. Raycast 2/2.
    this.shoulderW.set(0.12 - this.ads * 0.1, 0.06, -0.08).applyMatrix4(p.torso.matrixWorld);
    _fwd.set(0, 0, -1).applyQuaternion(this.view.quaternion);
    const probe = this.ctx.physics.raycast(this.shoulderW, _fwd, d.length + 0.25, p.rigidBody);
    const tuckTarget = probe ? clamp(1 - (probe.distance - 0.15) / (d.length + 0.1), 0, 1) : 0;
    this.tuck += (tuckTarget - this.tuck) * damp(0.05, dt);

    // World hold point → aim direction toward the aim target, through the lag springs.
    _v.copy(this.hold).applyMatrix4(p.torso.matrixWorld);
    // At ADS the sight line (not the grip) is what converges on the aim point.
    if (this.adsBlend > 0) _v.lerp(this.eyeWorld, this.adsBlend);
    _v2.copy(this.aimTarget).sub(_v);
    const wantYaw = Math.atan2(-_v2.x, -_v2.z);
    const wantPitch = Math.atan2(_v2.y, Math.hypot(_v2.x, _v2.z));

    // Breathing + stress hand tremor + fatigue go into the hand targets; lower crouched and in ADS.
    const t = this.ctx.time;
    const steady = (1 - this.ads * 0.5) * (1 - p.crouch * 0.25) * (d.handling?.swayMul ?? 1);
    const shake = (0.0015 + p.stress * 0.006 + this.fatigue * 0.005) * steady;
    const breathY = Math.sin(t * 1.5 * (1 + p.stress * 0.5)) * 0.004 * (1 - this.ads * 0.7);
    const nX = noise1(t * 6.1, 1) * shake;
    const nY = noise1(t * 5.3, 2) * shake;
    this.fatigue = clamp(this.fatigue - dt * 0.12, 0, 1);
    this.sinceShot += dt;
    this.idleTime += dt;
    if (this.sinceShot > 0.35 && this.shotsInString > 0) this.endString();

    // Aim climb recovers (faster once the string ends: the shooter drives the gun back down).
    const ch = e.feel.climbHalfLife * (this.sinceShot < 0.12 ? 2.5 : 1);
    this.climbPitch -= this.climbPitch * damp(ch, dt);
    this.climbYaw -= this.climbYaw * damp(ch, dt);
    this.fovPunch.step(0, dt);
    this.simulate(dt, wantYaw + nX + this.climbYaw, wantPitch + nY + breathY + this.climbPitch);
    this.updatePlan(dt);
    if (this.rig) {
      this.updateRig(dt);
      this.body.update(p);
    } else {
      this.updateParts(dt);
      this.updateHands(dt);
    }
    this.updateAdsCamera();
    this.updateFire(dt, f.down.has('fire'));
    this.drops.update();
  }

  private mixHold(k: number, o: Hold) {
    if (k <= 1e-4) return;
    this.hold.lerp(_v3.fromArray(o.p), k);
    this.holdR.lerp(_v3.fromArray(o.r), k);
  }

  private composeHold(dt: number) {
    const e = this.equipped;
    const H = e.cfg.holds;
    const p = this.player;
    const h = this.hold.fromArray(H.high.p);
    const r = this.holdR.fromArray(H.high.r);
    this.mixHold(this.wComp, H.compressed);
    this.mixHold(this.wLow, H.low);
    this.mixHold(this.wSprint, H.sprint);
    this.mixHold(this.adsBlend, H.ads);
    // Stock indexed to the shoulder pocket: longer length of pull → the gun sits further out.
    h.z += e.grip.holdDz;
    // Crouched: slightly lower and tighter; drifting hold (never exactly the same place).
    h.y -= p.crouch * 0.015;
    h.z += p.crouch * 0.02;
    // Gait: most of the walk shows on the weapon (the chest cam is quiet) — a vertical double bounce per
    // stride, a lateral sway per step, a slight nod/yaw/cant. Damped in ADS; the handling sim smooths it.
    const g = p.gaitAmount * (1 - this.ads * 0.75);
    if (g > 1e-3) {
      const ph = p.gaitPhase;
      const amp = (0.003 + Math.min(p.speed, 5.5) * 0.0032) * g;
      h.y -= (1 - Math.abs(Math.sin(ph))) * amp;
      h.x += Math.sin(ph) * amp * 0.55;
      r.x += Math.cos(2 * ph) * 0.007 * g;
      r.y += Math.sin(ph) * 0.009 * g;
      r.z += Math.sin(ph) * 0.012 * g;
    }
    this.drift.lerp(this.driftTarget, damp(0.6, dt));
    h.addScaledVector(this.drift, 1 - this.ads * 0.6);
    // Beat pose offsets.
    if (this.beats.active) {
      const s = this.beats.poseSegment(_pseg);
      const a = s.a,
        b = s.b;
      const ap = a?.p ?? ZERO3,
        bp = b?.p ?? ZERO3,
        ar = a?.r ?? ZERO3,
        br = b?.r ?? ZERO3;
      for (let i = 0; i < 3; i++) {
        h.setComponent(i, h.getComponent(i) + ap[i] + (bp[i] - ap[i]) * s.u);
        r.setComponent(i, r.getComponent(i) + ar[i] + (br[i] - ar[i]) * s.u);
      }
    }
    // Switch: sling / holster.
    if (this.switchW > 0) {
      const w = ease('io', this.switchW);
      h.lerp(_v3.fromArray(e.cfg.away.p), w);
      r.lerp(_v3.fromArray(e.cfg.away.r), w);
    }
    // Pistol mag check on the rig: lift and tip the gun so the support hand working the mag is in frame.
    const checkWant = this.rig && this.planKind === 'check' && e.cls === 'pistol' ? 1 : 0;
    this.checkLift += (checkWant - this.checkLift) * damp(0.08, dt);
    if (this.checkLift > 1e-3) {
      const w = ease('io', this.checkLift);
      h.y += 0.04 * w;
      h.z += 0.02 * w;
      r.x += 0.2 * w;
    }
    // Throw dip / flinch: the gun drops and cants away while the support hand is busy.
    const dip = Math.max(ease('io', this.throwDip), ease('out', this.flinch), this.camFixW * 0.35);
    if (dip > 1e-3) {
      h.y -= 0.09 * dip;
      h.x += 0.03 * dip;
      h.z += 0.05 * dip;
      r.x -= 0.55 * dip;
      r.z -= 0.35 * dip;
    }
    // Muzzle tuck: retract and cant up; recoil drives the stock back.
    const len = e.def.length;
    h.z += this.tuck * 0.16 * len;
    h.y += this.tuck * 0.03;
    r.x += this.tuck * 0.45;
    // Looking well down the arms don't follow the eyes all the way: the gun rides up in the frame,
    // uncovering the boots.
    // Offset dot: cant the weapon so the 45° sight comes on top.
    const sl = this.sightLine;
    if (sl) r.z -= sl.mode.roll * this.adsBlend;
    const lift = Math.max(0, -p.pitch - 0.7) * 0.6;
    if (lift > 0) h.sub(CHEST_MOUNT).applyAxisAngle(X_AXIS, -lift).add(CHEST_MOUNT);
  }

  /**
   * Weapon pose from the rigid-body handling sim: the hands/shoulder chase the hold pose (torso aim toward
   * the aim point + ready/beat offsets + tremor); lag, overshoot and recoil come out of the integration.
   */
  private simulate(dt: number, yaw: number, pitch: number) {
    const p = this.player;
    const e = this.equipped;
    const b = e.body;
    const r = this.holdR;
    _e.set(pitch, yaw, -p.lean * p.tuning.leanAngle * 0.85);
    _q.setFromEuler(_e);
    _e.set(r.x, r.y, r.z);
    _q.multiply(_q2.setFromEuler(_e));
    _v.copy(this.hold).applyMatrix4(p.torso.matrixWorld);
    const jump = b.targetPos.distanceToSquared(_v) > 0.25;
    b.targetPos.copy(_v);
    b.targetQ.copy(_q);
    gainsFor({ ads: this.adsBlend, fatigue: this.fatigue, inertia: this.inertia, crouch: p.crouch }, b.gains);
    const rec = e.def.handling?.recoveryMul ?? 1;
    b.gains.kHand *= rec;
    b.gains.kWrist *= rec;
    b.locked = this.inertia < 0.05;
    if (jump || this.simReset) b.reset();
    this.simReset = false;
    b.step(dt);
    b.origin(this.view.position);
    this.view.quaternion.copy(b.q);
    this.view.updateMatrixWorld(true);
  }

  /** Snap the handling sim to its target on the next frame (equip, teleport). */
  private simReset = true;

  /** Selected aim mode per weapon (index into `model.sightLines`). */
  aimIndex = 0;
  /** Zero distance (m): the bore converges on the sight line here. */
  static ZERO = 25;
  /** Sight eye point (world), refreshed every frame. */
  readonly eyeWorld = new Vector3();
  private baseFov = 0;
  private baseNear = 0;
  private lastNear = 0;
  private scope!: ScopeOverlay;
  /** `?grip` debug overlay (finger samples coloured by SDF). */
  gripOverlay: GripOverlay | null = null;
  private lastFov = 0;

  /** 0..1 eased ADS blend (camera chest → sight line). Read by HUD / post. */
  get adsBlend(): number {
    return ease('io', this.ads);
  }

  get sightLine(): SightLine | undefined {
    const lines = this.equipped.model.sightLines;
    return lines[Math.min(this.aimIndex, lines.length - 1)];
  }

  private cycleAimMode() {
    const n = this.equipped.model.sightLines.length;
    if (n > 1) this.aimIndex = (this.aimIndex + 1) % n;
  }

  private toggleMagnifier() {
    const lines = this.equipped.model.sightLines;
    const cur = this.sightLine;
    const mag = lines.findIndex((l) => l.mode.id === 'magnified');
    if (mag < 0) return;
    this.aimIndex =
      cur?.mode.id === 'magnified'
        ? Math.max(
            0,
            lines.findIndex((l) => l.mode.id === 'primary'),
          )
        : mag;
  }

  /** Eye distance behind the sight's rear: 6–9 cm on long guns, arm-ish length on pistols. */
  private eyeDistance(sl: SightLine): number {
    return this.equipped.cls === 'pistol' ? 0.42 : clamp(sl.mode.eyeRelief || 0.075, 0.06, 0.09);
  }

  /** Sight node world position/eye and the camera blend toward it (PRD §6.3.5, ref frame_06). */
  private updateAdsCamera() {
    const sl = this.sightLine;
    const cam = this.ctx.camera;
    if (!this.baseFov || Math.abs(cam.fov - this.lastFov) > 1e-3) this.baseFov = cam.fov;
    if (!this.baseNear || Math.abs(cam.near - this.lastNear) > 1e-5) this.baseNear = cam.near;
    const k = this.adsBlend;
    let fov = this.baseFov;
    const punch = this.fovPunch.value;
    let near = this.baseNear;
    let tube = 0;
    if (sl) {
      const i = Math.min(this.aimIndex, this.equipped.sightLocal.length - 1);
      const eye = this.eyeDistance(sl);
      this.eyeWorld.copy(this.equipped.sightLocal[i]);
      this.eyeWorld.z += eye;
      this.eyeWorld.applyMatrix4(this.gunMatrix);
      if (k > 1e-4) {
        cam.position.lerp(this.eyeWorld, k);
        // The camera rides the weapon (it rolls with an offset-dot cant; recoil moves sight + view together).
        cam.quaternion.slerp(this.gunQuat, k);
        cam.updateMatrixWorld();
        const mag = Math.max(1, sl.mode.magnification[0]);
        const adsFov = clamp((2 * Math.atan(Math.tan((75 * Math.PI) / 360) / mag) * 180) / Math.PI, 18, 75);
        fov = this.baseFov + (Math.min(adsFov, this.baseFov) - this.baseFov) * k;
        // Clip whatever sits between the eye and the sight (folded BUIS, the eyepiece itself); tube optics are
        // solid models, so look past the tube and draw the eyepiece picture instead.
        tube = sl.mode.optic === 'lpvo' ? 0.26 : sl.mode.optic === 'magnifier' ? 0.11 : 0;
        // Through a scope the barrel and support hand ahead of it are out of the picture too.
        const toMuzzle = this.equipped.sightLocal[i].z - this.equipped.muzzleLocal.z + eye + 0.03;
        const clipTo = tube ? Math.max(eye + tube + 0.004, toMuzzle) : Math.min(eye - 0.008, 0.08);
        near = this.baseNear + (Math.max(this.baseNear, clipTo) - this.baseNear) * k;
      }
    }
    fov += punch;
    if (Math.abs(cam.fov - fov) > 1e-3 || Math.abs(cam.near - near) > 1e-5) {
      cam.fov = fov;
      cam.near = near;
      cam.updateProjectionMatrix();
    }
    this.lastFov = cam.fov;
    this.lastNear = cam.near;
    this.scope.update(cam, tube ? k : 0, 0.8, sl?.mode.optic === 'lpvo');
  }

  /**
   * Shot ray: from the muzzle, along the bore — which is zeroed so it crosses the current sight line at
   * `ZERO` m (mechanical offset shows up close). Returns reused vectors.
   */
  shotRay(): { origin: Vector3; dir: Vector3 } {
    const o = this.muzzleWorld();
    const sl = this.sightLine;
    if (!sl) return o;
    _v3.copy(this.equipped.sightLocal[Math.min(this.aimIndex, this.equipped.sightLocal.length - 1)]);
    _v3.applyMatrix4(this.gunMatrix);
    _v2.set(0, 0, -1).applyQuaternion(this.gunQuat);
    _v3.addScaledVector(_v2, WeaponController.ZERO);
    o.dir.copy(_v3).sub(o.origin).normalize();
    return o;
  }

  private readonly muzzleOut = { origin: new Vector3(), dir: new Vector3() };

  /** Muzzle ray in world space. Returns a reused object: copy it if you keep it. */
  muzzleWorld(): { origin: Vector3; dir: Vector3 } {
    const o = this.muzzleOut;
    o.origin.copy(this.equipped.muzzleLocal).applyMatrix4(this.gunMatrix);
    o.dir.set(0, 0, -1).applyQuaternion(this.gunQuat).normalize();
    return o;
  }

  // ---------------------------------------------------------------- firing

  private updateFire(dt: number, down: boolean) {
    this.cooldown -= dt;
    this.cycle = Math.max(0, this.cycle - dt / 0.07);
    const e = this.equipped;
    if (down && this.planKind === 'micro') this.stopPlan();
    // Firing during a mag check aborts it cleanly: fast reinsert + seat, then the gun is back up.
    if (down && !this.triggerHeld && this.planKind === 'check') this.abortCheck();
    const canFire =
      !this.busy &&
      !(this.beats.active && !this.rig) &&
      this.switchAllowsFire &&
      this.flinch < 0.5 &&
      this.throwDip < 0.5 &&
      this.wLow < 0.5 &&
      this.wSprint < 0.3 &&
      this.tuck < 0.6;
    const pressed = down && !this.triggerHeld;
    this.triggerHeld = down;
    if (pressed) this.burstLeft = 3;
    this.triggerW += ((down || this.ads > 0.5 ? 1 : 0) - this.triggerW) * damp(0.04, dt);
    if (!down || !canFire || this.cooldown > 0) return;
    if ((e.mode === 'semi' || e.mode === 'pump') && !pressed) return;
    if (e.mode === 'burst' && this.burstLeft <= 0) return;
    if (!e.mags.fire()) {
      if (pressed) this.ctx.bus.emit('dryFire', { weaponId: e.def.id });
      return;
    }
    this.burstLeft--;
    if (e.mags.empty) e.boltLocked = true;
    this.cooldown = 60 / e.def.rpm;
    this.shoot();
  }

  private burstLeft = 0;
  private adsWantPrev = 0;
  /** FOV punch (deg) and the aim-point climb that stacks over a string (rad, recovers). */
  private readonly fovPunch = new Spring(FOV_SPRING.freq, FOV_SPRING.zeta);
  private climbPitch = 0;
  private climbYaw = 0;

  private shoot() {
    const e = this.equipped;
    const d = e.def;
    const m = this.shotRay();
    this.ctx.bus.emit('shot', {
      weaponId: d.id,
      origin: m.origin.clone(),
      dir: m.dir.clone(),
      suppressed: !!d.suppressed,
      caliber: d.caliber,
    });
    // Fast fire raises stress; long strings build hand fatigue.
    if (this.sinceShot < 0.35) this.player.addStress(0.02);
    this.shotsInString++;
    this.sinceShot = 0;
    this.idleTime = 0;
    this.cycle = 1;
    this.fatigue = clamp(this.fatigue + 0.01 + Math.min(this.shotsInString, 20) * 0.0015, 0, 1);
    // Physical impulse packets (physics/ballistics) × feel gains into the rigid body; the hands and shoulder
    // recover it (§6.3.7). Fatigue and long strings loosen the hold a little.
    const R = Math.max(0, handlingSettings.get().recoil ?? 1);
    const f0 = e.feel;
    const f = {
      ...f0,
      back: f0.back * R,
      lever: f0.lever * R,
      climb: f0.climb * R,
      camPitch: f0.camPitch * R,
      camShove: f0.camShove * R,
      camJitter: f0.camJitter * R,
      view: f0.view * R,
    };
    const fat = 1 + this.fatigue * 0.3;
    const ramp = 1 + Math.min(this.shotsInString, 8) * 0.04;
    const sgn = this.rand() - 0.5;
    e.body.recoil(e.recoilProfile, {
      back: f.back * fat,
      lever: f.lever * ramp * fat * (0.9 + this.rand() * 0.2),
      side: f.side * sgn * 2 * fat,
      roll: f.side * (this.rand() - 0.5) * 1.5,
    });
    // Aim climb: stacks over a string, recovers toward the original point of aim when the string ends.
    this.climbPitch += f.climb * ramp * (0.85 + this.rand() * 0.3);
    this.climbYaw += f.climb * sgn * d.recoil.side * 0.8;
    // The stock shoves the body: chest cam pitches up and moves back through the body spring.
    this.player.kick(
      f.camPitch * (0.9 + this.rand() * 0.2),
      (this.rand() - 0.5) * f.camJitter,
      (this.rand() - 0.5) * f.camJitter * 1.6,
      f.camShove,
    );
    this.fovPunch.impulse(f.fov * (1 - this.adsBlend * 0.5));
    this.rig?.play(e.mags.empty ? 'shootLast' : 'shoot');
    // Muzzle rise that moves the view itself; stacks over a string (ramp), part returns on its own.
    this.player.viewRecoil(
      f.view * ramp * (0.85 + this.rand() * 0.3),
      f.view * sgn * d.recoil.side * 0.9,
      f.viewRecover,
    );
  }

  /** A string of fire ended: maybe readjust the grip (less stable weapons readjust sooner). */
  private endString() {
    const e = this.equipped;
    this.lastString = this.shotsInString;
    this.shotsInString = 0;
    this.newDrift(0.6);
    const need = e.adjustAfter - (this.fatigue > 0.4 ? 1 : 0);
    if (this.lastString >= need && !this.beats.active && !this.switching && !this.rig)
      this.startPlan('micro', ['gripAdjust']);
  }

  // ---------------------------------------------------------------- reloads & plans

  private onReloadIntent(intent: string) {
    if (this.switching) return;
    if (this.rig) return this.onReloadIntentRig(intent);
    if (intent === 'checkStart') {
      if (this.beats.active && this.planKind !== 'micro') return;
      this.startPlan('check', CHECK_NAMES);
      this.beats.holding = true;
      this.checking = true;
    } else if (intent === 'checkEnd') {
      this.beats.holding = false;
      this.checking = false;
    } else if (intent === 'tactical') {
      this.startReload('tactical');
    } else if (intent === 'speedUpgrade') {
      // Second tap inside the window: if the mag hasn't been stowed yet, the hand lets go instead (no latency).
      if (this.planKind === 'reload' && this.reloadVariant === 'tactical') {
        const tail = dumpUpgradeTail(this.beats.tailNames());
        if (tail) {
          this.beats.replaceTail(this.plan(tail, this.player.stress > 0.45));
          this.reloadVariant = 'speed';
        }
      } else if (!this.beats.active || this.planKind === 'micro') this.startReload('speed');
    }
  }

  /** Rig path: tactical → reloadTactical, speed → reloadTactical faster + dump, empty → reloadEmpty, hold → magCheck. */
  private onReloadIntentRig(intent: string) {
    const rig = this.rig!;
    const e = this.equipped;
    if (intent === 'checkStart') {
      if (this.busy) return;
      this.planKind = 'check';
      this.checking = true;
      this.idleTime = 0;
      this.emitBeat('magCheck', false);
      rig.play('magCheck', { hold: true, onEvent: this.onRigEvent });
    } else if (intent === 'checkEnd') {
      rig.releaseHold();
      this.checking = false;
    } else if (intent === 'tactical' || intent === 'speedUpgrade') {
      if (intent === 'speedUpgrade' && this.planKind === 'reload') {
        // Double tap before the old mag is out: it goes on the floor instead of the pouch.
        if (!this.swapped) this.reloadVariant = 'speed';
        return;
      }
      if (this.busy || !e.mags.hasSpare()) return;
      if (e.mags.inGun && e.mags.inGun.rounds >= e.mags.capacity && e.mags.chambered) return;
      const empty = e.mags.empty || !e.mags.chambered;
      this.reloadVariant = empty || intent === 'speedUpgrade' ? 'speed' : 'tactical';
      this.swapped = false;
      this.planKind = 'reload';
      this.reloadLive = false;
      this.idleTime = 0;
      const stressed = this.player.stress > 0.45;
      rig.play(empty ? 'reloadEmpty' : 'reloadTactical', {
        onEvent: this.onRigEvent,
        speed: (this.reloadVariant === 'speed' ? 1.18 : 1) * (stressed ? 1.12 : 1),
      });
      this.newDrift(1);
    }
  }

  private plan(names: readonly string[], stressed: boolean): PlannedBeat[] {
    return planSequence(names, LIBRARIES[this.equipped.cls], {
      stressed,
      rand: this.rand,
      picker: this.picker,
      fumbleChance: fumbleChance(this.player.stress, this.fumbleMode),
    });
  }

  private startPlan(
    kind: NonNullable<WeaponController['planKind']>,
    names: readonly string[],
    stressed = false,
  ) {
    const e = this.equipped;
    this.beats.start(this.plan(names, stressed), DEFAULT_LEFT, DEFAULT_RIGHT);
    this.beats.startParts.slide = e.cls === 'pistol' && e.boltLocked ? 1 : 0;
    this.planKind = kind;
    this.idleTime = 0;
  }

  private startReload(variant: 'tactical' | 'speed') {
    const e = this.equipped;
    if (this.busy || !e.mags.hasSpare()) return;
    if (e.mags.inGun && e.mags.inGun.rounds >= e.mags.capacity && e.mags.chambered) return;
    const empty = e.mags.empty;
    const stressed = this.player.stress > 0.45;
    this.reloadVariant = empty ? 'speed' : variant;
    this.swapped = false;
    this.startPlan('reload', reloadNames(e.cls, this.reloadVariant, empty, this.rand), stressed);
    this.newDrift(1);
  }

  /** Fire pressed mid mag-check: release the hold so the plan runs its (fast) reinsert + seat. */
  private abortCheck() {
    if (this.rig) {
      this.rig.releaseHold();
      this.checking = false;
      return;
    }
    this.beats.holding = false;
    this.checking = false;
    const cur = this.beats.current?.name;
    const tail = cur ? checkAbortTail(cur) : null;
    if (tail) {
      // The current beat finishes fast too: a check-hold releases immediately, a pull-out completes quickly.
      this.beats.replaceTail(this.plan(tail, true));
    }
    this.planSpeed = 1.6;
  }

  /** 0..1 flashbang throw dip, driven by `game.gear` (0→1→0). */
  private throwDip = 0;
  /** Flinch: envelope (0..1), its peak target and how long it holds before recovering. */
  private flinch = 0;
  private flinchTarget = 0;
  private flinchHold = 0;

  /**
   * Gear hook: lower and cant the weapon while the support hand throws (t: 0→1→0). Later an ArmsRig `throw`
   * action. The left hand leaves the handguard toward the throw while t > 0.
   */
  dipForThrow(t: number) {
    this.throwDip = clamp(t, 0, 1);
  }

  private updateFlinch(dt: number) {
    // Fast rise (~0.08 s), hold, then recover over ~0.6–1 s.
    if (this.flinchTarget > this.flinch) this.flinch += (this.flinchTarget - this.flinch) * damp(0.025, dt);
    if (this.flinchHold > 0) this.flinchHold -= dt;
    else {
      this.flinchTarget = 0;
      this.flinch = Math.max(0, this.flinch - dt * 1.4);
    }
  }

  /** Time scale of the running plan (aborted mag check hurries). */
  private planSpeed = 1;

  private stopPlan() {
    this.planSpeed = 1;
    if (this.camHandOn) this.setCamHand(false);
    this.beats.stop();
    this.planKind = null;
    this.beats.holding = false;
    this.checking = false;
    this.magHeld = false;
    this.magVisible = true;
    this.drawPending = false;
    const e = this.equipped;
    if (e.mag) {
      e.mag.obj.position.copy(e.mag.rest);
      e.mag.obj.quaternion.copy(e.magRestQ);
    }
  }

  private newDrift(k: number) {
    const a = 0.012 * k;
    this.driftTarget.set((this.rand() - 0.5) * a * 2, (this.rand() - 0.5) * a * 1.6, (this.rand() - 0.5) * a);
  }

  private maybeFixCam(manual: boolean, _dt: number) {
    const p = this.player;
    if (this.beats.active || this.switching) return;
    const auto = p.knock > 0.035 && this.idleTime > 1.2 && !p.aiming && p.speed < 2.5 && this.sinceShot > 1.5;
    if (!(manual || auto)) return;
    if (this.rig) {
      // Rig: the support hand reaches the mount through the IK layer (rigArmLayer), straightens it, lets go.
      if (this.planKind) return;
      this.planKind = 'camFix';
      this.camFixT = 0;
      this.camFixed = false;
    } else this.startPlan('camFix', CAM_FIX_NAMES);
  }

  private sink: BeatSink = {
    hit: (b) => {
      this.emitBeat(b.name, b.stressed);
      if (b.variant.kick) this.applyKick(b.variant.kick, b.stressed ? 1.2 : 1);
    },
    event: (ev) => this.onBeatEvent(ev),
  };

  /** Contact jolt (seat slap, bolt slam) into the handling rigid body and the chest cam, on the contact frame. */
  private applyKick(k: BeatKick, gain: number) {
    const e = this.equipped;
    const so = e.sockets;
    switch (k.at) {
      case 'well':
        _v.copy(so.magwell);
        break;
      case 'charging':
        _v.copy(so.chargingHandle);
        break;
      case 'slide':
        _v.copy(so.slideRear);
        break;
      default:
        _v.set(0, e.recoilProfile.boreOffset, -0.1);
    }
    _v.applyMatrix4(this.view.matrixWorld);
    _v2.fromArray(k.j).multiplyScalar(gain).applyQuaternion(this.view.quaternion);
    e.body.impulseAt(_v2, _v);
    if (k.cam) this.player.kick(k.cam * gain, (this.rand() - 0.5) * 0.03, (this.rand() - 0.5) * 0.06, 0);
  }

  private emitBeat(beat: string, stressed: boolean) {
    this.ctx.bus.emit('weaponBeat', { weaponId: this.equipped.def.id, beat, stressed });
  }

  private onBeatEvent(ev: BeatEventName) {
    const e = this.equipped;
    switch (ev) {
      case 'magToHand':
        this.magHeld = true;
        break;
      case 'magToWell':
        this.magHeld = false;
        this.magVisible = true;
        break;
      case 'magHide':
        this.magVisible = false;
        this.magHeld = false;
        if (!this.swapped) {
          e.mags.swap(true);
          this.swapped = true;
          this.drawPending = true;
        }
        break;
      case 'magShow':
        this.magVisible = true;
        this.magHeld = true;
        this.drawPending = false;
        break;
      case 'drop':
        if (this.magVisible) this.spawnDrop();
        this.magVisible = false;
        this.magHeld = false;
        if (!this.swapped) {
          e.mags.swap(false);
          this.swapped = true;
          this.drawPending = true;
        }
        break;
      case 'chamber':
        e.mags.chamber();
        e.boltLocked = false;
        break;
      case 'camGrab':
        this.setCamHand(true);
        break;
      case 'camFix':
        this.player.fixMount();
        break;
      case 'camRelease':
        this.setCamHand(false);
        break;
    }
  }

  private camHandOn = false;

  private setCamHand(active: boolean) {
    if (this.camHandOn === active) return;
    this.camHandOn = active;
    this.ctx.bus.emit('camHand', { active });
  }

  private spawnDrop() {
    const e = this.equipped;
    if (!e.mag) return;
    // On the rig the old mag may be its clone (empty reloads): drop whichever is showing the old one.
    const spare = this.rig ? e.model.root.getObjectByName('spareMag') : undefined;
    const o = spare?.visible ? spare : e.mag.obj;
    o.updateMatrixWorld(true);
    const p = this.player;
    // Falls out of the well: weapon-down plus the body's own motion, a little tumble.
    _v.set(0, -1.2, 0.2).applyQuaternion(this.view.quaternion).add(p.velocity);
    _v2.set((this.rand() - 0.5) * 6, (this.rand() - 0.5) * 4, (this.rand() - 0.5) * 6);
    this.drops.spawn(o, o.matrixWorld, _v, _v2, true);
  }

  private updatePlan(dt: number) {
    const was = this.beats.active;
    if (was) this.beats.update(dt * this.planSpeed, this.sink);
    if (was && !this.beats.active) {
      const e = this.equipped;
      if (this.planKind === 'reload' && e.mags.empty) e.mags.chamber();
      if (this.camHandOn) this.setCamHand(false);
      this.stopPlan();
    }
    this.reload.kind = this.switching
      ? 'switch'
      : this.planKind === 'reload'
        ? 'reload'
        : this.planKind === 'check'
          ? 'check'
          : this.planKind === 'camFix'
            ? 'camFix'
            : 'idle';
    // Inventory → pouch visuals.
    const rifle = this.rifle,
      pistol = this.pistol;
    const pend = this.drawPending ? 1 : 0;
    this.body.rifleMags = rifle
      ? Math.min(3, rifle.mags.pouches.length + (rifle === this.equipped ? pend : 0))
      : 0;
    this.body.pistolMags = pistol
      ? Math.min(2, pistol.mags.pouches.length + (pistol === this.equipped ? pend : 0))
      : 0;
    this.body.pistolHolstered = !!pistol && this.equipped !== pistol;
  }

  private updateSwitch(dt: number) {
    const s = this.switching;
    if (this.rig) {
      this.switchW = 0;
      return;
    }
    if (!s) {
      this.switchW = 0;
      return;
    }
    const e = this.equipped;
    // Build switch time (sling/holster + draw) when available, split ~45/55.
    const away = e.def.handling ? e.def.handling.switchTime * 0.45 : e.cfg.awayTime;
    const draw = e.def.handling ? e.def.handling.switchTime * 0.55 : e.cfg.drawTime;
    if (s.phase === 'out') {
      s.w = Math.min(1, s.w + dt / away);
      if (s.w >= 1) {
        // swapMid: the visible weapon changes.
        if (this.loadout[s.to] !== this.equipped) {
          this.equipNow(s.to);
          this.emitBeat('swapMid', false);
        }
        s.phase = 'in';
        s.hurry = false;
        this.emitBeat(this.equipped.cls === 'pistol' ? 'draw' : 'unsling', false);
      }
    } else {
      s.w = Math.max(0, s.w - (dt / draw) * (s.hurry ? 2.2 : 1));
      if (s.w <= 0) this.switching = null;
    }
    this.switchW = this.switching ? s.w : 0;
  }

  // ---------------------------------------------------------------- parts & hands

  private updateParts(_dt: number) {
    const e = this.equipped;
    const charge = this.beats.active ? this.beats.part('charge') : 0;
    if (e.charging) e.charging.obj.position.z = e.charging.rest.z + charge * 0.07;
    if (e.bolt)
      e.bolt.obj.position.z = e.bolt.rest.z + Math.max(e.boltLocked ? 1 : 0, charge, this.cycle) * 0.06;
    if (e.slide) {
      const sv = this.beats.active ? this.beats.part('slide') : e.boltLocked ? 1 : 0;
      e.slide.obj.position.z = e.slide.rest.z + Math.max(sv, this.cycle) * 0.028;
    }
    if (e.mag) e.mag.obj.visible = this.magVisible;
  }

  /** World transform of an anchor's frame. */
  private anchor(at: Anchor, outP: Vector3, outQ: Quaternion) {
    const e = this.equipped;
    const w = this.view.matrixWorld;
    const p = this.player;
    switch (at) {
      case 'grip':
      case 'handguard':
      case 'well':
      case 'charging':
      case 'boltCatch':
      case 'slide':
        weaponAnchor(e.grip, at, this.beats.part('charge'), this.beats.part('slide'), outP, outQ);
        outP.applyMatrix4(w);
        outQ.premultiply(this.view.quaternion);
        return;
      case 'pouch':
        this.body.rifleSlot(outP, outQ);
        return;
      case 'pistolPouch':
        this.body.pistolSlot(p, outP, outQ);
        return;
      case 'dump':
      case 'holster':
        this.body.dump(p, outP, outQ);
        return;
      case 'cam':
        // Hand grips the housing's left edge, fingers curling round in front of the lens.
        outP.copy(p.camLocal).add(CAM_GRIP).applyMatrix4(p.torso.matrixWorld);
        outQ.copy(p.torso.quaternion);
        return;
      case 'chest':
      default:
        outP.setFromMatrixPosition(p.torso.matrixWorld);
        outQ.copy(p.torso.quaternion);
    }
  }

  private basis(at: Anchor, _side: 'left' | 'right', out: Quaternion): Quaternion {
    return anchorBasis(this.equipped.grip, at, out);
  }

  /** Resolve a key to a world hand transform. */
  private keyToWorld(
    k: HandKey,
    side: 'left' | 'right',
    jitter: V3,
    jk: number,
    outP: Vector3,
    outQ: Quaternion,
  ) {
    this.anchor(k.at, outP, outQ);
    const o = k.p ?? ZERO3;
    _v3.set(o[0] + jitter[0] * jk, o[1] + jitter[1] * jk, o[2] + jitter[2] * jk).applyQuaternion(outQ);
    outP.add(_v3);
    outQ.multiply(this.basis(k.at, side, _q2));
    if (k.r) outQ.multiply(_q2.setFromEuler(_e.set(k.r[0], k.r[1], k.r[2])));
  }

  private solveHand(
    side: 'left' | 'right',
    def: HandKey,
    outP: Vector3,
    outQ: Quaternion,
    curls: Float32Array,
  ) {
    const b = this.beats.current;
    const seg = this.beats.active ? this.beats.handSegment(side, _seg) : null;
    const jitter = b?.jitter ?? ZERO3;
    if (!seg) {
      this.keyToWorld(def, side, ZERO3, 0, outP, outQ);
      curls.set(this.poseFor(def, def, side));
      return;
    }
    this.keyToWorld(seg.a, side, jitter, 0, _posA, _qA);
    this.keyToWorld(seg.b, side, jitter, seg.mid, _posB, _qB);
    outP.lerpVectors(_posA, _posB, seg.u);
    outQ.slerpQuaternions(_qA, _qB, seg.u);
    _poseA.set(this.poseFor(seg.a, def, side));
    blendPose(_poseA, this.poseFor(seg.b, def, side, seg.a), seg.u, curls);
    // Hands working on the gun (mag well, charging handle, bolt catch, slide): the authored pose is the intent,
    // the fingers close only until they touch the weapon surfaces.
    if (CONTACT_ANCHORS.has(seg.b.at) || CONTACT_ANCHORS.has(seg.a.at)) {
      _hw.compose(outP, outQ, _one);
      _invView.copy(this.view.matrixWorld).invert();
      _hw.premultiply(_invView);
      _poseB.set(curls);
      resolveHandContact(this.equipped.grip, _hw, side === 'left' ? -1 : 1, _poseB, curls, this.magHeld);
      _hw.premultiply(this.view.matrixWorld);
      _hw.decompose(outP, outQ, _v);
    }
  }

  /** Curls for a key: solved grips on the grip / handguard, authored poses elsewhere. */
  private poseFor(k: HandKey, def: HandKey, side: 'left' | 'right', prev?: HandKey): Float32Array {
    const g = this.equipped.grip;
    const name = k.pose ?? prev?.pose ?? def.pose ?? 'relaxed';
    if (k.at === 'grip' && side === 'right' && (name === 'grip' || name === 'trigger'))
      return blendPose(g.fire.curls, g.fireTrigger.curls, name === 'trigger' ? 1 : this.triggerW, _poseC);
    if (k.at === 'handguard' && side === 'left' && (name === 'support' || name === 'cclamp'))
      return g.support.curls;
    return HAND_POSES[name];
  }

  /** Flinch shield / throw: the support hand leaves the gun toward the face (palm out) or the throw. */
  private shieldHand(L: ArmRig, tw: Matrix4) {
    const f = ease('out', this.flinch);
    const t = ease('io', this.throwDip) * 0.85;
    const k = Math.max(f, t);
    if (k < 1e-3) return;
    // Flinch: in front of the face, fingers up, palm forward. Throw: up beside the head, cocked back.
    if (f >= t) {
      _v.set(-0.04, 0.26, -0.24);
      _q.setFromEuler(_e.set(Math.PI / 2, 0.25, -0.2));
    } else {
      _v.set(-0.22, 0.24, -0.08);
      _q.setFromEuler(_e.set(Math.PI / 2 + 0.4, 0.5, 0.4));
    }
    _v.applyMatrix4(tw);
    _q.premultiply(this.player.torso.quaternion);
    L.handPos.lerp(_v, k);
    L.handQuat.slerp(_q, k);
    blendPose(L.curls, HAND_POSES.flat, k, L.curls);
  }

  private elbowPole(a: ArmRig, natural: V3, tw: Matrix4) {
    _m.compose(a.handPos, a.handQuat, _one);
    _v.copy(WRIST).applyMatrix4(_m);
    _v2.fromArray(natural).transformDirection(tw);
    _v3.set(0, 1, 0).transformDirection(tw);
    // Keep the sleeve off the chest-cam lens: swivel the elbow away from it when the wrist allows.
    armSwivel(a.shoulder, _v, _m, _v2, _v3, a.side, a.pole, this.ctx.camera.position, ARM_CLEAR);
  }

  private updateHands(_dt: number) {
    const p = this.player;
    const e = this.equipped;
    const cfg = e.cfg;
    const L = this.body.left,
      R = this.body.right;
    const tw = p.torso.matrixWorld;
    // Shoulders: ADS draws the right shoulder in under the cheek weld; sprint drops them a little.
    R.shoulder.set(cfg.shoulderR[0] - this.ads * 0.03, cfg.shoulderR[1], cfg.shoulderR[2] - this.ads * 0.02);
    L.shoulder.set(cfg.shoulderL[0], cfg.shoulderL[1], cfg.shoulderL[2] - this.ads * 0.02);
    R.shoulder.applyMatrix4(tw);
    L.shoulder.applyMatrix4(tw);
    this.solveHand('left', DEFAULT_LEFT, L.handPos, L.handQuat, L.curls);
    this.shieldHand(L, tw);
    this.solveHand('right', DEFAULT_RIGHT, R.handPos, R.handQuat, R.curls);
    // Elbow swivel: line the forearm up with the hand (wrist near neutral), biased down-and-out (anim/ik).
    this.elbowPole(R, cfg.poleR, tw);
    this.elbowPole(L, cfg.poleL, tw);
    this.body.update(p);
    L.update();
    R.update();
    if (this.gripOverlay)
      this.gripOverlay.update(e.grip.shapes.set, this.view.matrixWorld, [
        { pos: L.handPos, quat: L.handQuat, curls: L.curls, side: -1 },
        { pos: R.handPos, quat: R.handQuat, curls: R.curls, side: 1 },
      ]);

    // Mag rides the support hand while held.
    if (this.magHeld && e.mag) {
      const o = e.mag.obj;
      _m.compose(L.handPos, L.handQuat, _one);
      _q.copy(basisQuat(BASES.well!, _q)).invert();
      _m.multiply(_m2.makeRotationFromQuaternion(_q));
      _m.multiply(_m2.makeTranslation(-e.grip.magGrasp.x, -e.grip.magGrasp.y, -e.grip.magGrasp.z));
      // Into the weapon root's space (the mag stays parented to the model).
      _m2.copy(e.model.root.matrixWorld).invert();
      _m.premultiply(_m2);
      _m.decompose(o.position, o.quaternion, _v);
    } else if (e.mag && !this.magHeld) {
      e.mag.obj.position.copy(e.mag.rest);
      e.mag.obj.quaternion.copy(e.magRestQ);
    }
  }
}
