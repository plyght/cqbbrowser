import { CanvasTexture, MeshStandardMaterial, RepeatWrapping, SRGBColorSpace } from 'three';

/** Procedural canvas textures until the asset pipeline lands real CC0 PBR sets. */
function noiseTex(base: string, speck: string, n = 2200, size = 256, repeat = 8) {
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
  const t = new CanvasTexture(c);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.colorSpace = SRGBColorSpace;
  return t;
}

export function makeMaterials() {
  return {
    gravel: new MeshStandardMaterial({ map: noiseTex('#77736a', '#2b2a27', 6000, 256, 40), roughness: 0.95 }),
    concrete: new MeshStandardMaterial({ map: noiseTex('#8d8c88', '#55534f', 3000, 256, 6), roughness: 0.9 }),
    berm: new MeshStandardMaterial({ map: noiseTex('#6b5a43', '#3a2f22', 5000, 256, 10), roughness: 1 }),
    plywood: new MeshStandardMaterial({ map: noiseTex('#b89565', '#7a5a35', 1500, 256, 2), roughness: 0.85 }),
    steel: new MeshStandardMaterial({ color: 0xe8e2d4, roughness: 0.55, metalness: 0.2 }),
    steelPost: new MeshStandardMaterial({ color: 0x2c2d2f, roughness: 0.6, metalness: 0.6 }),
    paper: new MeshStandardMaterial({ color: 0xc8b48a, roughness: 0.95 }),
    woodStand: new MeshStandardMaterial({ color: 0x6d5537, roughness: 0.9 }),
  };
}
export type Materials = ReturnType<typeof makeMaterials>;
