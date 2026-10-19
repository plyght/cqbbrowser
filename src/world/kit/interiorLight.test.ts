import { expect, test } from 'bun:test';
import { Vector3 } from 'three';
import { InteriorLighting, khBox, khSegA, khSegB } from './interiorLight';

test('analytic wall occlusion: blocked through a wall, clear through the opening and over it', () => {
  const lt = new InteriorLighting({ minX: 0, minZ: 0, maxX: 10, maxZ: 10, top: 2.54 });
  // A wall along z = 5 from x 0..10 with a door gap x 4..5 (header above 2.03).
  lt.setStatic([
    { a: [0, 5], b: [4, 5], y0: 0, y1: 2.4 },
    { a: [5, 5], b: [10, 5], y0: 0, y1: 2.4 },
    { a: [4, 5], b: [5, 5], y0: 2.03, y1: 2.4 },
  ]);
  const bulb = new Vector3(2, 2.1, 3);
  expect(lt.occlusion(bulb, new Vector3(2, 0, 7))).toBe(0);
  // Through the doorway (crosses z = 5 at x ≈ 4.5, y ≈ 1.05).
  expect(lt.occlusion(bulb, new Vector3(7, 0, 7))).toBe(1);
  // Same room.
  expect(lt.occlusion(bulb, new Vector3(8, 0, 1))).toBe(1);
  // Above the wall top (ceiling of the next room, between joists).
  expect(lt.occlusion(bulb, new Vector3(2, 2.53, 5.6))).toBe(1);
  expect(lt.segmentCount).toBe(3);
  expect(khBox[12]).toBe(3);
  expect([...khSegA.slice(4, 8)]).toEqual([5, 5, 10, 5]);
  expect(khSegB[2]).toBeCloseTo(0);
  expect(khSegB[3]).toBeCloseTo(2.4);
});

test('door leaves are dynamic occluders', () => {
  const lt = new InteriorLighting({ minX: 0, minZ: 0, maxX: 10, maxZ: 10, top: 2.54 });
  lt.setStatic([{ a: [0, 5], b: [4, 5], y0: 0, y1: 2.4 }]);
  const bulb = new Vector3(4.5, 1.5, 3);
  const p = new Vector3(4.5, 1.0, 7);
  expect(lt.occlusion(bulb, p)).toBe(1);
  lt.setDynamic([{ a: [4, 5], b: [5, 5], y0: 0, y1: 2.0 }]);
  expect(lt.occlusion(bulb, p)).toBe(0);
  lt.setDynamic([]);
  expect(lt.occlusion(bulb, p)).toBe(1);
  expect(lt.segmentCount).toBe(1);
});
