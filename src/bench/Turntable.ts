import {
  ACESFilmicToneMapping,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
  type Group,
} from 'three';
import { serializeBuild, validateBuild, type WeaponBuild } from '../weapons/attachments';
import { buildModelFromBuild, type WeaponModel } from '../weapons/models';
import { addBenchLights, frameObject } from './stage';

/**
 * Small embeddable weapon turntable (loadout screen): its own low-cost WebGLRenderer on a canvas, created on
 * first `start()`, rendering only while started and visible. Drag to rotate; idles with a slow sway.
 */
export class Turntable {
  /** Idle rotation on/off (tests turn it off for stable frames). */
  auto = true;
  model: WeaponModel | null = null;
  private renderer: WebGLRenderer | null = null;
  private scene = new Scene();
  private camera = new PerspectiveCamera(26, 2, 0.01, 20);
  private key = '';
  private raf = 0;
  private running = false;
  private dirty = true;
  private yaw = 2.0;
  private pitch = 0.3;
  private t = 0;
  private last = 0;
  private dragging: { x: number; y: number; yaw: number; pitch: number } | null = null;
  private idleAfter = 0;
  private center = new Vector3();
  private distance = 1;
  private ro: ResizeObserver | null = null;

  constructor(readonly canvas: HTMLCanvasElement) {
    addBenchLights(this.scene);
    canvas.addEventListener('pointerdown', (e) => {
      this.dragging = { x: e.clientX, y: e.clientY, yaw: this.yaw, pitch: this.pitch };
      canvas.setPointerCapture?.(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      this.yaw = this.dragging.yaw - (e.clientX - this.dragging.x) * 0.01;
      this.pitch = Math.max(-0.6, Math.min(1.2, this.dragging.pitch + (e.clientY - this.dragging.y) * 0.008));
      this.idleAfter = this.t + 4;
      this.dirty = true;
    });
    const end = () => (this.dragging = null);
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
  }

  private ensure() {
    if (this.renderer) return this.renderer;
    const r = new WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true,
      powerPreference: 'low-power',
    });
    r.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    r.outputColorSpace = SRGBColorSpace;
    r.toneMapping = ACESFilmicToneMapping;
    r.toneMappingExposure = 1.3;
    r.setClearColor(0x000000, 0);
    this.renderer = r;
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(this.canvas);
    this.resize();
    return r;
  }

  private resize() {
    const r = this.renderer;
    if (!r) return;
    const w = this.canvas.clientWidth || 1,
      h = this.canvas.clientHeight || 1;
    r.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.refit();
    this.dirty = true;
  }

  /** Show a build (rebuilds only when it changed). Invalid builds keep the last good model. */
  setBuild(build: WeaponBuild | null) {
    const key = build ? serializeBuild(build) : '';
    if (key === this.key) return;
    if (build && validateBuild(build).length) return;
    this.key = key;
    if (this.model) {
      this.scene.remove(this.model.root);
      this.model.dispose();
      this.model = null;
    }
    if (build) {
      this.model = buildModelFromBuild(build);
      this.scene.add(this.model.root);
    }
    this.refit();
    this.dirty = true;
  }

  /** Fixed framing per class so a longer barrel visibly grows; centred on the gun. */
  private refit() {
    const root: Group | undefined = this.model?.root;
    if (!root) return;
    const pistol = this.model!.weapon === 'p17';
    const f = frameObject(this.camera, root, 'side');
    this.center.copy(f.center);
    const len = Math.max(f.box.max.z - f.box.min.z, pistol ? 0.24 : 0.82);
    const tv = Math.tan((this.camera.fov * Math.PI) / 360);
    const tall = (f.box.max.y - f.box.min.y) * 1.3;
    this.distance = Math.max(len / 2 / (tv * this.camera.aspect), tall / 2 / tv) * 1.1;
    this.place();
  }

  private place() {
    const cp = Math.cos(this.pitch);
    this.camera.position.set(
      this.center.x + Math.sin(this.yaw) * cp * this.distance,
      this.center.y + Math.sin(this.pitch) * this.distance,
      this.center.z + Math.cos(this.yaw) * cp * this.distance,
    );
    this.camera.lookAt(this.center);
    this.camera.near = this.distance / 50;
    this.camera.far = this.distance * 10;
    this.camera.updateProjectionMatrix();
  }

  /** Reset to the default three-quarter view. */
  resetView() {
    this.yaw = 2.0;
    this.pitch = 0.3;
    this.t = 0;
    this.dirty = true;
  }

  start() {
    this.ensure();
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.loop);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  /** Draw one frame now (tests / screenshots). */
  renderNow() {
    const r = this.ensure();
    this.place();
    r.render(this.scene, this.camera);
    this.dirty = false;
  }

  private loop = (now: number) => {
    if (!this.running) return;
    // Paused when hidden (screen popped, menu closed): restarted by the screen's enter().
    if (!this.canvas.isConnected || this.canvas.offsetParent === null) {
      this.stop();
      return;
    }
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.t += dt;
    if (this.auto && !this.dragging && this.t > this.idleAfter) {
      // Slow sway between the two three-quarter views (always reads as a side profile, never end-on).
      this.yaw += dt * 0.1 * Math.cos(this.t * 0.18);
      this.dirty = true;
    }
    if (this.dirty) this.renderNow();
  };
}
