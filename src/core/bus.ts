import type { Vector3 } from 'three';
import type { RecoilProfile } from '../physics/ballistics/recoil';
import type { WeaponDef } from '../weapons/defs';

/** Surface/material tags shared by physics, decals, footsteps and audio. */
export type Surface =
  | 'concrete'
  | 'concrete_dusty'
  | 'wood'
  | 'plywood'
  | 'drywall'
  | 'carpet'
  | 'tile'
  | 'gravel'
  | 'dirt'
  | 'grass'
  | 'metal'
  | 'steel_target'
  | 'paper_target'
  | 'berm';

export interface GameEvents {
  /** A round left the muzzle. */
  shot: {
    weaponId: string;
    origin: Vector3;
    dir: Vector3;
    suppressed: boolean;
    caliber: string;
    /** The exact build fired (defaults to `WEAPONS[weaponId]`). */
    def?: WeaponDef;
    /** `dir` is already the bore axis with the zero applied (else it's the sight line; ballistics tilts it). */
    zeroed?: boolean;
    // Filled in by Ballistics (first `shot` listener) for later listeners and the emitter:
    /** Physical recoil impulse + time profile for this build (`physics/ballistics/recoil.ts`). */
    recoil?: RecoilProfile;
    /** Projectile is subsonic: no supersonic crack. */
    subsonic?: boolean;
    muzzleVelocity?: number;
    ammo?: string;
  };
  /** A round hit something. `exit` marks the far side of a penetrated surface. */
  impact: {
    point: Vector3;
    normal: Vector3;
    surface: Surface;
    targetId?: string;
    energy: number;
    speed?: number;
    massKg?: number;
    exit?: boolean;
    /** Ricochet / dominant spall direction (unit) for fx and audio; no ricochet damage off steel. */
    ricochet?: Vector3;
  };
  /** Steel target struck; size in metres (plate diameter/width), thickness in mm. */
  steelHit: {
    point: Vector3;
    targetId: string;
    size: number;
    thicknessMm: number;
    energy: number;
    distance: number;
  };
  /** Steel target settled/fell (popper down, plate off the rack). */
  steelFall: { point: Vector3; targetId: string };
  /** Brass hit the ground. */
  brass: { point: Vector3; surface: Surface; kind: 'rifle' | 'pistol' | 'shell' };
  footstep: { point: Vector3; surface: Surface; foot: 'L' | 'R'; speed: number; scuff: number };
  /** Reload/handling animation beat — audio keys foley off these. */
  weaponBeat: { weaponId: string; beat: string; stressed: boolean };
  magDrop: { point: Vector3; surface: Surface; polymer: boolean };
  dryFire: { weaponId: string };
  /** Camera mount knocked / hand on camera (mic muffles while true). */
  camHand: { active: boolean };
  drillState: { state: 'standby' | 'running' | 'finished'; drillId: string };
  timerBeep: { kind: 'start' | 'stop' };
  /** A scoring target registered a hit (paper zone, or steel). No-shoot paper sets `noShoot`. */
  targetHit: {
    targetId: string;
    kind: 'paper' | 'steel';
    zone?: 'A' | 'C' | 'D';
    noShoot?: boolean;
    point: Vector3;
  };
  /**
   * A flashbang (or training flash-bang simulator) went off. Gear computes the listener-side exposure:
   * `visual` (sensor white-out) and `hearing` (0..1, drives tinnitus/dulling) from distance, line of sight
   * and enclosure; audio renders the blast from `point`.
   */
  flashbang: {
    point: Vector3;
    distance: number;
    visual: number;
    hearing: number;
    los: boolean;
    indoor: boolean;
    training?: boolean;
  };
  /** Gear foley: pin pull, spoon flick, grenade bounces, throw swish, NVG flip detents, IR switch. */
  gearSound: {
    kind: 'pin' | 'spoon' | 'bounce' | 'throw' | 'nvgDown' | 'nvgUp' | 'irClick';
    point?: Vector3;
    surface?: Surface;
    /** Impact speed (m/s) for bounces. */
    speed?: number;
  };
  /** NVG intensifier powered (audio: the faint tube whine). */
  nvg: { on: boolean };
  /** Feet back on the ground after a fall / jump; `speed` = downward speed at touchdown (m/s). */
  land: { speed: number };
  /** Aim-down-sights state changed (the raise / drop of the sight, haptic tick). */
  ads: { on: boolean };
  /**
   * Startle reflex hook for the body/animation: a bright/loud event nearby. `strength` 0..1 (≥ ~0.5 = arm comes
   * up to shield the face, Bodycam-style), `dir` = unit vector from the player toward the source (world).
   */
  flinch: { strength: number; dir: Vector3; cause: 'flashbang' | 'blast' | 'loud' };
}

type Handler<T> = (e: T) => void;

export class Bus {
  private reported = new WeakSet<object>();
  private handlers = new Map<keyof GameEvents, Set<Handler<never>>>();

  on<K extends keyof GameEvents>(type: K, fn: Handler<GameEvents[K]>): () => void {
    let set = this.handlers.get(type);
    if (!set) this.handlers.set(type, (set = new Set()));
    set.add(fn as Handler<never>);
    return () => set!.delete(fn as Handler<never>);
  }

  emit<K extends keyof GameEvents>(type: K, e: GameEvents[K]): void {
    const set = this.handlers.get(type);
    if (!set) return;
    // One broken listener (audio, fx, haptics…) must never stop the others — or the code that emitted the
    // event, e.g. the weapon's fire path. Log each failing handler once and keep going.
    for (const fn of set) {
      try {
        (fn as Handler<GameEvents[K]>)(e);
      } catch (err) {
        if (!this.reported.has(fn)) {
          this.reported.add(fn);
          console.error(`[bus] '${String(type)}' listener threw`, err);
        }
      }
    }
  }
}

export const bus = new Bus();
