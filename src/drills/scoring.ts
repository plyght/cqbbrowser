/**
 * Simplified USPSA/IDPA scoring (pure; unit tested).
 *
 * - `time` (IDPA-like "time plus"): final = raw time + 0.5 s per point down (C = 1, D = 3, miss = 5)
 *   + 5 s per no-shoot hit + 5 s per steel not neutralised. Lower is better.
 * - `hitFactor` (USPSA-like, minor): points = A 5 / C 3 / D 1, steel 5; minus 10 per miss, no-shoot
 *   hit and steel miss; hit factor = max(0, points) / time. Higher is better.
 *
 * Only the best `required` hits on each paper count (extra hits don't add points).
 */
export type Zone = 'A' | 'C' | 'D';
export type Method = 'time' | 'hitFactor' | 'none';
export type Medal = 'Instructor' | 'Gold' | 'Silver' | 'Bronze';

export interface PaperScore {
  id: string;
  required: number;
  zones: Zone[];
}

export interface ScoreInput {
  method: Method;
  time: number;
  paper: PaperScore[];
  noShootHits: number;
  steel: { id: string; ok: boolean }[];
}

export interface ScoreResult {
  method: Method;
  time: number;
  alphas: number;
  charlies: number;
  deltas: number;
  misses: number;
  noShootHits: number;
  steelHits: number;
  steelMisses: number;
  points: number;
  maxPoints: number;
  pointsDown: number;
  penaltySeconds: number;
  /** time mode: adjusted time (s). hitFactor mode: hit factor. */
  final: number;
  hitFactor: number;
}

export const POINT_DOWN_S = 0.5;
export const NO_SHOOT_S = 5;
export const STEEL_MISS_S = 5;
export const PENALTY_PTS = 10;
const VALUE: Record<Zone, number> = { A: 5, C: 3, D: 1 };
const DOWN: Record<Zone, number> = { A: 0, C: 1, D: 3 };

export function score(i: ScoreInput): ScoreResult {
  let alphas = 0,
    charlies = 0,
    deltas = 0,
    misses = 0,
    points = 0,
    maxPoints = 0,
    pointsDown = 0;
  for (const p of i.paper) {
    const best = [...p.zones].sort((a, b) => VALUE[b] - VALUE[a]).slice(0, p.required);
    for (const z of best) {
      if (z === 'A') alphas++;
      else if (z === 'C') charlies++;
      else deltas++;
      points += VALUE[z];
      pointsDown += DOWN[z];
    }
    const m = p.required - best.length;
    misses += m;
    pointsDown += m * 5;
    maxPoints += p.required * 5;
  }
  const steelHits = i.steel.filter((s) => s.ok).length;
  const steelMisses = i.steel.length - steelHits;
  points += steelHits * 5;
  maxPoints += i.steel.length * 5;
  const time = Math.max(0, i.time);
  const penaltySeconds = pointsDown * POINT_DOWN_S + i.noShootHits * NO_SHOOT_S + steelMisses * STEEL_MISS_S;
  const net = points - PENALTY_PTS * (misses + i.noShootHits + steelMisses);
  const hitFactor = time > 0 ? Math.max(0, net) / time : 0;
  return {
    method: i.method,
    time,
    alphas,
    charlies,
    deltas,
    misses,
    noShootHits: i.noShootHits,
    steelHits,
    steelMisses,
    points: net,
    maxPoints,
    pointsDown,
    penaltySeconds,
    final: i.method === 'hitFactor' ? hitFactor : time + penaltySeconds,
    hitFactor,
  };
}

/** Medal thresholds: seconds (time mode, ≤) or hit factor (hitFactor mode, ≥). */
export interface Par {
  bronze: number;
  silver: number;
  gold: number;
  instructor: number;
}

export function medalFor(method: Method, final: number, par?: Par): Medal | null {
  if (!par || method === 'none') return null;
  const better = (v: number) => (method === 'hitFactor' ? final >= v : final <= v);
  if (better(par.instructor)) return 'Instructor';
  if (better(par.gold)) return 'Gold';
  if (better(par.silver)) return 'Silver';
  if (better(par.bronze)) return 'Bronze';
  return null;
}

/** True if `a` beats `b` under `method`. */
export function isBetter(method: Method, a: number, b: number | undefined) {
  if (b === undefined || !Number.isFinite(b)) return true;
  return method === 'hitFactor' ? a > b : a < b;
}
