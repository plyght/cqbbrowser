import {
  BufferAttribute,
  CanvasTexture,
  ExtrudeGeometry,
  MeshStandardMaterial,
  SRGBColorSpace,
  Shape,
  type BufferGeometry,
} from 'three';
import { hashNoise } from '../geo';

export interface PaintCell {
  cx: number;
  cy: number;
}

/**
 * One canvas atlas holds the paint of every steel plate in the world, so all steel shares one
 * material. Fresh paint is off-white; each hit blasts a dark lead splash with a lighter spall ring.
 * `repaint` restores fresh paint (range reset = a new coat of paint).
 */
export class PaintAtlas {
  static readonly SIZE = 512;
  static readonly CELL = 64;
  static readonly PER_ROW = PaintAtlas.SIZE / PaintAtlas.CELL;
  readonly canvas = document.createElement('canvas');
  readonly texture: CanvasTexture;
  readonly material: MeshStandardMaterial;
  /** Reserved cell painted dark (frames, chains, arms). */
  readonly dark: PaintCell = { cx: 0, cy: 0 };
  private next = 1;
  private dirty = false;

  constructor() {
    this.canvas.width = this.canvas.height = PaintAtlas.SIZE;
    this.texture = new CanvasTexture(this.canvas);
    this.texture.colorSpace = SRGBColorSpace;
    this.material = new MeshStandardMaterial({ map: this.texture, roughness: 0.62, metalness: 0.12 });
    const g = this.ctx();
    g.fillStyle = '#2e3033';
    g.fillRect(0, 0, PaintAtlas.CELL, PaintAtlas.CELL);
  }

  private ctx() {
    return this.canvas.getContext('2d')!;
  }

  alloc(): PaintCell {
    const i = this.next++;
    const cell = { cx: i % PaintAtlas.PER_ROW, cy: Math.floor(i / PaintAtlas.PER_ROW) % PaintAtlas.PER_ROW };
    this.repaint(cell);
    return cell;
  }

  /** Cell-local (0..1, v up) → atlas UV, with a 2 px inset against bleeding. */
  uv(cell: PaintCell, lu: number, lv: number): [number, number] {
    const C = PaintAtlas.CELL,
      S = PaintAtlas.SIZE,
      m = 2 / C;
    const u = m + Math.min(1, Math.max(0, lu)) * (1 - 2 * m);
    const v = m + Math.min(1, Math.max(0, lv)) * (1 - 2 * m);
    return [((cell.cx + u) * C) / S, 1 - ((cell.cy + 1 - v) * C) / S];
  }

  private px(cell: PaintCell, lu: number, lv: number): [number, number] {
    const [u, v] = this.uv(cell, lu, lv);
    return [u * PaintAtlas.SIZE, (1 - v) * PaintAtlas.SIZE];
  }

  repaint(cell: PaintCell) {
    const g = this.ctx();
    const C = PaintAtlas.CELL;
    const x = cell.cx * C,
      y = cell.cy * C;
    g.fillStyle = '#ecebe4';
    g.fillRect(x, y, C, C);
    // Brush/roller mottling.
    for (let i = 0; i < 60; i++) {
      const r = hashNoise(i, cell.cx * 13 + cell.cy, 3);
      g.fillStyle = r > 0.5 ? 'rgba(255,255,255,0.35)' : 'rgba(170,165,150,0.12)';
      g.fillRect(x + hashNoise(i, 1, cell.cx) * C, y + hashNoise(i, 2, cell.cy) * C, 3 + r * 6, 1 + r * 2);
    }
    this.dirty = true;
  }

  /** A hit at cell-local (lu, lv); `scale` = cell pixels per metre of plate. */
  mark(cell: PaintCell, lu: number, lv: number, pxPerM: number, energy: number) {
    const g = this.ctx();
    const [cx, cy] = this.px(cell, lu, lv);
    const C = PaintAtlas.CELL;
    g.save();
    g.beginPath();
    g.rect(cell.cx * C + 1, cell.cy * C + 1, C - 2, C - 2);
    g.clip();
    const splash = Math.max(1.5, 0.045 * pxPerM * Math.min(1.4, 0.6 + energy / 1500));
    // Spall ring: paint stripped in radial streaks.
    g.strokeStyle = 'rgba(120,120,118,0.55)';
    g.lineWidth = 0.8;
    for (let i = 0; i < 9; i++) {
      const a = Math.random() * Math.PI * 2;
      const r0 = splash * 0.4,
        r1 = splash * (0.9 + Math.random() * 0.9);
      g.beginPath();
      g.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
      g.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
      g.stroke();
    }
    const grad = g.createRadialGradient(cx, cy, 0, cx, cy, splash);
    grad.addColorStop(0, 'rgba(48,49,52,0.95)');
    grad.addColorStop(0.45, 'rgba(78,79,82,0.8)');
    grad.addColorStop(1, 'rgba(120,120,120,0)');
    g.fillStyle = grad;
    g.beginPath();
    g.arc(cx, cy, splash, 0, Math.PI * 2);
    g.fill();
    g.restore();
    this.dirty = true;
  }

  flush() {
    if (!this.dirty) return;
    this.dirty = false;
    this.texture.needsUpdate = true;
  }
}

/** Extruded steel plate (front face +z, centred on thickness) with UVs mapped into an atlas cell. */
export function plateGeometry(
  shape: Shape,
  thickness: number,
  atlas: PaintAtlas,
  cell: PaintCell,
  segments = 20,
): { geo: BufferGeometry; minX: number; minY: number; w: number; h: number } {
  const geo = new ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false, curveSegments: segments });
  geo.translate(0, 0, -thickness / 2);
  geo.computeBoundingBox();
  const bb = geo.boundingBox!;
  const w = bb.max.x - bb.min.x,
    h = bb.max.y - bb.min.y;
  mapToCell(geo, atlas, cell, bb.min.x, bb.min.y, w, h);
  return { geo, minX: bb.min.x, minY: bb.min.y, w, h };
}

/** Planar-project x/y of every vertex into an atlas cell. */
export function mapToCell(
  geo: BufferGeometry,
  atlas: PaintAtlas,
  cell: PaintCell,
  minX: number,
  minY: number,
  w: number,
  h: number,
) {
  const pos = geo.getAttribute('position') as BufferAttribute;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const [u, v] = atlas.uv(cell, (pos.getX(i) - minX) / w, (pos.getY(i) - minY) / h);
    uv[i * 2] = u;
    uv[i * 2 + 1] = v;
  }
  geo.setAttribute('uv', new BufferAttribute(uv, 2));
}

/** Map every vertex to the atlas' dark cell (frames, chains, arms in the same mesh as the plate). */
export function mapDark(geo: BufferGeometry, atlas: PaintAtlas) {
  const pos = geo.getAttribute('position');
  const uv = new Float32Array(pos.count * 2);
  const [u, v] = atlas.uv(atlas.dark, 0.5, 0.5);
  for (let i = 0; i < pos.count; i++) {
    uv[i * 2] = u;
    uv[i * 2 + 1] = v;
  }
  geo.setAttribute('uv', new BufferAttribute(uv, 2));
  return geo;
}

export const shapes = {
  circle(r: number) {
    const s = new Shape();
    s.absarc(0, 0, r, 0, Math.PI * 2, false);
    return s;
  },
  rect(w: number, h: number) {
    const s = new Shape();
    s.moveTo(-w / 2, -h / 2);
    s.lineTo(w / 2, -h / 2);
    s.lineTo(w / 2, h / 2);
    s.lineTo(-w / 2, h / 2);
    s.closePath();
    return s;
  },
  /** Classic popper silhouette (origin at bottom centre): tapered body, neck, round head. */
  popper(height = 1.07, width = 0.3) {
    const s = new Shape();
    const hw = width / 2;
    const headR = width * 0.42;
    const neckY = height - headR * 2 - 0.02;
    s.moveTo(-hw * 0.55, 0);
    s.lineTo(hw * 0.55, 0);
    s.lineTo(hw, neckY * 0.75);
    s.lineTo(hw * 0.62, neckY);
    s.lineTo(hw * 0.28, neckY + 0.02);
    s.absarc(0, height - headR, headR, -Math.PI / 2 + 0.75, Math.PI * 1.5 - 0.75, false);
    s.lineTo(-hw * 0.28, neckY + 0.02);
    s.lineTo(-hw * 0.62, neckY);
    s.lineTo(-hw, neckY * 0.75);
    s.closePath();
    return s;
  },
};
