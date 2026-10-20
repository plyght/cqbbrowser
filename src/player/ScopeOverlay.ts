import {
  Color,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  RingGeometry,
  type PerspectiveCamera,
  type Scene,
} from 'three';
import { RETICLE_RED, reticleMaterial } from '../render/reticle';

/**
 * Eyepiece picture for tube optics (LPVO, magnifier). The optic models are solid, so at ADS the camera's near
 * plane is pushed past the tube and this overlay draws the ocular ring (and, for the LPVO, its reticle) in
 * front of the view. Two draw calls, only while looking through a tube optic.
 */
const DIST = 0.5;

export class ScopeOverlay {
  readonly root = new Group();
  private ring: Mesh;
  private reticle = new Group();
  private ringMat = new MeshBasicMaterial({
    color: 0x050505,
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
  // Illuminated centre dot: exposure-locked (a fixed HDR value bloomed into a blob in the dark / under NVG).
  private dotMat = reticleMaterial(RETICLE_RED.clone(), {
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });

  constructor(scene: Scene) {
    // Unit ring at distance DIST: inner radius 1 (scaled to the exit pupil), wide outer black.
    this.ring = new Mesh(new RingGeometry(1, 12, 64, 1), this.ringMat);
    this.ring.renderOrder = 1001;
    this.root.add(this.ring);
    const bar = (w: number, h: number, x: number, y: number) => {
      const m = new Mesh(new PlaneGeometry(w, h), this.retMat);
      m.position.set(x, y, 0);
      m.renderOrder = 1002;
      this.reticle.add(m);
    };
    // Duplex-ish crosshair (thick outer posts, thin centre) + illuminated dot; units of the ring radius.
    bar(0.006, 0.7, 0, 0.6);
    bar(0.006, 0.7, 0, -0.6);
    bar(0.7, 0.006, 0.6, 0);
    bar(0.7, 0.006, -0.6, 0);
    bar(0.002, 0.5, 0, 0);
    bar(0.5, 0.002, 0, 0);
    // ~0.5 MOA-class illuminated dot (floored at ~3 px at 720p: the true size is well under a pixel).
    const dot = new Mesh(new RingGeometry(0, 0.006, 20), this.dotMat);
    dot.renderOrder = 1003;
    this.reticle.add(dot);
    this.root.add(this.reticle);
    this.root.visible = false;
    this.root.frustumCulled = false;
    this.root.traverse((o) => (o.frustumCulled = false));
    scene.add(this.root);
  }

  /**
   * @param k visibility 0..1 (ADS blend), @param pupil exit-pupil radius as a fraction of the half view height,
   * @param reticle draw the LPVO crosshair.
   */
  update(cam: PerspectiveCamera, k: number, pupil: number, reticle: boolean) {
    const on = k > 0.6;
    this.root.visible = on;
    if (!on) return;
    const a = Math.min(1, (k - 0.6) / 0.3);
    this.ringMat.opacity = a;
    this.retMat.opacity = a * 0.95;
    this.dotMat.opacity = a;
    this.reticle.visible = reticle;
    // Past the near plane: through a scope it is pushed out beyond the muzzle (~0.5–0.7 m), which used to clip
    // the whole eyepiece picture (no ring, no reticle).
    const dist = Math.max(DIST, cam.near * 1.5);
    const halfH = Math.tan((cam.fov * Math.PI) / 360) * dist;
    this.root.position.copy(cam.position);
    this.root.quaternion.copy(cam.quaternion);
    this.root.translateZ(-dist);
    this.root.scale.setScalar(halfH * pupil);
    this.root.updateMatrixWorld(true);
  }
}
