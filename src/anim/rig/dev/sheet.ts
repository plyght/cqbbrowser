import {
  ACESFilmicToneMapping,
  AmbientLight,
  Color,
  DirectionalLight,
  HemisphereLight,
  PerspectiveCamera,
  PMREMGenerator,
  Scene,
  SRGBColorSpace,
  WebGLRenderer,
} from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

/** A contact sheet: one WebGL canvas split into tiles (viewport + scissor), labels as HTML. */
export interface Tile {
  label: string;
  /** Pose the scene for this tile (called right before rendering it). */
  pose(): void;
  camera?: PerspectiveCamera;
}

export class Sheet {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;
  private labels: HTMLDivElement;

  constructor(
    readonly cols: number,
    readonly rows: number,
    readonly tileW: number,
    readonly tileH: number,
  ) {
    const canvas = document.createElement('canvas');
    canvas.width = cols * tileW;
    canvas.height = rows * tileH;
    canvas.style.cssText = `position:absolute;left:0;top:0;width:${cols * tileW}px;height:${rows * tileH}px`;
    document.body.appendChild(canvas);
    this.labels = document.createElement('div');
    this.labels.style.cssText = 'position:absolute;left:0;top:0;pointer-events:none';
    document.body.appendChild(this.labels);
    this.renderer = new WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(cols * tileW, rows * tileH, false);
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.autoClear = false;
    this.renderer.setScissorTest(true);
    const pmrem = new PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.55;
    this.scene.background = new Color(0x3a3d40);
    this.scene.add(new HemisphereLight(0xdfe6ee, 0x3a342c, 0.8));
    this.scene.add(new AmbientLight(0xffffff, 0.15));
    const sun = new DirectionalLight(0xfff1dd, 2.2);
    sun.position.set(-1.5, 3, 1.2);
    this.scene.add(sun);
    this.camera = new PerspectiveCamera(60, tileW / tileH, 0.01, 50);
    this.scene.add(this.camera);
  }

  render(tiles: Tile[]) {
    const r = this.renderer;
    r.setScissorTest(false);
    r.setClearColor(0x15171a);
    r.clear();
    r.setScissorTest(true);
    this.labels.innerHTML = '';
    const H = this.rows * this.tileH;
    tiles.forEach((tile, i) => {
      const cx = i % this.cols;
      const cy = Math.floor(i / this.cols);
      if (cy >= this.rows) return;
      const x = cx * this.tileW;
      const y = H - (cy + 1) * this.tileH;
      tile.pose();
      this.scene.updateMatrixWorld(true);
      r.setViewport(x + 1, y + 1, this.tileW - 2, this.tileH - 2);
      r.setScissor(x + 1, y + 1, this.tileW - 2, this.tileH - 2);
      const cam = tile.camera ?? this.camera;
      cam.aspect = this.tileW / this.tileH;
      cam.updateProjectionMatrix();
      r.render(this.scene, cam);
      const l = document.createElement('div');
      l.textContent = tile.label;
      l.style.cssText = `position:absolute;left:${cx * this.tileW + 6}px;top:${cy * this.tileH + 4}px;font:12px monospace;color:#fff;text-shadow:0 0 3px #000,0 0 2px #000`;
      this.labels.appendChild(l);
    });
  }
}
