import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 4000,
    // Multi-page: the game and the weapon bench (dev/loadout page).
    rolldownOptions: { input: { main: 'index.html', bench: 'bench.html', anim: 'anim.html' } },
  },
  server: { port: 5173 },
});
