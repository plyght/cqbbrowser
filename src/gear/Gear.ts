import {
  CanvasTexture,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  PointLight,
  Quaternion,
  SRGBColorSpace,
  Vector3,
} from 'three';
import type { Context, System } from '../core/Context';
import { ATLAS } from '../fx/textures';
import type { ParticlePool, ParticleSpawn } from '../fx/Particles';
import type { RAPIER } from '../physics/Physics';
import type { Renderer } from '../render/Renderer';
import type { RoomGraph } from '../world/kit/layout';
import { flashHearing, flashVisual, whiteoutAt, type FlashGeometry } from './flash';
import { IrDevice } from './ir';
import { NvgMount } from './nvg';
import { gearSettings } from './settings';
import { Throwables, type SpawnSpec, type ThrowSpec } from './throwables';

export interface GearDeps {
  renderer: Renderer;
  player: { position: Vector3; velocity: Vector3; rigidBody: RAPIER.RigidBody };
  /** Muzzle pose for the IR laser (WeaponController.muzzleWorld). */
  muzzle: () => { origin: Vector3; dir: Vector3 };
  /** Audio/visual room context (kill house graph) and whether the house is roofed. */
  rooms: () => RoomGraph | null;
  roofed: () => boolean;
  /** Fx particle pools (smoke, flash sprites). */
  fx?: { additive: ParticlePool; alpha: ParticlePool };
  /** Corner toast (HUD). */
  toast?: (text: string) => void;
}

const SCORCH_MAX = 6;

/**
 * Tactical gear (src/gear): helmet NVG, weapon IR laser/illuminator and flashbangs. Reads its own actions
 * (`nvg`, `ir`, `throw`) from the ActionFrame and drives the NVG/flash post pass, the bang light, particles,
 * scorch decals, camera shake, and the bus events audio and the body listen to (`flashbang`, `gearSound`,
 * `nvg`, `flinch`).
 *
 * Drill hooks: `throw()`, `spawn()`, `resupply()`, `setNvg()`.
 */
export class Gear implements System {
  readonly mount = new NvgMount();
  readonly ir: IrDevice;
  readonly throwables: Throwables;
  readonly bangLight = new PointLight(0xf4f6ff, 0, 40, 2);
  /** Gear options (exposed for tests / drills). */
  readonly settings = gearSettings;
  irOn = false;
  private bangT = 10;
  private bangPeak = 0;
  private flash = { t: 10, visual: 0 };
  private shake = { amp: 0, t: 10 };
  private scorches: Mesh[] = [];
  private scorchMat: MeshStandardMaterial | null = null;
  private rec: ParticleSpawn = { x: 0, y: 0, z: 0, life: 1, size0: 0.1, r: 1, g: 1, b: 1, frame: 0 };
  private q = new Quaternion();
  private v = new Vector3();
  private seed = 1;

  constructor(
    private ctx: Context,
    private deps: GearDeps,
  ) {
    this.ir = new IrDevice(ctx.scene);
    this.throwables = new Throwables(
      ctx,
      () => deps.player.rigidBody,
      () => deps.player.velocity,
    );
    this.throwables.count = gearSettings.get().flashbangs;
    this.throwables.onDetonate = (p, training, inHand) => this.detonate(p, training, inHand);
    this.throwables.onSmoke = (p, age) => this.smoke(p, age);
    this.bangLight.castShadow = false;
    ctx.scene.add(this.bangLight);
    // Fresh gear at every drill standby.
    ctx.bus.on('drillState', (e) => {
      if (e.state === 'standby') this.resupply();
    });
  }

  // ---- Drill / test API --------------------------------------------------------------------------------------

  /** Throw a flashbang from the player now (spoon flies at release). Returns false when out. */
  throw(spec: ThrowSpec = {}) {
    return this.throwables.throw(this.ctx.camera, spec);
  }

  /** Drop a live device anywhere (e.g. a training flash-bang simulator tossed in by an instructor). */
  spawn(s: SpawnSpec) {
    this.throwables.spawn(s);
  }

  resupply() {
    this.throwables.reset(gearSettings.get().flashbangs);
  }

  /** Force the NVG up/down. */
  setNvg(down: boolean) {
    if (this.mount.isDown !== down) this.toggleNvg();
  }

  get flashbangs() {
    return this.throwables.count;
  }

  /** Current white-out level 0..1 (HUD/accessibility). */
  get whiteout() {
    return whiteoutAt(this.flash.visual, this.flash.t);
  }

  // ---- Loop ---------------------------------------------------------------------------------------------------

  fixedUpdate(dt: number) {
    this.throwables.fixedUpdate(dt, this.ctx.camera);
  }

  update(dt: number) {
    const f = this.ctx.input.frame;
    const cam = this.ctx.camera;
    const g = gearSettings.get();

    // NVG mount.
    if (f.pressed.has('nvg')) this.toggleNvg();
    for (const e of this.mount.update(dt)) {
      if (e === 'detentDown') this.ctx.bus.emit('gearSound', { kind: 'nvgDown' });
      if (e === 'detentUp') this.ctx.bus.emit('gearSound', { kind: 'nvgUp' });
      if (e === 'powerOn') this.ctx.bus.emit('nvg', { on: true });
    }
    const view = this.deps.renderer.nvg.view;
    view.down = this.mount.flip;
    view.power = this.mount.power;
    view.swirl = this.mount.swirl;
    view.gainEv = g.nvgGain;
    view.phosphor = g.phosphor;
    view.tubes = g.nvgTubes;

    // IR laser / illuminator (only visible through a powered tube).
    if (f.pressed.has('ir')) {
      this.irOn = !this.irOn;
      this.ctx.bus.emit('gearSound', { kind: 'irClick' });
      this.deps.toast?.(this.irOn ? `IR ${g.irMode === 'laser' ? 'LASER' : 'LASER + ILLUM'}` : 'IR OFF');
    }
    const visible = this.irOn && this.mount.power > 0.05;
    if (visible || this.ir.beam.visible) {
      const { origin, dir } = this.deps.muzzle();
      const em = this.v.set(0, 0.035, 0).applyQuaternion(cam.quaternion).add(origin);
      const hit = this.ctx.physics.raycast(em, dir, 150, this.deps.player.rigidBody);
      this.ir.setViewportHeight(this.ctx.renderer.getContext().drawingBufferHeight);
      this.ir.update(visible, g.irMode === 'laserFlood', em, dir, hit?.point ?? null, this.mount.power);
    }

    // Throwables.
    this.throwables.input(f.down.has('throw'), f.pressed.has('throw'), cam);
    if (f.pressed.has('throw') && this.throwables.holding)
      this.deps.toast?.(`FLASHBANG · ${this.throwables.count - 1} LEFT`);
    this.throwables.update(dt);

    // Bang light: ~6 Mcd for a few ms (it's what the camera actually sees before the white-out).
    this.bangT += dt;
    this.bangLight.intensity = this.bangT < 0.15 ? this.bangPeak * Math.exp(-this.bangT / 0.018) : 0;

    // Sensor white-out envelope → post pass.
    this.flash.t += dt;
    const fs = this.deps.renderer.nvg.flashState;
    fs.white = whiteoutAt(this.flash.visual, this.flash.t);
    fs.ghost = this.flash.t < 5 ? this.flash.visual * Math.exp(-this.flash.t / 1.6) : 0;

    // Camera shake (applied on top of the body cam pose for this frame only).
    this.shake.t += dt;
    const a = this.shake.amp * Math.exp(-this.shake.t / 0.3);
    if (a > 1e-4) {
      const s = this.seed++;
      const n = (k: number) => Math.sin(s * 12.9898 + k * 78.233) * 0.5 + Math.sin(s * 3.7 + k) * 0.5;
      cam.rotateX(a * n(1));
      cam.rotateY(a * n(2));
      cam.rotateZ(a * 0.6 * n(3));
      cam.updateMatrixWorld();
    }
  }

  private toggleNvg() {
    const down = !this.mount.isDown;
    for (const e of this.mount.toggle()) if (e === 'powerOff') this.ctx.bus.emit('nvg', { on: false });
    this.ctx.bus.emit('gearSound', { kind: down ? 'nvgDown' : 'nvgUp' });
    const g = gearSettings.get();
    this.deps.toast?.(down ? `NVG ▼ ${g.nvgTubes === 'dual' ? 'DUAL' : 'PVS-14'}` : 'NVG ▲');
  }

  // ---- Flashbang -----------------------------------------------------------------------------------------------

  /** Listener-side geometry for a bang at `p` (camera = the listener/sensor). */
  geometryFor(p: Vector3, training = false): FlashGeometry {
    const cam = this.ctx.camera;
    const c = cam.getWorldPosition(new Vector3());
    const to = p.clone().sub(c);
    const distance = to.length();
    const dir = to.clone().divideScalar(Math.max(distance, 1e-4));
    const fwd = new Vector3(0, 0, -1).applyQuaternion(cam.getWorldQuaternion(this.q));
    let los = true;
    if (distance > 0.2) {
      const hit = this.ctx.physics.raycast(c, dir, distance - 0.12, this.deps.player.rigidBody);
      los = !hit;
    }
    const rooms = this.deps.rooms()?.rooms ?? [];
    const roomOf = (v: Vector3) =>
      rooms.find(
        (r) =>
          v.x >= r.min[0] && v.x <= r.max[0] && v.z >= r.min[2] && v.z <= r.max[2] && v.y <= r.max[1] + 0.3,
      )?.id;
    const rp = roomOf(p);
    const rc = roomOf(c);
    return {
      distance,
      los,
      cosAngle: fwd.dot(dir),
      indoor: this.deps.roofed() && !!rp,
      sameRoom: !!rp && rp === rc,
      training,
    };
  }

  private detonate(p: Vector3, training: boolean, inHand: boolean) {
    const geo = this.geometryFor(p, training);
    if (inHand) {
      geo.los = true;
      geo.cosAngle = 0.8;
    }
    let visual = flashVisual(geo);
    if (this.mount.power > 0.2) visual = Math.min(1, visual * 1.3);
    const hearing = flashHearing(geo);
    const c = this.ctx.camera.getWorldPosition(new Vector3());
    this.bangT = 0;
    this.bangPeak = training ? 900 : 2600;
    this.bangLight.position.copy(p).setY(p.y + 0.08);
    // Keep the strongest exposure if two go off close together.
    if (visual >= whiteoutAt(this.flash.visual, this.flash.t)) this.flash = { t: 0, visual };
    this.deps.renderer.nvg.flashState.capture = visual;
    this.deps.renderer.flash(Math.min(3, 0.5 + 3 * visual));
    this.shake = { amp: 0.045 * Math.max(hearing, visual * 0.6), t: 0 };
    const dir = p.clone().sub(c).normalize();
    this.ctx.bus.emit('flinch', { strength: Math.max(visual, hearing * 0.9), dir, cause: 'flashbang' });
    this.ctx.bus.emit('flashbang', {
      point: p.clone(),
      distance: geo.distance,
      visual,
      hearing,
      los: geo.los,
      indoor: geo.indoor,
      training,
    });
    this.burst(p, geo.indoor);
    if (!training) this.scorch(p);
  }

  private burst(p: Vector3, indoor: boolean) {
    const fx = this.deps.fx;
    if (!fx) return;
    const s = this.rec;
    const reset = () => {
      Object.assign(s, { vx: 0, vy: 0, vz: 0, gravity: 0, drag: 0, rot: 0, rotVel: 0, alpha: 1, mode: 0 });
      s.size1 = undefined;
      s.fade = 1;
    };
    // Flash: a few huge additive sprites, gone in a couple of frames.
    for (let i = 0; i < 4; i++) {
      reset();
      Object.assign(s, { x: p.x, y: p.y + 0.06, z: p.z, life: 0.05 + i * 0.015, size0: 0.9 + i * 0.5 });
      Object.assign(s, { r: 9, g: 9, b: 8.5, frame: ATLAS.flash + (i % 4), rot: Math.random() * 6.28 });
      s.size1 = s.size0 * 1.6;
      fx.additive.spawn(s);
    }
    // Sparks + hot fragments of the fuse cap.
    for (let i = 0; i < 18; i++) {
      reset();
      const a = Math.random() * 6.28,
        e = Math.random() * 1.2;
      const sp = 3 + Math.random() * 6;
      Object.assign(s, { x: p.x, y: p.y + 0.05, z: p.z, life: 0.2 + Math.random() * 0.35, size0: 0.02 });
      Object.assign(s, { vx: Math.cos(a) * Math.cos(e) * sp, vy: Math.sin(e) * sp, vz: Math.sin(a) * sp });
      Object.assign(s, {
        r: 6,
        g: 4.2,
        b: 2,
        frame: ATLAS.spark,
        gravity: 9.8,
        drag: 1.5,
        mode: 1,
        stretch: 0.03,
      });
      fx.additive.spawn(s);
    }
    // Smoke: a dense grey ball that rolls up and spreads (unlit particles: dim indoors).
    const k = indoor ? 0.16 : 0.55;
    for (let i = 0; i < 22; i++) {
      reset();
      const a = Math.random() * 6.28;
      const sp = 0.4 + Math.random() * 1.4;
      Object.assign(s, { x: p.x, y: p.y + 0.1, z: p.z, life: 2.5 + Math.random() * 3, size0: 0.25 });
      Object.assign(s, { vx: Math.cos(a) * sp, vy: 0.3 + Math.random() * 0.9, vz: Math.sin(a) * sp });
      Object.assign(s, { r: k, g: k, b: k * 0.97, alpha: 0.55, frame: ATLAS.puff + (i % 4), drag: 1.6 });
      Object.assign(s, { rot: Math.random() * 6.28, rotVel: (Math.random() - 0.5) * 0.8, fade: 1.3 });
      s.size1 = 1.3 + Math.random() * 0.9;
      fx.alpha.spawn(s);
    }
  }

  private smoke(p: Vector3, age: number) {
    const fx = this.deps.fx;
    if (!fx) return;
    const s = this.rec;
    const k = this.deps.roofed() ? 0.14 : 0.45;
    Object.assign(s, {
      x: p.x,
      y: p.y,
      z: p.z,
      vx: (Math.random() - 0.5) * 0.1,
      vy: 0.35,
      vz: 0,
      gravity: 0,
    });
    Object.assign(s, { life: 1.8, size0: 0.05, r: k, g: k, b: k, alpha: 0.35 * Math.max(0, 1 - age / 4) });
    Object.assign(s, {
      frame: ATLAS.puff + (this.seed++ % 4),
      drag: 0.4,
      rot: Math.random() * 6.28,
      rotVel: 0.6,
    });
    s.size1 = 0.45;
    s.fade = 1.2;
    s.mode = 0;
    fx.alpha.spawn(s);
  }

  private scorch(p: Vector3) {
    const hit = this.ctx.physics.raycast(p.clone().setY(p.y + 0.05), new Vector3(0, -1, 0), 0.6);
    if (!hit) return;
    this.scorchMat ??= new MeshStandardMaterial({
      map: scorchTexture(),
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
      roughness: 1,
    });
    let m = this.scorches.length >= SCORCH_MAX ? this.scorches.shift()! : null;
    if (!m) {
      m = new Mesh(new PlaneGeometry(0.75, 0.75), this.scorchMat);
      m.receiveShadow = true;
      this.ctx.scene.add(m);
    }
    m.position.copy(hit.point).addScaledVector(hit.normal, 0.002);
    m.quaternion.setFromUnitVectors(new Vector3(0, 0, 1), hit.normal);
    m.rotateZ(Math.random() * 6.28);
    this.scorches.push(m);
  }
}

function scorchTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const gr = g.createRadialGradient(64, 64, 2, 64, 64, 62);
  gr.addColorStop(0, 'rgba(8,7,6,0.95)');
  gr.addColorStop(0.35, 'rgba(20,18,15,0.7)');
  gr.addColorStop(0.7, 'rgba(30,27,22,0.25)');
  gr.addColorStop(1, 'rgba(30,27,22,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 128, 128);
  // Streaks blown outward.
  g.strokeStyle = 'rgba(10,9,8,0.35)';
  for (let i = 0; i < 26; i++) {
    const a = Math.random() * Math.PI * 2;
    const r0 = 8 + Math.random() * 10,
      r1 = 30 + Math.random() * 30;
    g.lineWidth = 1 + Math.random() * 2.5;
    g.beginPath();
    g.moveTo(64 + Math.cos(a) * r0, 64 + Math.sin(a) * r0);
    g.lineTo(64 + Math.cos(a) * r1, 64 + Math.sin(a) * r1);
    g.stroke();
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}
