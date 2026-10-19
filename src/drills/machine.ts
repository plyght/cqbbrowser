import type { Method, ScoreInput, Zone } from './scoring';

/**
 * Drill run state machine (pure; unit tested). Phases: standby (random delay) → running (after the
 * start beep) → finished (stop beep). Every shot is timed from the beep; splits are derived.
 */
export type EndRule =
  { kind: 'shots'; count: number } | { kind: 'targets' } | { kind: 'zone' } | { kind: 'none' };

export interface RunSpec {
  method: Method;
  end: EndRule;
  /** Random standby delay range, seconds. */
  standby: [number, number];
  /** Hard stop (seconds after the beep). */
  timeLimit: number;
  paper: { id: string; required: number }[];
  noShoots: string[];
  /** Steel: must ring (mustFall false) or fall; `count` distinct parts must fall (Texas star = 5). */
  steel: { id: string; mustFall: boolean; count?: number }[];
}

export type Phase = 'standby' | 'running' | 'finished';
export type RunEvent = 'start' | 'finish';

export class DrillRun {
  phase: Phase = 'standby';
  readonly standbyDelay: number;
  /** Seconds since the run (standby) began. */
  clock = 0;
  /** Shot times, seconds after the beep. */
  readonly shots: number[] = [];
  readonly paperZones = new Map<string, Zone[]>();
  noShootHits = 0;
  readonly rung = new Set<string>();
  readonly fallen = new Map<string, Set<string>>();
  /** Final time (seconds after the beep) once finished. */
  time: number | null = null;
  private pendingFinish = false;

  constructor(
    readonly spec: RunSpec,
    rand: () => number = Math.random,
  ) {
    const [a, b] = spec.standby;
    this.standbyDelay = a + (b - a) * rand();
    for (const p of spec.paper) this.paperZones.set(p.id, []);
  }

  /** Seconds since the beep (0 during standby). */
  get elapsed() {
    return Math.max(0, this.clock - this.standbyDelay);
  }

  get lastShot() {
    return this.shots.length ? this.shots[this.shots.length - 1] : 0;
  }

  get splits(): number[] {
    return this.shots.map((t, i) => (i === 0 ? t : t - this.shots[i - 1]));
  }

  tick(dt: number): RunEvent[] {
    const ev: RunEvent[] = [];
    if (this.phase === 'finished') return ev;
    this.clock += dt;
    if (this.phase === 'standby' && this.clock >= this.standbyDelay) {
      this.phase = 'running';
      ev.push('start');
    }
    if (this.phase === 'running') {
      if (this.pendingFinish) ev.push(...this.finish(this.lastShot));
      else if (this.elapsed >= this.spec.timeLimit) ev.push(...this.finish(this.spec.timeLimit));
    }
    return ev;
  }

  shot(): RunEvent[] {
    if (this.phase !== 'running') return [];
    this.shots.push(this.elapsed);
    if (this.spec.end.kind === 'shots' && this.shots.length >= this.spec.end.count)
      return this.finish(this.elapsed);
    if (this.pendingFinish) return this.finish(this.elapsed);
    return [];
  }

  /** A target was hit. `id` is the scoring target id (sub-parts already mapped to their parent). */
  hit(id: string, zone?: Zone, noShoot = false) {
    if (this.phase !== 'running') return;
    if (noShoot || this.spec.noShoots.includes(id)) {
      this.noShootHits++;
      return;
    }
    const z = this.paperZones.get(id);
    if (z && zone) z.push(zone);
    if (this.spec.steel.some((s) => s.id === id)) this.rung.add(id);
    this.checkDone();
  }

  /** Steel fell; `part` distinguishes star plates etc. */
  fall(id: string, part = id) {
    if (this.phase !== 'running') return;
    let s = this.fallen.get(id);
    if (!s) this.fallen.set(id, (s = new Set()));
    s.add(part);
    this.checkDone();
  }

  /** The shooter reached the finish zone. */
  zone(): RunEvent[] {
    if (this.phase !== 'running' || this.spec.end.kind !== 'zone') return [];
    return this.finish(this.elapsed);
  }

  /** Manual stop (e.g. free-run drills). */
  stop(): RunEvent[] {
    if (this.phase !== 'running') return [];
    return this.finish(this.shots.length ? this.lastShot : this.elapsed);
  }

  steelOk(s: RunSpec['steel'][number]) {
    if (!s.mustFall) return this.rung.has(s.id);
    return (this.fallen.get(s.id)?.size ?? 0) >= (s.count ?? 1);
  }

  private checkDone() {
    if (this.spec.end.kind !== 'targets') return;
    const steel = this.spec.steel.every((s) => this.steelOk(s));
    const paper = this.spec.paper.every((p) => (this.paperZones.get(p.id)?.length ?? 0) >= p.required);
    if (steel && paper) this.pendingFinish = true;
  }

  private finish(t: number): RunEvent[] {
    if (this.phase === 'finished') return [];
    this.phase = 'finished';
    this.time = t;
    this.pendingFinish = false;
    return ['finish'];
  }

  scoreInput(): ScoreInput {
    return {
      method: this.spec.method,
      time: this.time ?? this.elapsed,
      paper: this.spec.paper.map((p) => ({
        id: p.id,
        required: p.required,
        zones: this.paperZones.get(p.id) ?? [],
      })),
      noShootHits: this.noShootHits,
      steel: this.spec.steel.map((s) => ({ id: s.id, ok: this.steelOk(s) })),
    };
  }
}
