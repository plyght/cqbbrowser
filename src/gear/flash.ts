/**
 * Flashbang maths (pure, unit-tested): fuse timing, the listener-side exposure model and the CAM04 white-out
 * envelope. An M84-class device: ~1.5 s fuse after the spoon flies, ~170 dB at 1.5 m, 6–8 Mcd flash.
 */

/** Nominal fuse after spoon release (s). Real M84s run 1.0–2.3 s; a training sim is consistent. */
export const FUSE_S = 1.5;

/**
 * Fuse: armed when the spoon leaves (on release, or early if you cook it in hand). Fires exactly once.
 */
export class Fuse {
  armed = false;
  fired = false;
  remaining: number;

  constructor(readonly length = FUSE_S) {
    this.remaining = length;
  }

  arm() {
    this.armed = true;
  }

  /** Advances the fuse; true on the step it goes off. */
  update(dt: number): boolean {
    if (!this.armed || this.fired) return false;
    this.remaining -= dt;
    if (this.remaining <= 0) {
      this.fired = true;
      return true;
    }
    return false;
  }

  /** Seconds since the spoon flew (how long it has cooked). */
  get cooked() {
    return this.armed ? this.length - Math.max(0, this.remaining) : 0;
  }
}

export interface FlashGeometry {
  /** Listener (camera) to bang, metres. */
  distance: number;
  /** Clear line of sight from the camera to the device. */
  los: boolean;
  /** cos(angle) between the camera's forward axis and the direction to the bang (1 = dead ahead). */
  cosAngle: number;
  /** The bang is inside a roofed space (light and pressure bounce around instead of escaping). */
  indoor: boolean;
  /** Listener and bang share the same room. */
  sameRoom: boolean;
  /** Training flash-bang simulator (reduced charge). */
  training?: boolean;
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * Sensor exposure 0..1 the CAM04 gets from a bang: direct light (line of sight, falling with distance and with
 * how far off-axis it is) plus bounce light (strong in the same small room even facing away, weak through a
 * doorway, nearly nothing outdoors). Saturating: anything close in the same room whites the camera out.
 */
export function flashVisual(g: FlashGeometry): number {
  const prox = 1 / (1 + (g.distance / 5) ** 2);
  const facing = 0.3 + 0.7 * smooth(-0.3, 0.75, g.cosAngle);
  const direct = g.los ? prox * facing * 1.6 : 0;
  const bounceRange = 1 / (1 + (g.distance / 7) ** 2);
  const bounce = g.indoor ? (g.sameRoom ? 0.75 : g.los ? 0.4 : 0.16) * bounceRange : 0.06 * prox;
  const raw = (direct + bounce) * (g.training ? 0.5 : 1);
  return Math.min(1, 1 - Math.exp(-2.2 * raw));
}

/**
 * Hearing exposure 0..1 (tinnitus level + how muffled everything gets): pressure falls ~1/r, an enclosed room
 * keeps it high (reflections), walls in between cut some of it.
 */
export function flashHearing(g: FlashGeometry): number {
  const r = 1 / (1 + (g.distance / 6) ** 2);
  const room = g.indoor ? (g.sameRoom ? 1.35 : 1.0) : 0.7;
  const path = g.los || g.sameRoom ? 1 : 0.6;
  const raw = r * room * path * (g.training ? 0.55 : 1);
  return Math.min(1, 1 - Math.exp(-2.4 * raw));
}

/** Seconds the camera stays blown out, and its recovery time constant, for a visual exposure. */
export function whiteoutShape(visual: number) {
  return { hold: 0.1 + 0.6 * visual ** 1.5, tau: 0.3 + 1.0 * visual };
}

/** White-out level `t` seconds after the bang. */
export function whiteoutAt(visual: number, t: number): number {
  if (t < 0 || visual <= 0) return 0;
  const { hold, tau } = whiteoutShape(visual);
  const peak = Math.min(1, visual * 1.15);
  if (t <= hold) return peak;
  return peak * Math.exp(-(t - hold) / tau);
}
