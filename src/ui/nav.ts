/** Pure helpers for menu focus navigation (spatial picking, stick auto-repeat). DOM-free so they unit-test. */

export type Dir = 'up' | 'down' | 'left' | 'right';

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Pick the best candidate to move focus to from `from` in direction `dir`.
 * Candidates must lie in that half-plane; the score favours alignment (overlap on the cross axis) over raw distance,
 * so moving down a column stays in the column. Returns -1 when nothing lies that way.
 */
export function pickNext(from: Box, cands: Box[], dir: Dir): number {
  const horiz = dir === 'left' || dir === 'right';
  const sign = dir === 'right' || dir === 'down' ? 1 : -1;
  const fc = { x: from.x + from.w / 2, y: from.y + from.h / 2 };
  let best = -1;
  let bestScore = Infinity;
  cands.forEach((c, i) => {
    if (c === from) return;
    const cc = { x: c.x + c.w / 2, y: c.y + c.h / 2 };
    // Distance along the travel axis, edge to edge (so wide/tall boxes aren't penalised).
    const along = horiz
      ? sign > 0
        ? c.x - (from.x + from.w)
        : from.x - (c.x + c.w)
      : sign > 0
        ? c.y - (from.y + from.h)
        : from.y - (c.y + c.h);
    const centreAlong = horiz ? (cc.x - fc.x) * sign : (cc.y - fc.y) * sign;
    if (centreAlong <= 1 || along < -Math.min(horiz ? from.w : from.h, horiz ? c.w : c.h) / 2) return;
    const overlap = horiz
      ? Math.min(from.y + from.h, c.y + c.h) - Math.max(from.y, c.y)
      : Math.min(from.x + from.w, c.x + c.w) - Math.max(from.x, c.x);
    const ortho = overlap > 0 ? 0 : horiz ? Math.abs(cc.y - fc.y) : Math.abs(cc.x - fc.x);
    const score = Math.max(0, along) + ortho * 3 + (overlap > 0 ? 0 : 40);
    if (score < bestScore) {
      bestScore = score;
      best = i;
    }
  });
  return best;
}

/**
 * Auto-repeat for a held direction (stick or D-pad): fires once on press, then after `delay`, then every `rate`.
 * `update` returns true on frames where a step should happen.
 */
export class Repeater {
  private held = 0;
  private next = 0;
  constructor(
    public delay = 0.38,
    public rate = 0.09,
  ) {}

  update(active: boolean, dt: number): boolean {
    if (!active) {
      this.held = 0;
      return false;
    }
    const first = this.held === 0;
    this.held += dt;
    if (first) {
      this.next = this.delay;
      return true;
    }
    if (this.held >= this.next) {
      this.next += this.rate;
      return true;
    }
    return false;
  }
}

/** Dominant stick direction with a deadzone, or null. */
export function stickDir(x: number, y: number, dead = 0.5): Dir | null {
  if (Math.hypot(x, y) < dead) return null;
  return Math.abs(x) > Math.abs(y) ? (x > 0 ? 'right' : 'left') : y > 0 ? 'down' : 'up';
}

/** Snap a slider value to its step and clamp it to [min, max]. */
export function stepValue(v: number, delta: number, min: number, max: number, step: number): number {
  const n = Math.round((v + delta - min) / step) * step + min;
  return Math.min(max, Math.max(min, +n.toFixed(6)));
}

/** "+0.42" / "−0.31" style delta (true minus sign), seconds. */
export function fmtDelta(s: number): string {
  if (Math.abs(s) < 0.005) return '±0.00';
  return (s < 0 ? '−' : '+') + Math.abs(s).toFixed(2);
}

/** Shot-timer style time: 12.34 or 1:02.34. */
export function fmtTime(s: number): string {
  if (!Number.isFinite(s)) return '—';
  if (s < 60) return s.toFixed(2);
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(2).padStart(5, '0')}`;
}
