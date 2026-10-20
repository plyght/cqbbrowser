import type { Bus } from '../core/bus';
import { settings } from '../settings/Settings';
import type { TriggerEffect } from './sonyHid';

/**
 * Turns game events into controller vibration. Effects are short voices (strong/weak motor + trigger
 * motors) mixed every tick and sent at ~40 Hz, so overlapping events (a shot during a mag seat, steel
 * pinging back) layer instead of cutting each other off — `playEffect` and HID reports both *replace*
 * whatever the pad was doing.
 *
 * Sinks: the Gamepad API (`dual-rumble` on Xbox / PlayStation / most pads in Chromium, `trigger-rumble` on
 * Xbox impulse triggers, Firefox `pulse`) and, when a DualSense/DS4 is attached over WebHID, direct HID
 * rumble + DualSense adaptive-trigger resistance (preferred for Sony pads: it works on every OS).
 */
export interface HapticsSink {
  /** Dual-motor rumble for the next `ms`. */
  dual(strong: number, weak: number, ms: number): void;
  /** Xbox impulse-trigger motors; no-op where unsupported. */
  triggers?(left: number, right: number, ms: number): void;
}

export interface SonySink {
  readonly pad: 'dualsense' | 'ds4' | null;
  rumble(r: {
    strong: number;
    weak: number;
    leftTrigger?: TriggerEffect;
    rightTrigger?: TriggerEffect;
  }): boolean;
}

interface Voice {
  t0: number;
  dur: number;
  strong: number;
  weak: number;
  trigL: number;
  trigR: number;
  /** 0 = flat, 1 = linear decay, 2 = sharp (exponential-ish) decay. */
  shape: 0 | 1 | 2;
}

export const hapticsPrefs = settings.ns('input.haptics', {
  /** DualSense adaptive-trigger resistance (WebHID only). */
  adaptiveTriggers: true,
  /** Footstep thumps (subtle walking, clear sprinting). */
  footsteps: true,
});

const TICK = 1 / 40;

/**
 * Perceptual curve: rumble motors barely spin below ~10–15 % drive, so small effects (footsteps, ADS ticks,
 * detents) were silent. Any non-trivial request gets at least the spin-up floor; the top end is unchanged.
 */
export function felt(v: number): number {
  if (v <= 0.005) return 0;
  return Math.min(1, 0.12 + 0.88 * Math.pow(v, 0.8));
}
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Trigger resistance per weapon family: where the take-up ends and how stiff the wall feels. */
function triggerFor(weaponId: string | undefined): TriggerEffect {
  if (!weaponId) return { mode: 'off' };
  if (weaponId.startsWith('p') && !weaponId.startsWith('pm'))
    return { mode: 'section', start: 0.3, end: 0.62, force: 0.75 };
  if (weaponId.startsWith('pm')) return { mode: 'section', start: 0.2, end: 0.8, force: 0.6 };
  return { mode: 'section', start: 0.35, end: 0.58, force: 0.55 };
}

export class HapticsDirector {
  private voices: Voice[] = [];
  private now = 0;
  private acc = 0;
  private wasActive = false;
  private weaponId: string | undefined;
  private triggerDirty = true;
  /** Gate: only vibrate while a controller is the active device. */
  enabled = () => true;
  /** Master strength 0..1 for the HID path (the Gamepad API sink applies its own settings). */
  strength = () => 1;

  constructor(
    bus: Bus,
    private pad: HapticsSink,
    private sony: SonySink | null = null,
  ) {
    bus.on('shot', (e) => {
      if (e.weaponId !== this.weaponId) {
        this.weaponId = e.weaponId;
        this.triggerDirty = true;
      }
      // Modern-shooter weight: every shot is a hard, clearly felt hit on the strong motor, scaled by the
      // free-recoil energy (~1.7 J 9 mm SMG, ~4 J 9 mm pistol, ~5–6 J 5.56 / 7.62×39).
      const j = e.recoil?.energyJ ?? (e.caliber === '7.62x39' ? 6 : e.caliber === '9mm' ? 4 : 5);
      const sup = e.suppressed ? 0.85 : 1;
      const pistol = e.caliber === '9mm' && /^p(?!m)/.test(e.weaponId);
      if (pistol) {
        // Sharp ~0.7 snap: short and fast-decaying, plus the slide cycling on the weak motor.
        this.play(70, clamp01(0.62 + j * 0.02) * sup, 0.55 * sup, 0, 0.9, 2);
        this.play(45, 0, 0.4 * sup, 0, 0, 2, 0.025);
      } else {
        // Rifles / SMGs: 0.8–1.0 strong thump with a short weak-motor tail of the action cycling.
        this.play(80 + j * 6, clamp01(0.72 + j * 0.045) * sup, clamp01(0.5 + j * 0.05) * sup, 0, 0.85, 1);
        this.play(70, 0.15 * sup, 0.45 * sup, 0, 0, 1, 0.035);
      }
    });
    bus.on('dryFire', () => this.play(40, 0.1, 0.45, 0, 0.7, 2));
    bus.on('weaponBeat', (e) => {
      const s = e.stressed ? 1.1 : 1;
      switch (e.beat) {
        case 'magRelease':
          return this.play(45, 0.2 * s, 0.45 * s, 0, 0, 2);
        case 'magOut':
          return this.play(80, 0.35 * s, 0.4 * s, 0, 0, 1);
        case 'magCheckOut':
        case 'magCheckIn':
          return this.play(60, 0.3 * s, 0.4 * s, 0, 0, 2);
        case 'magIn':
          return this.play(60, 0.4 * s, 0.45 * s, 0, 0, 2);
        case 'magSeat':
          return this.play(110, 0.85 * s, 0.7 * s, 0, 0, 2);
        case 'boltRelease':
        case 'chargingHandle':
        case 'slideRelease':
        case 'slide':
          return this.play(110, 0.8 * s, 0.75 * s, 0, 0.4, 2);
        case 'magCheck':
          return this.play(50, 0.2, 0.35, 0, 0, 1);
        case 'swapMid':
          return this.play(70, 0.35, 0.3, 0, 0, 2);
        case 'draw':
        case 'unsling':
          return this.play(90, 0.3, 0.35, 0, 0, 1);
        case 'holster':
        case 'sling':
          return this.play(70, 0.25, 0.3, 0, 0, 1);
        case 'camFix':
          return this.play(40, 0.1, 0.35, 0, 0, 2);
        default:
          return this.play(45, 0.2, 0.3, 0, 0, 2);
      }
    });
    bus.on('magDrop', () => this.play(60, 0.3, 0.2, 0, 0, 2, 0.32));
    bus.on('steelHit', (e) => {
      // Ring back at the speed of sound; close plates are felt, far ones a faint tick.
      const k = clamp01(0.6 - e.distance * 0.012);
      if (k > 0.02) this.play(45, k * 0.4, k, 0, 0, 2, e.distance / 343);
    });
    bus.on('targetHit', (e) => {
      if (e.kind === 'paper') this.play(35, 0, e.noShoot ? 0.5 : 0.25, 0, 0, 2);
    });
    bus.on('footstep', (e) => {
      if (!hapticsPrefs.get().footsteps || e.speed < 0.6) return;
      // Subtle heel strike walking, a clear thud sprinting.
      const k = clamp01((e.speed - 0.6) / 4.2);
      this.play(45 + k * 25, 0.08 + k * 0.3, 0.03 + k * 0.08, 0, 0, 1);
    });
    bus.on('land', (e) => {
      const k = clamp01(e.speed / 6);
      this.play(110 + k * 80, 0.35 + k * 0.6, 0.25 + k * 0.35, 0, 0, 2);
    });
    // Shoulder against a wall or a stumble on a step: a short soft tick (landings have their own).
    bus.on('bodyBump', (e) => {
      if (e.kind === 'land') return;
      this.play(70, 0.1 + e.strength * 0.25, 0.04 + e.strength * 0.1, 0, 0, 1);
    });
    bus.on('ads', (e) => this.play(30, e.on ? 0.12 : 0.08, e.on ? 0.3 : 0.22, 0, 0, 2));
    bus.on('gearSound', (e) => {
      if (e.kind === 'nvgDown' || e.kind === 'nvgUp') return this.play(40, 0.25, 0.5, 0, 0, 2);
      if (e.kind === 'irClick') return this.play(25, 0, 0.35, 0, 0, 2);
      if (e.kind === 'pin') return this.play(35, 0.1, 0.35, 0, 0, 2);
      if (e.kind === 'throw') return this.play(80, 0.25, 0.2, 0, 0, 1);
    });
    bus.on('flashbang', (e) => {
      // Heavy and long: a concussive slam, then a rolling decay (felt through the floor and the carrier).
      const k = clamp01(Math.max(e.hearing, e.visual * 0.8, e.indoor ? 0.6 : 0.4) * (e.training ? 0.6 : 1));
      const delay = e.distance / 343;
      this.play(220, k, k, 0, 0, 2, delay);
      this.play(900, k * 0.55, k * 0.4, 0, 0, 1, delay + 0.05);
    });
    bus.on('flinch', (e) => {
      if (e.cause !== 'flashbang') this.play(250, e.strength * 0.8, e.strength * 0.6, 0, 0, 2);
    });
    bus.on('timerBeep', () => this.play(70, 0.1, 0.45, 0, 0, 0));
  }

  /** Queue an effect. Public so other systems (flashbangs, door kicks) can add their own. */
  play(ms: number, strong: number, weak: number, trigL = 0, trigR = 0, shape: 0 | 1 | 2 = 1, delayS = 0) {
    if (this.voices.length > 24) this.voices.shift();
    this.voices.push({ t0: this.now + delayS, dur: ms / 1000, strong, weak, trigL, trigR, shape });
    if (delayS <= 0) this.fresh = true;
  }

  /** A voice started since the last send: send on the next update instead of waiting for the tick. */
  private fresh = false;
  private lastSend = 0;

  /**
   * Mix of all live voices at `t` (soft-sum so stacked effects grow but never clip). Exposed for tests. With
   * `since`, each voice is taken at its loudest point in (since, t] — envelopes only decay, so that is the
   * later of `since` and its start: a 45 ms snap sampled 25 ms late used to send a third of its peak.
   */
  mix(t: number, since = t) {
    let s = 0,
      w = 0,
      l = 0,
      r = 0;
    for (const v of this.voices) {
      if (t < v.t0 || t > v.t0 + v.dur + (t - since)) continue;
      const x = Math.min(1, (Math.max(since, v.t0) - v.t0) / v.dur);
      const env = v.shape === 0 ? 1 : v.shape === 1 ? 1 - x : (1 - x) * (1 - x);
      s = 1 - (1 - s) * (1 - v.strong * env);
      w = 1 - (1 - w) * (1 - v.weak * env);
      l = Math.max(l, v.trigL * env);
      r = Math.max(r, v.trigR * env);
    }
    return { strong: s, weak: w, trigL: l, trigR: r };
  }

  update(dt: number) {
    this.now += dt;
    this.acc += dt;
    if (this.acc < TICK && !this.fresh) return;
    this.acc = 0;
    this.fresh = false;
    const since = this.lastSend;
    this.lastSend = this.now;
    const on = this.enabled();
    const sony = this.sony?.pad ? this.sony : null;
    const k = on ? (sony ? this.strength() : 1) : 0;
    const m = this.mix(this.now, since);
    this.voices = this.voices.filter((v) => this.now < v.t0 + v.dur);
    const strong = clamp01(felt(m.strong) * k);
    const weak = clamp01(felt(m.weak) * k);
    const active = strong > 0.01 || weak > 0.01 || m.trigL > 0.01 || m.trigR > 0.01;
    if (!active && !this.wasActive && !this.triggerDirty) return;
    this.wasActive = active;
    // Each send replaces the last effect: last ~3 ticks so a late frame never leaves a gap (Chromium also drops
    // effects shorter than about a frame).
    const ms = Math.round(TICK * 1000 * 3);
    if (sony) {
      const adaptive = sony.pad === 'dualsense' && hapticsPrefs.get().adaptiveTriggers && on;
      const fx = this.triggerDirty
        ? adaptive
          ? triggerFor(this.weaponId)
          : { mode: 'off' as const }
        : undefined;
      if (sony.rumble({ strong, weak, rightTrigger: fx })) this.triggerDirty = false;
      else {
        // HID report still in flight: retry next frame with the same window (keeps the peak).
        this.fresh = true;
        this.lastSend = since;
      }
      return;
    }
    this.triggerDirty = false;
    this.pad.dual(strong, weak, active ? ms : 0);
    if (m.trigL > 0.01 || m.trigR > 0.01) this.pad.triggers?.(m.trigL * k, m.trigR * k, ms);
  }
}
