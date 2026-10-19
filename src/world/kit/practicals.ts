import {
  Color,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PointLight,
  SphereGeometry,
  SpotLight,
  Vector3,
} from 'three';
import type { StaticBatch } from '../geo';
import type { Materials } from '../materials';
import { wallAxis, type Layout, type LayoutLight } from './layout';

const BULB = new Color(1.0, 0.78, 0.52); // ~2700 K tungsten
const HALOGEN = new Color(1.0, 0.9, 0.76); // ~3200 K work light
const CORD = 0.009;

export interface Practical {
  def: LayoutLight;
  light: PointLight | SpotLight;
  glow: Mesh;
  glowMat: MeshBasicMaterial;
  base: number;
  /** Flicker state (seconds left in the current dropout / until the next one). */
  drop: number;
  next: number;
}

/**
 * Practical lights for the roofed house: bare bulbs on drop cords (stapled along a joist and down the nearest
 * wall) and a halogen work light on a tripod. Unshadowed (the interior-lighting patch occludes them against the
 * walls analytically); the lamps themselves are small HDR-bright meshes so the CAM04 bloom catches them.
 */
export function buildPracticals(
  batch: StaticBatch,
  mats: Materials,
  parent: Object3D,
  layout: Layout,
  at: (x: number, z: number) => Vector3,
): Practical[] {
  const out: Practical[] = [];
  const H = layout.wallHeight;
  const t = layout.wallThickness;
  for (const def of layout.lights ?? []) {
    const p = at(def.at[0], def.at[1]);
    if (def.kind === 'bulb') {
      const y = def.y ?? H - 0.3;
      const base = def.intensity ?? 3.2;
      const light = new PointLight(BULB, base, 11, 2);
      light.position.set(p.x, y, p.z);
      const glowMat = new MeshBasicMaterial({ color: BULB.clone().multiplyScalar(14), toneMapped: false });
      const glow = new Mesh(new SphereGeometry(0.03, 10, 8), glowMat);
      glow.position.set(p.x, y - 0.02, p.z);
      parent.add(light, glow);
      // Porcelain-ish socket + drop cord up to the joists.
      batch.box(mats.rubber, p.x, y + 0.01, p.z, 0.034, 0.05, 0.034);
      batch.box(mats.rubber, p.x, y + 0.06, p.z, CORD, H - y - 0.06, CORD);
      cordToWall(batch, mats, layout, def.at, at, H - CORD / 2 - 0.002, t);
      out.push({ def, light, glow, glowMat, base, drop: 0, next: 2 + Math.random() * 4 });
    } else {
      const y = def.y ?? 1.4;
      const base = def.intensity ?? 26;
      const aim = def.aim ? at(def.aim[0], def.aim[1]).setY(0.9) : p.clone().setY(0.9);
      const light = new SpotLight(HALOGEN, base, 16, 0.78, 0.55, 2);
      light.position.set(p.x, y, p.z);
      light.target.position.copy(aim);
      parent.add(light, light.target);
      light.target.updateMatrixWorld();
      // Tripod: centre pole + three splayed legs, yellow housing aimed at the target, hot lens.
      const yaw = Math.atan2(aim.x - p.x, aim.z - p.z);
      const dir = aim.clone().sub(light.position).normalize();
      const pitch = Math.asin(Math.max(-1, Math.min(1, -dir.y)));
      batch.box(mats.steelPost, p.x, 0.25, p.z, 0.022, y - 0.32, 0.022);
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2 + 0.4;
        const lx = p.x + Math.sin(a) * 0.17,
          lz = p.z + Math.cos(a) * 0.17;
        batch.box(mats.steelPost, lx, 0, lz, 0.018, 0.34, 0.018, { yaw: a, pitch: 0.48 });
      }
      batch.box(mats.paintYellow, p.x, y - 0.1, p.z, 0.2, 0.16, 0.1, { yaw, pitch, cast: true });
      batch.box(mats.steelPost, p.x, y - 0.18, p.z, 0.24, 0.02, 0.02, { yaw });
      const glowMat = new MeshBasicMaterial({ color: HALOGEN.clone().multiplyScalar(18), toneMapped: false });
      const lens = new Mesh(new SphereGeometry(0.06, 12, 6), glowMat);
      lens.scale.set(1.25, 0.95, 0.12);
      lens.position
        .copy(light.position)
        .addScaledVector(dir, 0.055)
        .setY(y - 0.02);
      lens.lookAt(aim);
      parent.add(lens);
      // Cord across the floor to the nearest wall.
      const wallZ = nearestWallZ(layout, def.at);
      if (wallZ !== null) {
        const wz = at(0, wallZ).z;
        const len = Math.abs(wz - p.z);
        batch.box(mats.rubber, p.x + 0.12, 0, (wz + p.z) / 2, CORD, CORD, len);
      }
      out.push({ def, light, glow: lens, glowMat, base, drop: 0, next: 1e9 });
    }
  }
  return out;
}

/** Cord stapled along the joists to the nearest x-running wall, then down it to an outlet. */
function cordToWall(
  batch: StaticBatch,
  mats: Materials,
  layout: Layout,
  xz: [number, number],
  at: (x: number, z: number) => Vector3,
  y: number,
  t: number,
) {
  const wz = nearestWallZ(layout, xz);
  if (wz === null) return;
  const side = Math.sign(xz[1] - wz) || 1;
  const face = wz + side * (t / 2 + CORD / 2);
  const a = at(xz[0], xz[1]);
  const b = at(xz[0], face);
  const len = Math.abs(b.z - a.z);
  batch.box(mats.rubber, a.x, y, (a.z + b.z) / 2, CORD, CORD, len);
  batch.box(mats.rubber, b.x, 0.32, b.z, CORD, y - 0.32, CORD);
  batch.box(mats.paintWhite, b.x, 0.26, b.z, 0.07, 0.11, 0.02);
}

function nearestWallZ(layout: Layout, xz: [number, number]): number | null {
  let best: number | null = null;
  for (const w of layout.walls) {
    if (wallAxis(w) !== 'x') continue;
    const lo = Math.min(w.a[0], w.b[0]),
      hi = Math.max(w.a[0], w.b[0]);
    if (xz[0] < lo || xz[0] > hi) continue;
    // Skip spots where an opening is on the wall right there (cord would hang in the doorway).
    const blocked = layout.openings.some(
      (o) => Math.abs(o.at[1] - w.a[1]) < 1e-3 && Math.abs(o.at[0] - xz[0]) < (o.width ?? 0.9) / 2 + 0.15,
    );
    if (blocked) continue;
    if (best === null || Math.abs(w.a[1] - xz[1]) < Math.abs(best - xz[1])) best = w.a[1];
  }
  return best;
}

/** Per-frame: flicker on the bad sockets, master on/off (roof off = daylight house, lamps off). */
export function updatePracticals(list: Practical[], dt: number, on: boolean, rand: () => number) {
  for (const p of list) {
    let k = on && p.def.on !== false ? 1 : 0;
    if (k && p.def.flicker) {
      p.next -= dt;
      if (p.drop > 0) {
        p.drop -= dt;
        k = rand() < 0.35 ? 0.55 : 0.04;
      } else if (p.next <= 0) {
        p.drop = 0.04 + rand() * 0.35;
        p.next = 0.6 + rand() * 6;
      } else k = 0.94 + rand() * 0.06;
    }
    p.light.intensity = p.base * k;
    p.glow.visible = k > 0.02;
    (p.glowMat.color as Color)
      .copy(p.def.kind === 'bulb' ? BULB : HALOGEN)
      .multiplyScalar(14 * Math.max(k, 0.1));
  }
}
