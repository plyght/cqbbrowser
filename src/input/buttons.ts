/**
 * Button interaction helpers (PRD §7.1 "hold/toggle per action"). Pure; unit-tested.
 */

/** hold = momentary, toggle = press flips, hybrid = tap flips / hold is momentary. */
export type HoldMode = 'hold' | 'toggle' | 'hybrid';

/** Threshold separating a tap from a hold (seconds). */
export const TAP_MAX = 0.25;

/** Converts a physical button into a logical "on" state according to a HoldMode. */
export class ModalButton {
  on = false;
  private prev = false;
  private held = 0;
  private flippedOnPress = false;

  constructor(public mode: HoldMode = 'hold') {}

  update(down: boolean, dt: number): boolean {
    const pressed = down && !this.prev;
    const released = !down && this.prev;
    this.prev = down;
    if (down) this.held += dt;
    switch (this.mode) {
      case 'hold':
        this.on = down;
        break;
      case 'toggle':
        if (pressed) this.on = !this.on;
        break;
      case 'hybrid':
        if (pressed) {
          this.flippedOnPress = !this.on;
          this.on = true;
          this.held = 0;
        }
        if (released) {
          // Tap: keep the state that the press produced (toggle). Hold: momentary → off on release.
          if (this.held > TAP_MAX || !this.flippedOnPress) this.on = false;
        }
        break;
    }
    if (!down && !released) this.held = 0;
    return this.on;
  }

  reset() {
    this.on = this.prev = false;
    this.held = 0;
  }
}

/**
 * For actions the game treats as a toggle-on-press (crouch): emits "flip" pulses so that hold/hybrid modes can be
 * expressed purely as press events, keeping the player's own toggle state in sync. Returns true on frames that
 * should emit a press.
 */
export class FlipButton {
  private prev = false;
  private held = 0;

  constructor(public mode: HoldMode = 'toggle') {}

  update(down: boolean, dt: number): boolean {
    const pressed = down && !this.prev;
    const released = !down && this.prev;
    this.prev = down;
    if (pressed) this.held = 0;
    if (down) this.held += dt;
    if (pressed) return true;
    if (released) {
      if (this.mode === 'hold') return true;
      if (this.mode === 'hybrid' && this.held > TAP_MAX) return true;
    }
    return false;
  }
}

/**
 * Tap-vs-hold splitter for buttons with two meanings (D-pad up: tap = aim mode, hold = magnifier).
 * `tap` is true for one frame on a short release; `hold` is true while held past `threshold`.
 */
export class TapHold {
  private prev = false;
  private held = 0;
  tap = false;
  hold = false;

  constructor(public threshold = TAP_MAX) {}

  update(down: boolean, dt: number): this {
    this.tap = false;
    if (down) {
      this.held = this.prev ? this.held + dt : 0;
      this.hold = this.held >= this.threshold;
    } else {
      if (this.prev && this.held < this.threshold) this.tap = true;
      this.hold = false;
      this.held = 0;
    }
    this.prev = down;
    return this;
  }
}

/** True once the button has been held continuously for `threshold` seconds (e.g. hold-to-restart). */
export class HoldGate {
  private held = 0;
  constructor(public threshold: number) {}
  update(down: boolean, dt: number): boolean {
    this.held = down ? this.held + dt : 0;
    return this.held >= this.threshold;
  }
}
