import type { DrillInfo as EngineDrill, DrillResult } from '../drills/Drills';
import type { Medal as EngineMedal } from '../drills/scoring';
import type { Par } from '../drills/scoring';
import type { DrillInfo, Medal, MedalBands, RunResult } from './drills';

/** Maps the drills engine's types onto the UI's DrillInfo/RunResult contracts. */
const medal = (m: EngineMedal | null | undefined): Medal | undefined =>
  m === 'Instructor' || m === 'Gold'
    ? 'gold'
    : m === 'Silver'
      ? 'silver'
      : m === 'Bronze'
        ? 'bronze'
        : undefined;

const medalName = (m: EngineMedal | null | undefined) => (m === 'Instructor' ? 'Instructor' : undefined);
const bands = (p: Par | undefined): MedalBands | undefined =>
  p && { gold: p.gold, silver: p.silver, bronze: p.bronze };

const FACILITY_NAMES: Record<EngineDrill['facility'], string> = {
  range: 'Square Range',
  steel: 'Steel Park',
  killhouse: 'Kill House',
};

export function toDrillInfo(d: EngineDrill): DrillInfo {
  return {
    id: d.id,
    name: d.name,
    facility: FACILITY_NAMES[d.facility] ?? d.facility,
    par: d.par?.gold ?? 0,
    best: d.pb?.final,
    medal: medal(d.pb?.medal),
    medalName: medalName(d.pb?.medal),
    brief: d.description,
    method: d.method,
    bands: bands(d.par),
  };
}

export function toRunResult(r: DrillResult, info?: EngineDrill): RunResult {
  const s = r.score;
  const hf = s.method === 'hitFactor';
  const penalties: RunResult['penalties'] = [];
  // Hit-factor drills don't add time: points down lower the score instead (shown as points, not seconds).
  if (hf) {
    if (s.pointsDown > 0) penalties.push({ label: 'Points down', seconds: 0, text: `−${s.pointsDown} pts` });
  } else if (s.penaltySeconds > 0)
    penalties.push({ label: 'Points down / penalties', seconds: s.penaltySeconds });
  const out: RunResult = {
    drillId: r.drillId,
    drillName: r.name,
    facility: info ? FACILITY_NAMES[info.facility] : undefined,
    time: s.time,
    par: info?.par?.gold ?? 0,
    hits: s.alphas + s.charlies + s.deltas + s.steelHits,
    shots: r.shots.length,
    penalties,
    splits: r.splits,
    medal: medal(r.medal),
    medalName: medalName(r.medal),
    previousBest: r.previousPB?.final,
    method: s.method,
    hitFactor: hf ? s.hitFactor : undefined,
    points: s.points,
    maxPoints: s.maxPoints,
    bands: bands(info?.par),
    // No replay recorder yet: "Watch footage" stays disabled instead of opening a placeholder.
    hasFootage: false,
  };
  return out;
}
