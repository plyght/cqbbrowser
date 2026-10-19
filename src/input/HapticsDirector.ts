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
  /** Light thumps on sprinting footsteps. */
  footsteps: true,
});

const TICK = 1 / 40;
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
      // Free-recoil energy drives the hit: ~1.7 J (9 mm SMG) → soft, ~6 J (AK, 9 mm pistol) → hard.
      const j = e.recoil?.energyJ ?? (e.caliber === '7.62x39' ? 6 : e.caliber === '9mm' ? 4 : 4);
      const k = clamp01(0.2 + j * 0.11);
      const sup = e.suppressed ? 0.75 : 1;
      this.play(90 + j * 8, k * sup, clamp01(0.55 + j * 0.06), 0, 0.85, 1);
      // Short trailing "buzz" of the action cycling.
      this.play(55, 0, 0.35 * sup, 0, 0.3, 1, 0.03);
    });
    bus.on('dryFire', () => this.play(30, 0, 0.25, 0, 0.6, 2));
    bus.on('weaponBeat', (e) => {
      const s = e.stressed ? 1.15 : 1;
      switch (e.beat) {
        case 'magRelease':
          return this.play(35, 0.05, 0.25 * s, 0, 0, 2);
        case 'magOut':
        case 'magCheckOut':
          return this.play(70, 0.18 * s, 0.25 * s, 0, 0, 1);
        case 'magIn':
        case 'magCheckIn':
          return this.play(50, 0.25 * s, 0.3 * s, 0, 0, 2);
        case 'magSeat':
          return this.play(85, 0.6 * s, 0.55 * s, 0, 0, 2);
        case 'boltRelease':
        case 'chargingHandle':
        case 'slideRelease':
        case 'slide':
          return this.play(90, 0.55 * s, 0.6 * s, 0, 0.3, 2);
        case 'magCheck':
          return this.play(45, 0.08, 0.18, 0, 0, 1);
        default:
          return this.play(35, 0.08, 0.15, 0, 0, 2);
      }
    });
    bus.on('magDrop', () => this.play(45, 0.18, 0.12, 0, 0, 2, 0.32));
    bus.on('steelHit', (e) =>
      this.play(35, 0, clamp01(0.32 - e.distance * 0.004), 0, 0, 2, e.distance / 343),
    );
    bus.on('targetHit', (e) => {
      if (e.kind === 'paper') this.play(28, 0, e.noShoot ? 0.35 : 0.14, 0, 0, 2);
    });
    bus.on('footstep', (e) => {
      if (!hapticsPrefs.get().footsteps || e.speed < 3.2) return;
      this.play(45, 0.1, 0.03, 0, 0, 1);
    });
    bus.on('timerBeep', () => this.play(70, 0, 0.4, 0, 0, 0));
  }

  /** Queue an effect. Public so other systems (flashbangs, door kicks) can add their own. */
  play(ms: number, strong: number, weak: number, trigL = 0, trigR = 0, shape: 0 | 1 | 2 = 1, delayS = 0) {
    if (this.voices.length > 24) this.voices.shift();
    this.voices.push({ t0: this.now + delayS, dur: ms / 1000, strong, weak, trigL, trigR, shape });
  }

  /** Mix of all live voices at `t` (soft-sum so stacked effects grow but never clip). Exposed for tests. */
  mix(t: number) {
    let s = 0,
      w = 0,
      l = 0,
      r = 0;
    for (const v of this.voices) {
      const x = (t - v.t0) / v.dur;
      if (x < 0 || x > 1) continue;
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
    if (this.acc < TICK) return;
    this.acc = 0;
    this.voices = this.voices.filter((v) => this.now < v.t0 + v.dur);
    const on = this.enabled();
    const sony = this.sony?.pad ? this.sony : null;
    const k = on ? (sony ? this.strength() : 1) : 0;
    const m = this.mix(this.now);
    const strong = clamp01(m.strong * k);
    const weak = clamp01(m.weak * k);
    const active = strong > 0.01 || weak > 0.01 || m.trigL > 0.01 || m.trigR > 0.01;
    if (!active && !this.wasActive && !this.triggerDirty) return;
    this.wasActive = active;
    const ms = Math.round(TICK * 1000 * 2.5); // overlap ticks so a late frame never leaves a gap
    if (sony) {
      const adaptive = sony.pad === 'dualsense' && hapticsPrefs.get().adaptiveTriggers && on;
      const fx = this.triggerDirty
        ? adaptive
          ? triggerFor(this.weaponId)
          : { mode: 'off' as const }
        : undefined;
      if (sony.rumble({ strong, weak, rightTrigger: fx })) this.triggerDirty = false;
      return;
    }
    this.triggerDirty = false;
    this.pad.dual(strong, weak, active ? ms : 0);
    if (m.trigL > 0.01 || m.trigR > 0.01) this.pad.triggers?.(m.trigL * k, m.trigR * k, ms);
  }
}
