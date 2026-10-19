/**
 * Helmet-mounted NVG (flip-up mount + image intensifier power), as a small pure state machine. The mount
 * takes ~0.4 s to flip; the tube auto-powers when it reaches the eye (spin-up ~0.25 s with the image swirling
 * into place) and auto-shuts off as soon as it's flipped up.
 */
export const FLIP_S = 0.4;
const SPINUP_S = 0.28;

export type MountState = 'up' | 'lowering' | 'down' | 'raising';
export type MountEvent = 'flipStart' | 'detentDown' | 'detentUp' | 'powerOn' | 'powerOff';

export class NvgMount {
  state: MountState = 'up';
  /** 0 = stowed up on the helmet, 1 = in front of the eye. */
  flip = 0;
  private onT = 0;
  private powered = false;

  /** Flip down if up (or going up), up if down (or going down). */
  toggle(): MountEvent[] {
    if (this.state === 'up' || this.state === 'raising') this.state = 'lowering';
    else this.state = 'raising';
    const ev: MountEvent[] = ['flipStart'];
    if (this.state === 'raising' && this.powered) {
      this.powered = false;
      ev.push('powerOff');
    }
    return ev;
  }

  get isDown() {
    return this.state === 'down' || this.state === 'lowering';
  }

  update(dt: number): MountEvent[] {
    const ev: MountEvent[] = [];
    if (this.state === 'lowering') {
      this.flip = Math.min(1, this.flip + dt / FLIP_S);
      if (this.flip >= 1) {
        this.state = 'down';
        ev.push('detentDown');
      }
    } else if (this.state === 'raising') {
      this.flip = Math.max(0, this.flip - dt / FLIP_S);
      if (this.flip <= 0) {
        this.state = 'up';
        ev.push('detentUp');
      }
    }
    if (this.state === 'down' && !this.powered) {
      this.powered = true;
      this.onT = 0;
      ev.push('powerOn');
    }
    if (this.powered) this.onT += dt;
    return ev;
  }

  /** Intensifier output ramp 0..1. */
  get power() {
    if (!this.powered) return 0;
    const k = Math.min(1, this.onT / SPINUP_S);
    return k * k * (3 - 2 * k);
  }

  /** Image swirl at power-on (radians at the tube centre), fading to nothing. */
  get swirl() {
    if (!this.powered) return 0;
    const k = Math.max(0, 1 - this.onT / (SPINUP_S * 1.4));
    return 1.6 * k * k;
  }
}
