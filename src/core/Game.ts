import { Vector3 } from 'three';
import { AudioEngine } from '../audio/AudioEngine';
import { Fx } from '../fx/Fx';
import { AimAssist } from '../input/AimAssist';
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
import { Drills } from '../drills/Drills';
import { World } from '../world/World';
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
  world!: World;
  drills!: Drills;
  audio!: AudioEngine;
  hud!: Hud;
  menu!: Menu;
  test = new TestDriver();
  aimAssist = new AimAssist();
  trackpad!: Trackpad;
  gamepad!: Gamepad;
  gyro = new Gyro();
  systems: System[] = [];
  paused = true;
  private acc = 0;
  private last = performance.now();

  async start(canvas: HTMLCanvasElement, ui: HTMLElement) {
    const physics = new Physics();
    await physics.init();
    this.renderer = new Renderer(canvas);
    const input = new Input();
    this.trackpad = new Trackpad(this.aimAssist);
    this.gamepad = new Gamepad(this.aimAssist);
    input.add(new KeyboardMouse(canvas, this.trackpad));
    input.add(this.trackpad);
    input.add(this.gamepad);
    input.add(this.gyro);
    input.padHaptics = this.gamepad;
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
    const ballistics = new Ballistics(this.ctx, () => this.player.rigidBody);
    this.world = new World(this.ctx, ballistics, this.player);
    this.player.teleport(this.world.spawn, this.world.spawnYaw);
    this.weapons = new WeaponController(this.ctx, this.player, ['sb16', 'p17']);
    this.drills = new Drills(this.ctx, this.world, this.player, () => this.paused);
    this.systems.push(this.player, this.weapons, this.world, this.drills);
    this.fx = new Fx(this.ctx, { weapons: this.weapons, player: this.player, renderer: this.renderer });
    this.systems.push(this.fx);
    this.aimAssist.provider = this.aimAssistProvider();
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
    this.menu.onPlay = () => this.enter(canvas);
    setDrillSource(() => this.drills.list().map(toDrillInfo));
    this.menu.onStartDrill = (d) => {
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
    requestAnimationFrame(this.frame);
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

  /** Aim assist: angle from the weapon aim ray to the nearest standing shootable target in the active facility. */
  private aimAssistProvider() {
    const p = new Vector3();
    return () => {
      const { origin, dir } = this.weapons.muzzleWorld();
      let best = Infinity;
      for (const t of this.world.list(this.world.active)) {
        if (t.down || t.noShoot) continue;
        p.copy(t.aimPoint()).sub(origin);
        if (p.lengthSq() < 0.09) continue;
        best = Math.min(best, dir.angleTo(p));
      }
      return best;
    };
  }

  enter(canvas?: HTMLCanvasElement) {
    this.audio.resume();
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
  }

  /** When true the rAF loop only renders; tests drive `step()` explicitly. */
  manual = false;

  private frame = (now: number) => {
    requestAnimationFrame(this.frame);
    if (this.manual) {
      this.last = now;
      return;
    }
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
    this.audio.update(dt);
    this.hud.update(this.weapons);
    this.renderer.setAds(this.weapons.adsBlend);
    // Input turn rate drives CAM04 bitrate starvation alongside the measured camera rotation.
    this.renderer.setMotion(Math.hypot(f.look.yaw, f.look.pitch) / Math.max(dt, 1e-3));
    // Skipped frames still advance the camera's temporal state (AE, codec, boot) on the next draw.
    if (render) this.renderer.render(dt);
    else this.renderer.advance(dt);
  }
}
