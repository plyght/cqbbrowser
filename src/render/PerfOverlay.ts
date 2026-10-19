import type { WebGLRenderer } from 'three';

/** `?perf` overlay: fps, frame ms, draw calls, triangles, resolution scale. Updates 4×/s. */
export class PerfOverlay {
  readonly el = document.createElement('div');
  private acc = 0;
  private frames = 0;
  private worst = 0;

  constructor() {
    Object.assign(this.el.style, {
      position: 'fixed',
      right: '8px',
      bottom: '8px',
      zIndex: '50',
      font: '11px/1.35 ui-monospace, Menlo, monospace',
      color: '#cfe8c8',
      background: 'rgba(0,0,0,0.6)',
      padding: '4px 7px',
      pointerEvents: 'none',
      whiteSpace: 'pre',
    });
    this.el.dataset.perf = '1';
    document.body.appendChild(this.el);
  }

  update(dt: number, r: WebGLRenderer, scale: number, tier: string) {
    this.acc += dt;
    this.frames++;
    this.worst = Math.max(this.worst, dt);
    if (this.acc < 0.25) return;
    const fps = this.frames / this.acc;
    const info = r.info.render;
    const gl = r.getContext();
    const res = `${gl.drawingBufferWidth}×${gl.drawingBufferHeight}`;
    this.el.textContent =
      `${fps.toFixed(0)} fps  ${((this.acc / this.frames) * 1000).toFixed(1)} ms (max ${(this.worst * 1000).toFixed(1)})\n` +
      `calls ${info.calls}  tris ${(info.triangles / 1000).toFixed(1)}k\n` +
      `scale ${scale.toFixed(2)}  ${res}  ${tier}`;
    this.acc = 0;
    this.frames = 0;
    this.worst = 0;
  }
}
