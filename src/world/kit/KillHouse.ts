import { Group, Matrix4, Vector3, type Mesh } from 'three';
import type { RAPIER } from '../../physics/Physics';
import { settings } from '../../settings/Settings';
import { PaperTarget, type TargetEnv } from '../targets';
import { groundGeo, StaticBatch } from '../geo';
import { Door } from './Door';
import { installInteriorLighting, InteriorLighting, type OccluderSeg } from './interiorLight';
import {
  assignRoles,
  ceilingOf,
  deriveRoomGraph,
  mulberry32,
  DOOR_W,
  openingSpan,
  setGraphRoof,
  wallAxis,
  wallOf,
  wallPieces,
  type Layout,
  type RoomGraph,
} from './layout';
import { buildPracticals, updatePracticals, type Practical } from './practicals';
import { buildRoof, buildSunShafts } from './roof';

/** Kill-house options (Settings → Gameplay; `?roof=0` / `?roof=1` overrides for overview/catwalk runs). */
export const killHouseSettings = settings.ns('world.killhouse', { roof: true });

export function roofFromUrl(): boolean | null {
  try {
    const r = new URLSearchParams(location.search).get('roof');
    return r === null ? null : r !== '0' && r !== 'false';
  } catch {
    return null;
  }
}

const STUD = { w: 0.038, d: 0.089 };
const SPACING = 0.406; // 16" on centre
const PLY = 0.012;

/**
 * Builds a plywood shoot house from a JSON layout: 2x4-framed walls (studs exposed on the outside of
 * exterior walls), framed openings, physics doors, an instructor catwalk, paper threats/no-shoots,
 * and the derived room/portal graph for audio.
 */
export class KillHouse {
  readonly doors: Door[] = [];
  readonly targets: PaperTarget[] = [];
  readonly graph: RoomGraph;
  readonly start: Vector3;
  readonly startYaw: number;
  readonly finish: { min: Vector3; max: Vector3 };
  /** Roof (and the catwalk it replaces) live in their own groups so a drill can toggle them. */
  readonly roofGroup = new Group();
  readonly catwalkGroup = new Group();
  readonly lighting: InteriorLighting | null = null;
  readonly practicals: Practical[] = [];
  private roofColliders: RAPIER.Collider[] = [];
  private catwalkColliders: RAPIER.Collider[] = [];
  private shafts: Mesh[] = [];
  private doorLeaves: { door: Door; w: number; h: number }[] = [];
  private leakDoors: { door: Door; index: number }[] = [];
  private roofOn = false;
  private rand = mulberry32(77);

  constructor(
    env: TargetEnv,
    readonly layout: Layout,
    readonly origin: Vector3,
    opts: { roof?: boolean } = {},
  ) {
    const { batch, mats, ctx } = env;
    if (layout.roof) installInteriorLighting();
    const o = origin;
    const H = layout.wallHeight;
    const t = layout.wallThickness;
    const at = (x: number, z: number) => new Vector3(o.x + x, o.y, o.z + z);

    // Bounds + floor slab.
    const xs = layout.rooms.flatMap((r) => [r.min[0], r.max[0]]);
    const zs = layout.rooms.flatMap((r) => [r.min[1], r.max[1]]);
    const minX = Math.min(...xs),
      maxX = Math.max(...xs),
      minZ = Math.min(...zs),
      maxZ = Math.max(...zs);
    const pad = 1.2;
    const fw = maxX - minX + pad * 2,
      fd = maxZ - minZ + pad * 2;
    const fc = at((minX + maxX) / 2, (minZ + maxZ) / 2);
    batch.add(groundGeo(fw, fd), mats.concreteDusty, new Matrix4().makeTranslation(fc.x, 0.012, fc.z));
    ctx.physics.box(
      { x: fc.x, y: 0.006, z: fc.z },
      { x: fw / 2, y: 0.006, z: fd / 2 },
      { surface: 'concrete_dusty' },
    );

    // Walls.
    const top = STUD.w; // double top plate reads as one 2x4 cap
    for (const p of wallPieces(layout)) {
      const c = at(p.x, p.z);
      // Interior walls: one collider for the whole piece (two plywood skins, rounds go through).
      // Exterior walls: a thin sheathing collider plus a collider per stud (see below), so rounds through
      // the stud bays only cross plywood and rounds into a stud fight 89 mm of pine.
      if (!p.exterior)
        ctx.physics.box(
          { x: c.x, y: p.y + p.h / 2, z: c.z },
          { x: p.sx / 2, y: p.h / 2, z: p.sz / 2 },
          { surface: 'plywood', penetrable: PLY * 2 },
        );
      const len = p.axis === 'x' ? p.sx : p.sz;
      const sizeAlong = (l: number, across: number): [number, number] =>
        p.axis === 'x' ? [l, across] : [across, l];
      const reachesTop = p.y + p.h >= H - 1e-3;
      const plyH = reachesTop ? p.h - top : p.h;
      if (p.exterior) {
        // Sheathing on the inside face only; studs + plates on the outside.
        const inOff = -p.outSign * (t / 2 - PLY / 2);
        const pc = p.axis === 'x' ? at(p.x, p.z + inOff) : at(p.x + inOff, p.z);
        const [sx, sz] = sizeAlong(len, PLY);
        batch.box(mats.plywood, pc.x, p.y, pc.z, sx, plyH, sz, { cast: true });
        ctx.physics.box(
          { x: pc.x, y: p.y + p.h / 2, z: pc.z },
          { x: sx / 2, y: p.h / 2, z: sz / 2 },
          { surface: 'plywood', penetrable: PLY },
        );
        const studOff = p.outSign * (t / 2 - STUD.d / 2);
        const n = Math.max(1, Math.round(len / SPACING));
        for (let i = 0; i <= n; i++) {
          const along = -len / 2 + STUD.w / 2 + (i / n) * (len - STUD.w);
          const sx2 = p.axis === 'x' ? p.x + along : p.x + studOff;
          const sz2 = p.axis === 'x' ? p.z + studOff : p.z + along;
          const s = at(sx2, sz2);
          const [w, d] = sizeAlong(STUD.w, STUD.d);
          const sh = p.h - (reachesTop ? top : 0);
          batch.box(mats.lumber, s.x, p.y, s.z, w, sh, d);
          ctx.physics.box(
            { x: s.x, y: p.y + sh / 2, z: s.z },
            { x: w / 2, y: sh / 2, z: d / 2 },
            { surface: 'wood' },
          );
        }
        if (p.y === 0) {
          const bp = p.axis === 'x' ? at(p.x, p.z + studOff) : at(p.x + studOff, p.z);
          const [w, d] = sizeAlong(len, STUD.d);
          batch.box(mats.lumber, bp.x, 0, bp.z, w, STUD.w, d);
        }
      } else {
        const [sx, sz] = sizeAlong(len, t);
        batch.box(mats.plywood, c.x, p.y, c.z, sx, plyH, sz, { cast: true });
      }
      if (reachesTop) {
        const [sx, sz] = sizeAlong(len, t + 0.004);
        batch.box(mats.lumber, c.x, H - top, c.z, sx, top, sz, { cast: true });
      }
    }

    // Openings: jamb casings + doors.
    for (const op of layout.openings) {
      const w = wallOf(layout, op.at);
      if (!w) continue;
      const ax = wallAxis(w);
      const width = op.width ?? DOOR_W;
      const { bottom, top: height } = openingSpan(op);
      const c = at(op.at[0], op.at[1]);
      const along = ax === 'x' ? new Vector3(1, 0, 0) : new Vector3(0, 0, 1);
      const normal = ax === 'x' ? new Vector3(0, 0, 1) : new Vector3(1, 0, 0);
      const jd = t + 0.02;
      for (const s of [-1, 1]) {
        const j = c.clone().addScaledVector(along, s * (width / 2 - 0.0095));
        const [sx, sz] = ax === 'x' ? [0.019, jd] : [jd, 0.019];
        batch.box(mats.lumber, j.x, bottom, j.z, sx, height - bottom, sz);
      }
      if (bottom > 0) {
        // Window stool: a 2x sill board proud of both faces.
        const [sx, sz] = ax === 'x' ? [width + 0.04, jd + 0.03] : [jd + 0.03, width + 0.04];
        batch.box(mats.lumber, c.x, bottom - 0.038, c.z, sx, 0.038, sz, { tag: { surface: 'wood' } });
      }
      if (height < H - 0.01) {
        const [sx, sz] = ax === 'x' ? [width, jd] : [jd, width];
        batch.box(mats.lumber, c.x, height - 0.019, c.z, sx, 0.019, sz);
      }
      if (op.kind !== 'door' || !op.door) continue;
      const d = op.door;
      const hingeSign = d.hinge === 'min' ? -1 : 1;
      const swingN = d.swing === '+' ? 1 : -1;
      const hinge = c
        .clone()
        .addScaledVector(along, hingeSign * (width / 2 - 0.025))
        .addScaledVector(normal, swingN * (t / 2 - 0.02));
      // Local +x points from hinge to latch.
      const dirX = along.clone().multiplyScalar(-hingeSign);
      const yaw = Math.atan2(-dirX.z, dirX.x);
      // Local +z in world for this yaw: (sin yaw, 0, cos yaw).
      const localZ = new Vector3(Math.sin(yaw), 0, Math.cos(yaw));
      const swing = (Math.sign(localZ.dot(normal) * swingN) || 1) as 1 | -1;
      const door = new Door(ctx, mats, env.parent, {
        id: op.id,
        hinge,
        yaw,
        swing,
        width: width - 0.05,
        height,
        open: d.open,
      });
      this.doors.push(door);
      this.doorLeaves.push({ door, w: width - 0.05, h: height });
    }

    // Instructor catwalk on top of the walls + stairs at the open end (own group: the roof replaces it).
    env.parent.add(this.roofGroup, this.catwalkGroup);
    if (layout.catwalk) {
      const batch = new StaticBatch(ctx.physics);
      const n0 = ctx.physics.tags.size;
      const cw = layout.catwalk;
      const a = at(cw.a[0], cw.a[1]),
        b = at(cw.b[0], cw.b[1]);
      const len = a.distanceTo(b);
      const mid = a.clone().add(b).multiplyScalar(0.5);
      const alongX = Math.abs(b.x - a.x) > Math.abs(b.z - a.z);
      const [dx, dz] = alongX ? [len, cw.width] : [cw.width, len];
      // Deck: 2x6 boards across the walkway with gaps (light falls through into the hall).
      const boards = Math.floor(len / 0.17);
      for (let i = 0; i < boards; i++) {
        const k = -len / 2 + (i + 0.5) * (len / boards);
        const bx = alongX ? mid.x + k : mid.x,
          bz = alongX ? mid.z : mid.z + k;
        batch.box(mats.lumber, bx, cw.height, bz, alongX ? 0.14 : cw.width, 0.038, alongX ? cw.width : 0.14, {
          cast: true,
        });
      }
      // Joists under the boards + walking collider.
      for (const s of [-0.3, 0.3]) {
        const jx = alongX ? mid.x : mid.x + s * cw.width,
          jz = alongX ? mid.z + s * cw.width : mid.z;
        batch.box(mats.lumber, jx, cw.height - 0.09, jz, alongX ? len : 0.05, 0.09, alongX ? 0.05 : len);
      }
      env.ctx.physics.box(
        { x: mid.x, y: cw.height + 0.02, z: mid.z },
        { x: dx / 2, y: 0.02, z: dz / 2 },
        { surface: 'wood' },
      );
      // Stringers + rails (galvanised).
      for (const s of [-1, 1]) {
        const off = (cw.width / 2) * s;
        const rx = alongX ? mid.x : mid.x + off,
          rz = alongX ? mid.z + off : mid.z;
        const [rsx, rsz] = alongX ? [len, 0.04] : [0.04, len];
        batch.box(mats.galvanized, rx, cw.height + 1.0, rz, rsx, 0.04, rsz, { cast: true });
        batch.box(mats.galvanized, rx, cw.height + 0.5, rz, rsx, 0.03, rsz);
        batch.box(mats.galvanized, rx, cw.height - 0.1, rz, rsx, 0.1, rsz);
        const n = Math.ceil(len / 1.8);
        for (let i = 0; i <= n; i++) {
          const k = -len / 2 + (i / n) * len;
          const px = alongX ? mid.x + k : rx,
            pz = alongX ? rz : mid.z + k;
          batch.box(mats.galvanized, px, cw.height, pz, 0.045, 1.04, 0.045);
        }
      }
      // Support posts where the deck overhangs the walls.
      const startOut = alongX ? Math.min(a.x, b.x) : Math.min(a.z, b.z);
      const houseMin = alongX ? o.x + minX : o.z + minZ;
      if (startOut < houseMin - 0.2) {
        for (const s of [-1, 1]) {
          const px = alongX ? startOut + 0.1 : mid.x + s * (cw.width / 2 - 0.05);
          const pz = alongX ? mid.z + s * (cw.width / 2 - 0.05) : startOut + 0.1;
          batch.box(mats.galvanized, px, 0, pz, 0.08, cw.height, 0.08, { tag: { surface: 'metal' } });
        }
        // Stairs down and away from the house.
        const run = cw.height * 1.25;
        const steps = 13;
        for (let i = 0; i < steps; i++) {
          const k = (i + 0.5) / steps;
          const y = cw.height * (1 - k) - 0.03;
          const off = startOut - run * k;
          const sx = alongX ? off : mid.x,
            sz = alongX ? mid.z : off;
          const [tx, tz] = alongX ? [run / steps + 0.03, 0.9] : [0.9, run / steps + 0.03];
          batch.box(mats.lumber, sx, y, sz, tx, 0.038, tz);
        }
        // Ramp collider under the treads (smooth for the character controller).
        const ang = Math.atan2(cw.height, run);
        const rl = Math.hypot(cw.height, run);
        const rc = alongX
          ? new Vector3(startOut - run / 2, cw.height / 2 - 0.05, mid.z)
          : new Vector3(mid.x, cw.height / 2 - 0.05, startOut - run / 2);
        batch.box(mats.galvanized, rc.x, rc.y - 0.03, rc.z, alongX ? rl : 0.06, 0.06, alongX ? 0.06 : rl, {
          roll: alongX ? ang : 0,
          pitch: alongX ? 0 : -ang,
          tag: { surface: 'metal' },
        });
      }
      batch.build(this.catwalkGroup);
      // Every collider created since n0 belongs to the catwalk.
      const handles = [...ctx.physics.tags.keys()].slice(n0);
      for (const h of handles) {
        const col = ctx.physics.world.getCollider(h);
        if (col) this.catwalkColliders.push(col);
      }
    }

    // Roof, practical lights and the interior-lighting data.
    const fp = { minX, maxX, minZ, maxZ };
    if (layout.roof) {
      const rb = new StaticBatch(ctx.physics);
      this.roofColliders = buildRoof(rb, mats, layout, fp, at);
      this.practicals = buildPracticals(rb, mats, this.roofGroup, layout, at);
      rb.build(this.roofGroup);
      this.shafts = buildSunShafts(this.roofGroup, layout, at);
      this.lighting = this.buildLighting(fp, at);
    }

    // Paper threats / no-shoots.
    for (const lt of layout.targets) {
      const p = at(lt.at[0], lt.at[1]);
      const yaw = Math.atan2(lt.face[0] - lt.at[0], lt.face[1] - lt.at[1]);
      this.targets.push(new PaperTarget(env, `kh.${lt.id}`, p, yaw, lt.role === 'noshoot', 1.32));
    }

    this.graph = deriveRoomGraph(layout, [o.x, o.z], layout.id, false);
    for (const d of this.doors) d.portal = this.graph.portals.find((p) => p.id === `${layout.id}.${d.id}`);
    const forced = opts.roof ?? roofFromUrl();
    this.setRoof(!!layout.roof && (forced ?? killHouseSettings.get().roof));
    if (forced === null) killHouseSettings.onChange((v) => this.setRoof(v.roof));
    this.start = at(layout.start.at[0], layout.start.at[1]);
    this.startYaw = layout.start.yaw;
    this.finish = {
      min: at(layout.finish.min[0], layout.finish.min[1]),
      max: at(layout.finish.max[0], layout.finish.max[1]).setY(3),
    };
  }

  get roofed() {
    return this.roofOn;
  }

  /**
   * Roof on: roof + practical lights + dark interior; the catwalk comes down. Roof off: open-top daylight house
   * with the instructor catwalk (overview/replay runs). Colliders, the audio room graph and lighting follow.
   */
  setRoof(on: boolean) {
    on = on && !!this.layout.roof;
    this.roofOn = on;
    this.roofGroup.visible = on;
    this.catwalkGroup.visible = !on;
    for (const c of this.roofColliders) c.setEnabled(on);
    for (const c of this.catwalkColliders) c.setEnabled(!on);
    this.lighting?.setRoof(on);
    setGraphRoof(this.graph, this.layout, on);
  }

  private buildLighting(
    fp: { minX: number; maxX: number; minZ: number; maxZ: number },
    at: (x: number, z: number) => Vector3,
  ) {
    const L = this.layout;
    const a = at(fp.minX, fp.minZ),
      b = at(fp.maxX, fp.maxZ);
    const lighting = new InteriorLighting({
      minX: a.x,
      minZ: a.z,
      maxX: b.x,
      maxZ: b.z,
      top: ceilingOf(L) + 0.002,
    });
    const segs: OccluderSeg[] = [];
    const ext = 0.02;
    for (const p of wallPieces(L)) {
      const c = at(p.x, p.z);
      const half = (p.axis === 'x' ? p.sx : p.sz) / 2 + ext;
      const s: OccluderSeg =
        p.axis === 'x'
          ? { a: [c.x - half, c.z], b: [c.x + half, c.z], y0: p.y, y1: p.y + p.h }
          : { a: [c.x, c.z - half], b: [c.x, c.z + half], y0: p.y, y1: p.y + p.h };
      segs.push(s);
    }
    lighting.setStatic(segs);
    // Exterior doors and windows let daylight in.
    const xs = L.rooms.flatMap((r) => [r.min[0], r.max[0]]);
    const zs = L.rooms.flatMap((r) => [r.min[1], r.max[1]]);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2,
      cz = (Math.min(...zs) + Math.max(...zs)) / 2;
    for (const o of L.openings) {
      const w = wallOf(L, o.at);
      if (!w?.exterior) continue;
      const ax = wallAxis(w);
      const n: [number, number] =
        ax === 'x' ? [0, Math.sign(o.at[1] - cz) || 1] : [Math.sign(o.at[0] - cx) || 1, 0];
      const { bottom, top } = openingSpan(o);
      const door = this.doors.find((d) => d.id === o.id);
      if (door) this.leakDoors.push({ door, index: lighting.leaks.length });
      lighting.addLeak({
        center: at(o.at[0], o.at[1]).setY((bottom + top) / 2),
        normal: n,
        halfW: (o.width ?? DOOR_W) / 2,
        halfH: (top - bottom) / 2,
        open: door ? door.openAmount() : 1,
      });
    }
    lighting.setEnabled(true);
    return lighting;
  }

  /** Randomise threat/no-shoot placement for a run. Returns the role map. */
  reroll(seed: number) {
    const roles = assignRoles(this.layout.targets, seed, {
      noShootChance: 0.3,
      minNoShoots: 2,
      minThreats: 5,
    });
    for (const t of this.targets) t.setNoShoot(roles[t.id.slice(3)] === 'noshoot');
    return roles;
  }

  resetDoors() {
    for (const op of this.layout.openings) {
      const d = this.doors.find((x) => x.id === op.id);
      d?.setOpen(op.door?.open ?? 0);
    }
  }

  inFinish(p: Vector3) {
    const f = this.finish;
    return p.x >= f.min.x && p.x <= f.max.x && p.z >= f.min.z && p.z <= f.max.z;
  }

  fixedUpdate(dt: number, playerPos: Vector3, playerVel: Vector3) {
    for (const d of this.doors) d.fixedUpdate(dt, playerPos, playerVel);
  }

  private tmpA = new Vector3();
  private tmpB = new Vector3();

  update(dt = 1 / 60) {
    for (const d of this.doors) d.sync();
    updatePracticals(this.practicals, dt, this.roofOn, this.rand);
    const lt = this.lighting;
    if (!lt) return;
    // Door leaves block light too; open exterior doors let daylight in.
    const segs: OccluderSeg[] = [];
    for (const { door, w, h } of this.doorLeaves) {
      door.mesh.updateMatrixWorld();
      const a = this.tmpA.set(0.006, 0, 0).applyMatrix4(door.mesh.matrixWorld);
      const b = this.tmpB.set(w, 0, 0).applyMatrix4(door.mesh.matrixWorld);
      segs.push({ a: [a.x, a.z], b: [b.x, b.z], y0: 0.02, y1: h - 0.01 });
    }
    lt.setDynamic(segs);
    let dirty = false;
    for (const { door, index } of this.leakDoors) {
      const o = door.openAmount();
      if (Math.abs(lt.leaks[index].open - o) > 0.005) {
        lt.leaks[index].open = o;
        dirty = true;
      }
    }
    if (dirty) lt.flushLeaks();
    for (const m of this.shafts) m.visible = this.roofOn;
  }
}
