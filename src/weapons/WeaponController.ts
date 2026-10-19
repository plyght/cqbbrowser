import { Euler, Group, Matrix4, Object3D, Quaternion, Vector3 } from 'three';
import type { Context, System } from '../core/Context';
import { Spring, clamp, damp, noise1, rng, wrapAngle } from '../core/math';
import { ReloadGesture } from '../input/ReloadGesture';
import { CHEST_MOUNT, type Player } from '../player/Player';
import { settings } from '../settings/Settings';
import {
  BeatPlayer,
  VariantPicker,
  fumbleChance,
  planSequence,
  type Anchor,
  type BeatEventName,
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
  dumpUpgradeTail,
  reloadNames,
  type WeaponClass,
} from '../anim/data/sequences';
import { HAND_POSES, blendPose, POSE_SIZE } from '../anim/handPoses';
import { ease } from '../anim/tracks';
import { BodyRig } from '../body/BodyRig';
import { DroppedMags } from '../body/DroppedMags';
import { WEAPONS, type FireMode, type WeaponDef } from './defs';
import { Magazines } from './Magazines';
import { buildModel, type WeaponModel } from './models';

/** Kept for HUD/tests: what the hands are busy with. */
export type ReloadState = { kind: 'idle' | 'reload' | 'check' | 'camFix' | 'switch' };

/** Settings → Advanced → Weapon handling (PRD §6.3.8). */
export const handlingSettings = settings.ns('gameplay.handling', {
  /** "Weapon inertia" master: 0 = arcade-locked gun, 1 = default, 1.5 = heavy. */
  weaponInertia: 1,
  /** Realism preset gate for reload fumbles (§6.7). */
  fumbles: 'rare' as FumbleMode,
});

type HoldName = 'high' | 'ads' | 'low' | 'compressed' | 'sprint';
interface Hold {
  /** Weapon root (grip) position, torso-local. */
  p: V3;
  /** Weapon-local [pitch, yaw, roll] offsets from the converged aim. */
  r: V3;
}

interface ClassCfg {
  holds: Record<HoldName, Hold>;
  /** How far below the magwell mouth the support hand holds the mag. */
  graspDepth: number;
  shoulderR: V3;
  shoulderL: V3;
  /** Elbow pole directions (torso-local). */
  poleR: V3;
  poleL: V3;
  /** Holster / sling pose at the bottom of a weapon switch. */
  away: Hold;
  awayTime: number;
  drawTime: number;
  /** Fallback socket positions when a model lacks them. */
  sockets: Record<string, V3>;
  /** Hand bases [finger dir, back-of-hand dir] in the weapon frame. */
  gripBasis: [V3, V3];
  supportBasis: [V3, V3];
}

/**
 * Hold poses are tuned against chest-cam reference footage (camera at torso (-0.075, 0, -0.15)):
 * rifle at high ready enters bottom-right, big, rail running toward the aim point; ADS rises to the
 * upper centre with the optic large and close; pistol sits low-centre with both arms extended.
 */
const CFG: Record<WeaponClass, ClassCfg> = {
  rifle: {
    holds: {
      high: { p: [0.03, -0.235, -0.31], r: [-0.02, 0, 0] },
      ads: { p: [-0.01, -0.04, -0.35], r: [0, 0, 0] },
      low: { p: [0.03, -0.28, -0.28], r: [-0.55, 0.05, 0.06] },
      compressed: { p: [0.04, -0.2, -0.22], r: [-0.12, 0, 0] },
      sprint: { p: [0.02, -0.25, -0.25], r: [-0.75, 0.55, -0.5] },
    },
    graspDepth: 0.065,
    shoulderR: [0.19, 0.02, -0.02],
    shoulderL: [-0.19, 0.0, -0.1],
    poleR: [0.45, -0.55, 0.15],
    poleL: [-0.8, -0.6, 0.0],
    away: { p: [0.07, -0.34, 0.1], r: [-1.05, 0.35, 0.75] },
    awayTime: 0.32,
    drawTime: 0.42,
    sockets: {
      gripRight: [0, -0.04, 0.042],
      gripLeft: [0, 0.03, -0.28],
      magwell: [0, -0.015, -0.06],
      chargingHandle: [0, 0.052, 0.098],
      boltCatch: [-0.027, 0.005, -0.02],
      slideRear: [0, 0.05, 0.05],
    },
    gripBasis: [
      [0, -0.34, -0.94],
      [1, 0, 0],
    ],
    supportBasis: [
      [0.8, 0.5, -0.33],
      [-0.5, -0.85, 0],
    ],
  },
  pistol: {
    holds: {
      high: { p: [-0.055, -0.14, -0.55], r: [0, 0, 0] },
      ads: { p: [-0.068, -0.07, -0.57], r: [0, 0, 0] },
      low: { p: [-0.05, -0.25, -0.47], r: [-0.6, 0, 0] },
      compressed: { p: [-0.01, -0.17, -0.3], r: [-0.1, 0, 0] },
      sprint: { p: [0.06, -0.28, -0.3], r: [-1.0, 0.15, 0] },
    },
    graspDepth: 0.012,
    shoulderR: [0.17, 0.06, -0.05],
    shoulderL: [-0.17, 0.06, -0.05],
    poleR: [0.45, -0.55, 0.05],
    poleL: [-0.45, -0.55, 0.05],
    away: { p: [0.14, -0.42, 0.26], r: [-1.3, 0, 0.2] },
    awayTime: 0.36,
    drawTime: 0.4,
    sockets: {
      gripRight: [0, -0.04, 0.012],
      gripLeft: [-0.022, -0.052, 0],
      magwell: [0, -0.105, 0.005],
      chargingHandle: [0, 0.03, 0.022],
      boltCatch: [-0.016, 0.0, -0.02],
      slideRear: [0, 0.03, 0.022],
    },
    gripBasis: [
      [0, -0.25, -0.97],
      [1, 0, 0],
    ],
    supportBasis: [
      [0.1, -0.25, -0.96],
      [-1, 0, 0.1],
    ],
  },
};

/** Hand bases for the remaining anchors (left hand; weapon / mag / torso frames). */
const BASES: Partial<Record<Anchor, [V3, V3]>> = {
  well: [
    [0, 0, -1],
    [-1, 0, 0],
  ],
  charging: [
    [1, 0, 0],
    [0, 1, 0],
  ],
  boltCatch: [
    [0, 0.3, -1],
    [-1, 0, 0],
  ],
  slide: [
    [1, -0.3, 0.15],
    [0, 1, 0],
  ],
  cam: [
    [0.3, 0.15, -1],
    [-1, 0, 0],
  ],
};
const BODY_BASIS: [V3, V3] = [
  [0, -0.3, -1],
  [-1, 0, 0],
];

const _bx = new Vector3();
const _by = new Vector3();
const _bz = new Vector3();
const _bm = new Matrix4();
/** Quaternion whose -z is `finger` and +y is (orthogonalised) `back`. */
function basisQuat([finger, back]: [V3, V3], out = new Quaternion()): Quaternion {
  _bz.set(-finger[0], -finger[1], -finger[2]).normalize();
  _by.set(back[0], back[1], back[2]);
  _by.addScaledVector(_bz, -_by.dot(_bz)).normalize();
  _bx.crossVectors(_by, _bz);
  return out.setFromRotationMatrix(_bm.makeBasis(_bx, _by, _bz));
}

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
  /** Mag frame: rest rotation (weapon frame) and the support-hand grasp point in mag-local coords. */
  magRestQ: Quaternion;
  magGrasp: Vector3;
  gripQ: Quaternion;
  supportQ: Quaternion;
  boltLocked: boolean;
  /** Recoil instability → how soon grip readjusts happen. */
  adjustAfter: number;
}

const DEFAULT_LEFT: HandKey = { t: 1, at: 'handguard', pose: 'support' };
const DEFAULT_RIGHT: HandKey = { t: 1, at: 'grip', pose: 'grip' };
const ZERO3: V3 = [0, 0, 0];
const X_AXIS = new Vector3(1, 0, 0);
const CAM_GRIP = new Vector3(-0.07, 0.015, 0.012);

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
const _poseTmp = new Float32Array(POSE_SIZE);
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
  private switching: { phase: 'out' | 'in'; t: number; to: number } | null = null;
  private switchW = 0;
  private cooldown = 0;
  private triggerHeld = false;
  private triggerW = 0;
  private aimYaw = new Spring(9, 0.82);
  private aimPitch = new Spring(9, 0.82);
  private swayX = new Spring(5, 0.6);
  private swayY = new Spring(5, 0.6);
  private recoilPitch = new Spring(7, 0.75);
  private recoilYaw = new Spring(6, 0.7);
  private recoilRoll = new Spring(6, 0.6);
  private recoilBack = new Spring(14, 0.6);
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
  private prevTorsoYaw = 0;
  private prevPitch = 0;
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
    this.view.add(this.equipped.model.root);
    ctx.scene.add(this.view, ...this.body.objects);
    this.drops = new DroppedMags(ctx);
    this.aimYaw.reset(player.yaw);
    this.aimPitch.reset(player.pitch);
    this.prevTorsoYaw = player.yaw;
    const apply = (s: ReturnType<typeof handlingSettings.get>) => {
      this.inertia = clamp(s.weaponInertia, 0, 1.5);
      this.fumbleMode = s.fumbles;
    };
    apply(handlingSettings.get());
    handlingSettings.onChange(apply);
  }

  private make(def: WeaponDef): Equipped {
    const cls: WeaponClass = def.slot === 'sidearm' ? 'pistol' : 'rifle';
    const cfg = CFG[cls];
    const model = buildModel(def.model);
    const root = model.root;
    root.updateMatrixWorld(true);
    const inv = new Matrix4().copy(root.matrixWorld).invert();
    const sockets: Record<string, Vector3> = {};
    for (const [name, fb] of Object.entries(cfg.sockets)) {
      const o = root.getObjectByName(name);
      sockets[name] = o
        ? new Vector3().setFromMatrixPosition(o.matrixWorld).applyMatrix4(inv)
        : new Vector3(...fb);
    }
    const part = (name: string): Part | null => {
      const obj = root.getObjectByName(name);
      return obj ? { obj, rest: obj.position.clone() } : null;
    };
    const mag = part('mag');
    const magRestQ = mag ? mag.obj.quaternion.clone() : new Quaternion();
    // Grasp point: below the well mouth along the mag axis, expressed in the mag's local frame.
    const magGrasp = new Vector3(0, -cfg.graspDepth, 0).applyQuaternion(magRestQ).add(sockets.magwell);
    if (mag) magGrasp.sub(mag.rest).applyQuaternion(magRestQ.clone().invert());
    const instability = clamp((def.recoil.up * 0.6 + def.recoil.side * 0.4) / (def.mass * 0.6), 0, 2);
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
      magRestQ,
      magGrasp,
      gripQ: basisQuat(cfg.gripBasis),
      supportQ: basisQuat(cfg.supportBasis),
      boltLocked: false,
      adjustAfter: Math.max(1, Math.round(5 - instability * 2)),
    };
  }

  private get busy(): boolean {
    return this.beats.active && this.planKind !== 'micro';
  }

  /** Start a sling/holster → draw switch. */
  equip(i: number) {
    const next = this.loadout[i];
    if (!next || next === this.equipped || this.switching || this.busy) return;
    this.stopPlan();
    this.switching = { phase: 'out', t: 0, to: i };
    this.emitBeat(this.equipped.cls === 'pistol' ? 'holster' : 'sling', false);
  }

  /** Immediate equip without animation (tests/tools). */
  equipNow(i: number) {
    const next = this.loadout[i];
    if (!next || next === this.equipped) return;
    this.view.remove(this.equipped.model.root);
    this.equipped = next;
    this.view.add(next.model.root);
    this.stopPlan();
  }

  /** Spring frequency from mass/length: heavier & longer = more lag; ADS stiffens. */
  private lagFreq(): number {
    const d = this.equipped.def;
    const base = 13 - d.mass * 1.4 - d.length * 4.5;
    const adsBoost = 1 + this.ads * 0.35;
    if (this.inertia < 0.05) return 60;
    return (clamp(base, 4, 16) * adsBoost) / Math.max(0.15, this.inertia);
  }

  /** Front-heavy / long builds overshoot on stop. */
  private lagZeta(): number {
    const d = this.equipped.def;
    return clamp(0.93 - (d.length - 0.2) * 0.35 - (d.suppressed ? 0.06 : 0), 0.55, 0.95);
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
    if (f.pressed.has('fireMode')) e.mode = d.modes[(d.modes.indexOf(e.mode) + 1) % d.modes.length];
    this.maybeFixCam(f.pressed.has('fixCam'), dt);

    // Pose blends.
    const busy = this.busy || !!this.switching;
    const hd = 0.06 + d.mass * 0.012;
    this.ads += ((p.aiming && !busy ? 1 : 0) - this.ads) * damp(hd, dt);
    this.wSprint += ((p.sprinting && !this.beats.active ? 1 : 0) - this.wSprint) * damp(0.1, dt);
    this.wLow += ((p.ready === 'low' ? 1 : 0) - this.wLow) * damp(0.09, dt);
    this.wComp += ((p.ready === 'compressed' ? 1 : 0) - this.wComp) * damp(0.08, dt);
    this.updateSwitch(dt);

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
    _v2.copy(this.aimTarget).sub(_v);
    const wantYaw = Math.atan2(-_v2.x, -_v2.z);
    const wantPitch = Math.atan2(_v2.y, Math.hypot(_v2.x, _v2.z));
    const freq = this.lagFreq();
    this.aimYaw.freq = this.aimPitch.freq = freq;
    this.aimYaw.zeta = this.aimPitch.zeta = this.lagZeta();
    this.aimYaw.value = wantYaw - wrapAngle(wantYaw - this.aimYaw.value);
    if (this.inertia < 0.05) {
      this.aimYaw.reset(wantYaw);
      this.aimPitch.reset(wantPitch);
    } else {
      this.aimYaw.step(wantYaw, dt);
      this.aimPitch.step(wantPitch, dt);
    }

    // Positional inertia sway: opposite turn rate & look pitch, scaled by the inertia master.
    const yawRate = wrapAngle(p.yaw - this.prevTorsoYaw) / Math.max(dt, 1e-4);
    const pitchRate = (p.pitch - this.prevPitch) / Math.max(dt, 1e-4);
    this.prevTorsoYaw = p.yaw;
    this.prevPitch = p.pitch;
    const sway = (1 - this.ads * 0.6) * this.inertia * (0.6 + d.mass * 0.15);
    this.swayX.step(clamp(yawRate * 0.0035, -0.05, 0.05) * sway, dt);
    this.swayY.step(clamp(-pitchRate * 0.003, -0.04, 0.04) * sway, dt);

    // Recoil springs relax toward 0 (returns toward the original point of aim); fatigue slows recovery.
    const rec = 1 - this.fatigue * 0.35;
    this.recoilPitch.freq = 7 * rec;
    this.recoilYaw.freq = 6 * rec;
    this.recoilPitch.step(0, dt);
    this.recoilYaw.step(0, dt);
    this.recoilRoll.step(0, dt);
    this.recoilBack.step(0, dt);

    // Breathing + stress hand shake + fatigue; lower crouched and in ADS.
    const t = this.ctx.time;
    const steady = (1 - this.ads * 0.5) * (1 - p.crouch * 0.25);
    const shake = (0.0015 + p.stress * 0.006 + this.fatigue * 0.005) * steady;
    const breathY = Math.sin(t * 1.5 * (1 + p.stress * 0.5)) * 0.004 * (1 - this.ads * 0.7);
    const nX = noise1(t * 6.1, 1) * shake;
    const nY = noise1(t * 5.3, 2) * shake;
    this.fatigue = clamp(this.fatigue - dt * 0.12, 0, 1);
    this.sinceShot += dt;
    this.idleTime += dt;
    if (this.sinceShot > 0.35 && this.shotsInString > 0) this.endString();

    this.pose(nX, nY + breathY);
    this.updatePlan(dt);
    this.updateParts(dt);
    this.updateHands(dt);
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
    this.mixHold(this.ads, H.ads);
    // Crouched: slightly lower and tighter; drifting hold (never exactly the same place).
    h.y -= p.crouch * 0.015;
    h.z += p.crouch * 0.02;
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
    // Muzzle tuck: retract and cant up; recoil drives the stock back.
    const len = e.def.length;
    h.z += this.tuck * 0.16 * len + this.recoilBack.value * 0.04;
    h.y += this.tuck * 0.03;
    r.x += this.tuck * 0.45;
    h.x += this.swayX.value;
    h.y += this.swayY.value;
    // Looking well down the arms don't follow the eyes all the way: the gun rides up in the frame,
    // uncovering the boots.
    const lift = Math.max(0, -p.pitch - 0.7) * 0.6;
    if (lift > 0) h.sub(CHEST_MOUNT).applyAxisAngle(X_AXIS, -lift).add(CHEST_MOUNT);
  }

  private pose(nX: number, nY: number) {
    const p = this.player;
    const r = this.holdR;
    _e.set(
      this.aimPitch.value + this.recoilPitch.value + nY,
      this.aimYaw.value + this.recoilYaw.value + nX,
      this.recoilRoll.value - p.lean * p.tuning.leanAngle * 0.85,
    );
    this.view.quaternion.setFromEuler(_e);
    _e.set(r.x, r.y, r.z);
    this.view.quaternion.multiply(_q.setFromEuler(_e));
    this.view.position.copy(this.hold).applyMatrix4(p.torso.matrixWorld);
    this.view.updateMatrixWorld(true);
  }

  muzzleWorld(): { origin: Vector3; dir: Vector3 } {
    const m = this.equipped.model;
    const origin = new Vector3(0, 0.03, m.muzzleZ).applyMatrix4(this.view.matrixWorld);
    const dir = new Vector3(0, 0, -1).applyQuaternion(this.view.quaternion).normalize();
    return { origin, dir };
  }

  // ---------------------------------------------------------------- firing

  private updateFire(dt: number, down: boolean) {
    this.cooldown -= dt;
    this.cycle = Math.max(0, this.cycle - dt / 0.07);
    const e = this.equipped;
    if (down && this.planKind === 'micro') this.stopPlan();
    const canFire =
      !this.beats.active && !this.switching && this.wLow < 0.5 && this.wSprint < 0.3 && this.tuck < 0.6;
    const pressed = down && !this.triggerHeld;
    this.triggerHeld = down;
    this.triggerW += ((down || this.ads > 0.5 ? 1 : 0) - this.triggerW) * damp(0.04, dt);
    if (!down || !canFire || this.cooldown > 0) return;
    if (e.mode === 'semi' && !pressed) return;
    if (!e.mags.fire()) {
      if (pressed) this.ctx.bus.emit('dryFire', { weaponId: e.def.id });
      return;
    }
    if (e.mags.empty) e.boltLocked = true;
    this.cooldown = 60 / e.def.rpm;
    this.shoot();
  }

  private shoot() {
    const e = this.equipped;
    const d = e.def;
    const { origin, dir } = this.muzzleWorld();
    this.ctx.bus.emit('shot', {
      weaponId: d.id,
      origin,
      dir,
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
    const stab = 1 / (0.6 + d.mass * 0.25);
    const r = d.recoil;
    const ramp = 1 + Math.min(this.shotsInString, 8) * 0.06;
    const fat = 1 + this.fatigue * 0.3;
    this.recoilPitch.impulse(r.up * 0.9 * stab * ramp * fat * (1 - this.ads * 0.25));
    this.recoilYaw.impulse((this.rand() - 0.5) * r.side * 0.9 * stab * fat);
    this.recoilRoll.impulse((this.rand() - 0.4) * r.roll * 1.2 * stab);
    this.recoilBack.impulse(r.back * 3);
    this.player.kick(-r.up * 0.12 * stab, (this.rand() - 0.5) * 0.05, (this.rand() - 0.5) * 0.08);
    this.ctx.input.haptics.rumble(0.35 * r.back, 0.6, 70);
  }

  /** A string of fire ended: maybe readjust the grip (less stable weapons readjust sooner). */
  private endString() {
    const e = this.equipped;
    this.lastString = this.shotsInString;
    this.shotsInString = 0;
    this.newDrift(0.6);
    const need = e.adjustAfter - (this.fatigue > 0.4 ? 1 : 0);
    if (this.lastString >= need && !this.beats.active && !this.switching)
      this.startPlan('micro', ['gripAdjust']);
  }

  // ---------------------------------------------------------------- reloads & plans

  private onReloadIntent(intent: string) {
    if (this.switching) return;
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

  private stopPlan() {
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
    if (manual || auto) this.startPlan('camFix', CAM_FIX_NAMES);
  }

  private sink: BeatSink = {
    hit: (b) => this.emitBeat(b.name, b.stressed),
    event: (ev) => this.onBeatEvent(ev),
  };

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
    const o = e.mag.obj;
    o.updateMatrixWorld(true);
    const p = this.player;
    // Falls out of the well: weapon-down plus the body's own motion, a little tumble.
    _v.set(0, -1.2, 0.2).applyQuaternion(this.view.quaternion).add(p.velocity);
    _v2.set((this.rand() - 0.5) * 6, (this.rand() - 0.5) * 4, (this.rand() - 0.5) * 6);
    this.drops.spawn(o, o.matrixWorld, _v, _v2, true);
  }

  private updatePlan(dt: number) {
    const was = this.beats.active;
    if (was) this.beats.update(dt, this.sink);
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
    if (!s) {
      this.switchW = 0;
      return;
    }
    s.t += dt;
    const cfg = this.equipped.cfg;
    if (s.phase === 'out') {
      this.switchW = clamp(s.t / cfg.awayTime, 0, 1);
      if (s.t >= cfg.awayTime) {
        this.equipNow(s.to);
        s.phase = 'in';
        s.t = 0;
        this.switchW = 1;
        this.emitBeat(this.equipped.cls === 'pistol' ? 'draw' : 'unsling', false);
      }
    } else {
      this.switchW = 1 - clamp(s.t / this.equipped.cfg.drawTime, 0, 1);
      if (s.t >= this.equipped.cfg.drawTime) {
        this.switching = null;
        this.switchW = 0;
      }
    }
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
        outP.copy(e.sockets.gripRight).applyMatrix4(w);
        outQ.copy(this.view.quaternion);
        return;
      case 'handguard':
        outP.copy(e.sockets.gripLeft).applyMatrix4(w);
        outQ.copy(this.view.quaternion);
        return;
      case 'well':
        // Mag frame at rest (mag rotation within the weapon), origin at the support-hand grasp point.
        outQ.copy(this.view.quaternion).multiply(e.magRestQ);
        outP.copy(e.magGrasp).applyQuaternion(e.magRestQ);
        if (e.mag) outP.add(e.mag.rest);
        outP.applyMatrix4(w);
        return;
      case 'charging':
        outP.copy(e.sockets.chargingHandle);
        outP.z += this.beats.part('charge') * 0.07;
        outP.applyMatrix4(w);
        outQ.copy(this.view.quaternion);
        return;
      case 'boltCatch':
        outP.copy(e.sockets.boltCatch).applyMatrix4(w);
        outQ.copy(this.view.quaternion);
        return;
      case 'slide':
        outP.copy(e.sockets.slideRear);
        outP.z += this.beats.part('slide') * 0.028;
        outP.applyMatrix4(w);
        outQ.copy(this.view.quaternion);
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
    const e = this.equipped;
    if (at === 'grip') return out.copy(e.gripQ);
    if (at === 'handguard') return out.copy(e.supportQ);
    return basisQuat(BASES[at] ?? BODY_BASIS, out);
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
      curls.set(HAND_POSES[def.pose ?? 'relaxed']);
      return;
    }
    this.keyToWorld(seg.a, side, jitter, 0, _posA, _qA);
    this.keyToWorld(seg.b, side, jitter, seg.mid, _posB, _qB);
    outP.lerpVectors(_posA, _posB, seg.u);
    outQ.slerpQuaternions(_qA, _qB, seg.u);
    const pa = HAND_POSES[seg.a.pose ?? def.pose ?? 'relaxed'];
    const pb = HAND_POSES[seg.b.pose ?? seg.a.pose ?? def.pose ?? 'relaxed'];
    blendPose(pa, pb, seg.u, curls);
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
    R.pole.fromArray(cfg.poleR).add(R.shoulder);
    L.pole.fromArray(cfg.poleL).add(L.shoulder);
    R.shoulder.applyMatrix4(tw);
    R.pole.applyMatrix4(tw);
    L.shoulder.applyMatrix4(tw);
    L.pole.applyMatrix4(tw);
    this.solveHand('left', DEFAULT_LEFT, L.handPos, L.handQuat, L.curls);
    this.solveHand('right', DEFAULT_RIGHT, R.handPos, R.handQuat, R.curls);
    // Trigger finger: indexed along the receiver until ADS / firing.
    if (!this.beats.active || !this.beats.current?.variant.right) {
      blendPose(R.curls, HAND_POSES.trigger, this.triggerW, _poseTmp);
      R.curls.set(_poseTmp);
    }
    this.body.update(p);
    L.update();
    R.update();

    // Mag rides the support hand while held.
    if (this.magHeld && e.mag) {
      const o = e.mag.obj;
      _m.compose(L.handPos, L.handQuat, _one);
      _q.copy(basisQuat(BASES.well!, _q)).invert();
      _m.multiply(_m2.makeRotationFromQuaternion(_q));
      _m.multiply(_m2.makeTranslation(-e.magGrasp.x, -e.magGrasp.y, -e.magGrasp.z));
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
