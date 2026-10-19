import {
  EffectComposer,
  EffectPass,
  RenderPass,
  BloomEffect,
  ToneMappingEffect,
  ToneMappingMode,
} from 'postprocessing';
import { HalfFloatType, PCFShadowMap, PerspectiveCamera, Scene, SRGBColorSpace, WebGLRenderer } from 'three';
import { BodycamEffect } from './post/BodycamEffect';

export class Renderer {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;
  readonly composer: EffectComposer;
  readonly bodycam = new BodycamEffect();
  /** 0.5..1 render resolution scale. */
  resolutionScale = 1;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new WebGLRenderer({
      canvas,
      antialias: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: true,
    });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFShadowMap;
    // Chest cams are wide; the barrel pass then warps it into the fisheye look.
    this.camera = new PerspectiveCamera(92, 16 / 9, 0.03, 600);
    this.composer = new EffectComposer(this.renderer, { frameBufferType: HalfFloatType });
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    const bloom = new BloomEffect({ intensity: 0.6, luminanceThreshold: 0.85, mipmapBlur: true });
    const tone = new ToneMappingEffect({ mode: ToneMappingMode.AGX });
    this.composer.addPass(new EffectPass(this.camera, bloom, tone));
    this.composer.addPass(new EffectPass(this.camera, this.bodycam));
    addEventListener('resize', () => this.resize());
    this.resize();
  }

  resize() {
    const w = innerWidth,
      h = innerHeight;
    const dpr = Math.min(devicePixelRatio, 2) * this.resolutionScale;
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  render(dt: number) {
    this.composer.render(dt);
  }
}
