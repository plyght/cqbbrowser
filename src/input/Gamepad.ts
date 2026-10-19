import type { ActionFrame, ButtonAction, Haptics, InputSource, PollInfo } from './actions';
import type { AimAssist } from './AimAssist';
import { padTypeFromId, type PadAction, type PadType } from './bindings';
import { FlipButton, HoldGate, ModalButton, TapHold } from './buttons';
import { gamepadSettings } from './config';
import { applyCurve, axialDeadzone, radialDeadzone, triggerAxis, TurnRamp } from './stick';

const DEG = Math.PI / 180;

/** Minimal structural view of a Gamepad, so tests and fakes (plain objects) work too. */
export interface PadLike {
  id: string;
  index: number;
  connected: boolean;
  mapping: string;
  axes: readonly number[];
  buttons: readonly { pressed: boolean; value: number }[];
  vibrationActuator?: {
    effects?: readonly string[];
    playEffect?(type: string, params: Record<string, number>): Promise<unknown>;
  } | null;
  hapticActuators?: readonly { pulse?(value: number, duration: number): Promise<unknown> }[];
}

export interface LookOpts {
  inner: number;
  outer: number;
  axial: number;
  anti: number;
  curve: Parameters<typeof applyCurve>[1];
  exponent: number;
  yawSpeed: number;
  pitchSpeed: number;
  invertY: boolean;
}

/**
 * Right stick → look rate (radians/second): radial deadzone with rescale, optional axial deadzone, response curve
 * on the magnitude, outer-zone turn ramp on yaw. Pure; unit-tested.
 */
export function stickLookRate(rx: number, ry: number, o: LookOpts, ramp: TurnRamp, dt: number) {
  const ax = o.axial > 0 ? axialDeadzone(rx, o.axial) : rx;
  const ay = o.axial > 0 ? axialDeadzone(ry, o.axial) : ry;
  const v = radialDeadzone(ax, ay, o.inner, o.outer, o.anti);
  const m = Math.hypot(v.x, v.y);
  const boost = ramp.update(m, dt, Math.sign(v.x));
  if (m === 0) return { yaw: 0, pitch: 0, intensity: 0 };
  const curved = applyCurve(m, o.curve, o.exponent);
  const k = curved / m;
  return {
    intensity: curved,
    yaw: v.x * k * o.yawSpeed * DEG * boost,
    pitch: -v.y * k * o.pitchSpeed * DEG * (o.invertY ? -1 : 1),
  };
}

const SIMPLE: [PadAction, ButtonAction][] = [
  ['interact', 'interact'],
  ['reload', 'reload'],
  ['switchWeapon', 'switchWeapon'],
  ['leanLeft', 'leanLeft'],
  ['leanRight', 'leanRight'],
  ['light', 'light'],
  ['fireMode', 'fireMode'],
  ['pause', 'pause'],
];

/**
 * Gamepad API source (standard mapping; Xbox, PlayStation, Switch Pro and generic pads) plus the Haptics sink.
 * Bindings follow PRD §6.1's controller column. The most recently used pad wins.
 */
export class Gamepad implements InputSource, Haptics {
  padType: PadType = 'xbox';
  /** The pad currently driving input (null until a pad sends input). */
  pad: PadLike | null = null;
  private padIndex = -1;
  private ramp = new TurnRamp();
  private aimToggle = new ModalButton('toggle');
  private crouch = new FlipButton('hybrid');
  private restart = new HoldGate(0.8);
  private dUp = new TapHold();
  private dDown = new TapHold();
  private sprintLatched = false;
  private prevSprintBtn = false;
  private queue: ButtonAction[] = [];

  constructor(
    private aimAssist?: AimAssist,
    private getPads: () => readonly (PadLike | null)[] = () =>
      (typeof navigator !== 'undefined' && navigator.getGamepads?.()) || [],
  ) {}

  /** Picks the pad that sent input this frame (or keeps the last one). */
  private choose(): { pad: PadLike | null; active: boolean } {
    const s = gamepadSettings.get();
    let current: PadLike | null = null;
    let active: PadLike | null = null;
    for (const p of this.getPads()) {
      if (!p || !p.connected) continue;
      if (p.index === this.padIndex) current = p;
      if (!active && padActive(p, s.innerDeadzone)) active = p;
    }
    const pad = active ?? current;
    if (pad && pad.index !== this.padIndex) {
      this.padIndex = pad.index;
      this.padType = padTypeFromId(pad.id);
    }
    this.pad = pad;
    return { pad, active: !!active };
  }

  poll(frame: ActionFrame, dt: number, info?: PollInfo): void {
    const { pad, active } = this.choose();
    if (!pad) return;
    const s = gamepadSettings.get();
    const b = s.bindings;
    const btn = (a: PadAction) => pad.buttons[b[a]]?.value ?? 0;
    const isDown = (a: PadAction) => btn(a) > 0.5 || !!pad.buttons[b[a]]?.pressed;
    const axes = pad.axes;

    // Move: LS, analog deflection → walk speed (Player maps magnitude < 1 to slower walking).
    const lx = s.axialDeadzone > 0 ? axialDeadzone(axes[0] ?? 0, s.axialDeadzone) : (axes[0] ?? 0);
    const ly = s.axialDeadzone > 0 ? axialDeadzone(axes[1] ?? 0, s.axialDeadzone) : (axes[1] ?? 0);
    const mv = radialDeadzone(lx, ly, s.moveInnerDeadzone, s.outerDeadzone);
    frame.move.x += mv.x;
    frame.move.y += -mv.y;

    // Look: RS.
    this.ramp.threshold = s.rampThreshold;
    this.ramp.delay = s.rampDelay;
    this.ramp.time = s.rampTime;
    this.ramp.boost = s.rampBoost;
    const rate = stickLookRate(
      axes[2] ?? 0,
      axes[3] ?? 0,
      {
        inner: s.innerDeadzone,
        outer: s.outerDeadzone,
        axial: s.axialDeadzone,
        anti: s.antiDeadzone,
        curve: s.curve,
        exponent: s.curveExponent,
        yawSpeed: s.yawSpeed,
        pitchSpeed: s.pitchSpeed,
        invertY: s.invertY,
      },
      this.ramp,
      dt,
    );
    const ads = info?.aiming ? s.adsMultiplier : 1;
    const look = { yaw: rate.yaw * ads * dt, pitch: rate.pitch * ads * dt };
    this.aimAssist?.apply(look, rate.intensity);
    frame.look.yaw += look.yaw;
    frame.look.pitch += look.pitch;

    // Triggers: analog fire/aim axes (Input derives the digital actions at 0.5).
    const fire = triggerAxis(btn('fire'), s.triggerDeadzone);
    frame.fireAxis = Math.max(frame.fireAxis, fire);
    const aimRaw = triggerAxis(btn('aim'), s.triggerDeadzone);
    if (s.aimMode === 'hold') frame.aimAxis = Math.max(frame.aimAxis, aimRaw);
    else {
      this.aimToggle.mode = s.aimMode;
      if (this.aimToggle.update(aimRaw > 0.5, dt)) frame.down.add('aim');
    }

    for (const [pa, action] of SIMPLE) if (isDown(pa)) frame.down.add(action);

    // Crouch: tap toggle, hold momentary (hybrid) by default.
    this.crouch.mode = s.crouchMode;
    if (this.crouch.update(isDown('crouch'), dt)) frame.pressed.add('crouch');

    // Restart: hold View/Share.
    this.restart.threshold = s.restartHold;
    if (this.restart.update(isDown('restart'), dt)) frame.down.add('restart');

    // Sprint: click LS latches until the stick relaxes, you stop pushing forward, or you aim/fire.
    const sprintBtn = isDown('sprint');
    if (sprintBtn && !this.prevSprintBtn) this.sprintLatched = !this.sprintLatched;
    this.prevSprintBtn = sprintBtn;
    if (Math.hypot(mv.x, mv.y) < 0.5 || -mv.y < 0.3 || aimRaw > 0.3 || fire > 0.3) this.sprintLatched = false;
    if (this.sprintLatched) frame.down.add('sprint');

    // D-pad up: tap = cycle aim mode, hold = magnifier flip.
    this.dUp.update(isDown('aimModeOrMagnifier'), dt);
    if (this.dUp.tap) frame.pressed.add('aimMode');
    if (this.dUp.hold) frame.down.add('magnifier');

    // D-pad down: tap = cycle ready (high → low → compressed → high), hold = fix camera.
    this.dDown.update(isDown('fixCamOrReady'), dt);
    if (this.dDown.tap && this.queue.length === 0) this.queue.push(...readyCycle(info?.ready ?? 'high'));
    if (this.dDown.hold) frame.down.add('fixCam');
    const next = this.queue.shift();
    if (next) frame.pressed.add(next);

    if (active) frame.activeDevice = 'gamepad';
  }

  // Haptics -----------------------------------------------------------------------------------------------------

  rumble(strong: number, weak: number, durationMs: number): void {
    const s = gamepadSettings.get();
    const pad = this.livePad();
    if (!s.haptics || !pad) return;
    const k = s.hapticsStrength;
    const act = pad.vibrationActuator;
    if (act?.playEffect) {
      safe(() =>
        act.playEffect!('dual-rumble', {
          startDelay: 0,
          duration: durationMs,
          strongMagnitude: clamp01(strong * k),
          weakMagnitude: clamp01(weak * k),
        }),
      );
    } else {
      // Legacy Firefox GamepadHapticActuator.pulse().
      const legacy = pad.hapticActuators?.[0];
      if (legacy?.pulse) safe(() => legacy.pulse!(clamp01(Math.max(strong, weak) * k), durationMs));
    }
  }

  triggerRumble(left: number, right: number, durationMs: number): void {
    const s = gamepadSettings.get();
    const act = this.livePad()?.vibrationActuator;
    if (!s.haptics || !act?.playEffect || !act.effects?.includes('trigger-rumble')) return;
    const k = s.hapticsStrength;
    safe(() =>
      act.playEffect!('trigger-rumble', {
        startDelay: 0,
        duration: durationMs,
        leftTrigger: clamp01(left * k),
        rightTrigger: clamp01(right * k),
        strongMagnitude: 0,
        weakMagnitude: 0,
      }),
    );
  }

  /** Chromium hands out snapshots; fetch the live object for the actuator. */
  private livePad(): PadLike | null {
    if (this.padIndex < 0) return null;
    return this.getPads()[this.padIndex] ?? this.pad;
  }
}

/** Presses needed (one per frame) to step the player's ready position high → low → compressed → high. */
export function readyCycle(ready: 'high' | 'low' | 'compressed'): ButtonAction[] {
  // Player rules: readyUp low→high, else →compressed; readyDown compressed→high, else →low.
  if (ready === 'high') return ['readyDown'];
  if (ready === 'low') return ['readyUp', 'readyUp'];
  return ['readyDown'];
}

/** True when a pad is sending deliberate input (buttons, triggers or a stick beyond the deadzone). */
export function padActive(p: PadLike, deadzone: number): boolean {
  for (const b of p.buttons) if (b.pressed || b.value > 0.15) return true;
  const a = p.axes;
  return (
    Math.hypot(a[0] ?? 0, a[1] ?? 0) > deadzone + 0.1 || Math.hypot(a[2] ?? 0, a[3] ?? 0) > deadzone + 0.1
  );
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

function safe(fn: () => Promise<unknown> | undefined) {
  try {
    fn()?.catch(() => {});
  } catch {
    /* unsupported effect */
  }
}
