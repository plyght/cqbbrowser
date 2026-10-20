import { EffectComposer, EffectPass, RenderPass } from 'postprocessing';
import {
  HalfFloatType,
  type Material,
  PCFShadowMap,
  PerspectiveCamera,
  Quaternion,
  Scene,
  type ShaderMaterial,
  SRGBColorSpace,
  Texture,
  WebGLRenderer,
} from 'three';
import { DynamicResolution } from './DynamicResolution';
import { PerfOverlay } from './PerfOverlay';
import { BodycamEffect } from './post/BodycamEffect';
import type { LensParams } from './post/lens';
import { NvgEffect } from './post/nvg/NvgEffect';
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
  /** Hip FOV from settings; ADS code narrows relative to this and restores it. */
  baseFov = 92;
  readonly composer: EffectComposer;
  readonly bodycam: BodycamEffect;
  /** NVG view + flashbang white-out (src/gear drives it); its pass only runs while active. */
  readonly nvg = new NvgEffect();
  private nvgPass: EffectPass;
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
    const v = videoSettings.get();
    this.baseFov = v.fov;
    this.camera = new PerspectiveCamera(v.fov, 16 / 9, 0.03, 600);
    this.tier = toTier(v.quality);
    this.quality = QUALITY[this.tier];
    this.resolutionScale = v.resScale;
    this.dynres.enabled = v.dynamicResolution;
    this.dynres.targetFps = v.targetFps;
    this.dynres.max = Math.min(1, this.quality.maxScale);
    this.bodycam = new BodycamEffect(this.quality);
    this.bodycam.uniforms.get('uGamma')!.value = 1 / Math.max(0.5, v.gamma);
    this.composer = new EffectComposer(this.renderer, { frameBufferType: HalfFloatType });
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.nvgPass = new EffectPass(this.camera, this.nvg);
    this.nvgPass.enabled = false;
    this.composer.addPass(this.nvgPass);
    this.composer.addPass(new EffectPass(this.camera, this.bodycam));
    videoSettings.onChange((s) => {
      this.bodycam.uniforms.get('uGamma')!.value = 1 / Math.max(0.5, s.gamma);
      if (s.fov !== this.baseFov) {
        this.camera.fov += s.fov - this.baseFov;
        this.baseFov = s.fov;
        this.camera.updateProjectionMatrix();
      }
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
   * Compile every material in the scene now (pooled FX included: brass, particles, decals start hidden or
   * empty). Three compiles a program the first time an object draws, so the first shot used to compile the
   * brass and both particle shaders mid-frame (a multi-frame hitch on the first trigger pull). Compiled
   * against the composer's HDR target so the program keys match the real render (linear output).
   */
  prewarm(): Promise<void> {
    const r = this.renderer;
    const prev = r.getRenderTarget();
    r.setRenderTarget(this.composer.inputBuffer);
    let p: Promise<unknown>;
    try {
      p = r.compileAsync(this.scene, this.camera);
    } finally {
      r.setRenderTarget(prev);
    }
    // Upload textures too: pooled FX draw nothing until first use, so their atlases (512² canvases + mips)
    // were uploaded inside the first shot's frame (~100 ms on the first pistol shot).
    this.scene.traverse((o) => {
      const mats = (o as { material?: Material | Material[] }).material;
      if (!mats) return;
      for (const m of Array.isArray(mats) ? mats : [mats]) {
        for (const v of Object.values(m)) if (v instanceof Texture) r.initTexture(v);
        const u = (m as ShaderMaterial).uniforms;
        if (u) for (const k in u) if (u[k].value instanceof Texture) r.initTexture(u[k].value);
      }
    });
    return p
      .then(() => {
        // Finish linking now. Three checks a program's link status (getProgramInfoLog) on its first draw, and
        // without KHR_parallel_shader_compile that call blocks until the driver has actually built it: a pooled
        // FX program drawn first on the first trigger pull cost ~110 ms there.
        for (const prog of r.info.programs ?? []) (prog as { getUniforms?: () => unknown }).getUniforms?.();
      })
      .catch(() => undefined);
  }

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
    this.nvgPass.enabled = this.nvg.active;
    this.composer.render(dt);
    this.perf?.update(dt, this.renderer, this.effectiveScale, this.tier);
  }
}
