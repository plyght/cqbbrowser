import { AudioEngine } from '../audio/AudioEngine';
import { Input } from '../input/Input';
import { KeyboardMouse } from '../input/KeyboardMouse';
import type { ActionFrame, InputSource } from '../input/actions';
import { Physics } from '../physics/Physics';
import { Player } from '../player/Player';
import { Renderer } from '../render/Renderer';
import { Hud } from '../ui/Hud';
import { Menu } from '../ui/Menu';
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
  world!: World;
  drills!: Drills;
  audio!: AudioEngine;
  hud!: Hud;
  menu!: Menu;
  test = new TestDriver();
  systems: System[] = [];
  paused = true;
  private acc = 0;
  private last = performance.now();

  async start(canvas: HTMLCanvasElement, ui: HTMLElement) {
    const physics = new Physics();
    await physics.init();
    this.renderer = new Renderer(canvas);
    const input = new Input();
    input.add(new KeyboardMouse(canvas));
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
    this.audio = new AudioEngine(bus, this.ctx.camera);
    this.hud = new Hud(ui);
    this.menu = new Menu(ui);
    this.menu.onPlay = () => this.enter(canvas);
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
      const p = req.call(canvas, { unadjustedMovement: true });
      if (p && 'catch' in p) p.catch(() => canvas.requestPointerLock());
    } catch {
      canvas.requestPointerLock();
    }
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

  /** @deprecated alias for `world` (the old single-range facility). */
  get range() {
    return this.world;
  }

  resetDrill() {
    this.drills.restart();
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
