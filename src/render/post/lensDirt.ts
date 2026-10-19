import { CanvasTexture, LinearFilter, NoColorSpace } from 'three';
import { rng } from '../../core/math';

/**
 * Procedural lens dirt: soft smudges, a fingerprint-ish swirl, a wipe streak and dust specks.
 * White-on-black intensity map; the post shader lights it with the blurred scene so it only shows
 * against bright areas (sun, windows, muzzle flash) — like real dirty lens glass.
 */
export function makeLensDirt(seed = 4127): CanvasTexture {
  const W = 512,
    H = 288;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  const r = rng(seed);
  g.fillStyle = '#000';
  g.fillRect(0, 0, W, H);
  g.globalCompositeOperation = 'lighter';

  const blob = (x: number, y: number, rad: number, a: number) => {
    const grd = g.createRadialGradient(x, y, 0, x, y, rad);
    grd.addColorStop(0, `rgba(255,255,255,${a})`);
    grd.addColorStop(0.6, `rgba(255,255,255,${a * 0.35})`);
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.beginPath();
    g.arc(x, y, rad, 0, Math.PI * 2);
    g.fill();
  };

  // Big smudges, biased to the edges (where a wiping thumb never quite reaches).
  for (let i = 0; i < 14; i++) {
    const edge = r() < 0.7;
    const x = edge ? (r() < 0.5 ? r() * 0.25 : 0.75 + r() * 0.25) * W : r() * W;
    const y = r() * H;
    blob(x, y, 30 + r() * 80, 0.05 + r() * 0.08);
  }
  // Fingerprint swirl: concentric broken arcs.
  {
    const cx = W * (0.62 + r() * 0.2),
      cy = H * (0.18 + r() * 0.25);
    g.strokeStyle = 'rgba(255,255,255,0.05)';
    g.lineWidth = 1.6;
    for (let k = 0; k < 16; k++) {
      const rad = 6 + k * 3.2;
      const a0 = r() * Math.PI * 2;
      g.beginPath();
      g.ellipse(cx, cy, rad * 1.3, rad, 0.5, a0, a0 + Math.PI * (1.1 + r() * 0.8));
      g.stroke();
    }
  }
  // Wipe streak.
  g.strokeStyle = 'rgba(255,255,255,0.045)';
  g.lineCap = 'round';
  for (let k = 0; k < 7; k++) {
    g.lineWidth = 6 + r() * 10;
    g.beginPath();
    const y0 = H * (0.55 + r() * 0.3);
    g.moveTo(W * 0.05, y0);
    g.quadraticCurveTo(W * 0.4, y0 - 40 - r() * 30, W * (0.55 + r() * 0.1), y0 - 10 + r() * 20);
    g.stroke();
  }
  // Dust specks (sharp-ish, on the glass).
  for (let i = 0; i < 90; i++) {
    const x = r() * W,
      y = r() * H;
    blob(x, y, 1 + r() * 3.5, 0.25 + r() * 0.45);
  }
  // Water spot rings.
  for (let i = 0; i < 6; i++) {
    const x = r() * W,
      y = r() * H,
      rad = 5 + r() * 9;
    g.strokeStyle = 'rgba(255,255,255,0.12)';
    g.lineWidth = 1.2;
    g.beginPath();
    g.arc(x, y, rad, 0, Math.PI * 2);
    g.stroke();
    blob(x, y, rad, 0.04);
  }

  const t = new CanvasTexture(c);
  t.colorSpace = NoColorSpace;
  t.minFilter = LinearFilter;
  t.generateMipmaps = false;
  return t;
}
