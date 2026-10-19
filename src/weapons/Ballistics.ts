import { Vector3 } from 'three';
import type { Context, System } from '../core/Context';
import type { GameEvents } from '../core/bus';
import { RAPIER, type RayHit } from '../physics/Physics';
import { atmosphere, type Atmosphere } from '../physics/ballistics/atmosphere';
import { BallisticsDebug } from '../physics/ballistics/debug';
import {
  chokeSigma,
  disperse,
  mechanicalMoa,
  sigmaFromMoa,
  type Choke,
} from '../physics/ballistics/dispersion';
import { recoilFor, type RecoilProfile } from '../physics/ballistics/recoil';
import { hashSeed, Rng } from '../physics/ballistics/rng';
import { steelImpulse, spallDir } from '../physics/ballistics/steel';
import {
  energyOf,
  exitDeflection,
  initProjectile,
  materialFor,
  newProjectile,
  perforate,
  ricochetOut,
  ricochets,
  tumbleDrag,
  type Projectile,
} from '../physics/ballistics/terminal';
import {
  chordTime,
  computeBoreAngle,
  flightParams,
  integrate,
  newFlightState,
  speedOf,
  type FlightParams,
  type FlightState,
} from '../physics/ballistics/trajectory';
import { TraceLog } from '../physics/ballistics/traceLog';
import { ammoOf } from './ammo/forDef';
import type { Cartridge } from './ammo/types';
import { WEAPONS, type WeaponDef } from './defs';

/** What the router knows about a hit, beyond the ray hit itself (optional 4th `onHit` argument). */
export interface HitInfo {
  /** Projectile (one pellet / main fragment) mass, kg. */
  massKg: number;
  /** Impact speed, m/s. */
  speed: number;
  /** m·v, N·s. */
  momentum: number;
  /** Momentum transfer to hard steel at this incidence, N·s (see `physics/ballistics/steel.ts`). */
  steelImpulse: number;
  /** cos of the angle between the round and the surface normal (1 = head-on). */
  cosIncidence: number;
  ammo: string;
}

export interface HitListener {
  /** Return true if this listener handled (absorbed) the round. */
  onHit(hit: RayHit, dir: Vector3, energy: number, info?: HitInfo): boolean;
}

/** Per-weapon-configuration constants (cached; computed once per build). */
interface ShotSpec {
  cart: Cartridge;
  v0: number;
  boreAngle: number;
  sigma: number;
  pelletSigma: number;
  pellets: number;
  recoil: RecoilProfile;
  subsonic: boolean;
}

interface Round {
  active: boolean;
  st: FlightState;
  fp: FlightParams;
  proj: Projectile;
  cart: Cartridge;
  fireTick: number;
  /** Everything up to this flight time is traced on the firing tick (CQB: no visible delay). */
  tImmediate: number;
  hits: number;
  trace: number;
  dx: number;
  dy: number;
  dz: number;
}

/** Rounds within this distance are traced on the firing tick; beyond it impacts arrive at their real TOF. */
const IMMEDIATE_M = 50;
const MAX_TIME = 3;
const MIN_SPEED = 45;
const MAX_HITS = 10;
const POOL = 96;
const SKIN = 1e-3;

/**
 * Bus `shot` → trajectory (drag + gravity, RK4) traced as chords → `impact` events and target `onHit`
 * routing, with per-material penetration, ricochet and exit deflection. Deterministic: dispersion,
 * deflection and ricochet draw from an RNG seeded by (tick, shot counter, pellet).
 */
export class Ballistics implements System {
  listeners: HitListener[] = [];
  /**
   * Hook for the handling layer: perturb the emitted direction (hold wobble etc.) before mechanical
   * dispersion. `dir` is unit and must stay unit.
   */
  hold?: (dir: Vector3, tick: number, weaponId: string) => void;
  /** Zero distance (m) by slot: rifles 50 m, pistols 25 m. */
  zero = { primary: 50, sidearm: 25 };
  atm: Atmosphere = atmosphere();
  readonly log = new TraceLog();
  private debug?: BallisticsDebug;
  private specs = new Map<string, ShotSpec>();
  private rounds: Round[] = [];
  private rng = new Rng();
  private shotCount = 0;
  private lastTick = -1;
  // Scratch.
  private a = new Vector3();
  private b = new Vector3();
  private d = new Vector3();
  private n = new Vector3();
  private info: HitInfo = { massKg: 0, speed: 0, momentum: 0, steelImpulse: 0, cosIncidence: 1, ammo: '' };
  private ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 });

  constructor(
    private ctx: Context,
    private exclude: () => unknown,
  ) {
    for (let i = 0; i < POOL; i++)
      this.rounds.push({
        active: false,
        st: newFlightState(),
        fp: {} as FlightParams,
        proj: newProjectile(),
        cart: null as unknown as Cartridge,
        fireTick: 0,
        tImmediate: 0,
        hits: 0,
        trace: -1,
        dx: 0,
        dy: 0,
        dz: 0,
      });
    ctx.bus.on('shot', (s) => this.fire(s));
    const q = typeof location !== 'undefined' ? new URLSearchParams(location.search) : null;
    if (q?.has('ballistics')) this.enableDebug();
  }

  enableDebug() {
    this.debug ??= new BallisticsDebug(this.ctx.scene, this.log);
    this.debug.visible = true;
  }

  /** Per-build constants: load, muzzle velocity, zero, dispersion and recoil. */
  spec(def: WeaponDef): ShotSpec {
    const key = def.model;
    let s = this.specs.get(key);
    if (s) return s;
    const cart = ammoOf(def);
    const v0 = def.velocity;
    const zero = def.slot === 'sidearm' ? this.zero.sidearm : this.zero.primary;
    const inches = (def.barrelLength ?? 0.25) / 0.0254;
    const pellets = cart.pellets ?? 1;
    s = {
      cart,
      v0,
      boreAngle: computeBoreAngle(zero, def.sightHeight, cart, v0, this.atm),
      sigma: sigmaFromMoa(mechanicalMoa(def.spreadMoa, cart, inches)),
      pelletSigma: pellets > 1 ? chokeSigma((def as WeaponDef & { choke?: Choke }).choke ?? 'cylinder') : 0,
      pellets,
      recoil: recoilFor(def),
      subsonic: v0 < this.atm.soundSpeed,
    };
    this.specs.set(key, s);
    return s;
  }

  private fire(s: GameEvents['shot']) {
    const def = s.def ?? WEAPONS[s.weaponId];
    if (!def) return;
    const sp = this.spec(def);
    // Fill the additive payload fields for later listeners (audio/fx/handling read them).
    s.recoil = sp.recoil;
    s.subsonic = sp.subsonic;
    s.muzzleVelocity = sp.v0;
    s.ammo = sp.cart.id;

    const tick = this.ctx.tick;
    if (tick !== this.lastTick) {
      this.lastTick = tick;
      this.shotCount = 0;
    }
    const shotIdx = this.shotCount++;
    const dir = this.d.copy(s.dir).normalize();
    this.hold?.(dir, tick, s.weaponId);
    if (!s.zeroed) {
      // The emitted dir is the sight line; tilt the bore up by the zero angle (no cant assumed).
      const right = this.a.set(-dir.z, 0, dir.x);
      if (right.lengthSq() > 1e-8) dir.applyAxisAngle(right.normalize(), sp.boreAngle);
    }
    this.rng.seed(hashSeed(tick, shotIdx, 0x5b));
    disperse(dir, sp.sigma, this.rng);
    const bx = dir.x,
      by = dir.y,
      bz = dir.z;
    for (let i = 0; i < sp.pellets; i++) {
      const r = this.alloc();
      dir.set(bx, by, bz);
      if (sp.pelletSigma > 0) disperse(dir, sp.pelletSigma, this.rng);
      // Per-pellet velocity spread (~1.5% SD) keeps a real pattern's stringing.
      const v = sp.v0 * (1 + (sp.pellets > 1 ? 0.015 * this.rng.gauss() : 0));
      this.launch(r, sp.cart, s.origin, dir, v, tick);
    }
  }

  private alloc(): Round {
    let oldest = this.rounds[0];
    for (const r of this.rounds) {
      if (!r.active) return r;
      if (r.st.t > oldest.st.t) oldest = r;
    }
    // Pool full (long full-auto string into the sky): recycle the round that has flown longest.
    this.retire(oldest);
    return oldest;
  }

  private launch(r: Round, cart: Cartridge, origin: Vector3, dir: Vector3, v: number, tick: number) {
    r.active = true;
    r.cart = cart;
    r.fireTick = tick;
    r.hits = 0;
    const st = r.st;
    st.x = origin.x;
    st.y = origin.y;
    st.z = origin.z;
    st.vx = dir.x * v;
    st.vy = dir.y * v;
    st.vz = dir.z * v;
    st.t = st.dist = 0;
    flightParams(cart, this.atm, r.fp);
    initProjectile(r.proj, cart, v);
    r.tImmediate = IMMEDIATE_M / v;
    r.trace = this.log.begin(origin.x, origin.y, origin.z, cart.id, v);
    this.advance(r, r.tImmediate);
  }

  fixedUpdate(dt: number) {
    for (const r of this.rounds) {
      if (!r.active) continue;
      const since = (this.ctx.tick - r.fireTick + 1) * dt;
      this.advance(r, Math.max(r.tImmediate, since));
    }
  }

  update() {
    this.debug?.update();
  }

  /** Fly `r` until flight time `tLimit`, raycasting each chord (≤ 5 mm off the true arc). */
  private advance(r: Round, tLimit: number) {
    const st = r.st;
    const chord = chordTime();
    let guard = 0;
    while (r.active && st.t < tLimit - 1e-9 && guard++ < 64) {
      const dt = Math.min(chord, tLimit - st.t);
      const a = this.a.set(st.x, st.y, st.z);
      const v0 = speedOf(st);
      const t0 = st.t;
      const sdist = st.dist;
      integrate(st, r.fp, dt);
      const b = this.b.set(st.x, st.y, st.z);
      const len = b.distanceTo(a);
      if (len < 1e-6) break;
      const d = this.d.copy(b).sub(a).divideScalar(len);
      r.dx = d.x;
      r.dy = d.y;
      r.dz = d.z;
      const hit = this.ctx.physics.raycast(a, d, len, this.exclude() as never);
      if (hit) {
        const f = hit.distance / len;
        const v1 = speedOf(st);
        const v = v0 + (v1 - v0) * f;
        st.x = hit.point.x;
        st.y = hit.point.y;
        st.z = hit.point.z;
        st.t = t0 + dt * f;
        st.dist = sdist + hit.distance;
        st.vx = d.x * v;
        st.vy = d.y * v;
        st.vz = d.z * v;
        r.proj.speed = v;
        this.log.point(r.trace, st.x, st.y, st.z);
        this.onHit(r, hit, d);
      } else {
        r.proj.speed = speedOf(st);
        this.log.point(r.trace, st.x, st.y, st.z);
      }
      if (r.active && (st.t > MAX_TIME || r.proj.speed < MIN_SPEED || st.y < -20)) this.retire(r);
    }
  }

  private retire(r: Round) {
    r.active = false;
    this.log.end(r.trace);
  }

  private onHit(r: Round, hit: RayHit, d: Vector3) {
    const p = r.proj;
    const tag = hit.tag;
    const mat = materialFor(tag.surface, tag.penetrable);
    const n = this.n.copy(hit.normal);
    let cosI = -d.dot(n);
    if (cosI < 0) {
      n.negate();
      cosI = -cosI;
    }
    const graze = Math.asin(Math.min(1, cosI));
    const energy = energyOf(p);
    const rr = this.rng.next();
    const skip = tag.surface !== 'paper_target' && ricochets(p, mat, graze, rr);
    let ricochet: Vector3 | undefined;
    let keep = 0;
    if (skip || mat.hard) {
      // Departure direction: along-surface component plus a shallow lift off the face.
      const ro = ricochetOut(p, mat, graze, this.rng.next());
      keep = ro.keep;
      const tx = d.x + n.x * cosI,
        ty = d.y + n.y * cosI,
        tz = d.z + n.z * cosI;
      const tl = Math.hypot(tx, ty, tz);
      if (skip && tl > 1e-4) {
        const c = Math.cos(ro.angle) / tl,
          s = Math.sin(ro.angle);
        ricochet = new Vector3(tx * c + n.x * s, ty * c + n.y * s, tz * c + n.z * s).normalize();
      } else if (mat.hard) {
        // Head-on steel: the splash leaves along the face; report the dominant spall direction.
        ricochet = new Vector3();
        spallDir(d, n, this.rng, ricochet);
      }
    }
    const info = this.info;
    info.massKg = p.massKg;
    info.speed = p.speed;
    info.momentum = p.massKg * p.speed;
    info.steelImpulse = steelImpulse(p.massKg, p.speed, cosI, p.construction);
    info.cosIncidence = cosI;
    info.ammo = r.cart.id;
    this.ctx.bus.emit('impact', {
      point: hit.point,
      normal: n.clone(),
      surface: tag.surface,
      targetId: tag.targetId,
      energy,
      speed: p.speed,
      massKg: p.massKg,
      ricochet,
    });
    r.hits++;
    let absorbed = false;
    for (const l of this.listeners) if (l.onHit(hit, d, energy, info)) absorbed = true;
    if (absorbed && !mat.hard && !skip) {
      this.log.event(r.trace, 'stop', hit.point);
      return this.retire(r);
    }
    if (mat.hard) {
      // Training rule (PRD §6.4): steel makes sparks and ricochet sounds, no ricochet damage.
      this.log.event(r.trace, skip ? 'ricochet' : 'steel', hit.point, ricochet);
      this.logSpall(r, hit.point, d, n);
      return this.retire(r);
    }
    if (skip && ricochet) {
      this.log.event(r.trace, 'ricochet', hit.point, ricochet);
      const v = p.speed * keep;
      p.speed = v;
      p.yaw = Math.min(1, p.yaw + 0.5);
      r.fp.dragMul = tumbleDrag(p);
      this.restart(r, hit.point, ricochet, v, n);
      return;
    }
    if (tag.penetrable === 0 || r.hits >= MAX_HITS) {
      this.log.event(r.trace, 'stop', hit.point);
      return this.retire(r);
    }
    // Penetration: geometric path through this collider (exit = first boundary from inside).
    const exitDist = this.exitDistance(hit, d);
    if (exitDist < 0) {
      this.log.event(r.trace, 'stop', hit.point);
      return this.retire(r);
    }
    const path = tag.penetrable ? tag.penetrable / Math.max(0.2, cosI) : exitDist;
    const vIn = p.speed;
    const res = perforate(p, mat, path);
    if (res.stopped) {
      this.log.event(r.trace, 'stop', hit.point);
      return this.retire(r);
    }
    // Exit: deflect, emit the exit hole, carry on.
    const exit = this.b.copy(hit.point).addScaledVector(d, exitDist);
    const out = this.a.copy(d);
    disperse(out, exitDeflection(mat, vIn, res.speedOut, p.yaw), this.rng);
    r.fp.dragMul = tumbleDrag(p);
    this.ctx.bus.emit('impact', {
      point: exit.clone(),
      normal: d.clone(),
      surface: tag.surface,
      targetId: tag.targetId,
      energy: energyOf(p),
      speed: p.speed,
      massKg: p.massKg,
      exit: true,
    });
    this.log.point(r.trace, exit.x, exit.y, exit.z);
    this.log.event(r.trace, 'exit', exit, out);
    this.restart(r, exit, out, p.speed, d);
  }

  private restart(r: Round, at: Vector3, dir: Vector3, v: number, push: Vector3) {
    const st = r.st;
    st.x = at.x + push.x * SKIN;
    st.y = at.y + push.y * SKIN;
    st.z = at.z + push.z * SKIN;
    st.vx = dir.x * v;
    st.vy = dir.y * v;
    st.vz = dir.z * v;
  }

  private spallTmp = new Vector3();
  private logSpall(r: Round, at: Vector3, d: Vector3, n: Vector3) {
    for (let i = 0; i < 6; i++) {
      spallDir(d, n, this.rng, this.spallTmp);
      this.log.event(r.trace, 'spall', at, this.spallTmp);
    }
  }

  /** Distance from the entry point to where the ray leaves the hit collider (−1 if it never does). */
  private exitDistance(hit: RayHit, d: Vector3): number {
    const ray = this.ray;
    ray.origin.x = hit.point.x + d.x * 1e-4;
    ray.origin.y = hit.point.y + d.y * 1e-4;
    ray.origin.z = hit.point.z + d.z * 1e-4;
    ray.dir.x = d.x;
    ray.dir.y = d.y;
    ray.dir.z = d.z;
    const x = hit.collider.castRayAndGetNormal(ray, 1.5, false);
    if (!x) return -1;
    return x.timeOfImpact + 1e-4;
  }

  /** Test/debug: summary of the last traces. */
  traces() {
    return this.log.summary();
  }
}
