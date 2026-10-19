import { Euler, Matrix4, Object3D, Vector3 } from 'three';
import type { Context, System } from '../core/Context';
import { Spring, clamp, damp, noise1, rng } from '../core/math';
import { RAPIER } from '../physics/Physics';
import type { Surface } from '../core/bus';
import { settings } from '../settings/Settings';
import { CAM_KICK_SPRING } from '../anim/handling/characterise';

export type ReadyPos = 'high' | 'low' | 'compressed';
export type CameraMount = 'chest' | 'helmet';

export interface PlayerTuning {
  walkSpeed: number;
  slowSpeed: number;
  sprintSpeed: number;
  crouchSpeed: number;
  accelHalfLife: number;
  /** Time (s) to reach walk speed from a standstill, and to stop from walk speed (linear accel, no ice). */
  accelTime: number;
  stopTime: number;
  chestHeight: number;
  hipHeight: number;
  eyeHeight: number;
  crouchDrop: number;
  leanAngle: number;
  leanOffset: number;
  /** 0..1.5 scale on all procedural camera motion (accessibility "camera shake"). */
  cameraShake: number;
}

export const DEFAULT_TUNING: PlayerTuning = {
  walkSpeed: 2.2,
  slowSpeed: 1.0,
  sprintSpeed: 5.0,
  crouchSpeed: 1.2,
  accelHalfLife: 0.012,
  accelTime: 0.12,
  stopTime: 0.085,
  chestHeight: 1.36,
  hipHeight: 0.95,
  eyeHeight: 1.66,
  crouchDrop: 0.42,
  leanAngle: 0.38,
  leanOffset: 0.32,
  cameraShake: 0.6,
};

/** Camera presentation settings (PRD §5.1/§5.2 accessibility). */
export const cameraSettings = settings.ns('camera', {
  /** 0..1 "Camera shake" slider. */
  shake: 0.6,
  mount: 'chest' as CameraMount,
  /** Removes roll only. */
  stableHorizon: false,
});

/** Chest cam: on the plate carrier, left of centre, just in front of the plate bag (torso-local). */
export const CHEST_MOUNT = new Vector3(-0.04, 0, -0.16);
/** Helmet side-rail mount, relative to the head pivot, in the look frame. */
const HELMET_MOUNT = new Vector3(0.075, 0.09, -0.06);

/**
 * Body-first player. Input rotates the body (yaw) and torso (pitch) immediately; the chest camera rides the
 * torso through stiff springs (gait bob, turn lag, plate-carrier jiggle, mount knock). The weapon (see
 * WeaponController) chases the torso a beat later — "view first, then gun".
 */
export class Player implements System {
  tuning = { ...DEFAULT_TUNING };
  mount: CameraMount = 'chest';
  stableHorizon = false;
  readonly position = new Vector3(0, 0, 8);
  readonly velocity = new Vector3();
  yaw = Math.PI; // facing -z
  pitch = 0;
  lean = 0; // -1..1 smoothed
  crouch = 0; // 0..1 smoothed
  ready: ReadyPos = 'high';
  aiming = false;
  sprinting = false;
  /** 0..1, raised by sprint/fast fire; lowered by stillness. Read by weapon + audio. No UI. */
  stress = 0;
  surfaceUnderfoot: Surface = 'concrete';
  /** Gait phase in radians: one heel strike every π (L at 0, R at π). */
  gaitPhase = 0;
  /** 0..1 how much the gait is "on" (speed-weighted), for legs and bob. */
  gaitAmount = 0;
  /** Smoothed planar movement direction (world, unit). */
  readonly moveDir = new Vector3(0, 0, -1);
  /** Mount knock (rad): persistent camera offset until the hand fixes it. */
  knockPitch = 0;
  knockRoll = 0;
  /** Secondary plate-carrier spring (m), also swings the placard. */
  readonly carrier = new Spring(3.4, 0.6);

  /** Torso transform the camera, shoulders and weapon hold are attached to (world space). */
  readonly torso = new Object3D();
  /** Pelvis (yaw only): belt, legs. */
  readonly hips = new Object3D();
  /** Upper body (partial look pitch, lean): plate carrier. */
  readonly spine = new Object3D();
  /** Camera mount position in torso space (for the left hand's camera fix). */
  readonly camLocal = new Vector3().copy(CHEST_MOUNT);

  private body!: RAPIER.RigidBody;
  private collider!: RAPIER.Collider;
  private kcc!: RAPIER.KinematicCharacterController;
  private prevPos = new Vector3();
  private renderPos = new Vector3();
  private lastStepSign = 1;
  private camRoll = new Spring(4, 0.75);
  private camPitchJolt = new Spring(CAM_KICK_SPRING.freq, CAM_KICK_SPRING.zeta);
  private camYawLag = new Spring(9, 0.7);
  private camSide = new Spring(5, 0.8);
  /** Rearward chest shove from the stock (m, torso +z): moves the camera and the shoulders together. */
  private camBack = new Spring(5.5, 0.5);
  /** Smoothed planar velocity used for the jerk limit on top of the linear accel. */
  private velCmd = new Vector3();
  private knockFix = 0;
  private lastYaw = this.yaw;
  private grounded = true;
  private vy = 0;
  private wantMove = new Vector3();
  private desired = { x: 0, y: 0, z: 0 };
  private next = { x: 0, y: 0, z: 0 };
  private prevStrafe = 0;
  private joltCooldown = 0;
  private knockCooldown = 0;
  private peakSpeed = 0;
  private crouchToggle = false;
  private rand = rng(4242);
  private invTorso = new Matrix4();
  private tmpE = new Euler(0, 0, 0, 'YXZ');
  private tmpV = new Vector3();
  private tmpV2 = new Vector3();
  private sampleOrigin = new Vector3();
  private readonly down = new Vector3(0, -1, 0);

  constructor(private ctx: Context) {
    const w = ctx.physics.world;
    this.body = w.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(
        this.position.x,
        this.position.y + 0.9,
        this.position.z,
      ),
    );
    // Player capsule lives in collision group 3 so dropped mags (group 2) can ignore it.
    this.collider = w.createCollider(
      RAPIER.ColliderDesc.capsule(0.55, 0.3).setCollisionGroups(PLAYER_GROUPS),
      this.body,
    );
    this.kcc = w.createCharacterController(0.02);
    this.kcc.enableAutostep(0.35, 0.2, true);
    this.kcc.enableSnapToGround(0.3);
    this.kcc.setMaxSlopeClimbAngle((50 * Math.PI) / 180);
    this.kcc.setSlideEnabled(true);
    this.prevPos.copy(this.position);
    this.renderPos.copy(this.position);
  }

  get rigidBody() {
    return this.body;
  }

  /** Planar speed (m/s). */
  get speed() {
    return Math.hypot(this.velocity.x, this.velocity.z);
  }

  /** Interpolated feet position for rendering. */
  get feet(): Vector3 {
    return this.renderPos;
  }

  /** Combined mount-knock magnitude (rad). */
  get knock() {
    return Math.hypot(this.knockPitch, this.knockRoll);
  }

  teleport(p: Vector3, yaw: number) {
    this.position.copy(p);
    this.prevPos.copy(p);
    this.renderPos.copy(p);
    this.velocity.set(0, 0, 0);
    this.velCmd.set(0, 0, 0);
    this.yaw = yaw;
    this.lastYaw = yaw;
    this.pitch = 0;
    this.body.setNextKinematicTranslation({ x: p.x, y: p.y + 0.9, z: p.z });
    this.body.setTranslation({ x: p.x, y: p.y + 0.9, z: p.z }, true);
  }

  addStress(v: number) {
    this.stress = clamp(this.stress + v, 0, 1);
  }

  /** Knock the camera mount crooked (sprint stop, wall bump, door kick): 1–4°. */
  knockMount(strength = 1) {
    if (this.knockCooldown > 0) return;
    this.knockCooldown = 0.8;
    const deg = Math.PI / 180;
    this.knockRoll = clamp(
      this.knockRoll + (this.rand() - 0.5) * 2 * (1 + 3 * strength) * deg,
      -5 * deg,
      5 * deg,
    );
    this.knockPitch = clamp(
      this.knockPitch + (this.rand() - 0.6) * 2 * (0.8 + 2 * strength) * deg,
      -4 * deg,
      4 * deg,
    );
    this.camRoll.impulse((this.rand() - 0.5) * 0.4 * this.tuning.cameraShake);
  }

  /** The hand straightens the mount (called on the `camFix` beat). */
  fixMount() {
    this.knockFix = 1;
  }

  /** Look is applied per render frame for zero-latency aim. */
  update(dt: number, alpha: number) {
    const cs = cameraSettings.get();
    this.tuning.cameraShake = clamp(cs.shake, 0, 1.5);
    this.mount = cs.mount;
    this.stableHorizon = cs.stableHorizon;

    const f = this.ctx.input.frame;
    this.yaw -= f.look.yaw;
    this.pitch = clamp(this.pitch + f.look.pitch + this.applyViewRecoil(dt), -1.45, 1.45);

    const leanTarget =
      clamp((f.down.has('leanRight') ? 1 : 0) - (f.down.has('leanLeft') ? 1 : 0) + f.leanAxis, -1, 1) *
      (this.sprinting ? 0 : 1);
    this.lean += (leanTarget - this.lean) * damp(0.07, dt);
    if (f.pressed.has('crouch')) this.crouchToggle = !this.crouchToggle;
    const crouchTarget = this.crouchToggle ? 1 : 0;
    this.crouch += (crouchTarget - this.crouch) * damp(0.08, dt);

    if (f.pressed.has('readyUp')) this.ready = this.ready === 'low' ? 'high' : 'compressed';
    if (f.pressed.has('readyDown')) this.ready = this.ready === 'compressed' ? 'high' : 'low';
    this.aiming = (f.down.has('aim') || f.aimAxis > 0.3) && !this.sprinting;

    this.renderPos.lerpVectors(this.prevPos, this.position, alpha);
    this.updateCamera(dt);
  }

  fixedUpdate(dt: number) {
    const f = this.ctx.input.frame;
    const t = this.tuning;
    const mag = Math.min(1, Math.hypot(f.move.x, f.move.y));
    const wasSprinting = this.sprinting;
    this.sprinting = f.down.has('sprint') && f.move.y > 0.3 && this.crouch < 0.5;
    const slow = f.down.has('slowWalk');
    let speed = this.sprinting
      ? t.sprintSpeed
      : slow
        ? t.slowSpeed
        : t.walkSpeed + (t.crouchSpeed - t.walkSpeed) * this.crouch;
    if (this.aiming) speed *= 0.75;
    // Analog sticks: light deflection = slow walk.
    speed *= mag < 1 ? 0.35 + 0.65 * mag : 1;

    const sin = Math.sin(this.yaw),
      cos = Math.cos(this.yaw);
    const fx = -sin,
      fz = -cos;
    const rx = cos,
      rz = -sin;
    const len = Math.hypot(f.move.x, f.move.y) || 1;
    this.wantMove.set(
      ((rx * f.move.x + fx * f.move.y) / len) * speed * Math.min(1, mag),
      0,
      ((rz * f.move.x + fz * f.move.y) / len) * speed * Math.min(1, mag),
    );
    // Linear accel / decel (a person, not a camera on a spring): walk speed in `accelTime`, stop from walk in
    // `stopTime`; sprint builds up slower. The commanded velocity moves straight toward the wish velocity, so
    // strafe reversals are planted, then a very short jerk filter rounds the corners.
    const wantLen = Math.hypot(this.wantMove.x, this.wantMove.z);
    const curLen = Math.hypot(this.velCmd.x, this.velCmd.z);
    const braking =
      wantLen < curLen - 1e-3 || this.wantMove.x * this.velCmd.x + this.wantMove.z * this.velCmd.z < 0;
    const accel = braking
      ? t.walkSpeed / t.stopTime
      : (this.sprinting && curLen > t.walkSpeed ? 0.35 : 1) * (t.walkSpeed / t.accelTime);
    const dx = this.wantMove.x - this.velCmd.x,
      dz = this.wantMove.z - this.velCmd.z;
    const dl = Math.hypot(dx, dz);
    const stepV = Math.min(dl, accel * dt);
    if (dl > 1e-6) {
      this.velCmd.x += (dx / dl) * stepV;
      this.velCmd.z += (dz / dl) * stepV;
    }
    const k = damp(t.accelHalfLife, dt);
    this.velocity.x += (this.velCmd.x - this.velocity.x) * k;
    this.velocity.z += (this.velCmd.z - this.velocity.z) * k;

    this.vy = this.grounded ? -1 : this.vy - 9.81 * dt;
    const desired = this.desired;
    desired.x = this.velocity.x * dt;
    desired.y = this.vy * dt;
    desired.z = this.velocity.z * dt;
    this.kcc.computeColliderMovement(this.collider, desired, undefined, KCC_FILTER);
    const m = this.kcc.computedMovement();
    this.grounded = this.kcc.computedGrounded();
    const cur = this.body.translation();
    const next = this.next;
    next.x = cur.x + m.x;
    next.y = cur.y + m.y;
    next.z = cur.z + m.z;
    this.body.setNextKinematicTranslation(next);
    this.prevPos.copy(this.position);
    this.position.set(next.x, next.y - 0.9, next.z);
    if (this.position.y < -20) this.teleport(new Vector3(0, 0, 8), Math.PI);

    const planar = this.speed;
    // Wall bump: moving fast but the controller stopped us → knock the camera mount.
    const want = Math.hypot(desired.x, desired.z);
    const got = Math.hypot(m.x, m.z);
    if (planar > 2.6 && want > 1e-4 && got < want * 0.35) {
      this.knockMount(clamp(planar / 4.6, 0.3, 1));
      this.camPitchJolt.impulse(-0.25 * t.cameraShake);
      this.velocity.multiplyScalar(0.3);
      this.velCmd.multiplyScalar(0.3);
    }
    // Sprint stop: hard deceleration from a sprint jostles the mount.
    this.peakSpeed = Math.max(planar, this.peakSpeed - dt * 3);
    if (wasSprinting && !this.sprinting) this.peakSpeed = Math.max(this.peakSpeed, planar);
    if (this.peakSpeed > 3.8 && planar < 1.2) {
      this.peakSpeed = 0;
      if (this.rand() < 0.7) this.knockMount(0.45);
      this.carrier.impulse(-0.35 * t.cameraShake);
    }
    this.knockCooldown -= dt;

    // Stress: sprinting raises; stillness lowers it (faster when slow-walking / still).
    const still = planar < 0.2;
    this.stress = clamp(
      this.stress + (this.sprinting ? 0.12 : still ? -0.08 : slow ? -0.06 : -0.025) * dt,
      0,
      1,
    );

    // Direction-change jolt: strafe reversal is the classic bodycam footage tell.
    const strafe = this.velocity.x * rx + this.velocity.z * rz;
    this.joltCooldown -= dt;
    if (
      this.joltCooldown <= 0 &&
      Math.sign(strafe) !== Math.sign(this.prevStrafe) &&
      Math.abs(this.prevStrafe) > 0.9
    ) {
      this.joltCooldown = 0.25;
      const s = Math.sign(this.prevStrafe) * t.cameraShake;
      this.camSide.impulse(s * 0.05);
      this.camRoll.impulse(s * 0.06);
      this.carrier.impulse(-0.06 * t.cameraShake);
    }
    if (Math.abs(strafe) > 0.05 || Math.abs(this.prevStrafe) > 0.9) this.prevStrafe = strafe;

    // Gait: stride shortens (cadence rises) with stress; heel strikes drive footsteps + bob.
    // Stride (two steps) lengthens with speed: ~1.6 steps/s slow-walking, ~2.6 walking, ~3.8 sprinting.
    const stride = clamp(0.9 + 0.35 * planar, 1.1, 2.7) * (1 - this.stress * 0.15);
    this.gaitPhase += (planar / stride) * dt * Math.PI * 2;
    this.gaitAmount += (clamp(planar / 1.2, 0, 1) - this.gaitAmount) * damp(0.12, dt);
    if (planar > 0.3) {
      this.tmpV.set(this.velocity.x, 0, this.velocity.z).normalize();
      this.moveDir.lerp(this.tmpV, damp(0.08, dt)).normalize();
    }
    const s = Math.sign(Math.sin(this.gaitPhase));
    if (planar > 0.25 && s !== this.lastStepSign) {
      this.lastStepSign = s;
      const scuff = clamp(
        Math.hypot(this.velocity.x - this.wantMove.x, this.velocity.z - this.wantMove.z) / 3,
        0,
        1,
      );
      this.ctx.bus.emit('footstep', {
        point: this.position.clone(),
        surface: this.surfaceUnderfoot,
        foot: s > 0 ? 'L' : 'R',
        speed: planar,
        scuff,
      });
      // Heel strike: a small dip through the body (the plate carrier settles a touch later).
      this.camPitchJolt.impulse(-(0.006 + planar * 0.004) * t.cameraShake);
      this.carrier.impulse(-(0.01 + planar * 0.008) * t.cameraShake);
    }
    this.sampleSurface();
  }

  private sampleSurface() {
    this.sampleOrigin.set(this.position.x, this.position.y + 0.2, this.position.z);
    const hit = this.ctx.physics.raycast(this.sampleOrigin, this.down, 0.6, this.body);
    if (hit) this.surfaceUnderfoot = hit.tag.surface;
  }

  /**
   * Recoil / impact impulse into the body-mounted camera: pitch (+ = up), yaw, roll (rad/s) and a rearward
   * chest shove (m/s). Recoil is normalised to the default camera-shake setting and never drops below 35%.
   */
  /**
   * Recoil that moves where you are *looking* (muzzle rise the shooter must pull back down), unlike `kick`,
   * which only shakes the chest camera. Each shot's rise is fed in over ~45 ms; when the string ends, part of
   * it (`recover`) drifts back on its own, like a shooter's natural return to the point of aim.
   */
  viewRecoil(pitch: number, yaw: number, recover = 0.55) {
    this.vrPending.p += pitch;
    this.vrPending.y += yaw;
    this.vrDebt.p += pitch * recover;
    this.vrDebt.y += yaw * recover;
    this.vrSince = 0;
  }

  private vrPending = { p: 0, y: 0 };
  private vrDebt = { p: 0, y: 0 };
  private vrSince = 10;

  /** Returns this frame's pitch delta from view recoil; also applies the yaw part directly. */
  private applyViewRecoil(dt: number): number {
    const k = damp(0.015, dt);
    let dp = this.vrPending.p * k;
    const dy = this.vrPending.y * k;
    this.vrPending.p -= dp;
    this.vrPending.y -= dy;
    this.vrSince += dt;
    let ry = 0;
    if (this.vrSince > 0.12) {
      const r = damp(0.12, dt);
      const rp = this.vrDebt.p * r;
      ry = this.vrDebt.y * r;
      this.vrDebt.p -= rp;
      this.vrDebt.y -= ry;
      dp -= rp;
    }
    this.yaw -= dy - ry;
    return dp;
  }

  kick(pitch: number, yaw: number, roll: number, shove = 0) {
    const s = clamp(this.tuning.cameraShake / DEFAULT_TUNING.cameraShake, 0.35, 1.5);
    this.camPitchJolt.impulse(pitch * s);
    this.camYawLag.impulse(yaw * s);
    this.camRoll.impulse(roll * s);
    this.camBack.impulse(shove * s);
    this.carrier.impulse(-shove * 0.4 * s);
  }

  private updateCamera(dt: number) {
    const t = this.tuning;
    const cam = this.ctx.camera;
    const shake = t.cameraShake;
    const planar = this.speed;
    const yawRate = (this.yaw - this.lastYaw) / Math.max(dt, 1e-4);
    this.lastYaw = this.yaw;
    const helmet = this.mount === 'helmet';

    // Rig springs: turn lag/overshoot on the chest + roll into turns.
    this.camYawLag.step(clamp(-yawRate * 0.003, -0.03, 0.03) * shake, dt);
    this.camRoll.step(clamp(yawRate * 0.0015, -0.012, 0.012) * shake, dt);
    this.camPitchJolt.step(0, dt);
    this.carrier.step(0, dt);
    this.camBack.step(0, dt);
    const rightX = Math.cos(this.yaw),
      rightZ = -Math.sin(this.yaw);
    const strafe = this.velocity.x * rightX + this.velocity.z * rightZ;
    this.camSide.step(-strafe * 0.004 * shake, dt);

    // Mount knock relaxes only when the hand fixes it.
    if (this.knockFix > 0) {
      const k = damp(0.07, dt);
      this.knockPitch -= this.knockPitch * k;
      this.knockRoll -= this.knockRoll * k;
      this.knockFix -= dt * 2;
    }

    // Gait-synced bob: vertical double bounce per stride, lateral sway per step, slight roll.
    const g = this.gaitAmount;
    const ph = this.gaitPhase;
    // Subtle on the chest (most of the gait shows on the weapon, see WeaponController): ~1 cm at walk.
    const bobAmp = (0.004 + planar * 0.0026) * shake * (helmet ? 1.6 : 1);
    const bobY = -(1 - Math.abs(Math.sin(ph))) * bobAmp * g;
    const swayX = Math.sin(ph) * (0.002 + planar * 0.0009) * shake * g;
    const gaitRoll = Math.sin(ph) * 0.0022 * shake * g;
    const time = this.ctx.time;
    const breathe = Math.sin(time * 1.6 * (1 + this.stress * 0.6)) * 0.003 * shake * (1 + this.stress * 2);

    // Pelvis: yaw only, crouch drops it, lean shifts it a little.
    const crouchY = -t.crouchDrop * this.crouch;
    const leanOffset = this.lean * t.leanOffset;
    this.hips.position.set(
      this.renderPos.x + rightX * leanOffset * 0.3,
      this.renderPos.y + t.hipHeight + crouchY + bobY * 0.6,
      this.renderPos.z + rightZ * leanOffset * 0.3,
    );
    this.tmpE.set(0, this.yaw, 0);
    this.hips.quaternion.setFromEuler(this.tmpE);
    this.hips.updateMatrixWorld();

    // Spine pivots over the hips: bends forward when looking down (so the chest cam sees boots and pouches),
    // lean rolls and shifts it sideways. The plate carrier rides the spine.
    const spinePitch = this.pitch < 0 ? this.pitch * 0.3 : this.pitch * 0.08;
    const spineLen = t.chestHeight - t.hipHeight;
    const leanRoll = -this.lean * t.leanAngle;
    this.tmpE.set(spinePitch, this.yaw, leanRoll);
    this.spine.quaternion.setFromEuler(this.tmpE);
    this.tmpV.set(0, spineLen, 0).applyQuaternion(this.spine.quaternion);
    this.spine.position.copy(this.hips.position).add(this.tmpV);
    // Looking well down you lean out over your boots.
    const over = Math.max(0, -this.pitch - 0.6) * 0.16;
    this.spine.position.x += rightX * leanOffset * 0.7 - Math.sin(this.yaw) * over;
    this.spine.position.z += rightZ * leanOffset * 0.7 - Math.cos(this.yaw) * over;
    this.spine.position.y += breathe - bobY * 0.4 - Math.abs(this.lean) * 0.04;
    this.spine.updateMatrixWorld();

    // The chest cam sits on the carrier (spine) but points with the full look pitch — the camera is the POV.
    // Torso = the look frame pivoting about the chest mount: shoulders and the weapon hold live here, so the
    // gun keeps its place in the frame while the camera is rock-solid on the body.
    this.tmpV2.set(
      CHEST_MOUNT.x + this.camSide.value + swayX,
      CHEST_MOUNT.y + bobY * 0.4 + this.carrier.value * 0.03,
      CHEST_MOUNT.z + this.camBack.value,
    );
    this.tmpV2.applyMatrix4(this.spine.matrixWorld);
    this.tmpE.set(this.pitch, this.yaw, leanRoll);
    this.torso.quaternion.setFromEuler(this.tmpE);
    this.tmpV.copy(CHEST_MOUNT).applyQuaternion(this.torso.quaternion);
    this.torso.position.copy(this.tmpV2).sub(this.tmpV);
    this.torso.updateMatrixWorld();

    if (helmet) {
      // Helmet: side-rail mount at the head, follows the look; bigger bob.
      this.tmpV.copy(HELMET_MOUNT).applyQuaternion(this.torso.quaternion);
      this.tmpV2
        .set(0, 0.24 + bobY * 0.3, -0.02)
        .applyMatrix4(this.spine.matrixWorld)
        .add(this.tmpV);
    }
    cam.position.copy(this.tmpV2);
    // Camera position in torso space (the left hand reaches here to fix the mount).
    this.invTorso.copy(this.torso.matrixWorld).invert();
    this.camLocal.copy(cam.position).applyMatrix4(this.invTorso);

    const jitter = noise1(time * 7.3, 3) * 0.0008 * shake * (1 + this.stress * 3);
    const roll = this.stableHorizon ? 0 : leanRoll + this.camRoll.value + gaitRoll + this.knockRoll;
    this.tmpE.set(
      this.pitch + this.camPitchJolt.value + jitter + this.carrier.value * 0.04 + this.knockPitch,
      this.yaw + this.camYawLag.value,
      roll,
    );
    cam.quaternion.setFromEuler(this.tmpE);
    cam.updateMatrixWorld();
  }
}

/** Rapier collision groups: membership in the high 16 bits, filter in the low 16. */
export const GROUP_PLAYER = 0x0004;
export const GROUP_DEBRIS = 0x0002;
const PLAYER_GROUPS = (GROUP_PLAYER << 16) | 0xffff;
/** The character controller walks through dropped mags instead of climbing them. */
const KCC_FILTER = (0xffff << 16) | (0xffff & ~GROUP_DEBRIS);
