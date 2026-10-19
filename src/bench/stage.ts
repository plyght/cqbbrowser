import {
  Box3,
  DirectionalLight,
  HemisphereLight,
  PerspectiveCamera,
  Vector3,
  type Object3D,
  type Scene,
} from 'three';

/** Studio lighting shared by the dev weapon bench and the loadout turntable. */
export function addBenchLights(scene: Scene) {
  scene.add(new HemisphereLight(0xdfe6ee, 0x3a3632, 0.35));
  const fill = new DirectionalLight(0xffffff, 0.9);
  fill.position.set(2, 0.4, -0.3);
  const key = new DirectionalLight(0xfff4e6, 1.9);
  key.position.set(1.2, 2.2, 1.4);
  const rim = new DirectionalLight(0xbcd2ff, 1.6);
  rim.position.set(-1.5, 0.8, -1.2);
  const key2 = new DirectionalLight(0xfff8f0, 1.5);
  key2.position.set(-1.3, 2.0, 0.7);
  scene.add(fill, key, rim, key2);
}

export const BENCH_VIEWS: Record<string, Vector3> = {
  side: new Vector3(1, 0.02, 0),
  left: new Vector3(-1, 0.02, 0),
  threeq: new Vector3(0.85, 0.32, -0.42),
  rear: new Vector3(0.35, 0.25, 1),
  top: new Vector3(0.05, 1, 0.02),
  front: new Vector3(0.45, 0.2, -1),
};

/**
 * Fit an object in the camera from a named direction (or an explicit one). Returns the look-at centre and
 * distance so callers can orbit around it.
 */
export function frameObject(camera: PerspectiveCamera, obj: Object3D, view: string | Vector3, pad = 1.05) {
  const box = new Box3().setFromObject(obj);
  const c = box.getCenter(new Vector3());
  const size = box.getSize(new Vector3());
  const endOn = view === 'rear' || view === 'front';
  const L = endOn ? Math.max(size.x, size.y) * 1.9 : Math.max(size.z, size.y * 1.6, 0.18);
  // Fit the long axis horizontally on wide canvases and vertically on tall ones.
  const fitH = L / 2 / Math.tan((camera.fov * Math.PI) / 360);
  const d = fitH * (camera.aspect < 1.2 ? 1.5 : 1) * pad;
  const dir = (typeof view === 'string' ? (BENCH_VIEWS[view] ?? BENCH_VIEWS.threeq) : view)
    .clone()
    .normalize();
  camera.position.copy(c).addScaledVector(dir, d);
  camera.lookAt(c);
  camera.near = d / 50;
  camera.far = d * 10;
  camera.updateProjectionMatrix();
  return { center: c, distance: d, box };
}
