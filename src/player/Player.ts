import { Euler, Object3D, Quaternion, Vector3 } from 'three';
import type { Context, System } from '../core/Context';
import { Spring, clamp, damp, noise1 } from '../core/math';
import { RAPIER } from '../physics/Physics';
import type { Surface } from '../core/bus';

export type ReadyPos = 'high' | 'low' | 'compressed';

export interface PlayerTuning {
  walkSpeed: number;
  slowSpeed: number;
  sprintSpeed: number;
  crouchSpeed: number;
  accelHalfLife: number;
  chestHeight: number;
  eyeHeight: number;
  crouchDrop: number;
  leanAngle: number;
  leanOffset: number;
  /** 0..1.5 scale on all procedural camera motion (accessibility "camera shake"). */
  cameraShake: number;
}

export const DEFAULT_TUNING: PlayerTuning = {
  walkSpeed: 1.9,
  slowSpeed: 0.9,
  sprintSpeed: 4.6,
  crouchSpeed: 1.1,
  accelHalfLife: 0.06,
  chestHeight: 1.36,
  eyeHeight: 1.66,
  crouchDrop: 0.42,
  leanAngle: 0.38,
  leanOffset: 0.32,
  cameraShake: 1,
};

/**
 * Body-first player. Input rotates the body (yaw) and torso (pitch) immediately;
 * the chest camera rides the torso through a stiff spring; the weapon (see WeaponView) chases the torso.
 */
export class Player implements System {
  tuning = { ...DEFAULT_TUNING };
  mount: 'chest' | 'helmet' = 'chest';
  readonly position = new Vector3(0, 0, 8);
  readonly velocity = new Vector3();
  yaw = Math.PI; // facing -z
  pitch = 0;
  lean = 0; // -1..1 smoothed
  crouch = 0; // 0..1 smoothed
  ready: ReadyPos = 'high';
  aiming = false;
  sprinting = false;
  /** 0..1, raised by sprint/fast fire/par pressure; read by weapon + audio. */
  stress = 0;
  surfaceUnderfoot: Surface = 'concrete';

  /** Torso transform the weapon is attached to (world space). */
  readonly torso = new Object3D();

  private body!: RAPIER.RigidBody;
  private collider!: RAPIER.Collider;
  private kcc!: RAPIER.KinematicCharacterController;
  private prevPos = new Vector3();
  private renderPos = new Vector3();
  private gaitPhase = 0;
  private lastStepSign = 1;
  private camRoll = new Spring(3.2, 0.55);
  private camPitchJolt = new Spring(4.5, 0.5);
  private camYawLag = new Spring(9, 0.7);
  private camSide = new Spring(3.5, 0.6);
  private lastYaw = this.yaw;
  private grounded = true;
  private vy = 0;
  private wantMove = new Vector3();

  constructor(private ctx: Context) {
    const w = ctx.physics.world;
    this.body = w.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(
        this.position.x,
        this.position.y + 0.9,
        this.position.z,
      ),
    );
    this.collider = w.createCollider(RAPIER.ColliderDesc.capsule(0.55, 0.3), this.body);
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

  teleport(p: Vector3, yaw: number) {
    this.position.copy(p);
    this.prevPos.copy(p);
    this.renderPos.copy(p);
    this.velocity.set(0, 0, 0);
    this.yaw = yaw;
    this.lastYaw = yaw;
    this.pitch = 0;
    this.body.setNextKinematicTranslation({ x: p.x, y: p.y + 0.9, z: p.z });
    this.body.setTranslation({ x: p.x, y: p.y + 0.9, z: p.z }, true);
  }

  /** Look is applied per render frame for zero-latency aim. */
  update(dt: number, alpha: number) {
    const f = this.ctx.input.frame;
    this.yaw -= f.look.yaw;
    this.pitch = clamp(this.pitch + f.look.pitch, -1.45, 1.45);

    const leanTarget =
      clamp((f.down.has('leanRight') ? 1 : 0) - (f.down.has('leanLeft') ? 1 : 0) + f.leanAxis, -1, 1) *
      (this.sprinting ? 0 : 1);
    this.lean += (leanTarget - this.lean) * damp(0.07, dt);
    const crouchTarget = this.crouchToggle ? 1 : 0;
    this.crouch += (crouchTarget - this.crouch) * damp(0.08, dt);

    if (f.pressed.has('crouch')) this.crouchToggle = !this.crouchToggle;
    if (f.pressed.has('readyUp')) this.ready = this.ready === 'low' ? 'high' : 'compressed';
    if (f.pressed.has('readyDown')) this.ready = this.ready === 'compressed' ? 'high' : 'low';
    this.aiming = (f.down.has('aim') || f.aimAxis > 0.3) && !this.sprinting;

    this.renderPos.lerpVectors(this.prevPos, this.position, alpha);
    this.updateCamera(dt);
  }

  private crouchToggle = false;

  fixedUpdate(dt: number) {
    const f = this.ctx.input.frame;
    const t = this.tuning;
    const mag = Math.min(1, Math.hypot(f.move.x, f.move.y));
    this.sprinting = f.down.has('sprint') && f.move.y > 0.3 && this.crouch < 0.5;
    let speed = this.sprinting
      ? t.sprintSpeed
      : f.down.has('slowWalk')
        ? t.slowSpeed
        : t.walkSpeed + (t.crouchSpeed - t.walkSpeed) * this.crouch;
    if (this.aiming) speed *= 0.75;
    // Analog sticks: light deflection = slow walk.
    speed *= mag < 1 ? 0.35 + 0.65 * mag : 1;

    const sin = Math.sin(this.yaw),
      cos = Math.cos(this.yaw);
    // forward = (-sin, 0, -cos) for yaw measured from +z toward -x... keep consistent with camera
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
    const k = damp(t.accelHalfLife * (this.sprinting ? 2.2 : 1), dt);
    this.velocity.x += (this.wantMove.x - this.velocity.x) * k;
    this.velocity.z += (this.wantMove.z - this.velocity.z) * k;

    this.vy = this.grounded ? -1 : this.vy - 9.81 * dt;
    const desired = { x: this.velocity.x * dt, y: this.vy * dt, z: this.velocity.z * dt };
    this.kcc.computeColliderMovement(this.collider, desired);
    const m = this.kcc.computedMovement();
    this.grounded = this.kcc.computedGrounded();
    const cur = this.body.translation();
    const next = { x: cur.x + m.x, y: cur.y + m.y, z: cur.z + m.z };
    this.body.setNextKinematicTranslation(next);
    this.prevPos.copy(this.position);
    this.position.set(next.x, next.y - 0.9, next.z);
    if (this.position.y < -20) this.teleport(new Vector3(0, 0, 8), Math.PI);

    // Stress: sprinting raises, stillness lowers.
    const planar = Math.hypot(this.velocity.x, this.velocity.z);
    this.stress = clamp(this.stress + (this.sprinting ? 0.12 : planar < 0.2 ? -0.08 : -0.03) * dt, 0, 1);

    // Gait: heel strikes drive footsteps + camera bob.
    const stride = this.sprinting ? 1.65 : 1.15;
    this.gaitPhase += (planar / stride) * dt * Math.PI * 2;
    const s = Math.sign(Math.sin(this.gaitPhase));
    if (planar > 0.25 && s !== this.lastStepSign) {
      this.lastStepSign = s;
      const scuff = clamp(this.velocity.clone().sub(this.wantMove).length() / 3, 0, 1);
      this.ctx.bus.emit('footstep', {
        point: this.position.clone(),
        surface: this.surfaceUnderfoot,
        foot: s > 0 ? 'L' : 'R',
        speed: planar,
        scuff,
      });
      this.camPitchJolt.impulse(-(0.02 + planar * 0.012) * this.tuning.cameraShake);
    }
    this.sampleSurface();
  }

  private sampleSurface() {
    const hit = this.ctx.physics.raycast(
      new Vector3(this.position.x, this.position.y + 0.2, this.position.z),
      new Vector3(0, -1, 0),
      0.6,
      this.body,
    );
    if (hit) this.surfaceUnderfoot = hit.tag.surface;
  }

  /** Recoil / impact impulse into the body-mounted camera (radians/sec). */
  kick(pitch: number, yaw: number, roll: number) {
    const s = this.tuning.cameraShake;
    this.camPitchJolt.impulse(pitch * s);
    this.camYawLag.impulse(yaw * s);
    this.camRoll.impulse(roll * s);
  }

  private tmpQ = new Quaternion();
  private tmpE = new Euler(0, 0, 0, 'YXZ');

  private updateCamera(dt: number) {
    const t = this.tuning;
    const cam = this.ctx.camera;
    const shake = t.cameraShake;
    const planar = Math.hypot(this.velocity.x, this.velocity.z);
    const yawRate = (this.yaw - this.lastYaw) / Math.max(dt, 1e-4);
    this.lastYaw = this.yaw;

    // Turn lag/overshoot of the rig on the chest + roll into turns + lean roll.
    this.camYawLag.step(clamp(-yawRate * 0.004, -0.04, 0.04) * shake, dt);
    this.camRoll.step((-this.lean * t.leanAngle + clamp(yawRate * 0.006, -0.05, 0.05) * shake) * 1, dt);
    this.camPitchJolt.step(0, dt);
    // Lateral sway follows strafe velocity in local space.
    const rightX = Math.cos(this.yaw),
      rightZ = -Math.sin(this.yaw);
    const strafe = this.velocity.x * rightX + this.velocity.z * rightZ;
    this.camSide.step(-strafe * 0.012 * shake, dt);

    const bob = planar > 0.05 ? Math.abs(Math.sin(this.gaitPhase)) : 0;
    const bobAmp = (0.012 + planar * 0.01) * shake;
    const idle = this.ctx.time;
    const breathe = Math.sin(idle * 1.6) * 0.003 * shake * (1 + this.stress * 2);

    const crouchY = -t.crouchDrop * this.crouch;
    const height = this.mount === 'chest' ? t.chestHeight : t.eyeHeight;
    const leanOffset = this.lean * t.leanOffset;

    // Torso: lean pivots around the hips.
    this.torso.position.set(
      this.renderPos.x + rightX * leanOffset,
      this.renderPos.y + height + crouchY - Math.abs(this.lean) * 0.05 + breathe,
      this.renderPos.z + rightZ * leanOffset,
    );
    this.tmpE.set(this.pitch, this.yaw, -this.lean * t.leanAngle * 0.6);
    this.torso.quaternion.setFromEuler(this.tmpE);
    this.torso.updateMatrixWorld();

    // Camera: chest mount = torso + offsets + rig wobble. Helmet = more bob, head look.
    const helmet = this.mount === 'helmet';
    const jitter = noise1(idle * 7.3, 3) * 0.0015 * shake * (1 + this.stress * 3);
    cam.position.copy(this.torso.position);
    cam.position.y += bob * bobAmp * (helmet ? 1.4 : 1) - bobAmp * 0.5;
    const side = new Vector3(rightX, 0, rightZ);
    cam.position.addScaledVector(side, this.camSide.value + (helmet ? 0.06 : -0.07));
    // Chest camera sits slightly forward of the torso.
    const fwd = new Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    cam.position.addScaledVector(fwd, helmet ? 0.05 : 0.14);

    this.tmpE.set(
      this.pitch * (helmet ? 1 : 0.92) + this.camPitchJolt.value + jitter,
      this.yaw + this.camYawLag.value,
      this.camRoll.value + Math.sin(this.gaitPhase) * 0.006 * shake * Math.min(1, planar),
    );
    this.tmpQ.setFromEuler(this.tmpE);
    cam.quaternion.copy(this.tmpQ);
    cam.updateMatrixWorld();
  }
}
