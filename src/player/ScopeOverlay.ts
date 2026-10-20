import {
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  RingGeometry,
  type PerspectiveCamera,
  type Scene,
} from 'three';
import type { ReticleKind } from '../weapons/attachments/types';
import { RETICLE_RED, reticleMaterial } from '../render/reticle';

/**
 * Eyepiece picture for tube optics (LPVO, magnifier). The optic models are solid, so at ADS the camera's near
 * plane is pushed past the tube and this overlay draws the ocular (scope shadow) and the reticle in front of the
 * view. A handful of draw calls, only while looking through a tube optic.
 *
 * - Scope shadow: a black ring with a soft inner edge around the exit pupil. It slides across and closes in when
 *   the eye is off the optic's axis (ADS in / out), scaled by the optic's eye box.
 * - Reticles: `duplex` (1-6x: crosshair in units of the pupil + a small illuminated dot) or `circleDot` (compact
 *   1-3x: illuminated circle-dot with thin posts). Second focal plane: the circle-dot keeps its screen size at
 *   every power, so it stays crisp at the top end.
 */
const DIST = 0.5;

/** Ring with a soft inner edge: radii (units of the pupil) and alpha at each. */
function shadowRing(): BufferGeometry {
  const radii = [1, 1.05, 1.12, 1.22, 12];
  const alpha = [0, 0.35, 0.8, 1, 1];
  const n = 72;
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    for (let j = 0; j < radii.length; j++) {
      pos.push(Math.cos(a) * radii[j], Math.sin(a) * radii[j], 0);
      col.push(0.02, 0.02, 0.02, alpha[j]);
    }
  }
  const m = radii.length;
  for (let i = 0; i < n; i++)
    for (let j = 0; j < m - 1; j++) {
      const a = i * m + j,
        b = (i + 1) * m + j;
      idx.push(a, a + 1, b, b, a + 1, b + 1); // counter-clockwise (front-facing toward the camera)
    }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new Float32BufferAttribute(col, 4));
  g.setIndex(idx);
  return g;
}

export interface EyeState {
  /** Eye box radius (m). */
  eyeBox: number;
  /** Eye offset from the optic axis in the view (m, + = right / up). */
  offset: { x: number; y: number };
}

export class ScopeOverlay {
  readonly root = new Group();
  private ring: Mesh;
  /** Duplex crosshair: scales with the pupil (the 1-6x look). */
  private duplex = new Group();
  /** Circle-dot: fixed screen size (units of the half view height). */
  private circleDot = new Group();
  private ringMat = new MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  private retMat = new MeshBasicMaterial({
    color: new Color(0.02, 0.02, 0.02),
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  // Illuminated parts: exposure-locked (a fixed HDR value bloomed into a blob in the dark / under NVG).
  private dotMat = reticleMaterial(RETICLE_RED.clone(), {
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  // Daylight-bright illumination of the compact's circle-dot.
  private litMat = reticleMaterial(RETICLE_RED.clone().multiplyScalar(1.5), {
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });

  constructor(scene: Scene) {
    this.ring = new Mesh(shadowRing(), this.ringMat);
    this.ring.renderOrder = 1001;
    this.root.add(this.ring);
    const bar = (g: Group, w: number, h: number, x: number, y: number) => {
      const m = new Mesh(new PlaneGeometry(w, h), this.retMat);
      m.position.set(x, y, 0);
      m.renderOrder = 1002;
      g.add(m);
    };
    // Duplex-ish crosshair (thick outer posts, thin centre) + illuminated dot; units of the ring radius.
    bar(this.duplex, 0.006, 0.7, 0, 0.6);
    bar(this.duplex, 0.006, 0.7, 0, -0.6);
    bar(this.duplex, 0.7, 0.006, 0.6, 0);
    bar(this.duplex, 0.7, 0.006, -0.6, 0);
    bar(this.duplex, 0.002, 0.5, 0, 0);
    bar(this.duplex, 0.5, 0.002, 0, 0);
    // ~0.5 MOA-class illuminated dot (floored at ~3 px at 720p: the true size is well under a pixel).
    const dot = new Mesh(new RingGeometry(0, 0.006, 20), this.dotMat);
    dot.renderOrder = 1003;
    this.duplex.add(dot);
    this.root.add(this.duplex);
    // Circle-dot, units of the half view height: ~30 px circle and a ~3 px dot at 720p, thin black posts at
    // 3, 6 and 9 o'clock that frame it (and lead the eye in) without covering the target.
    const lit = (g: BufferGeometry) => {
      const m = new Mesh(g, this.litMat);
      m.renderOrder = 1003;
      this.circleDot.add(m);
    };
    lit(new RingGeometry(0.039, 0.0435, 64));
    lit(new RingGeometry(0, 0.005, 20));
    bar(this.circleDot, 0.42, 0.007, 0.66, 0);
    bar(this.circleDot, 0.42, 0.007, -0.66, 0);
    bar(this.circleDot, 0.007, 0.42, 0, -0.66);
    this.root.add(this.circleDot);
    this.root.visible = false;
    this.root.frustumCulled = false;
    this.root.traverse((o) => (o.frustumCulled = false));
    scene.add(this.root);
  }

  /**
   * @param k visibility 0..1 (ADS blend), @param pupil exit-pupil radius as a fraction of the half view height,
   * @param reticle the eyepiece reticle (null: none, e.g. a magnifier behind a red dot).
   */
  update(cam: PerspectiveCamera, k: number, pupil: number, reticle: ReticleKind | null, eye?: EyeState) {
    const on = k > 0.6;
    this.root.visible = on;
    if (!on) return;
    const a = Math.min(1, (k - 0.6) / 0.3);
    this.ringMat.opacity = a;
    this.retMat.opacity = a * 0.95;
    this.dotMat.opacity = a;
    this.litMat.opacity = a;
    this.duplex.visible = reticle === 'duplex';
    this.circleDot.visible = reticle === 'circleDot';
    // Past the near plane: through a scope it is pushed out beyond the muzzle (~0.5–0.7 m), which used to clip
    // the whole eyepiece picture (no ring, no reticle).
    const dist = Math.max(DIST, cam.near * 1.5);
    const halfH = Math.tan((cam.fov * Math.PI) / 360) * dist;
    this.root.position.copy(cam.position);
    this.root.quaternion.copy(cam.quaternion);
    this.root.translateZ(-dist);
    this.root.scale.setScalar(halfH);
    // Scope shadow: off-axis by a fraction of the eye box, the pupil slides the other way and closes in.
    let ox = 0,
      oy = 0,
      close = 1;
    if (eye && eye.eyeBox > 0) {
      ox = eye.offset.x / eye.eyeBox;
      oy = eye.offset.y / eye.eyeBox;
      const r = Math.hypot(ox, oy);
      if (r > 2) {
        ox *= 2 / r;
        oy *= 2 / r;
      }
      close = Math.max(0.35, 1 - 0.3 * Math.min(2, r));
    }
    const p = pupil * close;
    this.ring.scale.setScalar(p);
    this.ring.position.set(-ox * pupil * 0.45, -oy * pupil * 0.45, 0);
    this.duplex.scale.setScalar(pupil);
    this.root.updateMatrixWorld(true);
  }
}
