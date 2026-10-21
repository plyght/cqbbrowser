import { Euler, Matrix4, Object3D, Vector3 } from 'three';
import type { Context, System } from '../core/Context';
import { Spring, clamp, damp, noise1, rng } from '../core/math';
import { RAPIER } from '../physics/Physics';
import type { Surface } from '../core/bus';
import { settings } from '../settings/Settings';
import { CAM_KICK_SPRING } from '../anim/handling/characterise';
import { GaitMotion, STABLE_ROLL, StepSmoother, stepCadence, type GaitFrame, type GaitScales } from './gait';

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
  /** The support hand straightens a knocked mount at the next idle moment (manual fix-cam always works). */
  autoFixCam: true,
  /** 0..1.5 "Movement sway": gait bob, weight shift, bumps and the gun's swing (1 = tuned). */
  movementSway: 1,
  /** Faint centre dot while aiming down sights on the helmet cam (the camera looks past the optic, not through it). */
  helmetAimDot: true,
});

/** Chest cam: on the plate carrier, left of centre, just in front of the plate bag (torso-local). */
export const CHEST_MOUNT = new Vector3(-0.04, 0, -0.16);
/** Helmet side-rail mount, relative to the head pivot, in the look frame. */
const HELMET_MOUNT = new Vector3(0.075, 0.09, -0.06);
const X_AXIS = new Vector3(1, 0, 0);
/** Head pivot relative to the chest mount, torso frame (m): the spine point the helmet rides over, 0.24 up. */
const HEAD_FROM_CHEST = new Vector3(0.04, 0.24, 0.14);

/**
 * Helmet cam tuning. The helmet cam never looks through the optic: it stays on the helmet and the GUN rises to the
 * eye line (a real action cam sees the optic and the back of the gun from above and beside the eye).
 */
export const HELMET = {
  /**
   * Helmet cams are angled down on their rail (rad): level with the eyes the rifle at high ready sat below the image
   * circle and only its front sight showed.
   */
  tilt: 0.12,
  /** Ready hold raised and pushed out in the frame (torso frame, m, added to the hold): muzzle and optic ~15-30% up. */
  hold: new Vector3(0, 0.06, -0.1),
  /**
   * At full ADS, the sight's eye point relative to the camera (lens frame, m): a few cm below and beside the lens
   * and level with it front to back, so the optic and the back of the gun sit in the lower part of the picture.
   * The sight axis meets the lens axis at the aim point, so the lens's own centre is where the bore converges.
   */
  eye: new Vector3(-0.02, -0.06, -0.16),
  /** Head tuck toward the sight at full ADS (m, sideways). */
  tuck: 0.03,
  /** The helmet lens narrows by at most this much at ADS (deg of vertical FOV): never a scope-like zoom. */
  fovNarrow: 4,
};

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
  /** Gait-driven body / mount motion (see `gait.ts`) and the 0..1 ADS blend the weapon controller reports. */
  readonly gait = new GaitMotion();
  adsBlend = 0;
  /** "Weapon inertia" master mirrored by the weapon controller (scales the hands' own gait swing). */
  weaponInertia = 1;
  /** Movement sway (0..1.5), camera shake relative to default and stable horizon, as the camera last used them. */
  sway = 1;

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
  /** Eased knock actually shown (the knock itself is a target: it never pops the view). */
  private knockPitchS = 0;
  private knockRollS = 0;
  private lastYaw = this.yaw;
  private yawRateS = 0;
  private yawAccelS = 0;
  private readonly stepSmooth = new StepSmoother();
  /** Fixed-step gait state kept for render-rate interpolation. */
  private prevGaitPhase = 0;
  private prevSpeed = 0;
  private accelFwd = 0;
  private accelRight = 0;
  private prevVx = 0;
  private prevVz = 0;
  /** Shoulder-brush state per side (-1 left, +1 right): in contact now, and the cooldown. */
  private brush = [false, false];
  private brushCooldown = 0;
  private brushing = 0;
  /** Camera pulled back from walls (m) and the matching direction-smoothing. */
  private camClear = 0;
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
  private renderSpeed = 0;
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
    this.renderSpeed = this.prevSpeed = 0;
    this.gait.reset();
    this.stepSmooth.offset = 0;
    this.camClear = 0;
    this.prevVx = this.prevVz = this.accelFwd = this.accelRight = 0;
    this.yawRateS = this.yawAccelS = 0;
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

  /** Helmet tuning (tests and tooling adjust it live). */
  readonly helmet = HELMET;
  /**
   * Helmet cam: where the sight's eye point goes at full ADS (torso frame, m): up at the eye line, below, beside and
   * behind the lens. The weapon controller shifts the ADS hold to put the sight's eye point there.
   */
  helmetEyeTarget(out: Vector3): Vector3 {
    // The eye offset is in the lens frame, which is the torso frame nodded down by the rail tilt.
    out.copy(HELMET.eye).applyAxisAngle(X_AXIS, -HELMET.tilt);
    return out.set(
      CHEST_MOUNT.x + HEAD_FROM_CHEST.x + HELMET_MOUNT.x - HELMET.tuck + out.x,
      CHEST_MOUNT.y + HEAD_FROM_CHEST.y + HELMET_MOUNT.y + out.y,
      CHEST_MOUNT.z + HEAD_FROM_CHEST.z + HELMET_MOUNT.z + out.z,
    );
  }

  /** Look is applied per render frame for zero-latency aim. */
  update(dt: number, alpha: number) {
    const cs = cameraSettings.get();
    this.tuning.cameraShake = clamp(cs.shake, 0, 1.5);
    this.mount = cs.mount;
    this.stableHorizon = cs.stableHorizon;
    this.sway = clamp(cs.movementSway, 0, 1.5);

    const f = this.ctx.input.frame;
    this.yaw -= f.look.yaw;
    this.pitch = clamp(this.pitch + f.look.pitch + this.applyViewRecoil(dt), -1.45, 1.45);

    let leanTarget =
      clamp((f.down.has('leanRight') ? 1 : 0) - (f.down.has('leanLeft') ? 1 : 0) + f.leanAxis, -1, 1) *
      (this.sprinting ? 0 : 1);
    leanTarget *= this.leanRoom(Math.sign(leanTarget || this.lean));
    this.lean += (leanTarget - this.lean) * damp(0.07, dt);
    if (f.pressed.has('crouch')) this.crouchToggle = !this.crouchToggle;
    const crouchTarget = this.crouchToggle ? 1 : 0;
    this.crouch += (crouchTarget - this.crouch) * damp(0.08, dt);

    if (f.pressed.has('readyUp')) this.ready = this.ready === 'low' ? 'high' : 'compressed';
    if (f.pressed.has('readyDown')) this.ready = this.ready === 'compressed' ? 'high' : 'low';
    this.aiming = (f.down.has('aim') || f.aimAxis > 0.3) && !this.sprinting;

    this.renderPos.lerpVectors(this.prevPos, this.position, alpha);
    this.updateCamera(dt, alpha);
  }

  /**
   * How much of a full lean fits toward `side` (-1 left, +1 right) before the chest cam would reach the wall:
   * a full lean carries the camera ~0.47 m sideways, and leaning into a wall used to put it through the wall.
   */
  private leanRoom(side: number): number {
    if (!side) return 1;
    const o = this.sampleOrigin.set(
      this.position.x,
      this.position.y + this.tuning.chestHeight - this.tuning.crouchDrop * this.crouch,
      this.position.z,
    );
    const dir = this.tmpV2.set(Math.cos(this.yaw) * side, 0, -Math.sin(this.yaw) * side);
    const hit = this.ctx.physics.raycast(o, dir, LEAN_REACH + LEAN_MARGIN, this.body);
    return hit ? clamp((hit.distance - LEAN_MARGIN) / LEAN_REACH, 0, 1) : 1;
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
    const wasGrounded = this.grounded;
    this.grounded = this.kcc.computedGrounded();
    if (this.grounded && !wasGrounded && this.vy < -2) {
      this.ctx.bus.emit('land', { speed: -this.vy });
      this.gait.land(-this.vy);
      this.ctx.bus.emit('bodyBump', { kind: 'land', side: 0, strength: clamp(-this.vy / 6, 0.2, 1) });
    }
    const cur = this.body.translation();
    const next = this.next;
    next.x = cur.x + m.x;
    next.y = cur.y + m.y;
    next.z = cur.z + m.z;
    this.body.setNextKinematicTranslation(next);
    this.prevPos.copy(this.position);
    this.position.set(next.x, next.y - 0.9, next.z);
    if (this.position.y < -20) this.teleport(new Vector3(0, 0, 8), Math.PI);
    // Stairs and lips: the capsule steps up in one tick; the camera climbs through it and stumbles a little.
    if (this.grounded && wasGrounded) {
      const stumble = this.stepSmooth.push(this.position.y - this.prevPos.y);
      if (stumble > 0 && planarNow(this.velocity) > 0.5) {
        this.gait.stumble(stumble);
        this.ctx.bus.emit('bodyBump', { kind: 'step', side: 0, strength: stumble });
      }
    }
    // Acceleration along / across the facing, smoothed (~50 ms): lean in, lean back, strafe jerk.
    {
      const ax = (this.velocity.x - this.prevVx) / dt,
        az = (this.velocity.z - this.prevVz) / dt;
      this.prevVx = this.velocity.x;
      this.prevVz = this.velocity.z;
      const af = clamp(-Math.sin(this.yaw) * ax - Math.cos(this.yaw) * az, -45, 45);
      const ar = clamp(Math.cos(this.yaw) * ax - Math.sin(this.yaw) * az, -45, 45);
      const k = damp(0.035, dt);
      this.accelFwd += (af - this.accelFwd) * k;
      this.accelRight += (ar - this.accelRight) * k;
    }

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

    // Gait: the step-phase oscillator runs at the cadence of the real speed (walk ~1.9 steps/s, sprint ~2.8,
    // crouch-walk slower); one heel strike every π. Render frames interpolate between fixed steps.
    this.prevGaitPhase = this.gaitPhase;
    this.prevSpeed = this.renderSpeed;
    this.renderSpeed = planar;
    this.gaitPhase += Math.PI * stepCadence(planar, this.crouch, this.stress) * dt;
    const gaitOn = this.grounded && planar > 0.15 ? clamp(planar / 1.2, 0, 1) : 0;
    this.gaitAmount += (gaitOn - this.gaitAmount) * damp(0.12, dt);
    if (planar > 0.3) {
      this.tmpV.set(this.velocity.x, 0, this.velocity.z).normalize();
      this.moveDir.lerp(this.tmpV, damp(0.08, dt)).normalize();
    }
    this.brushCooldown -= dt;
    this.probeWalls(planar);
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
      // Heel strike: a dip through the body, a short buzz in the mount, the carrier settles a touch later.
      this.gait.strike(s > 0 ? 'L' : 'R', planar, this.crouch);
      this.carrier.impulse(-(0.01 + planar * 0.008) * t.cameraShake);
      // Rubbing along a wall: the shoulder catches on every other step.
      if (this.brushing && this.brushCooldown <= 0 && planar > 1.2) this.shoulderBump(this.brushing, 0.35);
    }
    this.sampleSurface();
  }

  /**
   * Shoulder brush: probe sideways at chest height; a wall within arm's reach of the capsule while moving along
   * it bumps the shoulder (camera rolls away, the gun is nudged) on contact, then lightly on the steps after.
   */
  private probeWalls(planar: number) {
    if (planar < 1.0) {
      this.brush[0] = this.brush[1] = false;
      this.brushing = 0;
      return;
    }
    const o = this.sampleOrigin.set(this.position.x, this.position.y + 1.1, this.position.z);
    this.brushing = 0;
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? -1 : 1;
      const dir = this.tmpV2.set(Math.cos(this.yaw) * side, 0, -Math.sin(this.yaw) * side);
      const hit = this.ctx.physics.raycast(o, dir, BRUSH_REACH, this.body);
      // Wall running alongside: little velocity into it (not a head-on, which has its own knock).
      const into = hit ? Math.abs(this.velocity.x * dir.x + this.velocity.z * dir.z) : 0;
      const touching = !!hit && hit.distance < BRUSH_DIST && into < planar * 0.6;
      if (touching) this.brushing = side;
      if (touching && !this.brush[i] && this.brushCooldown <= 0)
        this.shoulderBump(side, clamp(planar / 4, 0.3, 1));
      this.brush[i] = touching;
    }
  }

  private shoulderBump(side: number, strength: number) {
    this.brushCooldown = 0.4;
    this.gait.bump(side, strength);
    this.ctx.bus.emit('bodyBump', { kind: 'wall', side, strength });
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

  private readonly gaitFrame: GaitFrame = {
    phase: 0,
    speed: 0,
    amount: 0,
    accelFwd: 0,
    strafe: 0,
    yawRate: 0,
    yawAccel: 0,
    crouch: 0,
    stress: 0,
    ads: 0,
    grounded: true,
  };
  private readonly gaitScales: GaitScales = { sway: 1, shake: 1, stable: false, inertia: 1 };

  private updateCamera(dt: number, alpha: number) {
    const t = this.tuning;
    const cam = this.ctx.camera;
    const shake = t.cameraShake;
    const helmet = this.mount === 'helmet';
    const stable = this.stableHorizon;
    const sway = this.sway;

    // Turn rate and acceleration, smoothed (~30 ms): mouse deltas arrive in bursts, and the raw per-frame rate
    // used to kick the lag springs at every report (visible jitter on slow turns).
    const rawRate = (this.yaw - this.lastYaw) / Math.max(dt, 1e-4);
    this.lastYaw = this.yaw;
    const prevRate = this.yawRateS;
    this.yawRateS += (clamp(rawRate, -25, 25) - prevRate) * damp(0.03, dt);
    this.yawAccelS += ((this.yawRateS - prevRate) / Math.max(dt, 1e-4) - this.yawAccelS) * damp(0.03, dt);
    const yawRate = this.yawRateS;

    // Rig springs: turn lag/overshoot on the chest + roll into turns.
    this.camYawLag.step(clamp(-yawRate * 0.003, -0.03, 0.03) * shake * sway, dt);
    this.camRoll.step(clamp(yawRate * 0.0015, -0.012, 0.012) * shake * sway, dt);
    this.camPitchJolt.step(0, dt);
    this.carrier.step(0, dt);
    this.camBack.step(0, dt);
    const rightX = Math.cos(this.yaw),
      rightZ = -Math.sin(this.yaw);
    const strafe = this.velocity.x * rightX + this.velocity.z * rightZ;
    this.camSide.step(-strafe * 0.004 * shake * sway, dt);

    // Mount knock: the knock is a target that relaxes only when the hand fixes it; the view eases toward it.
    if (this.knockFix > 0) {
      const k = damp(0.07, dt);
      this.knockPitch -= this.knockPitch * k;
      this.knockRoll -= this.knockRoll * k;
      this.knockFix -= dt * 2;
    }
    const kk = damp(0.035, dt);
    this.knockPitchS += (this.knockPitch - this.knockPitchS) * kk;
    this.knockRollS += (this.knockRoll - this.knockRollS) * kk;

    // Gait (see gait.ts): bob, weight shift, counter-rotation, accel lean, strafe roll, mount buzz, bumps.
    const gf = this.gaitFrame;
    gf.phase = this.prevGaitPhase + (this.gaitPhase - this.prevGaitPhase) * alpha;
    gf.speed = this.prevSpeed + (this.renderSpeed - this.prevSpeed) * alpha;
    gf.amount = this.gaitAmount;
    gf.accelFwd = this.accelFwd;
    gf.strafe = strafe;
    gf.yawRate = yawRate;
    gf.yawAccel = this.yawAccelS;
    gf.crouch = this.crouch;
    gf.stress = this.stress;
    gf.ads = this.adsBlend;
    gf.grounded = this.grounded;
    const gs = this.gaitScales;
    gs.sway = sway;
    gs.shake = shake / DEFAULT_TUNING.cameraShake;
    gs.stable = stable;
    gs.inertia = this.weaponInertia;
    const g = this.gait.update(dt, gf, gs);
    // A helmet rides the head: the neck keeps it level, but it nods and yaws more than the chest.
    const hAtt = helmet ? 1.4 : 1;
    const hRoll = helmet ? 0.6 : 1;
    const hPos = helmet ? 1.2 : 1;

    const time = this.ctx.time;
    const breathe = Math.sin(time * 1.6 * (1 + this.stress * 0.6)) * 0.003 * shake * (1 + this.stress * 2);

    // Pelvis: yaw only, crouch drops it, lean shifts it a little, stairs ease the capsule's step-ups.
    this.stepSmooth.update(dt);
    const crouchY = -t.crouchDrop * this.crouch + this.stepSmooth.offset;
    const leanOffset = this.lean * t.leanOffset;
    this.hips.position.set(
      this.renderPos.x + rightX * leanOffset * 0.3,
      this.renderPos.y + t.hipHeight + crouchY + g.y * 0.5,
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
    this.spine.position.y += breathe - Math.abs(this.lean) * 0.04;
    this.spine.updateMatrixWorld();

    // The chest cam sits on the carrier (spine) but points with the full look pitch — the camera is the POV.
    // Torso = the look frame pivoting about the chest mount: shoulders and the weapon hold live here, so the
    // gun keeps its place in the frame while the camera is rock-solid on the body.
    this.tmpV2.set(
      CHEST_MOUNT.x + this.camSide.value + g.x,
      CHEST_MOUNT.y + g.y * 0.5 + this.carrier.value * 0.03,
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
      this.tmpV.copy(HELMET_MOUNT);
      this.tmpV.x -= HELMET.tuck * this.adsBlend;
      this.tmpV.applyQuaternion(this.torso.quaternion);
      this.tmpV2
        .set(g.x * 0.6, 0.24 + g.y * 0.5 * hPos, -0.02)
        .applyMatrix4(this.spine.matrixWorld)
        .add(this.tmpV);
    }
    cam.position.copy(this.tmpV2);
    this.clearWalls(dt);
    // Camera position in torso space (the left hand reaches here to fix the mount).
    this.invTorso.copy(this.torso.matrixWorld).invert();
    this.camLocal.copy(cam.position).applyMatrix4(this.invTorso);

    // Rest jitter fades out when standing still: a camera on a still body is still.
    const jitter =
      noise1(time * 7.3, 3) * 0.0008 * shake * (1 + this.stress * 3) * (0.25 + 0.75 * this.gaitAmount);
    const rollRaw = leanRoll + this.camRoll.value + this.knockRollS;
    const roll = (stable ? rollRaw * STABLE_ROLL : rollRaw) + g.roll * hRoll;
    this.tmpE.set(
      this.pitch +
        this.camPitchJolt.value +
        jitter +
        this.carrier.value * 0.04 +
        this.knockPitchS +
        g.pitch * hAtt -
        (helmet ? HELMET.tilt : 0),
      this.yaw + this.camYawLag.value + g.yaw * hAtt,
      roll,
    );
    cam.quaternion.setFromEuler(this.tmpE);
    cam.updateMatrixWorld();
  }

  /**
   * Keep the camera (and the torso frame the gun hangs from) out of walls, doors and frames: probe from the capsule
   * axis at camera height out to the camera plus a margin and pull everything back by what is missing. Quick in,
   * slow out, so brushing a surface never flickers the picture.
   */
  private clearWalls(dt: number) {
    const cam = this.ctx.camera.position;
    // From the capsule axis (the spine itself leans out over the boots when looking down).
    const pivot = this.tmpV.set(this.renderPos.x, cam.y, this.renderPos.z);
    const dir = this.tmpV2.subVectors(cam, pivot);
    const len = dir.length();
    if (len < 1e-3) return;
    dir.divideScalar(len);
    const hit = this.ctx.physics.raycast(pivot, dir, len + CAM_WALL_MARGIN, this.body);
    const want = hit ? clamp(len + CAM_WALL_MARGIN - hit.distance, 0, len * 0.9) : 0;
    this.camClear += (want - this.camClear) * damp(want > this.camClear ? 0.015 : 0.09, dt);
    if (this.camClear < 1e-4) return;
    dir.multiplyScalar(-this.camClear);
    cam.add(dir);
    this.torso.position.add(dir);
    this.torso.updateMatrixWorld();
  }
}

/** Rapier collision groups: membership in the high 16 bits, filter in the low 16. */
export const GROUP_PLAYER = 0x0004;
export const GROUP_DEBRIS = 0x0002;
/** Sideways travel of the chest cam at full lean (offset + roll over the spine), and the gap kept to walls (m). */
const LEAN_REACH = 0.47;
const LEAN_MARGIN = 0.22;
const PLAYER_GROUPS = (GROUP_PLAYER << 16) | 0xffff;
/** The character controller walks through dropped mags instead of climbing them. */
const KCC_FILTER = (0xffff << 16) | (0xffff & ~GROUP_DEBRIS);

const planarNow = (v: Vector3) => Math.hypot(v.x, v.z);
/** Shoulder-brush probe: reach (m) and the ray length at which the capsule (r 0.3) touches the wall. */
const BRUSH_REACH = 0.6;
const BRUSH_DIST = 0.37;
/** Camera keeps this far (m) from any surface between it and the torso axis; the near plane is 0.03. */
const CAM_WALL_MARGIN = 0.1;
