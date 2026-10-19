import { describe, expect, test } from 'bun:test';
import { DrillRun, type RunSpec } from './machine';
import { DRILLS } from './defs';

const base: RunSpec = {
  method: 'time',
  end: { kind: 'shots', count: 3 },
  standby: [2, 2],
  timeLimit: 10,
  paper: [{ id: 'p', required: 3 }],
  noShoots: ['ns'],
  steel: [],
};

const tickFor = (r: DrillRun, s: number, dt = 1 / 60) => {
  const ev = [];
  for (let t = 0; t < s - 1e-9; t += dt) ev.push(...r.tick(dt));
  return ev;
};

describe('drill state machine', () => {
  test('standby → beep → shots → finish on shot count, with splits', () => {
    const r = new DrillRun(base, () => 0.5);
    expect(r.phase).toBe('standby');
    expect(r.shot()).toEqual([]); // early shots are not recorded
    expect(tickFor(r, 1.9)).toEqual([]);
    expect(tickFor(r, 0.2)).toEqual(['start']);
    expect(r.phase).toBe('running');
    tickFor(r, 0.5);
    r.hit('p', 'A');
    expect(r.shot()).toEqual([]);
    tickFor(r, 0.25);
    r.hit('p', 'C');
    r.shot();
    tickFor(r, 0.25);
    r.hit('ns', 'A');
    expect(r.shot()).toEqual(['finish']);
    expect(r.phase).toBe('finished');
    expect(r.shots.length).toBe(3);
    expect(r.splits[1]).toBeCloseTo(0.25, 1);
    expect(r.time).toBeCloseTo(r.shots[2]);
    const s = r.scoreInput();
    expect(s.paper[0].zones).toEqual(['A', 'C']);
    expect(s.noShootHits).toBe(1);
    // Nothing changes after finish.
    expect(r.shot()).toEqual([]);
    expect(r.tick(1)).toEqual([]);
  });

  test('random standby delay within range', () => {
    const r = new DrillRun({ ...base, standby: [1.5, 4] }, () => 0.999);
    expect(r.standbyDelay).toBeGreaterThan(3.9);
    expect(new DrillRun({ ...base, standby: [1.5, 4] }, () => 0).standbyDelay).toBe(1.5);
  });

  test('targets end: finishes at the last shot once all steel is down', () => {
    const spec: RunSpec = {
      ...base,
      end: { kind: 'targets' },
      paper: [],
      steel: [
        { id: 'gong', mustFall: false },
        { id: 'star', mustFall: true, count: 2 },
      ],
    };
    const r = new DrillRun(spec, () => 0);
    tickFor(r, 2.1);
    tickFor(r, 0.5);
    r.hit('gong');
    r.shot();
    const t1 = r.lastShot;
    tickFor(r, 0.3);
    r.shot();
    r.hit('star');
    r.fall('star', 'star.p0');
    tickFor(r, 0.3);
    expect(r.phase).toBe('running');
    r.shot();
    const t3 = r.lastShot;
    tickFor(r, 0.4); // the plate is still falling
    r.fall('star', 'star.p1');
    expect(tickFor(r, 1 / 60)).toEqual(['finish']);
    expect(r.time).toBeCloseTo(t3);
    expect(t3).toBeGreaterThan(t1);
    expect(r.scoreInput().steel.every((s) => s.ok)).toBe(true);
  });

  test('completing hit arrives before its shot is recorded (same frame)', () => {
    const r = new DrillRun({ ...base, end: { kind: 'targets' }, paper: [{ id: 'p', required: 1 }] }, () => 0);
    tickFor(r, 2.5);
    r.hit('p', 'A');
    expect(r.shot()).toEqual(['finish']);
    expect(r.time).toBeCloseTo(r.shots[0]);
  });

  test('zone end and time limit', () => {
    const z = new DrillRun({ ...base, end: { kind: 'zone' } }, () => 0);
    expect(z.zone()).toEqual([]);
    tickFor(z, 2 + 5);
    expect(z.zone()).toEqual(['finish']);
    expect(z.time).toBeCloseTo(5, 1);
    const l = new DrillRun({ ...base, end: { kind: 'none' }, timeLimit: 3 }, () => 0);
    expect(tickFor(l, 6)).toEqual(['start', 'finish']);
    expect(l.time).toBe(3);
  });

  test('drill catalogue is well formed', () => {
    const ids = new Set(DRILLS.map((d) => d.id));
    expect(ids.size).toBe(DRILLS.length);
    for (const id of ['free', 'bill', 'elprez', 'steel5', 'platerack', 'poppers', 'killhouseA'])
      expect(ids.has(id)).toBe(true);
    for (const d of DRILLS) {
      if (d.method === 'none') continue;
      expect(d.par).toBeDefined();
      const p = d.par!;
      if (d.method === 'time')
        expect(p.instructor < p.gold && p.gold < p.silver && p.silver < p.bronze).toBe(true);
      else expect(p.instructor > p.gold && p.gold > p.silver && p.silver > p.bronze).toBe(true);
    }
  });
});
