/**
 * UI-side drill contracts. The drills engine provides the real list via `setDrillSource()`; until then the menu
 * shows placeholder data so the Play flow can be designed and tested.
 */
export type Medal = 'gold' | 'silver' | 'bronze';

export interface DrillInfo {
  id: string;
  name: string;
  facility: string;
  /** Par time, seconds. */
  par: number;
  /** Personal best, seconds. */
  best?: number;
  medal?: Medal;
  /** One-line brief shown in the detail panel. */
  brief?: string;
}

/** What the results screen shows after a run. */
export interface RunResult {
  drillId: string;
  drillName: string;
  facility?: string;
  /** Raw time on the shot timer, seconds. */
  time: number;
  par: number;
  hits: number;
  shots: number;
  penalties: { label: string; seconds: number }[];
  /** Split times, seconds (first shot, then shot-to-shot / target-to-target). */
  splits: number[];
  medal?: Medal;
  /** Previous personal best (final time), seconds — for the PB delta. */
  previousBest?: number;
  /** A replay exists for "Watch footage". */
  hasFootage?: boolean;
}

export const finalTime = (r: Pick<RunResult, 'time' | 'penalties'>) =>
  r.time + r.penalties.reduce((a, p) => a + p.seconds, 0);

export const PLACEHOLDER_DRILLS: DrillInfo[] = [
  {
    id: 'sq-bill',
    name: 'Bill Drill',
    facility: 'Square Range',
    par: 2.5,
    best: 2.71,
    medal: 'silver',
    brief: '6 rounds, one target, 7 m. From the ready.',
  },
  {
    id: 'sq-elpres',
    name: 'El Presidente',
    facility: 'Square Range',
    par: 10,
    best: 9.42,
    medal: 'gold',
    brief: 'Turn, 2 each on 3 targets, reload, repeat.',
  },
  {
    id: 'sq-mozam',
    name: 'Mozambique',
    facility: 'Square Range',
    par: 3.2,
    brief: 'Two to the body, one to the head. Three targets.',
  },
  {
    id: 'sq-reload',
    name: 'Slide-lock Reload',
    facility: 'Square Range',
    par: 4,
    best: 4.88,
    medal: 'bronze',
    brief: 'Shoot dry, speed reload, two more.',
  },
  {
    id: 'st-rack',
    name: 'Plate Rack',
    facility: 'Steel Bay',
    par: 5.5,
    best: 6.02,
    medal: 'bronze',
    brief: 'Six 8" plates, 10 m. Clear the rack.',
  },
  {
    id: 'st-star',
    name: 'Texas Star',
    facility: 'Steel Bay',
    par: 8,
    brief: 'Five plates on a spinning star.',
  },
  {
    id: 'st-poppers',
    name: 'Popper Run',
    facility: 'Steel Bay',
    par: 12,
    best: 11.2,
    medal: 'gold',
    brief: 'Move between three boxes, knock down every popper.',
  },
  {
    id: 'kh-a-entry',
    name: 'Kill House A: Entry',
    facility: 'Kill House A',
    par: 18,
    brief: 'Breach, clear two rooms, mind the no-shoots.',
  },
  {
    id: 'kh-a-full',
    name: 'Kill House A: Full Clear',
    facility: 'Kill House A',
    par: 45,
    brief: 'Every room, every target. No penalties.',
  },
];

let source: () => DrillInfo[] = () => PLACEHOLDER_DRILLS;

export function setDrillSource(fn: () => DrillInfo[]) {
  source = fn;
}
export function getDrills(): DrillInfo[] {
  return source();
}
export function facilities(drills: DrillInfo[]): string[] {
  return [...new Set(drills.map((d) => d.facility))];
}

/** Medal for a final time against par (gold ≤ par, silver ≤ 1.25 par, bronze ≤ 1.6 par). */
export function medalFor(final: number, par: number): Medal | undefined {
  if (final <= par) return 'gold';
  if (final <= par * 1.25) return 'silver';
  if (final <= par * 1.6) return 'bronze';
  return undefined;
}
