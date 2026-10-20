import { Vector3 } from 'three';
import type { Context, System } from '../core/Context';
import { mulberry32 } from '../world/kit/layout';
import type { World } from '../world/World';
import { DRILLS, type DrillDef } from './defs';
import { DrillRun, type RunEvent, type RunSpec } from './machine';
import { PBStore, type PersonalBest } from './pb';
import { medalFor, score, type Medal, type ScoreResult } from './scoring';

export interface DrillInfo {
  id: string;
  name: string;
  description: string;
  facility: DrillDef['facility'];
  method: DrillDef['method'];
  par?: DrillDef['par'];
  pb?: PersonalBest;
}

export interface DrillResult {
  drillId: string;
  name: string;
  score: ScoreResult;
  medal: Medal | null;
  /** Shot times after the beep, and splits (first = reaction/draw). */
  shots: number[];
  splits: number[];
  seed: number;
  newPB: boolean;
  pb?: PersonalBest;
  /** The personal best before this run (for the PB delta when this run beat it). */
  previousPB?: PersonalBest;
}

/** What a minimal HUD needs. `time` is only exposed once the run is finished (no running clock). */
export interface DrillHudState {
  drillId: string | null;
  name: string;
  phase: 'idle' | 'standby' | 'running' | 'finished';
  standby: boolean;
  time: number | null;
  shots: number;
  result: DrillResult | null;
}

export interface DrillPlayer {
  position: Vector3;
  teleport(p: Vector3, yaw: number): void;
}

/**
 * Drill system: shot timer with a random standby delay, start/stop beeps (`timerBeep`, `drillState`
 * on the bus), per-shot times, scoring, medals and personal bests. API for the UI:
 * `list()`, `start(id)`, `restart()`, `stop()`, `onResult(cb)`, `onState(cb)`, `state`.
 */
export class Drills implements System {
  readonly pbs = new PBStore();
  private def: DrillDef | null = null;
  private run: DrillRun | null = null;
  private seed = 1;
  private lastResult: DrillResult | null = null;
  private resultCbs = new Set<(r: DrillResult) => void>();
  private stateCbs = new Set<(s: DrillHudState) => void>();
  private pendingAuto: string | null = null;
  /** Fixed seed for the next runs (tests); null = new seed each run. */
  fixedSeed: number | null = null;

  constructor(
    private ctx: Context,
    private world: World,
    private player: DrillPlayer,
    private isPaused: () => boolean = () => false,
  ) {
    const bus = ctx.bus;
    bus.on('shot', () => this.emit(this.run?.shot() ?? []));
    bus.on('targetHit', (h) => {
      const t = this.world.targets.get(h.targetId);
      this.run?.hit(t?.id ?? h.targetId, h.zone, !!h.noShoot);
    });
    bus.on('steelFall', (f) => {
      const t = this.world.targets.get(f.targetId);
      this.run?.fall(t?.id ?? f.targetId, f.targetId);
    });
    try {
      const q = new URLSearchParams(location.search);
      this.pendingAuto = q.get('drill');
      const s = q.get('seed');
      if (s) this.fixedSeed = Number(s) | 0;
    } catch {
      /* no location (tests) */
    }
  }

  list(): DrillInfo[] {
    return DRILLS.map((d) => ({
      id: d.id,
      name: d.name,
      description: d.description,
      facility: d.facility,
      method: d.method,
      par: d.par,
      pb: this.pbs.get(d.id),
    }));
  }

  get current(): DrillDef | null {
    return this.def;
  }

  get state(): DrillHudState {
    const r = this.run;
    const phase = !this.def ? 'idle' : !r ? 'idle' : r.phase;
    return {
      drillId: this.def?.id ?? null,
      name: this.def?.name ?? '',
      phase,
      standby: phase === 'standby',
      time: r?.phase === 'finished' ? (this.lastResult?.score.final ?? r.time) : null,
      shots: r?.shots.length ?? 0,
      result: r?.phase === 'finished' ? this.lastResult : null,
    };
  }

  onResult(cb: (r: DrillResult) => void) {
    this.resultCbs.add(cb);
    return () => this.resultCbs.delete(cb);
  }

  onState(cb: (s: DrillHudState) => void) {
    this.stateCbs.add(cb);
    return () => this.stateCbs.delete(cb);
  }

  /** Load the drill's facility, reset targets, place the shooter, go to standby. */
  start(id: string, opts: { seed?: number } = {}) {
    const def = DRILLS.find((d) => d.id === id);
    if (!def) throw new Error(`unknown drill ${id}`);
    this.def = def;
    this.lastResult = null;
    this.seed = opts.seed ?? this.fixedSeed ?? (Math.random() * 2 ** 31) | 0;
    const w = this.world;
    w.setFacility(def.facility);
    w.reset(def.facility);
    if (def.threats === 'killhouse') w.killhouse.reroll(this.seed);
    const sp = w.spawnPoint(def.spawn);
    this.player.teleport(sp.pos.clone(), sp.yaw);

    if (def.method === 'none') {
      this.run = null;
      this.notify();
      return;
    }
    this.run = new DrillRun(this.spec(def), mulberry32(this.seed ^ 0x9e3779b9));
    this.ctx.bus.emit('drillState', { state: 'standby', drillId: def.id });
    this.notify();
  }

  /** Instant restart: same drill, back to standby (new seed unless fixed). */
  restart() {
    if (this.def) this.start(this.def.id);
    else {
      this.world.reset();
      const sp = this.world.spawnPoint();
      this.player.teleport(sp.pos.clone(), sp.yaw);
    }
  }

  /** Abort to free roam (no timer). */
  stop() {
    this.def = null;
    this.run = null;
    this.notify();
  }

  private spec(def: DrillDef): RunSpec {
    const w = this.world;
    let paper = def.paper ? w.select(def.paper.targets).filter((t) => t.kind === 'paper') : [];
    const noShoots = paper.filter((t) => t.noShoot).map((t) => t.id);
    paper = paper.filter((t) => !t.noShoot);
    const steel = w.select(def.steel ?? []).map((t) => ({
      id: t.id,
      mustFall: t.mustFall,
      count: t.kind === 'star' ? 5 : 1,
    }));
    return {
      method: def.method,
      end: def.end,
      standby: def.standby ?? [1.5, 4],
      timeLimit: def.timeLimit ?? 60,
      paper: paper.map((t) => ({ id: t.id, required: def.paper!.required })),
      noShoots,
      steel,
    };
  }

  fixedUpdate(dt: number) {
    if (this.isPaused()) return;
    if (this.pendingAuto) {
      const id = this.pendingAuto;
      this.pendingAuto = null;
      if (DRILLS.some((d) => d.id === id)) this.start(id);
    }
    const r = this.run;
    if (!r) return;
    const ev = r.tick(dt);
    if (
      r.phase === 'running' &&
      this.def?.end.kind === 'zone' &&
      this.world.killhouse.inFinish(this.player.position)
    ) {
      ev.push(...r.zone());
    }
    this.emit(ev);
  }

  private emit(ev: RunEvent[]) {
    const def = this.def;
    const r = this.run;
    if (!def || !r) return;
    for (const e of ev) {
      if (e === 'start') {
        this.ctx.bus.emit('timerBeep', { kind: 'start' });
        this.ctx.bus.emit('drillState', { state: 'running', drillId: def.id });
      } else {
        this.ctx.bus.emit('timerBeep', { kind: 'stop' });
        this.finish(def, r);
        this.ctx.bus.emit('drillState', { state: 'finished', drillId: def.id });
      }
      this.notify();
    }
  }

  private finish(def: DrillDef, r: DrillRun) {
    const s = score(r.scoreInput());
    const medal = medalFor(def.method, s.final, def.par);
    const pb: PersonalBest = { final: s.final, time: s.time, medal, date: new Date().toISOString() };
    const previousPB = this.pbs.get(def.id);
    const newPB = this.pbs.submit(def.id, def.method, pb);
    const res: DrillResult = {
      drillId: def.id,
      name: def.name,
      score: s,
      medal,
      shots: [...r.shots],
      splits: r.splits,
      seed: this.seed,
      newPB,
      pb: this.pbs.get(def.id),
      previousPB,
    };
    this.lastResult = res;
    for (const cb of this.resultCbs) cb(res);
  }

  private notify() {
    const s = this.state;
    for (const cb of this.stateCbs) cb(s);
  }
}
