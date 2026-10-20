import { Spring, clamp, damp, rng } from '../core/math';

/**
 * Gait-driven body motion for the chest cam and the carried weapon (PRD §5.2, §6.3).
 *
 * One step-phase oscillator (`Player.gaitPhase`, a heel strike every π, L at 0 and R at π) is tied to the real
 * planar speed. Everything here is a function of that phase, the measured speed/acceleration and a few
 * second-order springs (the body's compliance, the mount on the plate carrier), so a stop, a start or a
 * stumble never snaps: every output is continuous and every impact is a velocity impulse into a spring.
 *
 * Pure (no three.js, no DOM): unit-tested in `gait.test.ts`, driven by `Player` and read by `WeaponController`.
 */

/** Planar speed samples (m/s) for the tables below: standstill, creep, slow walk, walk, jog, sprint. */
const SPEEDS = [0, 0.4, 1.0, 2.2, 3.6, 5.0];
/** Steps per second (one step = one heel strike). Walk ≈ 1.9, sprint ≈ 2.8. */
const CADENCE = [1.0, 1.25, 1.55, 1.9, 2.4, 2.8];
/** Chest vertical bob, peak to peak (m): 2–4 cm walking, 5–8 cm sprinting. */
const BOB_PP = [0, 0.004, 0.015, 0.027, 0.046, 0.062];
/** Lateral weight shift amplitude (m): alternating, 1–2 cm peak to peak at a walk. */
const SHIFT = [0, 0.002, 0.005, 0.0072, 0.0095, 0.011];
/** Torso yaw counter-rotation amplitude (rad) and roll amplitude (rad). */
const TWIST = [0, 0.002, 0.005, 0.011, 0.02, 0.03];
const ROLL = [0, 0.002, 0.004, 0.008, 0.013, 0.018];
/** Step nod (pitch), peak to peak (rad). */
const NOD_PP = [0, 0.0015, 0.004, 0.01, 0.02, 0.03];
/** The hands' own swing on the weapon (hold space), on top of what the carrying torso hands over. */
const GUN_Y_PP = [0, 0.004, 0.011, 0.02, 0.034, 0.046];
const GUN_X = [0, 0.001, 0.003, 0.006, 0.011, 0.018];
const GUN_PITCH = [0, 0.002, 0.006, 0.014, 0.028, 0.05];
const GUN_ROLL = [0, 0.002, 0.006, 0.013, 0.026, 0.05];

/** Piecewise-linear lookup, clamped at both ends. */
export function table(ys: readonly number[], speed: number): number {
  if (speed <= SPEEDS[0]) return ys[0];
  for (let i = 1; i < SPEEDS.length; i++) {
    if (speed <= SPEEDS[i]) {
      const u = (speed - SPEEDS[i - 1]) / (SPEEDS[i] - SPEEDS[i - 1]);
      return ys[i - 1] + (ys[i] - ys[i - 1]) * u;
    }
  }
  return ys[ys.length - 1];
}

/** Steps per second for a planar speed: the oscillator's rate is `π · stepCadence` rad/s. */
export function stepCadence(speed: number, crouch = 0, stress = 0): number {
  return table(CADENCE, speed) * (1 - 0.12 * crouch) * (1 + 0.05 * stress);
}

/** Crouch-walking is smaller (and slower, see `stepCadence`). */
const crouchScale = (crouch: number) => 1 - 0.4 * crouch;

/** Vertical waveform with the dip at the heel strike: zero mean, unit peak to peak, θ = 2·phase. */
const U_MEAN = 0.4244; // mean of ((1 + cos θ) / 2)^1.5
function dip(theta: number): number {
  const u = (1 + Math.cos(theta)) / 2;
  return u * Math.sqrt(u) - U_MEAN;
}

export interface GaitFrame {
  /** Gait phase (rad), already interpolated between fixed steps. */
  phase: number;
  /** Planar speed (m/s) and the 0..1 "gait is on" weight. */
  speed: number;
  amount: number;
  /** Planar acceleration along the facing / to the right (m/s², smoothed). */
  accelFwd: number;
  strafe: number;
  /** Smoothed yaw rate (rad/s, + = turning left) and yaw acceleration (rad/s²). */
  yawRate: number;
  yawAccel: number;
  crouch: number;
  stress: number;
  /** 0..1 ADS blend. */
  ads: number;
  grounded: boolean;
}

export interface GaitScales {
  /** "Movement sway" setting, 0..1.5 (1 = tuned). Scales every gait/bump motion on body, camera and gun. */
  sway: number;
  /** "Camera shake" relative to the tuned default (1 = default, 0 = off). Scales what reaches the camera. */
  shake: number;
  /** "Stable horizon": roll is damped to a sliver. */
  stable: boolean;
  /** "Weapon inertia" master (0 = gun locked to the hands, 1 = nominal, 1.5 = heavy). */
  inertia: number;
}

/** What the gait adds, in the torso's frame (m, rad). Pitch + = up, yaw + = left, roll + = tilt left. */
export interface GaitOut {
  /** Body: moves the chest mount and everything carried on the torso (the gun follows through the sim). */
  y: number;
  x: number;
  /** Camera only (the mount on the plate carrier): pitch, yaw, roll. */
  pitch: number;
  yaw: number;
  roll: number;
  /** The hands' own swing, added to the weapon hold (hold space), out of phase with the camera. */
  gunX: number;
  gunY: number;
  gunPitch: number;
  gunYaw: number;
  gunRoll: number;
}

export function emptyGaitOut(): GaitOut {
  return { y: 0, x: 0, pitch: 0, yaw: 0, roll: 0, gunX: 0, gunY: 0, gunPitch: 0, gunYaw: 0, gunRoll: 0 };
}

/** Roll left when `stable` is on (strongly damped, not zeroed: the horizon still breathes a little). */
export const STABLE_ROLL = 0.08;
/** ADS keeps this share of the hip-fire gun swing. */
export const ADS_SWING = 0.12;
/** ADS keeps this share of the body bob in the sight picture. */
export const ADS_BODY = 0.15;
/** ... and this share of a heel-strike bump (the step is still felt while aiming). */
export const ADS_BUMP = 0.4;

export class GaitMotion {
  readonly out: GaitOut = emptyGaitOut();
  // Body compliance (vertical, heel strikes), landing squash, nod (pitch) and the accel-lean.
  private readonly vert = new Spring(6.5, 0.38);
  private readonly squash = new Spring(3.0, 0.5);
  private readonly nod = new Spring(7, 0.4);
  private readonly lean = new Spring(2.4, 0.7);
  private readonly strafeRoll = new Spring(3.2, 0.8);
  // The mount on the plate carrier: stiff, lightly damped, so a step leaves a short buzz.
  private readonly mPitch = new Spring(13, 0.18);
  private readonly mRoll = new Spring(11, 0.2);
  private readonly mYaw = new Spring(9, 0.25);
  // Shoulder / wall bumps and stumbles.
  private readonly bumpRoll = new Spring(5.5, 0.35);
  private readonly bumpSide = new Spring(6, 0.4);
  private readonly rand = rng(9173);
  private speedS = 0;

  /** Heel strike: `foot` L/R, `speed` m/s. Returns the strength (0..1) used for the gun's own bump. */
  strike(foot: 'L' | 'R', speed: number, crouch = 0): number {
    const s = crouchScale(crouch);
    this.vert.impulse(-(0.04 + 0.1 * speed) * s);
    this.nod.impulse(-(0.04 + 0.12 * speed) * s);
    const k = (0.02 + 0.09 * speed) * s;
    this.mPitch.impulse((this.rand() - 0.6) * 2 * k);
    this.mRoll.impulse(((foot === 'L' ? 1 : -1) * 0.5 + (this.rand() - 0.5)) * k);
    this.mYaw.impulse((this.rand() - 0.5) * k * 0.6);
    return clamp(speed / 5, 0, 1);
  }

  /** Touchdown from a drop: squash dip, pitch dip and a jolt in the mount. */
  land(speed: number) {
    this.squash.impulse(-Math.min(0.45 * speed, 3));
    this.nod.impulse(-Math.min(0.6 * speed, 5));
    this.mPitch.impulse(Math.min(0.12 * speed, 1));
  }

  /** Shoulder against a wall or frame: roll and a push away from it. `side` = -1 left wall, +1 right. */
  bump(side: number, strength: number) {
    this.bumpRoll.impulse(-side * 0.35 * strength);
    this.bumpSide.impulse(-side * 0.22 * strength);
    this.mRoll.impulse(-side * 0.5 * strength);
    this.mPitch.impulse(-0.3 * strength);
  }

  /** A small stumble (stair edge, lip): pitch dip and a quick vertical jolt. */
  stumble(strength: number) {
    this.vert.impulse(-0.35 * strength);
    this.nod.impulse(-1.2 * strength);
    this.mPitch.impulse(0.4 * strength);
  }

  reset() {
    for (const s of [
      this.vert,
      this.squash,
      this.nod,
      this.lean,
      this.strafeRoll,
      this.mPitch,
      this.mRoll,
      this.mYaw,
      this.bumpRoll,
      this.bumpSide,
    ])
      s.reset();
    this.speedS = 0;
    this.out.y = this.out.x = this.out.pitch = this.out.yaw = this.out.roll = 0;
  }

  update(dt: number, f: GaitFrame, sc: GaitScales): GaitOut {
    const o = this.out;
    // The amplitudes follow a smoothed speed: a wall hit that kills most of the speed in one tick must not
    // collapse the bob (or the swing) in one frame.
    this.speedS += (f.speed - this.speedS) * damp(0.06, dt);
    const speed = this.speedS;
    const sway = clamp(sc.sway, 0, 1.5);
    const cam = clamp(sc.shake, 0, 2.5);
    const adsBody = 1 - (1 - ADS_BODY) * f.ads;
    const adsSwing = 1 - (1 - ADS_SWING) * f.ads;
    const air = f.grounded ? 1 : 0;
    const a = f.amount * air;
    const cs = crouchScale(f.crouch);
    const ph = f.phase;
    const th = 2 * ph;

    // Springs: the body leans into acceleration and out of a stop, rolls into a strafe.
    const leanTarget = clamp(-f.accelFwd * 0.0011, -0.05, 0.05) - 0.027 * clamp((speed - 3) / 2, 0, 1) * air;
    this.lean.step(leanTarget, dt);
    this.strafeRoll.step(clamp(-f.strafe * 0.0085, -0.03, 0.03), dt);
    this.vert.step(0, dt);
    this.squash.step(0, dt);
    this.nod.step(0, dt);
    this.mPitch.step(0, dt);
    this.mRoll.step(0, dt);
    this.mYaw.step(clamp(-f.yawAccel * 0.00014, -0.012, 0.012), dt);
    this.bumpRoll.step(0, dt);
    this.bumpSide.step(0, dt);

    // Body (shared by camera and gun): vertical bob with the dip at the heel strike, alternating weight shift.
    const bobY = dip(th) * table(BOB_PP, speed) * cs * a;
    const shiftX = -Math.sin(ph) * table(SHIFT, speed) * cs * a;
    const bodyScale = sway * cam * adsBody;
    o.y = (bobY + this.vert.value + this.squash.value) * bodyScale;
    o.x = (shiftX + this.bumpSide.value) * bodyScale;

    // Camera attitude: counter-rotating torso, roll over the stance foot, nod at the strike, lean, strafe roll.
    const nodWave = -dip(th) * table(NOD_PP, speed) * cs * a;
    const gaitRoll = Math.sin(ph) * table(ROLL, speed) * cs * a;
    const twist = -Math.cos(ph) * table(TWIST, speed) * cs * a;
    const camScale = sway * cam * (1 - 0.8 * f.ads);
    o.pitch =
      (nodWave + this.nod.value + this.lean.value + this.mPitch.value + this.squash.value * 0.2) * camScale;
    o.yaw = (twist + this.mYaw.value) * camScale;
    const rollSum = gaitRoll + this.strafeRoll.value + this.mRoll.value + this.bumpRoll.value;
    o.roll = rollSum * camScale * (sc.stable ? STABLE_ROLL : 1);

    // The hands: their own swing, out of phase with the chest (~0.5 rad behind). Walking at the ready this
    // traces a small figure-8 (one lateral cycle per stride against two vertical per stride).
    const gs = sway * adsSwing * clamp(sc.inertia, 0, 1.25) * cs * a;
    o.gunX = Math.sin(ph + 0.55) * table(GUN_X, speed) * gs;
    o.gunY = dip(th + 0.9) * table(GUN_Y_PP, speed) * gs;
    o.gunPitch = -dip(th + 1.3) * table(GUN_PITCH, speed) * gs;
    o.gunYaw = -Math.sin(ph + 0.35) * table(GUN_PITCH, speed) * 0.5 * gs;
    o.gunRoll = Math.sin(ph + 0.3) * table(GUN_ROLL, speed) * gs;
    return o;
  }
}

/**
 * Stair / lip smoothing: a step-up of the capsule is one tick of pure height; the camera eases through it
 * instead (the body "climbs"), and the size of the step says how hard the stumble is.
 */
export class StepSmoother {
  offset = 0;
  /** Feed the per-tick height change while grounded. Returns the stumble strength (0 if it wasn't a step). */
  push(dy: number): number {
    if (Math.abs(dy) < STEP_MIN) return 0;
    this.offset = clamp(this.offset - dy, -0.45, 0.45);
    return clamp((Math.abs(dy) - STEP_MIN) / 0.2, 0.15, 1);
  }
  update(dt: number) {
    this.offset -= this.offset * damp(0.07, dt);
    if (Math.abs(this.offset) < 1e-5) this.offset = 0;
  }
}
/** Per-tick height change (m) above which grounded movement counts as a step (ramps at 50° and 5 m/s: 0.03). */
const STEP_MIN = 0.05;
