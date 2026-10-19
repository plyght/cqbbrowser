import type { ActionFrame, ButtonAction, InputSource } from './actions';
import type { AimAssist } from './AimAssist';
import { DEFAULT_KEY_BINDINGS } from './bindings';
import { keySettings, trackpadSettings } from './config';

/**
 * Trackpad preset (PRD §7.3). Look deltas still arrive through KeyboardMouse's pointer-lock listener; when the
 * preset is active it hands them to `processLook()` here (precision curve, ADS/micro-adjust, edge glide, typing
 * suppression detection). This source owns the wheel/pinch gestures and keyboard snap turns.
 */

// ---------------------------------------------------------------------------------------------------------------
// Detection heuristic

export interface WheelSample {
  dx: number;
  dy: number;
  /** WheelEvent.deltaMode (0 = pixels, 1 = lines, 2 = pages). */
  mode: number;
  ctrl: boolean;
  /** Event timestamp in ms. */
  t: number;
  /** Legacy `wheelDeltaY` where the browser exposes it (Chromium, Safari). */
  wheelDeltaY?: number;
}

const isFractional = (v: number) => {
  const f = Math.abs(v) % 1;
  return f > 0.01 && f < 0.99;
};

/**
 * Scores wheel events as trackpad-like or mouse-like. Signals: pixel deltaMode, fractional deltas, small
 * high-frequency deltas, simultaneous x/y, ctrlKey pinches with fractional deltas, and the `wheelDeltaY === -3 ·
 * deltaY` pattern of Chromium/Safari on macOS. Mouse signals: line/page deltaMode and big integer notches.
 */
export class TrackpadDetector {
  score = 0;
  samples = 0;
  detected = false;
  static readonly ON = 8;
  static readonly OFF = -4;
  private lastT = -Infinity;

  feed(s: WheelSample): boolean {
    const interval = s.t - this.lastT;
    this.lastT = s.t;
    this.samples++;
    let v = 0;
    const ady = Math.abs(s.dy);
    const adx = Math.abs(s.dx);
    const big = Math.max(ady, adx);
    if (s.mode !== 0) v -= 3;
    else if (s.ctrl) {
      if (isFractional(s.dy)) v += 4;
      else if (ady >= 50) v -= 1;
      else v += 1.5;
    } else {
      if (isFractional(s.dy) || isFractional(s.dx)) v += 1;
      if (adx > 0 && ady > 0) v += 1.5;
      if (big > 0 && big < 10 && interval < 25) v += 0.6;
      if (s.wheelDeltaY && s.wheelDeltaY === -3 * s.dy && ady < 40) v += 0.8;
      if (big >= 50 && Number.isInteger(big) && interval > 30) v -= 1;
      if (s.wheelDeltaY && s.wheelDeltaY % 120 === 0 && ady >= 40) v -= 0.8;
    }
    this.score = Math.max(-10, Math.min(20, this.score + v));
    if (this.score >= TrackpadDetector.ON) this.detected = true;
    else if (this.score <= TrackpadDetector.OFF) this.detected = false;
    return this.detected;
  }

  /** 0..1 for UI ("Looks like you're on a trackpad"). */
  get confidence() {
    return Math.max(0, Math.min(1, this.score / TrackpadDetector.ON));
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Scroll / pinch stepping (thresholded, one step per gesture, re-armed by a quiet gap)

export class GestureStepper {
  private acc = 0;
  private armed = true;
  private lastT = -Infinity;

  constructor(
    public threshold: number,
    public gapMs: number,
  ) {}

  /** Returns -1/+1 when a step fires, else 0. Inertial tails never re-fire because they never leave a gap. */
  feed(delta: number, t: number): -1 | 0 | 1 {
    if (t - this.lastT > this.gapMs) {
      this.armed = true;
      this.acc = 0;
    }
    this.lastT = t;
    if (!this.armed) return 0;
    if (delta !== 0 && Math.sign(delta) !== Math.sign(this.acc)) this.acc = 0;
    this.acc += delta;
    if (Math.abs(this.acc) >= this.threshold) {
      const s = this.acc > 0 ? 1 : -1;
      this.acc = 0;
      this.armed = false;
      return s;
    }
    return 0;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Precision curve

export interface CurveOpts {
  low: number;
  mid: number;
  boost: number;
  high: number;
}

const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - e0) / Math.max(1e-6, e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** Gain vs glide speed (px/s): reduced when slow (precision), 1 at mid speed, boosted when fast (turns). */
export function precisionGain(speed: number, o: CurveOpts): number {
  return o.low + (1 - o.low) * smooth(0, o.mid, speed) + o.boost * smooth(o.mid, o.high, speed);
}

// ---------------------------------------------------------------------------------------------------------------
// Typing suppression ("disable touchpad while typing") detection

/**
 * Windows Precision Touchpad (and some palm rejection) drops touchpad input while keys are held, which breaks
 * WASD + trackpad. Pattern: the finger was gliding right when movement keys went down, deltas then stayed exactly
 * zero for the whole hold, and resumed right after the keys came up. Two such episodes → suspected.
 */
export class TypingSuppressionDetector {
  suspected = false;
  episodes = 0;
  needed = 2;
  private sinceLook = Infinity;
  private keys = false;
  private candidate = false;
  private zeroFor = 0;
  private resumeWindow = 0;

  update(dt: number, looking: boolean, keysHeld: boolean): boolean {
    if (keysHeld && !this.keys) {
      this.candidate = this.sinceLook < 0.15;
      this.zeroFor = 0;
    }
    if (keysHeld && this.candidate) {
      if (looking) this.candidate = false;
      else this.zeroFor += dt;
    }
    if (!keysHeld && this.keys) {
      this.resumeWindow = this.candidate && this.zeroFor >= 0.4 ? 0.5 : 0;
      this.candidate = false;
    }
    if (!keysHeld && this.resumeWindow > 0) {
      if (looking) {
        this.resumeWindow = 0;
        if (++this.episodes >= this.needed) this.suspected = true;
      } else this.resumeWindow -= dt;
    }
    this.keys = keysHeld;
    this.sinceLook = looking ? 0 : this.sinceLook + dt;
    return this.suspected;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Edge glide (turn continuation when the finger hits the pad edge)

export class EdgeGlide {
  minSpeed = 900;
  maxTime = 0.6;
  /** Gap with no deltas that counts as "stopped at the edge" (s). */
  gap = 0.03;
  private history: { v: number; dt: number }[] = [];
  private zero = 0;
  private velocity = 0;
  private t = 0;
  active = false;

  /** Feed this frame's horizontal pixels; returns extra horizontal pixels to inject. */
  update(dx: number, dt: number): number {
    if (dt <= 0) return 0;
    if (dx !== 0) {
      this.active = false;
      this.zero = 0;
      this.history.push({ v: dx / dt, dt });
      let total = 0;
      for (let i = this.history.length - 1; i >= 0; i--) {
        total += this.history[i].dt;
        if (total > 0.15) {
          this.history.splice(0, i);
          break;
        }
      }
      return 0;
    }
    if (this.active) {
      this.t += dt;
      if (this.t > this.maxTime) {
        this.active = false;
        return 0;
      }
      const fade = this.t < this.maxTime * 0.5 ? 1 : 1 - (this.t - this.maxTime * 0.5) / (this.maxTime * 0.5);
      return this.velocity * fade * dt;
    }
    this.zero += dt;
    if (this.zero >= this.gap && this.history.length) {
      const h = this.history;
      this.history = [];
      let time = 0,
        dist = 0;
      for (const s of h) {
        time += s.dt;
        dist += s.v * s.dt;
      }
      const avg = dist / Math.max(1e-6, time);
      const sameDir = h.every((s) => Math.sign(s.v) === Math.sign(avg));
      const last = h[h.length - 1].v;
      if (
        time >= 0.08 &&
        sameDir &&
        Math.abs(avg) >= this.minSpeed &&
        Math.abs(last) >= 0.7 * Math.abs(avg)
      ) {
        this.active = true;
        this.velocity = avg;
        this.t = 0;
        return avg * dt;
      }
    }
    return 0;
  }

  cancel() {
    this.active = false;
    this.history = [];
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Snap turns (animated by emitting look deltas)

export class SnapTurn {
  private total = 0;
  private dur = 0.12;
  private p = 1;

  start(radians: number, duration: number) {
    // Chain onto any turn in progress: finish it instantly in the next step by folding the remainder in.
    const remain = this.total * (1 - ease(this.p));
    this.total = radians + remain;
    this.dur = Math.max(1e-3, duration);
    this.p = 0;
  }

  get busy() {
    return this.p < 1;
  }

  /** Yaw delta (radians) for this frame. */
  step(dt: number): number {
    if (this.p >= 1) return 0;
    const p0 = this.p;
    this.p = Math.min(1, this.p + dt / this.dur);
    return this.total * (ease(this.p) - ease(p0));
  }
}

const ease = (p: number) => p * p * (3 - 2 * p);

// ---------------------------------------------------------------------------------------------------------------

export class Trackpad implements InputSource {
  readonly detector = new TrackpadDetector();
  readonly typing = new TypingSuppressionDetector();
  readonly glide = new EdgeGlide();
  /** Fired once when the heuristic first becomes confident (UI shows "Use the trackpad preset?"). */
  onDetected?: () => void;
  private scroll = new GestureStepper(60, 160);
  private pinch = new GestureStepper(8, 220);
  private snap = new SnapTurn();
  private presses = new Set<ButtonAction>();
  private touched = false;
  private announced = false;
  private gestureScale = 1;
  private gestureFired = false;

  constructor(private aimAssist?: AimAssist) {
    addEventListener('wheel', this.onWheel, { passive: false });
    // Safari pinch.
    addEventListener('gesturestart', this.onGesture as EventListener, { passive: false });
    addEventListener('gesturechange', this.onGesture as EventListener, { passive: false });
    addEventListener('gestureend', this.onGesture as EventListener, { passive: false });
    addEventListener('keydown', this.onKey);
  }

  get detected() {
    return this.detector.detected;
  }

  /** True when the trackpad preset is in effect. */
  get active() {
    const m = trackpadSettings.get().mode;
    return m === 'on' || (m === 'auto' && this.detector.detected);
  }

  /** Pointer lock should keep OS acceleration while the preset is on (`unadjustedMovement: false`). */
  get wantsRawMouse() {
    return !this.active;
  }

  get adsMode() {
    return trackpadSettings.get().adsMode;
  }

  get typingSuppressionSuspected() {
    return this.typing.suspected;
  }

  /** Snap-turn keys claimed (KeyboardMouse ignores them for other actions while snap turns are on). */
  get snapTurns() {
    return this.active && trackpadSettings.get().snapTurns;
  }

  private onWheel = (e: WheelEvent) => {
    const legacy = (e as WheelEvent & { wheelDeltaY?: number }).wheelDeltaY;
    const was = this.detector.detected;
    this.detector.feed({
      dx: e.deltaX,
      dy: e.deltaY,
      mode: e.deltaMode,
      ctrl: e.ctrlKey,
      t: e.timeStamp,
      wheelDeltaY: legacy,
    });
    if (!was && this.detector.detected && !this.announced) {
      this.announced = true;
      this.onDetected?.();
    }
    if (e.ctrlKey) e.preventDefault(); // block page zoom on pinch
    if (!this.active) return;
    const s = trackpadSettings.get();
    const scale = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
    if (e.ctrlKey) {
      if (!s.pinch) return;
      const step = this.pinch.feed(e.deltaY * scale, e.timeStamp);
      if (step < 0) this.presses.add('magnifier'); // spread (zoom in)
      if (step > 0) this.presses.add('aimMode');
    } else if (s.scrollReady && Math.abs(e.deltaY) >= Math.abs(e.deltaX)) {
      this.scroll.threshold = s.scrollThreshold;
      this.scroll.gapMs = s.scrollGapMs;
      const step = this.scroll.feed(e.deltaY * scale, e.timeStamp);
      if (step < 0) this.presses.add('readyUp');
      if (step > 0) this.presses.add('readyDown');
    }
    this.touched = true;
  };

  private onGesture = (e: Event & { scale?: number; type: string }) => {
    e.preventDefault();
    if (e.type === 'gesturestart') {
      this.gestureScale = 1;
      this.gestureFired = false;
      return;
    }
    if (e.type === 'gestureend' || !this.active || !trackpadSettings.get().pinch) return;
    this.gestureScale = e.scale ?? 1;
    if (this.gestureFired) return;
    if (this.gestureScale > 1.15) this.presses.add('magnifier');
    else if (this.gestureScale < 0.87) this.presses.add('aimMode');
    else return;
    this.gestureFired = true;
    this.touched = true;
  };

  private onKey = (e: KeyboardEvent) => {
    if (e.repeat || !this.snapTurns) return;
    const s = trackpadSettings.get();
    const b = { ...DEFAULT_KEY_BINDINGS, ...keySettings.get().bindings };
    const rad = (s.snapDegrees * Math.PI) / 180;
    if (b.snapLeft?.includes(e.code)) this.snap.start(-rad, s.snapTime);
    else if (b.snapRight?.includes(e.code)) this.snap.start(rad, s.snapTime);
  };

  /**
   * Converts raw pointer-lock pixels into look radians for the trackpad preset. `moveHeld` = movement keys down
   * (for typing-suppression detection).
   */
  processLook(
    dx: number,
    dy: number,
    dt: number,
    aiming: boolean,
    moveHeld: boolean,
  ): { yaw: number; pitch: number } {
    const s = trackpadSettings.get();
    this.typing.update(dt, dx !== 0 || dy !== 0, moveHeld);
    this.glide.minSpeed = s.edgeGlideMinSpeed;
    this.glide.maxTime = s.edgeGlideMaxTime;
    if (s.edgeGlide) dx += this.glide.update(dx, dt);
    let gain = s.sensitivity;
    const speed = dt > 0 ? Math.hypot(dx, dy) / dt : 0;
    if (s.precisionCurve) {
      gain *= precisionGain(speed, {
        low: s.curveLowGain,
        mid: s.curveMidSpeed,
        boost: s.curveBoost,
        high: s.curveHighSpeed,
      });
      if (aiming && speed < s.microSpeed) gain *= s.microGain;
    }
    if (aiming) gain *= s.adsMultiplier;
    const look = { yaw: dx * gain, pitch: -dy * gain * (s.invertY ? -1 : 1) };
    if (s.aimAssist) this.aimAssist?.apply(look, Math.min(1, speed / s.curveHighSpeed));
    return look;
  }

  poll(frame: ActionFrame, dt: number): void {
    for (const p of this.presses) frame.pressed.add(p);
    this.presses.clear();
    const yaw = this.snap.step(dt);
    if (yaw) {
      frame.look.yaw += yaw;
      this.touched = true;
    }
    if (this.touched && this.active) frame.activeDevice = 'trackpad';
    this.touched = false;
  }
}
