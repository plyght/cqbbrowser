import type { EndRule } from './machine';
import type { Method, Par } from './scoring';

/**
 * Drill definitions (data). Targets are world target ids or `prefix*` patterns. `threats: 'killhouse'`
 * means the paper threats/no-shoots are whatever this run's seeded randomisation produced.
 */
export interface DrillDef {
  id: string;
  name: string;
  description: string;
  facility: 'range' | 'steel' | 'killhouse';
  /** Spawn point name (see World.spawnPoint). */
  spawn: string;
  /** Start facing away from the targets (turn on the beep). */
  turn?: boolean;
  method: Method;
  end: EndRule;
  /** Paper threats and how many scoring hits each needs. */
  paper?: { targets: string[]; required: number };
  /** Steel that must be neutralised (gongs ring; poppers/plates must fall). */
  steel?: string[];
  threats?: 'killhouse';
  par?: Par;
  /** Seconds; default 60. */
  timeLimit?: number;
  standby?: [number, number];
}

export const DRILLS: DrillDef[] = [
  {
    id: 'free',
    name: 'Free Practice',
    description:
      'No timer. Shoot anything on the square range. Restart repaints the steel and patches the paper.',
    facility: 'range',
    spawn: 'range.bay2',
    method: 'none',
    end: { kind: 'none' },
  },
  {
    id: 'bill',
    name: 'Bill Drill',
    description: 'Six rounds on one target at 7 m, as fast as you can keep them in the A-zone.',
    facility: 'range',
    spawn: 'range.bay2',
    method: 'time',
    end: { kind: 'shots', count: 6 },
    paper: { targets: ['range.b2.p1'], required: 6 },
    par: { bronze: 5, silver: 3.6, gold: 2.8, instructor: 2.1 },
    timeLimit: 20,
  },
  {
    id: 'elprez',
    name: 'El Presidente',
    description: 'Facing uprange. On the beep turn, two each on three targets, reload, two each again. 9 m.',
    facility: 'range',
    spawn: 'range.bay1.uprange',
    turn: true,
    method: 'hitFactor',
    end: { kind: 'shots', count: 12 },
    paper: { targets: ['range.b1.p*'], required: 4 },
    par: { bronze: 2.5, silver: 4, gold: 5.5, instructor: 7 },
    timeLimit: 40,
  },
  {
    id: 'steel5',
    name: 'Steel: 5 to Go',
    description: 'Four 12" plates in any order, stop plate last. Every plate must ring.',
    facility: 'steel',
    spawn: 'steel.5tg',
    method: 'time',
    end: { kind: 'targets' },
    steel: ['steel.5tg.0', 'steel.5tg.1', 'steel.5tg.2', 'steel.5tg.3', 'steel.5tg.stop'],
    par: { bronze: 8, silver: 5, gold: 3.6, instructor: 2.6 },
    timeLimit: 30,
  },
  {
    id: 'platerack',
    name: 'Plate Rack Run',
    description: 'Six 8" plates at 10 m. All six down.',
    facility: 'steel',
    spawn: 'steel.rack',
    method: 'time',
    end: { kind: 'targets' },
    steel: ['steel.rack.*'],
    par: { bronze: 9, silver: 6, gold: 4.2, instructor: 3.2 },
    timeLimit: 40,
  },
  {
    id: 'texasstar',
    name: 'Texas Star',
    description: 'Clear the star. It spins as the plates come off — time your shots.',
    facility: 'steel',
    spawn: 'steel.star',
    method: 'time',
    end: { kind: 'targets' },
    steel: ['steel.star'],
    par: { bronze: 12, silver: 8, gold: 5.5, instructor: 4 },
    timeLimit: 45,
  },
  {
    id: 'poppers',
    name: 'Popper Field',
    description:
      'Five standard poppers and one heavy popper at 20 m. Hit them above the line — all must fall.',
    facility: 'steel',
    spawn: 'steel.popper',
    method: 'time',
    end: { kind: 'targets' },
    steel: ['steel.popper.*'],
    par: { bronze: 12, silver: 8, gold: 5.5, instructor: 4 },
    timeLimit: 45,
  },
  {
    id: 'killhouseA',
    name: 'Kill House A',
    description: "Clear the house: two hits on every threat, don't touch the no-shoots, exit through Room 4.",
    facility: 'killhouse',
    spawn: 'killhouse.start',
    method: 'time',
    end: { kind: 'zone' },
    threats: 'killhouse',
    paper: { targets: ['kh.*'], required: 2 },
    par: { bronze: 90, silver: 60, gold: 42, instructor: 32 },
    timeLimit: 240,
    standby: [1.5, 3],
  },
];
