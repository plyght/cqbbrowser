import { describe, expect, test } from 'bun:test';
import { finalTime, medalFor } from './drills';
import { fmtDelta, fmtTime, pickNext, Repeater, stepValue, stickDir, type Box } from './nav';

const b = (x: number, y: number, w = 100, h = 30): Box => ({ x, y, w, h });

describe('pickNext', () => {
  const column = [b(0, 0), b(0, 40), b(0, 80)];
  test('moves down/up a column', () => {
    expect(pickNext(column[0], column, 'down')).toBe(1);
    expect(pickNext(column[1], column, 'down')).toBe(2);
    expect(pickNext(column[2], column, 'up')).toBe(1);
    expect(pickNext(column[2], column, 'down')).toBe(-1);
    expect(pickNext(column[0], column, 'left')).toBe(-1);
  });

  test('prefers aligned candidates over nearer diagonal ones', () => {
    // Tab bar above a two-column grid: down from a tab over the right column goes to the right column.
    const tab = b(600, 0, 80, 30);
    const cands = [tab, b(0, 50, 480, 30), b(560, 60, 480, 30)];
    expect(pickNext(tab, cands, 'down')).toBe(2);
  });

  test('moves across columns', () => {
    const grid = [b(0, 0), b(200, 0), b(0, 40), b(200, 40)];
    expect(pickNext(grid[0], grid, 'right')).toBe(1);
    expect(pickNext(grid[3], grid, 'left')).toBe(2);
    expect(pickNext(grid[1], grid, 'down')).toBe(3);
  });
});

describe('Repeater', () => {
  test('fires on press, after delay, then at rate', () => {
    const r = new Repeater(0.3, 0.1);
    const fired: number[] = [];
    for (let i = 0; i < 60; i++) if (r.update(true, 1 / 60)) fired.push(i);
    // frame 0, then ~0.3 s (frame 18), then every 0.1 s.
    expect(fired[0]).toBe(0);
    expect(fired[1]).toBeGreaterThanOrEqual(17);
    expect(fired[1]).toBeLessThanOrEqual(19);
    expect(fired.length).toBeGreaterThanOrEqual(8);
    expect(fired.length).toBeLessThanOrEqual(9);
    expect(r.update(false, 1 / 60)).toBe(false);
    expect(r.update(true, 1 / 60)).toBe(true);
  });
});

describe('helpers', () => {
  test('stickDir', () => {
    expect(stickDir(0.1, 0.2)).toBeNull();
    expect(stickDir(0.9, 0.2)).toBe('right');
    expect(stickDir(-0.2, -0.8)).toBe('up');
    expect(stickDir(0, 0.7)).toBe('down');
  });
  test('stepValue snaps and clamps', () => {
    expect(stepValue(0.9, -0.05, 0, 1, 0.05)).toBeCloseTo(0.85);
    expect(stepValue(0.98, 0.05, 0, 1, 0.05)).toBe(1);
    expect(stepValue(34, 0.5, 10, 90, 0.5)).toBe(34.5);
    expect(stepValue(10, -1, 10, 90, 0.5)).toBe(10);
  });
  test('formatting', () => {
    expect(fmtTime(9.234)).toBe('9.23');
    expect(fmtTime(62.5)).toBe('1:02.50');
    expect(fmtDelta(-0.19)).toBe('−0.19');
    expect(fmtDelta(0.3)).toBe('+0.30');
    expect(fmtDelta(0)).toBe('±0.00');
  });
  test('medals and final time', () => {
    expect(finalTime({ time: 8.73, penalties: [{ label: 'miss', seconds: 0.5 }] })).toBeCloseTo(9.23);
    expect(medalFor(9.9, 10)).toBe('gold');
    expect(medalFor(12, 10)).toBe('silver');
    expect(medalFor(15, 10)).toBe('bronze');
    expect(medalFor(17, 10)).toBeUndefined();
  });
});
