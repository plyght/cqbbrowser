/**
 * Procedural beat graph (PRD §2.4). A reload / mag check / handling action is a sequence of named beats.
 * Each beat has authored variants (small keyframe tracks for the hands, weapon pose and moving parts);
 * the planner layers calm/stressed sets, no-immediate-repeat variant choice, ±8% timing noise, positional
 * jitter and stress-gated fumbles. Pure logic, no three.js — the WeaponController resolves anchors.
 */
import type { HandPoseName } from './handPoses';
import { sampleNum, segment, type Ease, type NumKey, type Segment, type TimedKey } from './tracks';

export type V3 = readonly [number, number, number];

/** Named attach points a hand key can be relative to. Weapon anchors move with the gun, body ones with the torso. */
export type Anchor =
  | 'grip'
  | 'handguard'
  | 'well'
  | 'charging'
  | 'boltCatch'
  | 'slide'
  | 'pouch'
  | 'pistolPouch'
  | 'dump'
  | 'chest'
  | 'cam'
  | 'holster';

export interface HandKey extends TimedKey {
  at: Anchor;
  /** Offset in the anchor frame (m). */
  p?: V3;
  /** Extra hand rotation (XYZ euler, rad) on top of the anchor's default hand basis. */
  r?: V3;
  pose?: HandPoseName;
}

export interface PoseKey extends TimedKey {
  /** Weapon offset from its hold pose, torso-local (m). */
  p?: V3;
  /** Weapon rotation offset [pitch, yaw, roll] (rad). */
  r?: V3;
}

/** `magPull` = metres the (released) mag sits out of the well along its axis (partly inserted, before a slap). */
export type PartChannel = 'charge' | 'bolt' | 'slide' | 'magPull';

/**
 * Contact impulse delivered into the handling rigid body on the beat's `hit` frame (seat slap, bolt slam):
 * `j` in N·s in the weapon frame (-z forward, +y up), applied at a weapon point; `cam` = chest-cam pitch kick
 * (rad/s, + = up) through the body spring.
 */
export interface BeatKick {
  at: 'well' | 'bore' | 'charging' | 'slide';
  j: V3;
  cam?: number;
}

export type BeatEventName =
  | 'magToHand' // mag leaves the well and rides the support hand
  | 'magToWell' // mag seated (re-parented to the weapon)
  | 'magHide' // stowed in a pouch: inventory swap (retain)
  | 'magShow' // fresh mag drawn into the hand
  | 'drop' // mag falls free (speed reload): inventory swap (dump) + physical mag
  | 'chamber' // bolt / slide forward on a fresh round
  | 'camGrab'
  | 'camFix'
  | 'camRelease';

export interface BeatVariant {
  id: string;
  /** Calm duration (s). */
  dur: number;
  /** Normalised time of the contact/foley moment (the `weaponBeat` event fires here). */
  hit?: number;
  left?: HandKey[];
  right?: HandKey[];
  weapon?: PoseKey[];
  parts?: Partial<Record<PartChannel, NumKey[]>>;
  events?: { t: number; ev: BeatEventName }[];
  /** Loops at its end while the player's `holding` flag is set (mag check). */
  hold?: boolean;
  /** Physical jolt on the contact frame. */
  kick?: BeatKick;
}

export interface BeatSet {
  calm: BeatVariant[];
  /** Optional hand-authored stressed set; otherwise derived (faster, overshooting, looser). */
  stressed?: BeatVariant[];
}

export type BeatLibrary = Record<string, BeatSet>;

export interface PlannedBeat {
  name: string;
  variant: BeatVariant;
  dur: number;
  stressed: boolean;
  fumble: boolean;
  /** Per-run positional noise added mid-segment to hand targets (m). */
  jitter: V3;
}

/** Which beats can fumble, and the fumble beat that precedes the retry. */
export const FUMBLES: Record<string, string> = {
  magIndex: 'fumbleMiss',
  chargingHandle: 'handSlip',
  slideRelease: 'slideSlip',
};

export type FumbleMode = 'off' | 'rare' | 'on';

/** Stress-gated fumble probability per eligible beat (PRD §6.7: Arcade off, Standard rare at high stress). */
export function fumbleChance(stress: number, mode: FumbleMode): number {
  if (mode === 'off') return 0;
  if (mode === 'rare') return stress < 0.7 ? 0 : Math.min(0.5, 0.15 + (stress - 0.7) * 1.2);
  return stress < 0.3 ? 0.02 : Math.min(0.5, 0.08 + (stress - 0.3) * 0.6);
}

const derived = new WeakMap<BeatVariant, BeatVariant>();

function hurry<K extends TimedKey>(keys: K[] | undefined): K[] | undefined {
  if (!keys) return keys;
  return keys.map((k, i) => (i === keys.length - 1 && !k.e ? { ...k, e: 'back' as Ease } : k));
}

/** Stressed version of a calm variant: ~18% shorter, overshooting arrivals. */
export function stressify(v: BeatVariant): BeatVariant {
  let s = derived.get(v);
  if (!s) {
    s = {
      ...v,
      id: `${v.id}!`,
      dur: v.dur * 0.82,
      left: hurry(v.left),
      right: hurry(v.right),
      weapon: hurry(v.weapon),
    };
    derived.set(v, s);
  }
  return s;
}

/** Picks variants randomly without immediate repeats (per beat name + stress state). */
export class VariantPicker {
  private last = new Map<string, number>();

  pick<T>(key: string, list: readonly T[], rand: () => number): T {
    if (list.length <= 1) {
      this.last.set(key, 0);
      return list[0];
    }
    const prev = this.last.get(key);
    let i = Math.floor(rand() * (prev === undefined ? list.length : list.length - 1));
    if (prev !== undefined && i >= prev) i++;
    i = Math.min(i, list.length - 1);
    this.last.set(key, i);
    return list[i];
  }
}

export interface PlanOptions {
  stressed: boolean;
  rand: () => number;
  picker: VariantPicker;
  /** Probability that an eligible beat is preceded by its fumble. */
  fumbleChance?: number;
  /** Relative timing noise (default ±8%). */
  noise?: number;
}

export function planBeat(name: string, lib: BeatLibrary, o: PlanOptions, fumble = false): PlannedBeat | null {
  const set = lib[name];
  if (!set || !set.calm.length) return null;
  const list = o.stressed ? (set.stressed ?? set.calm.map(stressify)) : set.calm;
  const variant = o.picker.pick(`${name}${o.stressed ? '!' : ''}`, list, o.rand);
  const n = o.noise ?? 0.08;
  const dur = variant.dur * (1 + (o.rand() * 2 - 1) * n);
  const j = o.stressed ? 0.014 : 0.006;
  const jitter: V3 = [(o.rand() - 0.5) * j, (o.rand() - 0.5) * j, (o.rand() - 0.5) * j];
  return { name, variant, dur, stressed: o.stressed, fumble, jitter };
}

/** Expands beat names into a concrete plan with variants, noise and fumbles. */
export function planSequence(names: readonly string[], lib: BeatLibrary, o: PlanOptions): PlannedBeat[] {
  const out: PlannedBeat[] = [];
  for (const name of names) {
    const fumbleName = FUMBLES[name];
    if (fumbleName && lib[fumbleName] && (o.fumbleChance ?? 0) > 0 && o.rand() < (o.fumbleChance ?? 0)) {
      const f = planBeat(fumbleName, lib, o, true);
      if (f) out.push(f);
    }
    const b = planBeat(name, lib, o);
    if (b) out.push(b);
  }
  return out;
}

export interface BeatSink {
  /** A beat began. */
  begin?(b: PlannedBeat): void;
  /** The beat's contact moment (emit `weaponBeat` here). */
  hit?(b: PlannedBeat): void;
  event?(ev: BeatEventName, b: PlannedBeat): void;
}

/** Plays a plan. Tracks the last key of every channel so each beat starts where the previous one ended. */
export class BeatPlayer {
  plan: PlannedBeat[] = [];
  index = 0;
  /** Seconds into the current beat. */
  t = 0;
  /** While true, a `hold` beat stays at its end (mag check held). */
  holding = false;
  startLeft: HandKey | null = null;
  startRight: HandKey | null = null;
  startPose: PoseKey | null = null;
  readonly startParts: Record<PartChannel, number> = { charge: 0, bolt: 0, slide: 0, magPull: 0 };
  private hitDone = false;
  private evDone = 0;
  private begun = false;

  get active(): boolean {
    return this.index < this.plan.length;
  }

  get current(): PlannedBeat | undefined {
    return this.plan[this.index];
  }

  /** Normalised time in the current beat. */
  get k(): number {
    const b = this.current;
    return b ? Math.min(1, this.t / Math.max(1e-4, b.dur)) : 1;
  }

  /** Total remaining seconds (approximate for hold beats). */
  get remaining(): number {
    let r = 0;
    for (let i = this.index; i < this.plan.length; i++) r += this.plan[i].dur;
    return r - this.t;
  }

  start(plan: PlannedBeat[], left: HandKey | null, right: HandKey | null) {
    this.plan = plan;
    this.index = 0;
    this.t = 0;
    this.startLeft = left;
    this.startRight = right;
    this.startPose = null;
    this.startParts.charge = this.startParts.bolt = this.startParts.slide = this.startParts.magPull = 0;
    this.hitDone = false;
    this.evDone = 0;
    this.begun = false;
  }

  stop() {
    this.plan = [];
    this.index = 0;
    this.t = 0;
  }

  /** Replace every beat after the current one (e.g. tactical → dump upgrade). */
  replaceTail(beats: PlannedBeat[]) {
    this.plan = [...this.plan.slice(0, this.index + 1), ...beats];
  }

  /** Remaining beat names after the current one. */
  tailNames(): string[] {
    return this.plan.slice(this.index + 1).map((b) => b.name);
  }

  update(dt: number, sink: BeatSink) {
    let budget = dt;
    let guard = 0;
    while (this.active && guard++ < 32) {
      const b = this.plan[this.index];
      if (!this.begun) {
        this.begun = true;
        sink.begin?.(b);
      }
      this.t += budget;
      const k = Math.min(1, this.t / Math.max(1e-4, b.dur));
      const v = b.variant;
      const evs = v.events ?? [];
      while (this.evDone < evs.length && k >= evs[this.evDone].t) {
        const ev = evs[this.evDone++].ev;
        sink.event?.(ev, b);
      }
      if (!this.hitDone && k >= (v.hit ?? 0)) {
        this.hitDone = true;
        sink.hit?.(b);
      }
      if (this.t < b.dur) break;
      if (v.hold && this.holding) {
        this.t = b.dur;
        break;
      }
      // Advance: carry leftover time and remember each channel's last key.
      budget = this.t - b.dur;
      this.carry(v);
      this.index++;
      this.t = 0;
      this.hitDone = false;
      this.evDone = 0;
      this.begun = false;
    }
  }

  private carry(v: BeatVariant) {
    if (v.left?.length) this.startLeft = v.left[v.left.length - 1];
    if (v.right?.length) this.startRight = v.right[v.right.length - 1];
    if (v.weapon?.length) this.startPose = v.weapon[v.weapon.length - 1];
    if (v.parts)
      for (const ch of Object.keys(v.parts) as PartChannel[]) {
        const keys = v.parts[ch]!;
        if (keys.length) this.startParts[ch] = keys[keys.length - 1].v;
      }
  }

  /** Current scalar of a part channel. */
  part(ch: PartChannel): number {
    const b = this.current;
    const keys = b?.variant.parts?.[ch];
    if (!b || !keys) return this.startParts[ch];
    return sampleNum(keys, this.k, this.startParts[ch]);
  }

  /** Segment of a hand channel: [from key | start key, to key, eased u]. Null when the channel is idle. */
  handSegment(side: 'left' | 'right', out: HandSegment): HandSegment | null {
    const b = this.current;
    const start = side === 'left' ? this.startLeft : this.startRight;
    const keys = b ? (side === 'left' ? b.variant.left : b.variant.right) : undefined;
    if (!b || !keys?.length) {
      if (!start) return null;
      out.a = out.b = start;
      out.u = 1;
      out.mid = 0;
      return out;
    }
    const s = segment(keys, this.k, _seg);
    out.a = s.from < 0 ? (start ?? keys[0]) : keys[s.from];
    out.b = keys[s.to];
    out.u = s.u;
    out.mid = Math.sin(Math.PI * s.u);
    return out;
  }

  poseSegment(out: PoseSegment): PoseSegment {
    const b = this.current;
    const keys = b?.variant.weapon;
    if (!b || !keys?.length) {
      out.a = out.b = this.startPose;
      out.u = 1;
      return out;
    }
    const s = segment(keys, this.k, _seg);
    out.a = s.from < 0 ? this.startPose : keys[s.from];
    out.b = keys[s.to];
    out.u = s.u;
    return out;
  }
}

export interface HandSegment {
  a: HandKey;
  b: HandKey;
  u: number;
  /** 0→1→0 bell over the segment, for mid-flight jitter. */
  mid: number;
}

export interface PoseSegment {
  a: PoseKey | null;
  b: PoseKey | null;
  u: number;
}

const _seg: Segment = { from: 0, to: 0, u: 0 };
