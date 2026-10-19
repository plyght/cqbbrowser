/**
 * Kill-house layout format + pure derivations (wall spans, room/portal graph, role randomisation).
 * No three/rapier imports here so it's unit-testable. Layout coordinates: metres, x right, z toward the
 * entrance side (south), y up; walls are axis-aligned segments on their centre lines.
 */
export type V2 = [number, number];

export interface LayoutRoom {
  id: string;
  name?: string;
  kind?: 'room' | 'hall';
  min: V2;
  max: V2;
  floor?: string;
  /** Wall height override (defaults to layout.wallHeight). */
  height?: number;
}

export interface LayoutWall {
  a: V2;
  b: V2;
  /** Exterior walls are sheathed inside only, with studs exposed outside. */
  exterior?: boolean;
}

export interface LayoutOpening {
  id: string;
  at: V2;
  /** `window`: an unglazed opening with a sill (wall below it) — daylight comes in, you can shoot through. */
  kind: 'door' | 'opening' | 'window';
  width?: number;
  /** Top of the opening (header underside), metres above the floor. */
  height?: number;
  /** Windows: sill height (default 1.0). */
  sill?: number;
  door?: {
    /** Which end of the opening (along the wall axis) the hinge is on. */
    hinge: 'min' | 'max';
    /** Side of the wall (along its normal axis) the door swings into. */
    swing: '+' | '-';
    /** Initial open fraction 0..1. */
    open?: number;
  };
}

export interface LayoutTarget {
  id: string;
  at: V2;
  /** Point the target faces. */
  face: V2;
  role?: 'threat' | 'noshoot' | 'random';
}

export interface Layout {
  id: string;
  name: string;
  wallHeight: number;
  wallThickness: number;
  rooms: LayoutRoom[];
  walls: LayoutWall[];
  openings: LayoutOpening[];
  targets: LayoutTarget[];
  start: { at: V2; yaw: number };
  finish: { min: V2; max: V2 };
  /** Instructor catwalk over the walls; only built when the house has no roof. */
  catwalk?: { a: V2; b: V2; width: number; height: number };
  /** Flat roof: plywood sheathing on joists bearing on the wall top plates. */
  roof?: LayoutRoof;
  /** Practical lights (bare bulbs, work lights) for the roofed house. Rooms without one stay dark. */
  lights?: LayoutLight[];
}

export interface LayoutRoof {
  /** Axis the joists span along. */
  span: 'x' | 'z';
  /** Joist depth (2x6 = 0.14) and on-centre spacing. */
  joistDepth: number;
  spacing: number;
  /** Eave overhang past the exterior wall faces. */
  overhang: number;
  /** Sheathing thickness (penetrable by rounds). */
  sheathing: number;
}

export interface LayoutLight {
  id: string;
  kind: 'bulb' | 'work';
  at: V2;
  /** Height of the lamp (bulbs hang from the joists by default). */
  y?: number;
  /** Work lights: the point (x, z) the head is aimed at. */
  aim?: V2;
  on?: boolean;
  /** Bad socket: random dropouts. */
  flicker?: boolean;
  /** Luminous intensity (candela) override. */
  intensity?: number;
}

export interface RoomNode {
  id: string;
  name: string;
  kind: 'room' | 'hall' | 'outside';
  /** World-space AABB (y from floor to ceiling/wall top). */
  min: [number, number, number];
  max: [number, number, number];
  ceilingHeight: number;
  /** No roof: the room opens to the sky (relevant for reverb tails). */
  openTop: boolean;
  floor: string;
  walls: string;
  volume: number;
}

export interface Portal {
  id: string;
  kind: 'door' | 'opening' | 'sky';
  rooms: [string, string];
  center: [number, number, number];
  normal: [number, number, number];
  width: number;
  height: number;
  /** 0 = closed, 1 = fully open; live-updated for physics doors. */
  open: number;
}

export interface RoomGraph {
  rooms: RoomNode[];
  portals: Portal[];
}

export const OUTSIDE = 'outside';

/** Axis of a wall: 'x' if it runs along x (normal is z). */
export function wallAxis(w: LayoutWall): 'x' | 'z' {
  return Math.abs(w.a[1] - w.b[1]) < 1e-6 ? 'x' : 'z';
}

function onWall(w: LayoutWall, p: V2, eps = 1e-3) {
  const ax = wallAxis(w);
  const [lo, hi] =
    ax === 'x'
      ? [Math.min(w.a[0], w.b[0]), Math.max(w.a[0], w.b[0])]
      : [Math.min(w.a[1], w.b[1]), Math.max(w.a[1], w.b[1])];
  const along = ax === 'x' ? p[0] : p[1];
  const across = ax === 'x' ? p[1] - w.a[1] : p[0] - w.a[0];
  return Math.abs(across) < eps && along >= lo - eps && along <= hi + eps;
}

export function wallOf(layout: Layout, p: V2): LayoutWall | undefined {
  return layout.walls.find((w) => onWall(w, p));
}

export function roomAt(layout: Layout, p: V2): LayoutRoom | undefined {
  return layout.rooms.find((r) => p[0] > r.min[0] && p[0] < r.max[0] && p[1] > r.min[1] && p[1] < r.max[1]);
}

export const DOOR_W = 0.9;
export const DOOR_H = 2.03;

export interface WallPiece {
  /** Centre (x, z), bottom y, size along x/z, height. */
  x: number;
  z: number;
  y: number;
  sx: number;
  sz: number;
  h: number;
  exterior: boolean;
  axis: 'x' | 'z';
  /** For exterior walls, which side (sign along normal) faces outside. */
  outSign: number;
}

/**
 * Split walls into solid pieces around openings (with headers above them), handling joints so walls
 * don't overlap or z-fight: x-walls own corners, z-walls stop at x-wall faces.
 */
export function wallPieces(layout: Layout): WallPiece[] {
  const t = layout.wallThickness;
  const H = layout.wallHeight;
  const out: WallPiece[] = [];
  const cx = (layout.rooms.reduce((s, r) => s + r.min[0] + r.max[0], 0) / layout.rooms.length) * 0.5;
  const cz = (layout.rooms.reduce((s, r) => s + r.min[1] + r.max[1], 0) / layout.rooms.length) * 0.5;
  for (const w of layout.walls) {
    const ax = wallAxis(w);
    const i = ax === 'x' ? 0 : 1;
    let lo = Math.min(w.a[i], w.b[i]),
      hi = Math.max(w.a[i], w.b[i]);
    const fixed = ax === 'x' ? w.a[1] : w.a[0];
    const endAdjust = (along: number) => {
      const p: V2 = ax === 'x' ? [along, fixed] : [fixed, along];
      const others = layout.walls.filter((o) => o !== w && wallAxis(o) !== ax && onWall(o, p));
      if (!others.length) return 0;
      if (ax === 'z') return -t / 2;
      // x-wall: extend through a corner, stop at the face of a wall it tees into.
      const corner = others.some((o) => {
        const j = 1;
        return Math.abs(o.a[j] - fixed) < 1e-3 || Math.abs(o.b[j] - fixed) < 1e-3;
      });
      return corner ? t / 2 : -t / 2;
    };
    lo -= endAdjust(lo);
    hi += endAdjust(hi);
    const ops = layout.openings
      .filter((o) => onWall(w, o.at))
      .map((o) => {
        const half = (o.width ?? DOOR_W) / 2;
        const c = o.at[i];
        const { bottom, top } = openingSpan(o);
        return { lo: c - half, hi: c + half, h: top, sill: bottom };
      })
      .sort((a, b) => a.lo - b.lo);
    const outSign = w.exterior ? Math.sign(fixed - (ax === 'x' ? cz : cx)) || 1 : 0;
    const piece = (a: number, b: number, y: number, h: number) => {
      if (b - a < 1e-3 || h < 1e-3) return;
      const mid = (a + b) / 2;
      out.push({
        x: ax === 'x' ? mid : fixed,
        z: ax === 'x' ? fixed : mid,
        y,
        sx: ax === 'x' ? b - a : t,
        sz: ax === 'x' ? t : b - a,
        h,
        exterior: !!w.exterior,
        axis: ax,
        outSign,
      });
    };
    let cur = lo;
    for (const o of ops) {
      piece(cur, o.lo, 0, H);
      piece(o.lo, o.hi, 0, o.sill);
      piece(o.lo, o.hi, o.h, H - o.h);
      cur = o.hi;
    }
    piece(cur, hi, 0, H);
  }
  return out;
}

/** Derive the audio room/portal graph from a layout placed at `origin` (world x, z). */
export function deriveRoomGraph(
  layout: Layout,
  origin: V2 = [0, 0],
  prefix = layout.id,
  roofed = !!layout.roof,
): RoomGraph {
  const H = roofed ? ceilingOf(layout) : layout.wallHeight;
  const [ox, oz] = origin;
  const rid = (id: string) => (id === OUTSIDE ? OUTSIDE : `${prefix}.${id}`);
  const rooms: RoomNode[] = layout.rooms.map((r) => {
    const h = roofed ? H : (r.height ?? H);
    const sx = r.max[0] - r.min[0],
      sz = r.max[1] - r.min[1];
    return {
      id: rid(r.id),
      name: r.name ?? r.id,
      kind: r.kind ?? 'room',
      min: [r.min[0] + ox, 0, r.min[1] + oz],
      max: [r.max[0] + ox, h, r.max[1] + oz],
      ceilingHeight: h,
      openTop: !roofed,
      floor: r.floor ?? 'concrete_dusty',
      walls: 'plywood',
      volume: sx * sz * h,
    };
  });
  const portals: Portal[] = [];
  for (const o of layout.openings) {
    const w = wallOf(layout, o.at);
    if (!w) continue;
    const ax = wallAxis(w);
    const n: V2 = ax === 'x' ? [0, 1] : [1, 0];
    const probe = (s: number): V2 => [o.at[0] + n[0] * s * 0.35, o.at[1] + n[1] * s * 0.35];
    const a = roomAt(layout, probe(-1))?.id ?? OUTSIDE;
    const b = roomAt(layout, probe(1))?.id ?? OUTSIDE;
    const width = o.width ?? DOOR_W;
    const { bottom, top } = openingSpan(o);
    portals.push({
      id: `${prefix}.${o.id}`,
      kind: o.kind === 'door' ? 'door' : 'opening',
      rooms: [rid(a), rid(b)],
      center: [o.at[0] + ox, (bottom + top) / 2, o.at[1] + oz],
      normal: [n[0], 0, n[1]],
      width,
      height: top - bottom,
      open: o.kind === 'door' ? (o.door?.open ?? 0) : 1,
    });
  }
  // Without a roof every room is open to the sky.
  if (!roofed) skyPortals(rooms, portals);
  return { rooms, portals };
}

/** Ceiling (sheathing underside) height of a roofed house: joists bear on the wall top plates. */
export function ceilingOf(layout: Layout) {
  return layout.wallHeight + (layout.roof?.joistDepth ?? 0);
}

/** Vertical extent of an opening: doors/openings from the floor, windows from the sill. */
export function openingSpan(o: LayoutOpening): { bottom: number; top: number } {
  if (o.kind === 'window') return { bottom: o.sill ?? 1.0, top: o.height ?? 2.0 };
  return { bottom: 0, top: o.height ?? DOOR_H };
}

/**
 * Switch a live room graph between roofed and open-top in place (rooms keep identity; door portals stay
 * linked): ceiling heights, AABBs, volumes and the sky portals follow.
 */
export function setGraphRoof(g: RoomGraph, layout: Layout, roofed: boolean) {
  const h = roofed ? ceilingOf(layout) : layout.wallHeight;
  for (const r of g.rooms) {
    const lr = layout.rooms.find((x) => r.id.endsWith(`.${x.id}`));
    const rh = roofed ? h : (lr?.height ?? h);
    r.ceilingHeight = rh;
    r.max[1] = rh;
    r.openTop = !roofed;
    r.volume = (r.max[0] - r.min[0]) * (r.max[2] - r.min[2]) * rh;
  }
  for (let i = g.portals.length - 1; i >= 0; i--) if (g.portals[i].kind === 'sky') g.portals.splice(i, 1);
  if (!roofed) skyPortals(g.rooms, g.portals);
}

function skyPortals(rooms: RoomNode[], portals: Portal[]) {
  for (const r of rooms) {
    portals.push({
      id: `${r.id}.sky`,
      kind: 'sky',
      rooms: [r.id, OUTSIDE],
      center: [(r.min[0] + r.max[0]) / 2, r.ceilingHeight, (r.min[2] + r.max[2]) / 2],
      normal: [0, 1, 0],
      width: r.max[0] - r.min[0],
      height: r.max[2] - r.min[2],
      open: 1,
    });
  }
}

/** Deterministic PRNG (mulberry32). */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Threat / no-shoot assignment for a run. Fixed roles are kept; random slots become no-shoots with
 * `noShootChance`, but at least `minNoShoots` no-shoots and `minThreats` threats are guaranteed.
 */
export function assignRoles(
  targets: Pick<LayoutTarget, 'id' | 'role'>[],
  seed: number,
  opts: { noShootChance?: number; minNoShoots?: number; minThreats?: number } = {},
): Record<string, 'threat' | 'noshoot'> {
  const rand = mulberry32(seed);
  const chance = opts.noShootChance ?? 0.3;
  const out: Record<string, 'threat' | 'noshoot'> = {};
  const random: string[] = [];
  for (const t of targets) {
    if (t.role === 'threat' || t.role === 'noshoot') out[t.id] = t.role;
    else {
      random.push(t.id);
      out[t.id] = rand() < chance ? 'noshoot' : 'threat';
    }
  }
  // Shuffle random slots so the guarantees don't always pick the same ones.
  for (let i = random.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [random[i], random[j]] = [random[j], random[i]];
  }
  const count = (r: 'threat' | 'noshoot') => Object.values(out).filter((v) => v === r).length;
  for (const id of random) {
    if (count('noshoot') >= (opts.minNoShoots ?? 1)) break;
    if (out[id] === 'threat' && count('threat') > (opts.minThreats ?? 1)) out[id] = 'noshoot';
  }
  for (const id of random) {
    if (count('threat') >= (opts.minThreats ?? 1)) break;
    if (out[id] === 'noshoot') out[id] = 'threat';
  }
  return out;
}
