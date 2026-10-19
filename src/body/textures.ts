import { CanvasTexture, LinearSRGBColorSpace, RepeatWrapping, SRGBColorSpace, type Texture } from 'three';

/**
 * Generated fabric textures for the first-person rig (no external assets).
 * Atlas layout (1024×512): u 0..0.5 = combat-shirt sleeve (multicam-like camo on ripstop, tiles in v),
 * u 0.5..1 = neutral glove synthetic / suede weave (tinted by vertex colour).
 */
const W = 1024,
  H = 512;

function hash(x: number, y: number, s: number) {
  const v = Math.sin(x * 127.1 + y * 311.7 + s * 74.7) * 43758.5453;
  return v - Math.floor(v);
}

/** Tileable value noise on a period-p lattice. */
function tnoise(x: number, y: number, p: number, s: number) {
  const xi = Math.floor(x),
    yi = Math.floor(y);
  const fx = x - xi,
    fy = y - yi;
  const u = fx * fx * (3 - 2 * fx),
    v = fy * fy * (3 - 2 * fy);
  const h = (i: number, j: number) => hash(((i % p) + p) % p, ((j % p) + p) % p, s);
  return (
    h(xi, yi) * (1 - u) * (1 - v) +
    h(xi + 1, yi) * u * (1 - v) +
    h(xi, yi + 1) * (1 - u) * v +
    h(xi + 1, yi + 1) * u * v
  );
}

function fbm(x: number, y: number, p: number, s: number) {
  return (
    tnoise(x, y, p, s) * 0.55 +
    tnoise(x * 2, y * 2, p * 2, s + 1) * 0.3 +
    tnoise(x * 4, y * 4, p * 4, s + 2) * 0.15
  );
}

const CAMO: [number, number, number][] = [
  [128, 116, 88], // tan base
  [92, 94, 66], // olive
  [148, 136, 104], // light
  [74, 60, 44], // brown
  [42, 38, 30], // dark branch
];

let cache: { map: Texture; normal: Texture; rough: Texture } | null = null;

export function rigTextures() {
  if (cache) return cache;
  const height = new Float32Array(W * H);
  const color = document.createElement('canvas');
  color.width = W;
  color.height = H;
  const cx = color.getContext('2d')!;
  const img = cx.createImageData(W, H);
  const half = W / 2;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      let r: number, g: number, b: number, h: number;
      if (x < half) {
        // Sleeve: camo blobs (tileable over the 512×512 cell), ripstop grid, twill weave.
        const u = (x / half) * 3,
          v = (y / H) * 3;
        const n = fbm(u, v, 3, 3);
        const n2 = fbm(u * 2 + 9, v * 2, 6, 8);
        let c = CAMO[0];
        if (n > 0.62) c = CAMO[3];
        else if (n < 0.36) c = CAMO[1];
        else if (n2 > 0.66) c = CAMO[2];
        if (n2 < 0.22 && n > 0.45) c = CAMO[4];
        const rip = x % 16 === 0 || y % 16 === 0 ? 0.95 : 1;
        const k = rip * (0.95 + hash(x, y, 1) * 0.06);
        r = c[0] * k;
        g = c[1] * k;
        b = c[2] * k;
        h = (rip < 1 ? 0.6 : 0.45) + hash(x, y, 2) * 0.05 + fbm(u * 6, v * 6, 24, 9) * 0.25;
      } else {
        // Glove: fine synthetic knit (back) / suede noise; neutral so vertex colour does the tint.
        const xx = x - half;
        const knit = 0.5 + 0.5 * Math.sin(xx * 1.9) * Math.sin(y * 1.9);
        const grain = fbm(xx / 24, y / 24, 22, 5);
        const k = 0.82 + knit * 0.08 + grain * 0.12 + hash(x, y, 4) * 0.05;
        r = g = b = 255 * Math.min(1, k);
        h = knit * 0.35 + grain * 0.5 + hash(x, y, 6) * 0.1;
      }
      img.data[i * 4] = r;
      img.data[i * 4 + 1] = g;
      img.data[i * 4 + 2] = b;
      img.data[i * 4 + 3] = 255;
      height[i] = h;
    }
  cx.putImageData(img, 0, 0);

  // Height → tangent-space normal map (Sobel), and roughness.
  const nc = document.createElement('canvas');
  nc.width = W;
  nc.height = H;
  const nx = nc.getContext('2d')!;
  const nimg = nx.createImageData(W, H);
  const rc = document.createElement('canvas');
  rc.width = W;
  rc.height = H;
  const rx = rc.getContext('2d')!;
  const rimg = rx.createImageData(W, H);
  const at = (x: number, y: number) => height[((y + H) % H) * W + Math.min(W - 1, Math.max(0, x))];
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const s = x < half ? 2.2 : 1.6;
      const dx = (at(x + 1, y) - at(x - 1, y)) * s;
      const dy = (at(x, y + 1) - at(x, y - 1)) * s;
      const l = Math.hypot(dx, dy, 1);
      const i = (y * W + x) * 4;
      nimg.data[i] = ((-dx / l) * 0.5 + 0.5) * 255;
      nimg.data[i + 1] = ((dy / l) * 0.5 + 0.5) * 255;
      nimg.data[i + 2] = ((1 / l) * 0.5 + 0.5) * 255;
      nimg.data[i + 3] = 255;
      const rough = x < half ? 0.92 - at(x, y) * 0.08 : 0.78 - at(x, y) * 0.12;
      rimg.data[i] = rimg.data[i + 1] = rimg.data[i + 2] = rough * 255;
      rimg.data[i + 3] = 255;
    }
  nx.putImageData(nimg, 0, 0);
  rx.putImageData(rimg, 0, 0);

  const mk = (c: HTMLCanvasElement, srgb: boolean) => {
    const t = new CanvasTexture(c);
    t.wrapT = RepeatWrapping;
    t.colorSpace = srgb ? SRGBColorSpace : LinearSRGBColorSpace;
    t.anisotropy = 4;
    return t;
  };
  cache = { map: mk(color, true), normal: mk(nc, false), rough: mk(rc, false) };
  return cache;
}
