import { EffectComposer, EffectPass, RenderPass } from 'postprocessing';
import {
  HalfFloatType,
  PCFShadowMap,
  PerspectiveCamera,
  Quaternion,
  Scene,
  SRGBColorSpace,
  WebGLRenderer,
} from 'three';
import { DynamicResolution } from './DynamicResolution';
import { PerfOverlay } from './PerfOverlay';
import { BodycamEffect } from './post/BodycamEffect';
import type { LensParams } from './post/lens';
import { QUALITY, toTier, videoSettings, type QualityPreset, type QualityTier } from './quality';

/**
 * Owns the WebGL renderer, scene camera and the post chain:
 *   RenderPass (HDR, half float) → one EffectPass with the merged CAM04 effect.
 * Handles quality tiers, dynamic resolution, shadow-map update cadence and the ?perf overlay.
 */
export class Renderer {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;
  readonly composer: EffectComposer;
  readonly bodycam: BodycamEffect;
  readonly dynres = new DynamicResolution();
  quality: QualityPreset;
  tier: QualityTier;
  /** Static resolution scale (0.5..1); dynamic resolution multiplies under this. */
  resolutionScale = 1;
  private perf: PerfOverlay | null = null;
  private frameNo = 0;
  private prevQ = new Quaternion();
  private dq = new Quaternion();
  private hasPrev = false;
  /** Smoothed camera angular speed (rad/s), exposed for FX/debug. */
  angularSpeed = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new WebGLRenderer({
      canvas,
      antialias: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: true,
      stencil: false,
    });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.shadowMap.needsUpdate = true;
    this.renderer.info.autoReset = false;
    // Chest cams are wide; the CAM04 lens pass then warps and crops it into the fisheye image circle.
    this.camera = new PerspectiveCamera(92, 16 / 9, 0.03, 600);
    const v = videoSettings.get();
    this.tier = toTier(v.quality);
    this.quality = QUALITY[this.tier];
    this.resolutionScale = v.resScale;
    this.dynres.enabled = v.dynamicResolution;
    this.dynres.targetFps = v.targetFps;
    this.dynres.max = Math.min(1, this.quality.maxScale);
    this.bodycam = new BodycamEffect(this.quality);
    this.composer = new EffectComposer(this.renderer, { frameBufferType: HalfFloatType });
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.composer.addPass(new EffectPass(this.camera, this.bodycam));
    videoSettings.onChange((s) => {
      this.resolutionScale = s.resScale;
      this.dynres.enabled = s.dynamicResolution;
      this.dynres.targetFps = s.targetFps;
      if (toTier(s.quality) !== this.tier) this.setQuality(toTier(s.quality));
      this.resize();
    });
    addEventListener('resize', () => this.resize());
    this.resize();
    if (typeof location !== 'undefined' && new URLSearchParams(location.search).has('perf'))
      this.perf = new PerfOverlay();
  }

  setQuality(tier: QualityTier) {
    if (!QUALITY[tier]) return;
    this.tier = tier;
    this.quality = QUALITY[tier];
    this.bodycam.setQuality(this.quality);
    this.dynres.max = Math.min(1, this.quality.maxScale);
    this.renderer.shadowMap.needsUpdate = true;
    this.resize();
  }

  /** Effective scale = static scale × dynamic scale (bounded by the tier). */
  get effectiveScale() {
    return Math.min(this.resolutionScale, this.quality.maxScale) * this.dynres.scale;
  }

  resize() {
    const w = innerWidth,
      h = innerHeight;
    const dpr = Math.min(devicePixelRatio, this.quality.pixelRatioCap) * this.effectiveScale;
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.bodycam.setCamera(this.camera.fov, this.camera.aspect);
  }

  /**
   * Current CAM04 lens values plus output aspect. Use with `distortPoint(uv, aspect, lens)` from
   * render/post/lens.ts to place HUD elements on the distorted image.
   */
  lensParams(): LensParams & { aspect: number } {
    return { ...this.bodycam.lens, aspect: this.camera.aspect };
  }

  /** ADS blend (0..1): the weapon narrows FOV itself; the lens eases distortion and near defocus. */
  setAds(k: number) {
    this.bodycam.ads = k;
    this.bodycam.setCamera(this.camera.fov, this.camera.aspect);
  }

  /** CAM04 boot sequence (black → exposure hunt → WB settle, ~0.6 s). */
  camPowerOn() {
    this.bodycam.powerOn();
  }

  camPowerOff() {
    this.bodycam.powerOff();
  }

  /** Bright transient (muzzle flash) for the sensor model. */
  flash(strength = 1) {
    this.bodycam.flash(strength);
  }

  /** Gameplay-supplied angular speed (rad/s) for codec starvation (camera rotation is measured too). */
  setMotion(angularSpeed: number) {
    this.bodycam.setMotion(angularSpeed);
  }

  private measureCameraMotion(dt: number) {
    const q = this.camera.quaternion;
    if (!this.hasPrev || dt <= 0) {
      this.prevQ.copy(q);
      this.hasPrev = true;
      return;
    }
    // Rotation from the previous camera frame into the current one, in camera-local axes.
    this.dq.copy(this.prevQ).invert().multiply(q);
    if (this.dq.w < 0) this.dq.set(-this.dq.x, -this.dq.y, -this.dq.z, -this.dq.w);
    const s = Math.sqrt(1 - Math.min(1, this.dq.w * this.dq.w));
    const angle = 2 * Math.acos(Math.min(1, this.dq.w));
    this.prevQ.copy(q);
    // Teleports/snaps aren't motion.
    if (angle > 0.6 || s < 1e-6) {
      this.bodycam.setCameraMotion(0, 0, 0);
      this.angularSpeed = 0;
      return;
    }
    const k = angle / dt / s;
    this.bodycam.setCameraMotion(this.dq.x * k, this.dq.y * k, this.dq.z * k);
    this.angularSpeed = angle / dt;
  }

  private skipped = 0;

  /**
   * A sim frame that isn't drawn (fast test stepping). The time is carried into the next `render()` so the
   * camera's temporal state (auto-exposure, codec, boot sequence, motion) still advances by the full span.
   */
  advance(dt: number) {
    this.skipped += dt;
  }

  render(frameDt: number) {
    const dt = frameDt + this.skipped;
    this.skipped = 0;
    this.frameNo++;
    // Dynamic resolution only sees real frame times, never a catch-up span.
    if (dt === frameDt && this.dynres.update(dt)) this.resize();
    this.measureCameraMotion(dt);
    if (this.frameNo % this.quality.shadowEvery === 0) this.renderer.shadowMap.needsUpdate = true;
    this.renderer.info.reset();
    this.composer.render(dt);
    this.perf?.update(dt, this.renderer, this.effectiveScale, this.tier);
  }
}
