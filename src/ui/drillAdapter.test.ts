import { expect, test } from 'bun:test';
import type { DrillInfo as EngineDrill, DrillResult } from '../drills/Drills';
import { score } from '../drills/scoring';
import { toDrillInfo, toRunResult } from './drillAdapter';
import { fmtScore } from './drills';

const elprez: EngineDrill = {
  id: 'elprez',
  name: 'El Presidente',
  description: '',
  facility: 'range',
  method: 'hitFactor',
  par: { bronze: 2.5, silver: 4, gold: 5.5, instructor: 7 },
};

test('par / best read in the drill unit: seconds, hit factor, or a dash for no par', () => {
  expect(fmtScore(2.8, 'time')).toBe('2.80');
  expect(fmtScore(5.5, 'hitFactor')).toBe('HF 5.50');
  expect(fmtScore(0, 'none')).toBe('—');
  expect(fmtScore(undefined, 'time')).toBe('—');
});

test('hit-factor results carry the hit factor, real bands, points (not seconds) and the old PB', () => {
  const s = score({
    method: 'hitFactor',
    time: 4.79,
    paper: [{ id: 'a', zones: ['A', 'A', 'A', 'C'], required: 4 }],
    noShootHits: 0,
    steel: [],
  });
  const r: DrillResult = {
    drillId: 'elprez',
    name: 'El Presidente',
    score: s,
    medal: 'Instructor',
    shots: [1, 2],
    splits: [1, 1],
    seed: 1,
    newPB: true,
    pb: { final: s.final, time: s.time, medal: 'Instructor', date: '' },
    previousPB: { final: 3.1, time: 6, medal: 'Bronze', date: '' },
  };
  const ui = toRunResult(r, elprez);
  expect(ui.method).toBe('hitFactor');
  expect(ui.hitFactor).toBeCloseTo(s.hitFactor);
  expect(ui.bands).toEqual({ gold: 5.5, silver: 4, bronze: 2.5 });
  expect(ui.previousBest).toBe(3.1);
  expect(ui.medalName).toBe('Instructor');
  // Points down don't turn into seconds on a hit-factor drill.
  expect(ui.penalties.every((p) => p.seconds === 0)).toBe(true);
  expect(toDrillInfo(elprez).method).toBe('hitFactor');
});
