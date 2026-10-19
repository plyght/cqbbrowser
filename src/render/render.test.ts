import { describe, expect, test } from 'bun:test';
import { DynamicResolution } from './DynamicResolution';
import { BitrateModel } from './post/BitrateModel';
import { brownConrady, distortPoint, fitScale, undistortPoint } from './post/lens';

describe('lens fit', () => {
  test('no distortion, no circle → scale 1', () => {
    expect(fitScale(0, 0, 16 / 9)).toBeCloseTo(1, 4);
  });
  test('barrel distortion keeps every visible pixel inside the source frame', () => {
    const k1 = 0.12,
      k2 = 0.02,
      aspect = 16 / 9,
      circle = 1.85;
    const s = fitScale(k1, k2, aspect, circle);
    expect(s).toBeLessThan(1);
    for (let i = 0; i <= 50; i++)
      for (let j = 0; j <= 50; j++) {
        const x = (i / 50) * aspect,
          y = j / 50;
        const r = Math.hypot(x, y);
        if (r > circle) continue;
        const f = brownConrady(r, k1, k2) * s;
        expect(x * f).toBeLessThanOrEqual(aspect + 1e-3);
        expect(y * f).toBeLessThanOrEqual(1 + 1e-3);
      }
  });
  test('a smaller image circle allows a wider crop', () => {
    expect(fitScale(0.12, 0.02, 16 / 9, 1.6)).toBeGreaterThan(fitScale(0.12, 0.02, 16 / 9, 2.2));
  });
});

describe('bitrate model', () => {
  test('fast yaw starves and holds for a few frames, then recovers', () => {
    const b = new BitrateModel();
    b.update(1 / 60, 10);
    expect(b.starve).toBe(1);
    for (let i = 0; i < 4; i++) b.update(1 / 60, 0);
    expect(b.starve).toBe(1); // held
    for (let i = 0; i < 60; i++) b.update(1 / 60, 0);
    expect(b.starve).toBe(0);
  });
  test('slow motion does not starve', () => {
    const b = new BitrateModel();
    for (let i = 0; i < 30; i++) b.update(1 / 60, 1);
    expect(b.starve).toBe(0);
  });
  test('GOP phase wraps about once a second', () => {
    const b = new BitrateModel();
    let wraps = 0,
      prev = 0;
    for (let i = 0; i < 300; i++) {
      b.update(1 / 60, 0);
      if (b.gop < prev) wraps++;
      prev = b.gop;
    }
    expect(wraps).toBeGreaterThanOrEqual(4);
    expect(wraps).toBeLessThanOrEqual(5);
  });
});

describe('dynamic resolution', () => {
  test('drops under load and stays within bounds', () => {
    const d = new DynamicResolution();
    for (let i = 0; i < 300; i++) d.update(1 / 30);
    expect(d.scale).toBeCloseTo(d.min, 6);
  });
  test('probes back up when there is headroom', () => {
    const d = new DynamicResolution();
    d.scale = 0.7;
    for (let i = 0; i < 60 * 20; i++) d.update(1 / 90);
    expect(d.scale).toBeCloseTo(1, 6);
  });
  test('backs off after a failed probe on a vsync-locked display', () => {
    const d = new DynamicResolution();
    d.scale = 0.8;
    // At 0.8 the frame fits exactly in the vsync interval; above it, frames double.
    let changes = 0;
    for (let i = 0; i < 60 * 60; i++) {
      const dt = d.scale > 0.8 + 1e-6 ? 1 / 30 : 1 / 60;
      if (d.update(dt)) changes++;
    }
    expect(d.scale).toBeLessThanOrEqual(0.85 + 1e-6);
    // Exponential backoff: only a handful of probes in a minute.
    expect(changes).toBeLessThan(14);
  });
  test('does nothing in manual (fixed dt) mode at target', () => {
    const d = new DynamicResolution();
    for (let i = 0; i < 600; i++) d.update(1 / 60);
    expect(d.scale).toBe(1);
  });
});

describe('HUD lens mapping', () => {
  const aspect = 16 / 9;
  const lens = { k1: 0.11, k2: 0.025, scale: fitScale(0.11, 0.025, aspect, 1.78), circle: 1.78 };
  // Literal port of the shader's cSrc() so the test pins the GLSL formula, not the TS helper.
  const shader = (u: number, v: number) => {
    const px = (u * 2 - 1) * aspect,
      py = v * 2 - 1;
    const r2 = px * px + py * py;
    const f = (1 + lens.k1 * r2 + lens.k2 * r2 * r2) * lens.scale;
    return { x: ((px * f) / aspect) * 0.5 + 0.5, y: py * f * 0.5 + 0.5 };
  };
  test('undistortPoint matches the shader formula', () => {
    for (const [u, v] of [
      [0.1, 0.2],
      [0.5, 0.5],
      [0.93, 0.71],
    ]) {
      const a = undistortPoint({ x: u, y: v }, aspect, lens);
      const b = shader(u, v);
      expect(a.x).toBeCloseTo(b.x, 9);
      expect(a.y).toBeCloseTo(b.y, 9);
    }
  });
  test('distortPoint inverts the shader mapping', () => {
    for (let i = 0; i <= 10; i++)
      for (let j = 0; j <= 10; j++) {
        const out = { x: 0.05 + i * 0.09, y: 0.05 + j * 0.09 };
        const src = shader(out.x, out.y);
        const back = distortPoint(src, aspect, lens);
        expect(back.x).toBeCloseTo(out.x, 6);
        expect(back.y).toBeCloseTo(out.y, 6);
      }
  });
  test('identity lens is a no-op', () => {
    const p = distortPoint({ x: 0.3, y: 0.8 }, aspect);
    expect(p.x).toBeCloseTo(0.3, 9);
    expect(p.y).toBeCloseTo(0.8, 9);
  });
});
