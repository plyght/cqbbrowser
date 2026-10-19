import { clamp } from '../../core/math';

/**
 * Toy H.264 rate-control model for the CAM04 encoder look.
 * - Fast camera rotation blows the bit budget: quantisation spikes and holds for a few frames (starvation),
 *   then recovers.
 * - A GOP of ~1 s: quality is best right after an I-frame and drifts down until the next one ("breathing").
 * Output is a 0..1 `starve` level and a 0..1 `gop` drift, both consumed by the post shader.
 */
export class BitrateModel {
  /** Rad/s where starvation starts / saturates. */
  lo = 1.6;
  hi = 7;
  /** GOP length in seconds. */
  gopLength = 1.0;
  starve = 0;
  gop = 0;
  private hold = 0;
  private gopT = 0;
  private frameAcc = 0;

  /** Force a spike (power-on garbage frames, glitches). */
  kick(level = 1, holdSeconds = 0.1) {
    this.starve = Math.max(this.starve, level);
    this.hold = Math.max(this.hold, holdSeconds);
  }

  update(dt: number, angularSpeed: number) {
    const demand = clamp((angularSpeed - this.lo) / (this.hi - this.lo), 0, 1);
    if (demand > this.starve) {
      // Rate control reacts within a frame; once starved it holds 2–6 frames (longer for harder spikes).
      this.starve = demand;
      this.hold = (2 + demand * 4) / 30;
    } else if (this.hold > 0) {
      this.hold -= dt;
    } else {
      this.starve = Math.max(demand, this.starve - dt * 3.5);
    }
    // GOP drift advances at the 30 fps encode cadence.
    this.frameAcc += dt;
    this.gopT += dt;
    if (this.gopT >= this.gopLength) {
      this.gopT -= this.gopLength;
      // A new I-frame clears accumulated drift; fast motion also forces an early I-frame (scene cut).
    } else if (this.starve > 0.8 && this.gopT > 0.4) {
      this.gopT = 0;
    }
    this.gop = this.gopT / this.gopLength;
  }
}
