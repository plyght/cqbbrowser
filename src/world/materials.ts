import {
  CanvasTexture,
  DoubleSide,
  LoadingManager,
  MeshStandardMaterial,
  RepeatWrapping,
  SRGBColorSpace,
  TextureLoader,
  Vector2,
  type Texture,
} from 'three';

/**
 * Shared facility materials. Geometry UVs are authored in metres (see `geo.ts`), so each texture's
 * `repeat` is 1 / tile size in metres. CC0 PBR sets live in public/assets/textures (Poly Haven, see
 * assets/ATTRIBUTION.md); a procedural canvas stands in until (or if) the image loads.
 */
const BASE = `${import.meta.env?.BASE_URL ?? '/'}assets/textures/`;

function noiseCanvas(base: string, speck: string, n = 2200, size = 128) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  g.fillStyle = base;
  g.fillRect(0, 0, size, size);
  for (let i = 0; i < n; i++) {
    g.fillStyle = speck;
    g.globalAlpha = Math.random() * 0.25;
    const s = Math.random() * 3 + 0.5;
    g.fillRect(Math.random() * size, Math.random() * size, s, s);
  }
  return c;
}

function canvasTex(c: HTMLCanvasElement, tileU: number, tileV = tileU, srgb = true) {
  const t = new CanvasTexture(c);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.repeat.set(1 / tileU, 1 / tileV);
  t.anisotropy = 4;
  if (srgb) t.colorSpace = SRGBColorSpace;
  return t;
}

export function makeMaterials() {
  const manager = new LoadingManager();
  let resolveReady!: () => void;
  const ready = new Promise<void>((r) => (resolveReady = r));
  let pending = 0;
  const done = () => {
    if (--pending === 0) resolveReady();
  };
  const loader = new TextureLoader(manager);

  /** PBR material from public/assets/textures/<name>_{diff,nor}.webp with a procedural fallback. */
  const pbr = (
    name: string,
    tile: number,
    fallback: [string, string],
    opts: { roughness?: number; color?: number; normalScale?: number } = {},
  ) => {
    const mat = new MeshStandardMaterial({
      map: canvasTex(noiseCanvas(fallback[0], fallback[1]), tile),
      roughness: opts.roughness ?? 0.95,
      color: opts.color ?? 0xffffff,
    });
    const load = (file: string, srgb: boolean, apply: (t: Texture) => void) => {
      pending++;
      loader.load(
        BASE + file,
        (t) => {
          t.wrapS = t.wrapT = RepeatWrapping;
          t.repeat.set(1 / tile, 1 / tile);
          t.anisotropy = 4;
          if (srgb) t.colorSpace = SRGBColorSpace;
          apply(t);
          mat.needsUpdate = true;
          done();
        },
        undefined,
        () => done(),
      );
    };
    load(`${name}_diff.webp`, true, (t) => (mat.map = t));
    load(`${name}_nor.webp`, false, (t) => {
      mat.normalMap = t;
      mat.normalScale = new Vector2(opts.normalScale ?? 1, opts.normalScale ?? 1);
    });
    return mat;
  };

  // Plywood: compose a 4x8 sheet (1.22 x 2.44 m) from the photo + seams and screw lines on 16" studs.
  const plyCanvas = document.createElement('canvas');
  plyCanvas.width = 256;
  plyCanvas.height = 512;
  const drawSheet = (img?: CanvasImageSource) => {
    const g = plyCanvas.getContext('2d')!;
    const W = plyCanvas.width,
      H = plyCanvas.height;
    if (img) g.drawImage(img, 0, 0, W, H);
    else g.drawImage(noiseCanvas('#b89565', '#7a5a35', 900), 0, 0, W, H);
    g.fillStyle = 'rgba(40,25,10,0.55)';
    g.fillRect(0, 0, W, 2);
    g.fillRect(0, 0, 2, H);
    g.fillStyle = 'rgba(255,240,210,0.18)';
    g.fillRect(2, 2, W - 2, 1);
    // Screws every ~30 cm along studs at 0, 40.6, 81.2 cm.
    g.fillStyle = 'rgba(30,30,30,0.7)';
    for (const sx of [0.015, 0.333, 0.666]) {
      for (let y = 0.04; y < 1; y += 0.125) g.fillRect(sx * W, y * H, 2, 2);
    }
  };
  drawSheet();
  const plyTex = canvasTex(plyCanvas, 1.22, 2.44);
  const plywood = new MeshStandardMaterial({ map: plyTex, roughness: 0.86 });
  pending++;
  loader.load(
    BASE + 'plywood_diff.webp',
    (t) => {
      drawSheet(t.image as CanvasImageSource);
      plyTex.needsUpdate = true;
      done();
    },
    undefined,
    () => done(),
  );

  // 2x4 lumber: plywood grain tinted lighter/yellower, small tile.
  const lumber = new MeshStandardMaterial({ map: plyTex, color: 0xe6cfa6, roughness: 0.8 });

  const mats = {
    ground: pbr('grass', 5, ['#7b6a45', '#3d3328'], { normalScale: 0.8 }),
    gravel: pbr('gravel', 2.5, ['#77736a', '#2b2a27'], { color: 0xb9b4aa }),
    concrete: pbr('concrete_pad', 3, ['#8d8c88', '#55534f'], { roughness: 0.9 }),
    concreteDusty: pbr('concrete_dusty', 3, ['#8a857c', '#55534f'], { roughness: 0.92 }),
    berm: pbr('berm_dirt', 4, ['#6b5a43', '#3a2f22'], { roughness: 1, normalScale: 1.4 }),
    plywood,
    lumber,
    steelPost: new MeshStandardMaterial({ color: 0x2c2d2f, roughness: 0.6, metalness: 0.6 }),
    galvanized: new MeshStandardMaterial({ color: 0x9aa0a4, roughness: 0.45, metalness: 0.7 }),
    paintYellow: new MeshStandardMaterial({ color: 0xd8b21c, roughness: 0.8 }),
    paintWhite: new MeshStandardMaterial({ color: 0xe9e7e0, roughness: 0.85 }),
    paper: new MeshStandardMaterial({ color: 0xc8b48a, roughness: 0.95 }),
    woodStand: new MeshStandardMaterial({ color: 0x8a6c45, roughness: 0.9 }),
    door: new MeshStandardMaterial({ vertexColors: true, roughness: 0.7 }),
    flag: new MeshStandardMaterial({ color: 0xc0201a, roughness: 0.9, side: DoubleSide }),
    rubber: new MeshStandardMaterial({ color: 0x1d1d1d, roughness: 0.95 }),
    /** Legacy alias used by older target code. */
    steel: new MeshStandardMaterial({ color: 0xe8e2d4, roughness: 0.55, metalness: 0.2 }),
  };
  // If nothing was queued (e.g. all fallbacks), resolve immediately.
  if (pending === 0) resolveReady();
  return Object.assign(mats, { ready, manager });
}
export type Materials = ReturnType<typeof makeMaterials>;
