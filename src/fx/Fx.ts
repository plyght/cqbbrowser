import {
  BackSide,
  BoxGeometry,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PointLight,
  Quaternion,
  SpotLight,
  Vector3,
  type Texture,
} from 'three';
import type { GameEvents, Surface } from '../core/bus';
import type { Context, System } from '../core/Context';
import { rng } from '../core/math';
import type { Player } from '../player/Player';
import type { Renderer } from '../render/Renderer';
import type { WeaponController } from '../weapons/WeaponController';
import { BrassPool, type BrassKind, type CastFn, type CastHit } from './Brass';
import { Decals, type DecalKind } from './Decals';
import { ParticlePool, resetRecord, spawnRecord } from './Particles';
import { ATLAS, makeLightCookie, makeParticleAtlas } from './textures';

type ImpactClass = 'steel' | 'metal' | 'dirt' | 'wood' | 'drywall' | 'concrete' | 'soft' | 'paper';

const CLASS: Record<Surface, ImpactClass> = {
  concrete: 'concrete',
  concrete_dusty: 'concrete',
  tile: 'concrete',
  wood: 'wood',
  plywood: 'wood',
  drywall: 'drywall',
  carpet: 'soft',
  gravel: 'dirt',
  dirt: 'dirt',
  grass: 'dirt',
  berm: 'dirt',
  metal: 'metal',
  steel_target: 'steel',
  paper_target: 'paper',
};

const DECAL: Partial<Record<ImpactClass, { kind: DecalKind; size: number }>> = {
  concrete: { kind: 0, size: 0.06 },
  wood: { kind: 1, size: 0.05 },
  drywall: { kind: 0, size: 0.06 },
  dirt: { kind: 2, size: 0.15 },
  metal: { kind: 3, size: 0.035 },
  soft: { kind: 2, size: 0.03 },
};

/** Dust colours (linear, roughly sunlit). */
const DUST: Partial<Record<Surface, [number, number, number]>> = {
  berm: [0.2, 0.15, 0.1],
  dirt: [0.21, 0.16, 0.11],
  gravel: [0.26, 0.24, 0.21],
  grass: [0.28, 0.27, 0.18],
  concrete: [0.5, 0.49, 0.46],
  concrete_dusty: [0.55, 0.53, 0.49],
  tile: [0.5, 0.5, 0.48],
  plywood: [0.62, 0.5, 0.34],
  wood: [0.5, 0.38, 0.25],
  drywall: [0.85, 0.84, 0.8],
  carpet: [0.25, 0.24, 0.23],
};

export interface FxDeps {
  weapons: WeaponController;
  player: Player;
  renderer: Renderer;
}

/**
 * Visual FX: muzzle flash (sprites + one pooled light + sensor clip), brass ejection, surface-aware
 * impact particles, pooled bullet-hole decals and the weapon light. Bus-driven; pooled; no per-frame
 * allocations in steady state.
 */
export class Fx implements System {
  readonly additive: ParticlePool;
  readonly alpha: ParticlePool;
  readonly decals: Decals;
  readonly brass: BrassPool;
  readonly flashLight = new PointLight(0xffb469, 0, 8, 2);
  readonly weaponLight = new SpotLight(0xfff2e2, 0, 45, 0.62, 1, 1.5);
  lightOn = false;
  private lightTarget = new Object3D();
  private cookie: Texture = makeLightCookie();
  private flashT = 0;
  private flashPeak = 0;
  private sinceShot = 10;
  private rand = rng(2024);
  private rec = spawnRecord();
  private tier = '';
  private darkRoom: Mesh | null = null;
  // Scratch.
  private v1 = new Vector3();
  private v2 = new Vector3();
  private v3 = new Vector3();
  private v4 = new Vector3();
  private q1 = new Quaternion();
  private cast: CastFn;

  constructor(
    private ctx: Context,
    private deps: FxDeps,
  ) {
    const atlas = makeParticleAtlas();
    this.additive = new ParticlePool(ctx.scene, atlas, 384, true);
    this.alpha = new ParticlePool(ctx.scene, atlas, 384, false);
    this.decals = new Decals(ctx.scene, 256);
    this.brass = new BrassPool(ctx.scene, 96);
    // Lights live in the scene permanently (intensity toggled) so the light count never changes → no recompiles.
    this.flashLight.castShadow = false;
    ctx.scene.add(this.flashLight, this.weaponLight, this.lightTarget);
    this.weaponLight.target = this.lightTarget;
    this.weaponLight.shadow.mapSize.set(512, 512);
    this.weaponLight.shadow.camera.near = 0.1;
    this.weaponLight.shadow.bias = -0.0004;
    this.applyQuality();

    this.cast = (o, d, max) => {
      const h = ctx.physics.raycast(o, d, max, deps.player.rigidBody);
      return h ? { point: h.point, normal: h.normal, surface: h.tag.surface } : null;
    };
    ctx.bus.on('shot', (e) => this.onShot(e));
    ctx.bus.on('impact', (e) => this.onImpact(e));
  }

  private applyQuality() {
    const q = this.deps.renderer.quality;
    this.tier = this.deps.renderer.tier;
    // SpotLight.map (cookie) requires a shadow-casting light in three.js; only High pays for both.
    this.weaponLight.castShadow = q.weaponLightShadow;
    this.weaponLight.map = q.weaponLightShadow ? this.cookie : null;
  }

  private brassKind(caliber: string): BrassKind {
    if (caliber === '9mm' || caliber === '45acp' || caliber === '10mm') return 'pistol';
    if (caliber.startsWith('12')) return 'shell';
    return 'rifle';
  }

  // ---------------------------------------------------------------- muzzle flash + brass
  private onShot(e: GameEvents['shot']) {
    const r = this.rand;
    const o = this.v1.copy(e.origin);
    const d = this.v2.copy(e.dir).normalize();
    const pistol = this.brassKind(e.caliber) === 'pistol';
    const firstRound = this.sinceShot > 2.5;
    this.sinceShot = 0;
    const s = this.rec;
    if (!e.suppressed) {
      const k = pistol ? 0.7 : 1;
      // Hot core (front-ish view of the flash cone).
      resetRecord(s);
      s.x = o.x + d.x * 0.02;
      s.y = o.y + d.y * 0.02;
      s.z = o.z + d.z * 0.02;
      s.life = 0.045;
      s.size0 = (0.07 + r() * 0.05) * k;
      s.size1 = s.size0 * 1.3;
      s.r = 16 * k;
      s.g = 10 * k;
      s.b = 5 * k;
      s.frame = ATLAS.flash + Math.floor(r() * 4);
      s.rot = r() * 6.28;
      s.fade = 0.6;
      this.additive.spawn(s);
      // Forward plume, seen side-on from the chest.
      for (let i = 0; i < 2; i++) {
        resetRecord(s);
        const f = 0.06 + i * 0.07;
        s.x = o.x + d.x * f;
        s.y = o.y + d.y * f;
        s.z = o.z + d.z * f;
        s.mode = 2;
        s.ax = d.x;
        s.ay = d.y;
        s.az = d.z;
        s.stretch = 3.2 - i;
        s.life = 0.035;
        s.size0 = (0.045 - i * 0.012) * k;
        s.size1 = s.size0 * 1.4;
        s.r = 10 * k;
        s.g = 5.5 * k;
        s.b = 2.2 * k;
        s.frame = ATLAS.flash + Math.floor(r() * 4);
        this.additive.spawn(s);
      }
      // A few incandescent particles.
      for (let i = 0; i < 4; i++) {
        resetRecord(s);
        s.x = o.x;
        s.y = o.y;
        s.z = o.z;
        const sp = 10 + r() * 18;
        s.vx = (d.x + (r() - 0.5) * 0.5) * sp;
        s.vy = (d.y + (r() - 0.5) * 0.5) * sp;
        s.vz = (d.z + (r() - 0.5) * 0.5) * sp;
        s.mode = 1;
        s.stretch = 0.01;
        s.life = 0.05 + r() * 0.05;
        s.size0 = s.size1 = 0.004;
        s.r = 20;
        s.g = 9;
        s.b = 3;
        s.frame = ATLAS.spark;
        this.additive.spawn(s);
      }
      this.flashPeak = (pistol ? 4 : 6) * (0.8 + r() * 0.4);
      this.flashT = 0.04;
      this.deps.renderer.flash(1);
    } else {
      // Suppressed: occasionally a faint glow at the cans' end cap; first-round pop is a touch brighter.
      if (firstRound || r() < 0.3) {
        resetRecord(s);
        s.x = o.x + d.x * 0.01;
        s.y = o.y + d.y * 0.01;
        s.z = o.z + d.z * 0.01;
        s.life = 0.03;
        s.size0 = s.size1 = firstRound ? 0.05 : 0.025;
        s.r = 5;
        s.g = 3;
        s.b = 1.5;
        s.frame = ATLAS.flash + Math.floor(r() * 4);
        s.rot = r() * 6.28;
        this.additive.spawn(s);
        this.flashPeak = firstRound ? 2 : 0.8;
        this.flashT = 0.04;
        this.deps.renderer.flash(firstRound ? 0.3 : 0.1);
      }
    }
    // Gas / smoke puff (bigger for suppressed first-round pop).
    const puffs = e.suppressed ? (firstRound ? 3 : 2) : 1;
    for (let i = 0; i < puffs; i++) {
      resetRecord(s);
      s.x = o.x + d.x * 0.04;
      s.y = o.y + d.y * 0.04;
      s.z = o.z + d.z * 0.04;
      const sp = 0.6 + r() * 1.2;
      s.vx = d.x * sp + (r() - 0.5) * 0.3;
      s.vy = d.y * sp + 0.15;
      s.vz = d.z * sp + (r() - 0.5) * 0.3;
      s.drag = 2.5;
      s.gravity = -0.25;
      s.life = 0.6 + r() * 0.6;
      s.size0 = 0.04;
      s.size1 = e.suppressed && firstRound ? 0.4 : 0.26;
      s.r = s.g = s.b = 0.16;
      s.alpha = e.suppressed ? 0.2 : 0.08;
      s.fade = 1.4;
      s.frame = ATLAS.puff + Math.floor(r() * 4);
      s.rot = r() * 6.28;
      s.rotVel = (r() - 0.5) * 1.5;
      this.alpha.spawn(s);
    }
    this.ejectBrass(e.caliber);
  }

  private ejectBrass(caliber: string) {
    const w = this.deps.weapons;
    const r = this.rand;
    const kind = this.brassKind(caliber);
    const view = w.view;
    const bolt = w.equipped.model.root.getObjectByName('bolt');
    const pos = this.v3;
    if (bolt) bolt.getWorldPosition(pos);
    else pos.set(0.02, 0.04, -0.06).applyMatrix4(view.matrixWorld);
    const q = view.quaternion;
    const right = this.v4.set(1, 0, 0).applyQuaternion(q);
    const vel = this.v1.copy(right).multiplyScalar(kind === 'pistol' ? 1.8 + r() * 0.8 : 2.4 + r() * 1.1);
    vel.addScaledVector(this.v2.set(0, 1, 0).applyQuaternion(q), 1.0 + r() * 0.8);
    vel.addScaledVector(this.v2.set(0, 0, 1).applyQuaternion(q), 0.3 + r() * 0.5); // slightly rearward
    vel.add(this.deps.player.velocity);
    // Casing axis across the receiver, tumbling end over end.
    this.q1.setFromAxisAngle(this.v2.set(0, 0, 1), Math.PI / 2).premultiply(q);
    const spin = this.v2.set((r() - 0.5) * 20, (r() - 0.5) * 10, 25 + r() * 25).applyQuaternion(q);
    this.brass.eject(pos, vel, this.q1, spin, kind);
  }

  // ---------------------------------------------------------------- impacts
  private onImpact(e: GameEvents['impact']) {
    const cls = CLASS[e.surface] ?? 'concrete';
    const p = e.point,
      n = e.normal;
    const r = this.rand;
    const s = this.rec;
    const energy = Math.min(2, Math.max(0.3, e.energy / 1500));
    const dust = DUST[e.surface] ?? [0.5, 0.5, 0.5];
    // Unlit sprites: albedo × typical irradiance / π (three's Lambert), roughly matching lit surfaces.
    const L = 0.45;
    const spray = (
      count: number,
      speed: number,
      frame: number,
      cr: number,
      cg: number,
      cb: number,
      sz = 0.016,
    ) => {
      for (let i = 0; i < count; i++) {
        resetRecord(s);
        s.x = p.x + n.x * 0.01;
        s.y = p.y + n.y * 0.01;
        s.z = p.z + n.z * 0.01;
        const sp = speed * (0.4 + r());
        s.vx = (n.x + (r() - 0.5) * 1.4) * sp;
        s.vy = (n.y + (r() - 0.5) * 1.4 + 0.3) * sp;
        s.vz = (n.z + (r() - 0.5) * 1.4) * sp;
        s.gravity = 9.81;
        s.drag = 0.6;
        s.life = 0.6 + r() * 0.6;
        s.size0 = s.size1 = sz * (0.6 + r() * 0.8);
        s.r = cr * L;
        s.g = cg * L;
        s.b = cb * L;
        s.frame = frame;
        s.rot = r() * 6.28;
        s.rotVel = (r() - 0.5) * 30;
        s.bounce = 0.25;
        s.floorY = 0.005;
        s.fade = 0.3;
        this.alpha.spawn(s);
      }
    };
    const puff = (count: number, size: number, alpha: number, rise: number, life: number, bright = 1) => {
      for (let i = 0; i < count; i++) {
        resetRecord(s);
        s.x = p.x + n.x * 0.03;
        s.y = p.y + n.y * 0.03;
        s.z = p.z + n.z * 0.03;
        const sp = 0.6 + r() * 1.4;
        s.vx = n.x * sp + (r() - 0.5) * 0.6;
        s.vy = n.y * sp + (r() - 0.5) * 0.4 + rise;
        s.vz = n.z * sp + (r() - 0.5) * 0.6;
        s.drag = 2.8;
        s.gravity = 0.15;
        s.life = life * (0.7 + r() * 0.6);
        s.size0 = size * 0.25;
        s.size1 = size * (0.8 + r() * 0.5);
        s.r = dust[0] * L * bright;
        s.g = dust[1] * L * bright;
        s.b = dust[2] * L * bright;
        s.alpha = alpha;
        s.fade = 1.2;
        s.frame = ATLAS.puff + Math.floor(r() * 4);
        s.rot = r() * 6.28;
        s.rotVel = (r() - 0.5) * 1.2;
        this.alpha.spawn(s);
      }
    };
    const sparks = (count: number, speed: number, heat: number) => {
      for (let i = 0; i < count; i++) {
        resetRecord(s);
        s.x = p.x + n.x * 0.005;
        s.y = p.y + n.y * 0.005;
        s.z = p.z + n.z * 0.005;
        const sp = speed * (0.35 + r());
        // Spall sprays mostly along the plate face.
        s.vx = (n.x * 0.35 + (r() - 0.5) * 2) * sp;
        s.vy = (n.y * 0.35 + (r() - 0.5) * 2 + 0.25) * sp;
        s.vz = (n.z * 0.35 + (r() - 0.5) * 2) * sp;
        s.gravity = 9.81;
        s.drag = 1.8;
        s.mode = 1;
        s.stretch = 0.014;
        s.life = 0.08 + r() * 0.25;
        s.size0 = s.size1 = 0.006;
        s.r = 30 * heat;
        s.g = 13 * heat;
        s.b = 4 * heat;
        s.frame = ATLAS.spark;
        s.bounce = 0.3;
        s.floorY = 0.005;
        s.fade = 0.7;
        this.additive.spawn(s);
      }
      // Impact flash.
      resetRecord(s);
      s.x = p.x + n.x * 0.02;
      s.y = p.y + n.y * 0.02;
      s.z = p.z + n.z * 0.02;
      s.life = 0.04;
      s.size0 = 0.05;
      s.size1 = 0.09;
      s.r = 14 * heat;
      s.g = 10 * heat;
      s.b = 6 * heat;
      s.frame = ATLAS.spark;
      this.additive.spawn(s);
    };

    switch (cls) {
      case 'steel':
        sparks(Math.round(10 * energy), 7, 1);
        spray(5, 2.2, ATLAS.flake, 0.75, 0.73, 0.68);
        // Paint/lead splash puff on the plate face (short-lived; no decal on moving steel).
        resetRecord(s);
        s.x = p.x + n.x * 0.02;
        s.y = p.y + n.y * 0.02;
        s.z = p.z + n.z * 0.02;
        s.life = 0.3;
        s.size0 = 0.06;
        s.size1 = 0.2;
        s.r = 0.8 * L;
        s.g = 0.78 * L;
        s.b = 0.74 * L;
        s.alpha = 0.55;
        s.frame = ATLAS.splash;
        s.rot = r() * 6.28;
        s.fade = 1.5;
        this.alpha.spawn(s);
        break;
      case 'metal':
        sparks(Math.round(7 * energy), 6, 0.9);
        break;
      case 'dirt':
        puff(e.surface === 'gravel' ? 3 : 5, 1.0 * energy, 0.85, 0.6, 1.6, 1.6);
        spray(
          e.surface === 'gravel' ? 8 : 12,
          3,
          ATLAS.chunk,
          dust[0] * 0.6,
          dust[1] * 0.6,
          dust[2] * 0.6,
          0.02,
        );
        // Thrown-up column of dirt.
        resetRecord(s);
        s.x = p.x + n.x * 0.04;
        s.y = p.y + n.y * 0.04 + 0.05;
        s.z = p.z + n.z * 0.04;
        s.vy = 0.6;
        s.life = 0.35;
        s.size0 = 0.2;
        s.size1 = 0.55;
        s.r = dust[0] * 0.25;
        s.g = dust[1] * 0.25;
        s.b = dust[2] * 0.25;
        s.alpha = 0.8;
        s.frame = ATLAS.clods;
        s.fade = 1.5;
        this.alpha.spawn(s);
        break;
      case 'wood':
        spray(8, 3, ATLAS.splinter, 0.45, 0.36, 0.24, 0.035);
        puff(2, 0.3, 0.4, 0.2, 0.9);
        break;
      case 'drywall':
        puff(4, 0.45, 0.6, 0.1, 1.6);
        spray(6, 2, ATLAS.chunk, 0.85, 0.84, 0.8);
        break;
      case 'concrete':
        puff(3, 0.45, 0.5, 0.15, 1.2);
        spray(6, 3, ATLAS.chunk, 0.45, 0.44, 0.42);
        if (r() < 0.5) sparks(2, 5, 0.6);
        break;
      case 'soft':
        puff(1, 0.12, 0.3, 0.05, 0.6);
        break;
      case 'paper':
        spray(4, 1.2, ATLAS.flake, 0.75, 0.68, 0.52);
        break;
    }
    // Decals only on static world surfaces: never on paper (it paints its own holes) or steel/targets.
    const dec = DECAL[cls];
    if (dec && !e.targetId) this.decals.add(p, n, dec.kind, dec.size * (0.8 + r() * 0.4), r() * 6.28);
  }

  // ---------------------------------------------------------------- loop
  fixedUpdate(dt: number) {
    this.brass.fixedUpdate(dt, this.cast, (c, hit: CastHit) => {
      this.ctx.bus.emit('brass', { point: c.pos.clone(), surface: hit.surface, kind: c.kind });
    });
  }

  update(dt: number, alpha: number) {
    if (this.tier !== this.deps.renderer.tier) this.applyQuality();
    this.sinceShot += dt;
    const f = this.ctx.input.frame;
    if (f.pressed.has('light')) this.lightOn = !this.lightOn;

    // Muzzle-flash light: pooled, intensity-only (never added/removed).
    const fl = this.flashLight;
    if (this.flashT > 0) {
      const { origin, dir } = this.muzzle();
      fl.position.copy(origin).addScaledVector(dir, 0.15);
      fl.intensity = this.flashPeak * Math.max(0, this.flashT / 0.04) ** 2 * (0.75 + this.rand() * 0.5);
      this.flashT -= dt;
    } else fl.intensity = 0;

    // Weapon light rides the rail beside the muzzle.
    const wl = this.weaponLight;
    if (this.lightOn) {
      const { origin, dir } = this.muzzle(true);
      wl.position.copy(origin);
      this.lightTarget.position.copy(origin).addScaledVector(dir, 6);
      this.lightTarget.updateMatrixWorld();
      wl.intensity = 8;
    } else wl.intensity = 0;

    const cam = this.ctx.camera;
    const px = this.ctx.renderer.getContext().drawingBufferHeight / (2 * Math.tan((cam.fov * Math.PI) / 360));
    this.additive.setPixelScale(px);
    this.alpha.setPixelScale(px);
    this.additive.update(dt);
    this.alpha.update(dt);
    this.brass.update(alpha);
  }

  private mo = { origin: new Vector3(), dir: new Vector3() };
  /** Allocation-free muzzle pose (same frame as WeaponController.muzzleWorld), or the weapon-light position. */
  private muzzle(rail = false) {
    const w = this.deps.weapons;
    const m = w.equipped.model;
    // The weapon light sits just ahead of and beside the muzzle so it doesn't light the gun itself.
    this.mo.origin
      .set(rail ? 0.035 : 0, rail ? 0.01 : 0.03, m.muzzleZ - (rail ? 0.03 : 0))
      .applyMatrix4(w.view.matrixWorld);
    this.mo.dir.set(0, 0, -1).applyQuaternion(w.view.quaternion).normalize();
    return this.mo;
  }

  /** Clears decals and brass (drill reset). */
  reset() {
    this.decals.clear();
    this.brass.clear();
  }

  /** Test hook: wrap the player in a closed dark room (for AE / noise checks). */
  debugDarkRoom(on: boolean) {
    if (on && !this.darkRoom) {
      const m = new Mesh(
        new BoxGeometry(7, 3.2, 7),
        new MeshStandardMaterial({ color: 0x2a2724, roughness: 0.95, side: BackSide }),
      );
      m.castShadow = m.receiveShadow = true;
      this.darkRoom = m;
    }
    if (!this.darkRoom) return;
    if (on) {
      const p = this.deps.player.position;
      this.darkRoom.position.set(p.x, 1.7, p.z);
      this.ctx.scene.add(this.darkRoom);
    } else this.ctx.scene.remove(this.darkRoom);
    this.ctx.renderer.shadowMap.needsUpdate = true;
  }
}
