import { clamp } from '../core/math';

/**
 * Hysteresis controller for render resolution scale.
 * - Frame time EMA above budget for `downAfter` seconds → step down.
 * - Comfortably under budget (or vsync-pinned at the target) for `probeAfter` seconds → probe one step up.
 *   A probe that immediately misses budget backs off and doubles the wait before the next probe, so a
 *   vsync-locked display doesn't oscillate.
 */
export class DynamicResolution {
  min = 0.6;
  max = 1;
  step = 0.05;
  targetFps = 60;
  scale = 1;
  enabled = true;
  private ema = 0;
  private over = 0;
  private under = 0;
  private probeWait = 3;
  private sinceProbe = Infinity;

  /** Returns true when `scale` changed. */
  update(dt: number): boolean {
    if (!this.enabled || dt <= 0 || dt > 0.25) return false;
    const budget = 1 / this.targetFps;
    this.ema = this.ema === 0 ? dt : this.ema + (dt - this.ema) * 0.1;
    this.sinceProbe += dt;
    const prev = this.scale;
    if (this.ema > budget * 1.12) {
      this.over += dt;
      this.under = 0;
      if (this.over > 0.5) {
        // A failed probe → wait longer next time.
        if (this.sinceProbe < 2) this.probeWait = Math.min(this.probeWait * 2, 60);
        this.scale -= this.ema > budget * 1.5 ? this.step * 2 : this.step;
        this.over = 0;
        this.ema = budget;
      }
    } else if (this.ema < budget * 1.04) {
      this.under += dt;
      this.over = 0;
      // Real headroom (not just vsync-pinned) → probe sooner.
      const wait = this.ema < budget * 0.85 ? 1 : this.probeWait;
      if (this.under > wait && this.scale < this.max) {
        this.scale += this.step;
        this.under = 0;
        this.sinceProbe = 0;
      }
    } else {
      this.over = Math.max(0, this.over - dt);
      this.under = 0;
    }
    this.scale = clamp(Math.round(this.scale * 100) / 100, this.min, this.max);
    return this.scale !== prev;
  }
}
