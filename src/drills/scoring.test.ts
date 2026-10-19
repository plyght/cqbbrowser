import { describe, expect, test } from 'bun:test';
import { isBetter, medalFor, score } from './scoring';
import { PBStore } from './pb';

describe('scoring', () => {
  test('time plus: points down, misses, no-shoots, steel', () => {
    const r = score({
      method: 'time',
      time: 3,
      paper: [{ id: 'p', required: 2, zones: ['A', 'C', 'D'] }],
      noShootHits: 1,
      steel: [
        { id: 's1', ok: true },
        { id: 's2', ok: false },
      ],
    });
    // Best two of A, C, D count: A + C → 1 point down.
    expect(r.alphas).toBe(1);
    expect(r.charlies).toBe(1);
    expect(r.deltas).toBe(0);
    expect(r.pointsDown).toBe(1);
    expect(r.penaltySeconds).toBe(0.5 + 5 + 5);
    expect(r.final).toBeCloseTo(13.5);
  });

  test('misses are 5 points down each', () => {
    const r = score({
      method: 'time',
      time: 2,
      paper: [{ id: 'p', required: 6, zones: ['A', 'A', 'A', 'A'] }],
      noShootHits: 0,
      steel: [],
    });
    expect(r.misses).toBe(2);
    expect(r.pointsDown).toBe(10);
    expect(r.final).toBeCloseTo(7);
  });

  test('hit factor: minor points minus penalties over time', () => {
    const r = score({
      method: 'hitFactor',
      time: 8,
      paper: [
        { id: 'a', required: 4, zones: ['A', 'A', 'A', 'C'] },
        { id: 'b', required: 4, zones: ['A', 'A', 'D'] },
      ],
      noShootHits: 0,
      steel: [],
    });
    // 5+5+5+3 + 5+5+1 - 10 (one miss) = 19
    expect(r.points).toBe(19);
    expect(r.maxPoints).toBe(40);
    expect(r.hitFactor).toBeCloseTo(19 / 8);
    expect(r.final).toBeCloseTo(19 / 8);
  });

  test('hit factor never negative', () => {
    const r = score({
      method: 'hitFactor',
      time: 4,
      paper: [{ id: 'a', required: 2, zones: [] }],
      noShootHits: 2,
      steel: [],
    });
    expect(r.hitFactor).toBe(0);
  });

  test('medals by par (time lower is better, HF higher)', () => {
    const par = { bronze: 5, silver: 3.5, gold: 2.8, instructor: 2.1 };
    expect(medalFor('time', 2.0, par)).toBe('Instructor');
    expect(medalFor('time', 2.5, par)).toBe('Gold');
    expect(medalFor('time', 3.5, par)).toBe('Silver');
    expect(medalFor('time', 4.9, par)).toBe('Bronze');
    expect(medalFor('time', 6, par)).toBeNull();
    const hf = { bronze: 2.5, silver: 4, gold: 5.5, instructor: 7 };
    expect(medalFor('hitFactor', 7.2, hf)).toBe('Instructor');
    expect(medalFor('hitFactor', 4.1, hf)).toBe('Silver');
    expect(medalFor('hitFactor', 1, hf)).toBeNull();
    expect(medalFor('none', 1, hf)).toBeNull();
  });

  test('personal bests persist and only improve', () => {
    const mem = new Map<string, string>();
    const storage = {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, v),
    };
    const pbs = new PBStore(storage);
    const pb = (final: number) => ({ final, time: final, medal: null, date: '' });
    expect(pbs.submit('bill', 'time', pb(3))).toBe(true);
    expect(pbs.submit('bill', 'time', pb(3.5))).toBe(false);
    expect(pbs.submit('bill', 'time', pb(2.5))).toBe(true);
    expect(new PBStore(storage).get('bill')?.final).toBe(2.5);
    expect(pbs.submit('elprez', 'hitFactor', pb(4))).toBe(true);
    expect(pbs.submit('elprez', 'hitFactor', pb(3))).toBe(false);
    expect(isBetter('time', 1, undefined)).toBe(true);
    // Broken storage never throws.
    const broken = new PBStore({
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    });
    expect(broken.submit('bill', 'time', pb(2))).toBe(true);
  });
});
