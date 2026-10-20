import { describe, expect, test } from 'bun:test';
import { Mesh, PerspectiveCamera, Scene, Vector3 } from 'three';
import { ScopeOverlay } from './ScopeOverlay';

const make = () => {
  const o = new ScopeOverlay(new Scene());
  const cam = new PerspectiveCamera(75, 16 / 9, 0.03, 600);
  cam.updateMatrixWorld();
  return { o, cam, ring: (o as unknown as { ring: Mesh }).ring };
};

describe('scope overlay', () => {
  test('scope shadow faces the camera (front faces, soft inner edge)', () => {
    const { ring } = make();
    const pos = ring.geometry.getAttribute('position');
    const idx = ring.geometry.getIndex()!;
    const v = (i: number) => new Vector3().fromBufferAttribute(pos, idx.getX(i));
    for (let t = 0; t < idx.count; t += 3 * 37) {
      const n = v(t + 1)
        .sub(v(t))
        .cross(v(t + 2).sub(v(t)));
      expect(n.z).toBeGreaterThan(0);
    }
    const col = ring.geometry.getAttribute('color');
    expect(col.itemSize).toBe(4);
    expect(col.getW(0)).toBe(0); // clear at the pupil edge
  });

  test('sits beyond the near plane, centred on the view axis; off-axis eye slides the shadow', () => {
    const { o, cam, ring } = make();
    cam.near = 0.62;
    o.update(cam, 1, 0.82, 'circleDot', { eyeBox: 0.011, offset: { x: 0, y: 0 } });
    const p = o.root.getWorldPosition(new Vector3());
    expect(-p.z).toBeGreaterThan(cam.near);
    expect(Math.hypot(p.x, p.y)).toBeLessThan(1e-9);
    expect(ring.position.length()).toBe(0);
    o.update(cam, 1, 0.82, 'circleDot', { eyeBox: 0.011, offset: { x: 0.01, y: 0 } });
    expect(ring.position.x).toBeLessThan(0);
    expect(ring.scale.x).toBeLessThan(0.82);
    // A tighter eye box (1-6x) reacts more to the same offset.
    const tight = make();
    tight.o.update(cam, 1, 0.82, 'duplex', { eyeBox: 0.006, offset: { x: 0.01, y: 0 } });
    expect(tight.ring.position.x).toBeLessThan(ring.position.x);
    // Hidden below the ADS threshold.
    o.update(cam, 0.3, 0.82, 'circleDot');
    expect(o.root.visible).toBe(false);
  });
});
