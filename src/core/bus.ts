import type { Vector3 } from 'three';

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
  shot: { weaponId: string; origin: Vector3; dir: Vector3; suppressed: boolean; caliber: string };
  /** A round hit something. */
  impact: { point: Vector3; normal: Vector3; surface: Surface; targetId?: string; energy: number };
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
}

type Handler<T> = (e: T) => void;

export class Bus {
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
    for (const fn of set) (fn as Handler<GameEvents[K]>)(e);
  }
}

export const bus = new Bus();
