import { Box3, Vector3, type Object3D } from 'three';
import { AudioEngine } from '../audio/AudioEngine';
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
import type { RunResult } from '../ui/drills';
import { Ballistics } from '../weapons/Ballistics';
import { WeaponController } from '../weapons/WeaponController';
import { Range } from '../world/Range';
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
  range!: Range;
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
    this.range = new Range(this.ctx, ballistics);
    this.player.teleport(this.range.spawn.clone(), this.range.spawnYaw);
    this.weapons = new WeaponController(this.ctx, this.player, ['sb16', 'p17']);
    this.systems.push(this.player, this.weapons, this.range);
    this.aimAssist.provider = this.aimAssistProvider();
    this.audio = new AudioEngine(bus, this.ctx.camera);
    this.hud = new Hud(ui);
    this.menu = new Menu(ui);
    this.menu.attachInput({
      trackpad: this.trackpad,
      gyro: this.gyro,
      gyroSupported: Gyro.supported,
      activeDevice: () => this.ctx.input.frame.activeDevice,
      padType: () => this.gamepad.padType,
    });
    this.menu.onPlay = () => this.enter(canvas);
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

  /**
   * Aim assist: angle from the weapon aim ray to the nearest standing shootable target.
   * TODO(world): replace the duck-typed mesh lookup with a `Target.aimPoint()` (and `noShoot`) contract.
   */
  private aimAssistProvider() {
    const box = new Box3();
    const p = new Vector3();
    return () => {
      const { origin, dir } = this.weapons.muzzleWorld();
      let best = Infinity;
      for (const t of this.range.targets) {
        const tt = t as typeof t & { noShoot?: boolean; aimPoint?: () => Vector3; mesh?: Object3D };
        if (t.down || tt.noShoot) continue;
        if (tt.aimPoint) p.copy(tt.aimPoint());
        else if (tt.mesh) box.setFromObject(tt.mesh).getCenter(p);
        else continue;
        p.sub(origin);
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
    if (canvas && !this.allowUnlocked) this.lock(canvas);
  }

  pause() {
    this.paused = true;
    this.menu.show(true);
  }

  /** End-of-run results screen (drills call this). */
  showResults(r: RunResult) {
    this.paused = true;
    if (document.pointerLockElement) document.exitPointerLock();
    this.menu.showResults(r);
  }

  resetDrill() {
    this.range.reset();
    this.player.teleport(this.range.spawn.clone(), this.range.spawnYaw);
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

  /** One render frame. Exposed for deterministic stepping in tests. */
  step(dt: number) {
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
    this.audio.update();
    this.hud.update(this.weapons);
    this.renderer.render(dt);
  }
}
