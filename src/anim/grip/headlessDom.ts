/**
 * Minimal canvas stub so procedural weapon models (which bake canvas textures) can be built under bun:test.
 * Only geometry matters to the grip solver; every 2D-context call is a no-op.
 */
export function installHeadlessCanvas() {
  const g = globalThis as unknown as { document?: unknown };
  if (g.document) return;
  const ctx2d = new Proxy(
    {},
    {
      get: (_t, k) => {
        if (k === 'createImageData' || k === 'getImageData')
          return (w: number | { width: number; height: number }, h?: number) => {
            const W = typeof w === 'number' ? w : w.width,
              H = typeof w === 'number' ? (h ?? w) : w.height;
            return { width: W, height: H, data: new Uint8ClampedArray(W * H * 4) };
          };
        if (k === 'createLinearGradient' || k === 'createRadialGradient' || k === 'createPattern')
          return () => ({ addColorStop() {} });
        if (k === 'measureText') return () => ({ width: 0 });
        return () => {};
      },
      set: () => true,
    },
  );
  g.document = {
    createElement: () => ({ width: 1, height: 1, style: {}, getContext: () => ctx2d }),
  };
}
