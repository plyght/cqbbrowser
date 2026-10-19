import {
  BufferAttribute,
  CanvasTexture,
  Matrix4,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  SRGBColorSpace,
  Vector3,
  Euler,
} from 'three';
import type { StaticBatch } from './geo';

export interface SignSpec {
  lines: string[];
  bg?: string;
  fg?: string;
  /** Pixel size in the atlas. */
  px?: [number, number];
  border?: string;
  font?: string;
  /** Optional custom painter instead of text. */
  draw?: (g: CanvasRenderingContext2D, w: number, h: number) => void;
}

/**
 * All range signage (distance markers, bay numbers, rules boards, stage names, flags) is drawn into
 * one canvas atlas so every sign in a facility merges into a single draw call.
 */
export class SignAtlas {
  readonly canvas = document.createElement('canvas');
  readonly material: MeshStandardMaterial;
  private x = 0;
  private y = 0;
  private rowH = 0;
  static readonly SIZE = 1024;

  constructor() {
    this.canvas.width = this.canvas.height = SignAtlas.SIZE;
    const tex = new CanvasTexture(this.canvas);
    tex.colorSpace = SRGBColorSpace;
    tex.anisotropy = 4;
    this.material = new MeshStandardMaterial({ map: tex, roughness: 0.75 });
  }

  /** Draw a sign and return its UV rect [u0, v0, u1, v1]. */
  draw(spec: SignSpec): [number, number, number, number] {
    const [w, h] = spec.px ?? [256, 128];
    if (this.x + w > SignAtlas.SIZE) {
      this.x = 0;
      this.y += this.rowH + 2;
      this.rowH = 0;
    }
    const x = this.x,
      y = this.y;
    this.x += w + 2;
    this.rowH = Math.max(this.rowH, h);
    const g = this.canvas.getContext('2d')!;
    g.save();
    g.translate(x, y);
    g.fillStyle = spec.bg ?? '#f2f0e8';
    g.fillRect(0, 0, w, h);
    if (spec.draw) spec.draw(g, w, h);
    else {
      if (spec.border) {
        g.strokeStyle = spec.border;
        g.lineWidth = Math.max(4, h * 0.05);
        g.strokeRect(g.lineWidth / 2 + 3, g.lineWidth / 2 + 3, w - g.lineWidth - 6, h - g.lineWidth - 6);
      }
      g.fillStyle = spec.fg ?? '#151515';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      const n = spec.lines.length;
      const lh = (h * 0.8) / n;
      for (let i = 0; i < n; i++) {
        let size = Math.floor(lh * (i === 0 ? 0.82 : 0.62));
        g.font = `${spec.font ?? 'bold'} ${size}px "Arial Narrow", Arial, sans-serif`;
        while (g.measureText(spec.lines[i]).width > w * 0.9 && size > 8) {
          size -= 2;
          g.font = `${spec.font ?? 'bold'} ${size}px "Arial Narrow", Arial, sans-serif`;
        }
        g.fillText(spec.lines[i], w / 2, h * 0.1 + lh * (i + 0.5));
      }
    }
    g.restore();
    (this.material.map as CanvasTexture).needsUpdate = true;
    const S = SignAtlas.SIZE;
    return [x / S, 1 - (y + h) / S, (x + w) / S, 1 - y / S];
  }

  /** Add a sign face (w x h metres, centred at pos, facing +z rotated by yaw) to a batch. */
  place(
    batch: StaticBatch,
    spec: SignSpec,
    pos: Vector3,
    w: number,
    h: number,
    yaw = 0,
    doubleSided = false,
  ) {
    const r = this.draw(spec);
    const faces = doubleSided ? [0, Math.PI] : [0];
    for (const extra of faces) {
      const g = new PlaneGeometry(w, h);
      const uv = g.getAttribute('uv') as BufferAttribute;
      for (let i = 0; i < uv.count; i++) {
        const u = uv.getX(i),
          v = uv.getY(i);
        uv.setXY(i, r[0] + u * (r[2] - r[0]), r[1] + v * (r[3] - r[1]));
      }
      const m = new Matrix4().compose(
        pos,
        new Quaternion().setFromEuler(new Euler(0, yaw + extra, 0)),
        new Vector3(1, 1, 1),
      );
      batch.add(g, this.material, m);
    }
  }
}
