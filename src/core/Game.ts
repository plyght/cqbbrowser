import { HapticsDirector } from '../input/HapticsDirector';
import { gamepadSettings } from '../input/config';
import { Vector3 } from 'three';
import { videoSettings } from '../render/quality';
import { AudioEngine } from '../audio/AudioEngine';
import { Fx } from '../fx/Fx';
import { Gear } from '../gear/Gear';
import { AimAssist, assistRadius, type AssistScene, type AssistTarget } from '../input/AimAssist';
import { mouseSettings } from '../input/config';
import { Gamepad } from '../input/Gamepad';
import { Gyro } from '../input/Gyro';
import { Trackpad } from '../input/Trackpad';
import { Input } from '../input/Input';
import { KeyboardMouse } from '../input/KeyboardMouse';
import type { ActionFrame, InputSource } from '../input/actions';
import { Physics } from '../physics/Physics';
import { Player } from '../player/Player';
import { Renderer } from '../render/Renderer';
import { Hud } from '../ui/Hud';
import { Menu } from '../ui/Menu';
import { setDrillSource, type RunResult } from '../ui/drills';
import { toDrillInfo, toRunResult } from '../ui/drillAdapter';
import { Ballistics } from '../weapons/Ballistics';
import { WeaponController } from '../weapons/WeaponController';
import { preloadWeaponAssets } from '../weapons/models';
import { Drills } from '../drills/Drills';
import { World } from '../world/World';
import { loadoutDefs, loadoutKey, LOADOUT_PRESETS, loadouts, type Loadout } from '../loadout';
import { bus } from './bus';
import type { Context, System } from './Context';

/** Scripted input for tests/screenshots: merged like any other device. */
export class TestDriver implements InputSource {
  next: Partial<Pick<ActionFrame, 'move' | 'look'>> & { down?: string[] } = {};
  poll(f: ActionFrame) {
    if (this.next.move) {
      f.move.x += this.next.move.x;
      f.move.y += this.next.move.y;
    }
    if (this.next.look) {
      f.look.yaw += this.next.look.yaw;
      f.look.pitch += this.next.look.pitch;
      this.next.look = undefined;
    }
    for (const d of this.next.down ?? []) f.down.add(d as never);
  }
}

export class Game {
  ctx!: Context;
  renderer!: Renderer;
  player!: Player;
  weapons!: WeaponController;
  fx!: Fx;
  gear!: Gear;
  world!: World;
  ballistics!: Ballistics;
  drills!: Drills;
  audio!: AudioEngine;
  hud!: Hud;
  menu!: Menu;
  test = new TestDriver();
  aimAssist = new AimAssist();
  trackpad!: Trackpad;
  gamepad!: Gamepad;
  gyro = new Gyro();
  haptics!: HapticsDirector;
  systems: System[] = [];
  paused = true;
  private acc = 0;
  private last = performance.now();

  async start(canvas: HTMLCanvasElement, ui: HTMLElement) {
    const physics = new Physics();
    await physics.init();
    this.renderer = new Renderer(canvas);
    const input = new Input();
    this.trackpad = new Trackpad();
    this.gamepad = new Gamepad(this.aimAssist);
    input.add(new KeyboardMouse(canvas, this.trackpad));
    input.add(this.trackpad);
    input.add(this.gamepad);
    input.add(this.gyro);
    // All rumble goes through the director so overlapping effects mix; direct `input.haptics.rumble()`
    // calls from gameplay code become director voices too.
    this.haptics = new HapticsDirector(
      bus,
      {
        dual: (st, wk, ms) => this.gamepad.rumble(st, wk, ms),
        triggers: (l, r, ms) => this.gamepad.triggerRumble(l, r, ms),
      },
      this.gyro,
    );
    this.haptics.enabled = () => input.frame.activeDevice === 'gamepad' && gamepadSettings.get().haptics;
    this.haptics.strength = () => gamepadSettings.get().hapticsStrength;
    input.padHaptics = { rumble: (st, wk, ms) => this.haptics.play(ms, st, wk) };
    void this.gyro.reconnect().catch(() => {});
    input.add(this.test);
    this.ctx = {
      scene: this.renderer.scene,
      camera: this.renderer.camera,
      renderer: this.renderer.renderer,
      physics,
      input,
      bus,
      time: 0,
      tick: 0,
    };
    this.player = new Player(this.ctx);
    const ballistics = (this.ballistics = new Ballistics(this.ctx, () => this.player.rigidBody));
    this.world = new World(this.ctx, ballistics, this.player);
    this.player.teleport(this.world.spawn, this.world.spawnYaw);
    // Blender parts kit (GLB + atlases); buildModel falls back to procedural meshes if this fails.
    await preloadWeaponAssets().catch((e) => console.warn('weapon kit not loaded', e));
    this.weapons = new WeaponController(this.ctx, this.player, ['sb16', 'p17']);
    this.drills = new Drills(this.ctx, this.world, this.player, () => this.paused);
    this.systems.push(this.player, this.weapons, ballistics, this.world, this.drills);
    this.fx = new Fx(this.ctx, { weapons: this.weapons, player: this.player, renderer: this.renderer });
    this.systems.push(this.fx);
    // Tactical gear (NVG, IR, flashbangs) runs after Fx so its camera shake lands on the final pose.
    this.gear = new Gear(this.ctx, {
      renderer: this.renderer,
      player: this.player,
      muzzle: () => this.weapons.muzzleWorld(),
      rooms: () => this.world.roomGraph(),
      roofed: () => this.world.killhouse.roofed,
      fx: this.fx,
      toast: (t) => this.hud?.toast(t),
    });
    this.systems.push(this.gear);
    this.wireAimAssist();
    this.audio = new AudioEngine(bus, this.ctx.camera, { physics, exclude: () => this.player.rigidBody });
    this.hud = new Hud(ui);
    this.hud.bind({
      camera: this.ctx.camera,
      lens: this.renderer.bodycam.uniforms,
      posture: () => this.player,
      device: () => this.ctx.input.frame.activeDevice,
      padType: () => this.gamepad.padType,
    });
    this.menu = new Menu(ui);
    this.menu.attachInput({
      trackpad: this.trackpad,
      gyro: this.gyro,
      gyroSupported: Gyro.supported,
      activeDevice: () => this.ctx.input.frame.activeDevice,
      padType: () => this.gamepad.padType,
    });
    // Every way into gameplay from the menus spawns with the active loadout (a no-op if it's already equipped).
    this.menu.onPlay = () => {
      this.applyLoadout(loadouts().active());
      this.enter(canvas);
    };
    setDrillSource(() => this.drills.list().map(toDrillInfo));
    this.menu.onStartDrill = (d) => {
      this.applyLoadout(loadouts().active());
      this.enter(canvas);
      this.drills.start(d.id);
    };
    this.drills.onResult((r) =>
      this.showResults(
        toRunResult(
          r,
          this.drills.list().find((d) => d.id === r.drillId),
        ),
      ),
    );
    // Fresh mags at every drill standby.
    bus.on('drillState', (e) => {
      if (e.state !== 'standby') return;
      this.weapons.resupply();
    });
    this.menu.onRestart = () => {
      this.resetDrill();
      this.enter(canvas);
    };
    canvas.addEventListener('click', () => {
      if (!this.paused && document.pointerLockElement !== canvas) this.lock(canvas);
    });
    document.addEventListener('pointerlockchange', () => {
      if (document.pointerLockElement !== canvas && !this.paused && !this.allowUnlocked) this.pause();
    });
    // Warm up one physics step so bodies settle before first frame.
    physics.step();
    // Shaders for everything that first appears mid-game (shot FX pools), off the first trigger pull.
    void this.renderer.prewarm(this.weapons.spareModels());
    requestAnimationFrame(this.frame);
  }

  /** What the controller carries now (the constructor's default ids = the standard-issue preset). */
  private appliedLoadout = loadoutKey(LOADOUT_PRESETS[0]);

  /**
   * Equip a loadout (src/loadout): builds, ammo and pouch mag counts. Skips the rebuild when nothing changed
   * unless `force`. Returns true if the weapons were swapped.
   */
  applyLoadout(l: Loadout, force = false): boolean {
    const key = loadoutKey(l);
    if (!force && key === this.appliedLoadout) return false;
    const defs = loadoutDefs(l);
    if (!defs.length) return false;
    this.weapons.setLoadout(defs);
    this.appliedLoadout = key;
    return true;
  }

  /** Tests/headless set this so losing pointer lock doesn't pause. */
  allowUnlocked = false;

  private lock(canvas: HTMLCanvasElement) {
    const req = canvas.requestPointerLock as (o?: { unadjustedMovement?: boolean }) => Promise<void> | void;
    try {
      // Trackpad preset keeps OS acceleration (§7.3); mouse uses raw input where supported (§7.2).
      const raw = this.trackpad.wantsRawMouse && mouseSettings.get().rawInput;
      const p = req.call(canvas, { unadjustedMovement: raw });
      if (p && 'catch' in p) p.catch(() => canvas.requestPointerLock());
    } catch {
      canvas.requestPointerLock();
    }
  }

  /** Aim assist scene: standing shootable targets of the active facility plus camera and bore rays. */
  private wireAimAssist() {
    const eye = new Vector3();
    const camDir = new Vector3();
    const cache = new Map<string, AssistTarget>();
    const scene: AssistScene = { eye, camDir, muzzle: eye, boreDir: camDir, targets: [] };
    const list: AssistTarget[] = [];
    this.aimAssist.scene = () => {
      const cam = this.ctx.camera;
      cam.getWorldPosition(eye);
      cam.getWorldDirection(camDir);
      const m = this.weapons.muzzleWorld();
      scene.muzzle = m.origin;
      scene.boreDir = m.dir;
      list.length = 0;
      for (const t of this.world.list(this.world.active)) {
        if (t.down) continue;
        let a = cache.get(t.id);
        if (!a)
          cache.set(
            t.id,
            (a = { id: t.id, pos: t.aimPoint(), radius: assistRadius(t.kind), noShoot: t.noShoot }),
          );
        a.pos = t.aimPoint();
        a.noShoot = t.noShoot;
        list.push(a);
      }
      scene.targets = list;
      return scene;
    };
    const o = new Vector3();
    const d = new Vector3();
    this.aimAssist.los = (from, t, dist) => {
      o.set(from.x, from.y, from.z);
      d.set(t.pos.x - from.x, t.pos.y - from.y, t.pos.z - from.z).normalize();
      const hit = this.ctx.physics.raycast(o, d, dist, this.player.rigidBody);
      return !hit || hit.tag.targetId === t.id || hit.distance >= dist - t.radius;
    };
  }

  enter(canvas?: HTMLCanvasElement) {
    this.audio.resume();
    // Loadout swaps and the rig (loaded async) may have added materials since boot.
    void this.renderer.prewarm(this.weapons.spareModels());
    this.menu.show(false);
    this.paused = false;
    this.renderer.camPowerOn();
    if (canvas && !this.allowUnlocked) this.lock(canvas);
  }

  pause() {
    this.paused = true;
    this.menu.show(true);
  }

  /** @deprecated alias for `world` (the old single-range facility). */
  get range() {
    return this.world;
  }

  /** End-of-run results screen (drills call this). */
  showResults(r: RunResult) {
    this.paused = true;
    if (document.pointerLockElement) document.exitPointerLock();
    this.menu.showResults(r);
  }

  resetDrill() {
    this.drills.restart();
    this.fx.reset();
    this.gear.resupply();
  }

  private reportedPresentationError = false;

  /** When true the rAF loop only renders; tests drive `step()` explicitly. */
  manual = false;

  private frame = (now: number) => {
    requestAnimationFrame(this.frame);
    if (this.manual) {
      this.last = now;
      return;
    }
    // Optional frame cap (settings: video.frameCap); 0 = vsync-limited only.
    const cap = Number(videoSettings.get().frameCap) || 0;
    if (cap > 0 && now - this.last < 1000 / cap - 1) return;
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.step(dt);
  };

  /** One frame. Exposed for deterministic stepping in tests; `render=false` skips drawing (fast sim). */
  step(dt: number, render = true) {
    const ctx = this.ctx;
    ctx.time += dt;
    ctx.input.enabled = !this.paused;
    const f = ctx.input.poll(dt);
    if (f.pressed.has('pause') && !this.paused) this.pause();
    if (f.pressed.has('restart')) this.resetDrill();
    this.acc += dt;
    while (this.acc >= Physics.STEP) {
      for (const s of this.systems) s.fixedUpdate?.(Physics.STEP);
      ctx.physics.step();
      ctx.tick++;
      this.acc -= Physics.STEP;
    }
    const alpha = this.acc / Physics.STEP;
    for (const s of this.systems) s.update?.(dt, alpha);
    // Audio and haptics are presentation: a throw there must never stop the frame from rendering (a NaN in the
    // acoustics once made the mixer throw every frame and froze the game).
    try {
      this.audio.update(dt);
      this.haptics.update(dt);
    } catch (err) {
      if (!this.reportedPresentationError) console.error('[game] audio/haptics update threw', err);
      this.reportedPresentationError = true;
    }
    this.hud.update(this.weapons);
    // The helmet lens stays wide in ADS (the gun comes up, the lens doesn't zoom): the distortion eases only a little.
    this.renderer.setAds(this.weapons.adsBlend * (this.player.mount === 'helmet' ? 0.3 : 1));
    // Input turn rate drives CAM04 bitrate starvation alongside the measured camera rotation.
    this.renderer.setMotion(Math.hypot(f.look.yaw, f.look.pitch) / Math.max(dt, 1e-3));
    // Skipped frames still advance the camera's temporal state (AE, codec, boot) on the next draw.
    if (render) this.renderer.render(dt);
    else this.renderer.advance(dt);
  }
}
