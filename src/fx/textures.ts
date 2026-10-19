import { CanvasTexture, LinearFilter, LinearMipmapLinearFilter, SRGBColorSpace } from 'three';
import { rng } from '../core/math';

/**
 * Generated FX textures (no external assets).
 * Particle atlas: 4×4 cells of 128 px.
 *   0–3  muzzle flash petals/plumes (additive)    4–7  soft smoke/dust puffs
 *   8    spark/glow dot                            9    splinter   10 chunk/chip   11 paint flake
 *   12   paint splash                              13   dirt clod spray
 */
export const ATLAS = {
  flash: 0,
  puff: 4,
  spark: 8,
  splinter: 9,
  chunk: 10,
  flake: 11,
  splash: 12,
  clods: 13,
};
const CELL = 128;

function cell(g: CanvasRenderingContext2D, i: number, draw: (cx: number, cy: number, s: number) => void) {
  const x = (i % 4) * CELL,
    y = Math.floor(i / 4) * CELL;
  g.save();
  g.beginPath();
  g.rect(x, y, CELL, CELL);
  g.clip();
  draw(x + CELL / 2, y + CELL / 2, CELL / 2);
  g.restore();
}

function radial(g: CanvasRenderingContext2D, cx: number, cy: number, r: number, stops: [number, string][]) {
  const grd = g.createRadialGradient(cx, cy, 0, cx, cy, r);
  for (const [o, c] of stops) grd.addColorStop(o, c);
  g.fillStyle = grd;
  g.beginPath();
  g.arc(cx, cy, r, 0, Math.PI * 2);
  g.fill();
}

export function makeParticleAtlas(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = CELL * 4;
  const g = c.getContext('2d')!;
  const r = rng(91);
  g.clearRect(0, 0, c.width, c.height);

  // Muzzle flash: 4 variants of a hot core with irregular petals (seen mostly side-on from the chest).
  for (let v = 0; v < 4; v++) {
    cell(g, ATLAS.flash + v, (cx, cy, s) => {
      g.globalCompositeOperation = 'lighter';
      const petals = 4 + Math.floor(r() * 3);
      const a0 = r() * Math.PI;
      for (let k = 0; k < petals; k++) {
        const a = a0 + (k / petals) * Math.PI * 2 + (r() - 0.5) * 0.5;
        const len = s * (0.45 + r() * 0.5);
        const wid = s * (0.08 + r() * 0.1);
        g.save();
        g.translate(cx, cy);
        g.rotate(a);
        const grd = g.createLinearGradient(0, 0, len, 0);
        grd.addColorStop(0, 'rgba(255,240,200,0.9)');
        grd.addColorStop(0.5, 'rgba(255,170,70,0.45)');
        grd.addColorStop(1, 'rgba(255,90,20,0)');
        g.fillStyle = grd;
        g.beginPath();
        g.moveTo(0, -wid);
        g.quadraticCurveTo(len * 0.6, -wid * 0.9, len, 0);
        g.quadraticCurveTo(len * 0.6, wid * 0.9, 0, wid);
        g.fill();
        g.restore();
      }
      radial(g, cx, cy, s * 0.42, [
        [0, 'rgba(255,255,240,1)'],
        [0.35, 'rgba(255,220,150,0.8)'],
        [1, 'rgba(255,120,40,0)'],
      ]);
      // Sparkly grains.
      for (let k = 0; k < 30; k++) {
        const a = r() * Math.PI * 2,
          d = r() * s * 0.8;
        g.fillStyle = `rgba(255,${180 + r() * 60},120,${0.3 + r() * 0.4})`;
        g.fillRect(cx + Math.cos(a) * d, cy + Math.sin(a) * d, 1.5, 1.5);
      }
    });
  }

  // Puffs: lumpy soft blobs (alpha = density, colour applied per particle).
  for (let v = 0; v < 4; v++) {
    cell(g, ATLAS.puff + v, (cx, cy, s) => {
      g.globalCompositeOperation = 'source-over';
      for (let k = 0; k < 16; k++) {
        const a = r() * Math.PI * 2,
          d = r() * s * 0.35;
        const rr = s * (0.25 + r() * 0.3);
        radial(g, cx + Math.cos(a) * d, cy + Math.sin(a) * d, rr, [
          [0, 'rgba(255,255,255,0.22)'],
          [1, 'rgba(255,255,255,0)'],
        ]);
      }
    });
  }

  cell(g, ATLAS.spark, (cx, cy, s) => {
    radial(g, cx, cy, s * 0.9, [
      [0, 'rgba(255,255,255,1)'],
      [0.2, 'rgba(255,255,255,0.8)'],
      [0.5, 'rgba(255,255,255,0.15)'],
      [1, 'rgba(255,255,255,0)'],
    ]);
  });

  cell(g, ATLAS.splinter, (cx, cy, s) => {
    g.fillStyle = '#fff';
    g.beginPath();
    g.moveTo(cx - s * 0.8, cy - s * 0.05);
    g.lineTo(cx + s * 0.75, cy - s * 0.12);
    g.lineTo(cx + s * 0.9, cy);
    g.lineTo(cx + s * 0.6, cy + s * 0.1);
    g.lineTo(cx - s * 0.7, cy + s * 0.12);
    g.closePath();
    g.fill();
  });

  const chunk = (i: number, n: number) =>
    cell(g, i, (cx, cy, s) => {
      g.fillStyle = '#fff';
      g.beginPath();
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2;
        const d = s * (0.45 + r() * 0.4);
        const x = cx + Math.cos(a) * d,
          y = cy + Math.sin(a) * d;
        if (k === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.closePath();
      g.fill();
    });
  chunk(ATLAS.chunk, 6);
  chunk(ATLAS.flake, 9);

  cell(g, ATLAS.splash, (cx, cy, s) => {
    radial(g, cx, cy, s * 0.45, [
      [0, 'rgba(255,255,255,0.9)'],
      [1, 'rgba(255,255,255,0)'],
    ]);
    for (let k = 0; k < 22; k++) {
      const a = r() * Math.PI * 2,
        d = s * (0.3 + r() * 0.6);
      radial(g, cx + Math.cos(a) * d, cy + Math.sin(a) * d, s * (0.04 + r() * 0.08), [
        [0, 'rgba(255,255,255,0.9)'],
        [1, 'rgba(255,255,255,0)'],
      ]);
    }
  });

  cell(g, ATLAS.clods, (cx, cy, s) => {
    for (let k = 0; k < 40; k++) {
      const a = -Math.PI / 2 + (r() - 0.5) * 1.6,
        d = r() * s * 0.85;
      g.fillStyle = `rgba(255,255,255,${0.5 + r() * 0.5})`;
      const sz = 2 + r() * 6;
      g.fillRect(cx + Math.cos(a) * d, cy + s * 0.6 + Math.sin(a) * d, sz, sz);
    }
  });

  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.minFilter = LinearMipmapLinearFilter;
  t.magFilter = LinearFilter;
  return t;
}

/**
 * Bullet-hole decal atlas (2×2 of 128 px, RGBA): 0 concrete chip, 1 wood hole, 2 dirt pock, 3 metal scuff.
 */
export function makeDecalAtlas(): CanvasTexture {
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S * 2;
  const g = c.getContext('2d')!;
  const r = rng(7);
  const at = (i: number, fn: (cx: number, cy: number, s: number) => void) => {
    g.save();
    g.beginPath();
    g.rect((i % 2) * S, Math.floor(i / 2) * S, S, S);
    g.clip();
    fn((i % 2) * S + S / 2, Math.floor(i / 2) * S + S / 2, S / 2);
    g.restore();
  };
  const blotch = (cx: number, cy: number, rad: number, n: number, col: string, jitter = 0.35) => {
    g.fillStyle = col;
    g.beginPath();
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      const d = rad * (1 - jitter + r() * jitter * 2);
      const x = cx + Math.cos(a) * d,
        y = cy + Math.sin(a) * d;
      if (k === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.closePath();
    g.fill();
  };
  // Concrete: pale spall ring, grey chip, dark core.
  at(0, (cx, cy, s) => {
    blotch(cx, cy, s * 0.85, 22, 'rgba(200,196,188,0.55)', 0.4);
    blotch(cx, cy, s * 0.55, 16, 'rgba(120,116,110,0.85)', 0.35);
    blotch(cx, cy, s * 0.22, 10, 'rgba(25,23,22,1)', 0.25);
    for (let k = 0; k < 7; k++) {
      g.strokeStyle = 'rgba(70,66,62,0.6)';
      g.lineWidth = 1.2;
      const a = r() * Math.PI * 2;
      g.beginPath();
      g.moveTo(cx + Math.cos(a) * s * 0.3, cy + Math.sin(a) * s * 0.3);
      g.lineTo(cx + Math.cos(a) * s * (0.6 + r() * 0.3), cy + Math.sin(a) * s * (0.6 + r() * 0.3));
      g.stroke();
    }
  });
  // Wood/plywood: torn fibres, dark hole.
  at(1, (cx, cy, s) => {
    blotch(cx, cy, s * 0.6, 18, 'rgba(225,195,150,0.7)', 0.45);
    for (let k = 0; k < 14; k++) {
      g.strokeStyle = `rgba(${150 + r() * 60},${120 + r() * 40},80,0.8)`;
      g.lineWidth = 1 + r() * 2;
      const a = (r() - 0.5) * 0.6 + (r() < 0.5 ? 0 : Math.PI);
      const l = s * (0.3 + r() * 0.55);
      g.beginPath();
      g.moveTo(cx, cy + (r() - 0.5) * s * 0.2);
      g.lineTo(cx + Math.cos(a) * l, cy + Math.sin(a) * l * 0.4);
      g.stroke();
    }
    blotch(cx, cy, s * 0.2, 9, 'rgba(18,14,10,1)', 0.25);
  });
  // Dirt pock: soft dark crater with a lighter thrown rim.
  at(2, (cx, cy, s) => {
    const grd = g.createRadialGradient(cx, cy, 0, cx, cy, s * 0.9);
    grd.addColorStop(0, 'rgba(30,22,15,0.95)');
    grd.addColorStop(0.35, 'rgba(55,42,30,0.7)');
    grd.addColorStop(0.6, 'rgba(150,125,95,0.35)');
    grd.addColorStop(1, 'rgba(150,125,95,0)');
    g.fillStyle = grd;
    g.fillRect(cx - s, cy - s, s * 2, s * 2);
  });
  // Metal scuff: bright scraped ring, dark lead smear.
  at(3, (cx, cy, s) => {
    blotch(cx, cy, s * 0.55, 20, 'rgba(210,210,215,0.7)', 0.3);
    blotch(cx, cy, s * 0.3, 14, 'rgba(60,62,66,0.9)', 0.3);
  });
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

/** Weapon-light cookie: tight hotspot, soft spill, faint reflector ring (TIR optic look). */
export function makeLightCookie(): CanvasTexture {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  g.fillStyle = '#000';
  g.fillRect(0, 0, S, S);
  radial(g, S / 2, S / 2, S / 2, [
    [0, '#ffffff'],
    [0.16, '#f4f1ea'],
    [0.3, '#8a8780'],
    [0.62, '#4a4844'],
    [0.7, '#5a5853'],
    [0.76, '#2c2b29'],
    [1, '#000000'],
  ]);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}
