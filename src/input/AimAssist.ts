import { settings } from '../settings/Settings';
import { ASSIST_CAPS, ASSIST_TUNE, aimAssistSettings, type AssistMode, type AssistTune } from './config';

const DEG = Math.PI / 180;

interface V3 {
  x: number;
  y: number;
  z: number;
}

/** A thing the assist may help with. No-shoots are passed through so the assist can reason about them, then skipped. */
export interface AssistTarget {
  id: string;
  /** World point to aim at (centre of the scoring area). */
  pos: V3;
  /** Half-size of the hitbox in metres (angular size = atan(radius / distance)). */
  radius: number;
  noShoot: boolean;
}

/** Rough hitbox half-size by target kind (metres). */
export function assistRadius(kind: string): number {
  switch (kind) {
    case 'paper':
      return 0.22;
    case 'gong':
    case 'popper':
    case 'star':
      return 0.15;
    default:
      return 0.1;
  }
}

export interface AssistScene {
  /** Camera position and forward (the reticle / ADS sight line). */
  eye: V3;
  camDir: V3;
  /** Weapon bore ray. */
  muzzle: V3;
  boreDir: V3;
  targets: Iterable<AssistTarget>;
}

/**
 * Friction factor (0..1 multiplier on look deltas) for a given angular distance from the aim ray to a target
 * hitbox. Full `strength` inside `inner`, smoothstep fade to none at `outer`.
 */
export function frictionFactor(angle: number, strength: number, inner: number, outer: number): number {
  if (!(angle < outer) || strength <= 0) return 1;
  return 1 - Math.min(1, strength) * falloff(angle, inner, outer);
}

/** 1 up to `inner`, smoothly 0 at `outer`. */
export function falloff(angle: number, inner: number, outer: number): number {
  if (!(angle < outer)) return 0;
  const t = angle <= inner ? 1 : 1 - (angle - inner) / Math.max(1e-6, outer - inner);
  return t * t * (3 - 2 * t);
}

/** 1 below 70% intensity, smoothly 0 at full intensity: flicks and full-speed turns are never sticky. */
export function fastTurnFade(intensity: number): number {
  const t = Math.max(0, Math.min(1, (intensity - 0.7) / 0.3));
  return 1 - t * t * (3 - 2 * t);
}

const bearing = (dx: number, dz: number) => Math.atan2(dx, -dz);
const elevation = (dx: number, dy: number, dz: number) => Math.atan2(dy, Math.hypot(dx, dz));
const wrap = (a: number) => (a > Math.PI ? a - 2 * Math.PI : a < -Math.PI ? a + 2 * Math.PI : a);
const angleBetween = (a: V3, bx: number, by: number, bz: number) => {
  const bl = Math.hypot(bx, by, bz);
  const al = Math.hypot(a.x, a.y, a.z);
  if (bl < 1e-9 || al < 1e-9) return Infinity;
  return Math.acos(Math.max(-1, Math.min(1, (a.x * bx + a.y * by + a.z * bz) / (al * bl))));
};

export interface AssistInput {
  dt: number;
  /** Post-curve stick magnitude 0..1 (fades the slowdown for fast turns). */
  intensity: number;
  /** Movement stick magnitude 0..1. */
  move: number;
  aiming: boolean;
}

const MAGNET_TIME = 0.14;

/**
 * Light controller aim assist (PRD §7.4). Three small effects, all gamepad-only (only the gamepad source calls
 * `apply`), none of which ever snap:
 *  1. slowdown: look sensitivity drops 25-35% while the reticle or bore line is over / near a shootable hitbox,
 *     falling off smoothly with angular distance from the hitbox edge;
 *  2. follow: while moving and steering, a fraction of the target's line-of-sight angular rate is added;
 *  3. ADS magnetism: a brief pull of at most ~1-2 degrees on ADS entry toward a target already inside a small cone.
 * No-shoots are skipped entirely and targets behind walls (or other targets) are ignored via `los`.
 */
export class AimAssist {
  scene: () => AssistScene | null = () => null;
  /** True when `t` is visible from `from`, i.e. no wall or other target in between. Defaults to always visible. */
  los: (from: V3, t: AssistTarget, dist: number) => boolean = () => true;
  /** Last slowdown factor applied (for debug/UI). */
  lastFactor = 1;
  /** Last added follow and magnet rotation (radians this frame, for debug/tests). */
  lastFollow = { yaw: 0, pitch: 0 };
  lastMagnet = { yaw: 0, pitch: 0 };

  private prev = new Map<string, { b: number; e: number }>();
  private cur = new Map<string, { b: number; e: number }>();
  private wasAiming = false;
  private magnet: { yaw: number; pitch: number; left: number; done: number } | null = null;
  private mode: () => AssistMode;

  constructor(mode?: () => AssistMode) {
    if (mode) this.mode = mode;
    else {
      const gp = settings.ns('gameplay', { realism: 'standard' });
      this.mode = () => (gp.get().realism === 'hardcore' ? 'off' : aimAssistSettings.get().mode);
    }
  }

  tune(): AssistTune {
    const t = ASSIST_TUNE[this.mode()] ?? ASSIST_TUNE.off;
    return {
      slow: Math.min(ASSIST_CAPS.slow, t.slow),
      follow: Math.min(ASSIST_CAPS.follow, t.follow),
      magnetDeg: Math.min(ASSIST_CAPS.magnetDeg, t.magnetDeg),
    };
  }

  /**
   * Adds assist to a look delta in place (radians, yaw right +, pitch up +). Called every frame by the gamepad
   * source so line-of-sight rates are sampled continuously.
   */
  apply(look: { yaw: number; pitch: number }, inp: AssistInput): void {
    this.lastFactor = 1;
    this.lastFollow.yaw = this.lastFollow.pitch = 0;
    this.lastMagnet.yaw = this.lastMagnet.pitch = 0;
    const tune = this.tune();
    const enterAds = inp.aiming && !this.wasAiming;
    this.wasAiming = inp.aiming;
    if (tune.slow <= 0 && tune.follow <= 0 && tune.magnetDeg <= 0) {
      this.magnet = null;
      this.prev.clear();
      return;
    }
    const sc = this.scene();
    if (!sc) return;
    const cfg = aimAssistSettings.get();
    const inner = cfg.innerDeg * DEG;
    const outer = cfg.outerDeg * DEG;
    const magCone = cfg.magnetConeDeg * DEG;

    // Best target for slowdown/follow (smallest weighted edge distance) and for magnetism (closest centre).
    let wBest = 0;
    let bestRate: { yaw: number; pitch: number } | null = null;
    let magT: { angle: number; yaw: number; pitch: number } | null = null;
    const camB = bearing(sc.camDir.x, sc.camDir.z);
    const camE = elevation(sc.camDir.x, sc.camDir.y, sc.camDir.z);
    const swap = this.cur;
    swap.clear();
    for (const t of sc.targets) {
      if (t.noShoot) continue;
      const ex = t.pos.x - sc.eye.x;
      const ey = t.pos.y - sc.eye.y;
      const ez = t.pos.z - sc.eye.z;
      const dist = Math.hypot(ex, ey, ez);
      if (dist < 0.3) continue;
      const aCam = angleBetween(sc.camDir, ex, ey, ez);
      const aBore = angleBetween(
        sc.boreDir,
        t.pos.x - sc.muzzle.x,
        t.pos.y - sc.muzzle.y,
        t.pos.z - sc.muzzle.z,
      );
      const half = Math.atan(t.radius / dist);
      const edge = Math.max(0, Math.min(aCam, aBore) - half);
      const near = edge < outer;
      const inCone = aCam < magCone;
      const b = bearing(ex, ez);
      const e = elevation(ex, ey, ez);
      if (aCam < 20 * DEG) swap.set(t.id, { b, e });
      if (!near && !inCone) continue;
      if (!this.los(sc.eye, t, dist)) continue;
      if (near) {
        const w = falloff(edge, inner, outer);
        if (w > wBest) {
          wBest = w;
          const p = this.prev.get(t.id);
          bestRate = p && inp.dt > 0 ? { yaw: wrap(b - p.b) / inp.dt, pitch: (e - p.e) / inp.dt } : null;
        }
      }
      if (inCone && (!magT || aCam < magT.angle))
        magT = { angle: aCam, yaw: wrap(b - camB), pitch: e - camE };
    }
    this.cur = this.prev;
    this.prev = swap;

    // 1. Slowdown.
    if (tune.slow > 0 && wBest > 0 && (look.yaw !== 0 || look.pitch !== 0)) {
      const k = 1 - tune.slow * fastTurnFade(inp.intensity) * wBest;
      this.lastFactor = k;
      look.yaw *= k;
      look.pitch *= k;
    }

    // 2. Follow: a fraction of the target's line-of-sight rate, only while moving and actively steering.
    if (tune.follow > 0 && bestRate && wBest > 0 && inp.move > 0.1 && inp.intensity > 0.05) {
      const cap = ASSIST_CAPS.followDegPerSec * DEG;
      const f = tune.follow * wBest;
      const yaw = clamp(bestRate.yaw * f, -cap, cap) * inp.dt;
      const pitch = clamp(bestRate.pitch * f, -cap, cap) * inp.dt;
      look.yaw += yaw;
      look.pitch += pitch;
      this.lastFollow.yaw = yaw;
      this.lastFollow.pitch = pitch;
    }

    // 3. ADS magnetism on entry.
    if (!inp.aiming || inp.intensity > 0.6) this.magnet = null;
    if (enterAds && tune.magnetDeg > 0 && magT && magT.angle > 0.25 * DEG) {
      // Never more than the cap, and never past the target (pull at most half the remaining error).
      const total = Math.min(tune.magnetDeg * DEG, magT.angle * 0.5);
      const s = total / magT.angle;
      this.magnet = { yaw: magT.yaw * s, pitch: magT.pitch * s, left: 1, done: 0 };
    }
    if (this.magnet) {
      const m = this.magnet;
      const frac = Math.min(m.left, inp.dt / MAGNET_TIME);
      // Eased: sin-shaped rate so the pull starts and ends softly.
      const ease = 1 + Math.sin((1 - m.left + frac / 2) * Math.PI - Math.PI / 2);
      const step = Math.min(frac * ease, 1 - m.done);
      m.done += step;
      look.yaw += m.yaw * step;
      look.pitch += m.pitch * step;
      this.lastMagnet.yaw = m.yaw * step;
      this.lastMagnet.pitch = m.pitch * step;
      m.left -= frac;
      if (m.left <= 1e-6) this.magnet = null;
    }
  }
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
