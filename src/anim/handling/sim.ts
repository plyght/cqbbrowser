import { Quaternion, Vector3 } from 'three';

/**
 * Physically simulated weapon handling (PRD §6.3): the weapon is a rigid body held by the firing hand, the
 * support hand and (long guns) the shoulder pocket, each a spring-damper toward targets that follow the torso
 * aim, plus wrist torque. "View first, then gun", turn lag, overshoot on stop for front-heavy builds, settle
 * time, recoil kick and recovery to the original point of aim all come out of the integration.
 *
 * Deterministic: fixed internal sub-step (1/480 s), semi-implicit Euler, no allocation per step.
 * Frames: weapon frame = -z forward, +y up, origin at the grip (as the models).
 */

export interface RigParams {
  /** Loaded weapon mass (kg). */
  mass: number;
  /** COM forward of the grip (m). */
  balance: number;
  /** Moment of inertia about the firing hand (kg·m²). */
  moment: number;
  /** Bore axis height over the grip origin (m). */
  boreY: number;
  /** COM height over the grip origin (m). */
  comY: number;
  /** Support-hand contact (weapon frame). */
  support: [number, number, number];
  /** Shoulder pocket / butt pad (weapon frame), null for pistols. */
  stock: [number, number, number] | null;
}

export interface ArmGains {
  /** Hand spring per contact (N/m). */
  kHand: number;
  /** Hand damping per contact (N·s/m). */
  cHand: number;
  /** Shoulder pocket stiffness along the bore (N/m) and across it (N/m). */
  kShoulderAxial: number;
  kShoulder: number;
  cShoulder: number;
  /** Wrist/forearm torque stiffness (N·m/rad) and damping (N·m·s/rad). */
  kWrist: number;
  cWrist: number;
}

/** Nominal arm gains (standing, high ready, rested). Tuned so a carbine's follow half-life is ~45 ms. */
export const BASE_GAINS: ArmGains = {
  kHand: 1400,
  cHand: 70,
  kShoulderAxial: 9000,
  kShoulder: 1400,
  cShoulder: 140,
  kWrist: 70,
  cWrist: 2.2,
};

/** Effective mass of each hand+forearm riding the weapon (kg) and their rotational inertia (kg·m²). */
const HAND_MASS = 0.45;
const ARM_ROT_INERTIA = 0.01;

export interface GainState {
  /** 0..1 ADS blend: the arms lock in. */
  ads: number;
  /** 0..1 hand fatigue. */
  fatigue: number;
  /** "Weapon inertia" master: 0 = locked to the target, 1 = nominal, 1.5 = heavy. */
  inertia: number;
  crouch: number;
}

/** Arm stiffness/damping from stance, ADS, fatigue and the inertia master. */
export function gainsFor(s: GainState, out: ArmGains = { ...BASE_GAINS }): ArmGains {
  const B = BASE_GAINS;
  const stiff = (1 + 1.6 * s.ads) * (1 - 0.3 * s.fatigue) * (1 + 0.15 * s.crouch);
  // Lag ∝ 1/ω ∝ 1/sqrt(k): scaling k by 1/inertia² makes lag scale linearly with the master.
  const m = 1 / Math.max(0.05, s.inertia) ** 2;
  const ks = stiff * m;
  // Damping keeps ζ roughly constant as stiffness changes (c ∝ sqrt(k)).
  const cs = Math.sqrt(ks);
  out.kHand = B.kHand * ks;
  out.cHand = B.cHand * cs;
  out.kShoulder = B.kShoulder * ks;
  out.kShoulderAxial = B.kShoulderAxial * Math.sqrt(ks);
  out.cShoulder = B.cShoulder * cs;
  out.kWrist = B.kWrist * ks;
  out.cWrist = B.cWrist * cs;
  return out;
}

const SUB = 1 / 480;
/**
 * How much of the torso motion the arm damping "carries" (0 = damping against the world: heavy lag while turning,
 * 1 = damping relative to the body: the gun only lags while the turn accelerates). Muscles sit in between.
 */
export const CARRY = 0.8;

const _a = new Vector3();
const _b = new Vector3();
const _c = new Vector3();
const _d = new Vector3();
const _f = new Vector3();
const _t = new Vector3();
const _z = new Vector3();
const _z2 = new Vector3();
const _q = new Quaternion();
const _qi = new Quaternion();

export class WeaponRigidBody {
  /** COM world position and velocity. */
  readonly x = new Vector3();
  readonly v = new Vector3();
  /** Orientation (weapon frame → world) and world angular velocity. */
  readonly q = new Quaternion();
  readonly w = new Vector3();
  /** Target pose of the weapon frame (grip origin). */
  readonly targetPos = new Vector3();
  readonly targetQ = new Quaternion();
  gains: ArmGains = { ...BASE_GAINS };
  /** When true, the body is pinned to its target (inertia master 0). */
  locked = false;

  private mass = 1;
  /** Body-frame principal inertia about the COM (pitch x, yaw y, roll z). */
  private I = new Vector3(0.1, 0.1, 0.01);
  private readonly com = new Vector3();
  private readonly contacts: { local: Vector3; kind: 'hand' | 'shoulder' }[] = [];
  private acc = 0;
  private pendingImpulses: { t: number; J: number; torque: number; side: number }[] = [];
  private time = 0;

  constructor(p: RigParams) {
    this.configure(p);
  }

  configure(p: RigParams) {
    this.com.set(0, p.comY, -p.balance);
    const handPts: [number, number, number][] = [[0, 0, 0], p.support];
    this.mass = p.mass + HAND_MASS * 2;
    // Inertia about the COM: weapon (parallel-axis from the grip moment) + hands at their contacts + forearms.
    const Iw = Math.max(p.moment - p.mass * p.balance * p.balance, 0.2 * p.moment);
    let Ip = Iw + ARM_ROT_INERTIA,
      Iy = Iw + ARM_ROT_INERTIA;
    for (const h of handPts) {
      const dz = h[2] - this.com.z,
        dy = h[1] - this.com.y,
        dx = h[0] - this.com.x;
      Ip += HAND_MASS * (dz * dz + dy * dy);
      Iy += HAND_MASS * (dz * dz + dx * dx);
    }
    const Ir = p.mass * 0.035 * 0.035 + ARM_ROT_INERTIA * 0.6;
    this.I.set(Ip, Iy, Ir);
    this.contacts.length = 0;
    this.contacts.push({ local: new Vector3(0, 0, 0), kind: 'hand' });
    this.contacts.push({ local: new Vector3(...p.support), kind: 'hand' });
    if (p.stock) this.contacts.push({ local: new Vector3(...p.stock), kind: 'shoulder' });
    this.boreY = p.boreY;
  }

  private boreY = 0.03;

  get inertia(): Vector3 {
    return this.I;
  }

  get totalMass() {
    return this.mass;
  }

  /** Snap to the target (spawn, weapon switch, teleport). */
  reset() {
    this.q.copy(this.targetQ);
    this.x.copy(this.com).applyQuaternion(this.q).add(this.targetPos);
    this.v.set(0, 0, 0);
    this.w.set(0, 0, 0);
    this.pendingImpulses.length = 0;
    this.hasPrev = false;
  }

  /** Weapon-frame origin (grip) in world space. */
  origin(out: Vector3): Vector3 {
    return out.copy(this.com).applyQuaternion(this.q).negate().add(this.x);
  }

  /** World point of a weapon-frame point. */
  pointWorld(local: Vector3, out: Vector3): Vector3 {
    return out.copy(local).sub(this.com).applyQuaternion(this.q).add(this.x);
  }

  /**
   * Fire: rearward impulse (N·s) along the bore, delivered over the recoil profile, applied on the bore axis
   * (so the bore-over-grip lever arm produces muzzle rise) plus random yaw wander.
   */
  recoil(profile: { t: number; fx: number; torque: number }[], impulseNs: number, side: number) {
    for (const s of profile)
      this.pendingImpulses.push({
        t: this.time + s.t,
        J: impulseNs * s.fx,
        torque: s.torque,
        side: side * s.fx,
      });
  }

  /** Apply an impulse at a world point. */
  impulseAt(J: Vector3, point: Vector3) {
    this.v.addScaledVector(J, 1 / this.mass);
    _t.subVectors(point, this.x).cross(J);
    this.addAngularImpulse(_t);
  }

  private addAngularImpulse(L: Vector3) {
    // Δω = R I⁻¹ Rᵀ L
    _qi.copy(this.q).invert();
    _a.copy(L).applyQuaternion(_qi);
    _a.set(_a.x / this.I.x, _a.y / this.I.y, _a.z / this.I.z).applyQuaternion(this.q);
    this.w.add(_a);
  }

  /** Target velocities (finite-differenced per external step): damping is relative to the carrying body. */
  private readonly prevTargetPos = new Vector3();
  private readonly prevTargetQ = new Quaternion();
  private readonly targetV = new Vector3();
  private readonly targetW = new Vector3();
  private hasPrev = false;

  step(dt: number) {
    if (this.locked) {
      this.reset();
      return;
    }
    if (this.hasPrev && dt > 0) {
      this.targetV.subVectors(this.targetPos, this.prevTargetPos).divideScalar(dt);
      _q.copy(this.targetQ).multiply(_qi.copy(this.prevTargetQ).invert());
      if (_q.w < 0) _q.set(-_q.x, -_q.y, -_q.z, -_q.w);
      const s = Math.sqrt(Math.max(0, 1 - _q.w * _q.w));
      const ang = 2 * Math.atan2(s, _q.w);
      if (s > 1e-9) this.targetW.set(_q.x / s, _q.y / s, _q.z / s).multiplyScalar(ang / dt);
      else this.targetW.set(0, 0, 0);
    } else {
      this.targetV.set(0, 0, 0);
      this.targetW.set(0, 0, 0);
    }
    this.prevTargetPos.copy(this.targetPos);
    this.prevTargetQ.copy(this.targetQ);
    this.hasPrev = true;
    this.acc += dt;
    let guard = 0;
    while (this.acc >= SUB && guard++ < 400) {
      this.acc -= SUB;
      this.substep(SUB);
    }
  }

  private substep(h: number) {
    this.time += h;
    const g = this.gains;
    // Delayed recoil slices.
    for (let i = this.pendingImpulses.length - 1; i >= 0; i--) {
      const p = this.pendingImpulses[i];
      if (p.t > this.time) continue;
      this.pendingImpulses.splice(i, 1);
      _z.set(0, 0, 1).applyQuaternion(this.q).multiplyScalar(p.J); // rearward = +z
      _c.set(0, this.boreY, -0.05);
      this.pointWorld(_c, _d);
      this.impulseAt(_z, _d);
      // Device/bolt torque (muzzle rise about weapon +x) and wander (about weapon +y).
      _a.set(p.torque, p.side, 0).applyQuaternion(this.q);
      this.addAngularImpulse(_a);
    }

    _f.set(0, 0, 0);
    _t.set(0, 0, 0);
    _z.set(0, 0, 1).applyQuaternion(this.q);
    for (const c of this.contacts) {
      // Contact point and its velocity.
      this.pointWorld(c.local, _a);
      _b.subVectors(_a, this.x);
      _c.crossVectors(this.w, _b).add(this.v);
      // Target point and its velocity (carried by the torso): damping acts on the relative velocity.
      _d.copy(c.local).applyQuaternion(this.targetQ);
      _c.addScaledVector(_z2.crossVectors(this.targetW, _d).add(this.targetV), -CARRY);
      _d.add(this.targetPos).sub(_a);
      const k = c.kind === 'hand' ? g.kHand : g.kShoulder;
      const cc = c.kind === 'hand' ? g.cHand : g.cShoulder;
      _d.multiplyScalar(k);
      if (c.kind === 'shoulder') {
        // The shoulder pocket is much stiffer along the bore (the stock pushes the body).
        const ax = _d.dot(_z) / k;
        _d.addScaledVector(_z, ax * (g.kShoulderAxial - k));
      }
      _d.addScaledVector(_c, -cc);
      _f.add(_d);
      _t.add(_b.cross(_d));
    }
    // Wrist torque toward the target orientation.
    _q.copy(this.targetQ).multiply(_qi.copy(this.q).invert());
    if (_q.w < 0) _q.set(-_q.x, -_q.y, -_q.z, -_q.w);
    const s = Math.sqrt(Math.max(0, 1 - _q.w * _q.w));
    const ang = 2 * Math.atan2(s, _q.w);
    if (s > 1e-9) _a.set(_q.x / s, _q.y / s, _q.z / s).multiplyScalar(ang * g.kWrist);
    else _a.set(_q.x, _q.y, _q.z).multiplyScalar(2 * g.kWrist);
    _t.add(_a).addScaledVector(_z2.copy(this.targetW).multiplyScalar(-CARRY).add(this.w), -g.cWrist);

    // Integrate (semi-implicit Euler). Angular: body frame with gyroscopic term.
    this.v.addScaledVector(_f, h / this.mass);
    this.x.addScaledVector(this.v, h);
    _qi.copy(this.q).invert();
    _a.copy(_t).applyQuaternion(_qi); // torque, body frame
    _b.copy(this.w).applyQuaternion(_qi); // ω, body frame
    const I = this.I;
    _c.set(_b.x * I.x, _b.y * I.y, _b.z * I.z); // Iω
    _a.sub(_d.crossVectors(_b, _c));
    _b.x += (_a.x / I.x) * h;
    _b.y += (_a.y / I.y) * h;
    _b.z += (_a.z / I.z) * h;
    this.w.copy(_b).applyQuaternion(this.q);
    // q += ½ ω q h
    const wx = this.w.x,
      wy = this.w.y,
      wz = this.w.z;
    const q = this.q;
    const qx = q.x,
      qy = q.y,
      qz = q.z,
      qw = q.w;
    q.set(
      qx + 0.5 * h * (wx * qw + wy * qz - wz * qy),
      qy + 0.5 * h * (wy * qw + wz * qx - wx * qz),
      qz + 0.5 * h * (wz * qw + wx * qy - wy * qx),
      qw + 0.5 * h * (-wx * qx - wy * qy - wz * qz),
    ).normalize();
  }
}
