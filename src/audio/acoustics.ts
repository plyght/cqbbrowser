/**
 * Organic reverb maths (PRD §9.2): pure functions, no Web Audio, unit-tested.
 *
 * B. Real-time listener probe: rays from the listener → enclosure, mean free path, ceiling height,
 *    openness direction, an estimated room volume/surface, Eyring RT60 using per-surface absorption, bass
 *    buildup + axial mode for small rooms, and early-reflection taps. `smoothAcoustics` low-passes it so an
 *    indoor tail morphs continuously into the outdoor slapback.
 * A. Authored room graph (§9.3) — types and `roomAcoustics()` for a future JSON layout; the engine exposes
 *    `setRoomGraph(rooms, portals)` as the hook.
 */
import type { Surface } from '../core/bus';
import { clamp, lerp } from './rng';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export const SPEED_OF_SOUND = 343;
/** Rays that hit within this range count as enclosing (PRD: 30 m). */
export const ENCLOSE_RANGE = 30;
/** Probe ray length — longer than ENCLOSE_RANGE so distant berms/buildings still give slapback taps. */
export const PROBE_RANGE = 80;
export const PROBE_RAYS = 24;

export interface ProbeRay {
  dir: Vec3;
  /** Hit distance in metres, or Infinity for a miss. */
  dist: number;
  surface?: Surface;
  /** Surface normal at the hit (optional; grazing hits reflect away from the listener). */
  normal?: Vec3;
}

/**
 * Probe directions: index 0 straight up (ceiling), 1 straight down (floor), the rest a Fibonacci sphere biased
 * toward the horizon (walls matter most for enclosure). Fixed, so results are comparable frame to frame.
 */
export function probeDirections(n = PROBE_RAYS): Vec3[] {
  const dirs: Vec3[] = [
    { x: 0, y: 1, z: 0 },
    { x: 0, y: -1, z: 0 },
  ];
  const m = n - 2;
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < m; i++) {
    // y in (-0.55, 0.9): fewer rays straight into the ground, a few toward the sky.
    const y = lerp(0.9, -0.55, (i + 0.5) / m);
    const r = Math.sqrt(1 - y * y);
    const th = golden * i;
    dirs.push({ x: Math.cos(th) * r, y, z: Math.sin(th) * r });
  }
  return dirs;
}

/** Sabine absorption coefficients (broadband, ~500 Hz–1 kHz). Misses (open air) absorb everything. */
export const ABSORPTION: Record<Surface, number> = {
  concrete: 0.02,
  concrete_dusty: 0.04,
  wood: 0.1,
  plywood: 0.12,
  drywall: 0.06,
  carpet: 0.35,
  tile: 0.02,
  gravel: 0.35,
  dirt: 0.4,
  grass: 0.55,
  metal: 0.03,
  steel_target: 0.02,
  paper_target: 0.3,
  berm: 0.45,
};

export interface ErTap {
  /** Seconds (round trip). */
  delay: number;
  gain: number;
  /** -1..1 relative to listener right. */
  pan: number;
  /** Low-pass cutoff for the reflection, Hz. */
  cutoff: number;
}

export interface Acoustics {
  /** 0 = open field … 1 = sealed room. */
  enclosure: number;
  /** Fraction of horizontal rays that hit a wall within ENCLOSE_RANGE. */
  walls: number;
  /** Fraction of upward rays that hit a roof within ENCLOSE_RANGE. */
  roof: number;
  /** Mean hit distance (misses clamped to ENCLOSE_RANGE), metres. */
  meanFreePath: number;
  /** Up-ray distance, Infinity outdoors. */
  ceiling: number;
  /** Average direction escaping air goes (world space, not normalised; length = open fraction). */
  openness: Vec3;
  volume: number;
  surfaceArea: number;
  /** Mean absorption incl. openings (escaping rays count as α = 1). */
  absorption: number;
  /** Eyring RT60 of the enclosed part, seconds. */
  rt60: number;
  /** 0..1 extra low end for small, sealed rooms ("bathroom boom"). */
  bass: number;
  /** Lowest axial mode estimate, Hz. */
  roomMode: number;
  /** Seconds between direct sound and the diffuse tail. */
  predelay: number;
  taps: ErTap[];
}

export const OUTDOOR: Acoustics = {
  enclosure: 0,
  walls: 0,
  roof: 0,
  meanFreePath: ENCLOSE_RANGE,
  ceiling: Infinity,
  openness: { x: 0, y: 1, z: 0 },
  volume: 1e5,
  surfaceArea: 1e4,
  absorption: 0.9,
  rt60: 0.1,
  bass: 0,
  roomMode: 40,
  predelay: 0.04,
  taps: [],
};

/** Eyring reverberation time. V m³, S m², α mean absorption. */
export function eyringRt60(volume: number, surface: number, alpha: number) {
  const a = clamp(alpha, 0.005, 0.98);
  return (0.161 * volume) / (-surface * Math.log(1 - a));
}

/** Sabine reverberation time (for reference/tests). */
export function sabineRt60(volume: number, surface: number, alpha: number) {
  return (0.161 * volume) / (surface * Math.max(1e-3, alpha));
}

/**
 * Turn probe rays into acoustic parameters. `right` is the listener's right vector (for tap panning).
 * The down ray (index 1 from probeDirections) is used for listener height only.
 */
export function analyseProbe(rays: ProbeRay[], right: Vec3 = { x: 1, y: 0, z: 0 }, maxTaps = 6): Acoustics {
  let wallN = 0,
    wallHit = 0,
    roofN = 0,
    roofHit = 0;
  let sumDist = 0,
    nDist = 0,
    sumAlpha = 0;
  let horizSum = 0,
    horizN = 0;
  const open = { x: 0, y: 0, z: 0 };
  let ceiling = Infinity;
  let floor = 1.6;
  const hits: ProbeRay[] = [];
  for (const r of rays) {
    const hit = r.dist < ENCLOSE_RANGE;
    if (r.dir.y < -0.95) {
      if (Number.isFinite(r.dist)) floor = r.dist;
      continue;
    }
    if (r.dir.y > 0.95) ceiling = r.dist;
    if (r.dir.y >= 0.5) {
      roofN++;
      if (hit) roofHit++;
    } else if (r.dir.y > -0.3) {
      wallN++;
      if (hit) wallHit++;
      const d = Math.min(r.dist, ENCLOSE_RANGE);
      horizSum += d * Math.sqrt(1 - r.dir.y * r.dir.y);
      horizN++;
    }
    sumDist += Math.min(r.dist, ENCLOSE_RANGE);
    nDist++;
    sumAlpha += hit ? (ABSORPTION[r.surface ?? 'concrete'] ?? 0.05) : 1;
    if (!hit && r.dir.y > -0.3) {
      open.x += r.dir.x;
      open.y += r.dir.y;
      open.z += r.dir.z;
    }
    if (Number.isFinite(r.dist) && r.dir.y > -0.6) hits.push(r);
  }
  const walls = wallN ? wallHit / wallN : 0;
  const roof = roofN ? roofHit / roofN : 0;
  // A roof matters most (pressure can't vent up), walls finish the seal. Open field with berms ≈ 0.15,
  // covered firing line ≈ 0.55, closed room = 1.
  const enclosure = clamp(roof * (0.4 + 0.6 * walls) + (1 - roof) * 0.3 * walls, 0, 1);
  const n = Math.max(1, nDist);
  const openFrac = Math.max(0, 1 - (wallHit + roofHit) / Math.max(1, wallN + roofN));
  const olen = Math.hypot(open.x, open.y, open.z) || 1;
  const openness = {
    x: (open.x / olen) * openFrac,
    y: (open.y / olen) * openFrac,
    z: (open.z / olen) * openFrac,
  };

  // Room estimate: horizontal hits ≈ radius of an equivalent cylinder, height = floor + ceiling.
  const radius = horizN ? horizSum / horizN : ENCLOSE_RANGE;
  const height = Math.min(Number.isFinite(ceiling) ? ceiling : ENCLOSE_RANGE, ENCLOSE_RANGE) + floor;
  const area = Math.PI * radius * radius;
  const volume = area * height;
  const surfaceArea = 2 * area + 2 * Math.PI * radius * height;
  const absorption = clamp(sumAlpha / n, 0.01, 1);
  const rt60 = clamp(eyringRt60(volume, surfaceArea, absorption), 0.05, 4);

  // Small sealed rooms: the pressure has nowhere to go. Axial mode from the largest dimension.
  const largest = Math.max(2 * radius, height);
  const roomMode = clamp(SPEED_OF_SOUND / (2 * largest), 25, 200);
  const small = clamp((80 - volume) / 70, 0, 1);
  const bass = clamp(enclosure * enclosure * small * (1 - 0.6 * openFrac), 0, 1);
  const meanFreePath = sumDist / n;
  const predelay = clamp(meanFreePath / SPEED_OF_SOUND, 0.002, 0.045);

  return {
    enclosure,
    walls,
    roof,
    meanFreePath,
    ceiling,
    openness,
    volume,
    surfaceArea,
    absorption,
    rt60,
    bass,
    roomMode,
    predelay,
    taps: earlyReflections(hits, right, maxTaps),
  };
}

/**
 * Early reflections: nearest surfaces in distinct directions (≥ ~40° apart). Image-source-ish: delay is the
 * round trip, gain falls with path length and surface absorption, far/absorbent reflections get duller.
 */
export function earlyReflections(hits: ProbeRay[], right: Vec3, maxTaps = 6): ErTap[] {
  const taps = hits
    // The floor bounce under a chest-mounted mic arrives with the direct sound; not a separate tap.
    .filter((h) => h.dist >= 0.25 && !(h.dir.y < -0.05 && (h.normal?.y ?? 0) > 0.7))
    .map((h) => {
      const path = 2 * h.dist;
      const alpha = ABSORPTION[h.surface ?? 'concrete'] ?? 0.05;
      // Energy returned toward the listener: facing surfaces reflect back, grazing ones (the ground far
      // ahead) send it away.
      const facing = h.normal
        ? Math.abs(h.normal.x * h.dir.x + h.normal.y * h.dir.y + h.normal.z * h.dir.z)
        : 1;
      return {
        h,
        tap: {
          delay: path / SPEED_OF_SOUND,
          gain: clamp((1 - alpha) * facing * (1.2 / (1 + path * 0.12)), 0, 0.8),
          pan: clamp(h.dir.x * right.x + h.dir.y * right.y + h.dir.z * right.z, -1, 1) * 0.85,
          cutoff: clamp(14000 * (1 - alpha) * Math.exp(-path / 90), 1500, 14000),
        },
      };
    })
    .sort((a, b) => b.tap.gain - a.tap.gain);
  const chosen: typeof taps = [];
  for (const t of taps) {
    if (t.tap.gain < 0.02) break;
    const d = t.h.dir;
    if (chosen.every((c) => c.h.dir.x * d.x + c.h.dir.y * d.y + c.h.dir.z * d.z < 0.75)) chosen.push(t);
    if (chosen.length >= maxTaps) break;
  }
  return chosen.map((c) => c.tap).sort((a, b) => a.delay - b.delay);
}

/** One-pole smoothing factor for a time constant τ over dt. */
export const smoothK = (dt: number, tau: number) => 1 - Math.exp(-dt / Math.max(1e-4, tau));

/** Low-pass the scalar parameters toward a target (taps are replaced, the mixer glides them). */
export function smoothAcoustics(cur: Acoustics, target: Acoustics, k: number): Acoustics {
  const L = (a: number, b: number) => a + (b - a) * k;
  const fin = (v: number) => (Number.isFinite(v) ? v : ENCLOSE_RANGE * 2);
  return {
    enclosure: L(cur.enclosure, target.enclosure),
    walls: L(cur.walls, target.walls),
    roof: L(cur.roof, target.roof),
    meanFreePath: L(cur.meanFreePath, target.meanFreePath),
    ceiling: L(fin(cur.ceiling), fin(target.ceiling)),
    openness: {
      x: L(cur.openness.x, target.openness.x),
      y: L(cur.openness.y, target.openness.y),
      z: L(cur.openness.z, target.openness.z),
    },
    volume: Math.exp(L(Math.log(cur.volume), Math.log(target.volume))),
    surfaceArea: Math.exp(L(Math.log(cur.surfaceArea), Math.log(target.surfaceArea))),
    absorption: L(cur.absorption, target.absorption),
    rt60: Math.exp(L(Math.log(cur.rt60), Math.log(target.rt60))),
    bass: L(cur.bass, target.bass),
    roomMode: L(cur.roomMode, target.roomMode),
    predelay: L(cur.predelay, target.predelay),
    taps: target.taps,
  };
}

// --- Reverb bank selection ------------------------------------------------------------------------------

/**
 * The IR bank is a 1-D "space axis": 0 outdoor … 5 booth. Adjacent entries crossfade; with even/odd
 * convolver assignment only 2 convolvers are ever needed and a buffer swap always happens at zero weight.
 */
export const BANK = [
  { name: 'outdoor', rt60: 1.6, volume: 1e5 },
  { name: 'covered', rt60: 0.9, volume: 3000 },
  { name: 'hall', rt60: 1.5, volume: 800 },
  { name: 'room', rt60: 0.8, volume: 150 },
  { name: 'small', rt60: 0.6, volume: 30 },
  { name: 'booth', rt60: 0.5, volume: 6 },
] as const;

/**
 * Map an enclosed space onto the hall…booth part of the axis (2..5) by its volume: the size of the space
 * sets the IR character (density, pre-delay, low end); RT60 sets how loud the tail is (`wetLevel`).
 */
export function indoorPosition(volume: number) {
  const pts = [2, 3, 4, 5].map((i) => Math.log(BANK[i].volume));
  const x = Math.log(clamp(volume, BANK[5].volume, BANK[2].volume));
  for (let i = 0; i < 3; i++) {
    if (x <= pts[i] && x >= pts[i + 1]) return 2 + i + (pts[i] - x) / (pts[i] - pts[i + 1]);
  }
  return x > pts[0] ? 2 : 5;
}

/** Continuous bank position from enclosure + volume (no hard indoor/outdoor switch). */
export function bankPosition(a: Pick<Acoustics, 'enclosure' | 'volume'>) {
  const e = clamp(a.enclosure, 0, 1);
  if (e < 0.5) return e * 2; // outdoor → covered
  return lerp(1, indoorPosition(a.volume), (e - 0.5) / 0.5);
}

/** Convolver weights for a bank position: A holds even indices, B odd. */
export function convolverMix(pos: number) {
  const p = clamp(pos, 0, BANK.length - 1);
  const i = Math.min(BANK.length - 2, Math.floor(p));
  const f = p - i;
  const even = i % 2 === 0 ? i : i + 1;
  const odd = i % 2 === 0 ? i + 1 : i;
  const wEven = i % 2 === 0 ? 1 - f : f;
  // Equal-power crossfade.
  return {
    a: { index: even, gain: Math.cos(((1 - wEven) * Math.PI) / 2) },
    b: { index: odd, gain: Math.cos((wEven * Math.PI) / 2) },
  };
}

/** Overall wet (tail) level: grows with enclosure and room size, outdoor tail stays present but low. */
export function wetLevel(a: Pick<Acoustics, 'enclosure' | 'rt60' | 'absorption'>) {
  return clamp(0.22 + 0.6 * a.enclosure * clamp(a.rt60 / 1.2, 0.35, 1.2) * (1 - 0.5 * a.absorption), 0, 1);
}

// --- Authored room graph (§9.2 A / §9.3) — hook for a future JSON layout --------------------------------

export interface RoomBandAbsorption {
  /** Absorption coefficient per octave band: 125, 500, 2k, 8k Hz. */
  bands: [number, number, number, number];
  area: number;
}

export interface Room {
  id: string;
  volume: number;
  floorArea: number;
  ceilingHeight: number;
  surfaces: RoomBandAbsorption[];
  /** Axis-aligned bounds for listener lookup. */
  min: Vec3;
  max: Vec3;
}

export interface Portal {
  id: string;
  rooms: [string, string | 'outside'];
  /** Opening area m² when fully open. */
  area: number;
  /** 0 closed … 1 open; doors update this live. */
  openness: number;
  position: Vec3;
}

/** Per-room derived acoustics: RT60 per band (Eyring), leakiness, bass buildup and first axial mode. */
export function roomAcoustics(room: Room, portals: Portal[]) {
  const S = room.surfaces.reduce((a, s) => a + s.area, 0);
  const open = portals
    .filter((p) => p.rooms.includes(room.id))
    .reduce((a, p) => a + p.area * clamp(p.openness, 0, 1), 0);
  const leakiness = clamp(open / Math.max(1, S), 0, 1);
  const rt60 = [0, 1, 2, 3].map((b) => {
    const absorbed = room.surfaces.reduce((a, s) => a + s.area * s.bands[b], 0) + open;
    return eyringRt60(room.volume, S, absorbed / Math.max(1, S));
  });
  const largest = Math.max(Math.sqrt(room.floorArea) * 1.3, room.ceilingHeight);
  return {
    rt60,
    leakiness,
    bass: clamp(((60 - room.volume) / 50) * (1 - 4 * leakiness), 0, 1),
    roomMode: SPEED_OF_SOUND / (2 * largest),
  };
}
