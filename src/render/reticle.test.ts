import { describe, expect, test } from 'bun:test';
import { RETICLE } from '../weapons/models/parts/optics';
import { RETICLE_DISPLAY, RETICLE_NVG, reticleGain, reticleMaterial } from './reticle';

describe('reticle exposure lock', () => {
  test('display brightness is the same at any exposure (no blob in the dark)', () => {
    for (const ev of [-4, 0, 3, 7]) expect(reticleGain(ev, null) * 2 ** ev).toBeCloseTo(RETICLE_DISPLAY, 3);
    // Under NVG the tube gain sets it, kept below the tube's halo threshold.
    for (const ev of [2, 6, 9]) expect(reticleGain(null, ev) * 2 ** ev).toBeCloseTo(RETICLE_NVG, 3);
    expect(RETICLE_NVG * 0.55).toBeLessThan(1.4);
  });

  test('material: unlit, not tone mapped, exposure-locked shader', () => {
    const m = reticleMaterial(0xff0000);
    expect(m.toneMapped).toBe(false);
    const sh = {
      uniforms: {} as Record<string, unknown>,
      vertexShader: '',
      fragmentShader: 'void main() {\n#include <opaque_fragment>\n}',
    };
    m.onBeforeCompile(sh as never, undefined as never);
    expect(sh.fragmentShader).toContain('tRetAE');
    expect(sh.fragmentShader).toContain('gl_FragColor.rgb *=');
    expect(Object.keys(sh.uniforms)).toEqual(['tRetAE', 'tRetNvg', 'uRet']);
  });
});

describe('reticle angular sizes', () => {
  // 720p, 75° ADS view: rad per pixel at the centre.
  const radPx = (2 * Math.tan((37.5 * Math.PI) / 180)) / 720;
  const px = (diameter: number, eye: number) => diameter / eye / radPx;
  const moa = (diameter: number, eye: number) => ((diameter / eye) * 180 * 60) / Math.PI;

  test('dots read as a few px, ordered holo < micro < RMR', () => {
    const holo = px(2 * RETICLE.holoDot, 0.1535);
    const micro = px(2 * RETICLE.microDot, 0.1285);
    const rmr = px(2 * RETICLE.pistolDot, 0.45);
    const off = px(2 * RETICLE.offsetDot, 0.1155);
    for (const p of [holo, micro, rmr, off]) {
      expect(p).toBeGreaterThan(1.4);
      expect(p).toBeLessThan(4);
    }
    expect(holo).toBeLessThan(micro);
    expect(micro).toBeLessThan(rmr);
  });

  test('holo ring is the real 65 MOA with a thin line', () => {
    const [r0, r1] = RETICLE.holoRing;
    expect(moa(r0 + r1, 0.1535)).toBeGreaterThan(60);
    expect(moa(r0 + r1, 0.1535)).toBeLessThan(70);
    expect(px(r1 - r0, 0.1535)).toBeLessThan(1.6);
  });
});
