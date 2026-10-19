/**
 * IPSC-style cardboard target geometry (pure; unit tested). Units: centimetres, x centred,
 * y from the bottom edge. The cardboard is 46 x 76 cm.
 */
export type Zone = 'A' | 'C' | 'D';
export type Pt = [number, number];

export const PAPER_W_CM = 46;
export const PAPER_H_CM = 76;

export const BODY: Pt[] = [
  [-17, 0],
  [17, 0],
  [23, 9],
  [23, 45],
  [14, 57],
  [-14, 57],
  [-23, 45],
  [-23, 9],
];
export const NECK: [number, number, number, number] = [-6, 56, 6, 60];
export const HEAD: [number, number, number, number] = [-8, 59, 8, 76];
export const C_BODY: Pt[] = [
  [-11, 8],
  [11, 8],
  [15, 14],
  [15, 44],
  [9, 52],
  [-9, 52],
  [-15, 44],
  [-15, 14],
];
export const A_BODY: [number, number, number, number] = [-7.5, 23, 7.5, 51];
export const A_HEAD: [number, number, number, number] = [-4.5, 65, 4.5, 71];

function inRect(x: number, y: number, r: [number, number, number, number]) {
  return x >= r[0] && x <= r[2] && y >= r[1] && y <= r[3];
}

export function inPoly(x: number, y: number, poly: Pt[]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i],
      [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Scoring zone for a hit at (lx, ly) metres from the target centre, or null if it's off the cardboard. */
export function zoneAt(lx: number, ly: number): Zone | null {
  const x = lx * 100,
    y = ly * 100 + PAPER_H_CM / 2;
  if (inRect(x, y, A_HEAD) || inRect(x, y, A_BODY)) return 'A';
  if (inRect(x, y, HEAD) || inPoly(x, y, C_BODY)) return 'C';
  if (inPoly(x, y, BODY) || inRect(x, y, NECK)) return 'D';
  return null;
}

export const ZONE_POINTS: Record<Zone, number> = { A: 5, C: 3, D: 1 };
