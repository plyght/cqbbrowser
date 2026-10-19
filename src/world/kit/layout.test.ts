import { describe, expect, test } from 'bun:test';
import layoutA from './layouts/killhouseA.json';
import { assignRoles, deriveRoomGraph, OUTSIDE, roomAt, wallPieces, type Layout } from './layout';

const L = layoutA as Layout;

describe('kill house layout', () => {
  test('room graph: rooms, portals and what they connect', () => {
    const g = deriveRoomGraph(L, [100, 50], 'khA');
    expect(g.rooms.map((r) => r.id).sort()).toEqual([
      'khA.H1',
      'khA.H2',
      'khA.R1',
      'khA.R2',
      'khA.R3',
      'khA.R4',
    ]);
    const portal = (id: string) => g.portals.find((p) => p.id === `khA.${id}`)!;
    const link = (id: string) => [...portal(id).rooms].sort();
    expect(link('D0')).toEqual(['khA.H1', OUTSIDE].sort());
    expect(link('T1')).toEqual(['khA.H1', 'khA.H2']);
    expect(link('D1')).toEqual(['khA.H2', 'khA.R1']);
    expect(link('D2')).toEqual(['khA.H2', 'khA.R2']);
    expect(link('D3')).toEqual(['khA.H2', 'khA.R3']);
    expect(link('O4')).toEqual(['khA.H2', 'khA.R4']);
    expect(link('D5')).toEqual(['khA.R4', OUTSIDE].sort());
    // Doors carry their initial open amount; openings are always open.
    expect(portal('D3').open).toBe(0);
    expect(portal('D1').open).toBe(1);
    expect(portal('O4').open).toBe(1);
    expect(portal('D0').width).toBeCloseTo(0.9);
    expect(portal('D0').height).toBeCloseTo(2.03);
    // World placement and open-top rooms.
    const h1 = g.rooms.find((r) => r.id === 'khA.H1')!;
    expect(h1.min).toEqual([107.4, 0, 56]);
    expect(h1.max[1]).toBe(2.4);
    expect(h1.openTop).toBe(true);
    expect(h1.max[0] - h1.min[0]).toBeCloseTo(1.2);
    expect(g.portals.filter((p) => p.kind === 'sky').length).toBe(6);
  });

  test('every target stands inside a room', () => {
    for (const t of L.targets) expect(roomAt(L, t.at)).toBeDefined();
  });

  test('wall pieces leave door-sized gaps with headers', () => {
    const pieces = wallPieces(L);
    // South exterior wall (z = 12) is cut by the entry door at x = 8.
    const south = pieces.filter((p) => p.axis === 'x' && Math.abs(p.z - 12) < 1e-6);
    const full = south.filter((p) => p.y === 0).sort((a, b) => a.x - b.x);
    expect(full.length).toBe(2);
    const gap = full[1].x - full[1].sx / 2 - (full[0].x + full[0].sx / 2);
    expect(gap).toBeCloseTo(0.9);
    const header = south.find((p) => p.y > 0)!;
    expect(header.y).toBeCloseTo(2.03);
    expect(header.h).toBeCloseTo(0.37);
    expect(south.every((p) => p.exterior)).toBe(true);
    // x-walls own the corners: the south wall spans the full width plus half thickness each side.
    const min = Math.min(...full.map((p) => p.x - p.sx / 2));
    expect(min).toBeCloseTo(-L.wallThickness / 2);
  });

  test('roles are seeded, deterministic and respect guarantees', () => {
    const a = assignRoles(L.targets, 42, { minNoShoots: 2, minThreats: 5 });
    const b = assignRoles(L.targets, 42, { minNoShoots: 2, minThreats: 5 });
    expect(a).toEqual(b);
    const seeds = [1, 2, 3, 4, 5, 6, 7, 8].map((s) =>
      assignRoles(L.targets, s, { minNoShoots: 2, minThreats: 5 }),
    );
    for (const r of seeds) {
      const vals = Object.values(r);
      expect(vals.filter((v) => v === 'noshoot').length).toBeGreaterThanOrEqual(2);
      expect(vals.filter((v) => v === 'threat').length).toBeGreaterThanOrEqual(5);
    }
    // Different seeds produce different placements.
    expect(new Set(seeds.map((r) => JSON.stringify(r))).size).toBeGreaterThan(3);
    // Fixed roles stay fixed.
    const fixed = assignRoles(
      [
        { id: 'x', role: 'noshoot' },
        { id: 'y', role: 'threat' },
      ],
      9,
      { minNoShoots: 0, minThreats: 0 },
    );
    expect(fixed).toEqual({ x: 'noshoot', y: 'threat' });
  });
});
