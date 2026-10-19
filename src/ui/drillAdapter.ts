import type { DrillInfo as EngineDrill, DrillResult } from '../drills/Drills';
import type { Medal as EngineMedal } from '../drills/scoring';
import type { DrillInfo, Medal, RunResult } from './drills';

/** Maps the drills engine's types onto the UI's DrillInfo/RunResult contracts. */
const medal = (m: EngineMedal | null | undefined): Medal | undefined =>
  m === 'Instructor' || m === 'Gold'
    ? 'gold'
    : m === 'Silver'
      ? 'silver'
      : m === 'Bronze'
        ? 'bronze'
        : undefined;

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
    brief: d.description,
  };
}

export function toRunResult(r: DrillResult, info?: EngineDrill): RunResult {
  const s = r.score;
  const penalties: RunResult['penalties'] = [];
  if (s.penaltySeconds > 0) penalties.push({ label: 'Points down / penalties', seconds: s.penaltySeconds });
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
    previousBest: r.newPB ? undefined : r.pb?.final,
  };
  return out;
}
